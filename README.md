# NODE — experiments in an evolving social-economic world

NODE is an independently designed environment for studying how agents interpret circumstances,
use memory, reconsider earlier thinking and make decisions whose consequences develop over time.
Authority, cooperation, information asymmetry and economic behaviour are part of the wider
programme. The current experiment studies reasoning continuity as world state and diary contents
change. Its present implementation is a stage of development, not a ceiling on the programme.

## Current development — 2026-10-25

The reasoning audit confirms the original **14/28 versus 8/28** summary counts and a further
**2/10 versus 1/10** through tick 38. Actual controls match and exact own histories are preserved for both
actors; the exact runtime from [PR #41](https://github.com/SDarkVader/The-Node/pull/41) verifies
the complete archive. Adaptive medium-effort thinking left emission optional.

The owner selected a **fresh 20-tick first-person Godot test**, with zero inherited model turns.
Both agents receive common high effort, a 2,048-token output cap and explicit guidance on every
turn. Perception components from #40/#41 are integrated into the cloud branch; fresh and
historical perception ledgers feed the same verified web/Godot observatory. Two actual workers
agree before delivery. The development offline rehearsal completed 40 synthetic decisions /
20 real ticks; the committed runtime and independent replay also pass.
[Diagnosis, selected plan and readiness workflow](docs/research/REASONING_PARITY_AND_FRESH_TEST_2026-10-25.md).

**The paid run remains stopped until readiness and separate owner approval.** The encrypted
credential is installed privately and passes local format/permission checks. The actual latest
accounting journal is still required; no new grant has been activated or provider request sent.
The proposal is capped at USD 1 with a conservative forty-request ceiling of USD 0.881920.
Actual provider emission remains unverified by the synthetic rehearsal.

The cloud observatory connects web and native Godot to one replay-verified continuation world,
with a shared timeline, exact returned summaries, actor-specific observations, admission/effect
records, read-only accounting and separately attributed A01/Inspect evaluations. Configuration,
read-only recovery preflight and credential-separated Node execution work remotely.
[Run the integrated workflow](docs/research/OBSERVATORY_RUNBOOK.md).
[Verified results and screenshots](docs/research/CLOUD_OBSERVATORY_RESULTS_2026-10-25.md).

At first-person source `be8a3b4652a58e4740a8fb310143223e176e72dc`, all **1,458 Vitest tests /
116 files** passed with actual Godot enabled. Eight recovery tests passed. The bundled
preflight makes zero provider/count requests and activates no allowance. Two real workers
agreed on all forty perception packets in the committed twenty-tick synthetic rehearsal;
independent compiled replay and observatory world hashes matched. Separate Inspect AI 0.3.282
execution share is 40/40; A01 is not applicable to the diary-null condition. Earlier seven-role
society evidence remains scoped in the linked cloud results.
The follow-up Chromium check passed on desktop/mobile, with both native Godot views matching
the selected historical cursor. Fresh plan validation/download and stale-response protection
passed; source ledgers/journals stayed unchanged.
[First-person proof and screenshots](docs/research/evidence/first-person-offline-2026-10-25.json).

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

For a complete Windows or browser-only launch recipe, including access-token setup, see
[Open the interface](docs/research/OBSERVATORY_RUNBOOK.md#open-the-interface-on-your-pc-or-in-a-private-codespace).
The demo needs Node and npm, with no provider key or Godot installation. The separate native
first-person rehearsal also requires Godot. The PR is source for review; it does not host a
public interface or activate an experiment.

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
