"""Measure local DuckDB ingestion and bounded trace latency."""

import argparse
import ctypes
import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

import duckdb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import DB_PATH  # noqa: E402
from app.services.normalize import normalize_sql  # noqa: E402


def peak_rss_bytes():
    if os.name == "nt":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        get_memory_info = psapi.GetProcessMemoryInfo
        get_memory_info.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        get_memory_info.restype = ctypes.c_int
        success = get_memory_info(
            kernel32.GetCurrentProcess(),
            ctypes.byref(counters),
            counters.cb,
        )
        if not success:
            raise ctypes.WinError(ctypes.get_last_error())
        return counters.PeakWorkingSetSize

    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak * (1024 if sys.platform != "darwin" else 1))


def total_memory_bytes():
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        global_memory_status = ctypes.WinDLL(
            "kernel32",
            use_last_error=True,
        ).GlobalMemoryStatusEx
        global_memory_status.argtypes = [ctypes.POINTER(MemoryStatus)]
        global_memory_status.restype = ctypes.c_int
        if not global_memory_status(ctypes.byref(status)):
            raise ctypes.WinError(ctypes.get_last_error())
        return status.ullTotalPhys

    return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")


def benchmark_ingestion(csv_path: Path, memory_limit: str):
    if not csv_path.is_file():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(
        prefix="abhedya-ingestion-benchmark-",
        dir=DB_PATH.parent,
    ) as temp_dir:
        database = Path(temp_dir) / "benchmark.duckdb"
        con = duckdb.connect(
            str(database),
            config={
                "threads": "4",
                "memory_limit": memory_limit,
                "temp_directory": str(Path(temp_dir) / "spill"),
            },
        )
        try:
            con.execute(
                "SELECT * FROM read_csv(?, header=true, all_varchar=true, sample_size=1000) LIMIT 0",
                [str(csv_path)],
            )
            con.execute(normalize_sql(), [str(csv_path.resolve())])
            con.execute("CREATE INDEX idx_sender ON transactions(sender_account)")
            con.execute("CREATE INDEX idx_receiver ON transactions(receiver_account)")
            con.execute("CREATE INDEX idx_timestamp ON transactions(timestamp)")
            rows = con.execute("SELECT count(*) FROM transactions").fetchone()[0]
            quality = con.execute(
                """
                SELECT count(*) FROM transactions
                WHERE transaction_id IS NULL OR sender_account IS NULL
                   OR receiver_account IS NULL OR amount IS NULL
                   OR timestamp IS NULL OR amount < 0
                """
            ).fetchone()[0]
            invalid_accounts = con.execute(
                """
                SELECT count(*) FROM transactions
                WHERE NOT regexp_matches(COALESCE(sender_account, ''), '^[A-Z0-9]{12}$')
                   OR NOT regexp_matches(COALESCE(receiver_account, ''), '^[A-Z0-9]{12}$')
                """
            ).fetchone()[0]
            invalid_ifs_codes = con.execute(
                """
                SELECT count(*) FROM transactions
                WHERE NOT regexp_matches(COALESCE(sender_ifsc, ''), '^[A-Z]{4}0[A-Z0-9]{6}$')
                   OR NOT regexp_matches(COALESCE(receiver_ifsc, ''), '^[A-Z]{4}0[A-Z0-9]{6}$')
                """
            ).fetchone()[0]
            unsupported_payment_modes = con.execute(
                """
                SELECT count(*) FROM transactions
                WHERE COALESCE(payment_mode, '') NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS')
                """
            ).fetchone()[0]
            invalid_ip_addresses = con.execute(
                """
                SELECT count(*) FROM transactions
                WHERE TRY_CAST(COALESCE(ip_address, '') AS INET) IS NULL
                """
            ).fetchone()[0]
            unique_accounts = con.execute(
                """
                SELECT count(*) FROM (
                    SELECT sender_account AS account FROM transactions
                    UNION
                    SELECT receiver_account AS account FROM transactions
                )
                """
            ).fetchone()[0]
        finally:
            con.close()

    elapsed = round(time.perf_counter() - started, 3)
    memory_bytes = total_memory_bytes()
    target_memory_bytes = 15 * 1024**3
    return {
        "csv": str(csv_path.resolve()),
        "rows": rows,
        "unique_accounts": unique_accounts,
        "invalid_core_rows": quality,
        "invalid_account_rows": invalid_accounts,
        "invalid_ifsc_rows": invalid_ifs_codes,
        "unsupported_payment_mode_rows": unsupported_payment_modes,
        "invalid_ip_rows": invalid_ip_addresses,
        "elapsed_seconds": elapsed,
        "peak_working_set_bytes_process": peak_rss_bytes(),
        "system_memory_bytes": memory_bytes,
        "memory_limit": memory_limit,
        "passes_60_second_target": elapsed <= 60,
        "passes_16_gb_hardware_target": memory_bytes >= target_memory_bytes,
        "passes_ingestion_targets": (
            rows >= 2_000_000
            and elapsed <= 60
            and memory_bytes >= target_memory_bytes
        ),
    }


def benchmark_traces(
    accounts: list[str],
    limit: int,
    random_samples: int,
    seed: int,
):
    from app.services.graph_trace import trace_money
    from app.services.account_index import account_summary
    from app.services.db import connect, require_data

    requested = list(dict.fromkeys(accounts))
    if random_samples:
        con = connect()
        try:
            require_data(con)
            all_accounts = [
                row[0]
                for row in con.execute(
                    """
                    SELECT account FROM (
                        SELECT sender_account AS account FROM transactions
                        UNION
                        SELECT receiver_account AS account FROM transactions
                    )
                    """
                ).fetchall()
            ]
        finally:
            con.close()

        sample_count = min(random_samples, len(all_accounts))
        random_accounts = random.Random(seed).sample(all_accounts, sample_count)
        requested.extend(
            account for account in random_accounts if account not in requested
        )

    results = []
    for account in requested:
        summary_started = time.perf_counter()
        summary = account_summary(account)
        summary_seconds = time.perf_counter() - summary_started
        started = time.perf_counter()
        trace = trace_money(account, max_hops=4, limit=limit)
        trace_seconds = time.perf_counter() - started
        results.append({
            "account_id": account,
            "account_found": summary is not None,
            "account_summary_seconds": round(summary_seconds, 3),
            "elapsed_seconds": round(trace_seconds, 3),
            "transactions": trace["transaction_count"],
            "accounts": len(trace["accounts"]),
            "hops_returned": sorted({
                transaction["hop"] for transaction in trace["transactions"]
            }),
            "truncated": trace["truncated"],
            "passes_complete_trace_latency_target": (
                summary is not None
                and not trace["truncated"]
                and trace_seconds <= 2
            ),
        })
    latencies = sorted(row["elapsed_seconds"] for row in results)
    return {
        "sampled_account_count": len(results),
        "median_trace_seconds": (
            latencies[len(latencies) // 2] if latencies else None
        ),
        "max_trace_seconds": max(latencies, default=None),
        "traces_over_two_seconds": sum(value > 2 for value in latencies),
        "truncated_trace_count": sum(row["truncated"] for row in results),
        "complete_traces_under_two_seconds": sum(
            row["passes_complete_trace_latency_target"] for row in results
        ),
        "all_sampled_traces_pass_complete_latency_target": bool(results) and all(
            row["passes_complete_trace_latency_target"] for row in results
        ),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        help="Also benchmark full streaming ingestion into a temporary database.",
    )
    parser.add_argument("--memory-limit", default="12GB")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--random-samples", type=int, default=5)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument(
        "--accounts",
        nargs="+",
        default=[
            "ICIC10000335",
            "PYTM10007595",
            "AXIS10004807",
            "PUNB10009473",
            "ICIC10011317",
        ],
    )
    args = parser.parse_args()

    report = {
        "trace_benchmarks": benchmark_traces(
            args.accounts,
            args.limit,
            args.random_samples,
            args.seed,
        ),
    }
    if args.csv:
        report["ingestion_benchmark"] = benchmark_ingestion(
            args.csv,
            args.memory_limit,
        )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
