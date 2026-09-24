"""Turn reproducible run records and evaluation JSON into a compact Korean report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pcb_inspection.dataset import CLASS_NAMES


def percent(value: float | None) -> str:
    return "계산 불가" if value is None else f"{value * 100:.1f}%"


def build_report(
    run: dict, evaluation: dict, benchmark: dict | None = None, validation_runs: list[dict] | None = None
) -> str:
    if run["dataset_split_method"] != "board_group_holdout_v1":
        raise ValueError("unsupported dataset split")
    if evaluation["dataset_source_sha256"] != run["dataset_source_sha256"]:
        raise ValueError("training and evaluation datasets differ")
    if evaluation["dataset_split_method"] != run["dataset_split_method"]:
        raise ValueError("training and evaluation splits differ")
    if Path(evaluation["model"]).resolve() != Path(run["best_weights"]).resolve():
        raise ValueError("evaluation did not use this run's best weights")
    if evaluation["split"] != "test":
        raise ValueError("this report requires the held-out test split")
    if evaluation["settings"]["image_size"] != run["training"]["image_size"]:
        raise ValueError("training and evaluation image sizes differ")
    if benchmark is not None and (
        benchmark["split"] != "test"
        or benchmark["dataset_source_sha256"] != run["dataset_source_sha256"]
        or benchmark["dataset_split_method"] != run["dataset_split_method"]
        or Path(benchmark["model"]).resolve() != Path(run["best_weights"]).resolve()
        or benchmark["image_size"] != run["training"]["image_size"]
    ):
        raise ValueError("standard benchmark differs from this training run")
    for validation in validation_runs or []:
        if (
            validation["split"] != "val"
            or validation["sampled"]
            or validation["dataset_source_sha256"] != run["dataset_source_sha256"]
            or validation["dataset_split_method"] != run["dataset_split_method"]
            or Path(validation["model"]).resolve() != Path(run["best_weights"]).resolve()
            or validation["settings"]["image_size"] != run["training"]["image_size"]
        ):
            raise ValueError("validation threshold study differs from this training run")

    images = evaluation["images"]
    objects = evaluation["objects"]
    settings = evaluation["settings"]
    lines = [
        "# PCB 최종검사 AI · 실험 결과",
        "",
        f"평가 범위: {'테스트 일부 표본' if evaluation['sampled'] else '보류한 테스트 그룹 전체'} "
        f"({images['total']}장: 결함 {images['defect']}장, 정상 {images['normal']}장)",
        "",
        "## 재현 정보",
        "",
        f"- 원천 ZIP SHA-256: `{run['dataset_source_sha256']}`",
        f"- 분할: `{run['dataset_split_method']}`",
        f"- 학습: YOLO11n, {run['training']['epochs']} epoch, 입력 {run['training']['image_size']}px, "
        f"batch {run['training']['batch']}, seed {run['training']['seed']}, {run['training']['device']}",
        f"- 판정 기준: 신뢰도 {settings['confidence']:.2f}, 클래스 일치, IoU {settings['match_iou']:.2f}",
        f"- 환경: Python {run['environment']['python']}, torch {run['environment']['torch']}, "
        f"ultralytics {run['environment']['ultralytics']}",
        "",
        "## 검증 및 테스트 결과",
        "",
        f"- 검증 mAP50: {percent(run['validation_metrics'].get('metrics/mAP50(B)'))}",
        *([f"- 테스트 mAP50: {percent(benchmark['metrics'].get('metrics/mAP50(B)'))} "
           "(신뢰도 전 구간의 표준 검출 지표)"] if benchmark is not None else []),
        f"- 테스트 결함 객체: TP {objects['tp']}, FP {objects['fp']}, FN {objects['fn']}",
        f"- 테스트 정밀도: {percent(objects['precision'])}; 재현율: {percent(objects['recall'])}",
        f"- 정상 이미지 오탐: {evaluation['normal_image_false_alarms']}/{images['normal']}장 "
        f"({percent(evaluation['normal_image_false_alarm_rate'])})",
        f"- 결함 이미지에서 일치 검출 없음: {evaluation['defect_images_without_match']}/{images['defect']}장 "
        f"({percent(evaluation['defect_image_no_match_rate'])})",
        f"- 평균 모델 추론 시간: {evaluation['mean_inference_ms']:.1f} ms/장 (전체 처리 시간 아님)",
        "",
        "## 결함 종류별 결과",
        "",
        "| 결함 | TP | FP | FN | 정밀도 | 재현율 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in CLASS_NAMES:
        row = evaluation["by_class"][name]
        lines.append(
            f"| `{name}` | {row['tp']} | {row['fp']} | {row['fn']} | "
            f"{percent(row['precision'])} | {percent(row['recall'])} |"
        )
    if validation_runs:
        lines += [
            "",
            "## 검증 그룹의 신뢰도 임계값 탐색",
            "",
            "| 신뢰도 | 객체 정밀도 | 객체 재현율 | 정상 이미지 오탐률 |",
            "| ---: | ---: | ---: | ---: |",
        ]
        for validation in sorted(validation_runs, key=lambda item: item["settings"]["confidence"]):
            lines.append(
                f"| {validation['settings']['confidence']:.2f} | "
                f"{percent(validation['objects']['precision'])} | {percent(validation['objects']['recall'])} | "
                f"{percent(validation['normal_image_false_alarm_rate'])} |"
            )
        lines += [
            "",
            "신뢰도를 높이면 오탐이 줄지만 결함 재현율도 낮아집니다. 이 표는 검증 그룹의 탐색 결과이며, "
            "0.25 외 임계값의 독립 테스트 성능은 확인하지 않았습니다.",
        ]
    lines += [
        "",
        "## 해석 범위",
        "",
        "DeepPCB의 공개 연구 이미지에 대한 결과입니다. 합성 결함과 실제 생산 라인의 분포 차이가 있으며, "
        "현장 합격·불합격의 자동 판정 성능을 입증하지 않습니다. 검출 없음은 정상 판정이 아닙니다. "
        "임계값과 모델 개선은 검증 그룹에서 결정하고, 테스트 그룹은 최종 확인에만 사용해야 합니다.",
        "",
        "자세한 사례와 원시 수치는 `test-evaluation.json`을 확인하세요.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, default=Path("reports/test-evaluation.json"))
    parser.add_argument("--benchmark", type=Path)
    parser.add_argument("--validation", type=Path, nargs="*")
    parser.add_argument("--output", type=Path, default=Path("reports/analysis.md"))
    args = parser.parse_args()
    run = json.loads(args.run.read_text(encoding="utf-8"))
    evaluation = json.loads(args.evaluation.read_text(encoding="utf-8"))
    benchmark = json.loads(args.benchmark.read_text(encoding="utf-8")) if args.benchmark else None
    validation_runs = [json.loads(path.read_text(encoding="utf-8")) for path in args.validation or []]
    report = build_report(run, evaluation, benchmark, validation_runs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    print(args.output.resolve())


if __name__ == "__main__":
    main()
