import duckdb

from app.api.risk import find_bounded_cycle


def cycle_connection(tmp_path, edges):
    con = duckdb.connect(str(tmp_path / "cycle_test.duckdb"))
    con.execute("""
        CREATE TABLE transactions (
            sender_account VARCHAR,
            receiver_account VARCHAR
        )
    """)
    con.executemany(
        "INSERT INTO transactions VALUES (?, ?)",
        edges,
    )
    return con


def test_finds_four_hop_directed_cycle_starting_at_account(tmp_path):
    con = cycle_connection(
        tmp_path,
        [
            ("A", "B"),
            ("B", "C"),
            ("C", "D"),
            ("D", "A"),
        ],
    )
    try:
        assert find_bounded_cycle(con, "A") == (True, True)
    finally:
        con.close()


def test_does_not_flag_a_non_cyclic_chain(tmp_path):
    con = cycle_connection(
        tmp_path,
        [
            ("A", "B"),
            ("B", "C"),
            ("C", "D"),
        ],
    )
    try:
        assert find_bounded_cycle(con, "A") == (False, True)
    finally:
        con.close()


def test_cycle_search_reports_when_scan_is_truncated(tmp_path):
    con = cycle_connection(
        tmp_path,
        [
            ("A", "B"),
            ("A", "C"),
            ("B", "D"),
            ("C", "A"),
        ],
    )
    try:
        detected, complete = find_bounded_cycle(con, "A", edge_limit=1)
        assert not detected
        assert not complete
    finally:
        con.close()
