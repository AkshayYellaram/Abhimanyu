
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.services.graph_trace import trace_money, trace_outgoing_page


router = APIRouter(
    prefix="/investigations",
    tags=["Investigations"],
)


def build_graph(result: dict) -> dict:
    """Convert a transaction trace into graph nodes and directed edges."""
    nodes_by_id = {}
    edges = []

    for account_id in result.get("accounts", []):
        nodes_by_id[account_id] = {
            "id": account_id,
            "label": account_id,
            "type": "account",
        }

    for tx in result.get("transactions", []):
        sender = tx.get("sender_account")
        receiver = tx.get("receiver_account")

        if not sender or not receiver:
            continue

        nodes_by_id.setdefault(
            sender,
            {"id": sender, "label": sender, "type": "account"},
        )
        nodes_by_id.setdefault(
            receiver,
            {"id": receiver, "label": receiver, "type": "account"},
        )

        edges.append(
            {
                "id": tx.get("transaction_id"),
                "source": sender,
                "target": receiver,
                "amount": tx.get("amount"),
                "timestamp": tx.get("timestamp"),
                "payment_mode": tx.get("payment_mode"),
                "hop": tx.get("hop"),
                "narration": tx.get("narration"),
            }
        )

    return {
        "account_id": result.get("account_id"),
        "max_hops": result.get("max_hops"),
        "node_count": len(nodes_by_id),
        "edge_count": len(edges),
        "nodes": list(nodes_by_id.values()),
        "edges": edges,
        "truncated": result.get("truncated", False),
        "notice": (
            "Graph edges represent recorded transactions. "
            "Connectivity alone does not establish that the same funds moved."
        ),
    }


@router.get("/trace/{account_id}")
def trace(
    account_id: str,
    max_hops: int = Query(default=4, ge=1, le=5),
    limit: int = Query(default=10000, ge=1, le=50000),
):
    """Trace outgoing transactions from an account."""
    try:
        return trace_money(
            account_id,
            max_hops=max_hops,
            limit=limit,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/outgoing/{account_id}")
def outgoing_page(
    account_id: str,
    hop: int = Query(default=0, ge=0, le=4),
    max_hops: int = Query(default=4, ge=1, le=5),
    received_at: datetime | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    """Return a page of time-valid outgoing transfers for graph expansion."""
    try:
        return trace_outgoing_page(
            account_id,
            hop=hop,
            max_hops=max_hops,
            received_at=received_at,
            offset=offset,
            limit=limit,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/graph/{account_id}")
def graph(
    account_id: str,
    max_hops: int = Query(default=4, ge=1, le=5),
    limit: int = Query(default=10000, ge=1, le=50000),
):
    """Return a trace formatted as graph nodes and edges."""
    try:
        result = trace_money(
            account_id,
            max_hops=max_hops,
            limit=limit,
        )
        return build_graph(result)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/timeline/{account_id}")
def timeline(
    account_id: str,
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    max_hops: int = Query(default=4, ge=1, le=5),
    limit: int = Query(default=10000, ge=1, le=50000),
):
    """Trace transactions within the specified time range."""
    if start is not None and end is not None and start > end:
        raise HTTPException(
            status_code=400,
            detail="Start time must be before end time.",
        )

    try:
        result = trace_money(
            account_id,
            max_hops=max_hops,
            limit=limit,
            start=start,
            end=end,
        )
        return {
            "account_id": account_id,
            "start": start.isoformat(sep=" ") if start else None,
            "end": end.isoformat(sep=" ") if end else None,
            "max_hops": max_hops,
            "transaction_count": result["transaction_count"],
            "transactions": result["transactions"],
            "accounts": result["accounts"],
            "truncated": result["truncated"],
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc