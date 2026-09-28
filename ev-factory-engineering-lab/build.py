"""Regenerate all project outputs. Run from any working directory."""
import hashlib
import json
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
import sklearn
from factorylab.simulation import generate, configuration
from factorylab.data import persist
from factorylab.modeling import fit_evaluate
from factorylab.engineering import experiments, station_summary, workflow
from factorylab.edge import predict

ROOT = Path(__file__).resolve().parent


def dump(path, value):
    """Write strict UTF-8 JSON so non-finite numeric results are rejected."""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def digest(path):
    """Return a SHA-256 checksum for one reproducibility-manifest input."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    """Generate synthetic inputs, fit/evaluate the model, and write review artifacts."""
    raw, out = ROOT / "data" / "raw", ROOT / "output"
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(exist_ok=True)
    print("[1/5] Generating 30 synthetic production lots", flush=True)
    units, events = generate()
    units.to_csv(raw / "units.csv", index=False)
    events.to_csv(raw / "events.csv", index=False)
    dump(raw / "simulation_config.json", configuration())
    # Read persisted source CSVs, rather than analyzing unrecorded in-memory input.
    units, events = pd.read_csv(raw / "units.csv"), pd.read_csv(raw / "events.csv")
    validation = persist(units, events, out / "factory.sqlite")
    dump(out / "validation.json", validation)
    print("[2/5] Train-only preprocessing / temporal holdout", flush=True)
    model, metrics, scored = fit_evaluate(units)
    dump(out / "model.json", model)
    dump(out / "model_metrics.json", metrics)
    scored.to_csv(out / "scored_units.csv", index=False)
    stations = station_summary(events)
    pd.DataFrame(stations).to_csv(out / "stations.csv", index=False)
    print("[3/5] Four scenarios x 30 paired runs", flush=True)
    scenarios, runs = experiments()
    pd.DataFrame(scenarios).to_csv(out / "scenarios.csv", index=False)
    pd.DataFrame(runs).to_csv(out / "experiment_runs.csv", index=False)
    steps = workflow(stations, metrics, scenarios)
    dump(out / "workflow_trace.json", steps)
    daily = []
    for (day, variant), group in scored.groupby(["day", "variant"]):
        daily.append(dict(day=int(day), variant=variant, units=len(group), defects=int(group.defect.sum()),
                          completed=int(group.within_window.sum()),
                          mean_lead_s=float((group.complete_s - group.release_s).mean())))
    pd.DataFrame(daily).to_csv(out / "daily_kpis.csv", index=False)
    sample = scored.loc[scored.split.eq("test")].iloc[0].to_dict()
    example = {k: sample[k] for k in ("unit_id", "variant", "torque_nm", "weld_ratio", "seal_kpa", "vibration_mm_s", "ambient_c")}
    (ROOT / "examples").mkdir(exist_ok=True)
    dump(ROOT / "examples" / "unit.json", example)
    predict(example, model)
    timings = []
    for _ in range(500):
        start = time.perf_counter_ns()
        predict(example, model)
        timings.append((time.perf_counter_ns() - start) / 1e6)
    benchmark = {"platform": platform.platform(), "python": platform.python_version(),
                 "device": "local Windows CPU; not Jetson", "repetitions": 500,
                 "median_ms": float(np.median(timings)), "p95_ms": float(np.quantile(timings, .95)),
                 "scope": "warm single-row feature transform + scoring + explanation; excludes I/O/model loading"}
    dump(out / "edge_benchmark.json", benchmark)
    print("[4/5] Portable dashboard and source manifest", flush=True)
    report = dict(title="EV Factory Lab", provenance="모든 데이터·수치·SOP는 교육용 모의 데이터입니다.",
                  validation=validation, metrics=metrics, scenarios=scenarios, stations=stations,
                  daily=daily, workflow=steps, benchmark=benchmark,
                  units=scored.round(6).to_dict("records"), events=events.round(4).to_dict("records"))
    (out / "report.js").write_text("window.FACTORY_REPORT = " + json.dumps(report, ensure_ascii=False, allow_nan=False) + ";\n", encoding="utf-8")
    shutil.copyfile(ROOT / "web" / "index.html", out / "index.html")
    source_files = sorted([p for p in ROOT.rglob("*") if p.is_file()
                           and not any(part in ("output", "__pycache__", ".git", ".venv") for part in p.relative_to(ROOT).parts)])
    manifest = dict(created_utc=datetime.now(timezone.utc).isoformat(), seed=20260927,
                    environment={"python": sys.version, "numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__},
                    files={str(p.relative_to(ROOT)).replace("\\", "/"): digest(p) for p in source_files},
                    model_sha256=digest(out / "model.json"),
                    limits=["Synthetic data only", "No company-internal data or process settings",
                            "No live sensors, PLC, camera or Jetson hardware validation",
                            "Rule-based workflow; no LLM integration", "Simulation improvement is not plant improvement"])
    dump(out / "manifest.json", manifest)
    test = metrics["test"]
    combined = scenarios[-1]
    summary = f"""# 실행 결과 — 모의 데이터 전용

30개 생산구간, {len(units):,}개 부품, {len(events):,}개 공정 이벤트를 생성·검증했습니다.

## SDF 데이터 분석
- 학습 1–18일 / 검증 19–24일 / 최종 시험 25–30일. 동일 일자 분리 없음.
- 검증 세트에서 결정한 임계값: {metrics['threshold']:.2f}
- 시험 AP: {test['average_precision']:.3f} (불량 비율/무작위 순위 기준 {test['prevalence']:.3f})
- 시험 Recall {test['recall']:.3f}, Precision {test['precision']:.3f}, F1 {test['f1']:.3f}
- 추가 검토 후보 {test['review_rate']:.1%}. 30% 검토 용량 가정을 충족한다고 단정할 수 없습니다.
- TP {test['tp']}, FP {test['fp']}, FN {test['fn']}, TN {test['tn']}. 최종검사를 대체하지 않습니다.
- 가중 로지스틱 점수는 보정된 불량 확률이 아닙니다.

## 전동화 생산기술
- 210분/180개 투입 가정, 체결→접합→밀봉검사→EOL의 교육용 공정.
- 결합 개선안: EOL 검사 셀 1→2, 체결·접합 측정 편차 45% 축소를 가정.
- 30쌍 모의 실험에서 구간 내 완료량 차이 평균 {combined['completed_delta']:+.2f}개.
- 차이의 근사 95% Monte Carlo 평균 신뢰구간 {combined['completed_delta_ci']}.
- 최초검사 합격률 차이 {combined['first_pass_yield_delta'] * 100:+.2f}%p.
- 현장 개선율, 투자 회수, 실물 배터리 품질을 입증한 결과가 아닙니다.

## 경량 추론
- Windows CPU, 500회 warm 호출 중간값 {benchmark['median_ms']:.4f} ms.
- 파일 읽기·모델 로딩 제외. Jetson 성능은 측정하지 않았습니다.

전체 수치: model_metrics.json / experiment_runs.csv / edge_benchmark.json.
검증 실행: python verify.py. 대시보드: index.html.
"""
    (out / "RESULTS.md").write_text(summary, encoding="utf-8")
    print("[5/5] Complete. Open output/index.html. Run python verify.py", flush=True)


if __name__ == "__main__":
    main()
