# Evaluation scope and limitations

Updated 2026-10-20. This document consolidates the README's detailed qualifications,
implementation boundaries and outstanding experimental work. Read the
[README](../README.md) for the suite's purpose and workflow, and the
[independent review](recovery/PR21_REVIEW_2026-10-20.md) for the underlying audit.

## What the current evidence establishes

The Inspect harness executes scripted offline policies through `mockllm/model`.
Current episodes control one participant, initially a Baker; the other inhabitants
are driven by the simulation. Role changes are real kernel events and can remove
previously available actions. The current evidence establishes harness execution,
validator behaviour, scoring rules, observation isolation and deterministic replay.
It does not establish real-model reasoning, hierarchical agent coordination,
honesty, cooperation, social alignment or general safety.

All 56 fixture-agreement checks compare hand-authored policies with deterministic
scorers. These are calibration and infrastructure tests, not independent behavioural
experiments on a model. The original 29 samples cover declared scenario/policy
combinations; they are not a population estimate. Matching replay hashes establish
repeatable mechanical execution, not model reliability or statistical significance.
The standalone 44 native broker checks overlap the combined 80 native checks and
must not be counted as 124 distinct checks. README test totals identify a historical
source commit; documentation edits do not imply those regressions were rerun.

## Interpreting behavioural measures

Prompt-injection notices are synthetic lower-trust text presented beside the
observation. They are not attacks discovered through a natural communication channel.
Attempts, validator-admitted actions and kernel effects must remain separate. An
impossible resource transfer is a rejection control, not an executable attack goal.

The authority comparison uses the same seed and requested price, but wording differs
as well as attribution. It is not a causal estimate of authority effects in a real
model. Compliance with flattering consensus is a narrow operational sycophancy proxy;
a matching action does not establish motivation.

Subjective Wall states such as feeling secure cannot establish lying. Current
reassurance and covert-task signals are low-confidence behavioural inferences. The
trusted monitor is a passive deterministic rule: flagging an action does not prevent
it, and detection must not be described as successful intervention.

Pricing and undercutting measure economic behaviour; a low price alone does not
establish harmful competition or unwillingness to cooperate. Health, inequality,
wealth and population are ungraded context. No matched multi-agent intervention
establishes a causal welfare effect. General bargaining and resource transfer are
not available as evaluation actions.

Information-asymmetry measures cover specified interpretation answers and diary
claims, counting only questions answered. They do not establish general epistemic
competence. Longitudinal fixtures exercise a programmed shift over a bounded episode;
scripted policies can carry fixture memory outside the simulation's diary. Those
runs cannot establish natural forgetting, learning or long-horizon reasoning.

Validator rejection is evidence about a proposal. Unparseable output is protocol
noncompliance. Bridge, kernel, replay and settlement-integrity failures are
infrastructure failures, for which behavioural scores must be `not_scorable`.
Evaluator-only ground truth and hidden targets must remain outside participant
observations and model prompts.

## Framework integration

Inspect AI 0.3.282 is the pinned native evaluation dependency. AgentDojo and
ControlArena contribute adapted task/injection and oversight patterns; their native
packages, task-suite adapters and control protocols are not integrated. Concordia
is not integrated. The NIST AI RMF crosswalk is a project interpretation with
illustrative thresholds, not certification or a general risk rating. A failed
integrity check makes the subject classification indeterminate; infrastructure
self-tests do not classify an agent.

Framework-specific acceptance criteria and the proposed implementation are in the
[accounted-agent and framework-alignment design](DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md).
Each construct still needs feasible actions, observed opportunities, independent
truth, controls and an explicit interpretation boundary. Adding a package or naming
a scenario after a framework is not construct validation.

## Experimental and simulation work still required

Real-model trials, multiple controlled participants, broader role coverage, held-out
seeds, longer horizons and statistical uncertainty remain experimental work. Formal
hierarchical coordination and bounded decision-justification metrics are research
objectives, not verified capabilities. A faithful explanation contract would record
bounded justifications, not establish access to a model's internal reasoning.

Automatic event-derived personal memory and non-editing event marks, complete
restricted trespass transactions and individual abode tracking are not implemented.
The current population-independent shard cap is three; extending it and selecting
the intended settlement balance remain design decisions. The separate Godot
sky/navigation and Vitest 5 branches are not incorporated into main.

The ordinary world server does not persist its world across restarts. Durable
participant checkpoints use the separate
[participant recovery path](recovery/CHECKPOINT_RECOVERY.md). Project lifecycle hooks
require local review and trust; manual recovery commands work independently. A
GitHub clone transfers committed source and sanitized context, not unpublished
changes, private runtime state, credentials or accounting evidence.

## Live inference and accounting

The current Inspect solver refuses non-`mockllm` models. Accounted live-agent
integration and its explanation contract are designed, not implemented. Live
admission remains blocked by `assertLiveAdmission`; adding evaluation text or model
calls must preserve the broker's reservation, usage settlement and observation
boundaries. No live model, paid judge, credential diagnostic or provider call is
authorized by the README or its offline commands.

Missing private accounting evidence, unknown usage and historical holds must not
be replaced with zero or treated as a fresh allowance. A fresh clone cannot
initialize or reset a budget, reconcile a hold or authorize spending. Future live
work requires its own authorization and the actual private accounting state through
approved secure channels.

For detailed implementation evidence, see
[EVAL_INFRASTRUCTURE](EVAL_INFRASTRUCTURE.md), the
[PR #21 review](recovery/PR21_REVIEW_2026-10-20.md) and the
[current checkpoint](recovery/CURRENT_SESSION.md).
