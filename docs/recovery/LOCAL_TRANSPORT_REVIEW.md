# Local transport review and verification

17 October 2026. Follow-up work on `broker-reconstruction-2026-10-17`; neither local nor
remote `main` is the work branch. The original recovery checkout and the four validated
broker core/test files remain unchanged.

## Review outcome

The existing participant identity/observer/admission/replay boundary was inspected before
adding transport. No change to the validated core was required. The important new boundary
is between untrusted socket frames and the trusted in-memory host: authorization is obtained
before any observation is disclosed, and no evaluator effect record, raw person ID, genesis,
replay tape or controller credential is sent back as game state.

Two output-containment issues were caught during implementation review and corrected:

- Automatic `ws` pong responses bypass the application output-budget check. Automatic pong
  is now disabled; ping/pong traffic is rate counted and output bounded explicitly.
- WebSocket framing consumes bytes beyond the JSON payload. Output admission reserves
  14 framing bytes and rejects serialization failures rather than throwing through handlers.

The review is scoped to this reconstruction and its local transport. It is not a claim of
recovering the original source or a full audit of a production deployment.

## Implementation

`src/server/participantSocket.ts` provides `startParticipantSocket({host,...})` as an opt-in
library. It binds exclusively to `127.0.0.1` on an ephemeral port by default. There is no
automatic startup, CLI, provider adapter, paid request, remote advance command or automatic
tick loop. The trusted caller invokes `advance()` and must call `close()` when finished.

| Control | Behavior |
|---|---|
| Upgrade route | Exact `/`; query identity, alternate paths and absolute request targets rejected. Ordinary HTTP returns 404. |
| Browser origins | Empty allowlist by default. Exact allowlist matching for both Origin variants; duplicates rejected. Native clients may omit Origin but still must authenticate. |
| Authentication | First text frame must be exactly `{type:'authenticate',token}`. Host performs timing-safe credential comparison and admits one controller lease. No observation before success. |
| Socket bounds | At most 128 connections, including unauthenticated sockets. Authentication deadline 5 seconds. |
| Inbound data | At most 4,096 aggregate bytes, including fragmented messages. Text JSON only; malformed/binary/oversized traffic closes the connection. Compression disabled. |
| Rate | 64 frames/second per connection, including ping/pong control frames. |
| Queue | Eight queued proposals/connection/tick; 256 globally. Quota overflow revokes that connection and removes its queued proposals. |
| Admission | `queued` acknowledges only pending receipt. At trusted advance, exact host envelopes, tick/observation binding and category quotas are revalidated; safe admission codes are returned. |
| Output | At most 262,144 buffered/output bytes including conservative framing reservation. Oversized observations or slow-output exhaustion revoke authority. No provider/peer exception text is logged or sent. |
| Liveness | 30-second heartbeat; a missed pong terminates the connection and releases its lease. |
| Shutdown | Immediate authority revocation, pending-proposal removal, all upgraded/raw sockets closed, heartbeat/auth timers cleared, idempotent close. |

Trusted callers can lower limits, including for tests; they cannot widen the fixed caps.
Socket protocol messages cannot choose a person, change limits, access evidence, start a
fixture/model or advance the kernel. Disconnect deliberately removes pending, uncommitted
proposals; a `queued` response must not be interpreted as an admitted economic effect.

## Verified results

- **22/22 new socket tests pass** using real temporary loopback sockets. They cover
  no pre-authentication disclosure, bad tokens, single controller, stale observations,
  per-category admission, reconnection, actual own-price effects across three ticks,
  complete replay equality, Origin variants/duplicates, path/query rejection, malformed and
  binary messages, fragmented oversize input, rate/control frames, socket/global queue caps,
  authentication/heartbeat expiry, oversized observations, shutdown and output-write failure.
- **802/802 tests across 74 Vitest files pass**, including all five legacy WebSocket test
  files that were excluded during the earlier offline-only implementation stage.
- **74/74 native core/integration tests pass**: 40 unchanged broker core checks plus 34
  participant integration/parity/replay checks. Combined verification covers **876 tests**.
- Repository-wide `tsc --noEmit` passes. The affected 22-test socket suite and typecheck
  were rerun after the final output/framing/fragmentation checks; they pass.

Slow-output buffered-byte admission is tested with a controlled output-socket fixture;
real socket tests also verify that oversized output is rejected before an observation is
sent. This does not claim an operating-system slow-reader stress benchmark.

All test servers closed during cleanup. No persistent listener or background game process
was left running. Dependencies were already installed locally; no package download, model
request, paid generation, agent execution or accounting reset occurred. The installed test
compiler required the already-authorized subprocess sandbox exception to run Vitest.

## Reproduce

With the existing local dependencies available:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 --no-file-parallelism
```

Run `scripts/verify-participant-integration.ps1` with the same local dependency, preserved
baseline and scratch paths documented in [offline integration status](OFFLINE_INTEGRATION_STATUS.md)
for the additional 74 native checks. These are separate runners; no test count is inferred
from historical results.

## Remaining boundaries

The old `npm run server` remains the legacy server and is not silently replaced by this
library. Do not treat its query identity as authenticated participant transport. The new
library is a local test/control interface, not public hosting: production accounts/TLS,
network isolation, durable lifecycle/evidence storage, cross-host person migration and
provider credential process isolation remain separate work.

The original spending ledger and original historical evidence are still missing.
`assertLiveAdmission()` still always rejects. The US$0.019114 reservation and documented
request counts were not changed. Resolving accounting is required before any future paid
execution; this transport does not grant permission or supply a workaround.
