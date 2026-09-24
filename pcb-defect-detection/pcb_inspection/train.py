"""Train a PCB defect detector with a recorded, reproducible configuration."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform


def train(
    dataset: Path,
    weights: Path,
    project: Path,
    name: str,
    *,
    epochs: int,
    image_size: int,
    batch: int,
    fraction: float,
    device: str,
) -> Path:
    import torch
    import ultralytics
    from ultralytics import YOLO

    dataset = dataset.resolve(strict=True)
    weights = weights.resolve(strict=True)
    project = project.resolve()
    manifest_path = dataset.parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if epochs < 1 or image_size < 64 or batch < 1 or not (0 < fraction <= 1):
        raise ValueError("epochs, image_size and batch must be positive; fraction must be (0, 1]")

    model = YOLO(str(weights))
    outcome = model.train(
        data=str(dataset),
        epochs=epochs,
        imgsz=image_size,
        batch=batch,
        fraction=fraction,
        workers=0,
        device=device,
        project=str(project),
        name=name,
        exist_ok=False,
        seed=42,
        deterministic=True,
        patience=max(epochs, 10),
        plots=False,
        verbose=False,
    )
    run_dir = Path(model.trainer.save_dir).resolve()
    metrics = {
        key: float(value)
        for key, value in outcome.results_dict.items()
        if isinstance(value, (float, int))
    }
    record = {
        "purpose": "training_smoke_check" if fraction < 1 or epochs < 5 else "candidate_training",
        "model": weights.name,
        "dataset_source_sha256": manifest["source_sha256"],
        "dataset_split_method": manifest["split_method"],
        "training": {
            "epochs": epochs,
            "image_size": image_size,
            "batch": batch,
            "fraction": fraction,
            "device": device,
            "seed": 42,
        },
        "environment": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "ultralytics": ultralytics.__version__,
            "cuda_available": torch.cuda.is_available(),
        },
        "validation_metrics": metrics,
        "best_weights": str(run_dir / "weights" / "best.pt"),
    }
    (run_dir / "run-record.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return run_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("data/processed/deeppcb_group_holdout_v1/dataset.yaml"))
    parser.add_argument("--weights", type=Path, default=Path("yolo11n.pt"))
    parser.add_argument("--project", type=Path, default=Path("runs"))
    parser.add_argument("--name", default="candidate")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--fraction", type=float, default=1.0)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    output = train(
        args.dataset,
        args.weights,
        args.project,
        args.name,
        epochs=args.epochs,
        image_size=args.imgsz,
        batch=args.batch,
        fraction=args.fraction,
        device=args.device,
    )
    print(output)


if __name__ == "__main__":
    main()
