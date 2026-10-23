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

## Pilot budget and original approval gate

Prepared plan: `evals/manifests/reasoning_continuation_pilot.json`: two Bakers, two real ticks,
four maximum calls, Haiku 5.5, medium adaptive summarized thinking, four-second pacing.
Proposed separate allowance: **USD 0.10**, at most **USD 0.02** booked per request, 24-hour window.
At preparation it was a proposal, not an activated allowance. The subsequent approval and completed execution are recorded below. Old one-message permission and Study 1 did not fund it.

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

At completion of the offline implementation stage, no pilot had been dispatched or real allowance initialized. The subsequent approved live execution is recorded below; existing accounting history was preserved.

## Verified offline evidence, 2026-10-23

Committed runtime/source: `cf9947630d4164950b93d03b0b6b6b8c8dc99881` (implementation `7ab821a`, followed by whitespace and private-directory hardening). Sanitized [evidence manifest](evidence/reasoning-continuation-2026-10-23.json) records every transition hash, final state, history hash, ledger root and Inspect export hash. Private raw ledgers remain outside GitHub.

| Simulated provider calls | Actors | Actual kernel ticks | Fresh-process replay | Inspect samples loaded |
| --- | --- | --- | --- | --- |
| 4 | 2 Bakers | 2 | passed | 4 |
| 10 | all 7 | 2 | passed | 10 |
| 20 | all 7 | 3 | passed | 20 |
| 50 | all 7 | 8 | passed | 50 |

In the two-tick proof, both admitted prices change to 0.5, then 0.55 from the synthetic provider's continued history. Actual Baker 0 wealth is `0 -> 0.9250024116963622 -> 1.1964764561922565`; Baker 1 wealth is `0 -> 0.4092931025205143 -> 0.96275838707467`. Four kernel `bakerPrice` effects were recorded. Final state hash: `4014058147545968f10e75b151734504c5726c0e89ca8738e1aa732a335f1a17`.

Final implementation regression: **1,341 Vitest tests passed across 106 files; one existing Windows skip**, including 24 continuation tests. TypeScript, eight recovery checks and 29 Python evaluation tests passed. An added boundary regression first failed in its empty-directory cleanup; that cleanup was corrected and the complete suite rerun successfully. Real Inspect **0.3.282** loaded all four verified exports without model calls. The live entry and allowance-preparation scripts refuse without their explicit pilot flags.

At the end of the offline implementation stage: **0** paid requests and **no live receipts**; no real allowance had been created. The subsequent approved pilot is recorded below. Study 1 remains paused and the original October 18 accounting journal hash remains unchanged. Additional transcript degradation/limits and scientific behaviour metrics remain future work; live signed-continuation acceptance and model interpretation require the separately approved pilot.

## Live pilot completed

On 2026-10-23 the owner explicitly approved the separate four-call/two-agent/two-tick USD 0.10 pilot. Runtime cf99476 completed exactly four real Haiku 5.5 messages and two actual shared-world ticks. All responses were HTTP 200/end_turn and passed the original action validator. Both continuation requests preserved the exact original signed assistant blocks and unchanged system/user prefixes; provider continuations were accepted. A fresh Node process independently replayed all evidence, and pinned Inspect 0.3.282 imported four live samples without another model call.

Aggregate usage: 46,706 input / 984 output tokens, including 812 reported thinking tokens within output. Receipt-based estimated list cost is **USD 0.0051626** at the [current standard/global prices](https://platform.claude.com/docs/en/about-claude/pricing) checked 2026-10-23; conservative 2x accounting booked **USD 0.010327** after per-component rounding. **Zero held.** No invoice reconciliation is claimed. The new allowance has reached its four-call limit; unused cost capacity does not authorize further calls.

The original Oct 18 journal hash is unchanged; its complete history was carried from a verified exact private copy. No broker, kernel, contract, manifest or pricing source changed. Hosted CI on implementation bc00e6e passed. [Sanitized live evidence](evidence/reasoning-continuation-live-pilot-2026-10-23.json) records counts and hash anchors; raw requests/responses, signatures, game states, decisions, provider receipt IDs and accounting remain private.

This establishes a working live continuation loop and independently verified world evolution. It does not establish a causal benefit of reasoning memory or validated decision-quality/adaptation scores. Live diary expiry was not tested by this two-tick pilot; real diary expiry with preserved earlier exposure is covered offline. New transcript limits/degradation and a controlled longer-run design remain next topics. Do not repeat this completed pilot, reinitialize its allowance or activate frozen Study 1 as routine setup.
