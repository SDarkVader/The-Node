"""End-to-end verification of the Inspect harness against The Node, offline.

  python -m inspect_node.verify --out <dir> [--experiment scripted_fixtures]

Runs node_safety_suite twice through Inspect with the offline mockllm provider, exports both
runs, and checks:
  - determinism: every sample's final kernel state hash and event-log digest are identical
    across the two runs;
  - replay: every completed episode re-derived its final state from its tape;
  - fixture agreement: every scorer detects the behaviour its scripted fixture exhibits;
  - no live model was used.
Writes run-a/ and run-b/ exports plus verification.json; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path

from inspect_ai import eval as inspect_eval

from . import export
from .bridge import NodeBridge
from .tasks import load_experiment, node_safety_suite


def run_once(out: Path, experiment: str) -> tuple[dict, list[dict]]:
    log_dir = out / "logs"
    config = load_experiment(experiment)
    logs = inspect_eval(node_safety_suite(experiment=experiment), model=config.get("model", "mockllm/model"),
                        max_samples=config.get("max_samples", 4), display="none", log_dir=str(log_dir))
    failed = [lg for lg in logs if lg.status != "success"]
    if failed:
        raise SystemExit(f"inspect run failed: {[str(lg.error) for lg in failed]}")
    results, episodes = export.build(log_dir)
    # These records have crossed Inspect's log and JSON export boundaries. Replay them
    # in a fresh Node process rather than trusting the runner's in-memory replay flag.
    async def verify_exports() -> None:
        by_id = {s["id"]: s for s in results["samples"]}
        async with NodeBridge() as bridge:
            for row in episodes:
                record = row["record"]
                if record is None:
                    continue  # validate_run will reject the missing evidence.
                replayed = await bridge.request({"cmd": "replay", "record": record})
                by_id[row["id"]]["episode"]["exportedReplayVerified"] = (
                    replayed["finalStateHash"] == record["finalStateHash"]
                    and replayed["eventsDigest"] == record["eventsDigest"])
    asyncio.run(verify_exports())
    export.write(results, episodes, out)
    return results, episodes


def compare(a: dict, b: dict) -> list[dict]:
    rows = []
    aa = {s["id"]: s for s in a["samples"]}
    bs = {s["id"]: s for s in b["samples"]}
    for sample_id in sorted(aa.keys() | bs.keys()):
        ea, eb = (aa.get(sample_id) or {}).get("episode") or {}, (bs.get(sample_id) or {}).get("episode") or {}
        rows.append({"sample": sample_id,
                     "state_hash_equal": ea.get("finalStateHash") is not None and ea.get("finalStateHash") == eb.get("finalStateHash"),
                     "events_digest_equal": ea.get("eventsDigest") is not None and ea.get("eventsDigest") == eb.get("eventsDigest"),
                     "final_state_hash": ea.get("finalStateHash")})
    return rows


def validate_run(results: dict, expected: list[str]) -> list[str]:
    """Fail closed on missing, duplicate or unverified samples, in either run."""
    errors = []
    actual = [s["id"] for s in results["samples"]]
    if not expected or len(set(expected)) != len(expected) or Counter(actual) != Counter(expected):
        errors.append("sample IDs do not match the nonempty, unique experiment manifest")
    if not results["provenance"]["models"] or results["provenance"]["live_model_calls"] or any(
            not m.startswith("mockllm/") for m in results["provenance"]["models"]):
        errors.append("run has missing or non-offline model provenance")
    if results["fixture_checks"]["failed"]:
        errors.append("fixture checks failed")
    for sample in results["samples"]:
        required_scores = (set(export.BEHAVIOURAL) - {"output_protocol_compliance"}) | {export.rmf.INTEGRITY}
        if not required_scores <= sample.get("scores", {}).keys():
            errors.append(f"{sample['id']}: missing declared scorers")
        episode = sample.get("episode") or {}
        if not episode.get("finalStateHash") or not episode.get("eventsDigest") or episode.get("replayVerified") is not True \
                or episode.get("exportedReplayVerified") is not True:
            errors.append(f"{sample['id']}: missing episode evidence or unverified replay")
        integrity = sample.get("scores", {}).get("simulation_integrity", {})
        if sample.get("scenario") == "simulation_fault":
            if episode.get("status") != "simulation_failure" or integrity.get("value") != 0:
                errors.append(f"{sample['id']}: fault self-test did not fail as expected")
        elif episode.get("status") != "completed" or integrity.get("value") != 1:
            errors.append(f"{sample['id']}: episode incomplete or evaluation integrity failed")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--experiment", default="scripted_fixtures")
    args = parser.parse_args(argv)
    expected = [f"{scenario}__{policy}" for scenario, policy in load_experiment(args.experiment)["samples"]]

    a, _ = run_once(args.out / "run-a", args.experiment)
    b, _ = run_once(args.out / "run-b", args.experiment)
    run_errors = {"run-a": validate_run(a, expected), "run-b": validate_run(b, expected)}
    determinism = compare(a, b)
    replay = [{"sample": s["id"], "status": s["episode"]["status"], "replay_verified": s["episode"]["replayVerified"]}
              for s in a["samples"] if s["episode"]]
    replay_failures = [r for r in replay if r["status"] != "simulation_failure" and r["replay_verified"] is not True]
    nondeterministic = [d for d in determinism if not (d["state_hash_equal"] and d["events_digest_equal"])]
    live = any(r["provenance"]["live_model_calls"] or any(not m.startswith("mockllm/") for m in r["provenance"]["models"])
               for r in (a, b))
    verification = {
        "experiment": args.experiment,
        "samples": len(a["samples"]),
        "determinism": {"identical": len(determinism) - len(nondeterministic), "differing": nondeterministic, "rows": determinism},
        "replay": {"verified": sum(1 for r in replay if r["replay_verified"]), "failures": replay_failures, "rows": replay},
        "fixture_checks": {k: a["fixture_checks"][k] for k in ("passed", "failed", "skipped")},
        "fixture_check_failures": [c for c in a["fixture_checks"]["checks"] if c["passed"] is False],
        "live_model_used": live,
        "source_revisions": a["provenance"]["source_revisions"],
        "run_errors": run_errors,
        "exported_replay_verified": {name: sum(s["episode"].get("exportedReplayVerified") is True
                                              for s in result["samples"] if s["episode"])
                                     for name, result in (("run-a", a), ("run-b", b))},
        "ok": not any(run_errors.values()) and not nondeterministic and not replay_failures and not live,
    }
    (args.out / "verification.json").write_text(json.dumps(verification, indent=2), encoding="utf-8")
    print(json.dumps({k: verification[k] for k in ("samples", "fixture_checks", "live_model_used", "ok")}
                     | {"deterministic_samples": verification["determinism"]["identical"],
                        "replay_verified": verification["replay"]["verified"]}, indent=2))
    return 0 if verification["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
