# Small real-agent postcard tests — 2026-10-26

This opt-in contract connects postcard accrual, claims, safe and shortcut fusion to the existing society's actual agent runner. Two initially controlled Bakers and one Miller receive the new legal choices alongside ordinary work, bread purchases, movement, communication, diary and Oracle choices. Other inhabitants use the same validation through deterministic policies. This is a fresh society test, not continuation of a previous agent's signed conversation or world.

The optional contract preserves the original society-v1 mode when postcards are absent. Its four-day world hash and complete tape digest match independently archived source `b8d42f4`. Card clocks, holdings and choices now persist in a separate versioned society tape, and the paid plan explicitly names the postcard contract.

## Run from PowerShell

Use Node 24 or newer and the checkout containing these committed scripts. Keep the terminal open while a run is active. Work does not need to remain open.

```powershell
Set-Location 'C:\Users\steve\Documents\Github\The-Node'
powershell -NoProfile -File scripts/start-society-playtest.ps1 -PostcardRate 2/1 -Ticks 3
```

PowerShell asks for three required values: `PriorJournal` (the actual latest completed run's `accounting.journal.json`), `CredentialFile` (the existing private key or one-line `ANTHROPIC_API_KEY=...` file), and `OutputRoot` (a new private folder whose parent already exists, outside the repository). You can supply these as named arguments instead. Do not choose an older journal because it is easier to locate.

Preparation writes `plan.json`, an exact prior-history copy and `review.json` with `approved:false`. It prints the pinned source, explicit postcard rate/clock, maximum calls and spending bound. It reads credential metadata only, creates no allowance and makes no provider call.

To check the review again:

```powershell
powershell -NoProfile -File scripts/start-society-playtest.ps1 -Review '<new-private-folder>\review.json' -CheckOnly
```

To start that exact real-agent test, use the exact command printed by preparation:

```powershell
powershell -NoProfile -File scripts/start-society-playtest.ps1 -Review '<new-private-folder>\review.json' -ApprovePaidRun
```

The explicit start command delegates to the established accounted launcher. It carries the complete pinned history into a fresh capped authorization, copies only the one needed credential temporarily, calls the fixed provider worker and removes its temporary key copy afterwards. The original journal and credential remain in place. Three days permit at most 18 calls (two phases × three controlled inhabitants × three days), USD 1 total and USD 0.02 per request. Churn may reduce actual calls. `-Ticks` accepts 1–20; its reviewed plan always states the actual bound.

Any source, configuration, original-journal or copied-history drift refuses startup. A started execution directory cannot be reused. Ctrl+C stops the run and preserves partial evidence; no automatic retry occurs. Known response usage is booked even when its action is illegal. Unknown liability remains held. The established carry gate requires a count-closed prior authorization with no holds or overrun; an early-stopped run does not silently qualify as a new empty budget.

For another test, select a new output folder and the latest resulting journal. Preparing a new plan after source changes is necessary: an earlier source pin is deliberately invalidated. Do not edit a recorded plan, journal hash or spending grant to force it through.

## What agents can observe and do

The public game clock explicitly advances 24 hours before each day's act phase. This is virtual simulation time; one tick remains one day. At the illustrative rate `2/1` White/hour, an unclaimed daily interval fills the 16-hour buffer with 32 White and loses the remaining 16. Claims are voluntary. Held cards never expire, and claims retain fractional credit. This test rate is explicit configuration, not a production calibration.

Each person sees only their own tier balances, pending credit, last claim, public rate/cap and currently legal recipes. Stable person identity retains the account across role changes. Distinct arrivals start accruing at their arrival time. There is no individual abode model in current source, so claiming is a personal act-phase choice without an invented workplace-as-home restriction.

Enabled decisions have exactly seven fields. The added field is:

```json
"postcards": {"claim": true, "fusion": {"tier": "white", "stake": 5}}
```

`null` declines both; `fusion:null` only claims; `claim:false` can fuse already-held cards. A claim may fund a White fusion in that same action. One fusion per daily act is optional. White uses five; Green, Blue and Purple may stake 1–5 with exact `stake/5` success. The entire stake is consumed on either outcome; five is guaranteed and consumes no RNG. Orange is final. Other choices remain independent. Commit-phase postcards must be null.

No seed, RNG cursor, canonical identity, origin snapshot, operator ledger, source revision, accounting history, request metadata or host operation enters the inhabitant request. The branded builder, serialized egress checker, provider worker, local validator and controller agree on the same seven-field contract. An unauthorized action halts the simulation rather than substituting a fallback action.

## Raw results

Results are under `<new-private-folder>\execution\`:

- `run\calls\00000\request.json` and `response.json`: exact request and returned bytes per call.
- `run\events.jsonl`, `society.json`, `summary.json` and `finalization.json`: chronology, world/account transitions, partial replay and failures.
- `raw-dump\controlled-0.jsonl`, `controlled-1.jsonl`, `controlled-2.jsonl`: separate chronological records for the initial controlled identities, including exact context, legal choices, proposed/accepted action, provider-returned reasoning summary when present and resulting transition.
- `allowance\accounting.journal.json`: new current accounting with all carried history preserved.

Raw exports are operator records and may include private world data; they are never fed back as inhabitant observations. The provider returns its available summarized reasoning, not a guaranteed summary every turn. The exporter records omissions and failures without interpretation.

## Verification and remaining implementation

At implementation source `0561d56c3f6fe6a5e3be62b99e4abe3147dd9515`, **1,866 tests across 145 files pass**, zero fail and seven environment checks skip (six real Godot worker checks require configuration; one POSIX fake-PowerShell check skips Windows). Project/CLI TypeScript and eight recovery tests pass. The 87 new tests include 51 boundary/request/worker/accounted/launcher/runtime tests and 36 pure configured-Oracle tests.

The actual Windows PowerShell 5.1 production prepare/check flow passed on this committed source using only synthetic history and an intentionally invalid credential placeholder. It produced an unapproved three-day/18-call review, created no execution or allowance and made no call. The invalid placeholder remained unread by preparation, and both it and the synthetic original journal stayed unchanged.

Two independent 20-day runs at seed `20261026` produce identical tape SHA-256 `0626bace63a8a840bd4e663737df2a12d32150d2e6a6522056676e26699ea666`; a new CLI process verifies all 332 decisions, including 120 controlled fixture decisions and 212 autonomous choices. These record 272 claims, 241 safe fusions, 31 shortcuts, three shortcut successes and 28 losses. Every retained account reconciles exactly; maximum existing currency residual is `4.09e-14`. This is synthetic mechanical evidence, not measured model behaviour.

The production request/worker/accounted/raw-export path passes three days/18 synthetic responses. An illegal Orange-fusion response at call index 9 books known usage, stops after ten calls at tick 1, retains the raw response and verifies the partial tape. The 30-day churn test retains stable-person accounts and starts distinct arrivals at their actual virtual arrival time. Both prior saved postcard proofs still verify unchanged. [Exact aggregate evidence](evidence/postcard-agent-playtest-2026-10-26.json) · [PR #48](https://github.com/SDarkVader/The-Node/pull/48).

This test includes postcard choices and the existing paid Oracle/temporary vouchers. The new `oracleDaily.ts` core has zero-cost universal entry, source-backed win odds, configured nonlinear reward quality and a fully backed integer ledger, with 36 passing pure tests. It has no default catalogue or payout calibration and is not enabled in the playtest. Universal Oracle integration, ticket forging/migration, signed reputation, monuments and universal wealth-cap integration remain further work; this document does not claim those features are active.
