"""Fixed model; train-only scaling; validation-only threshold; temporal holdout."""
import numpy as np
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix
from .edge import feature_row, FEATURES


def metrics(y, score, threshold):
    """Summarize threshold decisions; a missed defect costs 20x a false alarm here."""
    y, score = np.asarray(y), np.asarray(score)
    pred = score >= threshold
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return dict(n=len(y), positives=int(sum(y)), tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp),
                precision=float(precision), recall=float(recall),
                f1=float(2 * precision * recall / (precision + recall)) if precision + recall else 0.0,
                review_rate=float(pred.mean()), prevalence=float(y.mean()),
                average_precision=float(average_precision_score(y, score)) if sum(y) else 0.0,
                weighted_error_cost=int(20 * fn + fp))


def fit_evaluate(units):
    """Fit on early days, choose the threshold on validation days, and hold out later days."""
    x = np.asarray([feature_row(row) for row in units.to_dict("records")])
    y = units.defect.to_numpy()
    days = units.day.to_numpy()
    masks = dict(train=days <= 18, validation=(days >= 19) & (days <= 24), test=days >= 25)
    if any(len(np.unique(y[mask])) < 2 for mask in masks.values()):
        raise ValueError("Each temporal split needs both classes")
    pipe = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000))
    pipe.fit(x[masks["train"]], y[masks["train"]])
    scores = pipe.predict_proba(x)[:, 1]
    thresholds = np.linspace(0.01, 0.99, 99)
    candidates = [(float(t), metrics(y[masks["validation"]], scores[masks["validation"]], t)) for t in thresholds]
    # Select lowest review load that reaches recall >= 0.8; report feasibility.
    feasible = [(t, m) for t, m in candidates if m["recall"] >= 0.8]
    chosen, val = (min(feasible, key=lambda tm: (tm[1]["review_rate"], -tm[1]["recall"])) if feasible
                   else min(candidates, key=lambda tm: (-tm[1]["recall"], tm[1]["review_rate"])))
    scaler, classifier = pipe.steps[0][1], pipe.steps[1][1]
    train_x = x[masks["train"]]
    # Domain bounds widened by half the observed range; derived from train only.
    span = np.maximum(np.ptp(train_x, axis=0), 1e-6)
    model = dict(features=list(FEATURES), mean=scaler.mean_.tolist(), scale=scaler.scale_.tolist(),
                 coef=classifier.coef_[0].tolist(), intercept=float(classifier.intercept_[0]),
                 threshold=chosen, min=(train_x.min(axis=0) - 0.5 * span).tolist(),
                 max=(train_x.max(axis=0) + 0.5 * span).tolist(),
                 version="1.0.0", score_type="uncalibrated_class_weighted_logistic")
    result = {name: metrics(y[mask], scores[mask], chosen) for name, mask in masks.items()}
    result.update(threshold=chosen, target_recall=0.8, validation_target_met=bool(feasible),
                  review_budget=0.3, validation_budget_met=bool(val["review_rate"] <= 0.3),
                  features=list(FEATURES), split_days={"train": [1, 18], "validation": [19, 24], "test": [25, 30]},
                  policy="Validation recall >= 0.80, then minimum review rate; capacity budget 30% reported, not hidden",
                  baseline_all_normal=metrics(y[masks["test"]], np.zeros(masks["test"].sum()), 0.5),
                  baseline_review_all=metrics(y[masks["test"]], np.ones(masks["test"].sum()), 0.5))
    # Lot/day block resampling, six held-out lots: exploratory uncertainty only.
    rng = np.random.default_rng(514)
    held_days = np.unique(days[masks["test"]])
    draws = []
    for _ in range(300):
        indices = np.concatenate([np.flatnonzero(days == d) for d in rng.choice(held_days, len(held_days), replace=True)])
        draws.append(metrics(y[indices], scores[indices], chosen))
    result["test_intervals"] = {k: np.quantile([r[k] for r in draws], [.025, .975]).tolist()
                                for k in ("recall", "precision", "average_precision", "review_rate")}
    result["uncertainty_note"] = "300 lot-block bootstrap draws; only 6 test lots; exploratory, not field validity"
    scored = units.copy()
    scored["risk_score"] = scores
    scored["split"] = np.where(masks["train"], "train", np.where(masks["validation"], "validation", "test"))
    return model, result, scored
