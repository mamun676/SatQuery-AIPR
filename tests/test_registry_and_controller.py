"""Registry + controller tests (pytest)."""
from backend.agent.registry import load_registry, resolve_model


def test_registry_loads_all_tasks():
    registry = load_registry()
    for task in ("vqa", "caption", "grounding", "change_vqa", "optical_sar"):
        assert task in registry


def test_registry_fallback_resolution():
    registry = load_registry()
    entry = registry["change_vqa"]
    assert entry.primary_name == "qwen3_vl_8b"
    assert entry.fallback_name == "pixel_change_detector"


def test_registry_missing_task_raises_keyerror():
    registry = load_registry()
    try:
        _ = registry["not_a_real_task"]
        assert False, "expected KeyError"
    except KeyError:
        pass


def test_resolve_model_unknown_name_returns_none():
    assert resolve_model("does_not_exist") is None


def test_resolve_model_rscovlm_unavailable_without_endpoint(monkeypatch):
    monkeypatch.delenv("RSCOVLM_ENDPOINT", raising=False)
    model = resolve_model("rscovlm_7b_lora")
    assert model is not None
    health = model.health_check()
    assert health["available"] is False
