# Reasoning continuation in an evolving Node world

Implemented 2026-10-23 on `codex/stateful-continuation-2026-10-23`, based on reviewed main `c2ac4c3`.
This is a separate experiment path. Frozen Study 1, its current-view memory condition,
four-field action contract, validator, broker, kernel, replay and accounting sources are unchanged.

The owner explicitly permits transcript memory and wants earlier thinking reconsidered as the
world changes and diary entries degrade. Each actor retains only its own received conversation.
Historical exposure remains historical; current recognition, hearing, role, diary and legal moves
govern present actions. Additional transcript memory limits or degradation are future work.

## Existing pieces and the connection added

| Existing component | Continuation use |
| --- | --- |
| `observer.ts` / `responsesObservation` | Actual actor-scoped, side-effect-free view and the existing nested whitelist |
| `participantWorld.ts` | Actual deterministic tick, role duties, settlement, speech-before-movement, diary ageing |
| `mockDecisionSchema` / `validateDecision` | Original move / communication / diary / role object; no exploratory answer schema |
| `ExperimentBudget` | Exact final-body reservation, known-usage booking before execution, unchanged conservative rates and failure holds |
| Anthropic request/response adapters | Existing model, adaptive summarized thinking, medium effort and 2,048 output cap |
| `ReplayTape` | Independent genesis-to-action replay with state/effect hashes |
| New `continuationHost.ts` | Shared-world evaluator host using those actual observer/validator/kernel functions |
| New conversation, runner and ledger modules | Own append-only provider history; complete response bytes and opaque blocks; tick/consequence joins; independent audit |

The host fixes each controlled identity by the existing sorted-person / role-ordinal selection.
It leases views to a tick and world hash; forged, stale or unscheduled submissions are rejected.
All scheduled decisions use the same pre-tick world. One shared kernel step follows only after
all scheduled responses are booked and admitted. Invalid output stops the run, without repair.
Mechanical inhabitants and unscheduled participants retain their existing autonomous mechanics.

The fixed plan order schedules every present actor until the call limit. A final tick with fewer
remaining calls schedules only that prefix of actors, explicitly recorded as `scheduledActors`.
There are no fabricated model decisions for the others. The offline 10/20/50-call configurations
use all seven established actors; their final partial schedules are explicit.

## Provider continuation mechanics

The exact original assistant content array is appended, including thinking text, signatures,
redacted data and final text, in original order. Neither signature hashes nor reconstructed
summaries replace these blocks. System and earlier messages stay fixed. Role changes are
described in the new user turn and its current four-field schema, preserving the signed prefix.

Current Anthropic documentation, checked 2026-10-23:
[thinking](https://platform.claude.com/docs/en/build-with-claude/thinking),
[preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking),
[context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing).
Haiku 5.5 keeps prior thinking by default; blocks are tied to the originating account and prefix.
Offline tests establish exact client preservation; the provider's acceptance and actual model use
remain live-pilot questions. Reported input transformations stop execution after usage booking.

Static geometry is sent once using the existing table presentation. Subsequent authorized views
use lossless patches, with a front-coded path dictionary and explicit set/delete/splice operations.
Hearing references are losslessly encoded as row indexes into that actor's current people table.
The unchanged action schema still uses the actual observer references. Every reconstructed view
is checked against the real observer during independent replay. No evaluator truth is added.

The 32,768-byte request, 36,864-input-token admission and 2,048-output limits remain.
Large live signatures or histories may hit the request bound earlier than scripted fixtures.
That stops before another reservation; nothing is truncated, summarized away or silently reset.
The model's comprehension of the compact presentation is not established by scripted tests.

## Durable evidence and replay

A new private directory contains `trace/continuation.ledger.jsonl`, exclusively created and
flushed after each append. Events are hash-chained and record:

- genesis, source revision, stable actor/person mapping, plan and accounting provenance;
- actor/tick/world hash, exact request, authorized observation and reservation;
- exact provider response bytes (base64), hash, latency, receipt, token usage and booked cost;
- provider summaries separately from absent explicit explanations and unasserted causal inferences;
- original candidate, authoritative validation, tick intent, admitted actions and actual kernel effects;
- actual pre/post observations, next tick, state/effect hashes and complete final histories;
- failures, unused responses, uncompleted ticks, holds and terminal status.

Only actor-authorized views enter model requests. Cross-actor mappings, raw effects and replay
state remain evaluator-only. Received consequences are the next real authorized observation;
the harness supplies no invented explanation of why it changed.

A fresh process reconstructs genesis, each authorized view, every request/history prefix,
receipt and validator result, then re-executes all ticks and checks the evidence. A second
existing `ReplayTape` replay checks the final state. A crash prefix is inspectable but incomplete;
there is no automatic paid retry or paid-run resumption. Retain the original prefix and accounting
hold for operator review. Hashes prove consistency relative to retained roots, not external
attestation or provider cryptographic authenticity.

## Reproduce offline

From repository root, use new private output directories outside the checkout:

```powershell
npm run typecheck
npx vitest run test/eval.continuation.test.ts
node --import tsx test/cli/rehearse-continuation.ts <new-private-dir> <source-commit> 4
node --import tsx test/cli/verify-continuation.ts <ledger-file> <source-commit> <new-inspect-jsonl>
```

Repeat the rehearsal with `10`, `20` or `50` as the last argument. The provider, reasoning text,
signatures, receipts and allowance in this rehearsal are explicitly synthetic. The Node engine
and world transitions are real. Synthetic booked amounts are test valuations, never real costs.

The tests additionally drive actual repeated conversations to earn recognition, write a legal
diary entry, and advance until the kernel expires it. Earlier received diary content and signed
thinking remain historical in the transcript; the current diary becomes empty.

## Inspect AI and interpretation

Verified exports use native Inspect sample JSONL with the evidence in metadata. Failed and
unexecuted calls remain samples, marked with absent transitions and actual stop status.
No behavioural score, causal attribution, motive or quality judgement is manufactured.
The loader uses the existing pinned Inspect version, 0.3.282:

```powershell
cd evals
python -m inspect_node.continuation <inspect-jsonl> --source-revision <commit> --ledger-root <verified-root>
```

This imports evidence without any model call. See
[Inspect datasets](https://inspect.aisi.org.uk/datasets.html). The export supports later analysis
of continuity, adaptation/correction, information exposure, resource-linked authority and
deference by joining own observations, signed evidence, actions and subsequent consequences.
Metrics and real-model decision quality remain unvalidated. SciSpace was consulted for research
context; no paper result was used to redefine the owner's contracts or manufacture a metric.

## Live pilot: separate explicit approval required

Prepared plan: `evals/manifests/reasoning_continuation_pilot.json`: two Bakers, two real ticks,
four maximum calls, Haiku 5.5, medium adaptive summarized thinking, four-second pacing.
Proposed separate allowance: **USD 0.10**, at most **USD 0.02** booked per request, 24-hour window.
It is a proposal, not an activated allowance. Old one-message permission and Study 1 do not fund it.

At the unchanged reviewed 2x list booking rates, the maximum allowed reservation is
9,421 micro-USD per call (36,864 input + 2,048 output). Four such reservations are USD 0.037684,
inside the proposed USD 0.10 allowance. Actual usage and any overrun must still be recorded;
these are conservative admission figures, not an invoice or a guarantee of future provider usage.

After the owner separately approves this concrete pilot, use the already confirmed private
credential infrastructure and a closed existing allowance. Never reset or recreate missing history:

```powershell
node scripts/build-study-runtime.mjs <new-runtime>
node scripts/prepare-continuation-budget.mjs <runtime> <closed-prior> <new-pilot-allowance> evals/manifests/reasoning_continuation_pilot.json <private-owner-approval.txt> --authorize-paid-pilot
node scripts/run-continuation.mjs <runtime> <pilot-allowance> <new-private-artifacts> <approved-env-file> evals/manifests/reasoning_continuation_pilot.json --dispatch-authorized-pilot
node scripts/verify-continuation.mjs <runtime> <private-ledger> <new-inspect-jsonl>
```

Use `--from-experiment` when carrying an existing closed experiment allowance rather than the
initial allowance. Preparation preserves the entire carried document and all holds, and begins
a new explicitly authorized time window. It is not run as routine setup. The live script refuses
a used or differently bound allowance, checks PowerShell 7 before any credential access, archives
each exact request/response/network receipt privately, and never retries. Its optional worker
flag archives non-2xx response bodies too; default Study 1 worker behaviour is unchanged.

No live pilot has been dispatched by this implementation session. No new real allowance has
been initialized, and no existing accounting record has been modified.
