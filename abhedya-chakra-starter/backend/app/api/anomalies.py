
import csv
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

PROJECT_ROOT = Path(__file__).resolve().parents[3]
RESULTS_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "account_anomaly_scores.csv"
)


def read_results():
    if not RESULTS_FILE.exists():
        raise HTTPException(
            status_code=503,
            detail="Anomaly results are unavailable. Run the detector first.",
        )

    try:
        with RESULTS_FILE.open(
            "r", encoding="utf-8-sig", newline=""
        ) as file:
            return list(csv.DictReader(file))
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not read anomaly results.",
        ) from exc


def serialize_result(row):
    return {
        "account_id": row["account_id"],
        "anomaly_flag": row["anomaly_flag"].strip().lower() == "true",
        "anomaly_score": float(row["anomaly_score"]),
        "model_type": row["model_type"],
        "interpretation": row["interpretation"],
    }


@router.get("")
def list_anomalies(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str = Query(default="", max_length=100),
):
    """List unusual accounts, ordered by anomaly score."""
    rows = read_results()

    total_accounts = len(rows)
    flagged_total = sum(
        row["anomaly_flag"].strip().lower() == "true"
        for row in rows
    )

    rows.sort(
        key=lambda row: float(row["anomaly_score"]),
        reverse=True,
    )

    search_term = q.strip().casefold()
    filtered_rows = [
        row for row in rows
        if search_term in row["account_id"].casefold()
    ] if search_term else rows

    total = len(filtered_rows)
    page = filtered_rows[offset:offset + limit]

    return {
        "total": total,
        "total_accounts": total_accounts,
        "flagged_total": flagged_total,
        "limit": limit,
        "offset": offset,
        "results": [serialize_result(row) for row in page],
        "notice": (
            "Unsupervised anomaly results are investigative leads, "
            "not proof of fraud or mule activity."
        ),
    }


@router.get("/{account_id}")
def get_anomaly(account_id: str):
    """Get the anomaly result for one account."""
    for row in read_results():
        if row["account_id"].casefold() == account_id.casefold():
            return serialize_result(row)

    raise HTTPException(
        status_code=404,
        detail="Account not found in anomaly results.",
    )