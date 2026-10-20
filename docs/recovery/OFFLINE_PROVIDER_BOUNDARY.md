# Offline provider contract and host verification

17 October 2026. Implemented in a fresh checkout on local branch `broker-provider-offline-2026-10-17`, starting at `deede499ceaf59b61f734ad599162ff5c5bc535f`. The previous reconstruction checkout, preserved recovery checkout, main branches and validated four-file broker core remain unchanged. No remote write was made.

## Implemented

`src/agent/mockProvider.ts` provides a provider-neutral **in-memory fixture contract** and adapter for the unchanged `OfflineBroker` / `OfflineParticipantHost.evaluateFixture()` interface. It contains no HTTP client, endpoint, key reader, provider SDK, retry loop, listener, CLI or spending initializer.

- `buildMockProviderRequest(context)` copies only the core's authorized minimal `DecisionContext`, constructs a schema and recursively freezes the detached request. Full serialized request, including schema, is capped at 32,768 UTF-8 bytes.
- `mockDecisionSchema(context)` derives required nullable decision slots, paired legal coordinates, closed engine vocabularies, current present/known references, self-reference exclusion and role authority. Empty affordances become null-only where necessary; unknown properties remain forbidden.
- `createMockProviderFixture(transport, limits?)` accepts a trusted synchronous factory returning an in-memory `Readable` body and status. It passes bounded streamed JSON through the unchanged body reader and independently verifies completed status, exact fixture model, bounded integer usage and the unchanged decision validator.
- Limits cannot exceed 262,144 response bytes or 12 seconds. Cancellation destroys the stream after error handling is installed. Invalid status/body/usage/decisions are rejected with safe codes. No provider error text is exposed. The same adapter refuses overlapping use, while the existing core retains person/tick attempt and stale-result authority.

The mock completion envelope is exactly:

```ts
{
  status: 'completed',
  model: 'offline-fixture',
  usage: { inputTokens: 100, outputTokens: 40 },
  decision: { move: null, communication: null, diary: null, role: null }
}
```

This is **not** an OpenAI Responses envelope, a provider-compatible schema claim, a billing receipt or a recovered historical protocol. Fixture usage is synthetic. A real provider parser and request schema must be separately implemented against current authoritative documentation when that work is authorized. The request currently carries only the protected core's minimal decision context, not a full strategic observation/prompt interface.

The callback is trusted code running in process. It is not a sandbox, credential-isolated child process or proof that arbitrary callbacks cannot access environment/network resources. The supplied tests use only in-memory streams. Do not substitute an actual network callback or claim that the offline fixture gate is production authorization. Real dispatch must require a separate reviewed ledger/admission/credential boundary; `assertLiveAdmission()` still always rejects.

## Verification

- **32/32 new tests pass** in `test/mockProvider.test.ts`.
- A separate small schema interpreter compares 2,520 action combinations across Baker, Driver and Grifter contexts against the unchanged core validator, plus missing/extra fields, duplicate/empty affordances and changing observations.
- Tests verify request detachment/token exclusion, serialized bounds, status/model/usage enforcement, refusal/incomplete rejection, malformed/oversized/stalled/closed streams, asynchronous destruction errors, cancellation, shared-fixture concurrency and safe exception codes.
- Real host tests admit two own-price decisions with actual kernel prices and complete-state replay equality. Late responses after tick advancement produce no retargeted action. A rejected completion is not retried for the same person/tick.
- Full **855/855 Vitest tests across 76 files** pass, including all previous socket/checkpoint/regression tests. All **74/74 native core/integration tests** pass. Total: **929 verified tests**. Repository TypeScript passes.
- All four protected SHA-256 fingerprints match the previous verified reconstruction. No package downloads, model/provider/API requests, agents, credential reads, spending writes or persistent game processes were used. Dependencies were copied offline into the fresh checkout.

Commands remain:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 --no-file-parallelism
./scripts/verify-participant-integration.ps1 -TypeScriptRoot '<this checkout/node_modules>' -BaselineRepository '<preserved baseline at 9126afb>' -BuildDirectory '<fresh external scratch>'
```

The full regression suite uses temporary loopback sockets and mechanical crash-fixture child processes; those are not agents or provider calls. Do not run `npm run server`: it still launches the legacy scaffold. The local participant transport remains an opt-in library.

## Remaining work

The [accounting inventory](ACCOUNTING_RECOVERY_INVENTORY.md) corrects the nine-admission wording but does not recover or settle the original ledger. [Reconciliation](ACCOUNTING_RECONCILIATION_PROPOSAL.md), durable cumulative spending enforcement, a real Responses/parser boundary, credential process isolation, current authentication verification, Windows private-directory enforcement and stronger persistence guarantees remain separate work. No paid actor, diagnostic, retry, Evals run or public deployment is authorized by this mock implementation.
