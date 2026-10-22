"""Analyse an accounted study's private artifact directory into shareable aggregates.

  python -m inspect_node.analyze_study --artifacts <run dir> [--artifacts <resumed run dir> ...] --out <dir>

Every episode record is first replayed and re-classified in a fresh bridge process: a record
whose replay or classification does not reproduce is reported and excluded, never repaired.
Then, per arm, over episodes (the contract's statistical unit):
  - executed / eligible rate per episode, mean, and a percentile bootstrap 95% interval;
  - attempted and admitted rates, and outcome counts including every exclusion;
  - council minus anonymous, paired by replicate, with its own bootstrap interval.
Usage and cost come from calls.jsonl at the recorded standard prices, labelled as estimates.

Writes results.json and summary.md. They hold aggregates and provenance only. Raw request and
response bytes and full records stay in the private artifact directory.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
from pathlib import Path
from statistics import mean

from .bridge import NodeBridge

ARMS = ("council", "anonymous", "none")
BOOTSTRAP = 10_000
# List prices per model, USD per million tokens (an estimate, never an invoice):
# gpt-5.4-nano from the recorded 18 Oct rate evidence; claude-haiku-5-5 from the evidence excerpt
# docs/research/model-options-2026-10-21/evidence/anthropic-pricing-haiku-5-5-2026-10-22.md.
STANDARD_USD_PER_MILLION = {
    "gpt-5.4-nano-2026-03-17": {"input": 0.20, "output": 1.25},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50},
}


def estimated_cost_usd(calls: list[dict]) -> float | None:
    """Standard-price estimate over recorded calls. None when any recorded call names a model
    without listed prices: a partial sum would understate the cost."""
    total = 0.0
    for c in calls:
        if c.get("outcome") != "response_recorded":
            continue
        rates = STANDARD_USD_PER_MILLION.get(c.get("model", ""))
        if rates is None:
            return None
        total += c.get("inputTokens", 0) / 1e6 * rates["input"] + c.get("outputTokens", 0) / 1e6 * rates["output"]
    return round(total, 6)


def bootstrap(values: list[float], seed: int) -> list[float] | None:
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    means = sorted(mean(rng.choice(values) for _ in values) for _ in range(BOOTSTRAP))
    return [means[int(0.025 * BOOTSTRAP)], means[int(0.975 * BOOTSTRAP) - 1]]


def load(runs: list[Path]) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """(counted records, excluded attempts, calls, reports). A resumed study spans several run
    directories; each manifest episode counts once, from its completed record. Interrupted
    attempts are listed as exclusions, never merged into a result."""
    records, calls, reports = [], [], []
    for run in runs:
        for p in sorted((run / "episodes").glob("*.json")):
            records.append(json.loads(p.read_text(encoding="utf-8")) | {"_file": f"{run.name}/{p.name}", "_episode": re.sub(r"-a\d+$", "", p.stem)})
        calls_file = run / "calls.jsonl"
        if calls_file.exists():
            calls += [json.loads(line) for line in calls_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        if (run / "report.json").exists():
            reports.append(json.loads((run / "report.json").read_text(encoding="utf-8")))
    counted, excluded = {}, []
    for r in records:
        if r["status"] == "completed" and r["_episode"] not in counted:
            counted[r["_episode"]] = r
        else:
            excluded.append({"file": r["_file"], "episode": r["_episode"], "status": r["status"]})
    return list(counted.values()), excluded, calls, reports


async def verify(records: list[dict]) -> list[dict]:
    rows = []
    async with NodeBridge() as bridge:
        for record in records:
            exported = {k: v for k, v in record.items() if not k.startswith("_")}
            replayed = await bridge.request({"cmd": "replay", "record": exported})
            reclassified = (await bridge.request({"cmd": "classify", "record": exported}))["construct"]
            rows.append({"file": record["_file"], "replay": replayed["finalStateHash"] == record["finalStateHash"] and replayed["eventsDigest"] == record["eventsDigest"],
                         "classification": reclassified == record["construct"]})
    return rows


def analyse(records: list[dict], calls: list[dict], checks: list[dict], excluded: list[dict] | None = None) -> dict:
    ok = {c["file"] for c in checks if c["replay"] and c["classification"]}
    episodes = []
    for r in records:
        c = r["construct"]
        m = re.search(r"-r(\d+)$", r.get("_episode", ""))
        replicate = int(m.group(1)) if m else None
        episodes.append({"file": r["_file"], "arm": c["arm"], "replicate": replicate, "status": r["status"], "verified": r["_file"] in ok,
                         "executedRate": c["executedRate"], "denominators": c["denominators"], "counts": c["counts"]})
    arms = {}
    for i, arm in enumerate(ARMS):
        rows = [e for e in episodes if e["arm"] == arm and e["verified"]]
        rates = [e["executedRate"] for e in rows if e["executedRate"] is not None]
        eligible = [e["denominators"]["eligible"] for e in rows]
        arms[arm] = {
            "episodes": len(rows), "scoredEpisodes": len(rates),
            "executedRateMean": mean(rates) if rates else None, "executedRateCI95": bootstrap(rates, 1000 + i),
            "attemptedRateMean": mean(e["denominators"]["attempted"] / e["denominators"]["eligible"] for e in rows if e["denominators"]["eligible"]) if any(eligible) else None,
            "admittedRateMean": mean(e["denominators"]["admitted"] / e["denominators"]["eligible"] for e in rows if e["denominators"]["eligible"]) if any(eligible) else None,
            "outcomeCounts": {k: sum(e["counts"].get(k, 0) for e in rows) for k in sorted({k for e in rows for k in e["counts"]})},
        }
    by_rep: dict[int, dict] = {}
    for e in episodes:
        if e["verified"] and e["executedRate"] is not None and e["replicate"] is not None:
            by_rep.setdefault(e["replicate"], {})[e["arm"]] = e["executedRate"]
    diffs = [v["council"] - v["anonymous"] for v in by_rep.values() if "council" in v and "anonymous" in v]
    tokens_in = sum(c.get("inputTokens", 0) for c in calls if c.get("outcome") == "response_recorded")
    tokens_out = sum(c.get("outputTokens", 0) for c in calls if c.get("outcome") == "response_recorded")
    return {
        "episodes": episodes, "arms": arms,
        "contrast_council_minus_anonymous": {"pairs": len(diffs), "mean": mean(diffs) if diffs else None, "ci95": bootstrap(diffs, 2000)},
        "calls": {"total": len(calls), "byOutcome": {o: sum(1 for c in calls if c["outcome"] == o) for o in sorted({c["outcome"] for c in calls})},
                  "unactionable": sum(1 for c in calls if c.get("actionable") is False), "inputTokens": tokens_in, "outputTokens": tokens_out,
                  "models": sorted({c["model"] for c in calls if c.get("outcome") == "response_recorded" and c.get("model")}),
                  "estimatedStandardCostUsd": estimated_cost_usd(calls)},
        "verification": checks,
        "excludedAttempts": excluded or [],
        "limits": ["One seed (103), one notice text, one model: results describe this world, request and model only.",
                   "Actors share a world, so the episode is the unit; actor-level outcomes are descriptive.",
                   "Cost is an estimate from recorded usage at standard prices, not an invoice."],
    }


def summary_md(result: dict, reports: list[dict]) -> str:
    fmt = lambda x: "n/a" if x is None else f"{x:.3f}"
    ci = lambda c: "n/a" if not c else f"[{c[0]:.3f}, {c[1]:.3f}]"
    lines = ["# Accounted study results", ""]
    for report in reports:
        lines += [f"- Run: manifest `{report.get('manifestId')}` (sha256 `{report.get('manifestSha256')}`), runner `{report.get('runnerRevision')}`, "
                  f"stopped reason `{(report.get('summary') or {}).get('stoppedReason')}`, error `{report.get('errorCode')}`."]
    lines += [""]
    lines += ["| arm | episodes | executed rate (mean) | 95% CI (episodes) | attempted | admitted |", "|---|---|---|---|---|---|"]
    for arm, a in result["arms"].items():
        lines.append(f"| {arm} | {a['scoredEpisodes']}/{a['episodes']} | {fmt(a['executedRateMean'])} | {ci(a['executedRateCI95'])} | {fmt(a['attemptedRateMean'])} | {fmt(a['admittedRateMean'])} |")
    c = result["contrast_council_minus_anonymous"]
    lines += ["", f"Council minus anonymous, paired by replicate: {fmt(c['mean'])} over {c['pairs']} pairs, 95% CI {ci(c['ci95'])}.", "",
              f"Calls: {result['calls']['total']} ({result['calls']['byOutcome']}); unactionable responses {result['calls']['unactionable']}; "
              f"tokens {result['calls']['inputTokens']} in / {result['calls']['outputTokens']} out; estimated standard cost {'$' + str(result['calls']['estimatedStandardCostUsd']) if result['calls']['estimatedStandardCostUsd'] is not None else 'not estimated (a call names an unpriced model)'}.", "",
              "Verification: " + ", ".join(f"{v['file']} replay={v['replay']} classification={v['classification']}" for v in result["verification"]), "",
              "Excluded attempts (not counted): " + (", ".join(f"{x['file']} ({x['status']})" for x in result["excludedAttempts"]) or "none"), "",
              "Limits:"] + [f"- {x}" for x in result["limits"]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--artifacts", required=True, type=Path, action="append")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    records, excluded, calls, reports = load(args.artifacts)
    if not records:
        raise SystemExit("no completed episode records found")
    checks = asyncio.run(verify(records))
    result = analyse(records, calls, checks, excluded)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (args.out / "summary.md").write_text(summary_md(result, reports), encoding="utf-8")
    print(summary_md(result, reports))
    return 0 if all(v["replay"] and v["classification"] for v in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
