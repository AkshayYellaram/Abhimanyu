import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("ABHEDYA_DATA_DIR", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
EXPORTS_DIR = DATA_DIR / "exports"
DB_PATH = Path(os.getenv("ABHEDYA_DB_PATH", PROCESSED_DIR / "abhedya.duckdb"))
DUCKDB_TEMP_DIR = Path(
    os.getenv("ABHEDYA_DUCKDB_TEMP_DIR", PROCESSED_DIR / "duckdb_tmp")
)
DUCKDB_MEMORY_LIMIT = os.getenv("ABHEDYA_DUCKDB_MEMORY_LIMIT", "12GB")
DUCKDB_THREADS = os.getenv("ABHEDYA_DUCKDB_THREADS", "4")
for directory in (RAW_DIR, PROCESSED_DIR, EXPORTS_DIR, DUCKDB_TEMP_DIR):
    directory.mkdir(parents=True, exist_ok=True)
