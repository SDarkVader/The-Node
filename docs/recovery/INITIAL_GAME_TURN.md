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
