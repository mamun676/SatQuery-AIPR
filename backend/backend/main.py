"""SatQuery AI — FastAPI application entrypoint.

This is the reference Python implementation of the SatQuery AI architecture
described in the project's master development prompt. The system actually
deployed/validated in this sandbox is the Next.js port under `src/` (the
platform here only builds/runs a single Next.js + PostgreSQL app), but this
backend/ tree is a complete, runnable-on-your-own-infrastructure FastAPI
implementation of the same architecture: validator -> query understanding ->
agentic controller -> registry -> tools -> models -> GIS -> evidence ->
synthesis -> trace -> report.

Run locally with:
    pip install -r backend/requirements.txt
    uvicorn backend.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import router as api_router

app = FastAPI(
    title="SatQuery AI",
    description="Agentic remote-sensing AI backend.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "service": "satquery-ai-backend"}
