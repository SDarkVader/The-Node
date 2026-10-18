# Initial budgeted game turn

This adds an explicitly invoked single-turn experiment to the existing forward test allowance. It does not replace the missing historical implementation or change the protected production live gate. The selected model, five-request ceiling, $0.10 total and $0.02 per request remain unchanged.

`src/agent/initialGameTurn.ts` reserves the final serialized request before dispatch, records returned usage before validation, checks the current authenticated observation, submits the validated actions, advances one tick, and compares complete-state evidence with deterministic replay. A consumed tick cannot be sent again. Failed transport retains its reservation; invalid, stale or late decisions retain their cost. Post-commit evidence failures are reported separately from rejected actions.

`scripts/run-initial-game-turn.mjs` is a first-turn-only executable, not a loop. It requires an existing unused allowance and a new artifact directory. Private genesis, request, response, replay tape and durable game checkpoint remain outside Git. Future turns must resume that checkpoint and the same allowance; generating another identity is not a continuation.

Compile with the locked local TypeScript compiler, including the separate host child:

```powershell
node node_modules/typescript/bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --outDir <runtime> --rootDir src src/agent/initialGameTurn.ts src/agent/isolatedHost.ts src/agent/isolatedHostChild.ts
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

For the next turn, add an explicit resume-mode wrapper around `runInitialGameTurn`, resuming the checkpoint with source revision `c20e3ffcf153cf6c633f5193059eeeda52ad0c1a` and a fresh controller token, then opening the same allowance. Check stable participant ref, expected tick, remaining budget and authorization expiry before dispatch. Retain the request/response/report in a fresh attempt directory. Do not invoke this first-turn-only script again, create a new allowance, recreate genesis or automatically exhaust the four remaining requests. The current grant expires 2026-10-19T13:21:24.584Z.
