> Subsequent stage: [Responses transport and separate-host rebuild](PROVIDER_ADAPTER_REBUILD.md) implements the previously absent final-wire serializer, verified HTTPS/CONNECT adapter, lazy credential reader and credential-separated host. Actual accounting remains unreconciled and live admission stays closed. This page records the earlier ledger reconstruction stage.

# Broker and interrupted-account ledger rebuild

17 October 2026. Continues `6f090f0c688a7b17e3bef52b5136d6c5be41c477` in a separate checkout and branch `broker-accounting-rebuild-2026-10-17`. This stage replaces the previous synthetic-only stopping point with an account-specific recovery journal and a broker that accounts locally supplied response archives before considering game actions. It does not recover missing original bytes or establish actual provider billing.

## Implemented code

| Path | Contract |
|---|---|
| `src/agent/accountingStore.ts` | Private bounded checksummed storage, exclusive writer, serialized dead-writer recovery, atomic replacement, fsync, changed-byte detection and orphan quarantine. Missing/corrupt state never creates a replacement on open. |
| `src/agent/accountingLedger.ts` | Documentary origin, immutable evidence imports, carried historical liabilities/counts, explicit operator reconciliation, cumulative/trial/request caps, reservations, independent usage receipts, cancellation, conservative full-ceiling request dispositions and durable single-consumption decision records. |
| `src/agent/recordedResponse.ts` | Pure bounded UTF-8/JSON reader for recorded Responses-shaped envelopes; extracts usage independently of refusals, incomplete/failed output, invalid decision text or unsupported tools. No SDK, HTTP client, endpoint, credential or transport callback. |
| `src/agent/accountedBroker.ts` | Bounded current-policy preparation, durable reservation before returning an artifact, accounting before validation, unchanged core validation/freshness checks, durable response claims and authenticated host submission. |
| `scripts/rebuild-accounting.ts` | Reconstruct a new account journal from the three pinned documentary sources, or inspect an existing journal. No financial reconciliation command or network capability. |

The original `SyntheticBudgetLedger` remains a fixture implementation. The new accounting journal uses `node-accounting-journal-v1`, account `node-interrupted-experiment-2026-10-16` and `accounting.journal.json`; a synthetic journal cannot be opened as this account. Neither class modifies an original ledger or the protected `RECOVERY_HOLD` object.

## Historical origin and financial semantics

Reconstruction requires the exact known documents (LF and CRLF copies are accepted through separate normalized pins). Their exact supplied text and byte hashes are retained inside the journal, alongside the source revision. Altered, missing or duplicated source documents fail. Evidence additions are append-only events, so later evidence cannot rewrite the hash against which an earlier operator acted.

The reconstructed origin always carries:

- **19,114 microUSD / $0.019114 held**, actual usage and billed cost unknown.
- **Nine combined documented admissions including the original actor attempt.** Never add a separate actor request to nine. Exact event identities and provider delivery remain missing.
- **Unbounded diagnostic liability**, represented as null, never silently zero.
- No derived remaining allowance and no financial authority. Another directory starts with these same liabilities and blockers; it never starts with zero historical spending/counts.

The journal keeps actual billing distinct from booked accounting valuations. `actualBilledMicroUsd` remains null. Known validated usage is valued conservatively at the operator-supplied, evidence-linked rate snapshot. Cached-input discounts are ignored and each token category rounds upward in integer microUSD. BigInt preserves even a known single-receipt overrun beyond safe Number precision; the honest amount and permanent overrun halt survive reopening.

Two trusted operator interfaces are implemented and tested with disposable fixtures only:

1. `reconcile`: a recorded human identity, reason, time, expected journal hash, evidence references and explicit acknowledgments of missing original records, unknown billing and the count overlap. The actor can only be booked at its entire historical ceiling, never forgiven. Diagnostic liability must be explicitly bounded by the operator to remove that blocker; leaving it null preserves the block. An expiry and cumulative/trial/request ceilings are required. A later call cannot replace or widen this decision.
2. `closeUncertainRequest`: an explicit evidence-linked full-reserved-ceiling booking for a later unresolved request. It retains the admission, unknown actual billing, original receipt and cancellation. It never grants a late action. Later lower usage does not silently undo that conservative booking; a later higher valuation is retained honestly.

Neither interface is exposed to the policy/model or invoked automatically. They are trusted local operator functions, not an authenticated administration server or cryptographic proof of a human decision. Documentary evidence and a hash alone do not authenticate a provider invoice. **No actual reconciliation, unknown-cost closure or new financial allowance was executed in this stage.**

Historical constraints are ceilings, not fresh grants: at most $5 cumulative, $0.25 across the entire carried trial and ten combined admissions. A disposable operator fixture that explicitly permits ten can admit at most one additional request after the carried nine. The account has one unresolved request at a time; requests are never refunded, including known zero usage. Overrun or storage failure cannot be hidden by discarding an action.

## Broker lifecycle and gameplay integration

`prepareFromHost` reads the existing authenticated observer and includes its complete authorized strategic projection: own state, public city/geometry, recognition, heard rumours/proximity, living diary and legal moves. It excludes controller/session/observation tokens, observer secret and raw World. The decision schema reuses the existing pure dynamic schema generator; this is application-level schema reuse, not a claim that the mock transport is a real provider client.

The initial integration test exposed a real 32-KiB overflow from serializing both the full projection and a duplicate minimal context/reference list. The broker now includes the full projection once; its authoritative validation snapshot stays separately in the private ledger. It neither raises the 32,768-byte limit nor truncates the actor's authorized information. An oversized world still fails before reservation. The reserved input ceiling uses serialized policy bytes plus 4,096 framing bytes, capped at 36,864 input / 2,048 output tokens. A future actual wire client must reserve against its final serialized request, not assume this application artifact is its complete wire body.

Preparation returns `dispatchAllowed:false` and contains no endpoint or transport callback. `complete` accepts only locally supplied bounded response bytes. It records valid known usage before rejecting non-completed status, refusal, invalid JSON/action, stale tick/episode/affordances, unavailable host or unexpected model. Malformed whole envelopes and invalid/missing usage retain the reservation. Wrong-model usage is never priced at another model's rates. Cancellation blocks actions even if it arrives during validation after cost was booked.

A durable decision claim precedes core evaluation. A second adapter or reopening cannot republish the same action, including a crash after claim but before outcome persistence. This can lose an action on a crash; it deliberately cannot create a retry/refund. `submitAccountedDecision` translates the validated proposal to the existing authenticated host; the host/kernel retain final freshness, person/episode, quota and mechanical authority. An outcome is not proof of game effect. Canonical admitted actions and complete-state replay remain the evidence of effect. Category submissions are not claimed to be a new atomic multi-category/multi-store transaction.

Usage remains booked if the host advances before submission or its game checkpoint fails. The accounting journal and game checkpoint are independent; no atomic transaction between them is claimed. Local tests exercise an actual bounded Baker price effect and complete-state replay after both stores reopen. This does not fabricate two more paid requests beyond the historical cap.

## Run without network

From this checkout with the already installed offline dependencies:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/rebuild-accounting.ts --reconstruct C:\path\to\NEW-account-recovery
node node_modules/tsx/dist/cli.mjs scripts/rebuild-accounting.ts --inspect C:\path\to\NEW-account-recovery
```

Reconstruct requires a new directory; inspect never initializes missing state. Preserve/export the existing journal bytes and hashes when transferring environments. Its missing-original flag and null liabilities must survive every transfer. Do not run the legacy `npm run server` as a broker entrypoint.

## Verification and limits

Ninety new focused tests pass: 41 ledger, 19 broker/host integration, 20 archive parsing and ten process-crash/recovery tests. Nine child crashes cover reservation, usage receipt and decision claim at before-write, after-file-sync and after-rename boundaries; a tenth establishes a leftover recovery guard. Children are mechanical test executables, not agents or providers. Known costs/counts and historical liabilities survive each tested crash. TypeScript, including the separate CLI compilation, and the 80 native broker/participant parity checks pass. The full standard two-worker regression run passed 1,016 tests across 83 files with durable exit code 0. Together with the 80 native checks, 1,096 distinct tests pass; the 90 focused tests are included in the 1,016. Hosted CI was not queried or claimed to pass.

No protected core/test, package manifest/lock, prior checkout or main branch was modified. No API key/environment binding was inspected, no agent or model was run, and no provider/GitHub API request, credential diagnostic, package download, paid transport or persistent server was used. Git publication is a separate explicitly authorized operation.

The original executable/ledger/run artifacts remain absent. Original actual billing and diagnostic bounds cannot be discovered by implementing a parser. A trustworthy original artifact or an explicit informed operator decision is still needed to reconcile those facts. Current provider access and wire compatibility were not queried. This reader implements the archived envelope contract, not an assertion of current service availability or API conformance.

The actual network/credential adapter and live rollout are still outside the current no-API authorization. `assertLiveAdmission()` remains unconditional. Same-user malicious rollback/copy forks, cross-machine global account coordination, NTFS private ACL enforcement and physical power-loss guarantees are not solved by a local checksummed journal. POSIX owner/mode checks, link/path checks and mechanical process-crash recovery are implemented; do not extrapolate them into a stronger security guarantee.
