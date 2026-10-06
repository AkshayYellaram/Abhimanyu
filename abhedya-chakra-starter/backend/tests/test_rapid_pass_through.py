from datetime import datetime, timedelta

from app.api.risk import calculate_rapid_pass_through


def test_rapid_pass_through_requires_matched_outgoing_amount():
    received = datetime(2026, 1, 1, 10, 0)

    matched, incoming_total, matched_count = calculate_rapid_pass_through(
        [(received, 100)],
        [(received + timedelta(minutes=4), 1)],
    )

    assert matched == 0
    assert incoming_total == 100
    assert matched_count == 0


def test_rapid_pass_through_uses_inclusive_three_to_fifteen_minute_window():
    received = datetime(2026, 1, 1, 10, 0)

    matched, _, _ = calculate_rapid_pass_through(
        [(received, 100)],
        [
            (received + timedelta(minutes=2, seconds=59), 100),
            (received + timedelta(minutes=3), 30, "T1"),
            (received + timedelta(minutes=15), 70, "T2"),
            (received + timedelta(minutes=15, seconds=1), 100),
        ],
    )

    assert matched == 100


def test_rapid_pass_through_does_not_reuse_outflow_for_overlapping_inflows():
    first_received = datetime(2026, 1, 1, 10, 0)
    second_received = first_received + timedelta(minutes=10)

    matched, incoming_total, _ = calculate_rapid_pass_through(
        [(first_received, 100), (second_received, 100)],
        [(first_received + timedelta(minutes=13), 50, "T1"),
         (first_received + timedelta(minutes=14), 50, "T2")],
    )

    assert matched == 100
    assert incoming_total == 200
    assert matched / incoming_total == 0.5


def test_rapid_pass_through_requires_multiple_outgoing_transactions_per_inflow():
    received = datetime(2026, 1, 1, 10, 0)

    matched, _, _ = calculate_rapid_pass_through(
        [(received, 100)],
        [
            (received + timedelta(minutes=4), 90, "T1"),
            (received + timedelta(minutes=5), 10, "T2"),
        ],
    )

    assert matched == 100
