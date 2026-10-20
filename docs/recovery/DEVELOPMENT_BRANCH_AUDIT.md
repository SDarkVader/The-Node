# Development branch audit and broker continuation

17 October 2026. Audited GitHub `SDarkVader/The-Node`, branch `broker-reconstruction-2026-10-17`, at **`c1238dee340c1d551907348ec38944344ea3e4fe`**. No remote branch named `development` was advertised, so the active reconstruction branch was used as the development branch. Git access was verified with `git ls-remote`; no GitHub connector/API or model/provider request was used.

Work took place in a fresh checkout on `broker-audit-rebuild-2026-10-17`. The original recovery and both earlier reconstruction checkouts were preserved. Local mock-provider commit `89c53792b6c9ec6d198962d8e8000619f3042d1f`, absent from the remote development tip, was merged with its history intact instead of discarded or replayed over the newer remote fixes.

## Reviewed changes already present upstream

- `5b4bd3b`: callback argument checks and an additional detached fixture input copy.
- `ee1c643`: safe integer grid-coordinate validation.
- `86b481f`: permanent offline broker halt after a callback rejection.
- `914b6a8`: reject changed movement/presence/recognition affordances as stale.
- `4cb42a7`: explicit controller-session rollover rejection, followed by disconnect/shutdown and checkpoint tests.
- Eight targeted CI workflows and the additional native/checkpoint regressions merged through PR #19.

The development snapshot passed repository TypeScript and **824 Vitest tests across 75 files** before rebuilding. These checks established the baseline; passing tests did not cover the restart issues below.

## Findings and disposition

| Priority | Finding | Evidence and repair |
|---|---|---|
| P1 | Reopening a game checkpoint forgot fixture execution authority. A fresh `OfflineBroker` could repeat a consumed person/tick, overlap an unresolved pre-shutdown callback, or clear a permanent callback-failure halt. | Three new regressions each admitted an unexpected second fixture on the audited implementation. Added a durable fixture-attempt record in checkpoint v2, persisted before callback execution and before publishing completion. Interrupted/uncertain attempts and permanent halts stay blocked across reopening; completed same-tick attempts stay consumed. |
| P2 | The local mock test expected only same-tick rejection after callback failure, conflicting with the newer upstream permanent-halt policy. | Preserved the stronger upstream behavior and updated the imported mock regression to expect `fixture_halted`; no core weakening. |
| P2 | Existing CI workflows targeted historical feature-branch pushes and manual dispatch. None covered pull requests into the actual development branch. | Added `broker-recovery-audit.yml` for development PRs and development/audit-branch pushes, with TypeScript, full Vitest and native participant parity against the pinned preserved baseline. Workflow PowerShell command parses locally; hosted execution is not claimed. |

The three P1 regressions were run before the repair and all failed with `validated_offline` where rejection was required. After the repair, the expanded **20-test durable fixture suite** passes. See [the exact checkpoint contract and compatibility behavior](DURABLE_FIXTURE_RECOVERY.md).

## Core preservation

The remote branch had already changed three of the four previously protected files through the reviewed hardening commits. The old handoff fingerprints therefore no longer describe the development tip. This continuation preserves the audited development versions byte-for-byte; it does not roll those fixes back or edit the core further.

| File | Audited development SHA-256, unchanged by this continuation |
|---|---|
| `src/agent/broker.ts` | `18AE2361CEF25DE367E5486C7943C2C012CB9E9634DC487664F3071E34EABC55` |
| `src/agent/protocol.ts` | `E5544446AC456C07BF3432ECCF8C82759546ED4B76AAA9DBFCDCEB9645CFC203` |
| `src/agent/httpBody.ts` | `AC9A053B1A5EDE9A2102CF68EEC561CEA5CD8C64E36F17562E12392A23782645` |
| `test/brokerRecovery.test.mjs` | `4FBA5ACBB920298CBAC56599AB7B413D61452739A144F1D564D40074461A7E8C` |

## Final local verification

- Repository-wide `tsc --noEmit`: passed.
- Full Vitest: **876/876 tests across 77 files** passed, including all prior socket/checkpoint tests, the merged 32 mock-provider tests and 20 new durable fixture tests.
- Native broker/participant runner: **80/80** passed, including the new upstream coordinate/callback/affordance/session tests and deterministic kernel parity.
- Total: **956 verified tests**. `git diff --check` passes. The four audited core fingerprints remain unchanged.
- Six mechanical child-process crashes exercise pre-callback and completion writes before write, after file fsync and after authoritative rename. No child runs an agent or provider request. Temporary sockets/processes/files are cleaned up.

Dependencies were copied offline from the previous checkout. No credentials were read, no spending ledger was created/reset/settled, and no model/API diagnostic, paid actor or Evals request was made. Git remote reads and a separate review-branch publication are source-control operations; neither authorizes provider access.

## Remaining scope

The durable attempt record is an offline execution guard, not a request counter, reservation, billing receipt or cumulative spending ledger. It cannot reconcile the original US$0.019114 actor hold or the documentary count conflict. No paid admission was enabled; `assertLiveAdmission()` still always rejects. Real provider transport/Responses parsing and credential-process isolation remain absent. The mock still receives minimal context, not a complete strategic policy input.

Legacy v1 checkpoint game state can be replayed and advanced, but its missing fixture history is never assumed unused. It has no automatic fixture-history reset/migration. Windows physical power-loss durability, NTFS ACL enforcement, malicious same-user rollback protection, public transport and cross-host migration remain outside the tested guarantee. Original missing historical source and private run/ledger evidence are still missing.

During publication of the separate audit branch, GitHub's Git server reported **three moderate dependency alerts on the default main branch**. Git did not supply alert IDs or affected versions. No advisory/API query or dependency update was performed, and this scoped broker review does not claim those alerts are fixed or establish which apply to the reconstruction lockfile. Preserve that notice for a separate dependency review using current authoritative advisory evidence.
