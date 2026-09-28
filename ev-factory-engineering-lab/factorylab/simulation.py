"""Synthetic component assembly, NOT a physical battery model or company process.

Four FIFO stations, unlimited inter-station buffers, parallel identical EOL
cells, no transport time/breakdowns. Random draws are shared across scenarios.
"""
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd

STATIONS = ("FASTEN", "WELD", "SEAL", "EOL")
NAMES = dict(zip(STATIONS, ("체결", "접합", "밀봉 검사", "최종 검사")))


@dataclass(frozen=True)
class Scenario:
    """Educational line settings; these values do not describe a real plant."""
    name: str = "baseline"
    eol_cells: int = 1
    variation: float = 1.0
    units: int = 180
    takt_s: float = 70.0

    def __post_init__(self):
        if (not isinstance(self.eol_cells, int) or self.eol_cells < 1
                or self.variation <= 0 or self.units < 1 or self.takt_s <= 0):
            raise ValueError("Invalid scenario parameters")


SCENARIOS = (
    Scenario(), Scenario("parallel_eol", eol_cells=2),
    Scenario("stable_process", variation=0.55),
    Scenario("combined", eol_cells=2, variation=0.55),
)


def simulate(seed=20260927, day=1, scenario=None):
    """Run one FIFO line day with deterministic random inputs for the given seed."""
    cfg = scenario or Scenario()
    rng = np.random.default_rng(seed)
    n = cfg.units
    variant = (rng.random(n) < 0.4).astype(int)
    z = rng.normal(size=(n, 8))
    failure_draw = rng.random(n)
    # Mild held-out drift; same material mix and disturbances for paired runs.
    drift = 0.4 if day >= 25 else (0.2 if day % 7 == 0 else 0.0)
    torque = 10 + (0.65 * z[:, 0] + drift) * cfg.variation
    energy = 1 + (0.11 * z[:, 1] + 0.02 * variant) * cfg.variation
    pressure = 100 + 3.5 * z[:, 2]
    vibration = np.maximum(0, 0.55 + 0.22 * z[:, 3])
    ambient = 25 + 3 * z[:, 4]
    # Hidden disturbance plus Bernoulli noise prevents exact label recovery.
    logit = (-4.0 + 2.5 * np.abs(torque - 10)
             + 10 * np.abs(energy - 1) + 0.1 * np.abs(pressure - 100)
             + 0.45 * vibration + 0.4 * z[:, 5])
    defect = (failure_draw < 1 / (1 + np.exp(-logit))).astype(int)
    units, events = [], []
    # Each station tracks its next free time; EOL may have multiple parallel cells.
    available = {s: [0.0] * (cfg.eol_cells if s == "EOL" else 1) for s in STATIONS}
    for i in range(n):
        uid = f"D{day:02d}-U{i + 1:04d}"
        release = i * cfg.takt_s
        arrival = release
        for j, station in enumerate(STATIONS):
            cell = min(range(len(available[station])), key=available[station].__getitem__)
            start = max(arrival, available[station][cell])
            base = (44, 53, 38, 78)[j] + (4, 5, 2, 8)[j] * variant[i]
            # Nonconforming EOL units occupy extra diagnostic time, then hold.
            duration = max(1.0, base + 3 * z[i, (j + 4) % 8])
            if station == "EOL":
                duration += 20 * defect[i]
            end = start + duration
            events.append(dict(unit_id=uid, day=day, station=station, cell=cell + 1,
                               start_s=start, end_s=end, wait_s=start - arrival))
            available[station][cell] = end
            arrival = end
        units.append(dict(unit_id=uid, day=day, variant="B" if variant[i] else "A",
                          torque_nm=torque[i], weld_ratio=energy[i],
                          seal_kpa=pressure[i], vibration_mm_s=vibration[i],
                          ambient_c=ambient[i], defect=int(defect[i]),
                          release_s=release, complete_s=arrival,
                          within_window=int(arrival <= n * cfg.takt_s)))
    return pd.DataFrame(units), pd.DataFrame(events)


def generate(days=30, seed=20260927):
    """Build independent daily lots while deriving each day's seed from the base seed."""
    runs = [simulate(seed + day, day) for day in range(1, days + 1)]
    return (pd.concat([r[0] for r in runs], ignore_index=True),
            pd.concat([r[1] for r in runs], ignore_index=True))


def configuration():
    """Return the seed and assumptions needed to identify the synthetic input."""
    return {"seed": 20260927, "days": 30, "baseline": asdict(Scenario()),
            "provenance": "100% synthetic; educational assumptions; no company data",
            "window_s": 12600, "station_order": list(STATIONS)}
