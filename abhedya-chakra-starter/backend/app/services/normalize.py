
REQUIRED_COLUMNS = [
    "Transaction_ID",
    "Sender_Account",
    "Receiver_Account",
    "Sender_IFSC",
    "Receiver_IFSC",
    "Amount",
    "Timestamp",
    "Payment_Mode",
    "Narration",
    "IP_Address",
    "Device_Type",
]


def normalize_sql():
    """Normalize CSV transactions into the DuckDB transactions table."""

    return """
    CREATE OR REPLACE TABLE transactions AS
    SELECT
        trim(CAST(Transaction_ID AS VARCHAR)) AS transaction_id,
        trim(CAST(Sender_Account AS VARCHAR)) AS sender_account,
        trim(CAST(Receiver_Account AS VARCHAR)) AS receiver_account,
        upper(trim(CAST(Sender_IFSC AS VARCHAR))) AS sender_ifsc,
        upper(trim(CAST(Receiver_IFSC AS VARCHAR))) AS receiver_ifsc,
        TRY_CAST(NULLIF(trim(Amount), '') AS DOUBLE) AS amount,
        TRY_CAST(NULLIF(trim(Timestamp), '') AS TIMESTAMP) AS timestamp,
        upper(trim(CAST(Payment_Mode AS VARCHAR))) AS payment_mode,
        CAST(Narration AS VARCHAR) AS narration,
        trim(CAST(IP_Address AS VARCHAR)) AS ip_address,
        trim(CAST(Device_Type AS VARCHAR)) AS device_type
    FROM read_csv(
        ?,
        header = true,
        all_varchar = true,
        ignore_errors = false
    )
    """