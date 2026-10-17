> Latest development audit, 2026-10-17: [audit findings and verification](DEVELOPMENT_BRANCH_AUDIT.md), [durable fixture execution recovery](DURABLE_FIXTURE_RECOVERY.md). Preserved upstream hardening at c1238de and local mock history; fixed restart losing fixture attempts/halts. New v2 records coexist with conservative v1 game replay. Full 876 Vitest + 80 native = 956 tests and TypeScript pass. This is game execution evidence, not a recovered/reset spending ledger. Old fingerprints/status below are dated; live admission remains closed.

> Latest, 2026-10-17: [offline provider mock boundary](OFFLINE_PROVIDER_BOUNDARY.md) is implemented and all 929 tests plus TypeScript pass. [Read-only accounting inventory](ACCOUNTING_RECOVERY_INVENTORY.md) corrects the handoff count wording: nine combined documented admissions include the original actor attempt; the protected reminder uses an ambiguous diagnostic label. [Reconciliation proposal](ACCOUNTING_RECONCILIATION_PROPOSAL.md) is not executed. Original ledger/actual billing are missing; live admission remains closed. Historical credential reports below are not current environment tests.

> Latest: [durable participant checkpoint and crash recovery](CHECKPOINT_RECOVERY.md). This adds game-state persistence only; original spending records, historical holds and paid-execution restrictions remain unchanged.

> Latest reconstruction work: [authenticated local transport review and verification](LOCAL_TRANSPORT_REVIEW.md). This new code does not recover the historical spending ledger or enable paid execution.

> Current separate-checkout work: [offline participant integration reconstruction](OFFLINE_INTEGRATION_STATUS.md).
> The historical implementation and original ledger described below remain missing; new
> offline code and new test results do not replace that historical evidence.

# Interrupted Node experiment: recovered record

Recovered on 2026-10-17 from this conversation, tool results and the user's screenshots.
These are reconstructed records, not byte-for-byte recovery of the missing files.

The running workspace contains original revision `e6be3b260ffe7da0de7f0a56b31a13aa62779f83`.
The prior broker commits, private budget, full run evidence and portable patch are absent.
Git reflogs/unreachable-object checks and local recovery-path searches did not find them.
The screenshots confirm the interrupted changed-file list, but contain no file contents.
Do not infer that the prior integration is currently installed or that its tests were rerun.

- [Decisions, mechanics and incremental plan](EXPERIMENT_FIRST_INHABITANT.md).
- [Recorded observer/action and broker protocol](EXPERIMENT_BROKER_PROTOCOL.md).
- [Evals, safeguards and recovery procedures](EXPERIMENT_EVALS_AND_SAFEGUARDS.md).
- [Historical first pass and current credential checks](EXPERIMENT_FIRST_PASS_RESULTS.md).

Current environment revision 5 reports its API binding ready and network policy enforced. A new credential diagnostic through
the configured proxy nevertheless returned **HTTP 401 / `invalid_api_key`**. No generation
started. Publication is confirmed; repeated publication is not the next diagnostic. See the
[remaining-authentication support report](CREDENTIAL_BINDING_SUPPORT_REPORT.md). No key value
belongs in chat, repository files or command text.

The prior US$0.019114 reservation must remain accounted. Do not initialize replacement
accounting at zero or resume a paid actor while the original ledger is unavailable.

## Recovery targets

The screenshot names the rejection-cleanup repair and four extensive experiment documents:
`src/agent/evals.ts`, `httpBody.ts`, `provider.ts`, `test/agentHttpBody.test.ts`, the four
`docs/EXPERIMENT_*.md` files, `docs/AGENT_ROLE_CONTRACT.md` and `docs/BLUEPRINT.md`.
Other prior implementation files included `src/agent/{budget,protocol,broker,host,experiment}.ts`,
`src/engine/inhabitants.ts`, `src/server/observer.ts`, participant replay and corresponding
kernel/server/tests. Restoring only the visible HTTP repair is insufficient.

Recorded local commit identifiers, currently absent here:

| Commit | Historical purpose |
|---|---|
| `f8d36c8` | Budget/account-enforcement clarification before broker work |
| `b7c87f45ddb253a1c55a0ea28f27734479f442e3` | Broker and deterministic Evals adapter; first live executable revision |
| `befaf31` | HTTP response-destruction cleanup repair |
| `552638e` | Experiment specification |
| `faf1451` | Observer/action/broker protocol |
| `877f1bf` | Evals/safeguards protocol |
| `71a6ea4` | Actual first-pass report |
| `f825fe0` | Last recorded local HEAD after living-document/history updates |

The earlier GitHub push failed 403, so those commits cannot be assumed on the remote.
An export of the earlier change set, Git bundle, source patch or newer prepared snapshot
would allow exact recovery. Current tools do not expose a filesystem-snapshot restore or
the contents of the UI's historical changed-file panel. These notes preserve the design
and measurements while that source recovery remains unresolved.
