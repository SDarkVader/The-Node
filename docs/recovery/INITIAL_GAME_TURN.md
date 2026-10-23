> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Initial budgeted game turn

> Rules-review correction: both archived live schemas forced `diary` to null because recognition was empty. The model did not choose to omit an available marking action. The older composed-entry adapter also does not implement the user's automatic mechanical memory/non-editing event-mark contract. The two turns establish execution and replay, not full game compliance. See [complete rules review](RULES_REVIEW_2026-10-18.md).

This adds an explicitly invoked single-turn experiment to the existing forward test allowance. It does not replace the missing historical implementation or change the protected production live gate. The selected model, five-request ceiling, $0.10 total and $0.02 per request remain unchanged.

`src/agent/initialGameTurn.ts` reserves the final serialized request before dispatch, records returned usage before validation, checks the current authenticated observation, submits the validated actions, advances one tick, and compares complete-state evidence with deterministic replay. A consumed tick cannot be sent again. Failed transport retains its reservation; invalid, stale or late decisions retain their cost. Post-commit evidence failures are reported separately from rejected actions.

`scripts/run-initial-game-turn.mjs` is a single-turn executable, not a loop. Initial mode requires an existing unused allowance and a new artifact directory. Resume mode requires the latest successful turn's directory and the same allowance. Private genesis, request, response, replay tape and durable game checkpoint remain outside Git. Generating another identity is not a continuation.

Compile with the locked local TypeScript compiler, including the separate host child:

```powershell
node node_modules/typescript/bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --outDir <runtime> --rootDir src src/agent/initialGameTurn.ts src/agent/initialGameResume.ts src/agent/isolatedHost.ts src/agent/isolatedHostChild.ts
```

Place a `package.json` with `{"type":"module"}` in that emitted runtime. Invoke once with explicit absolute paths:

```powershell
node scripts/run-initial-game-turn.mjs <runtime> <existing-budget-directory> <new-private-artifact-directory> <approved-env-file> <implementation-commit-sha>
```

The trusted PowerShell worker reads the already approved credential file. The credential never enters Node's environment, child game environment, command arguments or saved report. HTTPS uses the system's normal trusted route, redirects disabled, 16 KiB response headers, 256 KiB response body and a 12-second deadline with no retries. This private diagnostic transport does not verify the separate production CONNECT transport. Same-user filesystem access is not an isolation boundary; NTFS ACL hardening is not claimed.

Acceptance checks cover durable reservation before dispatch, receipt before gameplay admission, real Baker price effects and complete replay, invalid/stale decisions charged without action, pre-cancellation, failed transport retaining the hold, incomplete replies, model mismatch, late responses and honest post-commit replay failure reporting. Existing budget, parser, host, accounting and request/transport tests also apply. The four validated core files remain byte-identical.

Runtime reports record actual outcomes and estimated token costs separately from conservative allowance booking. No invoice reconciliation, historical spending reset, autonomous agent loop, model substitution or production rollout is included.

## Verified first turn, 2026-10-18

Implementation commit: `c20e3ffcf153cf6c633f5193059eeeda52ad0c1a`. One request, HTTP 200, selected `gpt-5.4-nano-2026-03-17`, low reasoning. Usage: 12,935 input and 140 output tokens; estimated standard cost $0.002762. The allowance conservatively books 5,524 microUSD ($0.005524), leaving 94,476 microUSD ($0.094476), no outstanding hold, and four requests remaining. This is a token-price estimate, not an invoice.

The existing Baker moved from (-1, -3) to (0, -3) and changed price from 0.6725960365030914 to 0.70. Both effects were admitted in the tick-0 decision batch and committed at tick 1. Wealth after the normal tick was 0.2781655308372743; this single tick is not evidence of long-run policy quality.

Host, immediate replay, independently reloaded saved tape, and restarted durable checkpoint all agreed on complete-state SHA256:

`cf8b085e676f8b6938ad051fe966ad3cbf8aeaf38b0fe10d3bb400628f62a434`

The allowance reopened with exactly one new request and the same booked amount. The resumed host retained the same participant reference at tick 1. These restart checks made no further API requests. The historical journal retained SHA256 `fc91bd96dc2b34ba43aa063bfc5a9eabb2aff48ce7ca92d4c1fedaa77ac808df`. All four protected core files retained their recorded fingerprints.

Validation: 189 focused tests across 10 files, repository TypeScript compilation, emitted runtime compilation, Node CLI syntax and PowerShell syntax checks passed. The full repository suite was not rerun for this addition.

Private local evidence is in the workspace's sibling output directories:

- `outputs/initial-game-run-2026-10-18/report.json` and `restart-verification.json`.
- That directory's `genesis.json`, `replay-tape.json`, `request.json`, `response.json` and `checkpoint/` preserve continuation evidence. Genesis/checkpoints contain private observer material; do not publish them.
- `outputs/initial-test-budget-2026-10-18/accounting.journal.json` preserves the existing allowance and consumed request.
- The previously approved credential file remains `outputs/broker-accounting-rebuild/.env.local`, outside this branch.

## Explicit continuation

Resume mode now copies the last clean checkpoint into a fresh attempt directory and resumes with a fresh controller token. It verifies the saved tape by replay, compares genesis evidence, matches the prior successful report to the journal's latest request and usage receipt, and checks the participant reference, next tick and complete-state hash. These checks precede any new reservation, credential read or API call. A stale prior directory cannot branch the experiment after the allowance has advanced. The source revision embedded in genesis remains `c20e3ffcf153cf6c633f5193059eeeda52ad0c1a`; the report separately records the committed runner revision.

```powershell
node scripts/run-initial-game-turn.mjs <runtime> <same-budget-directory> <new-attempt-directory> <approved-env-file> <runner-commit-sha> --resume <latest-successful-turn-directory>
```

Offline continuation tests exercise a real durable game and allowance restart, two distinct receipts retained, replay of two committed ticks, and rejection of stale reports, wrong participant, wrong tick and mismatched complete-state evidence. Together with existing allowance and isolated-host checks, 39 tests pass; repository TypeScript, emitted-runtime compilation and CLI syntax pass. No production transport or validated core files are changed.

Resume is always explicit and single-shot. Do not create a new allowance, recreate genesis or automatically exhaust remaining requests. Preserve every prior attempt directory. The current grant expires 2026-10-19T13:21:24.584Z.

## Verified continuation to tick 2, 2026-10-18

Runner implementation commit: `3314caaac73b702fa2575b200189e71c409131db`. The original genesis source revision remains pinned. A single explicitly authorized continuation request returned HTTP 200 using the same selected model and low reasoning. Usage was 12,884 input and 296 output tokens; estimated standard cost $0.0029468. No additional provider diagnostics, retries or model calls ran during verification.

The resumed Baker moved from (0, -3) back to (-1, -3). It submitted no price, communication or diary action. The normal kernel tick increased wealth from 0.2781655308372743 to 0.8882031136885489 and changed the Baker price from 0.70 to 0.5903047581967446. This price change was not a model price action: `src/world/world.ts` runs the competitive Baker reaction first, and `src/agent/participantWorld.ts` only overrides that result when an explicit role action is present. A null role action delegates to the normal mechanical reaction; it does not hold the prior price fixed.

The return move is an observed two-turn reversal, not proof of a policy defect or useful long-run strategy. The current request has only the authorized game observation, with no immortal conversation history. Diagnose behaviour with the participant's available view and legitimate memory before changing prompts, observation privileges, price semantics or model selection. No such experimental changes were made here.

Complete-state SHA256 agreed across the resumed host, two-tick replay, independently reloaded tape, and a second clean checkpoint restart:

`b5ba959c03e2e2295f1646adb96e1d39d937014a1b146c81ccb36361fa862c28`

The reopened allowance retains both request receipts and books 11,418 microUSD conservatively, with no outstanding hold. Remaining allowance is 88,582 microUSD ($0.088582) and three requests. The two-turn standard-cost estimate totals $0.0057088; conservative booking is intentionally higher. Prior diagnostic history remains separately carried in the same journal.

Private second-turn evidence is `outputs/initial-game-turn-2-2026-10-18/`, including the new checkpoint and `restart-verification.json`. This is now the latest successful directory for any future continuation. The first-turn directory and its checkpoint were preserved unchanged. A deliberate stale resume from that first directory failed with `resume_report_not_latest_accounted_turn`, zero dispatches, no credential access, and no allowance change; evidence is in `outputs/stale-resume-check-2026-10-18/report.json`. That expected rejection exits with status 1.

The historical journal and all four validated core files remain unchanged. The continuation suite passed 39 tests, including durable two-turn continuation and failed evidence checks. No full-suite rerun is claimed.
