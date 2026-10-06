import csv
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.services.ingest import ingest_csv, rollback_last_upload, upload_history
from app.services.normalize import REQUIRED_COLUMNS

router = APIRouter()
MAX_CSV_ROWS = 2_000_000
MAX_CSV_COLUMNS = 64
MAX_CSV_FIELD_CHARS = 1_000_000
csv.field_size_limit(MAX_CSV_FIELD_CHARS)


def _validate_uploaded_csv(path: Path) -> None:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.reader(csv_file, strict=True)
            header = next(reader, None)
            if not header:
                raise ValueError("The selected CSV file has no header.")
            if len(header) > MAX_CSV_COLUMNS:
                raise ValueError(f"CSV files may contain at most {MAX_CSV_COLUMNS} columns.")
            if len(set(header)) != len(header):
                raise ValueError("CSV column names must be unique.")

            missing = [column for column in REQUIRED_COLUMNS if column not in header]
            if missing:
                raise ValueError(f"CSV is missing required columns: {missing}")

            row_count = 0
            for row in reader:
                if not row:
                    continue
                if len(row) != len(header):
                    raise ValueError(
                        f"CSV row {reader.line_num} has {len(row)} fields; "
                        f"expected {len(header)}."
                    )
                if any("\x00" in value for value in row):
                    raise ValueError(f"CSV row {reader.line_num} contains a null byte.")
                row_count += 1
                if row_count > MAX_CSV_ROWS:
                    raise ValueError(f"CSV files may contain at most {MAX_CSV_ROWS} rows.")
    except (csv.Error, UnicodeDecodeError) as exc:
        raise ValueError(f"CSV is malformed or is not valid UTF-8: {exc}") from exc


@router.get("/history")
def get_upload_history():
    try:
        return upload_history()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read upload audit history: {exc}") from exc


@router.post("/rollback")
def rollback_upload():
    try:
        return rollback_last_upload()
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not roll back CSV upload: {exc}") from exc


@router.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() != ".csv":
        raise HTTPException(status_code=400, detail="Upload a file with a .csv extension.")

    total_bytes = 0
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="abhimanyu-upload-",
            suffix=".csv",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                temp_file.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The selected CSV file is empty.")

        _validate_uploaded_csv(temp_path)
        result = await run_in_threadpool(
            lambda: ingest_csv(str(temp_path), upload_filename=filename)
        )
        result["filename"] = filename
        return result
    except HTTPException:
        raise
    except (ValueError, FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
