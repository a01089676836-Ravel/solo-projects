import hashlib
import json
import sqlite3
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from factorylab.simulation import simulate, Scenario
from factorylab.data import validate
from factorylab.edge import feature_row, predict, FEATURES
from factorylab.modeling import metrics

ROOT = Path(__file__).resolve().parents[1]


class SimulationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.units, cls.events = simulate()

    def test_same_seed_reproduces_exactly(self):
        a, b = simulate()
        pd.testing.assert_frame_equal(a, self.units)
        pd.testing.assert_frame_equal(b, self.events)

    def test_resource_capacity_and_precedence(self):
        for cfg in (Scenario(), Scenario(eol_cells=2)):
            u, e = simulate(scenario=cfg)
            self.assertEqual(validate(u, e)["status"], "PASS")

    def test_parallel_cell_does_not_change_quality(self):
        other, _ = simulate(scenario=Scenario(eol_cells=2))
        np.testing.assert_array_equal(other.defect, self.units.defect)
        self.assertTrue((other.complete_s <= self.units.complete_s + 1e-7).all())

    def test_quality_intervention_monotonic_for_paired_draws(self):
        other, _ = simulate(scenario=Scenario(variation=.55))
        self.assertTrue((other.defect <= self.units.defect).all())

    def test_invalid_scenario_rejected(self):
        for kw in ({"eol_cells": 0}, {"variation": -1}, {"takt_s": 0}):
            with self.assertRaises(ValueError):
                Scenario(**kw)


class DataContractTests(unittest.TestCase):
    def setUp(self):
        self.u, self.e = simulate()

    def test_duplicate_rejected(self):
        self.u.loc[1, "unit_id"] = self.u.loc[0, "unit_id"]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate(self.u, self.e)

    def test_missing_station_rejected(self):
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            validate(self.u, self.e.iloc[1:])

    def test_nonfinite_and_missing_rejected(self):
        for value in (float("inf"), float("nan")):
            u = self.u.copy()
            u.loc[0, "torque_nm"] = value
            with self.assertRaises(ValueError):
                validate(u, self.e)

    def test_reversed_duration_rejected(self):
        self.e.loc[0, "end_s"] = -1
        with self.assertRaisesRegex(ValueError, "duration"):
            validate(self.u, self.e)

    def test_wrong_day_rejected(self):
        self.e.loc[0, "day"] = 2
        with self.assertRaisesRegex(ValueError, "day"):
            validate(self.u, self.e)

    def test_orphan_rejected(self):
        self.e.loc[0, "unit_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "Orphan"):
            validate(self.u, self.e)


class BuiltArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scored = pd.read_csv(ROOT / "output/scored_units.csv")
        cls.model = json.loads((ROOT / "output/model.json").read_text(encoding="utf-8"))
        cls.report = json.loads((ROOT / "output/model_metrics.json").read_text(encoding="utf-8"))

    def test_training_only_scaler(self):
        train = self.scored[self.scored.split.eq("train")]
        x = np.asarray([feature_row(r) for r in train.to_dict("records")])
        np.testing.assert_allclose(x.mean(axis=0), self.model["mean"], rtol=1e-10, atol=1e-10)
        np.testing.assert_allclose(x.std(axis=0), self.model["scale"], rtol=1e-10, atol=1e-10)

    def test_temporal_splits_never_overlap_lots(self):
        sets = [set(self.scored.loc[self.scored.split.eq(s), "day"]) for s in ("train", "validation", "test")]
        self.assertLess(max(sets[0]), min(sets[1]))
        self.assertLess(max(sets[1]), min(sets[2]))
        self.assertEqual(len(set.union(*sets)), 30)

    def test_feature_whitelist_has_no_outcome_or_post_inspection_values(self):
        self.assertEqual(self.model["features"], list(FEATURES))
        row = self.scored.iloc[0].to_dict()
        before = feature_row(row)
        row.update(defect=1-row["defect"], complete_s=999999, within_window=0)
        self.assertEqual(before, feature_row(row))

    def test_edge_scores_match_sklearn(self):
        tested = 0
        for row in self.scored[self.scored.split.eq("test")].to_dict("records"):
            result = predict(row, self.model)
            if result["risk_score"] is not None:
                self.assertAlmostEqual(result["risk_score"], row["risk_score"], places=10)
                tested += 1
        self.assertGreater(tested, 1000)

    def test_edge_abstains_for_missing_unknown_nonfinite_and_outside_domain(self):
        source = self.scored.iloc[0].to_dict()
        for changes in ({"variant": "unknown"}, {"torque_nm": None},
                        {"torque_nm": float("inf")}, {"torque_nm": 1e10}):
            result = predict({**source, **changes}, self.model)
            self.assertIsNone(result["risk_score"])
            self.assertIsNone(result["control_command"])

    def test_metrics_independent_confusion_count(self):
        test = self.scored[self.scored.split.eq("test")]
        predicted = test.risk_score >= self.report["threshold"]
        actual = test.defect.eq(1)
        self.assertEqual(int((predicted & actual).sum()), self.report["test"]["tp"])
        self.assertEqual(int((~predicted & actual).sum()), self.report["test"]["fn"])
        self.assertEqual(sum(self.report["test"][k] for k in ("tn", "fp", "fn", "tp")), len(test))

    def test_threshold_is_validation_choice(self):
        val = self.scored[self.scored.split.eq("validation")]
        candidates = [(float(t), metrics(val.defect, val.risk_score, t)) for t in np.linspace(.01,.99,99)]
        feasible = [(t, m) for t, m in candidates if m["recall"] >= .8]
        if feasible:
            expected, _ = min(feasible, key=lambda tm:(tm[1]["review_rate"],-tm[1]["recall"]))
            self.assertAlmostEqual(expected, self.model["threshold"])

    def test_sqlite_counts_and_foreign_keys(self):
        with sqlite3.connect(ROOT / "output/factory.sqlite") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM units").fetchone()[0], 5400)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 21600)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events WHERE station='EOL'").fetchone()[0], 5400)

    def test_manifest_sources_unchanged(self):
        manifest = json.loads((ROOT / "output/manifest.json").read_text(encoding="utf-8"))
        for relative, expected in manifest["files"].items():
            self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), expected, relative)

    def test_paired_experiment_summary_matches_raw(self):
        raw = pd.read_csv(ROOT / "output/experiment_runs.csv")
        summary = pd.read_csv(ROOT / "output/scenarios.csv")
        baseline = raw[raw.scenario.eq("baseline")].set_index("replicate")
        for row in summary.itertuples():
            other = raw[raw.scenario.eq(row.name)].set_index("replicate")
            self.assertEqual(set(baseline.index), set(other.index))
            self.assertAlmostEqual(float((other.completed-baseline.completed).mean()), row.completed_delta)


if __name__ == "__main__":
    unittest.main()
