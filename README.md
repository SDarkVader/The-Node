# NODE — experiments in an evolving social-economic world

NODE is an independently designed environment for studying how agents interpret circumstances,
use memory, reconsider earlier thinking and make decisions whose consequences develop over time.
Authority, cooperation, information asymmetry and economic behaviour are part of the wider
programme. The current experiment studies reasoning continuity as world state and diary contents
change. Its present implementation is a stage of development, not a ceiling on the programme.

## Current development — 2026-10-25

The follow-up reasoning audit found identical controls in the supplied historical ledger.
The opt-in per-turn deliberation condition now gives both Bakers identical high effort,
2,048-token output caps and explicit system/per-turn guidance. The fresh 20-tick plan passes
offline rehearsal. [Audit and prepared test](docs/research/REASONING_PARITY_AND_FRESH_TEST_2026-10-25.md).
**The new paid run must not start until the owner approves after readiness.**
For Termux credential transfer, `scripts/credential-envelope.mjs` encrypts locally for the cloud
recipient; plaintext keys never belong in chat, Git or logs. Its `check` command tests
crypto and an existing encrypted output without reading a credential.
The encrypted credential upload has now been authenticated and imported into a private cloud
file. Local format and permission checks pass; provider authentication is untested. The actual
latest accounting journal and separate owner approval remain pending. No new allowance has
been activated and no new provider call has been made.

The cloud observatory connects web and native Godot to one replay-verified continuation world,
with a shared timeline, exact returned summaries, actor-specific observations, admission/effect
records, read-only accounting and separately attributed A01/Inspect evaluations. Configuration,
read-only recovery preflight and credential-separated Node execution work remotely.
[Run the integrated workflow](docs/research/OBSERVATORY_RUNBOOK.md).
[Verified results and screenshots](docs/research/CLOUD_OBSERVATORY_RESULTS_2026-10-25.md).

At runner source `0bdb48a`: 1,363 Vitest tests, 32 Python tests, eight recovery tests,
80 native checks and G1–G3 passed. All 29 archived hashes match. The later observer
refinement passed all 21 targeted tests; desktop/mobile and both native parser checks pass.
The final Vitest 4.1.12 dependency update also passes all 1,363 tests and TypeScript,
with zero vulnerabilities from `npm audit --audit-level=low`.

Development branch: `codex/cloud-observatory-2026-10-25`, in
[PR #39](https://github.com/SDarkVader/The-Node/pull/39), based on main `afbdec7` (merged PR #38).
The offline rehearsal uses seven roles, 140 scripted decisions and 20 kernel ticks, including a
sealed-checkpoint restart. Synthetic reasoning/accounting are explicitly labelled. No paid
provider call or Study 1 reactivation is part of this work. Real pilot evidence remains private.

```sh
npm run observatory:demo -- ../node-demo
npm run observatory:evaluate -- ../node-demo/registration.json synthetic-rehearsal ../node-demo/a01-evaluation
# Configure private access tokens, then:
npm run observatory -- ../node-demo/registration.json
```

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
