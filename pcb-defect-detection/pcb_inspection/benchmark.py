"""Record standard Ultralytics mAP on the untouched test split."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def benchmark(model_path: Path, dataset_root: Path, image_size: int) -> dict:
    from ultralytics import YOLO

    model_path = model_path.resolve(strict=True)
    dataset_root = dataset_root.resolve(strict=True)
    manifest = json.loads((dataset_root / "manifest.json").read_text(encoding="utf-8"))
    metrics = YOLO(str(model_path)).val(
        data=str(dataset_root / "dataset.yaml"),
        split="test",
        imgsz=image_size,
        batch=8,
        device="cpu",
        plots=False,
        verbose=False,
        project="runs",
        name="test-benchmark",
        exist_ok=True,
    )
    return {
        "model": str(model_path),
        "dataset_source_sha256": manifest["source_sha256"],
        "dataset_split_method": manifest["split_method"],
        "split": "test",
        "image_size": image_size,
        "metrics": {key: float(value) for key, value in metrics.results_dict.items() if isinstance(value, (int, float))},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("data/processed/deeppcb_group_holdout_v1"))
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--output", type=Path, default=Path("reports/test-map.json"))
    args = parser.parse_args()
    result = benchmark(args.model, args.data, args.imgsz)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["metrics"], indent=2))


if __name__ == "__main__":
    main()
