> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Synthetic cumulative accounting and mocked dispatch

> Subsequent stage: [the broker and account-specific recovery ledger](BROKER_ACCOUNTING_REBUILD.md) supersedes the synthetic-only stopping point. This file remains the historical fixture-mechanics record. The newer journal carries actual documentary liabilities without executing an operator settlement or enabling live transport.

17 October 2026. Continues audited rebuild `0b51994620def4a1d35568c81e3bf9364e234f8b` in a fresh checkout on `broker-synthetic-accounting-2026-10-17`. This implements accounting mechanics for synthetic fixtures only. It does not initialize or replace the original account ledger, settle the historical hold, import original records or enable live admission.

## Implementation

`src/agent/syntheticBudget.ts` provides `SyntheticBudgetLedger`. Its document format is explicitly `node-synthetic-spend-fixture-v1`, with `scope:'synthetic-only'` and a `fixture-...` identity. Files are named `synthetic-budget.json` and `.synthetic-budget.*`, distinct from game checkpoints and any original account record. Creation requires a new directory; opening never initializes missing state. There is no real-account/import/reconciliation/reset/limit-widening method.

The authoritative document stores immutable limits and an ordered journal of reservations, known settlements and uncertain outcomes. Replaying those events derives request count, confirmed synthetic cost, held reserve, remaining capacity and halt state. It does not trust separately stored mutable totals. Money inputs are safe integer microUSD; totals and comparisons use BigInt, including a true known overrun beyond safe aggregate Number precision.

- Reserve the entire conservative ceiling and consume one request before mock dispatch.
- Allow only one unresolved reservation per fixture store, including across adapters, people and restarts.
- Never refund the consumed request count. A known zero-cost fixture settlement still retains its count; unknown usage remains null and retains its full hold.
- Repeating an identical operation is idempotent. Conflicting reservation/settlement changes fail; duplicate reservations never authorize another dispatch.
- Record a known cost above reserve honestly and persist a permanent halt. Remaining capacity may become negative; no clamping or hidden charge forgiveness.
- Fail on corrupt/missing initialized state, wrong fixture identity, non-synthetic scope, impossible event sequences or unsafe file/link paths. Never fall back to a temporary file or start at zero.

Writes use an exclusive writer lock, checksummed bounded JSON, exclusive temporary file, file fsync and same-directory rename. Unexpected byte changes under a lock stop and poison that writer. A failed write publishes no success; reopening uses only the authoritative record. Interrupted temporary files are quarantined as orphans. Files are capped at 4 MiB and journals at 30,000 events.

Dead-writer recovery is explicit and checks the recorded PID. An exclusive recovery guard serializes stale-lock inspection/removal, preventing two recovering processes from unlinking a newly acquired writer lock. Existing/leftover recovery guards are not silently reclaimed when recovering a writer; they require fixture forensics. Ownership is checked before removing either lock. An interrupted acquisition/recovery never implies a financial refund.

## Mock dispatch integration

`src/agent/budgetedMock.ts` wraps the existing in-memory mock transport and unchanged broker/host interfaces:

1. Validate and detach the bounded mock request; reject pre-aborted work before admission.
2. Derive a deterministic request ID from fixture identity, observer self reference and tick.
3. Compute the conservative ceiling with explicitly invented fixture prices and persist its reservation.
4. Invoke only the supplied trusted in-memory mock factory through the bounded mock reader/validator.
5. Retain the full reservation on failure, cancellation, malformed completion or unknown usage. No automatic retry or zero settlement.
6. Persist known synthetic usage cost before returning success. The price profile is cloned/pinned; each input/output category rounds upward with integer arithmetic.
7. Leave those settled costs intact even if the host later rejects a stale decision or its game checkpoint completion fails.

The only accepted price tag/model is `synthetic-price-fixture` / `offline-fixture`. These numbers are invented test values, not current model prices, invoice evidence or verified provider usage. The mock envelope is not an OpenAI Responses implementation. The trusted callback is not a sandbox or credential-isolated child process; do not substitute a live HTTP callback.

## Validation

The two new focused suites contain **50 passing tests**: 31 journal/storage tests and 19 pricing/mock/host integration tests. They cover restart continuity, immutable/idempotent settlement, unrefunded request counts, uncertain holds, limits, integer precision, storage failures, checksum/semantic corruption, competing writers, recovery guards, hard links/junctions, and six process-crash write windows. A seventh mechanical crash establishes a dead writer for the recovery-guard test. No child runs an agent, model or provider.

Real host tests verify two own-price effects and complete-state replay, known cost retained after a stale result, cumulative costs after both game/budget stores reopen, and no refund when game completion persistence fails. Test directories, sockets and child processes are cleaned up.

Repository TypeScript and **926/926 Vitest tests across 79 files** pass. The full suite passed with both one worker and the standard two-worker configuration. The existing native broker/participant parity runner passed **80/80** checks. Total distinct checks: **1,006**; the 50 focused tests are included in the 926, not additional to it. The four audited broker-core/test fingerprints are unchanged.

The first standard full run exited with Windows Node access violation `0xC0000005` (signed exit `-1073741819`) after reporting existing socket/world tests, without a test assertion failure. A later two-worker execution lost its tool/session handle and left an incomplete 54-file log; no completed result is claimed for it. The single-worker full run passed, followed by a confirmed standard two-worker full run with a durably recorded exit status **0**. The native crash cause was not established; neither rerun is proof it cannot recur. No assertions were weakened or tests excluded. Original failure, incomplete run and successful run logs are retained in the portable verification pack.

Hosted CI was not queried or claimed to pass. Destination platforms must rerun checks; a passing Windows process-crash fixture is not a power-loss guarantee.

## Deliberate boundaries

This is a test-only cumulative accounting component, not recovered production accounting. Each fixture store is intentionally independent. Creating/copying another synthetic store does not grant actual paid allowance. It does not prevent malicious same-user edits/rollback, copied-store forks or concurrent spending across machines. It has no approved account identity, global account root, authenticated price proof, trusted provider receipt, secure credential process, real ledger importer or operator reconciliation path. Those remain reviewed future work.

POSIX private modes/ownership are checked. Node cannot fsync directories on Windows and mode bits do not enforce private NTFS ACLs; physical power-loss durability and real private-directory enforcement are not claimed. The two independent game/accounting journals conservatively retain evidence on partial failures; no atomic multi-store transaction is claimed. Gitignore patterns reduce accidental publication and are not security controls.

The original US$0.019114 actor reservation, unknown actual billing and unresolved diagnostic liability remain untouched. The support report's nine combined admissions include the original actor attempt; they were not added to a separate one or imported into a new counter. `RECOVERY_HOLD`, `assertLiveAdmission()` and the four audited core/test files remain unchanged. No API credential, diagnostic, model request, paid actor, Evals run, package download or original accounting write was used in this work.

Read [the original accounting inventory](ACCOUNTING_RECOVERY_INVENTORY.md) and [unexecuted reconciliation proposal](ACCOUNTING_RECONCILIATION_PROPOSAL.md) before any financial transition. A successful synthetic test is neither evidence of historical payment nor permission to dispatch a real request.
