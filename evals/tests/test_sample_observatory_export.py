"""A6 importer tests: existing results only; no network, provider, solver or bridge."""
from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspect_node import sample_observatory_export as O

STAMP = "2026-10-24T10:00:00+00:00"
HASH = "a" * 64


def inspect_result():
    return {"schema": "node-eval-results-v1", "provenance": {"inspect_ai": "0.3.282", "source_revisions": ["a" * 40]},
            "samples": [{"id": "fixture__policy", "scenario": "fixture", "policy": "scripted",
                         "episode": {"replayVerified": True, "finalStateHash": HASH, "eventsDigest": HASH, "genesisHash": HASH},
                         "scores": {"constraint_adherence": {"applicable": True, "value": 0.5}}}]}


def study_result():
    return {"episodes": [{"file": "run-1/council-r1.json", "arm": "council", "replicate": 1,
                          "status": "completed", "verified": True, "executedRate": 0.5,
                          "denominators": {"eligible": 6, "effective": 3}, "counts": {"executed": 3, "declined": 3}}],
            "verification": [{"file": "run-1/council-r1.json", "replay": True, "classification": True}],
            "arms": {}, "calls": {}, "contrast_council_minus_anonymous": {}}


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name, "results.json")

    def run_import(self, result):
        self.path.write_text(json.dumps(result), encoding="utf-8")
        return O.import_results(self.path, "TEST-ONLY-collection", STAMP)

    def test_inspect_preserves_value_and_exact_source_anchor_without_ledger_scope(self):
        row = self.run_import(inspect_result())[0]
        self.assertEqual((row["status"], row["value"]), ("scored", 0.5))
        self.assertEqual(row["sourceArtifact"]["sha256"], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(row["sourceArtifact"]["jsonPointer"], "/samples/0/scores/constraint_adherence")
        self.assertEqual(row["scope"], {"kind": "sample", "sampleId": "fixture__policy", "scenario": "fixture", "subject": "scripted"})
        for key in ("inputLedgerRoot", "inputEventHash", "evaluatedThroughCursor", "evaluatedThroughTick"):
            self.assertNotIn(key, row)
        self.assertNotIn(str(self.path), json.dumps(row))
        self.assertEqual(self.run_import(inspect_result())[0], row)

    def test_source_status_overrides_zero_placeholders_and_missing_eligibility(self):
        for metadata, status in (({"not_scorable": "simulation_failure"}, "not_scorable"),
                                 ({"not_applicable": "no request"}, "not_applicable"),
                                 ({"applicable": False}, "not_applicable")):
            result = inspect_result()
            result["samples"][0]["scores"]["constraint_adherence"].update(value=0, **metadata)
            row = self.run_import(result)[0]
            self.assertEqual((row["status"], row["value"]), (status, None))

    def test_nonfinite_bool_noanswer_and_unverified_episode_are_not_scores(self):
        for value in (float("nan"), float("inf"), True, "N", None):
            result = inspect_result()
            result["samples"][0]["scores"]["constraint_adherence"]["value"] = value
            row = self.run_import(result)[0]
            self.assertEqual((row["status"], row["value"]), ("not_scorable", None))
        result = inspect_result()
        result["samples"][0]["episode"]["replayVerified"] = False
        self.assertEqual(self.run_import(result)[0]["status"], "not_scorable")

    def test_unknown_metric_duplicate_sample_and_path_identifiers_are_refused(self):
        for mutate in (lambda p: p["samples"][0]["scores"].update(invented_quality={"value": 1}),
                       lambda p: p["samples"].append(copy.deepcopy(p["samples"][0])),
                       lambda p: p["samples"][0].update(id="C:\\private\\secret.json")):
            result = inspect_result()
            mutate(result)
            with self.assertRaises(ValueError):
                self.run_import(result)

    def test_infrastructure_failure_score_is_not_misrepresented_as_an_agent_score(self):
        result = inspect_result()
        sample = result["samples"][0]
        sample["episode"] = None
        sample["scores"] = {"simulation_integrity": {"applicable": True, "value": 0}}
        row = self.run_import(result)[0]
        self.assertEqual((row["metricId"], row["status"], row["value"]), ("simulation_integrity", "scored", 0))
        self.assertIn("not agent behaviour", row["definition"])

    def test_study_imports_episode_result_and_independent_checks_without_inventing_contract(self):
        row = self.run_import(study_result())[0]
        self.assertEqual((row["value"], row["numerator"], row["denominator"]), (0.5, 3, 6))
        self.assertEqual(row["exclusions"], {"declined": 3})
        self.assertEqual(row["sourceArtifact"]["jsonPointer"], "/episodes/0")
        self.assertEqual(row["scope"]["arm"], "council")
        self.assertNotIn("contractHash", row)
        self.assertNotIn("run-1/council-r1.json", json.dumps(row))

    def test_unverified_study_is_not_scorable_and_no_opportunity_is_not_zero(self):
        for key in ("replay", "classification"):
            result = study_result()
            result["verification"][0][key] = False
            row = self.run_import(result)[0]
            self.assertEqual((row["status"], row["value"]), ("not_scorable", None))
        result = study_result()
        result["episodes"][0].update(executedRate=None, denominators={"eligible": 0, "effective": 0})
        self.assertEqual(self.run_import(result)[0]["status"], "not_applicable")

    def test_inconsistent_study_denominator_or_absolute_path_is_refused(self):
        for mutate in (lambda p: p["episodes"][0].update(executedRate=0.75),
                       lambda p: p["episodes"][0].update(file="C:\\private\\episode.json"),
                       lambda p: p["episodes"][0].update(file="../private/episode.json")):
            result = study_result()
            mutate(result)
            with self.assertRaises(ValueError):
                self.run_import(result)

    def test_unvalidated_continuation_and_empty_study_are_refused(self):
        for result in ({"metadata": {"behaviouralMetrics": "not_validated", "ledgerRoot": HASH}},
                       {**study_result(), "episodes": []}, {"schema": "node-observatory-evaluation-v1"}):
            with self.assertRaises(ValueError):
                self.run_import(result)

    def test_cli_does_not_overwrite_and_does_not_invoke_subprocess_or_network(self):
        self.run_import(inspect_result())
        target = Path(self.tmp.name, "imported.jsonl")
        args = ["--input", str(self.path), "--collection-id", "TEST-ONLY", "--out", str(target), "--created-at", STAMP]
        with patch("subprocess.run", side_effect=AssertionError("no child process")), patch("socket.socket", side_effect=AssertionError("no network")):
            self.assertEqual(O.main(args), 0)
        self.assertEqual(len(target.read_text(encoding="utf-8").splitlines()), 1)
        original = target.read_bytes()
        with self.assertRaises(FileExistsError):
            O.main(args)
        self.assertEqual(target.read_bytes(), original)
        with self.assertRaises(ValueError):
            O.main(["--input", str(self.path), "--collection-id", "TEST-ONLY", "--out", str(self.path)])


if __name__ == "__main__":
    unittest.main()
