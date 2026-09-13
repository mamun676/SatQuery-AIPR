"""VRSBench evaluation entrypoint (evaluation/vrsbench_eval.py).

Requires the VRSBench test subset placed at datasets/vrsbench_test/index.json
(schema: [{"id", "image", "question", "answer", "task"}]).
"""
from __future__ import annotations

from evaluation.benchmark_runner import run_benchmark, EvalSample
from backend.tools.vqa_tool import run_vqa


def _predictor(sample: EvalSample) -> str:
    result = run_vqa(sample.image_path, sample.question or "", target=None, band_stats={})
    return result.get("answer", "")


def main() -> None:
    result = run_benchmark("VRSBench", "vqa_and_caption", "datasets/vrsbench_test", _predictor)
    print(result.to_dict())


if __name__ == "__main__":
    main()
