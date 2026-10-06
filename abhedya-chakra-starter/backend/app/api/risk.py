
import os
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
from fastapi import APIRouter, HTTPException
from app.config import DUCKDB_MEMORY_LIMIT, DUCKDB_TEMP_DIR, DUCKDB_THREADS

from app.services.risk_scoring import score_account

router = APIRouter()

# Override with ABHEDYA_DB_PATH if your database is stored elsewhere.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "processed" / "abhedya.duckdb"
DB_PATH = Path(os.environ.get("ABHEDYA_DB_PATH", str(DEFAULT_DB_PATH)))


def calculate_rapid_pass_through(
    incoming: list[tuple[datetime | None, float | None]],
    outgoing: list[tuple[datetime | None, float | None] | tuple[datetime | None, float | None, str | None]],
):
    """Match outgoing amounts once to eligible incoming amounts using FIFO."""
    incoming_events = sorted(
        (
            (index, timestamp, max(0.0, float(amount or 0)))
            for index, (timestamp, amount) in enumerate(incoming)
            if timestamp is not None and float(amount or 0) > 0
        ),
        key=lambda event: (event[1], event[0]),
    )
    outgoing_events = []
    for index, event in enumerate(outgoing):
        timestamp, amount = event[:2]
        transaction_id = event[2] if len(event) > 2 else None
        if timestamp is not None and float(amount or 0) > 0:
            outgoing_events.append(
                (
                    timestamp,
                    max(0.0, float(amount or 0)),
                    transaction_id if transaction_id else index,
                )
            )
    outgoing_events.sort(key=lambda event: event[0])

    total_incoming = sum(
        max(0.0, float(amount or 0))
        for _, amount in incoming
    )
    eligible = deque()
    next_incoming = 0
    matched_incoming = set()
    matched_amount = 0.0

    outgoing_ids_by_incoming = {}
    matched_allocations_by_incoming = {}
    for outgoing_time, outgoing_amount, outgoing_id in outgoing_events:
        earliest_eligible = outgoing_time - timedelta(minutes=15)
        latest_eligible = outgoing_time - timedelta(minutes=3)

        while (
            next_incoming < len(incoming_events)
            and incoming_events[next_incoming][1] <= latest_eligible
        ):
            eligible.append(list(incoming_events[next_incoming]))
            next_incoming += 1

        while eligible and eligible[0][1] < earliest_eligible:
            eligible.popleft()

        remaining_outgoing = outgoing_amount
        while eligible and remaining_outgoing > 0:
            incoming_event = eligible[0]
            allocated = min(incoming_event[2], remaining_outgoing)
            incoming_event[2] -= allocated
            remaining_outgoing -= allocated
            incoming_index = incoming_event[0]
            outgoing_ids_by_incoming.setdefault(incoming_index, set()).add(
                outgoing_id
            )
            matched_allocations_by_incoming[incoming_index] = (
                matched_allocations_by_incoming.get(incoming_index, 0.0)
                + allocated
            )

            if incoming_event[2] <= 1e-9:
                eligible.popleft()

    for incoming_index, outgoing_ids in outgoing_ids_by_incoming.items():
        if len(outgoing_ids) >= 2:
            matched_incoming.add(incoming_index)
            matched_amount += matched_allocations_by_incoming[incoming_index]

    return matched_amount, total_incoming, len(matched_incoming)


def find_bounded_cycle(con, account_id: str, max_hops: int = 4, edge_limit: int = 10000):
    """Find a directed cycle starting and ending at an account."""
    frontier = {account_id}
    visited = {account_id}
    scanned_edges = 0

    for _ in range(max_hops):
        if not frontier:
            return False, True

        next_frontier = set()
        accounts = sorted(frontier)
        for offset in range(0, len(accounts), 500):
            chunk = accounts[offset:offset + 500]
            remaining = edge_limit - scanned_edges
            if remaining <= 0:
                return False, False

            placeholders = ",".join("?" for _ in chunk)
            rows = con.execute(
                f"""
                SELECT DISTINCT sender_account, receiver_account
                FROM transactions
                WHERE sender_account IN ({placeholders})
                LIMIT ?
                """,
                [*chunk, remaining + 1],
            ).fetchall()
            if len(rows) > remaining:
                rows = rows[:remaining]
                truncated = True
            else:
                truncated = False
            scanned_edges += len(rows)

            for sender, receiver in rows:
                if receiver == account_id and sender != account_id:
                    return True, not truncated
                if receiver and receiver not in visited:
                    next_frontier.add(receiver)

            if truncated:
                return False, False

        visited.update(next_frontier)
        frontier = next_frontier

    return False, True


def get_features(account_id: str) -> dict:
    """Calculate explainable features for one account using DuckDB."""

    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")

    con = duckdb.connect(
        str(DB_PATH),
        config={
            "threads": DUCKDB_THREADS,
            "memory_limit": DUCKDB_MEMORY_LIMIT,
            "temp_directory": str(DUCKDB_TEMP_DIR),
        },
    )

    try:
        exists = con.execute(
            """
            SELECT COUNT(*)
            FROM transactions
            WHERE "Sender_Account" = ?
               OR "Receiver_Account" = ?
            """,
            [account_id, account_id],
        ).fetchone()[0]

        if not exists:
            raise LookupError(f"Account not found: {account_id}")

        # Fan-in and fan-out count distinct counterparties.
        stats = con.execute(
            """
            SELECT
                COUNT(DISTINCT CASE
                    WHEN "Receiver_Account" = ? THEN "Sender_Account"
                END) AS distinct_senders,

                COUNT(DISTINCT CASE
                    WHEN "Sender_Account" = ? THEN "Receiver_Account"
                END) AS distinct_receivers,

                SUM(CASE
                    WHEN "Receiver_Account" = ?
                    THEN TRY_CAST("Amount" AS DOUBLE)
                    ELSE 0
                END) AS incoming_amount,

                SUM(CASE
                    WHEN "Sender_Account" = ?
                    THEN TRY_CAST("Amount" AS DOUBLE)
                    ELSE 0
                END) AS outgoing_amount
            FROM transactions
            WHERE "Sender_Account" = ?
               OR "Receiver_Account" = ?
            """,
            [
                account_id, account_id, account_id, account_id,
                account_id, account_id,
            ],
        ).fetchone()

        distinct_senders = int(stats[0] or 0)
        distinct_receivers = int(stats[1] or 0)
        incoming_amount = float(stats[2] or 0)
        outgoing_amount = float(stats[3] or 0)

        flow_rows = con.execute(
            """
            SELECT
                TRY_CAST("Timestamp" AS TIMESTAMP) AS ts,
                TRY_CAST("Amount" AS DOUBLE) AS amount,
                "Transaction_ID" AS transaction_id,
                'incoming' AS direction
            FROM transactions
            WHERE "Receiver_Account" = ?
            UNION ALL
            SELECT
                TRY_CAST("Timestamp" AS TIMESTAMP) AS ts,
                TRY_CAST("Amount" AS DOUBLE) AS amount,
                "Transaction_ID" AS transaction_id,
                'outgoing' AS direction
            FROM transactions
            WHERE "Sender_Account" = ?
            """,
            [account_id, account_id],
        ).fetchall()

        incoming_events = [
            (row[0], row[1]) for row in flow_rows if row[3] == "incoming"
        ]
        outgoing_events = [
            (row[0], row[1], row[2])
            for row in flow_rows
            if row[3] == "outgoing"
        ]
        rapid_amount, total_incoming_for_ratio, rapid_incoming_count = (
            calculate_rapid_pass_through(incoming_events, outgoing_events)
        )
        incoming_transaction_count = len(incoming_events)
        outgoing_transaction_count = len(outgoing_events)
        rapid_ratio = (
            min(1.0, max(0.0, rapid_amount / total_incoming_for_ratio))
            if total_incoming_for_ratio > 0
            else 0.0
        )

        # This is amount-matched screening, not proof of fund provenance.
        outgoing_amount_for_metrics = outgoing_amount
        # Look for terminal-related narration, device, or IP indicators.
        terminal_count = con.execute(
            """
            SELECT COUNT(*)
            FROM transactions
            WHERE "Sender_Account" = ?
              AND (
                  regexp_matches(
                      COALESCE("Narration", ''),
                      '(CRYPTO|P2P|CASH.?OUT|ATM|WALLET|OFFSHORE)',
                      'i'
                  )
                  OR lower(COALESCE("Device_Type", ''))
                     IN ('web_emulator', 'linux_script')
                  OR regexp_matches(
                      COALESCE("IP_Address", ''),
                      '^(185|194)\\.',
                      'i'
                  )
              )
            """,
            [account_id],
        ).fetchone()[0]

        cycle_detected, cycle_scan_complete = find_bounded_cycle(
            con,
            account_id,
        )

        return {
            "distinct_senders": distinct_senders,
            "distinct_receivers": distinct_receivers,
            "incoming_amount": incoming_amount,
            "outgoing_amount": outgoing_amount,
            "rapid_pass_through_ratio": rapid_ratio,
            "rapid_incoming_amount": rapid_amount,
            "rapid_incoming_count": rapid_incoming_count,
            "incoming_transaction_count": incoming_transaction_count,
            "outgoing_transaction_count": outgoing_transaction_count,
            "outgoing_amount_for_metrics": outgoing_amount_for_metrics,
            "terminal_indicators": int(terminal_count or 0),
            "cycle_detected": cycle_detected,
            "cycle_scan_complete": cycle_scan_complete,
        }

    finally:
        con.close()



def classify_mule_layer(features: dict) -> dict:
    """Return explainable, heuristic transaction-pattern labels."""
    senders = int(features.get("distinct_senders", 0))
    receivers = int(features.get("distinct_receivers", 0))
    rapid_ratio = float(features.get("rapid_pass_through_ratio", 0.0))
    terminal_count = int(features.get("terminal_indicators", 0))
    cycle_detected = bool(features.get("cycle_detected", False))
    cycle_scan_complete = bool(features.get("cycle_scan_complete", True))

    candidates = []
    evidence = []

    if senders >= 5:
        candidates.append("LAYER_1_COLLECTOR_CANDIDATE")
        evidence.append({
            "indicator": "fan_in",
            "distinct_senders": senders,
            "screening_threshold": 5,
        })

    if 3 <= receivers <= 7:
        candidates.append("LAYER_2_DISTRIBUTOR_CANDIDATE")
        evidence.append({
            "indicator": "fan_out",
            "distinct_receivers": receivers,
            "screening_threshold": "3-7",
        })

    if terminal_count > 0:
        candidates.append("LAYER_3_POTENTIAL_TERMINAL")
        evidence.append({
            "indicator": "terminal_related_transaction_markers",
            "matching_outgoing_transactions": terminal_count,
        })

    if rapid_ratio >= 0.90:
        candidates.append("HIGH_VELOCITY_PASS_THROUGH_CANDIDATE")
        evidence.append({
            "indicator": "rapid_pass_through_ratio",
            "observed_ratio": round(rapid_ratio, 4),
            "screening_threshold": 0.90,
            "interpretation": (
                "Outgoing amounts are FIFO-matched once to incoming amounts "
                "3-15 minutes earlier. This does not establish fund provenance."
            ),
        })

    if cycle_detected:
        candidates.append("DIRECTED_CYCLE_CANDIDATE")
        evidence.append({
            "indicator": "bounded_directed_cycle",
            "interpretation": (
                "A directed cycle of at most four transfers starts and ends "
                "at this account; timing and legitimate explanations require investigation."
            ),
        })
    elif not cycle_scan_complete:
        evidence.append({
            "indicator": "bounded_cycle_scan",
            "status": "incomplete",
            "interpretation": (
                "The cycle search reached its edge limit; absence of a cycle "
                "was not established."
            ),
        })

    return {
        "classification_candidates": candidates,
        "primary_candidate": candidates[0] if candidates else "UNCLASSIFIED",
        "evidence": evidence,
        "classification_is_heuristic": True,
        "is_proof_of_criminal_activity": False,
    }

@router.get("/risk/{account_id}")
def get_account_risk(account_id: str):
    try:
        features = get_features(account_id)
        result = score_account(features)

        return {
            "account_id": account_id,
            **result,
            "layer_classification": classify_mule_layer(features),
            "statistics": {
                "incoming_amount": round(features["incoming_amount"], 2),
                "outgoing_amount": round(features["outgoing_amount"], 2),
                "distinct_senders": features["distinct_senders"],
                "distinct_receivers": features["distinct_receivers"],
                "rapid_incoming_amount": round(features["rapid_incoming_amount"], 2),
                "rapid_incoming_count": features["rapid_incoming_count"],
                "cycle_scan_complete": features["cycle_scan_complete"],
                "incoming_transaction_count": features["incoming_transaction_count"],
                "outgoing_transaction_count": features["outgoing_transaction_count"],
                "outgoing_amount_for_metrics": round(features["outgoing_amount_for_metrics"], 2),
            },
        }

    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        # Keep the detailed exception in the Uvicorn terminal.
        import logging
        logging.getLogger(__name__).exception("Risk calculation failed")
        raise HTTPException(
            status_code=500,
            detail="Risk calculation failed. Check the backend terminal logs.",
        ) from exc
