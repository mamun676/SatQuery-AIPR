"""Validator + query-router tests (pytest)."""
import pytest

from backend.validator.input_validator import validate_files, RawUploadFile
from backend.query_understanding.router import classify_intent

PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_valid_png_single_image():
    files = [RawUploadFile(original_name="scene.png", content=PNG_MAGIC, role="single")]
    metas, validation = validate_files(files)
    assert validation["files"] == 1
    assert validation["mode"] == "single_image"


def test_invalid_extension_unknown_format():
    files = [RawUploadFile(original_name="scene.xyz", content=b"not-a-real-raster", role="single")]
    metas, validation = validate_files(files)
    assert validation["valid"] is False
    assert any("unsupported" in e for e in validation["errors"])


def test_too_many_files_rejected():
    files = [RawUploadFile(original_name=f"scene{i}.png", content=PNG_MAGIC, role="single") for i in range(3)]
    _, validation = validate_files(files)
    assert validation["valid"] is False


def test_bitemporal_pair_mode_detected():
    files = [
        RawUploadFile(original_name="t1.png", content=PNG_MAGIC, role="t1"),
        RawUploadFile(original_name="t2.png", content=PNG_MAGIC, role="t2"),
    ]
    _, validation = validate_files(files)
    assert validation["mode"] == "bitemporal"


@pytest.mark.parametrize(
    "query,mode,expected_task",
    [
        ("Is there a water body?", "single_image", "vqa"),
        ("Describe this image.", "single_image", "caption"),
        ("What changed between these two dates?", "bitemporal", "change_vqa"),
        ("Use optical and SAR together to identify water.", "optical_sar", "optical_sar"),
        ("Locate the built-up areas.", "single_image", "grounding"),
    ],
)
def test_query_router_tasks(query, mode, expected_task):
    intent = classify_intent(query, mode)
    assert intent.task == expected_task


def test_query_router_coerces_invalid_task_for_mode():
    intent = classify_intent("What changed?", "single_image")
    assert intent.task == "vqa"
    assert intent.coerced is True
