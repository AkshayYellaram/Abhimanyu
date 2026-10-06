import duckdb
from app.config import (
    DB_PATH,
    DUCKDB_MEMORY_LIMIT,
    DUCKDB_TEMP_DIR,
    DUCKDB_THREADS,
)

def connect():
    return duckdb.connect(
        str(DB_PATH),
        config={
            "threads": DUCKDB_THREADS,
            "memory_limit": DUCKDB_MEMORY_LIMIT,
            "temp_directory": str(DUCKDB_TEMP_DIR),
        },
    )

def require_data(con):
    exists = con.execute("""
        SELECT count(*) FROM information_schema.tables
        WHERE table_name = 'transactions'
    """).fetchone()[0]
    if not exists:
        con.close()
        raise RuntimeError("No dataset loaded. POST /api/ingestion/csv first.")
