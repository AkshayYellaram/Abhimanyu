from app.services.db import connect, require_data

def search_accounts(query: str, limit: int = 20):
    con = connect()
    try:
        require_data(con)
        pattern = f"%{query.strip()}%"
        rows = con.execute("""
            SELECT account, count(*) AS transaction_count
            FROM (
              SELECT sender_account AS account FROM transactions WHERE sender_account LIKE ?
              UNION ALL
              SELECT receiver_account AS account FROM transactions WHERE receiver_account LIKE ?
            )
            GROUP BY account ORDER BY transaction_count DESC LIMIT ?
        """, [pattern, pattern, limit]).fetchall()
        return [{"account_id": r[0], "transaction_count": r[1]} for r in rows]
    finally:
        con.close()

def account_summary(account_id: str):
    con = connect()
    try:
        require_data(con)
        row = con.execute("""
          SELECT
            (SELECT count(*) FROM transactions WHERE sender_account = ? OR receiver_account = ?) AS count,
            (SELECT coalesce(sum(amount), 0) FROM transactions WHERE receiver_account = ?) AS inflow,
            (SELECT coalesce(sum(amount), 0) FROM transactions WHERE sender_account = ?) AS outflow,
            (SELECT count(DISTINCT sender_account) FROM transactions WHERE receiver_account = ?) AS senders,
            (SELECT count(DISTINCT receiver_account) FROM transactions WHERE sender_account = ?) AS receivers
        """, [account_id, account_id, account_id, account_id, account_id, account_id]).fetchone()
        exists = con.execute("""
            SELECT 1 FROM transactions WHERE sender_account = ?
            UNION ALL SELECT 1 FROM transactions WHERE receiver_account = ? LIMIT 1
        """, [account_id, account_id]).fetchone()
        if not exists:
            return None
        return {"account_id": account_id, "transaction_count": row[0],
                "total_inflow": row[1], "total_outflow": row[2],
                "distinct_senders": row[3], "distinct_receivers": row[4]}
    finally:
        con.close()
