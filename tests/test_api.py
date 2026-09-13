"""API endpoint tests using FastAPI's TestClient (pytest)."""
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_upload_requires_files():
    resp = client.post("/api/upload", files={})
    assert resp.status_code in (400, 422)


def test_upload_and_analyze_round_trip():
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    resp = client.post("/api/upload", files={"files": ("scene.png", png_bytes, "image/png")})
    assert resp.status_code == 200
    upload_id = resp.json()["upload_id"]

    analyze_resp = client.post("/api/analyze", json={"upload_id": upload_id, "query": "Describe this image."})
    assert analyze_resp.status_code == 200
    job_id = analyze_resp.json()["job_id"]

    status_resp = client.get(f"/api/status/{job_id}")
    assert status_resp.status_code == 200

    result_resp = client.get(f"/api/result/{job_id}")
    assert result_resp.status_code == 200


def test_status_missing_job_returns_404():
    resp = client.get("/api/status/does-not-exist")
    assert resp.status_code == 404
