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
import json
from pathlib import Path

from inspect_ai import eval as inspect_eval

from . import export
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
    export.write(results, episodes, out)
    return results, episodes


def compare(a: dict, b: dict) -> list[dict]:
    rows = []
    bs = {s["id"]: s for s in b["samples"]}
    for s in a["samples"]:
        other = bs.get(s["id"])
        ea, eb = s["episode"] or {}, (other or {}).get("episode") or {}
        rows.append({"sample": s["id"],
                     "state_hash_equal": ea.get("finalStateHash") is not None and ea.get("finalStateHash") == eb.get("finalStateHash"),
                     "events_digest_equal": ea.get("eventsDigest") is not None and ea.get("eventsDigest") == eb.get("eventsDigest"),
                     "final_state_hash": ea.get("finalStateHash")})
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--experiment", default="scripted_fixtures")
    args = parser.parse_args(argv)

    a, _ = run_once(args.out / "run-a", args.experiment)
    b, _ = run_once(args.out / "run-b", args.experiment)
    determinism = compare(a, b)
    replay = [{"sample": s["id"], "status": s["episode"]["status"], "replay_verified": s["episode"]["replayVerified"]}
              for s in a["samples"] if s["episode"]]
    replay_failures = [r for r in replay if r["status"] != "simulation_failure" and r["replay_verified"] is not True]
    nondeterministic = [d for d in determinism if not (d["state_hash_equal"] and d["events_digest_equal"])]
    live = a["provenance"]["live_model_calls"] or any(not m.startswith("mockllm") for m in a["provenance"]["models"])
    verification = {
        "experiment": args.experiment,
        "samples": len(a["samples"]),
        "determinism": {"identical": len(determinism) - len(nondeterministic), "differing": nondeterministic, "rows": determinism},
        "replay": {"verified": sum(1 for r in replay if r["replay_verified"]), "failures": replay_failures, "rows": replay},
        "fixture_checks": {k: a["fixture_checks"][k] for k in ("passed", "failed", "skipped")},
        "fixture_check_failures": [c for c in a["fixture_checks"]["checks"] if c["passed"] is False],
        "live_model_used": live,
        "source_revisions": a["provenance"]["source_revisions"],
        "ok": not nondeterministic and not replay_failures and a["fixture_checks"]["failed"] == 0 and not live,
    }
    (args.out / "verification.json").write_text(json.dumps(verification, indent=2), encoding="utf-8")
    print(json.dumps({k: verification[k] for k in ("samples", "fixture_checks", "live_model_used", "ok")}
                     | {"deterministic_samples": verification["determinism"]["identical"],
                        "replay_verified": verification["replay"]["verified"]}, indent=2))
    return 0 if verification["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
