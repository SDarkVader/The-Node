# Live continuation pilot results — 2026-10-23

This sanitized report is stored in `SDarkVader/The-Node`, on branch
`codex/stateful-continuation-2026-10-23`, alongside the implementation in
[PR #38](https://github.com/SDarkVader/The-Node/pull/38). The PR is still open;
these files have not been merged into `main`.

The same two participants, world state and exact signed conversation histories continued
from the initial pilot. The extension stopped at the recorded exploratory tick-18 checkpoint.
Its stored stopping label is an operator record, not a framework score or a human evaluation
of reasoning quality. No background experiment is running.

| Result | Extension | Including initial pilot |
| --- | ---: | ---: |
| Paid decisions | 32 | 36 |
| Real world ticks | 16 additional | 18 total |
| Input tokens | 596,250 | 642,956 |
| Output tokens | 3,449 | 4,433 |
| Estimated standard/global list cost | USD 0.0613495 | USD 0.0665121 |
| Conservative accounting | USD 0.122711 | USD 0.133038 |
| Outstanding holds | USD 0 | USD 0 |

The extension used a USD 1 allowance. Conservative accounting uses the existing twice-list
booking rates and per-component rounding; it is distinct from estimated API cost. Thinking
tokens are included in output tokens. No invoice reconciliation is claimed.

## Observations and further questions

Diary behavior changed after legitimate recognition developed through repeated dealings.
Provider-returned summaries mention repeated dealings in connection with recognition. This
reports their content; it does not grade the reasoning or establish self-correction. An actual
current diary entry expired while its earlier authorized exposure and exact prior signed
assistant blocks remained in the conversation. Price policy stayed stable.

The records contain verified world/history continuity and live diary expiry alongside retained
transcript memory. No reasoning-quality evaluation or causal memory score was produced. There
was no matched no-history control, and early stopping
was exploratory. Returned thinking summaries provide partial evidence rather than a
complete account of the model's internal reasoning.

## Evaluation ownership and separation

The run operator records requests, returned reasoning, decisions, receipts, validation and kernel
outcomes. It may comment on what returned reasoning says, clearly attributed as a comment; it
must not simultaneously improvise an evaluation or grade that reasoning or decision quality.

Interpretation belongs to a named evaluation framework/scorer or a human reviewer. If an assistant
runs an evaluation itself, identify the specific metric, definition, evidence inputs and result;
keep that evaluation separate from execution and from freeform reasoning comments. Do not turn
a comment, an exploratory stopping label, schema acceptance or a replay check into a quality score.

Inspect imported the continuation records; no reasoning-quality score or causal memory evaluation
was produced for this pilot. The original offline scorers have explicit rules for their own
fixtures; their scores must not be presented as grades of this live continuation run.

## Verification and provenance

All 32 extension responses were HTTP 200/end_turn, passed the existing validator and were
executed over the recorded ticks. There were no paid retries, repairs, forced events or
history resets. Each of the three checkpoint segments replayed independently in a fresh
Node process. Inspect 0.3.282 imported all 32 new samples without additional model calls.

Runner source: `d237effcc129c7757e382a3af8ecc0e95307ebc4`.
Original world genesis source: `cf9947630d4164950b93d03b0b6b6b8c8dc99881`.
At the runner source, TypeScript, 1,346 Vitest tests (one existing Windows skip), eight
session-recovery checks, and hosted Windows/Linux checks passed. The original accounting
journals, protected broker, deterministic kernel, replay, frozen Study 1 and price entries
were preserved.

Final ledger root:
`3dd3472de909ec244536e508e98216accb4cde961c12ce38fd9971a2fc67b341`.

- [Sanitized extension evidence and stage hash anchors](evidence/reasoning-continuation-live-extension-2026-10-23.json)
- [Initial pilot evidence](evidence/reasoning-continuation-live-pilot-2026-10-23.json)
- [Implementation, runbook and interpretation](REASONING_CONTINUATION_2026-10-23.md)
- [Current recovery handover](../recovery/CURRENT_SESSION.md)

This report and the linked sanitized evidence can be read directly from GitHub. Credentials,
raw provider responses, signatures, private observations, game states and accounting journals
remain outside the repository.
