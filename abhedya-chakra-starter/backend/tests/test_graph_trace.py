import duckdb
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from app.services import graph_trace

client = TestClient(app)


@pytest.fixture
def trace_db(tmp_path, monkeypatch):
    db_path = tmp_path / "trace_test.duckdb"

    def test_connect():
        return duckdb.connect(str(db_path))

    monkeypatch.setattr(graph_trace, "connect", test_connect)

    con = duckdb.connect(str(db_path))
    con.execute("""
        CREATE TABLE transactions (
            transaction_id VARCHAR,
            sender_account VARCHAR,
            receiver_account VARCHAR,
            amount DOUBLE,
            timestamp TIMESTAMP,
            payment_mode VARCHAR,
            narration VARCHAR,
            sender_ifsc VARCHAR,
            receiver_ifsc VARCHAR,
            ip_address VARCHAR,
            device_type VARCHAR
        )
    """)

    rows = [
        ("T1", "VICTIM", "A", 1000, "2026-01-01 10:00:00"),
        ("T2", "A", "B", 900, "2026-01-01 10:02:00"),
        ("T3", "B", "C", 800, "2026-01-01 10:04:00"),
        ("T4", "C", "D", 700, "2026-01-01 10:06:00"),
        ("T5", "D", "E", 600, "2026-01-01 10:08:00"),
        ("T6", "B", "OLD", 50, "2026-01-01 09:00:00"),
    ]

    con.executemany("""
        INSERT INTO transactions
        (transaction_id, sender_account, receiver_account, amount, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, rows)
    con.close()


def test_trace_follows_four_hops(trace_db):
    result = graph_trace.trace_money("VICTIM", max_hops=4)

    assert result["transaction_count"] == 4
    assert result["accounts"] == ["A", "B", "C", "D", "VICTIM"]
    assert [tx["hop"] for tx in result["transactions"]] == [1, 2, 3, 4]


def test_trace_does_not_follow_transfer_before_receipt(trace_db):
    result = graph_trace.trace_money("VICTIM", max_hops=4)

    transaction_ids = {
        tx["transaction_id"] for tx in result["transactions"]
    }

    # B received funds at 10:02. Its 09:00 transfer to OLD
    # must not be presented as a downstream transfer.
    assert "T6" not in transaction_ids


def test_trace_includes_accounts_from_transactions_without_timestamps(trace_db):
    con = graph_trace.connect()
    con.execute("""
        INSERT INTO transactions
        (transaction_id, sender_account, receiver_account, amount, timestamp)
        VALUES
            ('T7', 'VICTIM', 'NO_TIMESTAMP', 100, NULL),
            ('T8', 'NO_TIMESTAMP', 'UNVERIFIABLE_CHILD', 90, '2026-01-01 10:10:00')
    """)
    con.close()

    result = graph_trace.trace_money("VICTIM", max_hops=2)

    assert "NO_TIMESTAMP" in result["accounts"]
    assert "UNVERIFIABLE_CHILD" not in result["accounts"]
    assert "T8" not in {
        tx["transaction_id"] for tx in result["transactions"]
    }


def test_trace_respects_time_filter(trace_db):
    from datetime import datetime

    result = graph_trace.trace_money(
        "VICTIM",
        max_hops=4,
        start=datetime(2026, 1, 1, 10, 0),
        end=datetime(2026, 1, 1, 10, 7),
    )

    transaction_ids = {
        tx["transaction_id"] for tx in result["transactions"]
    }

    assert "T3" in transaction_ids
    assert "T4" in transaction_ids
    assert "T1" in transaction_ids
    assert "T2" in transaction_ids


def test_outgoing_pages_are_stable_and_report_continuation(trace_db):
    con = graph_trace.connect()
    con.executemany(
        """
        INSERT INTO transactions
        (transaction_id, sender_account, receiver_account, amount, timestamp)
        VALUES (?, 'VICTIM', ?, 10, ?)
        """,
        [
            ("T7", "F", "2026-01-01 10:01:00"),
            ("T8", "G", "2026-01-01 10:02:00"),
            ("T9", "H", "2026-01-01 10:03:00"),
        ],
    )
    con.close()

    first_page = graph_trace.trace_outgoing_page(
        "VICTIM", hop=0, max_hops=2, limit=2
    )
    second_page = graph_trace.trace_outgoing_page(
        "VICTIM",
        hop=0,
        max_hops=2,
        offset=first_page["next_offset"],
        limit=2,
    )

    assert [tx["transaction_id"] for tx in first_page["transactions"]] == ["T1", "T7"]
    assert first_page["has_more"] is True
    assert first_page["next_offset"] == 2
    assert [tx["transaction_id"] for tx in second_page["transactions"]] == ["T8", "T9"]
    assert second_page["has_more"] is False
    assert second_page["next_offset"] is None
    assert all(tx["hop"] == 1 for tx in first_page["transactions"])


def test_downstream_page_excludes_transfers_before_receipt(trace_db):
    result = graph_trace.trace_outgoing_page(
        "B",
        hop=2,
        max_hops=4,
        received_at=datetime(2026, 1, 1, 10, 2),
    )

    assert [tx["transaction_id"] for tx in result["transactions"]] == ["T3"]
    assert result["transactions"][0]["hop"] == 3


def test_downstream_page_requires_a_verifiable_receipt_time(trace_db):
    with pytest.raises(ValueError, match="receipt time"):
        graph_trace.trace_outgoing_page("A", hop=1, max_hops=4)


def test_downstream_page_rejects_a_receipt_time_not_in_the_dataset(trace_db):
    with pytest.raises(ValueError, match="match an incoming transaction"):
        graph_trace.trace_outgoing_page(
            "A",
            hop=1,
            max_hops=4,
            received_at=datetime(2026, 1, 1, 9, 0),
        )


def test_outgoing_page_validates_bounds(trace_db):
    with pytest.raises(ValueError, match="maximum trace depth"):
        graph_trace.trace_outgoing_page("D", hop=4, max_hops=4)

    with pytest.raises(ValueError, match="between 1 and 500"):
        graph_trace.trace_outgoing_page("VICTIM", hop=0, limit=501)


def test_outgoing_page_api_returns_paginated_trace_rows(trace_db):
    response = client.get(
        "/api/investigations/outgoing/VICTIM",
        params={"hop": 0, "max_hops": 4, "limit": 1},
    )

    assert response.status_code == 200
    assert response.json()["transactions"][0]["transaction_id"] == "T1"
    assert response.json()["transactions"][0]["hop"] == 1


def test_outgoing_page_api_rejects_unverifiable_downstream_time(trace_db):
    response = client.get(
        "/api/investigations/outgoing/A",
        params={"hop": 1, "max_hops": 4},
    )

    assert response.status_code == 400
    assert "receipt time" in response.json()["detail"]


def test_outgoing_page_api_accepts_receipt_time(trace_db):
    response = client.get(
        "/api/investigations/outgoing/B",
        params={
            "hop": 2,
            "max_hops": 4,
            "received_at": "2026-01-01 10:02:00",
        },
    )

    assert response.status_code == 200
    assert [tx["transaction_id"] for tx in response.json()["transactions"]] == ["T3"]
