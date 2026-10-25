> **Main integration, 2026-10-25:** this is the retained original-observer archive interface.
> Its backend now lives in `src/observatory/legacy/`; its registration schema, routes,
> Thinking/History tools, annotations and sample import contracts are preserved.
> Use `npm run observatory:legacy -- serve <registration.json>` (the original
> `npm run observatory -- serve ...` invocation still dispatches here).
> For current legacy/perception/fresh cloud evidence and the completed live run, use
> [the current interface workflow](../research/OBSERVATORY_RUNBOOK.md), or simply
> `npm run preview`. The two registration schemas remain explicit; the historical viewer
> refuses unsupported perception formats rather than drawing a substitute world.

# Observatory and agent perception

Latest world checkpoint: the owner-authorized [environmental continuation](../research/ENVIRONMENTAL_TICK38_RESULTS_2026-10-24.md)
reached tick38 with twenty new calls. Its distinct `perception_*` ledger needs a display/recovery
adapter; the existing observatory registration below still displays the original tick28 archive.

Latest archive: the [subsequent 20-call batch](../research/CONTINUATION_TICK28_RESULTS_2026-10-23.md) reached tick 28 and
passed observatory acceptance over five segments and 29 frames. Use its new private registration
and matching advanced journal for current acceptance. The tick-18 measurements below describe
the earlier checkpoint; its old parent no longer matches the advanced journal for dispatch.

Updated 2026-10-24. See the [current readiness and Claude interface handover](CLAUDE_INTERFACE_HANDOVER_2026-10-24.md)
for resolved Windows/archive, policy-context, movement, independent-audit and A6 import work.
Code: [`src/observatory`](../../src/observatory), Godot scripts in
[`client/scripts`](../../client/scripts). This page is the runbook for both parts:

- **Observatory**: a read-only evidence view over continuation ledgers, in a web page and the Godot
  client. It never dispatches a provider call and never steps a running host.
- **Agent perception**: the Godot client derives what one agent can perceive from its own
  perspective at each tick. The Node validates that derivation before the agent receives it.

Both were built from the [Claude Design observatory handover](../research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md)
and the owner's perception request of the same day.

**Verification so far:**

- Offline TEST-ONLY staged runs and the real Godot 4.3 headless binary on Linux.
- Windows acceptance at `49a496b`: the owner's private tick-18 archive passed replay, journal
  binding, telemetry, HTTP scopes and web/Godot protocol synchronization. All 66 selected Vitest
  tests passed, including the four real-Godot tests on Godot 4.7.2-stable, plus TypeScript.
  [Results and repeatable acceptance command](WINDOWS_ACCEPTANCE_2026-10-23.md).

## Observatory

### Thinking / History

The integrated researcher panel groups exact recorded summaries and complete actions by tick,
with request/evidence IDs, combined filters, local exports and on-demand authorized/current and
historical observations. See the [contract and verification](THINKING_HISTORY_INTERFACE.md).
The server serves its script explicitly. Renderer tokens cannot read history; there is no
outbound webhook connection or model dispatch. Interactive browser review remains further work.

### Replay and live tail

The observatory reads registered ledger segments and nothing else. A sealed segment is
re-verified through `recoverContinuation` and labelled `replay_verified`. A segment that is
still being written is read up to its last complete, newline-terminated record. It is
hash-checked and labelled `hash_checked_prefix`; a torn tail is shown as such, never repaired.
World frames are reconstructed from the recorded genesis and tape and published only after a
verified transition, every state and effects hash re-checked. Opening a page, reconnecting,
scrubbing ticks or refreshing a metric causes zero provider calls and zero kernel ticks.

### Registration

A registration is a private server-side JSON file. Keep it, and every file it names, out of the
repository.

```json
{
  "schema": "node-observatory-registration-v1",
  "experimentId": "continuation-pilot-2026-10-23",
  "label": "Live continuation pilot, ticks 0-18",
  "segments": [
    { "segmentId": "pilot", "sourceRevision": "cf9947630d4164950b93d03b0b6b6b8c8dc99881" },
    { "segmentId": "extension-1", "ledger": "<private ledger path>", "sourceRevision": "d237effcc129c7757e382a3af8ecc0e95307ebc4" },
    { "segmentId": "extension-2", "ledger": "<private ledger path>", "sourceRevision": "d237effcc129c7757e382a3af8ecc0e95307ebc4" },
    { "segmentId": "extension-3", "ledger": "<private ledger path>", "sourceRevision": "d237effcc129c7757e382a3af8ecc0e95307ebc4" }
  ],
  "evaluations": ["<private evaluations.jsonl>"],
  "sampleEvaluations": ["<private independent sample-results.jsonl>"],
  "annotations": "<private annotations.jsonl>"
}
```

- Segments are listed oldest first. Each later segment's start event must embed the previous
  segment as its parent.
- A segment without `ledger` exists only embedded in the next one; here the original pilot is
  embedded in the first extension stage. It is compared against that parent, never counted twice.
- When `sourceRevision` is absent, the start event's own claim is used, and the evidence panel
  says it was not pinned.

### Commands

```
npm run observatory -- verify        <registration.json>
npm run observatory -- serve         <registration.json>... [--host 127.0.0.1] [--port 8090]
npm run observatory -- evaluate      <registration.json> --out <NEW evaluations.jsonl>
npm run observatory -- export-frames <registration.json> --out <NEW frames.json>
npm run observatory:acceptance -- <registration.json> <latest journal> <expectations.json> [<NEW private result>]
npm run observatory:legacy-demo -- <NEW empty directory>      # SYNTHETIC, offline simulated provider
```

- **serve** binds loopback by default. It prints a researcher URL for the web view (the token is
  carried in the URL fragment) and a renderer URL for Godot:
  `godot --path client -- --world-url=<printed URL>`.
- **Tokens** come from `NODE_OBSERVATORY_RESEARCHER_TOKEN` and `NODE_OBSERVATORY_RENDERER_TOKEN`,
  or are generated per run. Responses carry error codes only: no file path, secret or raw
  response bytes.
- **Renderer limits**: the renderer token can read public frames only. Inbound messages from
  Godot are counted and discarded.

### Verifying the private tick-18 archive (owner's PC)

Point a registration at the three private extension ledgers, with the original pilot embedded,
then run `verify`. Compare its output with the sanitized
[extension evidence](../research/evidence/reasoning-continuation-live-extension-2026-10-23.json):

| Field | Expected |
|---|---|
| `uniqueRequests` / `executedDecisions` | 36 / 36 |
| requests per segment | pilot 4, then 8, 8, 16 |
| `completedTicks`, `finalTick` | 18, 18 |
| segment roots | `41adfe1e…1732`, `a25a4afb…2c64`, `3dd3472d…b341` |
| `finalWorldHash` | `61ae622c38dd6a55229e35f635b84725ee5499d7904c0a90c2ec01aff8ab6bc2` |
| `stopHashesMatchFrames` | `true` |
| `telemetry.booked_micro_usd_total` | 133,038 = pilot 10,327 + extension 122,711 |

Accounting is read per allowance grant (`start.runId`), from that grant's last stop summary. Each
extension stage's stop snapshot is cumulative, so the three stages count once if they share the
extension grant's run id, as the evidence records. A mismatch is a finding to report, not
something to adjust.

### Evaluations

`evaluate` runs separate framework jobs and writes `node-observatory-evaluation-v1` records. The
execution timeline never contains a score.

- **Diary**: the existing diary classifier runs through a contract-aware bridge from continuation
  evidence to its `DiaryRecord`.
- **Authority attribution**: this classifier is recorded `not_applicable`, because the pilot
  carries no authority treatment.

The web view lists no-score statuses as `not_evaluated` and dims results whose evaluated-through
tick is behind the selected tick.

**A6 sample import is implemented.** `evals/inspect_node/observatory_export.py` copies existing
Inspect and accounted Study 1 sample results into `node-observatory-sample-evaluation-v1` records,
with exact source SHA-256/JSON pointers, producer/metric definitions and honest score statuses.
The strict reader, researcher-only `/sample-evaluations` route and separate web panel keep these
collections independent of continuation ticks. [Contract and command](SAMPLE_EVALUATION_IMPORT.md).
The importer performs no scoring or model call. It refuses the historical continuation export's
`behaviouralMetrics: not_validated` status and empty Study 1 analysis. A genuine continuation
reasoning metric still needs its own declaration and verified ledger binding.

## Agent perception

### What the agent receives

[`perceptionEpisode.ts`](../../src/observatory/perceptionEpisode.ts) runs agents through the
continuation experiment's own host (`ContinuationHost`) without changing it. At each tick, each
agent's policy receives exactly:

```
{ agentId, tick, worldHash, requestId, perspective, perception, self: { role, roleEpoch, x, y }, legalMoves, rules, decisionSchema }
```

That is its own validated perception record, its own position and role, and its legal moves. It
also receives a public mechanics guide and an action schema narrowed to that perception condition.
The guide explains District Weather, heat, health, roles, visibility and movement timing from the
actual implementation. No hidden hearing/recognized-person references appear in schema enums.
Only Wall/room speech where permitted, listed movement and own Baker price are exposed; diary
and targeted speech need social observations this condition does not supply. The broader broker
rules remain unchanged. The episode records original proposals and exposure-level rejections
before using the host's authoritative validator. It
receives no people list, references, rumours, diary or dealings from the omniscient authorized
observation. The episode also keeps a mirror of the committed state, stepped from each tape tick
and checked against the host's evidence hash. Every request is built from that mirror, so each
observation is bound to the world-state snapshot it describes. A mirror that disagrees with the
host stops the episode, and so does a perception that fails validation. Nothing falls back to
the omniscient view.

### The contract

[`perception.ts`](../../src/observatory/perception.ts) builds one request per agent, tick and
perspective:

- **Bound**: `requestId`, `agentId`, `tick`, `worldHash` and `perspective`.
- **Scene**: public building geometry, station state, heat as a band, the hub, district weather
  as a band and the shard's health band.
- **Bodies**: only those within the perspective's reach.
- **Excluded**: no real person id, observer secret, wealth, stock, diary, conversation, dealing or
  reasoning.

| Perspective | Godot derivation | Reported | Never reported |
|---|---|---|---|
| `first_person` | Four `Camera3D` frustums at the eye facing N/E/S/W; `PhysicsRayQueryParameters3D` raycasts against the client's own building and Wall colliders; sight is the condition's range, shortened by fog | Bodies seen (the observer's own pseudonymous ref, public role, relative position, distance); locations seen (role, slot state, heat band, occupied); the local district's weather band | Bodies hidden by a building or the Wall, beyond sight, or inside a building (unless sharing the agent's cell) |
| `isometric` | One orthographic `Camera3D` over the agent's district plaza; `is_position_in_frustum` | District weather bands for plazas in view, locations in view, a count of bodies in the open per district, the shard health band | Any reference, individual position or role of a person; the request carries none |

**Shared geometry.** [`NodeGeometry.gd`](../../client/scripts/NodeGeometry.gd) holds the building,
person and Wall geometry for both IsoView and perception, so an agent is hidden by exactly what
the client renders.

**Occupancy.** Occupancy follows IsoView: a role-holder at a building is inside it. Walls hide
the body; the building's occupied sign is visible.

**Weather.** The Node world has no optical weather: its District Weather is emotional tension,
perceived here as a band. Visibility (`clear` or `fog` with density and transmittance threshold)
is a declared **condition** recorded with every observation. Godot's exponential fog transmits
`exp(-density·d)`, so sight ends at `-ln(threshold)/density`.

**Validation.** The Node accepts Godot's answer only if all of these hold:

- the answer is bound to the exact request;
- every reported item exists in the request with the same public facts;
- every item is inside the perspective's limits: sight range, the isometric view's reach, and no
  body through walls;
- an isometric answer holds no individual references.

Godot may select and measure. It cannot invent, alter or widen. A refusal fails the tick; it is
never repaired.

**Independent re-derivation.** The base validator checks reported items and does not itself prove
completeness. `auditPerception` now checks the same immutable request through two declared
separate workers, fully validates both records, then compares canonical observations.
`runAuditedPerceptionEpisode` requires this gate before policy delivery and retains audit hashes.
An omitted visible body fails when the second worker reports it. The readiness CLI actually
launches two fresh Godot processes. Agreement does not detect a shared implementation error;
the recorded engine/profile/condition and mutation tests scope this reproducibility evidence.

### Bridge and worker

[`perceptionBridge.ts`](../../src/observatory/perceptionBridge.ts) opens a loopback WebSocket at
`/observatory/v1/perception`. The rules:

- **Authentication**: bearer token, compared in constant time.
- **One worker at a time**, and the worker must first announce the validated profile
  (`node-perception-godot-v1`).
- **Correlation**: every request is matched by `requestId` and bounded by a timeout. A late,
  unknown or duplicate answer is counted and dropped, never given to another request.

`launchPerceptionWorker` copies `client/` to a scratch directory, so Godot's import cache never
lands in the repository. It starts the worker with a minimal environment and no inherited
credentials:

```
godot --headless --path client res://scenes/PerceptionWorker.tscn -- --perception-url=ws://127.0.0.1:<port>/observatory/v1/perception
```

The token goes in `NODE_PERCEPTION_TOKEN`, never on the command line.

### Tests

```
npx vitest run test/perception.test.ts                                  # 27 run, 4 skipped without Godot
NODE_GODOT_BIN=<path to Godot 4.3+ binary> npx vitest run test/perception.test.ts   # all 31
npm run perception:verify -- --out <NEW private directory>  # requires NODE_GODOT_BIN; two real workers
```

Without Godot, these run:

- request privacy and pruning;
- every validator refusal;
- bridge authentication, profile and correlation (including a late answer arriving after a new
  request);
- the episode's per-agent delivery and binding;
- a static check that the Godot scripts read only keys the request builder emits.

The Godot tests use the real headless client:

- **Obscured entity.** On the real day-1 state, a body stands in the open within range, hidden
  from the agent by buildings and the Wall. With those occluders taken away in a hypothetical
  scene, the same eye sees it. The agent steps one plot, the kernel applies the move, and the next
  tick's perception discloses the body. The body did not move. Every record carries the right
  agent, tick and world hash.
- **Perspective switch.** From the same place, the isometric view carries counts and locations
  and no references.
- **Fog** limits sight to the declared range.
- **The Wall** occludes.
- **Determinism**: the same request gives the same observation.

**Mutation checks** (run 2026-10-23, then reverted): each of the following fails the suite.

- Rays never blocked: also refused by the Node's independent walls rule.
- An empty frustum.
- Fog ignored.
- The Wall collider removed.

The CI image has no Godot, so CI runs the unit layer only.

### Further work

- **Portability evidence.** Verified with Godot 4.3 headless on Linux and Godot 4.7.2-stable on
  Windows. All four real-Godot tests passed on the owner's PC; no launcher change was needed.
  Other engine/platform combinations remain further verification work.
- **Live use.** Mechanics-aware rules, scoped action schema, bounded provider-neutral packet,
  audited episode and offline readiness evidence are implemented. No live model has received
  them. A later accounted live adapter must declare its own perception/history condition;
  it must not reuse the old global-observer transcript or relabel the tick-28 pilot.
- **Facing.** Bodies have no facing in the Node world, so first person looks all around. A
  facing direction would be a new world mechanic, not a camera setting.
- **Roleless people on building plots.** The kernel can house a roleless person on a building's
  plot. IsoView draws them there (ghosted) and the overview counts them, while first-person walls
  hide them.
- **Partial visibility.** Only buildings and the Wall occlude. Bodies do not hide one another,
  and partial visibility is sampled at a few points per body, not rendered.
- **Remaining client structures.** Only buildings, people and the Wall are shared geometry.
  Other structures the client draws (ground discs, route ribbons, lights) do not occlude.
