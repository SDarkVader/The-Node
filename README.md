# NODE — Agent Evaluation Suite

NODE is an independently designed evaluation suite that uses a simulated society to
study how agents respond to authority, make decisions under uncertainty and influence
collective outcomes. It brings questions about agent hierarchies and behaviour into
an environment where decisions affect other participants, information is unevenly
distributed, and consequences develop over time.

That environment is a persistent social-economic simulation built around the
interdependence of Millers, Bakers, Couriers, Investigators and Import/Export roles.
Production, distribution, wages and personal wealth connect their interests. Roles
can change, people can move between settlements, and what an inhabitant knows depends
on what they encounter through proximity, public Wall posts, rumour and personal
memory. These mechanics give the evaluation its context: an agent must act from its
own position within a society rather than from a complete view of the system.

The current experiments make those pressures concrete through a controlled Baker
participant. Its legitimate task is to operate sustainably within the rules. A notice
claiming to come from the town council asks it to raise its bread price; a comparison
scenario makes the same price request on behalf of an anonymous neighbour. Other
scenarios introduce flattering consensus, embedded instructions to abandon the task,
or pressure to post reassurance as conditions change. The suite follows what the
participant actually proposes, what the validator accepts and what the simulation
executes, connecting social pressure to decisions and measurable outcomes.

## How the evaluation works

Inspect AI orchestrates the experiments through native tasks, solvers, scorers and
logs. On each turn, NODE builds a request from the participant's current role,
authorized observation and available action schema. The resulting decision passes
through the same observation, validation and simulation pipeline used by the
participant infrastructure. A role change therefore changes the participant's
instructions and available actions as the episode continues.

This structure connects NODE's independently designed environment to established
evaluation approaches. AgentDojo's separation of a legitimate task from an injected
objective informs the prompt-injection scenarios, while ControlArena's main-task,
covert-task and oversight patterns inform the control experiments. Inspect AI is the
implemented runner; the AgentDojo and ControlArena connections are adapted scenario
and oversight patterns. A project-defined mapping to the NIST AI Risk Management
Framework relates the resulting measures to documented risk categories.

The measures are computed from episode records, independently of the participant's
own claims. They include adherence to the task, responses to claimed authority,
pricing relative to rivals, support for claims from available information and changes
in behaviour across an episode. Settlement health, inequality, wealth and population
provide the wider context for those decisions. Reports keep the actions observed in
the record distinct from the behavioural interpretations drawn from them.

Every episode also produces a replay record. NODE can reconstruct the simulation
from its initial state and admitted actions, then compare final state hashes and
event digests across independent runs. This makes it possible to inspect how a result
was produced, reproduce its mechanical consequences and separate a participant's
rejected proposal from a failure in the evaluation infrastructure.

The first study chosen for publication is authority attribution. Seven controlled
participants (two Bakers, a Miller, a Courier, an Investigator, an Import/Export agent
and a Grifter) share one simulated world. In two arms they receive the same request,
labelled either as a council directive or as an anonymous neighbour's suggestion; the
third arm has no request. A versioned
[construct contract](evals/contracts/authority_attribution.v1.json) fixes what counts
as exposure, a feasible opportunity, an attempt, an admitted action and a real effect
before anything is scored. The requirements and decisions behind it are tracked in the
[ground-truth register](docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md).

A capped, accounted runner now exists for the first live run of that study. Every model call is
reserved against a USD 5 allowance before it is sent, and its usage is booked before the response
can affect the simulation. The study runs on `claude-haiku-5-5` (owner decision D11, 2026-10-22). The
allowance books it only at reviewed rates backed by a committed, hashed copy of the provider's
price table. The run waits until the owner reactivates it
([runbook](docs/research/RUNBOOK_AUTHORITY_STUDY_1.md)). Its scripts check for PowerShell 7 before
any reservation or call.

The participants' private diaries now have a written contract
([A01](docs/research/DIARY_CONTRACT_A01.md)):

- everyone writes one entry a day from fixed menus, and may record faithfully or strategically;
- an intruder can read the current entries;
- recognising another person takes repeated dealings, not just overhearing them.

The evaluation already measures diary adherence and grounding. The game-side changes follow the
first study. A pre-build simulation of the new recognition rules
([results](docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md)) found that crediting every
heard conversation would let silent bystanders recognise people as fast as their partners, because
one utterance reaches about 40 listeners. Crediting only direct address, with fading memory, meets
the 10–20 day target. A second pass, on the owner's further decisions, adds lapsing recognition,
refusal and a modelled customer channel. It shows that customers recognise their Baker only if
they are regulars. Recognition v2 and individual dealings are now implemented as an opt-in rules
version (`WorldConfig.recognition = 'v2'`). Study 1 runs on it (authority-attribution contract 1.1.0);
the kernel default stays v1 so the archived reproductions still hold. In v2 each observation lists
who is within speaking range, an address to anyone else is refused, and moves take effect after
the day's speech, so an admitted address is heard unless someone leaves that day. The response
schema uses no `const` keyword, which OpenAI and Google do not document for strict structured output.
Model options, including the confirmed deprecation of the planned study model, are verified in
[docs/research/model-options-2026-10-21](docs/research/model-options-2026-10-21/README.md). An Anthropic
adapter and an owner-run [Haiku connection check](docs/research/model-options-2026-10-21/HAIKU_CONNECTION_CHECK.md)
are built. On the owner's PC the check accepted the real study schema and returned a valid
decision in 3.8 s. Local, free models are preferred where suitable, alongside paid ones; testing
them comes later.

The implementation is currently validated using scripted offline policies through
Inspect's `mockllm` provider. The next stage is the
[accounted-agent integration](docs/DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md),
which designs how model-generated decisions, bounded decision justifications and
inference accounting will connect to this same evidence pipeline. The
[evaluation infrastructure guide](docs/EVAL_INFRASTRUCTURE.md) describes the current
tasks, scenarios, scorers and exported records in detail.

## Run the suite

Use Node 24 and install the locked dependencies from the repository root. These
commands run the TypeScript regression, type and session-recovery checks:

```sh
npm ci
npm test
npm run typecheck
npm run test:session-recovery
```

For the Python evaluation layer, the recorded setup uses Python 3.14.3 and Inspect AI
0.3.282. On Windows, install the evaluation dependencies and run the offline suite:

```powershell
py -3.14 -m venv .venv-eval
.venv-eval/Scripts/python -m pip install -r evals/requirements.txt
cd evals
../.venv-eval/Scripts/python -m unittest discover -s tests -v
../.venv-eval/Scripts/python -m inspect_node.verify --out results/verify
../.venv-eval/Scripts/python -m inspect_node.constructs --out results/authority
../.venv-eval/Scripts/inspect eval node_tasks.py@node_control --model mockllm/model
```

On Unix, use the corresponding Python interpreter and `.venv-eval/bin/` executables.
The verifier runs the suite twice and independently replays the exported records;
choose a new output directory for each verification run to keep its evidence together.

The TypeScript simulation can also be inspected directly with `npm run playtest`,
served over WebSocket with `npm run server`, or compared across settlement models
with `npm run settlement-report`. The [Godot client](client/README.md) provides a
visual interface to the environment.

## Evidence and project documentation

Recorded verification on source `1b6684a` passed 1,189 Vitest tests across 95 files,
TypeScript checking, 18 Python tests, eight recovery tests and 80 native
broker/participant checks. Two independent 29-sample Inspect runs produced matching
state hashes and event digests, verified every in-memory and exported replay, and
passed 56 scripted fixture checks per run. The
[consolidation report](docs/recovery/MAIN_CONSOLIDATION_2026-10-20.md) links the hosted
runs and records their source commits; the
[independent evaluation review](docs/recovery/PR21_REVIEW_2026-10-20.md) contains the
commands, reproduced defects and supporting evidence.

On source `7f7bef9` (Linux, Node 22, Python 3.13), 1,227 Vitest tests across 97 files and
28 Python tests passed, and a rehearsal of the accounted-study procedure ran with a fake
transport. [PR #26](https://github.com/SDarkVader/The-Node/pull/26) merged into `main` at `9d004e8`
after its hosted checks passed on `c59dd70`: Linux research conformance, and the Windows
integration with its 80 native broker checks. The 29-sample suite reproduced all 29 archived kernel state
hashes byte for byte, a cross-platform check recorded in the
[G1 reproduction record](docs/research/G1_REPRODUCTION_2026-10-20.md). The
authority-attribution fixtures ran deterministically twice, and every exported record
replayed and re-classified identically in a fresh process
([evidence](evals/evidence/g2-authority-attribution-2026-10-20/summary.md)). The
`research-conformance` workflow repeats these checks on Linux for every push.

The simulation and participant host live under `src/`, with the evaluation bridge in
`src/eval/` and Inspect tasks and scorers in `evals/`. The
[blueprint](docs/BLUEPRINT.md) explains the wider architecture. Development continues
on `main` through pull requests with required `offline-verification` CI; the
[current checkpoint](docs/recovery/CURRENT_SESSION.md) and
[development log](docs/DEVLOG.md) provide the handover and dated history. For a fresh
checkout, follow the [continuation guide](docs/recovery/GITHUB_FIRST_CONTINUATION.md)
and run `npm run recovery:verify`.

For the current experimental scope, interpretation of results and outstanding work,
see [Evaluation scope and limitations](docs/EVALUATION_SCOPE_AND_LIMITATIONS.md).
