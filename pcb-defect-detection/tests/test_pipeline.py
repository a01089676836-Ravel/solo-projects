"""Checks for data provenance, label conversion, and inspection scoring."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from PIL import Image

from pcb_inspection import audit, dataset
from pcb_inspection.evaluate import intersection_over_union, load_truth, match_boxes


class DatasetTests(unittest.TestCase):
    def test_box_conversion_and_invalid_annotations(self) -> None:
        self.assertEqual(dataset.parse_boxes("2 3 10 11 1\n", 16, 16), [(0, 0.375, 0.4375, 0.5, 0.5)])
        for bad in ("2 3 10 11 0", "10 3 2 11 1", "2 3 10 11", "2 3 17 11 1"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                dataset.parse_boxes(bad, 16, 16)

    def test_group_holdout_and_normal_sampling_are_stable(self) -> None:
        self.assertEqual(dataset.split_for_group("group90100"), "val")
        self.assertEqual(dataset.split_for_group("group00041"), "test")
        self.assertEqual(dataset.split_for_group("group12000"), "train")
        key = "DeepPCB-master/PCBData/group12000/12000/12000001_test.jpg"
        self.assertEqual(dataset.include_normal("group12000", key), dataset.include_normal("group12000", key))
        self.assertTrue(dataset.include_normal("group90100", key))

    def test_archive_conversion_keeps_groups_separate(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "source.zip"
            output = root / "converted"
            memory = BytesIO()
            Image.new("RGB", (16, 16), "white").save(memory, format="JPEG")
            image_bytes = memory.getvalue()
            with ZipFile(archive, "w") as source:
                for group, board in (("group12000", "12000"), ("group90100", "90100"), ("group00041", "00041"), ("group12100", "12100")):
                    base = f"DeepPCB-master/PCBData/{group}"
                    source.writestr(f"{base}/{board}/{board}001_test.jpg", image_bytes)
                    source.writestr(f"{base}/{board}/{board}001_temp.jpg", image_bytes)
                    source.writestr(f"{base}/{board}_not/{board}001.txt", "2 3 10 11 1\n")
            with patch.object(dataset, "EXPECTED_DEFECT_IMAGES", 4), patch.object(audit, "EXPECTED_DEFECT_IMAGES", 4):
                manifest = dataset.prepare(archive, output)
                self.assertEqual(audit.audit_dataset(output)["test"]["counts"]["defect_images"], 2)
            groups = [set(manifest["splits"][name]["groups"]) for name in ("train", "val", "test")]
            self.assertEqual(groups, [{"group12000"}, {"group90100"}, {"group00041", "group12100"}])
            self.assertTrue(all(not a & b for a, b in ((groups[0], groups[1]), (groups[0], groups[2]), (groups[1], groups[2]))))
            for split in ("train", "val", "test"):
                self.assertEqual(manifest["splits"][split]["counts"]["defect_images"], 2 if split == "test" else 1)
                labels = list((output / "labels" / split).glob("*_defect.txt"))
                self.assertEqual(len(labels), 2 if split == "test" else 1)
                self.assertTrue(labels[0].read_text(encoding="utf-8").startswith("0 0.37500000 0.43750000"))
            self.assertEqual(manifest["splits"]["val"]["counts"]["normal_images"], 1)
            self.assertEqual(manifest["splits"]["test"]["counts"]["normal_images"], 2)
            self.assertEqual(json.loads((output / "manifest.json").read_text(encoding="utf-8"))["split_method"], "board_group_holdout_v1")


class EvaluationTests(unittest.TestCase):
    def test_one_to_one_class_aware_matching(self) -> None:
        box = (0.0, 0.0, 10.0, 10.0)
        truth = [(0, box), (1, box)]
        predictions = [(0, 0.9, box), (0, 0.8, box), (2, 0.7, box)]
        tp, fp, fn = match_boxes(truth, predictions, 0.5)
        self.assertEqual(dict(tp), {0: 1})
        self.assertEqual(dict(fp), {0: 1, 2: 1})
        self.assertEqual(dict(fn), {1: 1})

    def test_iou_and_empty_ground_truth(self) -> None:
        self.assertEqual(intersection_over_union((0, 0, 10, 10), (20, 20, 30, 30)), 0)
        self.assertAlmostEqual(intersection_over_union((0, 0, 10, 10), (5, 0, 15, 10)), 1 / 3)
        tp, fp, fn = match_boxes([], [(0, 0.5, (0, 0, 10, 10))], 0.5)
        self.assertEqual((sum(tp.values()), sum(fp.values()), sum(fn.values())), (0, 1, 0))

    def test_truth_reader_rescales_normalized_coordinates(self) -> None:
        with TemporaryDirectory() as temporary:
            label = Path(temporary) / "label.txt"
            label.write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")
            self.assertEqual(load_truth(label, 100, 80), [(0, (25.0, 20.0, 75.0, 60.0))])


if __name__ == "__main__":
    unittest.main()
