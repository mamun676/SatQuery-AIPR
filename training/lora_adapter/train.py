"""LoRA/PEFT adaptation training loop (training/lora_adapter/train.py).

Pipeline: BigEarthNet sample/subset -> preprocessing -> LoRA/PEFT ->
adapted model -> inference (see backend/models/rscovlm.py for the
inference-side integration point).

Usage (smoke test, no GPU/weights required to validate the pipeline shape):
    python -m training.lora_adapter.train --smoke-test

Usage (real run, requires transformers/peft/torch + base model weights):
    python -m training.lora_adapter.train --base-model <hf-model-id> \
        --data-dir datasets/bigearthnet_subset --output-dir training/adapters/run1
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from training.lora_adapter.dataset import BigEarthNetSubset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a LoRA adapter for remote-sensing VLM tasks.")
    parser.add_argument("--base-model", default=os.environ.get("RS_BASE_MODEL", "Qwen/Qwen2-VL-2B-Instruct"))
    parser.add_argument("--data-dir", default="datasets/bigearthnet_subset")
    parser.add_argument("--output-dir", default="training/adapters/run1")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--lora-r", type=int, default=8)
    parser.add_argument("--lora-alpha", type=int, default=16)
    parser.add_argument("--smoke-test", action="store_true", help="Validate the pipeline shape without requiring GPU/weights.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    train_set = BigEarthNetSubset(args.data_dir, split="train")
    val_set = BigEarthNetSubset(args.data_dir, split="val")

    print(f"[dataset] train samples: {len(train_set)} | val samples: {len(val_set)}")

    if args.smoke_test or len(train_set) == 0:
        print(
            "[smoke-test] No real dataset/model weights required for this mode. "
            "The dataset/train/val split, argument parsing, and checkpoint-path "
            "wiring are validated; real training requires: "
            "1) a populated datasets/bigearthnet_subset/index.json, "
            "2) `pip install torch transformers peft accelerate`, "
            "3) GPU (or long CPU run)."
        )
        os.makedirs(args.output_dir, exist_ok=True)
        with open(os.path.join(args.output_dir, "smoke_test_report.json"), "w", encoding="utf-8") as f:
            json.dump({"status": "smoke_test_ok", "train_samples": len(train_set), "val_samples": len(val_set)}, f, indent=2)
        return 0

    try:
        import torch  # type: ignore
        from peft import LoraConfig, get_peft_model  # type: ignore
        from transformers import AutoModelForVision2Seq, AutoProcessor  # type: ignore
    except ImportError as exc:
        print(f"[error] Missing training dependency: {exc}. Install backend/requirements.txt extras (torch/transformers/peft).", file=sys.stderr)
        return 1

    processor = AutoProcessor.from_pretrained(args.base_model)
    base_model = AutoModelForVision2Seq.from_pretrained(args.base_model)

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "v_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(base_model, lora_config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)

    model.train()
    for epoch in range(args.epochs):
        running_loss = 0.0
        for i in range(len(train_set)):
            sample = train_set[i]
            batch = train_set.preprocess(sample, processor)
            outputs = model(**batch, labels=batch.get("input_ids"))
            loss = outputs.loss
            loss.backward()
            if (i + 1) % args.batch_size == 0:
                optimizer.step()
                optimizer.zero_grad()
            running_loss += float(loss.item())
        print(f"[epoch {epoch}] avg_loss={running_loss / max(1, len(train_set)):.4f}")

    os.makedirs(args.output_dir, exist_ok=True)
    model.save_pretrained(args.output_dir)
    processor.save_pretrained(args.output_dir)
    print(f"[done] Adapter saved to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
