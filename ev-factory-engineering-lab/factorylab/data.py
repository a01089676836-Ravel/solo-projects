"""Reject invalid batches before persisting; relational traceability in SQLite."""
import sqlite3
import numpy as np
import pandas as pd
from .simulation import STATIONS

MEASUREMENTS = ("torque_nm", "weld_ratio", "seal_kpa", "vibration_mm_s", "ambient_c")


def validate(units, events):
    """Check schemas, route order, queue math, keys, and cell capacity before storage."""
    required_u = {"unit_id", "day", "variant", "defect", "release_s", "complete_s",
                  "within_window", *MEASUREMENTS}
    required_e = {"unit_id", "day", "station", "cell", "start_s", "end_s", "wait_s"}
    if not required_u <= set(units) or not required_e <= set(events):
        raise ValueError("Missing required columns")
    if len(units) == 0 or units.isna().any().any() or events.isna().any().any():
        raise ValueError("Empty batch or missing values")
    for frame, non_numeric in ((units, {"unit_id", "variant"}), (events, {"unit_id", "station"})):
        for column in set(frame.columns) - non_numeric:
            if not pd.api.types.is_numeric_dtype(frame[column]):
                raise ValueError(f"Non-numeric column: {column}")
    for series in (units.day, events.day, events.cell):
        if not (series.ge(1) & series.mod(1).eq(0)).all():
            raise ValueError("Day/cell must be positive integers")
    if not units.within_window.isin([0, 1]).all():
        raise ValueError("Invalid window flag")
    if units.unit_id.duplicated().any() or events.duplicated(["unit_id", "station"]).any():
        raise ValueError("Duplicate primary key")
    if set(events.unit_id) != set(units.unit_id):
        raise ValueError("Orphan or missing unit events")
    if set(events.station) != set(STATIONS) or not events.groupby("unit_id").size().eq(4).all():
        raise ValueError("Incomplete route")
    if not units.defect.isin([0, 1]).all() or not units.variant.isin(["A", "B"]).all():
        raise ValueError("Invalid outcome or recipe")
    for frame in (units, events):
        numeric = frame.select_dtypes(include="number")
        if not np.isfinite(numeric.to_numpy()).all():
            raise ValueError("Non-finite values")
    if ((events.end_s <= events.start_s).any() or (events.wait_s < 0).any()
            or (events.start_s < 0).any() or (units.release_s < 0).any()):
        raise ValueError("Invalid event duration")
    joined = events.merge(units[["unit_id", "day"]], on="unit_id", suffixes=("", "_unit"))
    if not joined.day.eq(joined.day_unit).all():
        raise ValueError("Event day does not match unit")
    start = events.pivot(index="unit_id", columns="station", values="start_s")
    end = events.pivot(index="unit_id", columns="station", values="end_s")
    wait = events.pivot(index="unit_id", columns="station", values="wait_s")
    u = units.set_index("unit_id").loc[start.index]
    for previous, current in zip(STATIONS, STATIONS[1:]):
        if (start[current] < end[previous] - 1e-7).any():
            raise ValueError("Route precedence violated")
        if not np.allclose(wait[current], start[current] - end[previous]):
            raise ValueError("Inconsistent queue time")
    if not np.allclose(wait.FASTEN, start.FASTEN - u.release_s):
        raise ValueError("Inconsistent initial queue")
    if not np.allclose(end.EOL, u.complete_s):
        raise ValueError("Completion mismatch")
    for _, group in events.groupby(["day", "station", "cell"]):
        ordered = group.sort_values("start_s")
        if (ordered.start_s.to_numpy()[1:] < ordered.end_s.to_numpy()[:-1] - 1e-7).any():
            raise ValueError("Overlapping jobs on one cell")
    return {"units": len(units), "events": len(events), "status": "PASS",
            "checks": ["keys", "completeness", "finite_values", "route_order",
                       "queue_consistency", "resource_capacity", "completion"]}


def persist(units, events, path):
    """Validate the full batch, then replace the local relational snapshot."""
    validation = validate(units, events)
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("DROP TABLE IF EXISTS events")
        conn.execute("DROP TABLE IF EXISTS units")
        conn.execute("""CREATE TABLE units (
            unit_id TEXT PRIMARY KEY, day INTEGER, variant TEXT,
            torque_nm REAL, weld_ratio REAL, seal_kpa REAL,
            vibration_mm_s REAL, ambient_c REAL, defect INTEGER CHECK(defect IN (0,1)),
            release_s REAL, complete_s REAL, within_window INTEGER)""")
        conn.execute("""CREATE TABLE events (
            unit_id TEXT REFERENCES units(unit_id), day INTEGER, station TEXT,
            cell INTEGER, start_s REAL, end_s REAL, wait_s REAL,
            PRIMARY KEY(unit_id, station), CHECK(end_s > start_s))""")
        units.to_sql("units", conn, if_exists="append", index=False)
        events.to_sql("events", conn, if_exists="append", index=False)
        conn.execute("CREATE INDEX idx_events_day_station ON events(day,station)")
    return validation
