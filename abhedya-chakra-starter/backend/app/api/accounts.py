from fastapi import APIRouter, HTTPException, Query
from app.services.account_index import search_accounts, account_summary

router = APIRouter()

@router.get("/search")
def search(q: str = Query(min_length=3), limit: int = Query(default=20, ge=1, le=100)):
    try:
        return {"results": search_accounts(q, limit)}
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@router.get("/{account_id}")
def get_account(account_id: str):
    try:
        result = account_summary(account_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Account not found")
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
