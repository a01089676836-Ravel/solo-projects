"""Check the entire converted dataset against its provenance manifest."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path

from PIL import Image

from pcb_inspection.dataset import CLASS_NAMES, EXPECTED_DEFECT_IMAGES
from pcb_inspection.evaluate import load_truth


def audit_dataset(root: Path) -> dict:
    root = root.resolve(strict=True)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest["class_names"] != list(CLASS_NAMES):
        raise ValueError("class names differ from the converter")
    result: dict[str, dict] = {}
    seen_groups: set[str] = set()
    total_defect_images = 0
    for split in ("train", "val", "test"):
        image_dir = root / "images" / split
        label_dir = root / "labels" / split
        images = sorted(image_dir.glob("*.jpg"))
        labels = sorted(label_dir.glob("*.txt"))
        if {image.stem for image in images} != {label.stem for label in labels}:
            raise ValueError(f"{split}: image and label files differ")
        counts: Counter = Counter()
        class_counts: Counter = Counter()
        groups: set[str] = set()
        for image in images:
            group = image.name.split("_", 1)[0]
            groups.add(group)
            with Image.open(image) as source:
                width, height = source.size
            truth = load_truth(label_dir / f"{image.stem}.txt", width, height)
            if image.stem.endswith("_defect"):
                if not truth:
                    raise ValueError(f"missing defect annotation: {image}")
                counts["defect_images"] += 1
                counts["defect_instances"] += len(truth)
                class_counts.update(CLASS_NAMES[kind] for kind, _box in truth)
            elif image.stem.endswith("_normal"):
                if truth:
                    raise ValueError(f"normal image contains defect annotation: {image}")
                counts["normal_images"] += 1
            else:
                raise ValueError(f"unknown image type: {image}")
        expected = manifest["splits"][split]
        if groups != set(expected["groups"]) or groups & seen_groups:
            raise ValueError(f"{split}: board groups differ or overlap")
        if dict(counts) != expected["counts"] or dict(class_counts) != expected["class_instances"]:
            raise ValueError(f"{split}: image or class counts differ from the manifest")
        seen_groups.update(groups)
        total_defect_images += counts["defect_images"]
        result[split] = {"groups": sorted(groups), "counts": dict(counts), "class_instances": dict(class_counts)}
    if total_defect_images != EXPECTED_DEFECT_IMAGES:
        raise ValueError(f"expected {EXPECTED_DEFECT_IMAGES} defect images, found {total_defect_images}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/deeppcb_group_holdout_v1"))
    args = parser.parse_args()
    print(json.dumps(audit_dataset(args.data), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
