"""CDVQA (Change-Detection VQA) evaluation entrypoint (evaluation/cdvqa_eval.py).

Requires the CDVQA test subset placed at datasets/cdvqa_test/index.json
(schema additionally expects "image_t1"/"image_t2" per sample).
"""
from __future__ import annotations

import json
import os

from evaluation.benchmark_runner import BenchmarkResult, EvalRecord


def main() -> None:
    dataset_dir = "datasets/cdvqa_test"
    index_path = os.path.join(dataset_dir, "index.json")
    if not os.path.exists(index_path):
        result = BenchmarkResult(
            benchmark="CDVQA",
            task="change_vqa",
            sample_count=0,
            evaluated_count=0,
            accuracy=None,
            records=[EvalRecord("n/a", "change_vqa", None, "", None, error=f"No dataset found at {index_path}. TODO: place CDVQA subset here.")],
        )
        print(result.to_dict())
        return

    with open(index_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    from backend.tools.change_tool import run_change
    import numpy as np

    records = []
    correct = 0
    for i, r in enumerate(raw):
        try:
            out = run_change(
                os.path.join(dataset_dir, r["image_t1"]),
                os.path.join(dataset_dir, r["image_t2"]),
                r.get("question", ""),
                r.get("target"),
                np.zeros((1, 1)),
                np.zeros((1, 1)),
                res={},
            )
            predicted = out.get("answer", "")
            is_correct = r.get("answer", "").strip().lower() in predicted.strip().lower()
            records.append(EvalRecord(str(r.get("id", i)), "change_vqa", predicted, r.get("answer", ""), is_correct))
            correct += int(is_correct)
        except Exception as exc:  # noqa: BLE001
            records.append(EvalRecord(str(r.get("id", i)), "change_vqa", None, r.get("answer", ""), None, error=str(exc)))

    evaluated = sum(1 for rec in records if rec.error is None)
    result = BenchmarkResult("CDVQA", "change_vqa", len(raw), evaluated, correct / evaluated if evaluated else None, records)
    print(result.to_dict())


if __name__ == "__main__":
    main()
