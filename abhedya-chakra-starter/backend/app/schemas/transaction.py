from pydantic import BaseModel
from datetime import datetime

class Transaction(BaseModel):
    transaction_id: str
    sender_account: str
    receiver_account: str
    amount: float
    timestamp: datetime
    payment_mode: str | None = None
