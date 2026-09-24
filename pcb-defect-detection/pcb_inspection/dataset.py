"""Convert the original DeepPCB archive into an auditable YOLO dataset.

The split is by DeepPCB's top-level board group, so adjacent crops and their
defect-free templates never cross train/validation/test boundaries.
"""

from __future__ import annotations

import argparse
from collections import Counter
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import zipfile

from PIL import Image


CLASS_NAMES = (
    "open",
    "short",
    "mousebite",
    "spur",
    "spurious_copper",
    "pin_hole",
)
VALIDATION_GROUPS = frozenset({"group90100"})
TEST_GROUPS = frozenset({"group00041", "group12100"})
EXPECTED_DEFECT_IMAGES = 1500
NORMAL_TRAIN_FRACTION = 0.25


def parse_boxes(text: str, width: int, height: int) -> list[tuple[int, float, float, float, float]]:
    """Read DeepPCB x1,y1,x2,y2,class boxes and return normalized YOLO labels."""
    boxes = []
    # DeepPCB의 클래스 번호는 1부터, YOLO의 클래스 번호는 0부터 시작합니다.
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 5:
            raise ValueError(f"line {line_number}: expected five integers")
        try:
            x1, y1, x2, y2, kind = (int(value) for value in fields)
        except ValueError as exc:
            raise ValueError(f"line {line_number}: non-integer value") from exc
        if not (1 <= kind <= len(CLASS_NAMES)):
            raise ValueError(f"line {line_number}: unknown class {kind}")
        if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
            raise ValueError(f"line {line_number}: invalid box {(x1, y1, x2, y2)}")
        boxes.append(
            (
                kind - 1,
                (x1 + x2) / (2 * width),
                (y1 + y2) / (2 * height),
                (x2 - x1) / width,
                (y2 - y1) / height,
            )
        )
    return boxes


def split_for_group(group: str) -> str:
    if group in TEST_GROUPS:
        return "test"
    if group in VALIDATION_GROUPS:
        return "val"
    return "train"


def include_normal(group: str, image_name: str) -> bool:
    """학습 정상 이미지는 파일명 해시로 고정 추출하고 검증·테스트는 모두 유지합니다."""
    if split_for_group(group) != "train":
        return True
    return int.from_bytes(sha256(image_name.encode("utf-8")).digest()[:4], "big") / 2**32 < NORMAL_TRAIN_FRACTION


def _image_size(contents: bytes, name: str) -> tuple[int, int]:
    with Image.open(BytesIO(contents)) as image:
        image.verify()
    with Image.open(BytesIO(contents)) as image:
        width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid image dimensions: {name}")
    return width, height


def _write_label(path: Path, boxes: list[tuple[int, float, float, float, float]]) -> None:
    path.write_text(
        "".join(f"{kind} {cx:.8f} {cy:.8f} {w:.8f} {h:.8f}\n" for kind, cx, cy, w, h in boxes),
        encoding="utf-8",
    )


def prepare(archive: Path, destination: Path) -> dict:
    archive = archive.resolve(strict=True)
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise FileExistsError(f"dataset output already contains files: {destination}")

    archive_hash = sha256(archive.read_bytes()).hexdigest()
    counts: dict[str, Counter] = {name: Counter() for name in ("train", "val", "test")}
    class_counts: dict[str, Counter] = {name: Counter() for name in ("train", "val", "test")}
    groups: dict[str, set[str]] = {name: set() for name in ("train", "val", "test")}

    with zipfile.ZipFile(archive) as source:
        names = set(source.namelist())
        image_names = sorted(
            name
            for name in names
            if "/PCBData/group" in name and name.endswith("_test.jpg")
        )
        if len(image_names) != EXPECTED_DEFECT_IMAGES:
            raise ValueError(f"expected {EXPECTED_DEFECT_IMAGES} defect images, found {len(image_names)}")
        available_groups = {PurePosixPath(name).parts[2] for name in image_names}
        if not (VALIDATION_GROUPS | TEST_GROUPS) <= available_groups:
            raise ValueError("one or more held-out board groups are missing")

        # 같은 원천 PCB 그룹의 인접 이미지가 서로 다른 분할에 섞이지 않게 합니다.
        for image_name in image_names:
            path = PurePosixPath(image_name)
            group, board = path.parts[2:4]
            split = split_for_group(group)
            groups[split].add(group)
            stem = path.name.removesuffix("_test.jpg")
            base = "/".join(path.parts[:3])
            annotation_name = f"{base}/{board}_not/{stem}.txt"
            template_name = f"{base}/{board}/{stem}_temp.jpg"
            if annotation_name not in names or template_name not in names:
                raise ValueError(f"missing annotation/template for {image_name}")

            defect_bytes = source.read(image_name)
            width, height = _image_size(defect_bytes, image_name)
            boxes = parse_boxes(source.read(annotation_name).decode("utf-8"), width, height)
            if not boxes:
                raise ValueError(f"defect image has no annotations: {image_name}")
            for kind, *_ in boxes:
                class_counts[split][CLASS_NAMES[kind]] += 1

            image_out = destination / "images" / split / f"{group}_{stem}_defect.jpg"
            label_out = destination / "labels" / split / f"{group}_{stem}_defect.txt"
            image_out.parent.mkdir(parents=True, exist_ok=True)
            label_out.parent.mkdir(parents=True, exist_ok=True)
            image_out.write_bytes(defect_bytes)
            _write_label(label_out, boxes)
            counts[split]["defect_images"] += 1
            counts[split]["defect_instances"] += len(boxes)

            if include_normal(group, image_name):
                template_bytes = source.read(template_name)
                if _image_size(template_bytes, template_name) != (width, height):
                    raise ValueError(f"template dimensions differ: {template_name}")
                normal_image = destination / "images" / split / f"{group}_{stem}_normal.jpg"
                normal_label = destination / "labels" / split / f"{group}_{stem}_normal.txt"
                normal_image.write_bytes(template_bytes)
                normal_label.write_text("", encoding="utf-8")
                counts[split]["normal_images"] += 1

    if any(groups[a] & groups[b] for a, b in (("train", "val"), ("train", "test"), ("val", "test"))):
        raise AssertionError("board groups crossed split boundaries")

    yaml_text = (
        f"path: '{destination.as_posix()}'\n"
        "train: images/train\nval: images/val\ntest: images/test\n"
        "names:\n"
        + "".join(f"  {index}: {name}\n" for index, name in enumerate(CLASS_NAMES))
    )
    (destination / "dataset.yaml").write_text(yaml_text, encoding="utf-8")
    manifest = {
        "source": "https://github.com/tangsanli5201/DeepPCB",
        "source_sha256": archive_hash,
        "split_method": "board_group_holdout_v1",
        "normal_train_fraction": NORMAL_TRAIN_FRACTION,
        "class_names": list(CLASS_NAMES),
        "splits": {
            split: {
                "groups": sorted(groups[split]),
                "counts": dict(counts[split]),
                "class_instances": dict(sorted(class_counts[split].items())),
            }
            for split in ("train", "val", "test")
        },
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=Path("DeepPCB-source.zip"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/deeppcb_group_holdout_v1"))
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
