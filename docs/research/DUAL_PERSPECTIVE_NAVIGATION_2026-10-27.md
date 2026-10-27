# Dual-perspective navigation — 2026-10-27

The candidate branch `codex/dual-perspective-navigation-2026-10-27` builds on PR57's
`47b3000`. The original paid runs and their journals remain unchanged. The later owner-approved paid
attempt is documented below; preceding development checks used no paid calls. The policy responses below are explicitly scripted;
they establish execution integrity, not model reasoning quality or provider acceptance.

## Supervised paid attempt

The owner approved 18 calls with a USD0.40 total ceiling and a stop on system leakage or
outside-game behaviour. Source323794f launched from PowerShell with native Godot, Observatory,
the reviewed postcard/Oracle configuration, and at most five action turns after commit.
Three commit calls succeeded. The fourth request, the first action call, returned HTTP400
because the provider rejects anyOf with sibling object keywords. The controller stopped before
travel admission; the remaining fourteen requests were never sent. No paid subsequent behaviour
or completed day is claimed. Three returned summaries are preserved verbatim, without grading.

Four exact authorized observation checks and three response/admitted-action comparisons pass.
No system-data leakage or outside-game action was observed in that evidence. The three-decision
partial tape replays. USD0.011077 is booked; USD0.014643 remains held because the rejected response
contains no usage receipt. This is an unresolved reservation, not a confirmed additional charge.
The previous journal is unchanged, the key copy is removed, and the newest history/pending run
remain preserved. No automatic retry, zero-cost assumption or reset occurred.

The offline correction preserves the authoritative game schema while generating a bare anyOf
of complete closed alternatives for the provider. Internal refs are inlined, and an equivalence
guard checks every alternative against the original property constraints. The live worker accepts
only the corrected format. Historical read-only inspection retains exact original format checks.
23 focused checks and a native-Godot/fake-provider two-day controller check pass. Acceptance of
the corrected format by the actual provider remains further verification after accounting recovery.
See the [sanitized stop evidence](evidence/eighteen-call-navigation-stop-2026-10-27.json).

## Implemented contract

Fresh configured PC preview and preparation select `routine.navigation: "dual-v1"`
with `information: "inhabitant-v1"`. Historical tapes without this marker keep their
original observations, adjacent action menu and replay semantics.

Each decision receives a single immutable, allowlisted packet containing:

- Public overhead district plots, building geometry and locations; per-observer
  pseudonymous inhabitants and positions; public heat bands, district weather and
  conditions, hub and economic health.
- The current first-person observation derived by the existing native Godot worker,
  using its cameras, physical raycasts, inside-building treatment and fog model.
- Existing personal state, own memory and feedback, independently bounded hearing
  and recognition, public rules, duties and current interaction permissions.

To avoid sending the same map twice, local geometry contains the occupied plot and locations
selected by Godot sight. The overhead packet retains the full district geometry, every public
location and inhabitant. This keeps the default postcard/daily-Oracle packet within the existing
65,536-byte request ceiling; no request or spending ceiling was increased.

The agent chooses a reachable same-district coordinate in `move`. Travel requires all
other fields to be null. Godot AStar2D finds a route over existing plots; Node independently
checks reachability, shortest route length, adjacency, plot membership and arrival, then
applies every step through the existing participant movement checks. It neither queries
a policy along the route nor executes interactions at intermediate positions. The next
regular decision receives the arrival first-person view and newly applicable interaction
menu. There is no perspective-switch action or per-waypoint model call.

Map knowledge grants no hearing, recognition, lexical address, diary subject, remote work,
purchase or Oracle permission. Speech still resolves at starting-turn positions; travel
resolves afterwards. Daily economy, income, food and Oracle settlement still run once at
day end. Existing routine topology and same-district movement boundaries remain in force.

Worker bindings, hashes, engine metadata and route records are operator-only. They are
stored with decisions and durable submissions so replay, interruption recovery and the
Observatory can verify the exact delivered packet without launching another worker.
Observation preparation and route completion reject stale world bindings. Cancellation
during route computation stops before admission.

## Execution evidence

Implementation e8369f9 passed **1,990 tests across 158 files**, with one Windows
platform skip and native Godot enabled. Eight session-recovery tests and strict project
and affected CLI TypeScript passed. Subsequent browser testing exposed a pending-request
journal-decoder fault; that was corrected and a native regression test now covers a live
request encoded exactly like the production journal. Focused tests were rerun after this
fix and cancellation/noninterference checks were added. Focused controller/navigation checks passed after the repairs. The PowerShell/browser preview
completed one day with 227 decisions and 51 controlled policy packets, with embedded Godot
rendering and replay verified through day 1. The last schema compatibility refinement was
then verified through the native trip and full fake-provider production-controller flow.

The transport uses only scalar coordinate enums, grouped by legal columns; it reuses closed
local grammars through internal `$defs`/`$ref`. It avoids complex enum values and stays
within the existing request-size limit. These features match the provider's documented
[supported schema subset](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Provider acceptance remains untested by an actual paid request.

Saved-run polling now hashes the actual named evidence bytes and call archives before deciding
whether expensive decoding/replay is needed. Same-size edits with restored timestamps are
still detected. Trusted controller revisions avoid repeatedly cloning an unchanged live tape.
Shutdown closes unfinished browser requests; the foreground preview explicitly exits after finalizing evidence and closing its servers. A native child-process regression authenticates, stops the real CLI, verifies exit zero and checks that its tape was retained.

The actual production controller completed one day using native Godot and a fake provider.
Each controlled decision has exactly one request and its own perception record; each move
has validated navigation evidence. Exact request egress, world outcomes, full tape replay,
durable submission recovery and Observatory reconstruction passed.

The standalone native proof observed a Miller at `(2,-1)` select workplace `core-0-b0`
at `(1,-6)`. Godot returned six legal steps:

```text
(2,-2) → (2,-3) → (1,-3) → (1,-4) → (1,-5) → (1,-6)
```

Work was unavailable at departure and available at arrival. Godot's arrival first-person
view included the Miller workplace at distance zero, heat `hot`, state `FILLED`. The second
scripted decision chose work and the next observation recorded the work duty complete.
All 33 worker requests were delivered, with zero refusals, timeouts or unmatched responses.
The 31-decision partial tape and Observatory reconstruction verified. This short proof
has zero committed days; a separate model-free CLI run completed a full day with 227
decisions, 320 legal movement steps and 14 diary writes.

Private evidence retains exact departure/arrival request bytes, scripted responses,
Godot perception and navigation records, complete tapes and machine-readable test results.
No private ledger, credential, observer secret or experiment artifact is committed here.

## Repeat from PowerShell

The configured PC launcher opens the actual society, Observatory, embedded Godot and saved
history. Enter its printed local interface token and select **Advance one tick**:

```powershell
powershell -NoProfile -File .\START-NODE.ps1 -Ticks 1
```

This default is a deterministic preview and makes no provider calls. For an independently
repeatable native navigation proof, with fresh retained output:

```powershell
$nodeSettings = Get-Content "$env:LOCALAPPDATA/The-Node/test.local.json" -Raw | ConvertFrom-Json
node --import tsx scripts/verify-dual-navigation.ts --godot $nodeSettings.godot --output "$env:TEMP/node-navigation-$([guid]::NewGuid())"
```

An unconfigured clone can instead supply an explicit Godot 4 executable. The ordinary
offline CLI also accepts `--daily-turns 64 --dual-navigation --godot <executable>`.

Actual-provider use remains behind the existing source-pinned, fresh-plan review and
spending authorization flow. The corrected output format has not been retried against the provider;
the rejected request still requires usage reconciliation. No merge is required to run this checkout; another checkout must contain
the navigation branch or its merged changes.
