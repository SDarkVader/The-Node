> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Offline participant integration reconstruction

Implemented on 17 October 2026 in this separate checkout. This is new code derived from
the recorded contracts, not a claim of recovering the missing historical implementation.
The original restored checkout remains unchanged at `9126afb`.

## What works offline

| Boundary | Implementation and verification |
|---|---|
| Participant identity | `src/engine/inhabitants.ts`: stable person IDs, exact location bindings, monotonically advancing role episodes, retired departures and no replacement inheritance. Optional indexed conscription events and kernel transition hooks cover ordinary churn, genuine fills, drafts, cross-role transfers, district consolidation, sabotage, arrivals and emigration. Population/identity invariants are checked after every participant tick. |
| Observer | `src/server/observer.ts`: detached authorized self/public/heard/recognized/alive-diary view; observer-specific HMAC references; public geometry without seed; no other wealth, raw person IDs, campaigns, presence truth or controller tokens. Core adapter normalizes `baker` to `Baker` and roleless people to `Grifter`. The unchanged core still receives only its minimal DecisionContext. |
| Authentication/admission | `src/agent/host.ts`: in-memory controller authentication with timing-safe token comparison, one random session lease, tick/context-bound observation IDs, exact action envelopes and category quotas. Disconnect/shutdown/departure invalidate authority. The host admits validated proposals and the real kernel rechecks identity/episode authority before price/social execution. Kernel exceptions halt that host because its RNG lineage may be partially advanced. |
| Kernel effects | `src/agent/participantWorld.ts`: adjacent same-district moves, translation of observer references and nullable contexts into existing communication/diary decoders, real bounded own-price override after normal Baker reaction/RNG and before demand/profit/completion. Stable person keys back recognition/private memory. Proven effects are recorded separately from proposals. |
| Mortal memory | Deep-copied diary store at each participant step; expiry/daily distortion at the tick boundary using a deterministic owner/day stream independent of economic RNG. Observer reads never age or mutate memory. Two-day retention and 0.2 daily distortion use existing diary mechanics. |
| Replay | `src/agent/replay.ts`: independent genesis, ordered online snapshots and canonical admitted decisions, per-tick complete-state and effect hashes. Ordered Maps/Sets, private entries, pending queues and person state are included; only the world RNG function is excluded. Changed/omitted/reordered actions and a different declared source revision fail verification. |
| Legacy queue repair | `src/server/ws.ts`: drain the same captured queue with splice rather than replacing the array. This server is not connected to the new participant host and was not started. |

## Verification results

- **40/40** original offline broker tests passed again; original core and test files are
  byte-for-byte unchanged, checked against their recorded SHA-256 fingerprints.
- **34/34** new integration tests passed. They include actual own-price/economic and
  movement effects, kernel diary writes, listener-specific proximity hearing, wrong/stale
  credentials and envelopes, role loss, replacement isolation, exact multiple-slot events,
  sabotage/consolidation/draft identity continuity, departure and action-bearing replay.
- Six seeds × 100 ticks: the patched legacy kernel matched the preserved original kernel's
  full serialized state, followed by equal next economic RNG draws.
- Six seeds × 180 ticks: participant mode conserved identities and matched every no-action
  legacy world field except presence keys, which intentionally become stable person IDs.
  The next economic RNG draw also matched.
- **757/757** existing offline regression tests passed across **68 files**. The five
  WebSocket test files were excluded; no game server/listener or provider transport was run.
- Repository-wide `tsc --noEmit` and strict compilation of the integration and preserved
  baseline passed. `git diff --check` passed.

The expanded parity test caught a real reconstruction bug: mapping person IDs inside the
shared occupant helper caused sabotage witness exclusion to count the target as a witness.
Fixed by retaining legacy building IDs for mechanical witness calculations and mapping IDs
only at the social boundary. The full no-action parity tests now pass.

The existing regression suite needed an approved sandbox exception to start its installed
esbuild subprocess (`spawn EPERM` in the normal sandbox). Tests used an offline copy of
already-installed dependencies; no packages were downloaded. The native integration tests
run in process without the exception. No agent or API request was run.

## Reproduce

Use an existing TypeScript/@types/node installation. Supply absolute paths from this
checkout; the baseline path should identify the preserved original recovered checkout.

```powershell
.\scripts\verify-participant-integration.ps1 -TypeScriptRoot '<node_modules>' -BaselineRepository '<preserved recovered checkout>' -BuildDirectory '<scratch directory>'
```

This compiles both kernels and runs all 74 native core/integration checks. With the local
test dependencies available, the wider offline regression command is:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 --no-file-parallelism --exclude '**/ws*.test.ts'
```

## Limits and next boundary

The authenticated host is an in-memory offline harness. It has no WebSocket listener,
provider adapter, child-process credential boundary, background loop, Evals request or
live CLI. Historical socket frame/rate/backpressure/origin/heartbeat/shutdown containment
has not been reconstructed or verified. The old public server remains a legacy scaffold;
do not treat it as authenticated participant transport. Its queue repair is statically
reviewed and typechecked, but socket behavior was deliberately not exercised.

The replay is for new synthetic offline trials. The original private genesis/evidence,
source commits and spending ledger remain unavailable. Replay checks the caller-supplied
sourceRevision against an expected trusted identifier; it does not independently attest
the running binary or sign the evidence. `fixtureGenesis` uses a clearly labeled fixture
identifier/namespace/secret, not a production credential. Complete tapes contain private
truth and stay outside actor input; no persistent evidence files were created by tests.

Mutable RNG state still requires sole ownership of a running lineage: create a fresh world
from genesis to replay; do not shallow-copy a world and step both copies independently.
Cross-host person migration, production persistence and strategic model behavior are not
implemented or claimed. The full observer is available to the trusted host; the validated
core's fixture callback receives its original minimal context, not a new full-policy API.

`assertLiveAdmission()` remains an unconditional rejection. No new accounting ledger,
settlement or allowance was initialized. The documented US$0.019114 reservation, one
original actor request and nine total documented diagnostic admissions remain historical
facts rather than resettable counters. Any future live transport or paid request is
separate work and requires the unresolved accounting/authentication boundaries to be addressed.
