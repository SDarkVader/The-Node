"""Compare a fresh offline run's per-sample kernel state hashes with an archived reference.

  python -m inspect_node.compare_hashes --run <verification.json> --reference <verification.json>

Gate G1 evidence: the same tracked source must give byte-identical final kernel state on a
different OS, Node and Python. A mismatch is a finding to investigate, never a reason to edit
the reference. When the kernel or episode source deliberately changes, archive new evidence and
point --reference at it in the same reviewed commit.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def hashes(path: Path) -> dict[str, str | None]:
    return {row["sample"]: row.get("final_state_hash") for row in json.loads(path.read_text(encoding="utf-8"))["determinism"]["rows"]}


def compare(run: dict[str, str | None], reference: dict[str, str | None]) -> dict:
    samples = sorted(run.keys() | reference.keys())
    rows = [{"sample": s, "run": run.get(s), "reference": reference.get(s),
             "equal": run.get(s) is not None and run.get(s) == reference.get(s)} for s in samples]
    return {"samples": len(rows), "equal": sum(r["equal"] for r in rows), "differing": [r for r in rows if not r["equal"]],
            "ok": bool(rows) and all(r["equal"] for r in rows)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    args = parser.parse_args(argv)
    reference_meta = json.loads(args.reference.read_text(encoding="utf-8"))
    result = compare(hashes(args.run), hashes(args.reference))
    result["reference"] = {"path": str(args.reference), "source_revisions": reference_meta.get("source_revisions")}
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
