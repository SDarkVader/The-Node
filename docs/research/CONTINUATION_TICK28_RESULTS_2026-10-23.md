# Continuation through tick 28 — 2026-10-23

The owner requested 20 more calls and a record of results, permitting comments on interesting
behaviour while explicitly excluding verified interpretation by the operator.

## Recorded execution and verification

Exactly **20 additional calls and decisions** completed, advancing the original world from
**tick 18 to tick 28**. There are now **56 decisions** across the initial pilot and extensions.
All 20 responses were HTTP 200/end_turn, admitted and executed; no retry or repair occurred.
The unchanged Haiku 5.5 configuration, same two identities, original genesis, exact signed own
histories and existing unexpired USD 1 extension allowance were used. World mechanics changed
both actors' roles during the run; the operator did not replace or reassign them.

Runtime source: d237effcc129c7757e382a3af8ecc0e95307ebc4. Orchestration source: f946c725ac2ddd078f3b7f707314711085eb0fa4.
No broker, kernel, replay, pricing, prompt or action-schema implementation was changed.

- Fresh-process replay and the latest journal checksum/history binding passed. The final
  checkpoint is sealed and resumable, with zero outstanding holds.
- Inspect 0.3.282 imported all 20 new verified records with zero additional model calls.
- Observatory acceptance passed over five segments, 56 decisions and 29 frames, including
  parent deduplication, grant totals, HTTP scopes, web/Godot protocol synchronization and SSE.
- Prior accounting events and carried history remain intact. The other 197 files in the
  original private inventory are byte-for-byte unchanged. Only the current grant journal
  advanced by the new reservations and usage receipts.

Raw responses, returned summaries, requests, signatures, observations, actions and journals
remain on the owner's PC. [Sanitized evidence](evidence/reasoning-continuation-tick28-2026-10-23.json)
contains aggregates and hash anchors. The earlier [tick-18 report](CONTINUATION_PILOT_RESULTS_2026-10-23.md)
remains evidence of that earlier checkpoint.

## Recorded usage and costs

| Scope | Estimated standard/global list USD | Conservative booked USD |
| --- | ---: | ---: |
| These 20 calls | 0.0558532 | 0.111716 |
| Entire continuation including initial pilot | 0.1223653 | 0.244754 |

These calls returned 550,492 input and 1,608 output tokens. Estimates use the
[Anthropic pricing page](https://platform.claude.com/docs/en/about-claude/pricing), checked
2026-10-23: Haiku 5.5 prompts up to 100,000 tokens cost USD 0.10/million input and
USD 0.50/million output. The existing ledger retains its reviewed conservative rates and
rounding. The USD 1 extension grant has USD 0.765573 remaining, with zero held. These are
usage-based estimates/bookings; no provider-invoice reconciliation was performed.

## Observations for later review — not reasoning-quality findings

Execution facts: the authorized observations recorded two role changes. Later submissions
included 12 decisions with all four fields null. There were 4 diary submissions and
three responses with nonempty returned thinking summaries. Absent summaries do not establish
an absence of model reasoning. These counts describe recorded output, not its quality.

Operator comments, unverified as interpretations:

- Repeated diary submissions are worth reviewing alongside entry expiry and retained history.
  Their coexistence does not identify whether transcript memory caused the choices.
- One returned summary revised its stated position while discussing observation patches. This
  is a useful example for a separately specified patch-comprehension check; no such score was
  produced here.
- The period of null submissions after role changes is worth examining against the exact
  available actions and rules. It has not been classified as good or poor decision making.

No behavioural evaluator, quality grader or causal-memory comparison ran. Interpretation
belongs to a separately declared framework/metric or human review.

## Resume

Inference is stopped at tick 28. The PC observatory was reopened against the new private
registration. Further calls need a new owner instruction and the actual latest tick-28 parent
with its matching advanced journal. The tick-18 parent now predates that journal and must not
be reused for dispatch. Do not reset or recreate an allowance. Local ignored continuity notes
contain the private paths; the [observatory runbook](../observatory/README.md) describes the
portable acceptance commands.
