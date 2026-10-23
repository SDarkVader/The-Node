> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

> Follow-up: [durable fixture execution authority and v1/v2 compatibility](DURABLE_FIXTURE_RECOVERY.md). New checkpoints include execution attempts; old v1 game evidence remains readable but cannot grant fixtures from missing history. See [development audit](DEVELOPMENT_BRANCH_AUDIT.md) for the reproduced restart gap and current 956-test results. This earlier review below describes the original game-state checkpoint stage.

# Durable participant checkpoints and crash recovery

17 October 2026. Implemented and verified on the reconstruction branch. The original
checkout, both main branches, validated broker core and spending records remain unchanged.

## Implementation and commit boundary

`src/agent/checkpoint.ts` stores private participant evidence. `src/agent/durableHost.ts`
provides opt-in `createDurableHost` and `openDurableHost` factories around the existing host.
The original three-argument in-memory host remains available for explicitly volatile fixtures;
it does not silently acquire durability. The durable host can be passed to the existing
loopback transport without changing the socket protocol.

A durable tick proceeds in this order:

1. Persist the fixed-tick intent: ordered admitted decisions and online snapshot.
2. Execute the real deterministic kernel on the current lineage.
3. Persist the completed replay tape, complete-state hash and effects hash.
4. Publish the resulting observation and positive socket admissions, preserving request order.

`queued` still means receipt only. Proposals not included in a durable intent are not restored.
Failure to persist intent or completion stops the host and revokes authority. A failed step
retains its intent and records a halt when storage permits. Socket cleanup still runs if
recording a clean shutdown fails; no false durable-close success is returned.

## Recovery behavior

The checkpoint stores genesis, source revision, bound person, complete committed action
tape, sequence, lifecycle state and an optional prepared intent. It rebuilds state through
independent replay rather than attempting to serialize the mutable RNG closure. Private
state, ordered Maps/Sets and memory are verified through the existing complete-state hashes.

| Last durable record | Recovery |
|---|---|
| Running, no intent | Replay committed history exactly. No queued proposal or previous session returns. |
| Prepared intent | Replay committed history from fresh genesis, execute that exact intent once, then atomically commit the result. |
| Completed tick whose acknowledgment was lost | Replay the completed tick; never execute it again as a new tick. |
| Clean shutdown | Refuse by default. A trusted operator must explicitly request `resumeCleanShutdown:true`. |
| Departed bound person | Refuse resumption; never bind a replacement. |
| Halted kernel failure | Refuse automatic retry; retain pending evidence for diagnosis. |
| Missing/corrupt/wrong-revision checkpoint | Fail closed, without a fresh history or fallback to a temporary file. |
| Existing live writer | Refuse, including when stale-lock recovery was requested. |

Each writer holds an exclusive-create lock. Crash recovery must explicitly request
`recoverStaleLock:true`; the implementation checks that the recorded process is dead and
refuses live or indeterminate ownership. It does not blindly remove locks. Retired temporary
writes are quarantined as orphan evidence, never adopted as authoritative state.

Files are bounded to 16 MiB and tapes to 10,000 ticks. Writes use an exclusive temporary file,
file fsync and atomic same-directory rename. The current committed bytes are checked before
replacement, so unexpected changes under the writer lock stop execution. Regular-file,
hard-link and directory-link checks reject unsafe paths. POSIX ownership and private modes
are checked. The tagged canonical encoding retains undefined config fields that ordinary
JSON would silently drop and thereby change genesis evidence.

## Verified results

- **21 new checkpoint tests pass**, including six real child-process exits at intent/result
  write boundaries: before writing, after temporary-file fsync and after rename. The fixtures
  exit without running host cleanup; restart verifies the resulting state and repeated reopen.
- Tests verify replay equality, two separate restart sessions, duplicate rejection, last-good
  history, partial-write quarantine, no fallback from a corrupt authoritative file, checksum
  corruption, oversized files, competing writers, hard links/junctions, interrupted clean
  shutdown, departed identities and persistent kernel halts.
- Real socket tests verify that failed durable completion sends no positive admission or
  new observation. Separate tests verify every socket closes even if shutdown persistence fails.
- **823/823 regression tests across 75 files pass**, including existing socket tests and
  the 21 new checkpoint tests. All **74/74 native broker/integration tests pass** as well:
  **897 verified tests in total**. Repository-wide TypeScript checking passes.
- The validated core's original four file fingerprints remain unchanged. No agents, model
  requests, provider diagnostics, accounting writes or package downloads were performed.

Moving positive socket acknowledgments after durable completion initially reordered them
relative to rejections in a mixed batch. The existing quota test caught this; all admission
replies are now buffered and emitted in submission order after successful completion.

## Operator API

Use a new private directory outside the repository for a new synthetic trial. `create` fails
if the directory already exists; `open` never initializes missing data. The controller token
is supplied externally, is not stored in the checkpoint and is not a model/API credential.

```ts
const host = createDurableHost(privateDirectory, genesis, existingPerson, controllerToken);
// After a process interruption, with the same trusted expected source revision:
const restored = openDurableHost(privateDirectory, expectedSourceRevision, controllerToken,
  { recoverStaleLock: true });
```

Use `resumeCleanShutdown:true` only for a deliberate resume of a recorded clean shutdown.
Session leases and observation authorization IDs are newly issued after restart. Old tokens
and fixed-tick submissions cannot be retargeted to a new tick. Exactly-once here means one
application of a durably prepared tick to reconstructed game state, not a guarantee for
arbitrary external services or repeated new authorized decisions on later ticks.

Reproduce verification with existing local dependencies:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 --no-file-parallelism
```

The existing `verify-participant-integration.ps1` runner verifies the additional 74 native
checks against the preserved baseline. Crash fixtures are mechanical Node subprocesses;
they do not run agents or contact a provider. Temporary sockets and test files are cleaned up.

## Limits and accounting separation

Verified guarantee: process-interruption recovery on the current Windows environment.
Node cannot fsync a directory on Windows, so rename metadata is not claimed durable across
power loss. POSIX directory fsync is used where available, but physical power-loss behavior
has not been tested. Windows mode bits do not enforce private NTFS ACLs: the trusted caller
must supply an appropriately protected directory before using non-fixture private evidence.

Checkpoints contain private genesis, observer namespace/secret, person IDs and actions.
They are evaluator-only and have no game protocol endpoint. Their filenames are gitignored
to reduce accidental publication; that is not an access-control mechanism. Checksums detect
corruption, not malicious same-user rewriting or rollback to an old valid backup. Source
revision is checked against the trusted caller's identifier, not independent binary attestation.

This is not a spending ledger. There is no budget initializer, settlement, fresh allowance,
key storage or paid transport. The historical US$0.019114 hold and documented request counts
remain unresolved and untouched; `assertLiveAdmission()` still always rejects.
