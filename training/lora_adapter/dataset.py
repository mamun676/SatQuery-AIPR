"""BigEarthNet-subset dataset loader for LoRA/PEFT adaptation
(training/lora_adapter/dataset.py).

Supports a small smoke-test subset first; the same interface scales to the
full dataset later by pointing `root_dir` at a larger BigEarthNet mirror.

INTEGRATION BOUNDARY: expects image/label pairs under `datasets/bigearthnet_subset/`.
If the dataset is not present, `__len__` returns 0 and a clear warning is
logged rather than fabricating samples.
"""
from __future__ import annotations

import json
import os
import warnings
from dataclasses import dataclass
from typing import Optional


@dataclass
class Sample:
    image_path: str
    caption: str
    labels: list[str]


class BigEarthNetSubset:
    """Minimal dataset wrapper. Expects `root_dir/index.json` with entries:
    [{"image": "tile_0001.tif", "caption": "...", "labels": ["water", ...]}, ...]
    """

    def __init__(self, root_dir: str, split: str = "train", val_fraction: float = 0.2):
        self.root_dir = root_dir
        self.split = split
        index_path = os.path.join(root_dir, "index.json")
        if not os.path.exists(index_path):
            warnings.warn(
                f"BigEarthNet subset index not found at {index_path}. "
                "This is expected until a real dataset subset is downloaded/placed here; "
                "the training pipeline will run in smoke-test mode with 0 samples."
            )
            self._samples: list[Sample] = []
            return

        with open(index_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        samples = [Sample(image_path=os.path.join(root_dir, r["image"]), caption=r.get("caption", ""), labels=r.get("labels", [])) for r in raw]

        split_idx = int(len(samples) * (1 - val_fraction))
        self._samples = samples[:split_idx] if split == "train" else samples[split_idx:]

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> Sample:
        return self._samples[idx]

    def preprocess(self, sample: Sample, processor: Optional[object] = None) -> dict:
        """Apply the model's image/text processor. `processor` is the
        RSCoVLM/Qwen processor instance — left injectable so this module has
        no hard dependency on a specific model library."""
        if processor is None:
            return {"image_path": sample.image_path, "text": sample.caption}
        return processor(images=sample.image_path, text=sample.caption, return_tensors="pt")
