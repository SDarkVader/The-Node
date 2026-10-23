> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Durable offline fixture execution authority

17 October 2026. Extends the game checkpoint implementation after the [development audit](DEVELOPMENT_BRANCH_AUDIT.md) reproduced repeated/overlapping fixture execution across restart. No broker-core changes or financial accounting are involved.

## Version 2 record

New checkpoints use `node-participant-checkpoint-v2` with a version-2 payload and required `fixtureAttempt`, initially null. The most recent execution record contains an opaque ID, tick, role epoch, hash of the detached core context and a status: `pending`, `consumed` or `halted`. It stores no full fixture input, controller/session/observation token, provider key or completion body. It is private game execution evidence, not a count of requests or money.

The existing checksummed canonical encoding, writer lock, bounded files, exclusive temporary write, file fsync and atomic rename protect this record together with the game tape. Envelope/payload version disagreement and missing or invalid fixture metadata fail closed.

## Execution order

1. Authenticate/read current observation and check category ownership and existing execution state.
2. Let the unchanged broker validate its input/bounds and decide whether it will invoke a callback.
3. Inside that callback boundary, persist the unique `pending` attempt before invoking the actual fixture.
4. On a resolved outcome, persist `consumed`, or `halted` for callback failure/timeout, before queueing any accepted decision or returning success.
5. Continue the existing durable tick intent/kernel/result ordering for actual game effects.

If the pre-callback write fails, the actual fixture is never invoked and the host stops. If the completion write fails, success is not published and the host stops; the authoritative disk record determines which rejection applies after restart. A post-rename committed completion remains consumed even if its acknowledgment was lost. An uncommitted temporary write is still quarantined rather than adopted.

Shutdown/disconnection cannot transfer a late result to another controller. An old host that has closed never settles against a released checkpoint writer. Its pending execution evidence remains pending; a reopened host cannot assume the callback terminated. Manual game input/ticks may continue without granting new fixture authority.

## Admission after restore

| Durable execution state | Fixture admission |
|---|---|
| v2, no attempt | Normal unchanged broker validation; persist before callback |
| Active pending attempt owned by this running host | `in_flight`; no second callback |
| Pending attempt restored from an earlier host | `fixture_halted`, including after later manual ticks/reopens |
| Permanent callback-failure/timeout halt | `fixture_halted` across ticks/restarts |
| Consumed attempt at current tick | `tick_already_attempted` across repeated clean close/reopen |
| Consumed attempt at an earlier tick | Next-tick fixture may be admitted normally |
| Legacy v1 without execution history | `fixture_halted`; missing evidence is not a fresh allowance |

This blocks offline callback duplication. It does not attest actual provider delivery or charge, cancel arbitrary external work, protect against malicious rollback or provide financial admission. Creating a second independent fixture checkpoint is not a mechanism for new paid allowance; live admission remains closed everywhere in this reconstruction.

## Compatibility

Version-1 envelopes/payloads remain readable for deterministic game replay, inspection and ordinary game advancement. They retain version 1 and the original tape; no synthetic null execution history is inserted. They cannot evaluate new fixtures because their prior execution state is unknown. No override or automatic history reset is provided.

Version-2 envelopes require a version-2 payload with the new field. Older readers reject this shape; do not open a new checkpoint with an old executable or strip its execution field to make it load. Use the new reader for both versions. Fixture tests create synthetic legacy records only in temporary directories to verify conservative compatibility; no real checkpoint was rewritten during development.

## Verification and limits

`test/fixtureRecovery.test.ts` has **20 passing tests**. It covers the three originally failing restart cases, exact pre-callback persistence, private-token exclusion, legitimate next ticks, stale/in-flight work, continuing manual ticks under an interrupted fence, legacy records, invalid callbacks, persistence failures, checksummed metadata corruption, and six actual process-exit write windows. Tests count real callback invocations and check which authoritative record survives; repeated reopening must not erase it.

The complete reconstruction passes 876 Vitest tests plus 80 native checks and TypeScript. These are local Windows results; the new CI workflow has not been claimed to pass on a hosted runner. Physical power-loss guarantees and private Windows ACL enforcement remain as documented in [the original checkpoint review](CHECKPOINT_RECOVERY.md). No original financial records or historical source were recovered by this work.
