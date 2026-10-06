from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.graph_trace import trace_money
from app.services.local_ai import add_local_summary
from app.services.report_generator import generate_case_report

router = APIRouter()

class ReportRequest(BaseModel):
    victim_account: str
    max_hops: int = Field(default=4, ge=1, le=5)

@router.post("/case-diary")
def case_diary(request: ReportRequest):
    try:
        trace = trace_money(request.victim_account, max_hops=request.max_hops, limit=10000)
        report = generate_case_report(trace["victim_account"], trace)
        return add_local_summary(report)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
