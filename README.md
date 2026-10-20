# NODE

*Nobody is fully anonymous here. Nobody is fully known either. Everyone knows
something; nobody knows everything. There's always another shard to run to —
but what the node did together, it did for good.*

NODE is a persistent multiplayer social-economic game. Its deterministic simulation
combines interdependent roles, uncertain social information, decaying personal memory,
and migration between settlements. The TypeScript server runs the world; the Godot
client renders it. The evaluation harness tests agent decisions against the real
participant pipeline.

## Current state — 2026-10-20

This integration tree brings the verified development work into `main`. The review
branch is `consolidate-main-2026-10-20`; `main` is the destination and intended shared
line after merge. The branch audit is recorded in
[the consolidation report](docs/recovery/MAIN_CONSOLIDATION_2026-10-20.md).
[PR #21](https://github.com/SDarkVader/The-Node/pull/21) was merged there at `2941067`,
including the independently reviewed evaluation fixes and evidence. The consolidation PR separately preserves `main`'s existing documentation and security
work. The unique Godot sky/navigation and Vitest 5 branches remain outside this tree.

- **Game:** five economic roles (Miller, Baker, Courier, Investigator and Import/Export),
  roleless inhabitants, vacancies/backstops, conscription, housing, the Oracle, Wall
  posts, proximity communication, rumour and diary decay, and multi-shard migration.
- **Funded settlement is the default:** wealth follows the person through role changes;
  the dock funds nodules, district pools fund wages, and upkeep transfers a proportion
  of holdings to the dock. The legacy economy remains available for comparison.
- **Alternative shards no longer depend on population growth.** A population-independent
  cap currently allows three shards; stability and cooldown gates still apply.
- **Participant infrastructure:** authorized observations, authenticated action admission,
  bounded Baker price input and movement, durable checkpoints, deterministic replay,
  and isolated mechanical-host execution. The ordinary Godot server and the durable
  participant trial are separate entry points.
- **Evaluation:** Inspect AI runs one controlled Baker through the real observation,
  request builder, validator and kernel. Current evidence uses scripted offline fixtures.
  Live-agent evaluation remains disabled.

Read [the current session checkpoint](docs/recovery/CURRENT_SESSION.md) for continuity,
[the blueprint](docs/BLUEPRINT.md) for architecture, and
[the development log](docs/DEVLOG.md) for dated history. Older stage reports retain their
historical meaning; they do not supersede this status or the current source.

## Verified evidence

The consolidation runtime at `8281db6` was rechecked with the full offline suite.
Hosted CI then exposed a wall-clock-dependent deadline fixture; its clock is now
deterministic and an earlier-expiry regression is added. The current local suite has
1,189 Vitest tests. Runtime/evaluation/dependency files still match development `320592e`;
the recovery branch-contract regression brings recovery checks to eight. Earlier PR #21
verification used code `96a431f`, evidence `298b636`, and identical-tree merge `2941067`.

| Check | Result |
|---|---|
| Vitest | 1,189 passed across 95 files after the deadline-fixture correction |
| TypeScript | Passed |
| Python evaluation unit tests | 18 passed |
| Session-recovery tests | 8 passed; fresh review/main checkouts also verified |
| Native broker/participant checks | 80 passed, using target `41da84f` as baseline |
| Two independent Inspect runs | 29 samples each; 29/29 final state hashes and event digests match |
| Replay | 29/29 in-memory and exported-record replays verified in each run |
| Scripted fixture checks | 56/56 passed in each run |
| Inspect CLI control task | 2/2 samples passed |

[Full commands, reproduced failures, fixes and limitations](docs/recovery/PR21_REVIEW_2026-10-20.md)
and [current consolidation evidence](evals/evidence/main-consolidation-2026-10-20/)
are available in the repository. The standalone 44-check broker run overlaps the
combined 80 native checks; it is not 124 distinct checks.

These tests establish harness and simulation behaviour. They do not establish a real
model's reasoning, cooperation, honesty or long-term strategy. Subjective Wall states
are not proof of deception, low prices alone are not proof of harmful competition,
and a passive monitor flag does not demonstrate prevention.

## Run the simulation

Node 24 is recommended; `package.json` also accepts the supported Node 20.19 and
22.12 release lines. From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run test:session-recovery
npm run playtest          # terminal rendering with synthetic drivers
npm run server            # mechanical world over WebSocket
npm run settlement-report # compare legacy and funded settlement
```

For the visual client, follow [client/README.md](client/README.md). The ordinary
world server does not persist its world across restarts; durable participant
checkpoints use the separate [participant recovery path](docs/recovery/CHECKPOINT_RECOVERY.md).
These simulation and offline-test commands require no model key or paid inference.

## Run the offline evaluation

Install Node dependencies above first. On Windows, from the repository root:

```powershell
py -3.14 -m venv .venv-eval
.venv-eval/Scripts/python -m pip install -r evals/requirements.txt
cd evals
../.venv-eval/Scripts/python -m unittest discover -s tests -v
../.venv-eval/Scripts/python -m inspect_node.verify --out results/verify
../.venv-eval/Scripts/inspect eval node_tasks.py@node_control --model mockllm/model
```

On Unix, use the corresponding Python interpreter and `.venv-eval/bin/` executables.
Python 3.14.3 and Inspect AI 0.3.282 were used for the recorded verification.
`verify` executes the full suite twice and independently replays exported evidence.
Use a new output directory for a separate verification run so prior logs are not mixed in.
See [EVAL_INFRASTRUCTURE.md](docs/EVAL_INFRASTRUCTURE.md) for tasks and export details.

Inspect is integrated as the runner. AgentDojo and ControlArena are currently adapted
patterns, not installed native integrations; Concordia is not integrated. Current
scorers and the monitor are deterministic rules, and NIST mappings/thresholds are
project interpretations. Installing framework packages alone would not validate the
behavioural constructs.

## Next work and existing limits

The next evaluation step is the
[accounted-agent and framework-alignment design](docs/DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md),
with execution disabled. It specifies feasible Node behaviours, controls, evidence
boundaries, an accounted inference path, and bounded decision-justification metrics.
That integration and explanation contract are designed, not implemented.

The existing harness, shard fix and PR conflict resolution do not need rebuilding.
The next implementation should first prove that each proposed task is feasible using
current actions, then connect evaluation inference through the existing accounted
broker. It must preserve the kernel, observation boundary, validator and replay.
Broader cooperation, factual deception, multiple controlled agents, held-out seeds
and long-horizon reasoning need additional experimental coverage; existing fixtures
cannot supply it by changing labels.

Automatic event-derived personal memory and non-editing event marks, complete restricted
trespass transactions, and individual abode tracking remain game implementation gaps.
Growing beyond three shards and the intended settlement balance remain design choices.

Live inference stays blocked by `assertLiveAdmission`. Missing private accounting
records, unknown billing and historical holds remain unresolved evidence; a fresh
clone is not a fresh allowance. No model request, paid judge, credential diagnostic,
operator settlement or accounting reset is enabled by these instructions.

## Repository map and continuation

| Location | Purpose |
|---|---|
| `src/engine/`, `src/world/`, `src/sim/` | Mechanics, kernel and simulation/reporting tools |
| `src/server/`, `src/agent/` | Server, participant host, observation, broker and accounting boundaries |
| `src/eval/`, `evals/` | Node episode bridge and Python Inspect tasks/scorers |
| `client/` | Godot client |
| `test/`, `evals/tests/` | TypeScript/native and Python tests |
| [AGENTS.md](AGENTS.md) | Common assistant entry point and documentation-maintenance contract |
| [GitHub-first continuation](docs/recovery/GITHUB_FIRST_CONTINUATION.md) | Cross-device source and evidence rules |
| [Current checkpoint](docs/recovery/CURRENT_SESSION.md) | Active branch, completed work, limits and next steps |
| [Original build brief](docs/NODE_Build_Brief_v1.pdf) | Original design intent |

Start a fresh session from the current GitHub branch, then run `npm run recovery:verify`.
After meaningful work, update this README and the tracked checkpoint together, link
verified evidence, and record history in the devlog. Keep one current status here;
do not stack old “Current” banners above it. Local hooks and ignored recovery snapshots
are optional and do not transfer private state or credentials between machines.
