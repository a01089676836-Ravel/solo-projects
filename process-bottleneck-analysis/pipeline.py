"""Traceable BPI 2019 process mining. Python standard library only.

Commands: ingest, analyze, verify, all, serve. See README.md for definitions.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data/raw/BPI_Challenge_2019.xes"
DB = ROOT / "data/events.sqlite"
REPORTS = ROOT / "reports"
CATEGORY = "3-way match, invoice before GR"
CREATE = "Create Purchase Order Item"
GR = "Record Goods Receipt"
IR = "Record Invoice Receipt"
CLEAR = "Clear Invoice"
DAY = 86_400_000_000
FORBIDDEN = {"Cancel Goods Receipt", "Cancel Invoice Receipt", "Delete Purchase Order Item"}
METADATA_URL = "https://api.figshare.com/v2/articles/12715853"


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def digest_file(path, algorithms=("sha256",)):
    hashes = {a: hashlib.new(a) for a in algorithms}
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            for h in hashes.values():
                h.update(chunk)
    return {a: h.hexdigest() for a, h in hashes.items()}


def timestamp(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.utcoffset() is None:
        raise ValueError("Timezone is required")
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = dt.astimezone(timezone.utc) - epoch
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def iso(value):
    return datetime.fromtimestamp(value / 1_000_000, timezone.utc).isoformat()


def attrs(element):
    return {child.get("key"): child.get("value") for child in element if child.get("key")}


def read_traces(path):
    """Stream complete traces; never sample the first N events of a case."""
    context = ET.iterparse(path, events=("start", "end"))
    _, root = next(context)
    for action, element in context:
        if action == "end" and element.tag.rsplit("}", 1)[-1] == "trace":
            meta = attrs(element)
            events = []
            for child in element:
                if child.tag.rsplit("}", 1)[-1] != "event":
                    continue
                row = attrs(child)
                if not row.get("concept:name") or not row.get("time:timestamp"):
                    raise ValueError(f"Missing required event field in {meta.get('concept:name')}")
                events.append({"activity": row["concept:name"], "ts": timestamp(row["time:timestamp"]),
                               "source_order": len(events)})
            if not meta.get("concept:name") or not events:
                raise ValueError("Empty case ID or trace")
            yield meta, events
            root.clear()


def ingest(raw=RAW, db=DB, metadata=None):
    start = time.monotonic()
    raw, db = Path(raw), Path(db)
    metadata = metadata or json.loads((ROOT / "data/raw/source-metadata.json").read_text(encoding="utf-8"))
    source = next(f for f in metadata["files"] if f["name"] == "BPI_Challenge_2019.xes")
    hashes = digest_file(raw, ("sha256", "md5"))
    if raw.stat().st_size != source["size"] or hashes["md5"] != source["computed_md5"]:
        raise ValueError("Original file size/MD5 mismatch; ingestion refused")
    db.parent.mkdir(parents=True, exist_ok=True)
    staging = db.with_suffix(".building")
    if staging.exists():
        raise RuntimeError(f"Unfinished import exists: {staging}; inspect before retrying")
    conn = sqlite3.connect(staging)
    conn.executescript("""
        PRAGMA journal_mode=DELETE;
        CREATE TABLE cases(case_id TEXT PRIMARY KEY, document TEXT, category TEXT NOT NULL,
            company TEXT, vendor TEXT, first_us INTEGER, last_us INTEGER, event_count INTEGER NOT NULL,
            reordered INTEGER, tied_pairs INTEGER, duplicate_candidates INTEGER);
        CREATE TABLE events(case_id TEXT NOT NULL REFERENCES cases(case_id), seq INTEGER NOT NULL,
            source_order INTEGER NOT NULL, activity TEXT NOT NULL, ts_us INTEGER NOT NULL,
            PRIMARY KEY(case_id,seq));
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    counts = Counter()
    categories = Counter()
    try:
        for meta, original in read_traces(raw):
            events = sorted(original, key=lambda e: (e["ts"], e["source_order"]))
            duplicate = len(events) - len({(e["activity"], e["ts"]) for e in events})
            ties = sum(a["ts"] == b["ts"] for a, b in zip(events, events[1:]))
            reordered = int(events != original)
            case_id = meta["concept:name"]
            category = meta.get("Item Category", "UNKNOWN")
            conn.execute("INSERT INTO cases VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                case_id, meta.get("Purchasing Document"), category, meta.get("Company"), meta.get("Vendor"),
                events[0]["ts"], events[-1]["ts"], len(events), reordered, ties, duplicate))
            conn.executemany("INSERT INTO events VALUES(?,?,?,?,?)", [
                (case_id, i, e["source_order"], e["activity"], e["ts"]) for i, e in enumerate(events)])
            counts.update(cases=1, events=len(events), reordered_cases=reordered,
                          tied_pairs=ties, duplicate_candidates=duplicate)
            categories[category] += 1
            if counts["cases"] % 50000 == 0:
                conn.commit()
                print(f"Imported {counts['cases']:,} cases / {counts['events']:,} events", flush=True)
        if (counts["cases"], counts["events"]) != (251734, 1595923):
            raise ValueError(f"Source total mismatch: {dict(counts)}")
        manifest = {"created_utc": utc_now(), "source_metadata_api": METADATA_URL,
                    "citation": metadata["citation"], "license": metadata["license"],
                    "source_version": metadata["version"], "download_url": source["download_url"],
                    "source_bytes": raw.stat().st_size, **hashes, "counts": dict(counts),
                    "categories": dict(categories), "python": platform.python_version(),
                    "sqlite": sqlite3.sqlite_version, "code_sha256": digest_file(Path(__file__))["sha256"],
                    "policy": "Keep repeated events; UTC ordering; original order breaks timestamp ties",
                    "duration_seconds": round(time.monotonic() - start, 2)}
        conn.execute("INSERT INTO metadata VALUES('manifest',?)", (json.dumps(manifest),))
        conn.execute("CREATE INDEX case_category ON cases(category)")
        conn.commit()
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        conn.close()
        staging.replace(db)
        save_json(REPORTS / "data-manifest.json", manifest)
        print(json.dumps({"status": "imported", **dict(counts)}, ensure_ascii=False), flush=True)
        return manifest
    except Exception:
        conn.close()
        # Preserve the staging database for diagnosis; do not overwrite the last good DB.
        raise


def percentile(values, q):
    """Linear interpolation, equivalent to common type-7 quantiles."""
    if not values:
        return None
    xs = sorted(values)
    pos = (len(xs) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def stats(values):
    values = list(values)
    return {"n": len(values), "median_days": percentile(values, .5), "p90_days": percentile(values, .9),
            "mean_days": sum(values) / len(values) if values else None}


def assess_case(events):
    """Eligibility is structural, not proof that a purchase item is fully paid."""
    counts = Counter(e["activity"] for e in events)
    reasons = []
    for name in (CREATE, GR, IR, CLEAR):
        if counts[name] != 1:
            reasons.append(f"{name}:count={counts[name]}")
    if FORBIDDEN & counts.keys():
        reasons.append("cancellation_or_deletion")
    if reasons:
        return None, reasons
    anchors = {e["activity"]: e["ts"] for e in events if e["activity"] in (CREATE, GR, IR, CLEAR)}
    if not (anchors[CREATE] <= anchors[GR] <= anchors[CLEAR] and
            anchors[CREATE] <= anchors[IR] <= anchors[CLEAR]):
        return None, ["anchor_order_inconsistent"]
    window = [e for e in events if anchors[CREATE] <= e["ts"] <= anchors[CLEAR]]
    return {"anchors": anchors, "events": window,
            "cycle_days": (anchors[CLEAR] - anchors[CREATE]) / DAY}, []


def scenario(cases, source, target, reduction):
    if not math.isfinite(reduction) or not 0 <= reduction <= 1:
        raise ValueError("Reduction must be between 0 and 1")
    baseline, changed, affected = [], [], 0
    for case in cases:
        amount = sum((b["ts"] - a["ts"]) / DAY for a, b in zip(case["events"], case["events"][1:])
                     if a["activity"] == source and b["activity"] == target)
        baseline.append(case["cycle_days"])
        changed.append(max(0, case["cycle_days"] - amount * reduction))
        affected += amount > 0
    before, after = stats(baseline), stats(changed)
    return {"reduction_fraction": reduction, "affected_cases": affected, "baseline": before,
            "counterfactual": after,
            "median_reduction_days": (before["median_days"] - after["median_days"]) if baseline else None,
            "assumption": "Selected adjacent elapsed intervals shrink; all other intervals and cases stay fixed",
            "claim_type": "assumption_based_sensitivity_not_realized_savings"}


def readonly(db):
    return sqlite3.connect(Path(db).resolve().as_uri() + "?mode=ro", uri=True)


def load_category(conn, category):
    cursor = conn.execute("""SELECT c.case_id,c.company,c.vendor,c.duplicate_candidates,e.seq,e.activity,e.ts_us,e.source_order
        FROM cases c JOIN events e USING(case_id) WHERE c.category=? ORDER BY c.case_id,e.seq""", (category,))
    current, events, meta = None, [], None
    for cid, company, vendor, duplicates, seq, activity, ts, original in cursor:
        if current is not None and current != cid:
            yield meta, events
            events = []
        current = cid
        meta = {"case_id": cid, "company": company, "vendor": vendor, "duplicate_candidates": duplicates}
        events.append({"activity": activity, "ts": ts, "seq": seq, "source_order": original})
    if current is not None:
        yield meta, events


def analyze(db=DB, category=CATEGORY, reports=REPORTS):
    conn = readonly(db)
    manifest = json.loads(conn.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    inventory = dict(conn.execute("SELECT category,COUNT(*) FROM cases GROUP BY category"))
    if category not in inventory:
        raise ValueError(f"Unknown category. Available: {list(inventory)}")
    eligible, exclusions, audits, exclusion_groups = [], Counter(), Counter(), Counter()
    all_ids = []
    for meta, events in load_category(conn, category):
        case, reasons = assess_case(events)
        # Ambiguous duplicate candidates are preserved in DB, excluded from the comparison cohort.
        if meta["duplicate_candidates"]:
            reasons.append("duplicate_event_candidate")
        if reasons:
            exclusions.update(reasons)
            groups = set()
            names = {CREATE:"구매 항목 생성", GR:"입고", IR:"송장 접수", CLEAR:"지급"}
            for reason in reasons:
                if ":count=" in reason:
                    name, count = reason.split(":count=")
                    groups.add(names[name] + (" 기록 없음" if int(count)==0 else " 기록 여러 건"))
                else:
                    groups.add({"cancellation_or_deletion":"취소 또는 삭제 기록", "duplicate_event_candidate":"동일 활동·동일 시각 기록 존재", "anchor_order_inconsistent":"핵심 이벤트 시간 순서 불일치"}[reason])
            exclusion_groups.update(groups)
            audits["excluded_cases"] += 1
            all_ids.append((meta["case_id"], False, reasons))
            continue
        case.update(meta)
        eligible.append(case)
        all_ids.append((meta["case_id"], True, []))
        audits["events_outside_anchor_window"] += len(events) - len(case["events"])
        audits["cohort_tied_pairs"] += sum(a["ts"] == b["ts"] for a,b in zip(case["events"],case["events"][1:]))
    conn.close()
    if not eligible:
        raise ValueError("No eligible cases; do not emit misleading zero metrics")
    edges, variants, groups = defaultdict(list), Counter(), defaultdict(list)
    evidence = defaultdict(list)
    for c in eligible:
        variants[tuple(e["activity"] for e in c["events"])] += 1
        groups[c["company"]].append(c["cycle_days"])
        for a,b in zip(c["events"], c["events"][1:]):
            edge = (a["activity"], b["activity"])
            gap = (b["ts"] - a["ts"]) / DAY
            edges[edge].append(gap)
            evidence[edge].append({"case_id": c["case_id"], "from_seq": a["seq"], "to_seq": b["seq"],
                                   "from_utc": iso(a["ts"]), "to_utc": iso(b["ts"]), "elapsed_days": gap})
    edge_rows = [{"source": a, "target": b, **stats(vals), "total_case_days": sum(vals),
                  "case_count": len({x["case_id"] for x in evidence[(a,b)]}),
                  "zero_gap_occurrences": sum(v == 0 for v in vals),
                  "evidence": sorted(evidence[(a,b)], key=lambda x: (-x["elapsed_days"], x["case_id"]))[:5]}
                 for (a,b),vals in edges.items()]
    edge_rows.sort(key=lambda x: (-x["total_case_days"], x["source"], x["target"]))
    # Minimum support avoids elevating a rare long-duration pair as the sole improvement target.
    candidates = [e for e in edge_rows if e["case_count"] >= 30 and e["total_case_days"] > 0]
    target = candidates[0] if candidates else None
    cycles = [c["cycle_days"] for c in eligible]
    activity_counts = Counter(e["activity"] for c in eligible for e in c["events"])
    price_changed = [c for c in eligible if any(e["activity"] == "Change Price" for e in c["events"])]
    out = {"created_utc": utc_now(), "analysis_version": 1,
           "source_sha256": manifest["sha256"], "code_sha256": digest_file(Path(__file__))["sha256"],
           "source_cases": manifest["counts"]["cases"], "source_events": manifest["counts"]["events"],
           "category": category, "category_cases": inventory[category], "eligible_cases": len(eligible),
           "excluded_cases": audits["excluded_cases"], "exclusion_reasons_nonexclusive": dict(exclusions),
           "exclusion_groups_nonexclusive": dict(sorted(exclusion_groups.items())),
           "categories": inventory, "cycle": stats(cycles), "audit": dict(audits),
           "period_utc": {"first_create": iso(min(c["anchors"][CREATE] for c in eligible)),
                          "last_clear": iso(max(c["anchors"][CLEAR] for c in eligible))},
           "activity_counts": dict(activity_counts), "edges": edge_rows,
           "variant_count": len(variants),
           "top_variants": [{"activities": list(k), "cases": v} for k,v in variants.most_common(10)],
           "company_groups": [{"company": k, **stats(v)} for k,v in sorted(groups.items())],
           "price_change_cases": len(price_changed), "price_change_rate": len(price_changed)/len(eligible),
           "price_change_groups": {"with_change": stats(c["cycle_days"] for c in price_changed),
                 "without_change": stats(c["cycle_days"] for c in eligible if not any(e["activity"] == "Change Price" for e in c["events"]))},
           "scenario_target": {"source": target["source"], "target": target["target"]} if target else None,
           "scenarios": [scenario(eligible,target["source"],target["target"],r) for r in (0,.1,.2,.3)] if target else [],
           "limits": ["이벤트 간 경과시간은 순수 대기시간·작업시간 또는 낭비를 뜻하지 않습니다.",
                      "단일 생성·입고·송장·지급 기록이 있는 사례만 비교합니다. 전체 구매를 대표하지 않습니다.",
                      "한 번의 Clear Invoice는 금액 대사나 최종 완납을 증명하지 않습니다.",
                      "동시각 이벤트 순서는 원본 순서를 보존하며 실제 선후관계를 입증하지 않습니다.",
                      "반복 입고·송장은 정상 분할 처리일 수 있습니다. 오류·재작업으로 단정하지 않습니다.",
                      "기간 말 미지급 사례 제외에 따른 선택 편향과 관측기간 제한이 있습니다.",
                      "시나리오는 다른 구간 고정이라는 가정의 산술 민감도 분석입니다. 실제 절감·인과 효과가 아닙니다.",
                      "지급조건·계약 납기·서비스 시간 정보가 없어 경과시간이 긴 이유를 확정할 수 없습니다."]}
    reports = Path(reports)
    save_json(reports / "analysis.json", out)
    save_json(reports / "cohort-membership.json", [{"case_id": c,"eligible": e,"reasons": r} for c,e,r in all_ids])
    save_json(reports / "evidence-cases.json", evidence_cases(eligible, target))
    write_report(out, reports)
    print(json.dumps({"status":"analyzed","category":category,"eligible_cases":len(eligible),"cycle":out["cycle"],"target":out["scenario_target"]},ensure_ascii=False))
    return out


def evidence_cases(cases, target):
    if not target:
        return []
    ids = {e["case_id"] for e in target["evidence"]}
    return [{"case_id": c["case_id"], "company": c["company"], "cycle_days": c["cycle_days"],
             "events": [{**e, "utc": iso(e["ts"])} for e in c["events"]]} for c in cases if c["case_id"] in ids]


def write_report(out, reports):
    n = out["eligible_cases"]
    lines = ["# 구매 업무 병목 후보 분석 결과", "", f"생성 시각: {out['created_utc']}", "",
             f"공식 원본: {out['source_cases']:,} cases / {out['source_events']:,} events.",
             f"유형: `{out['category']}` — {out['category_cases']:,}건 중 비교 코호트 {n:,}건, 제외 {out['excluded_cases']:,}건.", "",
             "## 관측 결과", "", f"주문 항목 생성 → 지급 기록 경과시간: 중앙값 **{out['cycle']['median_days']:.2f}일**, P90 **{out['cycle']['p90_days']:.2f}일**.",
             f"가격 변경 기록이 있는 사례: {out['price_change_cases']:,}건 ({out['price_change_rate']:.2%}). 오류나 불필요한 재작업으로 확정하지 않음.", "",
             "| 인접 활동 | 발생 수 | 중앙값(일) | 누적 사례·일 |", "|---|---:|---:|---:|"]
    for e in out["edges"][:10]:
        lines.append(f"| {e['source']} → {e['target']} | {e['n']:,} | {e['median_days']:.2f} | {e['total_case_days']:.2f} |")
    lines += ["", "누적 사례·일은 사례별 구간 경과시간의 합입니다. 공장 가동일·노동시간·회수 가능한 비용이 아닙니다.",
              "", "## 가정 기반 개선 민감도", "", "최소 30개 사례에 나타난 구간 중 누적 경과시간이 가장 큰 구간을 조사 후보로 선정합니다.",
              f"선택 구간: `{out['scenario_target']}`", "", "| 구간 단축 가정 | 전체 코호트 중앙값(일) | 중앙값 차이(일) |", "|---|---:|---:|"]
    for s in out["scenarios"]:
        lines.append(f"| {s['reduction_fraction']:.0%} | {s['counterfactual']['median_days']:.2f} | {s['median_reduction_days']:.2f} |")
    lines += ["", "실행 제안: 해당 구간의 계약 지급조건·배치 실행 주기·예외 보류 사유를 확인한 뒤 변경 가능한 시간을 구분합니다.",
              "현장 검증: 비교 가능한 업무 집단과 관측기간을 정하고 중앙값·P90·오류율을 함께 측정합니다.",
              "", "## 근거 및 한계", "", "원본 해시: `"+out['source_sha256']+"`", "",
              "`analysis.json`에 전체 전이·사례 근거, `cohort-membership.json`에 사례별 포함/제외 사유, `evidence-cases.json`에 대표 사례 타임라인이 있습니다.", ""]
    lines += ["- " + x for x in out["limits"]]
    lines += ["", "출처: van Dongen, Boudewijn (2019). BPI Challenge 2019. 4TU.ResearchData. CC BY 4.0.",
              "https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1", ""]
    (reports / "analysis.md").write_text("\n".join(lines), encoding="utf-8")


def verify(db=DB, reports=REPORTS):
    """Independent SQL checks of provenance, cohort anchors and sampled edge evidence."""
    reports = Path(reports)
    out = json.loads((reports / "analysis.json").read_text(encoding="utf-8"))
    membership = json.loads((reports / "cohort-membership.json").read_text(encoding="utf-8"))
    conn = readonly(db)
    checks = {}
    checks["sqlite_integrity"] = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    checks["source_counts"] = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 251734 and conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1595923
    checks["case_event_totals"] = conn.execute("SELECT SUM(event_count) FROM cases").fetchone()[0] == 1595923
    checks["category_accounting"] = out["eligible_cases"] + out["excluded_cases"] == out["category_cases"] == len(membership)
    # Re-derive the cohort with SQL, independent of assess_case and membership output.
    rows = conn.execute("""SELECT c.case_id,
        MIN(CASE WHEN e.activity=? THEN e.ts_us END) AS created,
        MIN(CASE WHEN e.activity=? THEN e.ts_us END) AS received,
        MIN(CASE WHEN e.activity=? THEN e.ts_us END) AS invoiced,
        MIN(CASE WHEN e.activity=? THEN e.ts_us END) AS cleared
        FROM cases c JOIN events e USING(case_id)
        WHERE c.category=? AND c.duplicate_candidates=0 GROUP BY c.case_id
        HAVING SUM(e.activity=?)=1 AND SUM(e.activity=?)=1 AND SUM(e.activity=?)=1 AND SUM(e.activity=?)=1
        AND SUM(e.activity IN ('Cancel Goods Receipt','Cancel Invoice Receipt','Delete Purchase Order Item'))=0
        AND created<=received AND received<=cleared AND created<=invoiced AND invoiced<=cleared""",
        (CREATE,GR,IR,CLEAR,out["category"],CREATE,GR,IR,CLEAR)).fetchall()
    checks["independent_sql_cohort"] = {r[0] for r in rows} == {m["case_id"] for m in membership if m["eligible"]}
    import statistics
    checks["independent_median"] = abs(statistics.median((r[4]-r[1])/DAY for r in rows)-out["cycle"]["median_days"]) < 1e-9
    edge_total = sum(e["total_case_days"] for e in out["edges"])
    checks["elapsed_partition"] = math.isclose(edge_total, sum((r[4]-r[1])/DAY for r in rows), rel_tol=1e-10)
    evidence_ok = True
    evidence_n = 0
    for edge in out["edges"]:
        for ref in edge["evidence"]:
            pair = conn.execute("SELECT activity,ts_us,seq FROM events WHERE case_id=? AND seq IN (?,?) ORDER BY seq",
                                (ref["case_id"],ref["from_seq"],ref["to_seq"])).fetchall()
            evidence_ok &= (len(pair)==2 and pair[1][2]==pair[0][2]+1 and pair[0][0]==edge["source"] and
                            pair[1][0]==edge["target"] and abs((pair[1][1]-pair[0][1])/DAY-ref["elapsed_days"])<1e-9)
            evidence_n += 1
    checks["all_reported_edge_evidence"] = bool(evidence_ok)
    checks["scenario_zero_identity"] = not out["scenarios"] or out["scenarios"][0]["baseline"] == out["scenarios"][0]["counterfactual"]
    manifest = json.loads(conn.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    checks["source_hash_link"] = out["source_sha256"] == manifest["sha256"]
    checks["analysis_code_current"] = out["code_sha256"] == digest_file(Path(__file__))["sha256"]
    conn.close()
    result = {"created_utc":utc_now(),"checks":checks,"passed":all(checks.values()),"evidence_pairs_checked":evidence_n,
              "scope":"SQL re-derivation and all emitted edge references; not a proof of business causality"}
    save_json(reports / "verification.json", result)
    print(json.dumps(result,ensure_ascii=False))
    if not result["passed"]:
        raise AssertionError("Verification failed")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["ingest","analyze","verify","all","serve"])
    parser.add_argument("--category",default=CATEGORY)
    parser.add_argument("--port",type=int,default=8770)
    args = parser.parse_args()
    if args.command in ("ingest","all"):
        ingest()
    if args.command in ("analyze","all"):
        analyze(category=args.category)
    if args.command in ("verify","all"):
        verify()
    if args.command == "serve":
        from server import serve
        serve(args.port)


if __name__ == "__main__":
    main()
