# Observatory readiness and interface handover

Updated 2026-10-24. Review foundation branch: `codex/observatory-interface-review`, extending Claude's
`ccr-8d64b59c-a4puhv` at `0d70803`. Start with this file and
[`CURRENT_SESSION`](../recovery/CURRENT_SESSION.md), then verify actual Git refs/worktree.
The original checkout, main, private live-run files and accounting remain separate.

## Owner assigned responsibilities

The owner assigned Claude the interface/presentation work and Codex the backend and Godot
integration on the PC. This handover was delivered to Claude's existing observatory conversation;
the session accepted the message and showed working status. This does not claim that interface
implementation is complete.

| Responsibility | Owner |
|---|---|
| Web interface, UX, evidence panels and display adapters over existing contracts | Claude |
| Broker/experiment integration, accounting, replay, game mechanics, Godot worker/client integration and PC verification | Codex |

Claude should base interface work on this development line in a separate branch and record any
contract requests in a committed handover. Coordinate shared files instead of editing backend
or Godot integration modules concurrently. No security/credential changes or new experiment
calls follow from this assignment.

Codex verified native desktop access to the installed Godot editor: an isolated copy of the
current client opened `IsoView.tscn`, and selecting `Camera3D` displayed its inspector. The
original checkout and tracked source were not changed. Existing two-worker headless tests remain
the programmatic-control evidence. A combined private archive/renderer launcher was rejected by
automatic approval review with only `blocked by policy`; that command did not execute. Native
editor launch/inspection succeeded through the supported desktop/CLI route.

The archive connection subsequently passed through the standard read-only observatory CLI and
a separate Godot invocation. Native IsoView displayed the real stopped archive at tick 28,
followed the shared replay cursor to tick 14, then returned to tick 28; both displayed hash
prefixes matched the corresponding API frames. Native Q/E camera rotation also passed.
The latest ledger/journal fingerprints and 56 recorded calls/decisions stayed unchanged.
No security settings, accounting records, world state or model requests were changed.
[Sanitized native-view verification](evidence/native-archive-view-2026-10-24.json).

## Progress since Claude's handover

| Item in the earlier handover | Current implementation and evidence |
|---|---|
| Windows launcher not tested | Real Godot 4.7.2-stable on Windows passed the original perception tests and new two-process audit tests. Linux 4.3 evidence remains historical. |
| Private tick-18 archive not checked | Tick 18 passed earlier. Latest tick 28 passed acceptance again: five segments, 56 decisions, 29 frames; exact latest-journal binding, authentication, resumption, frame hashes and unchanged files. |
| District Weather only a band | Kernel weather was already implemented. A new policy guide explains the real signal, band edges, relationships and consequences without disclosing hidden causes. |
| Movement needs to be usable | Every current legal cardinal destination and relative step is in the guide and action schema. A real kernel move updates the next policy input and replay agrees. Stay remains a legitimate option. |
| Provider-facing perception contract missing | A mechanics-aware, bounded, provider-neutral packet and scoped action schema now exist. They prepare requests offline; they do not alter the original live continuation request/history condition. |
| Worker could omit visible items | New independent-process re-derivation rejects differing canonical observations before policy delivery; tests include an omission accepted by the base subset validator. Both engine versions and hashes are recorded. |
| A6 Inspect/Study 1 importer missing | Python adapter, strict TypeScript reader, researcher API and a separate sample-collection web panel are implemented. Existing scored samples are imported without fabricated continuation cursor/tick scope. |

## Environment and action meaning

District Weather is aggregate emotional tension. The kernel combines vacancies, consolidation,
same-day sabotage and detected pressure, then spreads the strongest signal with Manhattan
plaza-distance attenuation. Calm/uneasy/tense bands use the declared condition edges. A tense
band does not identify its cause, actor or motive and does not itself impose movement, visibility,
hearing or wage penalties. Fog is a separate optical condition affecting first-person sight.
The original world mechanics and visual weather implementation were not replaced.

First person retains the four-camera, all-direction view and shared building/Wall occlusion.
Isometric retains its distinct aggregate view, including roof-obscured open bodies as IsoView
does. No facing state or physical weather mechanic was invented. A body missing from the
observation is not proof it disappeared from the world.

Walking uses one listed cardinal adjacent plot in the current district, or `null` to stay.
Godot geometry occludes sight; the broker does not make it a walking collision map. No teleport,
cross-district/hub route, new job, trespass or diary-access action follows. Version 2 resolves
speech from the initial position and applies a move only if the same body/role/place survives
the world tick; admission and execution are separate. Version 1 movement is applied before the
world day and later transitions can relocate the body again. Courier wage explanations also
branch by actual rules version: fixed workplace distance in v2, current avatar distance in v1.

The new perception condition exposes no diary, recognition list or hearing list. Its schema
therefore exposes no diary subjects or targeted-speech references. Wall/room speech is retained
where the original role/version allows it; no heard messages are supplied. Only a current Baker
can submit a price. The broader authored diary/social contract remains unchanged elsewhere.

## Interfaces Claude can build against

| Source | Contract and use |
|---|---|
| `src/observatory/perceptionContext.ts` | `buildPerceptionAgentInput(request, record, authorizedView)` returns only validated perception, own role/epoch/position, legal moves, mechanics `rules` and a scoped `decisionSchema`. Never forward the full authorized view to a policy. |
| Same module | `perceptionPolicyPacket(input, maxBytes)` prepares `node-perception-policy-packet-v1`. Default development byte ceiling is 65,536; oversized packets fail closed. This is not a provider token estimate or a change to any live model/budget. |
| `src/observatory/perceptionEpisode.ts` | `runAuditedPerceptionEpisode(plan, policies, primary, independent)` uses two declared separate workers. `ticks` retain perception records, original proposals, exposure-level rejections, host verdicts and actual effects; `audits` retain agreement evidence. |
| `src/observatory/perceptionAudit.ts` | `node-perception-independent-audit-v1`: request/agent/tick/world/perspective plus worker IDs, engine versions and request/response/observation hashes. Divergence throws before affected policy delivery. |
| Existing authenticated API | `/observatory/v1/runs/:id/{snapshot,timeline,telemetry,evaluations,events}` and the Godot frame stream remain separate execution/evaluation sources. Researcher-only data must never reach the renderer token. |
| New researcher-only API | `GET /observatory/v1/runs/:id/sample-evaluations` returns `{scope: 'independent_sample_collections', records, notAttachedToTimeline: true}`. Registration field: `sampleEvaluations: [<private JSONL paths>]`. Malformed sources return fixed error 409, without partial rows or paths. |
| `src/observatory/sampleEvaluations.ts` | `node-observatory-sample-evaluation-v1` carries collection/sample, producer/importer, metric definition/status/value, exact source SHA-256 and JSON pointer. It rejects invented ledger/tick fields. |

Keep the immutable request, perception record, policy packet, proposal, admission and effect linked
by agent/tick/request/world hash. For display, label District Weather as tension, optical weather
as visibility, show the proposed move separately from the next actual position, and show role/epoch
changes. Display first-person and isometric content according to their contracts; never fill a
hidden field from a researcher frame. Quality, trust, deception and memory benefit are not UI
inferences. Display only declared framework results or attributed human annotations as such.

Independent sample collections belong in their own panel. Do not gray or filter them by the
selected continuation tick, convert placeholder zeros into scored results, or call the importer
a scorer. See [A6 import contract and command](SAMPLE_EVALUATION_IMPORT.md).

## Repeat the offline readiness check

```powershell
$env:NODE_GODOT_BIN = 'C:\path\to\Godot_console.exe'
npm run perception:verify -- --out '<NEW private directory>'
npm test -- --maxWorkers=4
npm run typecheck
npm run test:session-recovery
$env:PYTHONPATH = 'evals'
python -m unittest discover -s evals/tests -v
```

Use the established Python environment containing the pinned `evals/requirements.txt` packages.
The readiness command requires a fresh output directory and starts/stops two actual Godot
processes. It writes `readiness.json` and `perception-evidence.json`: four synthetic ticks,
eight scripted decisions/packets and eight independent agreements; exact submitted move equals
the next position, and final tape replay matches. These files are fixture evidence, not live
agent reasoning or a scientific evaluation. They are useful development inputs for the interface.

For existing live data, repeat `observatory:acceptance` using the latest private registration,
expectations and matching journal, as described in the [runbook](README.md). Do not resume the
tick-18 parent against the advanced tick-28 journal, create a new allowance, or repeat paid calls.

Implementation source: `2f425507d454eabf3337f9651ef200b3c4af1bd6`. [Sanitized verification record](evidence/readiness-2026-10-24.json).

## Verified results and remaining work

Full suite: **1,454 passed across 114 files**, one existing platform skip, zero failures.
TypeScript, explicit readiness-script typecheck and eight recovery tests passed.
Implementation source and current checkpoint are recorded in
[`CURRENT_SESSION`](../recovery/CURRENT_SESSION.md). The focused readiness run passed eight
audits/admissions and replay with zero model calls. The existing committed Inspect fixture
imports as 319 sample records: 142 scored, 167 not applicable and 10 not scorable; these are
existing fixture results, not grades of the live Bakers. All 39 Python tests passed in the
established environment. The initial default Python could not import `inspect_ai`; locating the
existing environment resolved that verification failure without changing dependencies.

The initial browser tool inventory was empty. Native Godot control and archive viewing were
subsequently verified through the available Windows controller: camera rotation, replay cursor
14 to 28 and matching API frame hashes. This is a scoped native renderer check; an interactive
browser UI review remains part of Claude's interface work. HTTP scope/integrity tests, JavaScript
syntax and static interface wiring already passed.

Agreement between two processes is a reproducibility check, not proof against a shared renderer
implementation error. A different implementation, additional mutation/geometry cases or human
visual review can extend the evidence; do not label agreement complete visibility correctness.

No paid model has yet received the new perception condition. A later live integration must bind
the packet/schema and a declared own-transcript policy to its accounted runner and preserve its
original request/response evidence. Do not silently attach the old global-observer transcript or
rewrite the tick-28 experiment as perception evidence. This handover authorizes no model call.
Live reasoning-quality metrics and memory-condition comparisons remain separately specified
research/evaluation tasks, not missing interface scores to invent.

## Next task for Claude

### Thinking / History integration follow-up

Your commit `c151e41` has been cherry-picked as `3484264` onto the Codex development branch and
integrated with the real contracts. Start from the updated development branch before further UI
work. The original commit remains on your branch; main is unchanged. Read
[THINKING_HISTORY_INTERFACE](THINKING_HISTORY_INTERFACE.md) for the corrected API and scope.

The original script was absent from the server's static allowlist. Its filter results were not
used to render, filter inputs reset on every render, world hashes could be null, admission was
an object rather than a boolean, and reasoning statuses differed from those declared by the
adapter. CSV quoting and selected-export statistics were incomplete. The external response
used unsafe HTML interpolation, and arbitrary webhook destinations were blocked by existing CSP.
These defects are corrected; the same-origin policy remains intact. There is no active external
model connection, and full signed conversations are not claimed by a summary-backed view.

Backend `thinking-history` now supplies the canonical filtered record and statistics; the client
uses text nodes, handles stale/failed responses and exports that same selection. Actions retain
their full objects and IDs. Original authorized views and remembered historical views expand
on demand through the existing checked endpoint. No researcher history is supplied to actors.

Local archive acceptance: 56 unique decisions/28 ticks, 22 with nonempty summary text, exact
matches to the existing private evidence package, five registered ledger/journal files unchanged.
The full suite passed with two workers (1,461 tests, one existing skip); three additional client
DOM/event tests and TypeScript passed. An earlier unconstrained full run had no failed
assertions but reported two perception suite errors; both files passed separately (52 tests)
and the bounded full rerun passed. No protected core was changed. Native browser control
stopped because it could not confidently determine the current URL for policy enforcement;
do not claim interactive browser verification. The controller was not bypassed.

Owner follow-up on 2026-10-24: visual display on the PC is confirmed by the owner. Treat this as
human visual verification, separate from the stopped automated attempt above. Individual filter,
observation-expansion and download interactions were not itemized; do not invent those results.

Please continue presentation/UX and the remaining weather/fog/role/legal-move views against
these APIs. Connecting an external evaluator needs an explicit destination, allowed data,
model/accounting and result provenance. It remains separate from experiment execution.

Continue the interface on this branch after verifying Git/recovery. Use the existing read-only
API for the real tick-28 archive, the independent sample panel for imported results, and the
synthetic readiness packet/record/audit contract for new perception displays. Build tension,
visibility, role, legal-action and proposal-versus-effect views, verify them interactively, and
preserve the token scopes and information asymmetry. Do not start inference, mutate experiment
ledgers/journals, or replace main. Update the tracked checkpoint and root README before handover.
