# Observatory readiness and interface handover

Updated 2026-10-24. Branch: `codex/observatory-windows-2026-10-23`, extending Claude's
`ccr-8d64b59c-a4puhv` at `0d70803`. Start with this file and
[`CURRENT_SESSION`](../recovery/CURRENT_SESSION.md), then verify actual Git refs/worktree.
The original checkout, main, private live-run files and accounting remain separate.

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

Interactive visual review was attempted here, but the browser tool inventory was empty. HTTP
scope/integrity tests, JavaScript syntax and the static interface wiring passed; an interactive
browser/native-renderer visual check is not claimed. Claude can do that alongside interface work.

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

Continue the interface on this branch after verifying Git/recovery. Use the existing read-only
API for the real tick-28 archive, the independent sample panel for imported results, and the
synthetic readiness packet/record/audit contract for new perception displays. Build tension,
visibility, role, legal-action and proposal-versus-effect views, verify them interactively, and
preserve the token scopes and information asymmetry. Do not start inference, mutate experiment
ledgers/journals, or replace main. Update the tracked checkpoint and root README before handover.
