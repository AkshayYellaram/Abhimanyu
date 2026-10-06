from pathlib import Path
import duckdb

DB_PATH = Path("data/processed/abhedya.duckdb")
OUTPUT_PATH = Path("data/processed/account_features.parquet")

if not DB_PATH.exists():
    raise FileNotFoundError(f"Database not found: {DB_PATH}")

if OUTPUT_PATH.exists():
    raise FileExistsError(
        f"{OUTPUT_PATH} already exists. Rename it before rebuilding."
    )

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

db = duckdb.connect(str(DB_PATH), read_only=True)

query = """
WITH outgoing AS (
    SELECT
        sender_account AS account_id,
        COUNT(*) AS outgoing_count,
        SUM(amount) AS outgoing_amount,
        AVG(amount) AS avg_outgoing_amount,
        MAX(amount) AS max_outgoing_amount,
        COUNT(DISTINCT receiver_account) AS distinct_receivers,
        SUM(
            CASE WHEN
                regexp_matches(
                    COALESCE(narration, ''),
                    '(?i)(CRYPTO|P2P|CASH.?OUT|ATM|WALLET|OFFSHORE)'
                )
                OR lower(COALESCE(device_type, '')) IN
                    ('web_emulator', 'linux_script')
                OR starts_with(COALESCE(ip_address, ''), '185.')
                OR starts_with(COALESCE(ip_address, ''), '194.')
            THEN 1 ELSE 0 END
        ) AS terminal_indicators
    FROM transactions
    GROUP BY sender_account
),
incoming AS (
    SELECT
        receiver_account AS account_id,
        COUNT(*) AS incoming_count,
        SUM(amount) AS incoming_amount,
        AVG(amount) AS avg_incoming_amount,
        MAX(amount) AS max_incoming_amount,
        COUNT(DISTINCT sender_account) AS distinct_senders
    FROM transactions
    GROUP BY receiver_account
),
activity AS (
    SELECT account_id,
           MIN(timestamp) AS first_seen,
           MAX(timestamp) AS last_seen
    FROM (
        SELECT sender_account AS account_id, timestamp
        FROM transactions
        UNION ALL
        SELECT receiver_account AS account_id, timestamp
        FROM transactions
    ) events
    GROUP BY account_id
),
accounts AS (
    SELECT account_id FROM outgoing
    UNION
    SELECT account_id FROM incoming
)
SELECT
    a.account_id,
    COALESCE(i.incoming_count, 0) AS incoming_count,
    COALESCE(o.outgoing_count, 0) AS outgoing_count,
    COALESCE(i.incoming_amount, 0) AS incoming_amount,
    COALESCE(o.outgoing_amount, 0) AS outgoing_amount,
    COALESCE(i.avg_incoming_amount, 0) AS avg_incoming_amount,
    COALESCE(o.avg_outgoing_amount, 0) AS avg_outgoing_amount,
    COALESCE(i.max_incoming_amount, 0) AS max_incoming_amount,
    COALESCE(o.max_outgoing_amount, 0) AS max_outgoing_amount,
    COALESCE(i.distinct_senders, 0) AS distinct_senders,
    COALESCE(o.distinct_receivers, 0) AS distinct_receivers,
    COALESCE(o.terminal_indicators, 0) AS terminal_indicators,
    COALESCE(o.terminal_indicators, 0)::DOUBLE
        / NULLIF(COALESCE(o.outgoing_count, 0), 0)
        AS terminal_indicator_ratio,
    COALESCE(o.outgoing_amount, 0)
        / NULLIF(COALESCE(i.incoming_amount, 0), 0)
        AS outgoing_to_incoming_amount_ratio,
    act.first_seen,
    act.last_seen,
    date_diff('second', act.first_seen, act.last_seen)
        AS activity_duration_seconds
FROM accounts a
LEFT JOIN incoming i USING (account_id)
LEFT JOIN outgoing o USING (account_id)
LEFT JOIN activity act USING (account_id)
"""

try:
    db.execute(
        "COPY (" + query + ") TO '"
        + OUTPUT_PATH.as_posix()
        + "' (FORMAT PARQUET, COMPRESSION ZSTD)"
    )

    count = db.execute(
        "SELECT COUNT(*) FROM read_parquet(?)",
        [str(OUTPUT_PATH)]
    ).fetchone()[0]

    print("\nFEATURE BUILD SUCCESSFUL")
    print("Output:", OUTPUT_PATH.resolve())
    print("Account rows:", count)

    print("\nSample rows:")
    print(
        db.execute(
            "SELECT * FROM read_parquet(?) LIMIT 5",
            [str(OUTPUT_PATH)]
        ).df().to_string(index=False)
    )
finally:
    db.close()

