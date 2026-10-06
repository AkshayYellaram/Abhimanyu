
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse

from app.api import (
    accounts,
    anomalies,
    ingestion,
    investigations,
    reports,
    risk,
)

app = FastAPI(
    title="Abhimanyu",
    version="0.1.0",
    description="Local financial-crime investigation and transaction tracing platform",
)

ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}

# Reject DNS-rebinding hosts and cross-site browser writes to this local-only API.
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "testserver"],
)

@app.middleware("http")
async def protect_local_api(request, call_next):
    origin = request.headers.get("origin")
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and origin is not None
        and origin not in ALLOWED_ORIGINS
    ):
        return JSONResponse(status_code=403, content={"detail": "Untrusted request origin."})

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response

# Allow the local React/Vite frontend to access the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Register API routers.
app.include_router(
    ingestion.router,
    prefix="/api/ingestion",
    tags=["Ingestion"],
)

# investigations.py already defines prefix="/investigations".
# Register it with /api only to avoid a duplicated prefix.
app.include_router(
    investigations.router,
    prefix="/api",
    tags=["Investigations"],
)

app.include_router(
    accounts.router,
    prefix="/api/accounts",
    tags=["Accounts"],
)

app.include_router(
    reports.router,
    prefix="/api/reports",
    tags=["Reports"],
)

app.include_router(
    anomalies.router,
    prefix="/api/anomalies",
    tags=["Anomalies"],
)

# Keep the existing risk endpoints.
app.include_router(
    risk.router,
    prefix="/api/investigations",
    tags=["Risk"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "abhimanyu",
    }
