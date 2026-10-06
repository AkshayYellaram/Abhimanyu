
from app.services.db import connect, require_data


def analyze_accounts(account_ids: list[str]) -> list[dict]:
    """
    Calculate preliminary, explainable mule-risk indicators.
    Scores are investigative leads, not proof of criminal activity.
    """
    results = []

    con = connect()
    try:
        require_data(con)

        for account_id in account_ids:
            row = con.execute(
                """
                WITH account_stats AS (
                    SELECT
                        COUNT(DISTINCT CASE
                            WHEN "Receiver_Account" = ?
                            THEN "Sender_Account"
                        END) AS distinct_senders,

                        COUNT(DISTINCT CASE
                            WHEN "Sender_Account" = ?
                            THEN "Receiver_Account"
                        END) AS distinct_receivers,

                        COALESCE(SUM(CASE
                            WHEN "Receiver_Account" = ?
                            THEN TRY_CAST("Amount" AS DOUBLE)
                            ELSE 0
                        END), 0) AS incoming_amount,

                        COALESCE(SUM(CASE
                            WHEN "Sender_Account" = ?
                            THEN TRY_CAST("Amount" AS DOUBLE)
                            ELSE 0
                        END), 0) AS outgoing_amount

                    FROM transactions
                    WHERE "Sender_Account" = ?
                       OR "Receiver_Account" = ?
                ),
                terminal_stats AS (
                    SELECT COUNT(*) AS indicators
                    FROM transactions
                    WHERE "Sender_Account" = ?
                      AND (
                          regexp_matches(
                              COALESCE("Narration", ''),
                              '(CRYPTO|P2P|CASH.?OUT|ATM|WALLET|OFFSHORE)',
                              'i'
                          )
                          OR lower(COALESCE("Device_Type", ''))
                             IN ('web_emulator', 'linux_script')
                          OR regexp_matches(
                              COALESCE("IP_Address", ''),
                              '^(185|194)\\.'
                          )
                      )
                )
                SELECT
                    a.distinct_senders,
                    a.distinct_receivers,
                    a.incoming_amount,
                    a.outgoing_amount,
                    t.indicators
                FROM account_stats a
                CROSS JOIN terminal_stats t
                """,
                [
                    account_id,
                    account_id,
                    account_id,
                    account_id,
                    account_id,
                    account_id,
                    account_id,
                ],
            ).fetchone()

            if row is None:
                results.append({
                    "account_id": account_id,
                    "risk_score": 0,
                    "risk_level": "unknown",
                    "suspected_layer": "Unclassified",
                    "reasons": ["No account statistics available."],
                })
                continue

            senders = int(row[0] or 0)
            receivers = int(row[1] or 0)
            incoming = float(row[2] or 0)
            outgoing = float(row[3] or 0)
            terminal_indicators = int(row[4] or 0)

            score = 0
            reasons = []

            if senders >= 5:
                score += 25
                reasons.append(
                    f"High fan-in: {senders} distinct sending accounts."
                )

            if 3 <= receivers <= 7:
                score += 20
                reasons.append(
                    f"Distributor-like fan-out: {receivers} distinct receivers."
                )

            if terminal_indicators > 0:
                score += 15
                reasons.append(
                    f"{terminal_indicators} outgoing transaction(s) "
                    "contain terminal-risk indicators."
                )

            # Aggregate ratio is a weak signal, not matched fund tracing.
            if incoming > 0 and outgoing / incoming >= 0.90:
                score += 10
                reasons.append(
                    "Outgoing value is at least 90% of incoming value."
                )

            if not reasons:
                reasons.append(
                    "No configured risk indicators were triggered."
                )

            if senders >= 5 and senders > receivers:
                layer = "L1"
                layer_name = "Collector-like"
            elif 3 <= receivers <= 7:
                layer = "L2"
                layer_name = "Distributor-like"
            elif terminal_indicators > 0:
                layer = "L3"
                layer_name = "Potential terminal / cash-out"
            else:
                layer = "Unclassified"
                layer_name = "Insufficient indicators"

            score = min(100, score)

            results.append({
                "account_id": account_id,
                "risk_score": score,
                "risk_level": (
                    "high" if score >= 70
                    else "medium" if score >= 40
                    else "low"
                ),
                "suspected_layer": layer,
                "layer_name": layer_name,
                "reasons": reasons,
                "features": {
                    "distinct_senders": senders,
                    "distinct_receivers": receivers,
                    "incoming_amount": round(incoming, 2),
                    "outgoing_amount": round(outgoing, 2),
                    "terminal_indicators": terminal_indicators,
                },
                "disclaimer": (
                    "Preliminary heuristic investigative lead only; "
                    "this score does not establish criminal activity."
                ),
            })

    finally:
        con.close()

    return results
