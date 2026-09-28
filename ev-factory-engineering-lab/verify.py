"""Run verification and persist actual results, not prewritten pass claims."""
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"))
result = unittest.TextTestRunner(verbosity=2).run(suite)
report = {"executed_utc": datetime.now(timezone.utc).isoformat(), "tests_run": result.testsRun,
          "failures": len(result.failures), "errors": len(result.errors),
          "skipped": len(result.skipped), "passed": result.wasSuccessful(),
          "details": [{"test": str(t), "trace": trace} for t, trace in result.failures + result.errors]}
(ROOT / "output/verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
sys.exit(0 if result.wasSuccessful() else 1)
