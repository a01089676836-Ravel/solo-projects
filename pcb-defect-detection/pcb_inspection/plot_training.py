"""Plot the validation metrics recorded during model training."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


def plot_history(history: Path, output: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with history.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if not rows:
        raise ValueError("training history is empty")
    epochs = [int(row["epoch"]) for row in rows]
    map50 = [float(row["metrics/mAP50(B)"]) for row in rows]
    map5095 = [float(row["metrics/mAP50-95(B)"]) for row in rows]

    figure, axis = plt.subplots(figsize=(7.5, 4.2))
    axis.plot(epochs, map50, marker="o", linewidth=2, label="Validation mAP50")
    axis.plot(epochs, map5095, marker="s", linewidth=2, label="Validation mAP50–95")
    axis.set(xlabel="Epoch", ylabel="Mean average precision", ylim=(0, 1), title="PCB defect detection: validation history")
    axis.set_xticks(epochs)
    axis.grid(alpha=0.25)
    axis.legend(loc="best")
    figure.tight_layout()
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=160)
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, default=Path("runs/candidate_cpu_320/results.csv"))
    parser.add_argument("--output", type=Path, default=Path("reports/training-curve.png"))
    args = parser.parse_args()
    plot_history(args.history, args.output)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
