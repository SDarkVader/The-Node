> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Offline broker reconstruction — 2026-10-17

This separate checkout starts at recovered `9126afbaadc3b16455f735c109a6bf67e9fcdd6f`.
The original recovery checkout and bundle remain untouched. These are newly written
modules, not the missing historical commits. No existing engine or server source changed.
Historical recovery documents remain historical evidence rather than executable instructions.

## Implemented and checked

- `src/agent/protocol.ts`: four required nullable decision slots, closed engine vocabulary,
  exact fields, legal coordinate pairs, current/known references, role restrictions and
  finite Baker prices in [0,2]. Detached explicit projection excludes extra fields.
- `src/agent/broker.ts`: offline fixture orchestration; one in flight, no duplicate
  person/tick attempt, fixed maximum input/output/deadline bounds, model/completion/usage
  validation, stale identity/tick/role-epoch rejection and current-affordance revalidation.
  Timeout permanently halts that fixture runner because cancellation is not proof of exit.
- `src/agent/httpBody.ts`: bounded JSON stream reader, deadline/early-close handling,
  no rejected-body decoding, error handler installed before stream destruction.
- `test/brokerRecovery.test.mjs`: 40 native Node tests passed, including asynchronous
  destruction errors for 401/403/429/500, overflow, malformed/stalled streams, unauthorized
  decisions, stale results, snapshot mutation, duplicate/concurrent attempts and timeout.

Strict TypeScript compilation passed for the new modules and their imported engine code.
The old full suite was not run; its historical 868-test result is not current verification.
Tests use in-memory streams and fixture callbacks: no HTTP request, model, actor, agent,
server or account diagnostic was started. No packages were downloaded.

## Reproduce offline

Requires Node 24 and an existing node_modules directory containing TypeScript and @types/node.
Run from this checkout, supplying absolute paths:

```powershell
.\scripts\verify-broker-recovery.ps1 -TypeScriptRoot '<existing node_modules>' -BuildDirectory '<scratch build directory>'
```

The runner compiles the new modules and uses Node's test runner without subprocess
isolation. Ordinary test isolation was denied by the sandbox (`spawn EPERM`); no permission
bypass was attempted. Direct local clone also hit a Git shell restriction, so the separate
checkout was created directly from the original complete bundle instead.

## Still missing — do not call this a restored operational broker

- Authenticated participant host, authoritative stable person/role-episode registry and
  complete observer projection (including actual geometry, visible public state and mortal
  memory). The current DecisionContext is a minimal trusted-host contract fixture only.
- Real kernel admission for participant movement and own-price decisions, socket lease,
  category quotas and transport-token handling. Validation is not action admission.
- Action-bearing complete-state replay, participant memory repair and deterministic Evals
  adapter. No gameplay outcome or noninterference claim is established by fixture tests.
- Provider transport, Responses envelope parser, dynamic provider schema, credential
  handling, durable cumulative ledger and original private evidence.

The pure decision validator assumes its context contains legitimate observer references
from a trusted host; it does not authenticate or derive them from World. The stream reader
is tested independently and is not a live HTTP implementation. Fixture token counts do not
establish real billing or provider entitlement.

`assertLiveAdmission()` always throws. No live provider implementation or CLI was added.
RECOVERY_HOLD records historical 19,114 micro-USD, one original actor request and nine
documented total diagnostic admissions as distinct facts. It is an immutable reminder,
not a replacement spending ledger, settlement, fresh allowance or permission to run.
Original spending records were neither read into new accounting nor changed.

Next engineering step: build the authoritative participant identity/observer boundary and
offline kernel admission/replay checks in this separate checkout before connecting transport.
Paid resumption separately requires recovered or explicitly reconciled cumulative accounting
and explicit authorization overriding the current prohibition on API requests/agents.
