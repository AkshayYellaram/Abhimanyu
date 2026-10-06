from pathlib import Path
import time
import uuid
import duckdb
from app.config import (
    DB_PATH,
    DUCKDB_MEMORY_LIMIT,
    DUCKDB_TEMP_DIR,
    DUCKDB_THREADS,
    PROCESSED_DIR,
)
from app.services.normalize import REQUIRED_COLUMNS, normalize_sql


def _validate_csv(con, source: Path):
    header = con.execute(
        "SELECT * FROM read_csv(?, header=true, all_varchar=true, sample_size=1000) LIMIT 0",
        [str(source)]
    ).description
    actual = {column[0] for column in header}
    missing = [column for column in REQUIRED_COLUMNS if column not in actual]
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")


def _table_exists(con, table_name: str) -> bool:
    return con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
        [table_name],
    ).fetchone()[0] > 0


def _create_upload_tables(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS upload_state (
            id INTEGER PRIMARY KEY,
            upload_id VARCHAR,
            filename VARCHAR,
            had_previous BOOLEAN,
            previous_rows BIGINT,
            current_rows BIGINT,
            can_rollback BOOLEAN,
            updated_at TIMESTAMP
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS upload_audit (
            event_id VARCHAR,
            upload_id VARCHAR,
            action VARCHAR,
            filename VARCHAR,
            previous_rows BIGINT,
            current_rows BIGINT,
            occurred_at TIMESTAMP,
            details VARCHAR
        )
    """)


def ingest_csv(path: str, *, upload_filename: str | None = None):
    source = Path(path).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".csv":
        raise FileNotFoundError(f"CSV file not found: {source}")
    start = time.perf_counter()
    con = duckdb.connect(
        str(DB_PATH),
        config={
            "threads": DUCKDB_THREADS,
            "memory_limit": DUCKDB_MEMORY_LIMIT,
            "temp_directory": str(DUCKDB_TEMP_DIR),
        },
    )
    transaction_open = False
    try:
        _validate_csv(con, source)
        upload_id = str(uuid.uuid4()) if upload_filename is not None else None
        had_previous = False
        previous_rows = 0
        if upload_filename is not None:
            con.execute("BEGIN TRANSACTION")
            transaction_open = True
            _create_upload_tables(con)
            had_previous = _table_exists(con, "transactions")
            if had_previous:
                previous_rows = con.execute(
                    "SELECT count(*) FROM transactions"
                ).fetchone()[0]
                con.execute(
                    "CREATE OR REPLACE TABLE upload_rollback_snapshot AS "
                    "SELECT * FROM transactions"
                )
            else:
                con.execute("DROP TABLE IF EXISTS upload_rollback_snapshot")

        con.execute(normalize_sql(), [str(source)])
        con.execute("CREATE INDEX IF NOT EXISTS idx_sender ON transactions(sender_account)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_receiver ON transactions(receiver_account)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON transactions(timestamp)")
        row_count = con.execute("SELECT count(*) FROM transactions").fetchone()[0]
        quality = con.execute("""
            SELECT count(*) FROM transactions
            WHERE transaction_id IS NULL OR sender_account IS NULL
               OR receiver_account IS NULL OR amount IS NULL OR timestamp IS NULL
               OR amount < 0
        """).fetchone()[0]
        invalid_accounts = con.execute("""
            SELECT count(*) FROM transactions
            WHERE NOT regexp_matches(COALESCE(sender_account, ''), '^[A-Z0-9]{12}$')
               OR NOT regexp_matches(COALESCE(receiver_account, ''), '^[A-Z0-9]{12}$')
        """).fetchone()[0]
        invalid_ifs_codes = con.execute("""
            SELECT count(*) FROM transactions
            WHERE NOT regexp_matches(COALESCE(sender_ifsc, ''), '^[A-Z]{4}0[A-Z0-9]{6}$')
               OR NOT regexp_matches(COALESCE(receiver_ifsc, ''), '^[A-Z]{4}0[A-Z0-9]{6}$')
        """).fetchone()[0]
        unsupported_payment_modes = con.execute("""
            SELECT count(*) FROM transactions
            WHERE COALESCE(payment_mode, '') NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS')
        """).fetchone()[0]
        invalid_ip_addresses = con.execute("""
            SELECT count(*) FROM transactions
            WHERE TRY_CAST(COALESCE(ip_address, '') AS INET) IS NULL
        """).fetchone()[0]
        accounts = con.execute("""
            SELECT count(*) FROM (
              SELECT sender_account AS account FROM transactions
              UNION
              SELECT receiver_account AS account FROM transactions
            )
        """).fetchone()[0]
        sample_account = con.execute("""
            SELECT account FROM (
              SELECT sender_account AS account FROM transactions
              UNION
              SELECT receiver_account AS account FROM transactions
            )
            WHERE account IS NOT NULL AND account <> ''
            ORDER BY account
            LIMIT 1
        """).fetchone()
        elapsed = round(time.perf_counter() - start, 3)
        result = {
            "status": "loaded", "database": str(DB_PATH),
            "rows": row_count, "unique_accounts": accounts,
            "sample_account": sample_account[0] if sample_account else None,
            "rows_with_invalid_core_fields": quality,
            "rows_with_invalid_account_ids": invalid_accounts,
            "rows_with_invalid_ifsc_codes": invalid_ifs_codes,
            "rows_with_unsupported_payment_modes": unsupported_payment_modes,
            "rows_with_invalid_ip_addresses": invalid_ip_addresses,
            "elapsed_seconds": elapsed,
            "note": "Benchmark includes import, index creation, and validation."
        }
        if upload_filename is not None:
            con.execute("""
                INSERT INTO upload_state
                VALUES (1, ?, ?, ?, ?, ?, TRUE, current_timestamp)
                ON CONFLICT (id) DO UPDATE SET
                    upload_id = excluded.upload_id,
                    filename = excluded.filename,
                    had_previous = excluded.had_previous,
                    previous_rows = excluded.previous_rows,
                    current_rows = excluded.current_rows,
                    can_rollback = excluded.can_rollback,
                    updated_at = excluded.updated_at
            """, [upload_id, upload_filename, had_previous, previous_rows, row_count])
            con.execute("""
                INSERT INTO upload_audit
                VALUES (?, ?, 'import', ?, ?, ?, current_timestamp, ?)
            """, [
                str(uuid.uuid4()),
                upload_id,
                upload_filename,
                previous_rows if had_previous else None,
                row_count,
                "CSV dataset imported successfully.",
            ])
            con.execute("COMMIT")
            transaction_open = False
            result["upload_id"] = upload_id
            result["rollback_available"] = True
        return result
    except Exception:
        if transaction_open:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def rollback_last_upload():
    con = duckdb.connect(
        str(DB_PATH),
        config={
            "threads": DUCKDB_THREADS,
            "memory_limit": DUCKDB_MEMORY_LIMIT,
            "temp_directory": str(DUCKDB_TEMP_DIR),
        },
    )
    transaction_open = False
    try:
        if not _table_exists(con, "upload_state"):
            raise ValueError("There is no CSV upload available to roll back.")
        state = con.execute("""
            SELECT upload_id, filename, had_previous, previous_rows, current_rows, can_rollback
            FROM upload_state WHERE id = 1
        """).fetchone()
        if not state or not state[5]:
            raise ValueError("The most recent CSV upload has already been rolled back.")

        upload_id, filename, had_previous, previous_rows, current_rows, _ = state
        con.execute("BEGIN TRANSACTION")
        transaction_open = True
        if had_previous:
            if not _table_exists(con, "upload_rollback_snapshot"):
                raise RuntimeError("The saved pre-upload dataset is missing; rollback cannot continue.")
            con.execute(
                "CREATE OR REPLACE TABLE transactions AS "
                "SELECT * FROM upload_rollback_snapshot"
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_sender ON transactions(sender_account)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_receiver ON transactions(receiver_account)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON transactions(timestamp)")
        else:
            con.execute("DROP TABLE IF EXISTS transactions")

        con.execute("UPDATE upload_state SET can_rollback = FALSE, updated_at = current_timestamp WHERE id = 1")
        con.execute("""
            INSERT INTO upload_audit
            VALUES (?, ?, 'rollback', ?, ?, ?, current_timestamp, ?)
        """, [
            str(uuid.uuid4()),
            upload_id,
            filename,
            current_rows,
            previous_rows if had_previous else 0,
            "Most recent CSV import was rolled back by the local user.",
        ])
        sample_account = None
        if had_previous:
            sample = con.execute("""
                SELECT account FROM (
                    SELECT sender_account AS account FROM transactions
                    UNION
                    SELECT receiver_account AS account FROM transactions
                )
                WHERE account IS NOT NULL AND account <> ''
                ORDER BY account
                LIMIT 1
            """).fetchone()
            sample_account = sample[0] if sample else None
        con.execute("COMMIT")
        transaction_open = False
        return {
            "status": "rolled_back",
            "filename": filename,
            "rows": previous_rows if had_previous else 0,
            "sample_account": sample_account,
            "had_previous_dataset": had_previous,
            "rollback_available": False,
        }
    except Exception:
        if transaction_open:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def upload_history(limit: int = 20):
    con = duckdb.connect(
        str(DB_PATH),
        config={
            "threads": DUCKDB_THREADS,
            "memory_limit": DUCKDB_MEMORY_LIMIT,
            "temp_directory": str(DUCKDB_TEMP_DIR),
        },
    )
    try:
        if not _table_exists(con, "upload_audit"):
            return {"events": [], "rollback_available": False}
        events = con.execute("""
            SELECT action, filename, previous_rows, current_rows, occurred_at, details
            FROM upload_audit
            ORDER BY occurred_at DESC
            LIMIT ?
        """, [limit]).fetchall()
        state_exists = _table_exists(con, "upload_state")
        rollback_available = False
        if state_exists:
            state = con.execute(
                "SELECT can_rollback FROM upload_state WHERE id = 1"
            ).fetchone()
            rollback_available = bool(state and state[0])
        return {
            "events": [
                {
                    "action": row[0],
                    "filename": row[1],
                    "previous_rows": row[2],
                    "current_rows": row[3],
                    "occurred_at": row[4].isoformat(sep=" ") if row[4] else "",
                    "details": row[5],
                }
                for row in events
            ],
            "rollback_available": rollback_available,
        }
    finally:
        con.close()
