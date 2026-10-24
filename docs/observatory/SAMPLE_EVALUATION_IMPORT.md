# Import existing framework sample results

Updated 2026-10-24. A6 now includes a Python adapter for existing Inspect results and accounted
Study 1 analysis results. The adapter copies results; it runs no scorer, model, solver, bridge or
network request. Imported samples are a separate collection, never scores of a continuation tick.

## Inputs and command

Supported sources:

- `node-eval-results-v1` JSON from `inspect_node.export`: existing per-sample scorer values,
  applicability and infrastructure failure outcomes. The committed scripted fixture output is
  suitable for an offline acceptance check and says nothing about live models.
- The existing unversioned `inspect_node.analyze_study` JSON: individual episode execution rates,
  eligible/effective denominators, outcome counts and the separate replay/reclassification checks.
  The adapter does not import arm means, contrasts, cost estimates or bootstrap intervals as if
  they were individual samples. Their exact source artifact remains the authority for those data.

From a shell with `PYTHONPATH` set to the repository's `evals` directory:

```text
python -m inspect_node.observatory_export --input <existing-results.json> --collection-id <collection-name> --out <new-private-results.jsonl>
```

The output must not exist. Source and output cannot be the same path. Optional `--created-at`
accepts an explicit ISO timestamp with a timezone for byte-for-byte reproducible imports. Keep
real experiment inputs and outputs in private storage, outside tracked paths. No PC path is
included in an imported record.

## Separate contract

The schema is `node-observatory-sample-evaluation-v1`, implemented in
[`sampleEvaluations.ts`](../../src/observatory/sampleEvaluations.ts). Each record has:

- An explicit collection and sample identity, with subject/scenario or arm/replicate when present.
- The source framework, its reported version, and the distinct importer name/version. Unversioned
  scorer or study formats are labelled unversioned; no missing contract hash is invented.
- A metric definition and original finite numeric result, or an explicit non-scored status with
  `value: null`. Numeric placeholder zeros from inapplicable/failed behavioural scorers do not
  become valid scores. The infrastructure integrity metric may itself report a genuine zero.
- SHA-256 of the exact source bytes plus a JSON pointer to the imported score or episode. Retain
  those exact bytes privately to trace the record; changing them changes the identity.
- Existing episode hashes/replay flags where supplied. The import does not independently prove
  replay, provider authenticity or the scientific validity of a metric.

No ledger root, event hash, cursor, tick range or evaluated-through tick is accepted in this
sample contract. A sample collection is not causally or temporally attached to the continuation
world merely because both are shown in an observatory. The existing ledger-bound evaluation
contract remains separate.

The matching TypeScript reader fails closed on malformed/partial rows, conflicting IDs and
oversized data. It deduplicates exact repeated rows. The renderer must label this collection as
sample results and avoid filtering it against the selected world tick.

Register JSONL paths under `sampleEvaluations` in private server configuration. The researcher
route `GET /observatory/v1/runs/:id/sample-evaluations` returns the independent-collection marker,
validated rows and `notAttachedToTimeline: true`. Renderer tokens cannot read this route.
Malformed configured files produce 409 with a fixed error and no partial rows or filesystem path.
The existing web panel renders these collections separately from ledger-bound evaluation rows.

## Evidence and further work

The focused tests verify faithful score/status import, exact source anchors, unchanged inputs,
exclusive output creation, refusal of invented scope, nonfinite values, inconsistent Study 1
rates, private path identifiers, malformed JSONL and ID collisions. They also assert no subprocess
or socket is used by the import command.

The historical continuation export declares `behaviouralMetrics: not_validated`; it is a sample
import for inspection, not a scored framework result. This adapter refuses it. A later genuine
continuation scorer needs its own metric contract and verified ledger binding. Empty Study 1
analysis output is refused rather than turned into a result. This does not resume paused Study 1
or authorize new model calls.
