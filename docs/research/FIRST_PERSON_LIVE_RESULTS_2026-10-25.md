# Fresh first-person live run — 2026-10-25

The owner-approved fresh run completed **20 real ticks and 40 paid Haiku responses** from
runtime `93f4a9966cedd326e709b96bbdcbc9ee8b632026`. Both Bakers returned **7 nonempty native
thinking summaries in 20 decisions**; each had 13 responses without a thinking summary.
All forty responses were actionable and ended with `end_turn`. No redaction, transport
failure, truncation or automatic paid retry was recorded.

This verifies consistent request conditions and observes equal counts in this run. It does
not guarantee thinking emission on every tick or establish that the configuration change
caused the equal counts. The original 28-tick and subsequent ten-tick continuations have
different retained contexts and initial conditions; they are not a controlled comparison.

## Conditions and preserved history

- Fresh world/genesis, seed 103, two Baker identities, first-person Godot perception from
  the PR #40/#41 components. Human rounds 1–20 are canonical source ticks 0–19.
- Zero prior model turns for each actor. Request message counts grow from one to 39 with
  each actor's exact own transcript; independent verification reconstructs every request.
- Common `per_turn_deliberation_v1`, adaptive summarized thinking, explicit `high` effort,
  identical system and per-turn instruction, 2,048 total output tokens, 100,000 input-token
  ceiling and twenty-second deadline. Haiku has no supported fixed `budget_tokens` setting.
- Two independently launched native Godot workers agreed on all forty delivered packets;
  the existing host/kernel alone committed the authoritative transitions.

The actual uploaded latest tick-38 journal passed checksum, full accounting replay and exact
ledger fingerprint binding before activation. Its closed zero-hold history was carried
independently into the new allowance. The original ledger and journal bytes remain unchanged;
no older world or conversation was inherited. The new run's journal, preserved privately,
is now the latest accounting snapshot. Study 1 remains paused and frozen.

## Usage and accounting

| Actor | Paid decisions | Summary turns | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| Baker 0 | 20 | 7 | 243,884 | 1,652 |
| Baker 1 | 20 | 7 | 240,112 | 1,630 |
| Total | 40 | 14 | 483,996 | 3,282 |

Forty free token-count requests preceded the forty paid requests. The owner approved a new
USD 1 allowance with a forty-request/24-hour cap; **USD 0.100100 was conservatively booked,
with zero held**. This is receipt-based journal accounting, not an invoice reconciliation.
The forty-request limit is consumed and the process stopped. No additional experiment runs
or paid verification requests were made.

## Verification and separate evaluation

A new process independently verified all request reconstruction, exact signed own histories,
response parsing, admissions, usage and world replay. The compiled observatory projects the
same final world and matches the latest new journal:

- Final world: `908d61c3514dcef658ef0417ceb76b2d6ae606316865ce786ed41a8d7158cb32`.
- Ledger root: `2f9130c66cecd3357ff4b0d78ee7fcfaef5da4ef7897f9e0a9c9c5f75cc3d1b6`.
- Shared system SHA-256: `d7a942fce69f1b5e8486ad5fe4d6c5565f7ce0f68daed85987668d70fbabe569`.

After execution, **Inspect AI 0.3.282** separately evaluated declared metric
`node.observatory.execution_share`: **40/40 = 1.0**, with zero evaluation model calls.
The denominator is all recorded requests; the numerator is requests joined to a committed
transition. This measures execution integrity, not reasoning quality. **NODE A01
observation-condition applicability** separately reports `not_applicable` for both actors:
first-person input supplies no recognized diary subjects and requires `diary=null`.

The actual completed live evidence was then opened in Chromium desktop/mobile. Verbatim
provider summary display, plan validation/download, historical evaluation visibility and
stale validation protection passed. Both native WorldView and IsoView matched the browser's
selected tick, cursor and world hash. No browser errors or mobile overflow were observed;
viewing left ledger/journal bytes unchanged and made zero provider calls. Live screenshots
remain private. [Sanitized machine-readable evidence](evidence/first-person-live-20-ticks-2026-10-25.json).

## Open the interface

[PC/private-Codespace launch instructions](OBSERVATORY_RUNBOOK.md#open-the-interface-on-your-pc-or-in-a-private-codespace)
work without provider credentials. The synthetic demo is available from PR #39's branch.
The owner's private portable viewing bundle contains exact copies of this completed run's
ledger, new journal, evaluation outputs and relative registration, with no API credential
or interface access token. Keep it outside the checkout and point `npm run observatory --`
at its `registration.json`. This displays the actual recorded world and reasoning without
starting another run. The PR itself does not host a public interface.
