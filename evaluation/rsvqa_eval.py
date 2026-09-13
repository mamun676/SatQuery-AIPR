"""RSVQA evaluation entrypoint (evaluation/rsvqa_eval.py).

Requires the RSVQA test subset placed at datasets/rsvqa_test/index.json.
"""
from __future__ import annotations

from evaluation.benchmark_runner import run_benchmark, EvalSample
from backend.tools.vqa_tool import run_vqa


def _predictor(sample: EvalSample) -> str:
    result = run_vqa(sample.image_path, sample.question or "", target=None, band_stats={})
    return result.get("answer", "")


def main() -> None:
    result = run_benchmark("RSVQA", "vqa", "datasets/rsvqa_test", _predictor)
    print(result.to_dict())


if __name__ == "__main__":
    main()
