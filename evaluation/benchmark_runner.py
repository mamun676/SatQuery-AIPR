"""Shared benchmark-runner core (evaluation/benchmark_runner.py).

Used by vrsbench_eval.py, rsvqa_eval.py, cdvqa_eval.py so the evaluation
framework is modular and consistent. Never fabricates results: if a dataset
or model endpoint is missing, the runner reports a clear error/TODO status
per sample instead of pretending evaluation succeeded.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class EvalSample:
    sample_id: str
    task: str
    image_path: str
    question: Optional[str]
    reference: str


@dataclass
class EvalRecord:
    sample_id: str
    task: str
    predicted: Optional[str]
    reference: str
    correct: Optional[bool]
    error: Optional[str] = None


@dataclass
class BenchmarkResult:
    benchmark: str
    task: str
    sample_count: int
    evaluated_count: int
    accuracy: Optional[float]
    records: list[EvalRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "benchmark": self.benchmark,
            "task": self.task,
            "sample_count": self.sample_count,
            "evaluated_count": self.evaluated_count,
            "accuracy": self.accuracy,
            "records": [r.__dict__ for r in self.records],
        }


def load_samples(dataset_dir: str, index_filename: str = "index.json") -> list[EvalSample]:
    index_path = os.path.join(dataset_dir, index_filename)
    if not os.path.exists(index_path):
        return []
    with open(index_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return [
        EvalSample(
            sample_id=str(r.get("id", i)),
            task=r.get("task", "vqa"),
            image_path=os.path.join(dataset_dir, r["image"]),
            question=r.get("question"),
            reference=r.get("answer", r.get("reference", "")),
        )
        for i, r in enumerate(raw)
    ]


def run_benchmark(benchmark_name: str, task: str, dataset_dir: str, predictor: Callable[[EvalSample], str]) -> BenchmarkResult:
    samples = load_samples(dataset_dir)
    if not samples:
        return BenchmarkResult(
            benchmark=benchmark_name,
            task=task,
            sample_count=0,
            evaluated_count=0,
            accuracy=None,
            records=[
                EvalRecord(
                    sample_id="n/a",
                    task=task,
                    predicted=None,
                    reference="",
                    correct=None,
                    error=(
                        f"No dataset found at {dataset_dir}/index.json. "
                        "TODO: place the real benchmark subset here before running evaluation. "
                        "This result intentionally reports 0 evaluated samples rather than fabricating a score."
                    ),
                )
            ],
        )

    records: list[EvalRecord] = []
    correct_count = 0
    evaluated = 0
    for sample in samples:
        try:
            predicted = predictor(sample)
            is_correct = predicted.strip().lower() == sample.reference.strip().lower()
            records.append(EvalRecord(sample.sample_id, sample.task, predicted, sample.reference, is_correct))
            evaluated += 1
            correct_count += int(is_correct)
        except Exception as exc:  # noqa: BLE001
            records.append(EvalRecord(sample.sample_id, sample.task, None, sample.reference, None, error=str(exc)))

    accuracy = correct_count / evaluated if evaluated > 0 else None
    return BenchmarkResult(benchmark=benchmark_name, task=task, sample_count=len(samples), evaluated_count=evaluated, accuracy=accuracy, records=records)
