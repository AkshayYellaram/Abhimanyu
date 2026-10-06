import duckdb
from fastapi.testclient import TestClient

from app.api import ingestion as ingestion_api
from app.main import app
from app.services import ingest

client = TestClient(app)

def test_csv_upload_row_limit_supports_two_million_transactions():
    assert ingestion_api.MAX_CSV_ROWS == 2_000_000


CSV_CONTENT = (
    "Transaction_ID,Sender_Account,Receiver_Account,Sender_IFSC,Receiver_IFSC,Amount,Timestamp,Payment_Mode,Narration,IP_Address,Device_Type\n"
    "TXN0001,AAAA00000001,BBBB00000002,HDFC0000001,ICIC0000002,1250,2026-10-02 10:15:00,UPI,Test transfer,192.0.2.1,Mobile\n"
)


def test_csv_upload_loads_dataset_and_returns_sample_account(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "DB_PATH", tmp_path / "upload.duckdb")

    response = client.post(
        "/api/ingestion/upload",
        files={"file": ("transactions.csv", CSV_CONTENT, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "loaded"
    assert response.json()["filename"] == "transactions.csv"
    assert response.json()["rows"] == 1
    assert response.json()["unique_accounts"] == 2
    assert response.json()["sample_account"] == "AAAA00000001"


def test_csv_upload_rejects_non_csv_files():
    response = client.post(
        "/api/ingestion/upload",
        files={"file": ("transactions.txt", CSV_CONTENT, "text/plain")},
    )

    assert response.status_code == 400
    assert ".csv" in response.json()["detail"].lower()


def test_csv_upload_rejects_malformed_rows_before_import(tmp_path, monkeypatch):
    db_path = tmp_path / "malformed-upload.duckdb"
    monkeypatch.setattr(ingest, "DB_PATH", db_path)
    malformed_csv = CSV_CONTENT + "TXN0002,too,few,fields\n"

    response = client.post(
        "/api/ingestion/upload",
        files={"file": ("transactions.csv", malformed_csv, "text/csv")},
    )

    assert response.status_code == 400
    assert "expected 11" in response.json()["detail"]
    assert not db_path.exists()


def test_csv_upload_rejects_invalid_utf8():
    response = client.post(
        "/api/ingestion/upload",
        files={"file": ("transactions.csv", b"\xff\xfe\x00", "text/csv")},
    )

    assert response.status_code == 400
    assert "utf-8" in response.json()["detail"].lower()


def test_path_based_ingestion_endpoint_is_not_exposed():
    response = client.post("/api/ingestion/csv", json={"path": "C:\\Windows\\win.ini"})

    assert response.status_code == 404


def test_cross_site_write_is_rejected():
    response = client.post(
        "/api/ingestion/rollback",
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403


def test_untrusted_host_is_rejected():
    response = client.get("/health", headers={"Host": "attacker.example"})

    assert response.status_code == 400


def test_csv_upload_reports_missing_required_columns(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "DB_PATH", tmp_path / "invalid-upload.duckdb")
    response = client.post(
        "/api/ingestion/upload",
        files={
            "file": (
                "transactions.csv",
                "Transaction_ID,Sender_Account\nTXN0001,AAAA00000001\n",
                "text/csv",
            )
        },
    )

    assert response.status_code == 400
    assert "missing required columns" in response.json()["detail"]


def test_csv_upload_can_be_rolled_back_and_records_audit_trail(tmp_path, monkeypatch):
    db_path = tmp_path / "rollback.duckdb"
    monkeypatch.setattr(ingest, "DB_PATH", db_path)
    first_csv = CSV_CONTENT
    second_csv = CSV_CONTENT.replace("TXN0001", "TXN0002")

    first_upload = client.post(
        "/api/ingestion/upload",
        files={"file": ("first.csv", first_csv, "text/csv")},
    )
    second_upload = client.post(
        "/api/ingestion/upload",
        files={"file": ("second.csv", second_csv, "text/csv")},
    )

    assert first_upload.status_code == 200
    assert second_upload.status_code == 200
    assert client.get("/api/ingestion/history").json()["rollback_available"] is True

    rollback = client.post("/api/ingestion/rollback")

    assert rollback.status_code == 200
    assert rollback.json()["filename"] == "second.csv"
    assert rollback.json()["rollback_available"] is False
    with duckdb.connect(str(db_path), read_only=True) as con:
        transaction_ids = con.execute(
            "SELECT transaction_id FROM transactions"
        ).fetchall()
    assert transaction_ids == [("TXN0001",)]

    history = client.get("/api/ingestion/history").json()
    assert history["rollback_available"] is False
    assert [event["action"] for event in history["events"][:3]] == [
        "rollback",
        "import",
        "import",
    ]


def test_rollback_of_first_upload_restores_empty_state(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "DB_PATH", tmp_path / "first-upload.duckdb")
    uploaded = client.post(
        "/api/ingestion/upload",
        files={"file": ("only.csv", CSV_CONTENT, "text/csv")},
    )
    assert uploaded.status_code == 200

    rollback = client.post("/api/ingestion/rollback")

    assert rollback.status_code == 200
    assert rollback.json()["had_previous_dataset"] is False
    assert rollback.json()["rows"] == 0
    assert client.post("/api/ingestion/rollback").status_code == 409
