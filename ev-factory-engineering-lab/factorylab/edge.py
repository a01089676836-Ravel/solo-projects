"""Dependency-free scoring; same features as sklearn, no control commands.

Run: python -m factorylab.edge --model output/model.json --input examples/unit.json
"""
import argparse
import json
import math
from pathlib import Path

FEATURES = ("torque_deviation", "weld_deviation", "seal_deviation",
            "vibration_mm_s", "ambient_c", "variant_b")
FIELDS = ("torque_nm", "weld_ratio", "seal_kpa", "vibration_mm_s", "ambient_c")


def feature_row(row):
    """Map measurements to model inputs relative to the documented nominal settings."""
    values = [float(row[k]) for k in FIELDS]
    if any(isinstance(row[k], bool) for k in FIELDS) or not all(math.isfinite(v) for v in values):
        raise ValueError("Measurements must be finite numbers")
    if row["variant"] not in ("A", "B"):
        raise ValueError("Unknown recipe")
    t, w, s, v, a = values
    return [abs(t - 10), abs(w - 1), abs(s - 100), v, a, float(row["variant"] == "B")]


def predict(row, model):
    """Score in-domain input or abstain; return review guidance without control commands."""
    try:
        x = feature_row(row)
    except (ValueError, KeyError, TypeError, OverflowError):
        return {"status": "INSUFFICIENT_DATA", "risk_score": None,
                "action": "측정값과 사양을 확인한 후 다시 평가", "control_command": None}
    if any(not lo <= value <= hi for value, lo, hi in zip(x, model["min"], model["max"])):
        return {"status": "OUT_OF_DOMAIN", "risk_score": None,
                "action": "학습 범위 밖 입력: 담당자 검토 필요", "control_command": None}
    terms = [(v - m) / s * c for v, m, s, c in
             zip(x, model["mean"], model["scale"], model["coef"])]
    z = model["intercept"] + sum(terms)
    score = 1 / (1 + math.exp(-max(-700, min(700, z))))
    risk = score >= model["threshold"]
    # These are additive log-odds contributions, not causal explanations.
    ranked = sorted(zip(FEATURES, terms), key=lambda x: x[1], reverse=True)[:3]
    return {"status": "REVIEW" if risk else "MONITOR", "risk_score": score,
            "threshold": model["threshold"],
            "drivers": [{"feature": k, "log_odds_contribution": v} for k, v in ranked],
            "action": "추가 점검 후보; 최종검사 유지" if risk else "정규 최종검사 진행",
            "control_command": None,
            "note": "가중 로지스틱 점수이며 보정된 불량 확률이 아님. 기여도는 인과관계가 아님."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(predict(json.loads(args.input.read_text(encoding="utf-8")),
                             json.loads(args.model.read_text(encoding="utf-8"))),
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
