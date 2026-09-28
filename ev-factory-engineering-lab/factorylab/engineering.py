"""Paired simulation experiments and evidence-linked review suggestions."""
import numpy as np
from .simulation import simulate, SCENARIOS, STATIONS, NAMES

LABELS = {"baseline": "현재 모의 라인", "parallel_eol": "EOL 검사 셀 1→2",
          "stable_process": "체결·접합 편차 45% 축소", "combined": "검사 셀 증설 + 편차 축소"}


def kpis(units, events, horizon):
    """Compute completed volume, quality, lead time, queue time, and horizon overrun."""
    complete = units.complete_s <= horizon
    return dict(completed=int(complete.sum()), good_completed=int((complete & units.defect.eq(0)).sum()),
                first_pass_yield=float(1 - units.defect.mean()),
                p95_lead_s=float(np.quantile(units.complete_s - units.release_s, .95)),
                p95_wait_s=float(np.quantile(events.wait_s, .95)),
                overtime_s=float(max(0, units.complete_s.max() - horizon)))


def experiments(repeats=30):
    """Compare scenarios on shared seeds so each difference is paired by replicate."""
    records = []
    for rep in range(repeats):
        for cfg in SCENARIOS:
            units, events = simulate(seed=89000 + rep, day=25, scenario=cfg)
            records.append(dict(replicate=rep, scenario=cfg.name,
                                **kpis(units, events, cfg.units * cfg.takt_s)))
    summaries = []
    keys = ("completed", "good_completed", "first_pass_yield", "p95_lead_s", "overtime_s")
    baseline = [r for r in records if r["scenario"] == "baseline"]
    for cfg in SCENARIOS:
        rows = [r for r in records if r["scenario"] == cfg.name]
        summary = dict(name=cfg.name, label=LABELS[cfg.name], eol_cells=cfg.eol_cells,
                       variation=cfg.variation, repeats=repeats)
        for key in keys:
            values = np.asarray([r[key] for r in rows])
            differences = values - np.asarray([r[key] for r in baseline])
            margin = 1.96 * differences.std(ddof=1) / np.sqrt(repeats)
            summary[key] = float(values.mean())
            summary[key + "_delta"] = float(differences.mean())
            summary[key + "_delta_ci"] = [float(differences.mean() - margin), float(differences.mean() + margin)]
        summaries.append(summary)
    return summaries, records


def station_summary(events):
    """Report processing time and queue time separately for each simulated station."""
    rows = []
    for station in STATIONS:
        group = events[events.station == station]
        ct = group.end_s - group.start_s
        rows.append(dict(station=station, label=NAMES[station], mean_ct_s=float(ct.mean()),
                         p95_ct_s=float(ct.quantile(.95)), mean_wait_s=float(group.wait_s.mean()),
                         p95_wait_s=float(group.wait_s.quantile(.95)), takt_s=70))
    return rows


def workflow(stations, model_result, scenarios):
    """Create review suggestions linked to reports; these steps do not control equipment."""
    bottleneck = max(stations, key=lambda r: r["mean_ct_s"])
    selected = next(r for r in scenarios if r["name"] == "parallel_eol")
    return [
        {"step": "01 · 데이터 검증", "tool": "validate → SQLite", "evidence": "output/validation.json",
         "finding": "제품 키·공정 순서·셀 중복 점유를 검증한 데이터만 분석", "sop": "SOP-DATA-01"},
        {"step": "02 · 병목 후보", "tool": "SQL + 공정 CT 집계", "evidence": "output/stations.csv",
         "finding": f"{bottleneck['station']} 평균 CT {bottleneck['mean_ct_s']:.1f}초 / 가정 택트 70초",
         "sop": "SOP-FLOW-01"},
        {"step": "03 · 모의 개선안", "tool": "paired_simulation(30 seeds)", "evidence": "output/scenarios.csv",
         "finding": f"EOL 셀 1→2의 모의 구간 완료량 차이 {selected['completed_delta']:+.1f}개; 현장 효과 미검증",
         "sop": "SOP-EOL-01"},
        {"step": "04 · 검토 용량", "tool": "held-out classifier evaluation", "evidence": "output/model_metrics.json",
         "finding": f"고정 임계값 테스트 검토율 {model_result['test']['review_rate']:.1%}; 용량 가정 30%와 비교 필요",
         "sop": "SOP-QUALITY-01"},
        {"step": "05 · 담당자 검토", "tool": "human review", "evidence": "docs/control-plan.csv",
         "finding": "교육용 규칙 워크플로. 설비 제어·검사 생략·자동 레시피 변경 없음. LLM 미연결.",
         "sop": "SOP-HUMAN-01"},
    ]
