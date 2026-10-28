# NODE — experiments in an evolving social-economic world

2026-10-28 PC launcher check at source `6307a8e`: the missing private launcher settings
were restored with a pointer to the verified latest closed journal and a registry of six
preserved live runs. `START-NODE.ps1 -Ticks 1 -NoBrowser` launched an offline preview,
served the Observatory and embedded Godot page, and completed one manual day with
227 decisions, 51 synthetic controlled requests, zero provider calls and zero report
integrity issues. Its saved tape replayed to the same final hash. The preview exited
cleanly and released the launcher lock. PR #56 remains draft. This PC-specific repair
does not grant a paid run. [Scoped offline evidence](docs/research/evidence/launcher-offline-restoration-2026-10-28.json).

CI follow-up: the routine launch test now asserts the reviewed $0.032 per-request ceiling.
The dual-navigation suite also checks that a route returned after a competing submission is rejected.

NODE is an independently designed environment for studying how agents interpret circumstances,
use memory, reconsider earlier thinking and make decisions whose consequences develop over time.
Authority, cooperation, information asymmetry and economic behaviour are part of the wider
programme. The current experiment studies reasoning continuity as world state and diary contents
change. Its present implementation is a stage of development, not a ceiling on the programme.

## Run on the configured PC

The standalone launcher works in ordinary PowerShell without this chat or Work running:

```powershell
powershell -NoProfile -File .\START-NODE.ps1
```

For a short real-agent test, use `-Start -Ticks 1`. Review the printed source, rules, call
and spending bounds, then type `START`. Keep the terminal open. The script opens one
Observatory containing Godot, manual day controls and saved-run replay. Its private preset
reuses the PC's configured paths and latest accounting history. No live call starts by default.
[Workflow, setup and raw output](docs/research/SEQUENTIAL_DAYS_2026-10-26.md).

## Current development — 2026-10-27

The supervised run at source30d9527 completed all18actual Anthropic calls:6decisions per
inhabitant,18returned summaries and73total society decisions. Six agent-selected trips traversed
33legal Godot steps. An agent reached a non-adjacent workplace in one decision, received its
correct first-person work option and recorded work. All18exactrequest/privacy checks, response
agreement and partial replay pass; no system leakage/outside-game action was observed.
The approved five-turn bound left the day unfinished; no full paid day or settlement is claimed.
[Sanitized execution evidence](docs/research/evidence/eighteen-call-navigation-verified-2026-10-27.json).

Current Society requests have16384outputtokens,120s timeout and a USD0.032 per-request ceiling,
fully reserved before dispatch. The successful run booked USD0.085607 with zero held; combined
conservative exposure across all four preserved attempts is USD0.158947, within the original
USD0.40 cap. Prior journals, failed attempts and raw evidence are preserved; latest history is
closed/carried and the launcher is ready for the owner's next reviewed run. No further paid
calls are authorized by that completed test. Source30d9527 passed136scoped tests/10files,
final3request checks, strict types and8recovery tests, including nativeGodot integration.

Fresh PC runs now use dual-perspective navigation: one overhead world map plus the current
Godot first-person view per decision. Agents select reachable geographical destinations;
Godot routes the journey through existing legal adjacent plots without extra model calls.
Travel occupies that decision; the next normal decision supplies arrival sight and local
interaction options. Hearing, recognition, lexical speech and task permissions stay separate
from map knowledge. Historical tapes retain their original rules.

Implementation `e8369f9` passed 1,990 tests in 158 files with native Godot, one platform skip, eight recovery
tests and TypeScript. An actual six-step trip reached its workplace, exposed the arrival work
option and recorded work; the production controller also completed a day using a fake provider.
These checks made zero paid calls. [Implementation and execution evidence](docs/research/DUAL_PERSPECTIVE_NAVIGATION_2026-10-27.md).

To repeat the native proof from PowerShell, using the configured PC Godot path:

```powershell
$nodeSettings = Get-Content "$env:LOCALAPPDATA/The-Node/test.local.json" -Raw | ConvertFrom-Json
node --import tsx scripts/verify-dual-navigation.ts --godot $nodeSettings.godot --output "$env:TEMP/node-navigation-$([guid]::NewGuid())"
```

A separately authorized PowerShell check at `70d71bd` completed six actual Haiku calls: two
decisions per Miller/Baker, all with nonempty returned thinking summaries. Exact requests,
action execution, private-state noninterference and cold replay passed with zero integrity
issues. It intentionally stops after one action turn without completing a day. USD 0.020403
is booked, zero held; its closed history is now carried. Raw traces remain private and the
run is saved in the Observatory selector. [Sanitized check](docs/research/evidence/six-call-schema-check-2026-10-27.json).

Fresh PC runs now select the versioned `inhabitant-v1` information contract within Society v4.
Every resident receives the active public economic parameters, own role tenure, own last food
receipt and paid Oracle result, alongside existing personal assets, diary, heard speech, local
conditions and daily duties. Commit-phase menus now agree with the schema's phase restrictions.
The last-egress worker checks the complete allowlist; old tapes retain their original contract.
The preview now honours `-Seed`. A standalone zero-provider verification is available:

```powershell
node --import tsx scripts/verify-node-operational.ts --output "$env:TEMP/node-proof-$([guid]::NewGuid())" --ticks 3
```

Implementation `6665eef` passed 1,979 tests across 157 files with actual Godot enabled and one
platform skip, plus eight recovery tests and project/CLI TypeScript checks. Three offline days
verified 1,148 decisions, 897 moves, 42 diary writes and 42 food receipts. The actual standalone
PowerShell/browser run completed two manual days, with synchronized Godot, historical selection,
exact observation inspection, raw exports and cold replay. Preserved actual evidence independently
replayed all 98 requests/responses through 383 decisions with zero conflicts. The owner approved
append-only closure of the historical authorization; previous entries, USD 0.304048 booked and
zero held remain intact. Final-source PowerShell preparation with STOP passed with no allowance,
execution or journal mutation. That historical verification granted no new paid approval. [Verification and commands](docs/research/OPERATIONAL_AGENT_CONTRACT_2026-10-27.md).

The 2026-10-27 Society v4 repair pass addresses shared-cell rendering and interrupted-run
evidence recovery. The private interrupted run was independently reconstructed only through
its last recorded outcome; no day was committed. Future v4 runs record each accepted
submission for source-pinned offline recovery. The existing adjacent-step movement and
constrained communication rules remain unchanged. See the
[repair record](docs/research/SOCIETY_V4_REPAIR_2026-10-27.md).

The new opt-in Society v4 contract supplies several fresh action turns per day. Residents
visit their task locations, buy or attempt to buy food, post on the Wall, perform role work,
communicate with customers under the lexical rules and write a diary before day closure.
Diary subjects are optional; the vocabulary stays constrained. Prices lock before choices,
and grain, flour, income and sales remain in the existing economy. A failed food attempt is
recorded and can permit closure after the other duties. A turn or spending limit preserves
the unfinished day. Old tape versions keep their original replay semantics.

The same PC interface provides run, day, turn, agent and decision selection, manual control,
read-only replay and per-tick/full chronological provider-returned thinking. Raw exports
retain each agent's exact contexts, choices, submissions and transitions across all turns;
missing thinking remains explicit. Godot and the stronger 2D overview use recorded world
state. No hidden reasoning or decorative simulation events are fabricated.

The approved free daily Oracle trial and independent paid lottery remain available, with
health-linked odds, bounded prizes and separate game-resource accounting. Postcard accrual,
safe/shortcut fusion, temporary vouchers and mechanical vacancy/backstop behaviour remain.
Variable-call real runs close unused authorisation through an append-only journal event,
then carry the latest history into the next separately reviewed test. USD ceilings remain.

PR51's colour follow-up merged at `0e8797a`; PR52's optional-subject diary merged at
`a345a68` after Windows/Linux checks passed. Source `0ee1325` passed 1,921 tests /
151 files, zero failures and seven environment skips; three offline days cold-replayed
51 decisions and 42 diary writes. New v4 source `c4ac041` passes 1,964 tests /155 files,
zero failures and seven environment skips. Three days cold-replay 1,148 decisions and
42 diary writes with identical repeated tape bytes. Actual standalone Windows preparation
and the embedded-Godot manual preview pass with zero provider calls. [Earlier source-specific history](docs/DEVLOG.md).

A supervised live run at `bb1b232` was stopped during day 1 to preserve credit. It recorded
98 responses, with USD 0.304048 booked and zero held; no day was committed. The private
chronological exports contain 32 Miller and 33 records for each Baker. No boundary violation
or illegal action was observed. [Sanitised run evidence](docs/research/evidence/society-live-partial-day-2026-10-26.json).
The interrupted accounting history and raw traces remain private and must be preserved.

Initial v4 assumptions are explicit: one district, existing residential capacity, shared
Wall/Oracle hub, and minimal deterministic streets joining previously unreachable plots.
Full A04 trespass and multi-district daily routing remain further work. These are not claims
that all future society mechanics are finished. Study 1 and historical evidence stay intact.

## Historical first-person development — 2026-10-25

The owner-approved **fresh first-person Godot run completed 20 ticks and 40 paid Haiku calls**.
Both Bakers returned **7 nonempty thinking summaries in 20 decisions**. Every request used the
same system, explicit per-turn guidance, high effort and 2,048-token total output cap; both
started with zero inherited model turns. All responses ended normally, with no failures or
paid retries. The new allowance booked **USD 0.100100**, with zero held funds, within its USD 1
cap. The forty-request authorization is consumed; the run is stopped and Study 1 remains paused.
[Live results and verification](docs/research/FIRST_PERSON_LIVE_RESULTS_2026-10-25.md).

The original audit confirms **14/28 versus 8/28**, followed by **2/10 versus 1/10** through
tick 38. Both actors had equal medium-effort adaptive controls and complete own histories.
The exact runtime from [PR #41](https://github.com/SDarkVader/The-Node/pull/41) verifies that
archive. Adaptive thinking permits omissions; no actor-specific lower budget or parser loss
was found. The fresh condition adds common high effort and explicit deliberation guidance.
Its equal observed counts do not establish a causal effect or guarantee a summary every tick.
[Diagnosis and versioned conditions](docs/research/REASONING_PARITY_AND_FRESH_TEST_2026-10-25.md).

The cloud observatory connects web and native Godot to one replay-verified experiment world,
with shared history selection, verbatim returned summaries, authorized observations, decisions,
effects, current accounting and separately attributed evaluations. Two actual Godot workers
agreed on all forty live perception packets; independent replay, final observatory world and
journal binding pass. Desktop/mobile and both native views agree on selected live-run history.
Inspect AI separately reports execution share 40/40; A01 is explicitly not applicable to the
first-person diary-null condition. Private transcripts, journals, credentials and live
screenshots remain outside Git. A private portable viewing bundle was prepared for the owner.

At first-person source `be8a3b4652a58e4740a8fb310143223e176e72dc`, all **1,458 Vitest tests /
116 files** passed with actual Godot, plus eight recovery tests. At follow-up/live source
`93f4a9966cedd326e709b96bbdcbc9ee8b632026`, TypeScript, eleven fresh/transport tests, independent
runtime preflight and all hosted checks pass. The earlier seven-role synthetic society proof
and separate evaluations remain scoped in the [cloud results](docs/research/CLOUD_OBSERVATORY_RESULTS_2026-10-25.md).

Shared recovery branch: `main`. [PR #39](https://github.com/SDarkVader/The-Node/pull/39)
consolidates the cloud line with PR #40 at `5f84cc0`, including merged PR #41.
The cloud interface and fresh first-person workflow stay the default. The original-observer
Thinking/History interface, annotations and sample importer are retained under
`src/observatory/legacy/`, with their original explicit registration/API contracts:
`npm run observatory:legacy -- serve <legacy-registration.json>`. Original `observatory --
serve|verify|evaluate|export-frames` commands remain compatible. Both viewers reconstruct
recorded experiment worlds; neither runs a substitute simulation or dispatches a model.
[Integration details and supported entry points](docs/recovery/MAIN_INTEGRATION_2026-10-25.md).

**Open the interface:** follow the [Windows PC or private-Codespace recipe](docs/research/OBSERVATORY_RUNBOOK.md#open-the-interface-on-your-pc-or-in-a-private-codespace).
The synthetic demo needs Node/npm and no provider key or Godot installation. To view the
actual completed run, use the owner's private viewing bundle and its relative registration;
viewing does not dispatch a model or advance the experiment. The PR does not provision a
public host. [Synthetic screenshots and proof](docs/research/evidence/first-person-offline-2026-10-25.json).
The [GitHub-first handover](docs/recovery/GITHUB_FIRST_CONTINUATION.md) records the completed
run and the requirement to use its new latest journal for any separately authorized follow-up.

## Recorded live experiment — 2026-10-23

Start with [the current experiment](docs/research/CURRENT_EXPERIMENT.md) and
[read the sanitized results](docs/research/CONTINUATION_PILOT_RESULTS_2026-10-23.md).
They were merged in [PR #38](https://github.com/SDarkVader/The-Node/pull/38).

The live pilot completed **36 paid decisions across 18 real world ticks**, using two Bakers
and Haiku 5.5. An initial four-call pilot was extended by 32 decisions over 16 ticks, continuing
the same world and exact signed own histories. It stopped at the recorded exploratory tick-18
checkpoint; nothing is running in the background.

Agents received their own authorized observations, the rules and available action schema.
Their exact previous messages and returned assistant blocks persisted, including thinking
summaries and opaque signatures. Current recognition, hearing, roles and legal actions still
governed decisions. The diary aged through the real game mechanics.

Diary behaviour changed after recognition developed through repeated dealings. An actual diary
entry expired while earlier exposure remained in the conversation. Price policy stayed stable.
These are recorded outcomes, not grades of the agents. Whether memory improves decisions,
and how agents use earlier thinking when it becomes stale, are questions for further work.

Extension cost was **USD 0.0613495 estimated list / USD 0.122711 conservatively booked**,
with zero holds, within its USD 1 allowance. Including the initial pilot: USD 0.0665121 estimated
list / USD 0.133038 booked. These are receipt-based estimates, not reconciled invoices.
See [sanitized evidence](docs/research/evidence/reasoning-continuation-live-extension-2026-10-23.json)
for counts and hash anchors. Raw experimental data, signatures, credentials and journals remain private.

At runner source `d237effcc129c7757e382a3af8ecc0e95307ebc4`, TypeScript, **1,346 Vitest tests**
with one existing Windows skip, eight recovery checks and hosted Windows/Linux CI passed.
All three live checkpoint segments replayed independently; Inspect 0.3.282 imported the 32 new
samples without extra calls. These are recorded results, not new runs implied by a docs update.

The [original observatory handover](docs/research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md)
is historical design context. The [current runbook](docs/research/OBSERVATORY_RUNBOOK.md) documents
the implemented adapters and remaining development work.

## How the environment and evaluation work

The persistent simulated society connects Millers, Bakers, Couriers, Investigators,
Import/Export roles and roleless inhabitants through production, deliveries, wages, wealth and
social encounters. Roles can change. Recognition is earned directionally through direct address
and repeated dealings; public presence is not private knowledge. Current diaries are short-lived
and can drift. In the implemented A01 contract, authors choose entries from menus; their
impressions are not automatically certified as fact.

The authorized observer supplies actor-specific information. Proposals pass the existing
validator before the deterministic kernel advances the shared world. Records keep proposal,
admission and actual effect distinct. Replay reconstructs mechanical consequences from genesis
and admitted actions; accounting reserves before dispatch and books known usage before action.

The live continuation runner is in `src/eval/continuationRunner.ts`. Its parent-linked checkpoints
reconstruct the original world and exact histories; a used allowance resumes only its matching
latest checkpoint. The original Inspect solver runs offline `mockllm` fixtures; Inspect also
imports verified live continuation exports. It does not dispatch these live calls.
[Infrastructure map](docs/EVAL_INFRASTRUCTURE.md) ·
[Continuation runbook](docs/research/REASONING_CONTINUATION_2026-10-23.md).

## Evaluation is separate from execution

The operator records facts and may make attributed comments on returned reasoning. Evaluation
belongs to named framework/scorer outputs or human interpretation. If an assistant evaluates,
it must use specific declared metrics and report that work separately; it must not grade the
reasoning by freeform judgment while running it. The pilot's Inspect imports and replay checks
are provenance/execution checks, not reasoning-quality scores.

## Separate studies and further work

Authority-attribution Study 1 is a **separate paused study**, with seven controlled actors,
label-only council/anonymous/no-notice arms, contract 1.1.0 and a frozen manifest. Its current-view
memory condition is unchanged; it is not the completed continuation pilot.
[Study 1 runbook](docs/research/RUNBOOK_AUTHORITY_STUDY_1.md).

The original scripted Inspect suite, framework patterns and construct classifiers remain useful
infrastructure. AgentDojo and ControlArena inform adapted patterns; their native packages and
Concordia are not integrated. NIST AI RMF mappings are project-defined, not certification.

Next research and development include memory-condition comparisons, transcript bounds and
degradation, mechanics-grounded interpretation/decision checks, wider live roles and seeds, and
additional game transactions such as complete restricted trespass. Describe each as work to
undertake and verify. Missing features, unrun tests, defects and configurable caps are **not**
limitations on what the experiment may become. Any actual boundary needs explicit conditions
and a concrete reason. [Scope, evidence and development](docs/EVALUATION_SCOPE_AND_DEVELOPMENT.md).

## Run offline checks

Use Node 24 and the locked dependencies:

```sh
npm ci
npm test
npm run typecheck
npm run test:session-recovery
```

The recorded Python evaluation setup pins Inspect AI 0.3.282. On Windows:

```powershell
py -3.14 -m venv .venv-eval
.venv-eval/Scripts/python -m pip install -r evals/requirements.txt
cd evals
../.venv-eval/Scripts/python -m unittest discover -s tests -v
../.venv-eval/Scripts/python -m inspect_node.verify --out results/verify
../.venv-eval/Scripts/python -m inspect_node.constructs --out results/authority
../.venv-eval/Scripts/inspect eval node_tasks.py@node_control --model mockllm/model
```

On Unix use `.venv-eval/bin/`. Choose new output directories to preserve prior evidence.
These commands run offline checks, not new paid experiments.

## Documentation and recovery

[Documentation index](docs/README.md) · [Current experiment](docs/research/CURRENT_EXPERIMENT.md) ·
[Current checkpoint](docs/recovery/CURRENT_SESSION.md) ·
[Fresh-session guide](docs/recovery/GITHUB_FIRST_CONTINUATION.md) ·
[Architecture](docs/BLUEPRINT.md) · [Development history](docs/DEVLOG.md).

Read the current checkpoint and verify actual Git state before continuing. A Git clone contains
committed source and sanitized context, not unpublished work or private runtime/accounting data.
Preserve local work, all prior charges and Git history. A later live continuation needs its exact
latest private parent and matching allowance; do not recreate the grant or replay consumed calls.
