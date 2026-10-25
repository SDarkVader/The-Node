# Environmental continuation: tick 28 to tick 38

The owner's ten-tick request completed **20 paid calls over 10 real world ticks**. All twenty
responses were HTTP 200/end_turn, admitted and executed. Source/runtime:
`47291c82535a542d1760a6563fc818e24480fa2c`. Inference has stopped.

This continues the same world and two identities after the original tick-28 checkpoint, with
an explicitly changed current observation condition. It adds twenty decisions to the earlier
56: 76 paid decisions through tick 38 across the two conditions. It does not rewrite the earlier
pilot as perception evidence. Both identities held Investigator roles at this stage.

## Condition and memory

Current observations came from first-person Godot perception: six-plot clear visibility,
92-degree views in four directions, real occlusion, actual District Weather/tension bands,
current own role/epoch/position and legal moves, plus the mechanics-aware guide. Two separately
launched workers agreed before each paid decision. No current global observer/social/diary
projection was inserted into the model request.

Each actor retained its exact own earlier messages and signed returned blocks. The first new
turn explicitly labelled the switch from the broader old observer to first-person perception;
old information remains historical exposure, not current permission or proof. New packets use
lossless patches. This condition transition is not a controlled perception/memory comparison.
Model `claude-haiku-5-5`, summarized adaptive thinking, medium effort and 2,048 output tokens
were unchanged. See [the implementation contract](../observatory/LIVE_PERCEPTION_CONTINUATION.md).

## Returned reasoning and accounting

Three calls returned nonempty reasoning summaries; seventeen returned no nonempty summary.
The private readable HTML/Markdown and structured JSON contain every new decision in order,
verbatim returned text when present, exact IDs, compact environmental context and actions/outcomes.
Missing text is labelled rather than reconstructed. Private source bytes remain on the owner's PC.

| Recorded measure | Result |
| --- | ---: |
| Paid model calls | 20 |
| Free token-count endpoint calls | 20 |
| Completed world ticks | 10 |
| Admitted / executed decisions | 20 / 20 |
| Input / output tokens, receipt totals | 692,520 / 738 |
| Receipt-based estimated list cost | USD 0.069621 |
| Conservative booked cost | USD 0.139250 |
| Held charges | USD 0 |

The expired earlier allowance and all its recorded charges were carried unchanged into a new
USD 1 plan-bound allowance. The new allowance's twenty-request count is consumed; no further
calls were attempted. Token counts plus schema-byte/overhead margins passed before each paid
dispatch; the unchanged accounting ceiling was 100,000 input tokens. This avoids truncating
the retained history at the old 95 KB body limit, using a separate explicit counted-input profile.
Costs are estimates/bookings, not reconciled provider invoices.

## Verification and continuation

The fresh-process verifier reconstructed request bytes and own histories, reparsed original
responses, checked perception/audits and admission, recomputed usage charges, replayed each new
world step and matched the actual new journal's final hash, booked total and zero holds. The
original parent ledger and expired journal fingerprints were unchanged. The original broker,
kernel, accounting classes, observer, replay and frozen Study 1 sources were not modified.
[Sanitized aggregate evidence](evidence/environmental-tick38-2026-10-24.json).

Execution and verification produced no reasoning-quality score or behavioural interpretation.
Framework/human evaluation remains a separate step with declared metrics and provenance.

The existing observatory still displays the original tick-28 archive. A display/import adapter
for the new `perception_*` ledger and recovery support for continuing from its tick-38 checkpoint
are next development tasks. The current entry point transitions from an original continuation
parent; it must not be reused against tick 28 to pretend to resume this new checkpoint. Preserve
the new stopped ledger, own-history export, tape and matching journal before further work.

Offline verification at runtime source `47291c8`: 1,473 Vitest tests passed across 117 files
with two workers and one existing platform skip; TypeScript, CLI syntax and eight recovery tests
passed. The matching source was published to the development branch on 2026-10-25 after a local-only
publication gap was identified. Check out the exact runtime SHA above to replay the live artifacts.
