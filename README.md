# NODE — experiments in an evolving social-economic world

NODE is an independently designed environment for studying how agents interpret circumstances,
use memory, reconsider earlier thinking and make decisions whose consequences develop over time.
Authority, cooperation, information asymmetry and economic behaviour are part of the wider
programme. The current experiment studies reasoning continuity as world state and diary contents
change. Its present implementation is a stage of development, not a ceiling on the programme.

## Current experiment — 2026-10-23

**Latest checkpoint: tick 28, 56 decisions.** The owner-authorized additional 20 calls passed
replay, journal binding, Inspect import and observatory acceptance. New estimated list cost
USD 0.0558532 / booked USD 0.111716, zero held. [Current results and unverified comments](docs/research/CONTINUATION_TICK28_RESULTS_2026-10-23.md).
Earlier tick-18 evidence remains linked from that report. Inference is stopped.

Start with [the current experiment](docs/research/CURRENT_EXPERIMENT.md) and
[read the sanitized results](docs/research/CONTINUATION_PILOT_RESULTS_2026-10-23.md).
They were merged into `main` through
[PR #38](https://github.com/SDarkVader/The-Node/pull/38) at `afbdec7`.

The live pilot has completed **56 paid decisions across 28 real world ticks**. The original
two Baker identities and world continued through another 20 calls; game mechanics changed both
actors into Investigators. Exact own histories persisted. Inference is stopped at tick 28; the
read-only PC observatory is open against that archive.

Agents received their own authorized observations, the rules and available action schema.
Their exact previous messages and returned assistant blocks persisted, including thinking
summaries and opaque signatures. Current recognition, hearing, roles and legal actions still
governed decisions. The diary aged through the real game mechanics.

Diary behaviour changed after recognition developed through repeated dealings. An actual diary
entry expired while earlier exposure remained in the conversation. Baker pricing stayed stable before the recorded role changes.
These are recorded outcomes, not grades of the agents. Whether memory improves decisions,
and how agents use earlier thinking when it becomes stale, are questions for further work.

The latest 20 calls cost **USD 0.0558532 estimated list / USD 0.111716 booked**.
The full extension grant has booked USD 0.234427, zero held, within its USD 1 cap.
Including the initial pilot: USD 0.1223653 estimated list / USD 0.244754 booked.
These are receipt-based estimates, not reconciled invoices.
See [sanitized evidence](docs/research/evidence/reasoning-continuation-tick28-2026-10-23.json)
for counts and hash anchors. Raw experimental data, signatures, credentials and journals remain private.

Earlier verification at runner source `d237effcc129c7757e382a3af8ecc0e95307ebc4`, TypeScript, **1,346 Vitest tests**
with one existing Windows skip, eight recovery checks and hosted Windows/Linux CI passed.
All three live checkpoint segments replayed independently; Inspect 0.3.282 imported the 32 new
samples without extra calls. These are recorded results, not new runs implied by a docs update.

**Observatory and agent perception (2026-10-23)** were built on `ccr-8d64b59c-a4puhv`.
Current review branch `codex/observatory-windows-2026-10-23` extends that work with repeatable
archive acceptance. [Runbook](docs/observatory/README.md).

- **Observatory**: a read-only web view and Godot stream over the continuation ledgers. It shows
  the exact provider summaries, decisions, validation, committed world frames, telemetry,
  separately produced framework results and attributed human annotations. It never dispatches a
  call or steps a host.
- **Agent perception**: the Godot client derives what one agent can perceive at each tick, from
  a first-person or isometric perspective, and the Node validates it before the agent receives
  it. First person: camera frustums, raycasts against the client's own buildings and Wall, fog.
  Isometric: broad district conditions, no person references.
- **Verification**: the private tick-18 archive passed replay, latest-journal binding, HTTP
  scopes, cursor resumption and web/Godot frame synchronization on Windows. At `49a496b`,
  66 selected Vitest tests and TypeScript passed, including all four real-Godot tests using
  Godot 4.7.2-stable. Earlier Godot 4.3 Linux results remain recorded separately. No live model
  has received perception. [Acceptance results](docs/observatory/WINDOWS_ACCEPTANCE_2026-10-23.md).

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
