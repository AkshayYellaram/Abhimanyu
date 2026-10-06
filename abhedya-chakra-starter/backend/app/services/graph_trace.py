
from datetime import datetime

from app.services.db import connect, require_data


TRACE_TRANSACTION_COLUMNS = """
    t.transaction_id,
    t.sender_account,
    t.receiver_account,
    t.amount,
    t.timestamp,
    t.payment_mode,
    t.narration,
    t.sender_ifsc,
    t.receiver_ifsc,
    t.ip_address,
    t.device_type
"""


def _serialize_transaction(row, hop: int) -> dict:
    timestamp = row[4]
    return {
        "transaction_id": row[0],
        "sender_account": row[1],
        "receiver_account": row[2],
        "amount": row[3],
        "timestamp": timestamp.isoformat(sep=" ") if timestamp is not None else None,
        "payment_mode": row[5],
        "narration": row[6],
        "sender_ifsc": row[7],
        "receiver_ifsc": row[8],
        "ip_address": row[9],
        "device_type": row[10],
        "hop": hop,
    }


def trace_outgoing_page(
    account: str,
    *,
    hop: int,
    max_hops: int = 4,
    received_at: datetime | None = None,
    offset: int = 0,
    limit: int = 100,
):
    """Return one bounded page of time-valid outgoing transfers for an account."""
    if not account or not account.strip():
        raise ValueError("Account ID must not be empty.")
    if not 1 <= max_hops <= 5:
        raise ValueError("max_hops must be between 1 and 5.")
    if not 0 <= hop < max_hops:
        raise ValueError("The selected account is already at the maximum trace depth.")
    if hop > 0 and received_at is None:
        raise ValueError(
            "Cannot expand a downstream account without a verifiable receipt time."
        )
    if offset < 0:
        raise ValueError("Page offset must be non-negative.")
    if not 1 <= limit <= 500:
        raise ValueError("Page size must be between 1 and 500.")

    account = account.strip()
    con = connect()
    try:
        require_data(con)
        if received_at is not None:
            receipt_exists = con.execute(
                """
                SELECT 1
                FROM transactions
                WHERE receiver_account = ? AND timestamp = ?
                LIMIT 1
                """,
                [account, received_at],
            ).fetchone()
            if receipt_exists is None:
                raise ValueError(
                    "Receipt time must match an incoming transaction for this account."
                )

        time_condition = "AND t.timestamp >= ?" if received_at is not None else ""
        params = [account]
        if received_at is not None:
            params.append(received_at)
        rows = con.execute(
            f"""
            SELECT {TRACE_TRANSACTION_COLUMNS}
            FROM transactions t
            WHERE t.sender_account = ?
              {time_condition}
            ORDER BY t.timestamp ASC NULLS LAST, t.transaction_id ASC
            LIMIT ? OFFSET ?
            """,
            params + [limit + 1, offset],
        ).fetchall()
    finally:
        con.close()

    has_more = len(rows) > limit
    page_rows = rows[:limit]
    next_offset = offset + len(page_rows) if has_more else None
    return {
        "account_id": account,
        "hop": hop + 1,
        "received_at": received_at.isoformat(sep=" ") if received_at else None,
        "offset": offset,
        "next_offset": next_offset,
        "has_more": has_more,
        "transactions": [
            _serialize_transaction(row, hop + 1) for row in page_rows
        ],
    }


def trace_money(
    victim: str,
    max_hops: int = 4,
    limit: int = 10000,
    start: datetime | None = None,
    end: datetime | None = None,
):
    """
    Trace outgoing transactions from an account up to max_hops.

    The transaction limit is shared across hops. A portion of the remaining
    budget is reserved for each remaining hop to improve downstream coverage.

    Returns the victim account, discovered accounts, transactions, and
    whether any results were truncated by the configured limits.
    """

    if not victim or not victim.strip():
        raise ValueError("Account ID must not be empty.")

    victim = victim.strip()

    if not 1 <= max_hops <= 5:
        raise ValueError("max_hops must be between 1 and 5.")

    if limit < 1:
        raise ValueError("limit must be at least 1.")

    if start is not None and end is not None and start > end:
        raise ValueError("Start time must be before end time.")

    con = connect()

    try:
        require_data(con)

        frontier = {victim}
        visited = {victim}
        received_at = {victim: None}
        results = []
        seen_transactions = set()
        truncated = False
        hop_stats = []

        for hop in range(1, max_hops + 1):
            if not frontier:
                break

            remaining = limit - len(results)

            if remaining <= 0:
                truncated = True
                break

            # Reserve a portion of the remaining transaction budget
            # for this hop and the hops that follow it.
            remaining_hops = max_hops - hop + 1
            hop_budget = max(1, remaining // remaining_hops)

            frontier_rows = [
                {
                    "sender_account": account,
                    "received_at": received_at.get(account),
                }
                for account in sorted(frontier)
            ]

            conditions = []
            params = [frontier_rows]

            if start is not None:
                conditions.append("timestamp >= ?")
                params.append(start)

            if end is not None:
                conditions.append("timestamp <= ?")
                params.append(end)

            query = f"""
            WITH frontier AS (
                SELECT
                    entry.sender_account AS account_id,
                    TRY_CAST(entry.received_at AS TIMESTAMP) AS received_at
                FROM UNNEST(?) AS u(entry)
            )
            SELECT {TRACE_TRANSACTION_COLUMNS}
                FROM transactions t
                INNER JOIN frontier f
                    ON t.sender_account = f.account_id
                   AND (
                       f.received_at IS NULL
                       OR t.timestamp >= f.received_at
                   )
                {"WHERE " + " AND ".join(conditions) if conditions else ""}
                ORDER BY t.timestamp, transaction_id
                LIMIT ?
            """

            rows = con.execute(
                query,
                params + [hop_budget + 1],
            ).fetchall()
            fetched_rows = len(rows)
            hop_truncated = False
            results_before_hop = len(results)
            frontier_account_count = len(frontier)

            # If there are more rows than this hop's allocation,
            # retain only the allocated number and mark the trace.
            if len(rows) > hop_budget:
                truncated = True
                hop_truncated = True
                rows = rows[:hop_budget]

            next_frontier = set()
            next_received_at = {}
            for row in rows:
                transaction_id = row[0]

                # Avoid including the same transaction more than once.
                if transaction_id is not None:
                    if transaction_id in seen_transactions:
                        continue

                    seen_transactions.add(transaction_id)

                timestamp = row[4]
                results.append(_serialize_transaction(row, hop))

                receiver = row[2]

                if receiver and receiver not in visited:
                    visited.add(receiver)
                    if timestamp is not None:
                        next_frontier.add(receiver)
                        next_received_at[receiver] = timestamp

            received_at.update(next_received_at)
            frontier = next_frontier
            hop_stats.append(
                {
                    "hop": hop,
                    "frontier_accounts": frontier_account_count,
                    "budget": hop_budget,
                    "rows_fetched": fetched_rows,
                    "rows_processed": len(rows),
                    "transactions_added": len(results) - results_before_hop,
                    "next_frontier_accounts": len(next_frontier),
                    "truncated_at_hop": hop_truncated,
                }
            )

        return {
            "account_id": victim,
            "victim_account": victim,
            "max_hops": max_hops,
            "transaction_count": len(results),
            "truncated": truncated,
            "hop_stats": hop_stats,
            "accounts": sorted(visited),
            "transactions": results,
        }

    finally:
        con.close()
