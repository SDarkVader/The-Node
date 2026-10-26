# NODE — experiments in an evolving social-economic world

NODE is an independently designed environment for studying how agents interpret circumstances,
use memory, reconsider earlier thinking and make decisions whose consequences develop over time.
Authority, cooperation, information asymmetry and economic behaviour are part of the wider
programme. The current experiment studies reasoning continuity as world state and diary contents
change. Its present implementation is a stage of development, not a ceiling on the programme.

## Open the interface

In a terminal on the computer where you will open the browser:

```sh
git clone --branch main https://github.com/SDarkVader/The-Node.git The-Node-main-review
cd The-Node-main-review
npm ci
npm run preview
```

Wait for **Observatory ready**, open the printed URL and paste the printed **interface login
token**. Keep the terminal running. The default is a two-tick synthetic demo, with no provider
key or paid calls. To view the owner's completed run, use
`npm run preview -- <private-bundle>/registration.json` instead.

For browser-only access, [open a private GitHub Codespace on main](https://codespaces.new/SDarkVader/The-Node?ref=main),
wait for dependency setup, then run `npm run preview` in its terminal. Open the printed
Codespaces HTTPS URL, keep port 8090 private, and use the printed interface token.
`127.0.0.1` always refers to the device opening the browser; a cloud process is not reachable
at that address from your phone or PC. `ERR_CONNECTION_REFUSED` means the server has not
started on that device/forwarded port. This repository does not provision a public host.

## Current development — 2026-10-26

The postcard-enabled society is now wired through the real agent runner. Prepare a small
PowerShell behaviour test from this checkout:

```powershell
powershell -NoProfile -File scripts/start-society-playtest.ps1 -PostcardRate 2/1 -Ticks 3
```

PowerShell prompts for the latest completed accounting journal, credential file and a new
private output folder. Preparation makes no calls and prints the exact command to start
the reviewed run with `-ApprovePaidRun`. Three days allow at most 18 Haiku calls and USD 1;
the source, rate, 24-hour game day, plan and carried history are pinned. Each agent can claim,
bank or fuse its own postcards alongside ordinary work, movement, communication and purchases.
[Real-agent test instructions and raw output locations](docs/research/POSTCARD_AGENT_PLAYTEST_2026-10-26.md).
The original paid Oracle/vouchers remain available. A separate configured daily Oracle ledger
is implemented but remains inactive pending reward calibration and world funding integration.

The first two [Oracle/civic handoff](docs/research/NODE_ORACLE_CIVIC_IMPLEMENTATION_HANDOFF_2026-10-26.md)
slices implement postcard accounts: explicit millisecond time, a required rational White/hour
rate, a 16-hour unclaimed buffer, retained fractional credit and five-to-one safe fusion.
An explicit v2 upgrade adds same-tier Green/Blue/Purple shortcuts: stake 1–5 cards for exact
`k/5` odds, consume the whole stake and produce one next-tier card only on success. Five is
guaranteed without a random draw; White stays safe-only and Orange is final. Named issuance
on success and burns on loss reconcile every transaction. Stable transaction IDs prevent
retries from consuming more cards or draws, including after a saved-state reopen.
The existing v1 state, replay and proof sources remain unchanged.

```powershell
npm run postcards:proof -- --output .codex/session-recovery/postcard-proof.json
npm run postcards:proof -- --verify .codex/session-recovery/postcard-proof.json
npm run postcards:shortcut-proof -- --output .codex/session-recovery/postcard-shortcut-proof.json
npm run postcards:shortcut-proof -- --verify .codex/session-recovery/postcard-shortcut-proof.json
```

Both proofs use explicit synthetic clock/asset events at the original illustrative 2 White/hour,
with zero provider calls. The new shortcut proof covers 31 fixed cases, v1 acquisition tapes,
v2 snapshots, delayed duplicates and atomic failures. At implementation source
`e173dbf37f401111a876ccea835bd334f7e1d085`, all **1,779 tests / 140 files pass**, with zero
failures and seven environment skips, plus project/CLI TypeScript and eight recovery tests.
This includes 111 new tests and 15,000 seeded transactions. Two cold proof files are identical;
40 v2 records, nine restored checkpoints and ten rejected attempts verify.
[Source-anchored shortcut evidence](docs/research/evidence/postcard-shortcuts-2026-10-26.json).
[Mechanics, accounting and current verification](docs/research/POSTCARD_SHORTCUTS_2026-10-26.md).
The earlier v1 source `8011e60972948990b5f5d00e84663bc5542c3a79` passed 1,668 tests / 137 files,
with seven environment skips, plus TypeScript and eight recovery tests; its cold proof verified
five scenarios/183 events/three checkpoints with identical repeat bytes.
[Preserved v1 evidence](docs/research/evidence/postcard-core-2026-10-26.json).
PR #44 published the society runner; PR #46 integrated the postcard core into main at `1217c9b`.
[PR #47](https://github.com/SDarkVader/The-Node/pull/47) publishes the verified shortcut slice.
The opt-in playtest now binds accounts to stable person identities and provides allowlisted
agent menus, validated actions and an explicit 24-hour virtual day. Ticket migration,
individual abodes and subsequent Oracle/civic slices remain further work. No default rate
or paid experiment is activated by checkout or preparation.

### Preserved society mechanics

An opt-in secure society now runs two initially controlled Bakers and one Miller, with autonomous
Courier, Investigator, Import/Export and roleless residents. Daily locked Wall prices, explicit
production/customer choices, finite grain/flour, genuine sales/completion, local observations,
communication, eligible diaries and escrow-backed expiring Oracle entries are implemented.
Invalid actions halt execution. Old leaking paid-dispatch paths are closed; archived replay stays
available. Historical worlds, private journals and stopped studies are preserved.

```powershell
npm run society -- --ticks 14 --output .codex/session-recovery/society/proof-14.json
npm run society -- --verify .codex/session-recovery/society/proof-14.json
npm run society -- --interactive --ticks 3 --output .codex/session-recovery/society/supervised-3.json
```

The first commands use deterministic model fixtures; interactive play supervises local JSON
choices. Neither bills a model. The new accounted model runner requires separately reviewed
approval, a matching carried allowance and private evidence paths; it has only been exercised
with synthetic senders. Saved tapes/plans use lossless evidence encoding, including optional
configuration values, and are checked after reopening. [Implementation, assumptions, security trace and exact run commands](docs/research/SECURE_AGENT_SOCIETY_2026-10-25.md).
[PR #42](https://github.com/SDarkVader/The-Node/pull/42) merged after all three hosted workflows passed.
The twenty-tick follow-up, published through [PR #44](https://github.com/SDarkVader/The-Node/pull/44), supplies a standalone PowerShell launcher:
`powershell -File scripts/start-society-live.ps1 -Config <private-launch.json>`. Add `-CheckOnly`
for read-only readiness. This belongs to the earlier society task. The postcard work invokes no live path and grants no
spending authorization; historical approvals must not be reused.
Explicit plans support at most twenty ticks/120 calls with a USD1 cap. Raw per-inhabitant JSONL
contains exact contexts, legal choices, returned summaries, actions, transitions and failures;
`npm run society:dump -- --input <private-run> --output <new-private-dump> --raw` exports them.
At runtime source `acb0d0b`, **1,568 Vitest tests / 131 files pass**,
with seven explicit environment skips, plus TypeScript. **80 compiled native checks** against the
original kernel and **eight recovery tests** also pass. Independent saved-file replay passes for
14 and 60 ticks. The longer run records 889 decisions, 78 real bread orders, 306 diary writes,
natural District Weather changes and 75 voucher redemptions; maximum accounting residual is
`1.45e-13`. [Scoped verification evidence](docs/research/evidence/secure-society-offline-2026-10-25.json).

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
