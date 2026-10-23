# Observatory and agent perception

Updated 2026-10-23. Code: [`src/observatory`](../../src/observatory), Godot scripts in
[`client/scripts`](../../client/scripts). This page is the runbook for both parts:

- **Observatory**: a read-only evidence view over continuation ledgers, in a web page and the Godot
  client. It never dispatches a provider call and never steps a running host.
- **Agent perception**: the Godot client derives what one agent can perceive from its own
  perspective at each tick. The Node validates that derivation before the agent receives it.

Both were built from the [Claude Design observatory handover](../research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md)
and the owner's perception request of the same day.

**Verification so far:**

- Offline TEST-ONLY staged runs and the real Godot 4.3 headless binary on Linux.
- No run against the private tick-18 archive has been made from the cloud, because that archive
  is private and lives on the owner's PC. The commands for doing so are below.

## Observatory

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
npm run observatory:demo -- <NEW empty directory>      # SYNTHETIC, offline simulated provider
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

**Further work: importing Inspect and Study 1 outputs (handover A6).** The Python importer
`evals/inspect_node/observatory_export.py` was not built, because nothing genuine for a
continuation run exists to import:

- `inspect_node.export`'s `results.json` scores scripted-fixture Episode samples.
- Study 1's `analyze_study` produces per-arm aggregates for a study that has not run live.
- The Inspect continuation import is explicitly `behaviouralMetrics: not_validated`.

None of these carries the ledger cursor or tick scope an evaluation record states. Two routes are
open:

- An owner-chosen contract for records about non-ledger samples.
- A continuation scorer declared with its metric, definition, denominator and exclusions first.

## Agent perception

### What the agent receives

[`perceptionEpisode.ts`](../../src/observatory/perceptionEpisode.ts) runs agents through the
continuation experiment's own host (`ContinuationHost`) without changing it. At each tick, each
agent's policy receives exactly:

```
{ agentId, tick, worldHash, requestId, perspective, perception, self: { role, roleEpoch, x, y }, legalMoves }
```

That is its own validated perception record, its own position and role, and its legal moves. It
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

**What validation does not establish.** The Node does not re-derive visibility: a second physics
engine in the Node would be a second source of truth. So a worker that left out a visible body
would pass. Determinism, the pinned profile and the request/response hashes in every record make
an independent re-derivation check possible: replaying recorded requests through a second
worker. That check is further work.

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

- **Portability.** Verified with Godot 4.3 headless on Linux. The launcher passes the Windows
  system variables sockets need but has not been run on Windows.
- **Live use.** No live model has been given perception. Policies in the tests are scripted.
  Wiring perception into a provider request is a separate experiment design, with its own
  rules text and tests.
- **Facing.** Bodies have no facing in the Node world, so first person looks all around. A
  facing direction would be a new world mechanic, not a camera setting.
- **Roleless people on building plots.** The kernel can house a roleless person on a building's
  plot. IsoView draws them there (ghosted) and the overview counts them, while first-person walls
  hide them.
- **Partial visibility.** Only buildings and the Wall occlude. Bodies do not hide one another,
  and partial visibility is sampled at a few points per body, not rendered.
- **Remaining client structures.** Only buildings, people and the Wall are shared geometry.
  Other structures the client draws (ground discs, route ribbons, lights) do not occlude.
