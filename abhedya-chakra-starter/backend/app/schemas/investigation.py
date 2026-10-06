from pydantic import BaseModel, Field

class TraceRequest(BaseModel):
    victim_account: str = Field(min_length=1)
    max_hops: int = Field(default=4, ge=1, le=5)

