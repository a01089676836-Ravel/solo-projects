"""Evaluate fixed-threshold inspection behaviour on a held-out board group."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import mean

from PIL import Image

from pcb_inspection.dataset import CLASS_NAMES


def xywh_to_xyxy(box: tuple[float, float, float, float], width: int, height: int) -> tuple[float, float, float, float]:
    cx, cy, w, h = box
    return (
        (cx - w / 2) * width,
        (cy - h / 2) * height,
        (cx + w / 2) * width,
        (cy + h / 2) * height,
    )


def intersection_over_union(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    overlap = max(0.0, right - left) * max(0.0, bottom - top)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - overlap
    return overlap / union if union else 0.0


def match_boxes(
    truth: list[tuple[int, tuple[float, float, float, float]]],
    predictions: list[tuple[int, float, tuple[float, float, float, float]]],
    iou_threshold: float,
) -> tuple[Counter, Counter, Counter]:
    """One-to-one, class-aware matching in descending confidence order."""
    tp, fp, fn = Counter(), Counter(), Counter()
    # 신뢰도가 높은 예측부터 같은 클래스의 미매칭 정답 하나에만 연결합니다.
    unmatched = set(range(len(truth)))
    for kind, _confidence, box in sorted(predictions, key=lambda item: item[1], reverse=True):
        choices = [
            (intersection_over_union(box, truth[index][1]), index)
            for index in unmatched
            if truth[index][0] == kind
        ]
        best = max(choices, default=(0.0, -1))
        if best[0] >= iou_threshold:
            tp[kind] += 1
            unmatched.remove(best[1])
        else:
            fp[kind] += 1
    # 끝까지 연결되지 않은 정답은 각각 미탐으로 셉니다.
    for index in unmatched:
        fn[truth[index][0]] += 1
    return tp, fp, fn


def load_truth(path: Path, width: int, height: int) -> list[tuple[int, tuple[float, float, float, float]]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        fields = line.split()
        if len(fields) != 5:
            raise ValueError(f"{path}:{line_number}: expected YOLO class + four coordinates")
        kind = int(fields[0])
        box = tuple(float(value) for value in fields[1:])
        cx, cy, w, h = box
        if (
            not 0 <= kind < len(CLASS_NAMES)
            or not 0 <= cx <= 1
            or not 0 <= cy <= 1
            or not 0 < w <= 1
            or not 0 < h <= 1
            or cx - w / 2 < -1e-6
            or cx + w / 2 > 1 + 1e-6
            or cy - h / 2 < -1e-6
            or cy + h / 2 > 1 + 1e-6
        ):
            raise ValueError(f"{path}:{line_number}: invalid class or coordinate")
        rows.append((kind, xywh_to_xyxy(box, width, height)))
    return rows


def ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def evaluate(
    model_path: Path,
    dataset_root: Path,
    *,
    split: str,
    confidence: float,
    match_iou: float,
    image_size: int,
    max_images: int | None,
) -> dict:
    from ultralytics import YOLO

    if split not in {"val", "test"}:
        raise ValueError("split must be val or test")
    if not (0 < confidence < 1 and 0 < match_iou <= 1):
        raise ValueError("confidence must be in (0, 1); match_iou must be in (0, 1]")
    model_path = model_path.resolve(strict=True)
    dataset_root = dataset_root.resolve(strict=True)
    manifest = json.loads((dataset_root / "manifest.json").read_text(encoding="utf-8"))
    image_paths = sorted((dataset_root / "images" / split).glob("*.jpg"))
    if max_images is not None:
        if max_images < 1:
            raise ValueError("max_images must be positive")
        image_paths = image_paths[:max_images]
    if not image_paths:
        raise ValueError(f"no evaluation images in {split}")

    model = YOLO(str(model_path))
    totals = {name: Counter() for name in ("tp", "fp", "fn")}
    normal_images = defect_images = normal_false_alarms = defect_images_without_match = 0
    inference_times_ms: list[float] = []
    examples: list[dict] = []
    for image_path in image_paths:
        with Image.open(image_path) as image:
            width, height = image.size
        label_path = dataset_root / "labels" / split / f"{image_path.stem}.txt"
        truth = load_truth(label_path, width, height)
        result = model.predict(
            source=str(image_path),
            conf=confidence,
            iou=0.7,
            imgsz=image_size,
            device="cpu",
            verbose=False,
        )[0]
        predictions = [
            (int(kind), float(score), tuple(float(value) for value in box))
            for kind, score, box in zip(
                result.boxes.cls.tolist(), result.boxes.conf.tolist(), result.boxes.xyxy.tolist()
            )
        ]
        tp, fp, fn = match_boxes(truth, predictions, match_iou)
        for name, found in (("tp", tp), ("fp", fp), ("fn", fn)):
            totals[name].update(found)
        if truth:
            defect_images += 1
            defect_images_without_match += int(sum(tp.values()) == 0)
        else:
            normal_images += 1
            normal_false_alarms += int(bool(predictions))
        inference_times_ms.append(float(result.speed["inference"]))
        if len(examples) < 12 and (sum(fn.values()) or (not truth and predictions)):
            examples.append(
                {
                    "image": image_path.name,
                    "truth_count": len(truth),
                    "prediction_count": len(predictions),
                    "matched": sum(tp.values()),
                    "missed": sum(fn.values()),
                    "false_positives": sum(fp.values()),
                }
            )

    class_results = {}
    for index, class_name in enumerate(CLASS_NAMES):
        tp, fp, fn = (totals[name][index] for name in ("tp", "fp", "fn"))
        class_results[class_name] = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": ratio(tp, tp + fp),
            "recall": ratio(tp, tp + fn),
        }
    tp, fp, fn = (sum(totals[name].values()) for name in ("tp", "fp", "fn"))
    return {
        "model": str(model_path),
        "dataset": str(dataset_root),
        "dataset_source_sha256": manifest["source_sha256"],
        "dataset_split_method": manifest["split_method"],
        "split": split,
        "sampled": max_images is not None,
        "settings": {"confidence": confidence, "match_iou": match_iou, "image_size": image_size},
        "images": {"total": len(image_paths), "defect": defect_images, "normal": normal_images},
        "objects": {"tp": tp, "fp": fp, "fn": fn, "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn)},
        "normal_image_false_alarms": normal_false_alarms,
        "normal_image_false_alarm_rate": ratio(normal_false_alarms, normal_images),
        "defect_images_without_match": defect_images_without_match,
        "defect_image_no_match_rate": ratio(defect_images_without_match, defect_images),
        "mean_inference_ms": mean(inference_times_ms),
        "by_class": class_results,
        "error_examples": examples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--data", type=Path, default=Path("data/processed/deeppcb_group_holdout_v1"))
    parser.add_argument("--split", choices=("val", "test"), default="test")
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--match-iou", type=float, default=0.5)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--max-images", type=int)
    parser.add_argument("--output", type=Path, default=Path("reports/test-evaluation.json"))
    args = parser.parse_args()
    result = evaluate(
        args.model,
        args.data,
        split=args.split,
        confidence=args.conf,
        match_iou=args.match_iou,
        image_size=args.imgsz,
        max_images=args.max_images,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("split", "sampled", "images", "objects", "normal_image_false_alarm_rate", "mean_inference_ms")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
