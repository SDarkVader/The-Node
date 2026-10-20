"""Construct-contract evaluation over multi-actor Node episodes (gate G2).

  node_authority_attribution  three arms (council / anonymous / none) x scripted policies, seven
                              controlled actors per episode (owner decision D3), classified by the
                              versioned contract in evals/contracts/authority_attribution.v1.json

  python -m inspect_node.constructs --out <dir>   two offline runs + independent export checks

The contract and its classifier live in TypeScript (src/eval/constructs/authorityAttribution.ts);
Python never re-implements them. It runs the episode, stores the record, and asks a fresh bridge
process to replay and re-classify the exported record. Scripted fixtures through offline mockllm
only: the results here verify the instrument, not any model.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval as inspect_eval, task
from inspect_ai.log import list_eval_logs, read_eval_log
from inspect_ai.model import ChatMessageSystem, ChatMessageUser
from inspect_ai.scorer import NOANSWER, Score, Scorer, Target, mean, scorer
from inspect_ai.solver import Generate, Solver, TaskState, solver

from .bridge import BridgeError, NodeBridge, source_revision
from .policies import POLICIES
from .solver import agent_model, render_prompt
from .tasks import dataset, load_experiment

CONTRACT_FILE = Path(__file__).resolve().parents[1] / "contracts" / "authority_attribution.v1.json"
EXPERIMENT = "authority_attribution"


def load_contract() -> dict:
    return json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))


@solver
def node_multi_episode() -> Solver:
    """One model call per present actor per tick. Each actor has its own scripted model and
    memory, sees only its own prompt, and carries no transcript between ticks."""
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        scenario = state.metadata["scenario"]
        policy = state.metadata.get("policy")
        revision = source_revision()
        state.store.set("source_revision", revision)
        models: dict[str, Any] = {}
        try:
            async with NodeBridge() as bridge:
                prompts = (await bridge.request({"cmd": "start_multi", "scenario": scenario, "sourceRevision": revision}))["prompts"]
                while prompts:
                    outputs = {}
                    for item in prompts:  # fixed actor order: deterministic call sequence
                        actor, prompt = item["actorId"], item["prompt"]
                        model = models.setdefault(actor, agent_model(policy))
                        output = await model.generate([ChatMessageSystem(content=prompt["instructions"]),
                                                       ChatMessageUser(content=render_prompt(prompt))])
                        outputs[actor] = output.completion
                        state.output = output
                    prompts = (await bridge.request({"cmd": "act_multi", "outputs": outputs}))["prompts"]
                state.store.set("episode", (await bridge.request({"cmd": "finish"}))["record"])
        except BridgeError as error:
            state.store.set("bridge_error", str(error))
        return state

    return solve


@scorer(metrics=[mean()])
def authority_attribution_contract() -> Scorer:
    """Reports the TypeScript classifier's result. Value: executed / eligible opportunities;
    NOANSWER when the episode has no eligible behavioural opportunity or failed."""
    async def score(state: TaskState, target: Target) -> Score:
        record = state.store.get("episode")
        if record is None or record.get("construct") is None:
            return Score(value=NOANSWER, answer="not_scorable", explanation=str(state.store.get("bridge_error")),
                         metadata={"applicable": False, "not_scorable": "missing_episode_or_classification"})
        c = record["construct"]
        rate = c["executedRate"]
        return Score(value=NOANSWER if rate is None else rate, answer=c["arm"],
                     explanation=f"{c['denominators']['effective']}/{c['denominators']['eligible']} eligible actors executed the request",
                     metadata={"applicable": rate is not None, "observed": {"denominators": c["denominators"], "counts": c["counts"],
                               "actors": [{k: a[k] for k in ("actorId", "roleAtExposure", "opportunity", "eligible", "outcome", "flags")} for a in c["actors"]]},
                               "contract": c["contract"], "inferred": []})
    return score


@task
def node_authority_attribution(experiment: str = EXPERIMENT) -> Task:
    config = load_experiment(experiment)
    return Task(dataset=dataset(experiment), solver=node_multi_episode(), scorer=[authority_attribution_contract()],
                model=config.get("model", "mockllm/model"), metadata={"experiment": config["name"], "contract": load_contract()["hash"]})


# ---- verification -----------------------------------------------------------------------

def _collect(log_dir: Path) -> list[dict]:
    rows = []
    for info in list_eval_logs(str(log_dir)):
        log = read_eval_log(info)
        if log.status != "success":
            raise SystemExit(f"inspect run failed: {log.error}")
        for s in log.samples or []:
            rows.append({"id": str(s.id), "scenario": s.metadata["scenario"], "policy": s.metadata["policy"],
                         "model": log.eval.model, "record": s.store.get("episode"), "bridge_error": s.store.get("bridge_error")})
    return sorted(rows, key=lambda r: r["id"])


def run_once(out: Path, experiment: str) -> list[dict]:
    config = load_experiment(experiment)
    inspect_eval(node_authority_attribution(experiment=experiment), model=config.get("model", "mockllm/model"),
                 max_samples=config.get("max_samples", 4), display="none", log_dir=str(out / "logs"))
    rows = _collect(out / "logs")

    async def independent() -> None:
        async with NodeBridge() as bridge:
            for row in rows:
                record = row["record"]
                if record is None:
                    continue
                exported = json.loads(json.dumps(record))
                replayed = await bridge.request({"cmd": "replay", "record": exported})
                reclassified = (await bridge.request({"cmd": "classify", "record": exported}))["construct"]
                row["exportedReplayVerified"] = replayed["finalStateHash"] == record["finalStateHash"] and replayed["eventsDigest"] == record["eventsDigest"]
                row["exportedReclassificationEqual"] = reclassified == record["construct"]
    asyncio.run(independent())
    out.mkdir(parents=True, exist_ok=True)
    with (out / "episodes.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps({"id": row["id"], "record": row["record"]}) + "\n")
    return rows


def contrasts(rows: list[dict]) -> dict[str, dict]:
    """Per policy: executed rate per arm and the council-minus-anonymous contrast. One seed and
    scripted fixtures: a description of the instrument, not an estimate with uncertainty."""
    table: dict[str, dict] = {}
    for row in rows:
        c = (row["record"] or {}).get("construct") or {}
        table.setdefault(row["policy"], {})[c.get("arm", row["scenario"])] = c.get("executedRate")
    for rates in table.values():
        council, anonymous = rates.get("council"), rates.get("anonymous")
        rates["council_minus_anonymous"] = None if council is None or anonymous is None else council - anonymous
    return table


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--experiment", default=EXPERIMENT)
    args = parser.parse_args(argv)
    config = load_experiment(args.experiment)
    contract = load_contract()
    expected_ids = sorted(f"{s}__{p}" for s, p in config["samples"])

    runs = {name: run_once(args.out / name, args.experiment) for name in ("run-a", "run-b")}
    errors: list[str] = []
    for name, rows in runs.items():
        if [r["id"] for r in rows] != expected_ids:
            errors.append(f"{name}: sample ids do not match the manifest")
        for r in rows:
            rec = r["record"]
            if r["bridge_error"] or rec is None:
                errors.append(f"{name}/{r['id']}: bridge error {r['bridge_error']}")
                continue
            if not r["model"].startswith("mockllm/"):
                errors.append(f"{name}/{r['id']}: non-offline model {r['model']}")
            if rec["status"] != "completed" or rec["replayVerified"] is not True or r.get("exportedReplayVerified") is not True:
                errors.append(f"{name}/{r['id']}: incomplete episode or unverified replay")
            if r.get("exportedReclassificationEqual") is not True:
                errors.append(f"{name}/{r['id']}: exported record re-classifies differently")
            if rec["construct"]["contract"]["hash"] != contract["hash"]:
                errors.append(f"{name}/{r['id']}: classified under a different contract")
    a, b = runs["run-a"], runs["run-b"]
    determinism = [{"sample": x["id"], "identical": bool(x["record"] and y["record"]
                    and x["record"]["finalStateHash"] == y["record"]["finalStateHash"]
                    and x["record"]["eventsDigest"] == y["record"]["eventsDigest"]
                    and x["record"]["construct"] == y["record"]["construct"])} for x, y in zip(a, b)]
    if len(a) != len(b) or not all(d["identical"] for d in determinism):
        errors.append("runs are not deterministic")

    table = contrasts(a)
    checks = []
    for policy, want in config.get("fixture_expected_rates", {}).items():
        for arm_or_contrast, value in want.items():
            got = table.get(policy, {}).get(arm_or_contrast)
            checks.append({"policy": policy, "measure": arm_or_contrast, "expected": value, "observed": got,
                           "passed": got is not None and abs(got - value) < 1e-9})
    if not checks or not all(c["passed"] for c in checks):
        errors.append("fixture rate checks failed")

    verification = {
        "experiment": config["name"], "contract": {"id": contract["contract"]["id"], "version": contract["contract"]["version"], "hash": contract["hash"]},
        "source_revisions": sorted({r["record"]["sourceRevision"] for r in a if r["record"]}),
        "samples": len(a), "determinism": determinism, "rates": table, "fixture_checks": checks,
        "outcomes": {r["id"]: (r["record"] or {}).get("construct", {}).get("counts") for r in a},
        "denominators": {r["id"]: (r["record"] or {}).get("construct", {}).get("denominators") for r in a},
        "live_model_used": any(not r["model"].startswith("mockllm/") for rows in runs.values() for r in rows),
        "errors": errors, "ok": not errors,
    }
    (args.out / "verification.json").write_text(json.dumps(verification, indent=2), encoding="utf-8")
    print(json.dumps({k: verification[k] for k in ("samples", "live_model_used", "ok", "errors")}
                     | {"fixture_checks_passed": sum(c["passed"] for c in checks), "fixture_checks": len(checks),
                        "deterministic": sum(d["identical"] for d in determinism)}, indent=2))
    return 0 if verification["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
