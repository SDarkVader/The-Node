"""Separate offline evaluation of a verified observatory export, using Inspect AI.

Only execution share is scored: committed request joins / all recorded requests.
This is not a reasoning-quality, honesty, safety or memory-benefit metric. Inputs
must come from the replay-verifying backend. No solver calls a model or game host.
Existing Episode scorers are not relabelled as continuation scorers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import inspect_ai
from inspect_ai import Task, eval as inspect_eval
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.scorer import Score, Target, mean, scorer
from inspect_ai.solver import Generate, TaskState, solver

DEFINITION = (
    "Number of requests joined to an actual committed transition divided by all "
    "recorded requests through the declared cursor. Pending, failed and rejected "
    "requests remain in the denominator. No exclusions. Units: fraction. This "
    "measures execution, not reasoning quality or causal memory benefit."
)


def validate_input(document: dict) -> dict:
    s = document["snapshot"]
    if (s["schema"] != "node-observatory-snapshot-v1" or s["verification"] != "replay_verified"
            or s["segmentRoot"] is None or s["cursor"].split(":")[-1] != s["eventHash"]
            or s["phase"] != "execution" or not s["calls"]):
        raise ValueError("observatory_verified_sealed_input_required")
    ids = [c["requestId"] for c in s["calls"]]
    if len(set(ids)) != len(ids):
        raise ValueError("observatory_duplicate_request")
    for c in s["calls"]:
        if not isinstance(c["executed"], bool):
            raise ValueError("observatory_execution_type")
        if c["executed"] and (c["admitted"] is None or c["nextTick"] != c["tick"] + 1):
            raise ValueError("observatory_execution_join")
    if not document["evidence"] or document["evidence"][-1]["eventHash"] != s["eventHash"]:
        raise ValueError("observatory_evidence_anchor")
    return s


@solver
def recorded_execution():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        # No generate(), transport, SDK or kernel step.
        state.completed = True
        return state
    return solve


@scorer(metrics=[mean()])
def execution_share():
    async def score(state: TaskState, target: Target) -> Score:
        return Score(value=int(state.metadata["executed"]),
                     explanation="Joined to a replay-verified committed transition." if state.metadata["executed"] else "No committed transition for this request.",
                     metadata={"metric_version": "1", "definition": DEFINITION})
    return score


def evaluate(document: dict, log_dir: Path) -> list[dict]:
    s = validate_input(document)
    dataset = MemoryDataset([Sample(id=c["requestId"], input="Evaluate recorded execution join.",
                                   metadata={"executed": c["executed"]}) for c in s["calls"]])
    task = Task(dataset=dataset, solver=recorded_execution(), scorer=execution_share(), model="mockllm/model")
    logs = inspect_eval(task, log_dir=str(log_dir), display="none")
    if len(logs) != 1 or logs[0].status != "success" or len(logs[0].samples or []) != len(s["calls"]):
        raise ValueError("inspect_execution_evaluation_incomplete")
    scores = [sample.scores["execution_share"].value for sample in logs[0].samples]
    numerator, denominator = sum(scores), len(scores)
    return [{
        "schema": "node-observatory-evaluation-v1", "phase": "evaluation",
        "evaluationId": "inspect-execution-share-" + hashlib.sha256(s["cursor"].encode()).hexdigest()[:16],
        "experimentId": s["experimentId"], "inputLedgerRoot": s["segmentRoot"],
        "inputEventHash": s["eventHash"], "evaluatedThroughCursor": s["cursor"],
        "evaluatedThroughTick": s["sourceTick"],
        "producer": {"kind": "framework", "name": "Inspect AI / node.observatory.execution_share", "version": inspect_ai.__version__},
        "executor": {"kind": "process", "id": "inspect_node.observatory_export"},
        "metricId": "execution_share", "metricVersion": "1", "definition": DEFINITION,
        "status": "scored", "value": numerator / denominator, "unit": "fraction",
        "numerator": numerator, "denominator": denominator, "exclusions": {},
        "scope": {"startTick": min(c["tick"] for c in s["calls"]), "endTick": s["sourceTick"]},
        "evidence": document["evidence"], "createdAt": datetime.now(timezone.utc).isoformat(),
    }]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="New output file")
    parser.add_argument("--log-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() or args.log_dir.exists():
        raise ValueError("new_evaluation_outputs_required")
    result = evaluate(json.loads(args.input.read_text(encoding="utf-8")), args.log_dir)
    with args.out.open("x", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps({"producer": result[0]["producer"], "metricId": "execution_share", "value": result[0]["value"], "denominator": result[0]["denominator"], "modelCalls": 0}))


if __name__ == "__main__":
    main()
