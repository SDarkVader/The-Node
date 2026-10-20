"""Unit tests for the accounted-study analysis (no model, no network, no bridge)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from inspect_node import analyze_study as A


def record(arm: str, rate, status="completed", eligible=6):
    executed = 0 if rate is None else round(rate * eligible)
    return {"status": status, "finalStateHash": "h", "eventsDigest": "d",
            "construct": {"arm": arm, "executedRate": rate, "counts": {"executed": executed},
                          "denominators": {"eligible": eligible, "attempted": executed, "admitted": executed, "effective": executed}}}


class AnalyzeTests(unittest.TestCase):
    def test_bootstrap_is_deterministic_and_needs_two_points(self):
        self.assertIsNone(A.bootstrap([1.0], 1))
        self.assertEqual(A.bootstrap([0.0, 1.0, 0.5], 7), A.bootstrap([0.0, 1.0, 0.5], 7))
        lo, hi = A.bootstrap([0.0, 1.0, 0.5, 0.5], 7)
        self.assertLessEqual(lo, hi)

    def test_resumed_runs_count_each_episode_once_and_exclude_interrupted_attempts(self):
        with tempfile.TemporaryDirectory() as d:
            run1, run2 = Path(d, "run-1"), Path(d, "run-2")
            for run, files in ((run1, {"council-r1": record("council", 1.0), "anonymous-r1": record("anonymous", None, "inference_failed")}),
                               (run2, {"anonymous-r1-a2": record("anonymous", 0.0), "none-r1": record("none", 0.0)})):
                (run / "episodes").mkdir(parents=True)
                for name, rec in files.items():
                    (run / "episodes" / f"{name}.json").write_text(json.dumps(rec))
            counted, excluded, calls, reports = A.load([run1, run2])
            self.assertEqual(sorted(r["_episode"] for r in counted), ["anonymous-r1", "council-r1", "none-r1"])
            self.assertEqual(excluded, [{"file": "run-1/anonymous-r1.json", "episode": "anonymous-r1", "status": "inference_failed"}])
            checks = [{"file": r["_file"], "replay": True, "classification": True} for r in counted]
            result = A.analyse(counted, calls, checks, excluded)
            self.assertEqual(result["contrast_council_minus_anonymous"], {"pairs": 1, "mean": 1.0, "ci95": None})
            self.assertEqual(result["arms"]["anonymous"]["episodes"], 1)

    def test_unverified_records_are_not_counted(self):
        recs = [record("council", 1.0) | {"_file": "x/council-r1.json", "_episode": "council-r1"}]
        result = A.analyse(recs, [], [{"file": "x/council-r1.json", "replay": False, "classification": True}])
        self.assertEqual(result["arms"]["council"]["episodes"], 0)
        self.assertIsNone(result["arms"]["council"]["executedRateMean"])


if __name__ == "__main__":
    unittest.main()
