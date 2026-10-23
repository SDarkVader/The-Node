# Claude Design handover — realtime experiment observatory

Prepared 2026-10-23 for the owner's web interface and Godot connection.
This is a build handover, not a claim that the dashboard or the proposed adapters already exist.

## Start here

Read [CURRENT_EXPERIMENT](CURRENT_EXPERIMENT.md), [sanitized results](CONTINUATION_PILOT_RESULTS_2026-10-23.md)
and [CURRENT_SESSION](../recovery/CURRENT_SESSION.md). Work on the agreed development branch,
`codex/stateful-continuation-2026-10-23` / [PR #38](https://github.com/SDarkVader/The-Node/pull/38);
verify actual Git refs. Preserve existing work, history, the validated broker/kernel/replay,
frozen Study 1, private evidence and every prior charge.

The live pilot is **stopped at tick 18**, after 36 decisions, including 32 extension calls.
There is no background run. Source/runtime is `d237effcc129c7757e382a3af8ecc0e95307ebc4`;
original world genesis revision is `cf9947630d4164950b93d03b0b6b6b8c8dc99881`.
A later specifically directed live continuation must use the verified latest private parent
and matching allowance, never a new genesis or an earlier consumed checkpoint.

Goal: let the owner examine provider-returned reasoning, decisions, observations, world evolution,
cost and framework results on one synchronized timeline, with Godot showing that same shard.
The interface must distinguish records from comments, framework scores and human interpretations.

Unimplemented adapters, unanswered questions and chosen caps are further work. They are not
limitations on what the experiment or interface may become.

## Evaluation ownership

The run operator collects execution evidence. It may make attributed comments about returned
reasoning, but must not simultaneously improvise a grade of reasoning or decision quality.
Evaluation belongs to a named framework/scorer or a human reviewer. An assistant-run evaluation
must identify specific metrics, definitions, evidence inputs and results and be a separate step.

Render the framework's recorded value, applicability, rule/version and provenance. Do not invent
an honesty, intelligence, trustworthiness, memory-benefit or deception score from a summary.
A replay pass or schema-valid action is an execution/integrity fact, not a quality grade.
Human annotations must be labelled as the reviewer's interpretation, never as kernel truth.

## Interfaces that exist

| Source | Existing interface and use |
| --- | --- |
| [Continuation ledger](../../src/eval/continuationLedger.ts) | `ContinuationEvent {seq, previous, kind, data, hash}`, durable JSONL appends; `readContinuationLedger`, `verifyContinuation`, `recoverContinuation`, `continuationInspectSamples` |
| [Runner](../../src/eval/continuationRunner.ts) | start/request/response/receipt/validation/tick_intent/transition/failure/stop records; reserve before dispatch, book usage before execution |
| [Conversation codec](../../src/eval/continuationConversation.ts) | `conversationObservations` and `unpackContinuationObservation` reconstruct authorized historical views losslessly |
| [Host](../../src/eval/continuationHost.ts) | `views()`, `identities()`, `tape()`, hashes and real `advance()`; private state, no dashboard listener |
| [Replay](../../src/agent/replay.ts) | `replay(tape, genesisSourceRevision)` reconstructs a ParticipantState; `evidenceHash` and `digest` provide the existing comparisons |
| [Reasoning reader](../../src/agent/anthropicResponse.ts) | Provider-returned summaries/status, signature hashes and redacted-block count; complete raw blocks remain privately archived |
| [Accounting](../../src/agent/experimentBudget.ts) | Authorized grants, requests, booked/held amounts and immutable carried history; a dashboard must not become another writer or accounting authority |
| [Inspect continuation import](../../evals/inspect_node/continuation.py) | Imports independently verified sample JSONL with source revision/root checks; **does not score reasoning** |
| [Godot wire types](../../src/server/worldProtocol.ts) | `helloMessage(world)`, `tickMessage(world, connectionSecret)`, public geometry/station/people DTOs and identity message types |
| [Godot client](../../client/scripts/WorldView.gd) | Connects to `ws://127.0.0.1:8080`; currently handles `hello` and `tick`; renders public shard geometry, people, heat and tension |
| [Existing world server](../../src/server/ws.ts) | `startWorldServer` creates and advances its own world on a timer; **this is not the continuation host** |
| [Browser recording viewer](../web/README.md) | Static export/template pipeline, useful as a visual reference; not a live experiment dashboard |

The current worker archives a completed response. Reasoning text becomes available when the
response is returned and recorded; it is not a token-by-token thought stream. Show pending,
received, absent and redacted states honestly. Actual provider streaming is an optional future
transport task, not something the UI should simulate with invented text.

The live ledger contains private raw response base64. Decode only in the trusted backend and
use the existing reader. Display returned summaries with source/status, not opaque signatures,
redacted payloads or a supposed reconstruction of hidden reasoning.

## Frameworks and metrics actually available

The pinned dependency is [Inspect AI 0.3.282](../../evals/requirements.txt).
The original Inspect solvers run offline `mockllm` tasks. Do not describe AgentDojo,
ControlArena or Concordia as installed evaluation backends: the first two currently inform
adapted patterns; Concordia is not integrated.

| Available producer | Existing output | Adapter required / applicability |
| --- | --- | --- |
| [Inspect export](../../evals/inspect_node/export.py) | Reads Inspect logs with `list_eval_logs/read_eval_log`; emits `results.json`, `episodes.jsonl`, `summary.md` | Normalize existing exported scores and metadata. Preserve source, subject, measure, applicability and evidence; do not create a live continuation score merely by importing samples |
| [Deterministic Inspect scorers](../../evals/inspect_node/scorers.py) | Constraint adherence, goal hijacking, authority deference, sycophancy, deception proxy, oversight, pricing cooperation proxy, collective context, information asymmetry, longitudinal change and integrity | Existing scorers expect an Episode record with scenario/events/ground truth. ContinuationEvent JSONL is a different schema. Build and test a contract-aware bridge before scoring; no blind field renaming |
| [Authority classifier](../../src/eval/constructs/authorityAttribution.ts) | `classifyAuthorityAttribution`, explicit eligibility/attempt/admission/effect outcomes and contract hash | Only for genuine authority-study records/arms. The current two-Baker exploratory pilot has no authority treatment; show not_applicable rather than manufacturing arms |
| [Diary classifier](../../src/eval/constructs/diaryContract.ts) | `classifyDiary`, eligible/written days, adherence and specifically defined grounding outcomes from DiaryRecord | Map real controlled identities, authorized observations, tape and outcome records; preserve denominator/exclusions and contract hash. Recognition is not proof a diary claim is true |
| [Accounted-study analysis](../../evals/inspect_node/analyze_study.py) | Verified/re-classified study records; per-arm rates, exclusions, paired differences and bootstrap intervals; aggregate usage | Import its produced results for Study 1 only. Do not apply its council/anonymous comparison to a continuation-only run |
| [Project RMF mapping](../../evals/inspect_node/rmf.py) | Project-defined mapping of supported scorer outputs; illustrative thresholds and integrity handling | Show attribution and applicability. Never relabel this as NIST certification or general safety |
| Human review | New annotation records linked to evidence | Add an attributed annotation adapter and review UI; no write-back into provider messages, world state or kernel truth |

For a continuation metric that is not already produced, specify its definition, evidence window,
denominator, exclusions, units, contract/version and intended interpretation before running it.
Implement it within a selected framework/scorer and test it separately. Until then display
`not_evaluated`, not zero, a guessed score or an operator impression disguised as a metric.

## Adapters to build

The following filenames are **proposed implementation locations**, not existing files.

| Adapter | Proposed location | Input → output | Acceptance |
| --- | --- | --- | --- |
| A1 Evidence reader/tailer | `src/observatory/ledgerTail.ts` | Configured private segment chain → ordered normalized execution events | Process complete newline-terminated records only; check seq/previous/hash and parent root; detect divergence; deduplicate by stable segmentId + seq + hash; reconnect without repeating calls |
| A2 Reasoning and observation presentation | `src/observatory/reasoning.ts` | Existing receipt/response and conversation codec → exact returned text/status plus current/historical actor view | No summaries invented; signatures/redacted data withheld; patch decode agrees with real authorized projection |
| A3 World projection and actor mapping | `src/observatory/worldProjection.ts` | Read-only reconstructed/host-published ParticipantState → permitted public Godot DTO plus separate researcher snapshot | Same tick/hash as experiment; no second simulation or random draw; role transitions retain actor identity correctly |
| A4 Godot stream bridge | `src/observatory/godotBridge.ts` | Verified projection → authenticated observatory socket with compatible hello/tick payloads | Godot and web display the same run/segment/tick/world hash; renderer cannot submit experiment actions |
| A5 Telemetry metrics | `src/observatory/telemetryMetrics.ts` | Request/response/receipt/validation/transition records → explicitly defined execution measures | Counts, latency and cost reconcile to ledger/journal evidence; unknown stays unknown; no quality judgment |
| A6 Framework results importer | `evals/inspect_node/observatory_export.py` | Existing Inspect/study/classifier outputs → versioned evaluation records | Preserve metric definition, contract, provenance, applicability and exclusions; never claim an importer ran an evaluation |
| A7 Researcher stream/API | `src/observatory/server.ts` | Normalized projections and results → authenticated read-only snapshots + SSE/WebSocket | All clients share one cursor/timeline; permission boundaries and reconnect are tested; no credential/file-path exposure |
| A8 Human annotation | `src/observatory/annotations.ts` | Reviewer text + evidence references → append-only attributed annotations | Never edits world, original reasoning or scores; record author/time/version separately |
| A9 Optional frame export for browser | `src/observatory/frameExport.ts` | Verified Godot/public frame sequence → web scene or replay assets | Captured/replayed/live modes labelled; no false live status or fabricated movement |

Prefer starting from existing sealed evidence: replay the private tick-18 archive and serve it
read-only. This validates joining, presentation, permissions and Godot before any new paid run.

## Godot integration details

Do **not** start `npm run server` and label its newly created world as the experiment.
`startWorldServer` calls `createWorld` and `stepWorld` on its own timer. The observatory must
project the continuation host's committed state, or reconstruct that same state from verified
genesis and tape, without changing the running host's mutable RNG lineage.

For a first adapter, reconstruct committed states on the server from existing replay data.
At a sealed checkpoint, `recoverContinuation` verifies the complete chain and returns the tape.
For live tails, show hash-checked execution events as a verified prefix with an incomplete-stage
status; publish world frames only after a verified transition. An efficient incremental read
model is further work and needs equivalence tests against full replay. Do not call the sealed
ledger reader on a half-written line and treat its expected refusal as permission to repair it.

The host currently exposes no public full-state getter. Either replay into a separate read-only
state or add a deliberately read-only post-commit projection seam, tested to leave state/hash/RNG
unchanged. Do not add a second tick loop or make display subscribers trigger kernel steps.

Reuse the geometry/station DTO shapes in worldProtocol. Its current role-holder handles are
derived from building-slot identifiers; the experiment's controlled identities are stable
persons in `ParticipantState.registry`. Use the private registry location/person mapping and
`personBody` to join them. Do not assume a building slot, actorId, observer HMAC ref and wire
handle are interchangeable across role changes. Any stable-person renderer projection must
preserve the per-connection pseudonym policy and remain outside model input.

Current public payloads:
- `hello`: seed, hub, bounds, districts, buildings, plots.
- `tick`: day, economicHealth, districtTension, stations {buildingId,state,heat},
  people {handle,x,y,role}.
- `identityResolved` / `identityLapsed` types exist; WorldView currently handles only hello/tick.
  Rendering earned/lapsed identity needs a Godot handler extension if selected.

Keep Godot's public stream free of diaries, reasoning, wealth, hidden campaigns and evaluator
ground truth. A privileged researcher panel is a separate authorized channel. The existing
world-server scaffold and non-cryptographic handles are not researcher authentication; do not
expose its claimed-player query parameter as a secure login.

A compatibility stream can send the existing hello/tick objects plus ignored metadata fields:
`experimentId`, `segmentId`, `sourceTick`, `worldHash` and `cursor`.
A final segmentRoot is null until the segment is sealed; an eventHash identifies a live prefix.
Test the actual Godot parser against these additions and make its endpoint configurable rather
than assuming port 8080 is free. Researcher selection/overlays need an explicit scoped mapping;
they must not disclose real identity to ordinary player connections.

The existing Godot app is a native client. A web page does not automatically embed it. First
support synchronized web and native Godot views through the same projection/cursor. An embedded
Godot browser build is a separate export/embedding adapter to select and test if wanted; do not
present that route as already available.

## Proposed normalized data contract

These are new observatory contracts to implement and validate; they are not current endpoints.

```ts
type EvidenceRef = {
  segmentId: string; segmentRoot: string | null; seq: number; eventHash: string;
  requestId?: string; actorId?: string;
};
type ObservatoryEvent = {
  schema: "node-observatory-event-v1";
  experimentId: string; sourceRunId: string; segmentId: string;
  sourceRevision: string; genesisSourceRevision: string;
  cursor: string; segmentRoot: string | null; parentLedgerRoot: string | null;
  seq: number; eventHash: string;
  type: "request" | "response" | "receipt" | "validation" | "transition"
      | "failure" | "stop" | "world_snapshot";
  phase: "execution";
  sourceTick: number; nextTick?: number;
  observedAt?: string; elapsedMs?: number;
  worldHashBefore?: string; worldHashAfter?: string;
  actorId?: string; requestId?: string;
  access: "public_world" | "researcher" | "actor_authorized";
  verification: "hash_checked_prefix" | "replay_verified" | "unverified";
  data: unknown; // typed, allowlisted per type/access in the implementation
};
type EvaluationRecord = {
  schema: "node-observatory-evaluation-v1";
  evaluationId: string; experimentId: string; inputLedgerRoot: string | null;
  inputEventHash: string; evaluatedThroughCursor: string;
  phase: "evaluation";
  producer: {kind: "framework" | "human" | "declared_metric"; name: string; version: string};
  executor?: {kind: "human" | "assistant" | "process"; id: string};
  metricId?: string; metricVersion?: string; definition?: string;
  status: "scored" | "not_applicable" | "not_scorable" | "not_evaluated" | "pending";
  value: number | string | null; unit?: string;
  numerator?: number; denominator?: number; exclusions?: Record<string, number>;
  scope: {actorId?: string; startTick: number; endTick: number};
  evidence: EvidenceRef[]; contractHash?: string;
  createdAt: string; evaluatedThroughTick: number;
};
```

Register a stable segmentId before tailing. The final stop-event root does not exist while
appends are in progress; keep it null until sealed and use seq/eventHash for verified prefixes.
Cursors must not change meaning when a segment is sealed. Source start.runId identifies an
allowance/grant; an extended world may span more than one grant. Preserve sourceRunId and group
the parent-linked world under an explicitly registered experimentId rather than conflating them.
The proposed /runs routes below use that logical experiment registration.

Operator comments belong in a separate attributed comment record, not EvaluationRecord.
Human interpretation can be prose with no numeric value; do not force it into a scored outcome.
If a human or framework uses an assistant, record that producer, executor and specific metric;
do not label a freeform operator remark as a framework result.

Proposed read-only routes:
- `GET /observatory/v1/runs` — sanitized run summaries and status.
- `GET /observatory/v1/runs/:id/snapshot?cursor=...` — allowed current/replay projection.
- `GET /observatory/v1/runs/:id/events?after=...` — resumable SSE or WS cursor.
- `GET /observatory/v1/runs/:id/evaluations` — separately produced, scoped results.
- `GET /observatory/v1/runs/:id/actors/:actor/observations?tick=...` — authorized researcher view.
- A separate authenticated annotation write route, if implemented, with no run-control authority.

Run/segment IDs are registered on the trusted server; requests do not accept arbitrary filesystem
paths. Backend configuration points to private artifacts; never put those paths, secrets or raw
ledger base64 in a frontend build or GitHub. Researcher access and any remote deployment need their
own tested authentication/transport choices. No listener or deployment is created by this handover.

## Explicit telemetry definitions

These are suggested execution metrics to implement/test, not newly reported reasoning scores.

| Metric | Definition and source |
| --- | --- |
| call_attempt_count | Unique durable request IDs in the selected segment chain; do not count embedded parents twice |
| known_usage_count | Unique recorded same-model receipts; unknown/wrong-model outcomes retain their distinct status |
| validator_admission_count | Non-null admitted decisions in validation events; not evidence that their beliefs are correct |
| executed_decision_count | Request IDs joined to actual transition.requests, not merely responses received |
| completed_tick_count | Unique verified transitions; distinguish segment count from absolute final tick |
| response_latency_ms | response.latencyMs for that request; keep wall time and simulation ticks separate |
| input_tokens / output_tokens | Recorded usage; reported thinking tokens are part of output, never added a second time |
| booked_micro_usd / held_micro_usd | Authoritative saved journal/snapshot totals; UI does not recompute or release accounting holds |
| estimated_list_usd | Separately labelled estimate from the applicable recorded rates/usage; not an invoice |
| replay_integrity | Existing independent verifier result and checked-through cursor/root; pending prefix is not full replay success |

Do not open the active writable ExperimentBudget store as a second writer just to draw a chart.
Use a read-only projection derived from durable evidence or a publisher that already owns the
journal; reconcile it offline against an exact verified copy. Retain carried history and current
grant totals separately. State world statistics such as wealth/Gini only in the privileged
research channel and attribute their producing function; they are descriptive context, not grades.

## Interface views

1. Run header: run ID, revision, stage, live/stopped/replay, verified-through tick, cost and holds.
2. Timeline: observation at tick n → request/returned summary → proposal → validation →
   committed transition n to n+1. Pending calls never move the committed world.
3. Actor inspector: current role and authorized current/historical views, actual returned
   summary/status, decision and observed consequences. Dates and historical/current labels stay visible.
4. Shard panel: web projection or synchronized Godot display of the same committed frame.
5. Metrics panel: execution telemetry apart from named framework outcomes and human annotations.
6. Evidence panel: source/contract versions, roots/hashes, applicability and failed/incomplete records.

A selected tick controls all panels. Framework results carry evaluatedThroughTick so a slower
evaluation cannot appear to describe a newer world frame. Historic playback and live following
must be visibly distinct. Framework evaluations can consume declared verified prefixes in separate
jobs; their metric definitions, evidence cursor and evaluated-through tick must remain explicit. Preserve the existing Ember visual language where useful; no colour
should imply reasoning quality without an explicit metric and legend.

## Ordered implementation and acceptance

1. **Private offline archive reader + normalized DTOs.** Load the existing stage chain, reproduce
   36 unique requests / 18 ticks (32 extension requests), and match recorded roots/state hashes.
   Test partial lines, duplicate parents, tampered hashes, reconnect and a stopped run.
2. **Read-only web timeline.** Show recorded summaries exactly, preserve missing/redacted states,
   join each decision to its tick transition and separate observations/comments/evaluations.
3. **Godot projection adapter.** Render the same reconstructed shard; assert day/world-hash
   agreement with the selected timeline tick, role-transition identity consistency and no
   private fields in the public socket. Confirm a fresh standalone world is never substituted.
4. **Framework importers.** First import genuine existing Inspect/classifier outputs; test
   applicability/exclusions. Add a continuation-specific scorer only after its metric/contract
   is declared. Unsupported measures remain not_evaluated/not_applicable.
5. **Authenticated live tail.** Use offline/fake-provider runs first. Browser or Godot reconnect,
   tab opening, replay and metric refresh must cause zero provider calls and zero kernel ticks.
   Slow clients cannot block the runner; use bounded queues and recoverable cursors.
6. **Future live use.** After the owner selects a new run, verify the actual latest private
   checkpoint and accounting. Preserve the current model/contract unless specifically changed.
   Test transport/auth deployment separately; this handover itself authorizes no paid call.

Deliver frontend assets plus backend adapter source/tests, versioned DTO schemas, sample synthetic
data labelled synthetic, and a README distinguishing replay from live operation. Keep credentials
and real private traces out of the web project and repository.

## Reading and commands already available

```powershell
npm run recovery:verify
npm run typecheck
npx vitest run test/eval.continuation.test.ts test/eval.continuationResume.test.ts
node scripts/verify-continuation.mjs <committed-runtime> <private-ledger> <NEW-inspect-jsonl>
# From evals/, using the installed pinned Python environment:
python -m inspect_node.continuation <inspect-jsonl> --source-revision <runner-sha> --ledger-root <verified-root>
```

The verify/import commands do not call models. Use the installed interpreter path, not an assumed
global Python. Do not rerun live scripts or prepare an allowance to make the interface demonstrate
activity. The [documentation index](../README.md) routes current and historical material.
