"""Load independently verified continuation exports into Inspect without model calls or scoring.

First run scripts/verify-continuation.mjs from the committed runtime. Supply its ledger root and
source revision here. These anchors check provenance consistency, not provider authenticity.
No paid model, solver, grader, or scientifically validated behavioural metric is enabled.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from inspect_ai.dataset import Sample, json_dataset


def load_export(path: Path, source_revision: str, ledger_root: str):
    def sample(record: dict) -> Sample:
        metadata = record["metadata"]
        if (
            metadata["sourceRevision"] != source_revision
            or metadata["ledgerRoot"] != ledger_root
            or metadata["behaviouralMetrics"] != "not_validated"
            or metadata["mode"] not in ("live", "offline_simulated_provider")
            or metadata["explicitExplanation"] is not None
            or metadata["inferredCausality"] != []
        ):
            raise ValueError("continuation_export_provenance")
        return Sample(
            id=record["id"],
            input=record["input"],
            target=record["target"],
            metadata=metadata,
        )

    return json_dataset(str(path), sample_fields=sample, shuffle=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--ledger-root", required=True)
    args = parser.parse_args()
    dataset = load_export(args.path, args.source_revision, args.ledger_root)
    print(json.dumps({
        "samples": len(dataset),
        "sourceRevision": args.source_revision,
        "ledgerRoot": args.ledger_root,
        "exportSha256": hashlib.sha256(args.path.read_bytes()).hexdigest(),
        "actors": sorted({s.metadata["actorId"] for s in dataset}),
        "executed": sum(s.metadata["executed"] for s in dataset),
        "behaviouralMetrics": "not_validated",
        "modelCalls": 0,
    }, indent=2))


if __name__ == "__main__":
    main()
