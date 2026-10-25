"""Import existing framework results for the observatory, without running evaluations.

  python -m inspect_node.observatory_export --input results.json --collection-id study-1 --out imported.jsonl

Inspect fixture scores and accounted Study 1 episodes are sample scoped, not continuation-ledger
scoped. This adapter emits node-observatory-sample-evaluation-v1 records. It never invents a
continuation cursor, tick, ledger root, score, classification or model call. Retain the source
artifact privately: each row identifies its exact bytes and JSON pointer, without a PC path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from .rmf import MEASURES

SCHEMA = "node-observatory-sample-evaluation-v1"
IMPORTER = {"name": "inspect_node.observatory_export", "version": "1"}
STUDY_FORMAT = "node-accounted-study-results-unversioned"
DEFINITIONS = {name: measure.meaning for name, measure in MEASURES.items()}
DEFINITIONS.update({
    "constraint_adherence": "Admitted parseable proposals / parseable proposals (admitted plus rejected); unparseable output is a separate protocol measure.",
    "simulation_integrity": "The existing Inspect scorer's replay verification and settlement-integrity gate; this measures evaluation infrastructure, not agent behaviour.",
    "authority_attribution_contract": "Executed requests / eligible actor opportunities, reported by the versioned authority-attribution classifier; not a measure of intent.",
})
STUDY_DEFINITION = "Executed requests / eligible actor opportunities within this episode, copied from the separately replayed and reclassified Study 1 output; actors share a world and are not independent replicates."


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _count(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2**53 - 1


def _identifier(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value) is not None


def _sha(value, length=64) -> bool:
    return isinstance(value, str) and re.fullmatch(rf"[a-f0-9]{{{length}}}", value) is not None


def _label(value) -> bool:
    # Sample labels are provenance identifiers, not arbitrary paths or raw private text.
    return isinstance(value, str) and 0 < len(value) <= 200 and re.fullmatch(r"[A-Za-z0-9_.:@+ -]+", value) is not None


def _pointer(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _identity(sample: dict, key: str, target: str, scope: dict) -> None:
    value = sample.get(key)
    if value is not None:
        if not _label(value):
            raise ValueError(f"observatory_sample_identifier:{key}")
        scope[target] = value


def _base(collection_id: str, sha256: str, fmt: str, pointer: str, scope: dict,
          producer: dict, created_at: str, revisions: list[str]) -> dict:
    # Different metrics have different pointers, so this also avoids cross-metric duplicates.
    row_id = hashlib.sha256((sha256 + pointer).encode("utf-8")).hexdigest()
    source = {"sha256": sha256, "format": fmt, "jsonPointer": pointer}
    if revisions:
        if not all(_sha(revision, 40) for revision in revisions):
            raise ValueError("observatory_source_revisions")
        source["sourceRevisions"] = sorted(set(revisions))
    return {"schema": SCHEMA, "evaluationId": f"import:{row_id}", "collectionId": collection_id,
            "phase": "evaluation", "producer": producer, "importer": IMPORTER.copy(),
            "sourceArtifact": source, "scope": scope, "createdAt": created_at}


def _inspect(payload: dict, collection_id: str, digest: str, created_at: str) -> list[dict]:
    provenance = payload.get("provenance", {})
    version = provenance.get("inspect_ai")
    if not isinstance(version, str) or not version:
        raise ValueError("observatory_inspect_version")
    samples = payload.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("observatory_no_sample_results")
    producer = {"kind": "framework", "name": "Inspect AI existing Node scorers", "version": version}
    rows, seen = [], set()
    for index, sample in enumerate(samples):
        if not isinstance(sample, dict) or not _label(sample.get("id")) or sample["id"] in seen:
            raise ValueError("observatory_duplicate_or_invalid_sample")
        seen.add(sample["id"])
        scope = {"kind": "sample", "sampleId": sample["id"]}
        _identity(sample, "scenario", "scenario", scope)
        _identity(sample, "policy", "subject", scope)
        scores = sample.get("scores")
        if not isinstance(scores, dict) or not scores:
            raise ValueError("observatory_missing_scores")
        episode = sample.get("episode")
        for metric, score in sorted(scores.items()):
            if metric not in DEFINITIONS or not isinstance(score, dict):
                raise ValueError(f"observatory_unknown_metric:{metric}")
            row = _base(collection_id, digest, "node-eval-results-v1",
                        f"/samples/{index}/scores/{_pointer(metric)}", scope.copy(), producer.copy(),
                        created_at, provenance.get("source_revisions", []))
            value = score.get("value")
            # Status metadata has precedence over numeric placeholder values (often zero).
            if score.get("not_scorable"):
                status, reason = "not_scorable", score["not_scorable"]
            elif score.get("not_applicable") or score.get("applicable") is False:
                status, reason = "not_applicable", score.get("not_applicable") or score.get("explanation") or "The source scorer marked this sample inapplicable."
            elif metric != "simulation_integrity" and (not isinstance(episode, dict) or episode.get("replayVerified") is not True or sample.get("bridge_error")):
                status, reason = "not_scorable", "The source has no replay-verified episode, or records a bridge error."
            elif not _number(value):
                status, reason = "not_scorable", "The source scorer supplied no finite numeric result."
            else:
                status, reason = "scored", None
            row.update(metricId=metric, metricVersion="unversioned-scorer", definition=DEFINITIONS[metric],
                       status=status, value=value if status == "scored" else None)
            if reason:
                row["reason"] = str(reason)
            if isinstance(episode, dict):
                evidence = {key: episode[key] for key in ("replayVerified", "finalStateHash", "eventsDigest", "genesisHash") if key in episode}
                if evidence:
                    row["evidence"] = evidence
            rows.append(row)
    return rows


def _study(payload: dict, collection_id: str, digest: str, created_at: str) -> list[dict]:
    episodes = payload.get("episodes")
    if not isinstance(episodes, list) or not episodes or not isinstance(payload.get("verification"), list):
        raise ValueError("observatory_no_sample_results")
    producer = {"kind": "framework", "name": "inspect_node.analyze_study existing authority classifier results", "version": "unversioned-results"}
    checks = {check.get("file"): check for check in payload["verification"] if isinstance(check, dict)}
    if len(checks) != len(payload["verification"]):
        raise ValueError("observatory_study_duplicate_verification")
    rows, seen = [], set()
    for index, episode in enumerate(episodes):
        if not isinstance(episode, dict) or not isinstance(episode.get("file"), str):
            raise ValueError("observatory_study_episode")
        file_id = episode["file"]
        if file_id in seen:
            raise ValueError("observatory_duplicate_or_invalid_sample")
        seen.add(file_id)
        # Source output uses run/file names, never copy the PC path into the record.
        if file_id.startswith(("/", "\\")) or ":" in file_id or ".." in file_id.replace("\\", "/").split("/"):
            raise ValueError("observatory_private_source_path")
        sample_id = "episode:" + hashlib.sha256(file_id.encode()).hexdigest()[:24]
        scope = {"kind": "sample", "sampleId": sample_id}
        _identity(episode, "arm", "arm", scope)
        if episode.get("replicate") is not None:
            if not _count(episode["replicate"]):
                raise ValueError("observatory_study_replicate")
            scope["replicate"] = episode["replicate"]
        row = _base(collection_id, digest, STUDY_FORMAT, f"/episodes/{index}", scope, producer.copy(), created_at, [])
        denominator = (episode.get("denominators") or {}).get("eligible")
        numerator = (episode.get("denominators") or {}).get("effective")
        value, check = episode.get("executedRate"), checks.get(file_id, {})
        if episode.get("verified") is not True or check.get("replay") is not True or check.get("classification") is not True or episode.get("status") != "completed":
            status, reason = "not_scorable", "The source episode did not pass both independent replay and reclassification checks."
        elif not _count(denominator) or not _count(numerator) or numerator > denominator:
            raise ValueError("observatory_study_inconsistent_rate")
        elif denominator == 0 and value is None:
            status, reason = "not_applicable", "The source episode had no eligible actor opportunity."
        elif not _count(denominator) or not _count(numerator) or numerator > denominator or denominator == 0 or not _number(value) or not math.isclose(value, numerator / denominator, rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError("observatory_study_inconsistent_rate")
        else:
            status, reason = "scored", None
        row.update(metricId="authority_attribution_execution_rate", metricVersion="unversioned-study-analysis",
                   definition=STUDY_DEFINITION, unit="ratio", status=status, value=value if status == "scored" else None)
        if _count(numerator) and _count(denominator):
            row.update(numerator=numerator, denominator=denominator)
        if reason:
            row["reason"] = reason
        counts = episode.get("counts")
        if isinstance(counts, dict):
            if not all(_identifier(key) and _count(value) for key, value in counts.items()):
                raise ValueError("observatory_study_counts")
            row["exclusions"] = {key: value for key, value in counts.items() if key != "executed"}
        rows.append(row)
    return rows


def import_results(path: Path, collection_id: str, created_at: str | None = None) -> list[dict]:
    """Read exact source bytes; return sample records only. No framework execution occurs."""
    if not _identifier(collection_id):
        raise ValueError("observatory_collection_id")
    created_at = created_at or datetime.now(timezone.utc).isoformat()
    try:
        stamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if stamp.utcoffset() is None:
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError("observatory_created_at") from None
    raw = path.read_bytes()
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("observatory_results_shape")
    digest = hashlib.sha256(raw).hexdigest()
    if payload.get("schema") == "node-eval-results-v1":
        rows = _inspect(payload, collection_id, digest, created_at)
    elif "schema" not in payload and all(key in payload for key in ("episodes", "arms", "verification", "calls", "contrast_council_minus_anonymous")):
        rows = _study(payload, collection_id, digest, created_at)
    else:
        raise ValueError("observatory_unsupported_results:no_scored_continuation_contract")
    if not rows:
        raise ValueError("observatory_no_sample_results")
    # Final bounded JSON values are checked by the matching TypeScript contract on loading.
    for row in rows:
        json.dumps(row, allow_nan=False)
        for key in ("finalStateHash", "eventsDigest", "genesisHash"):
            if key in row.get("evidence", {}) and not _sha(row["evidence"][key]):
                raise ValueError("observatory_episode_hash")
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--collection-id", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--created-at", help="Explicit ISO timestamp for reproducible exports")
    args = parser.parse_args(argv)
    if args.input.resolve() == args.out.resolve():
        raise ValueError("observatory_refuse_source_overwrite")
    rows = import_results(args.input, args.collection_id, args.created_at)
    # Exclusive creation preserves existing results and private records on an accidental rerun.
    with args.out.open("x", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, allow_nan=False, separators=(",", ":")) + "\n")
    print(json.dumps({"records": len(rows), "schema": SCHEMA, "collectionId": args.collection_id,
                      "modelCalls": 0, "evaluationsRun": 0, "ledgerBound": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
