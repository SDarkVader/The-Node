> Current, 2026-10-18: dependency security repair upgrades Vitest to 4.1.11 with a clean all-dependency npm audit; 1126 Vitest + 80 native = 1206 tests and TypeScript pass. The complete available game-rule corpus has been reviewed against the broker: automatic diary connections/event marking and the restricted trespass transaction are not implemented by the old composed-entry adapter. Both live smoke requests forced diary=null; they do not establish social-game compliance. See [rules review, concrete gaps, acceptance plan and security evidence](docs/recovery/RULES_REVIEW_2026-10-18.md). Work is isolated on broker-rules-security-2026-10-18; main, validated core, earlier checkouts and spending records are preserved.

> Current provider rebuild: the actual Responses wire serializer, bounded verified HTTPS/CONNECT transport, lazy credential reader and separate credential-free mechanical game host are implemented. All 1088 Vitest + 80 native = 1168 checks and TypeScript pass, including real local HTTP/TLS/proxy → accounting → child host → Baker effect → complete replay. A user-approved key is saved only in ignored .env.local; no key is committed or shipped. No model/API diagnostic or paid actor ran. Historical accounting hold/count/liability and the unconditional live gate remain unchanged. See [current provider reconstruction](docs/recovery/PROVIDER_ADAPTER_REBUILD.md). Earlier banners are historical.

> Current broker/accounting rebuild: the interrupted account now has an evidence-preserving recovery ledger, and recorded Responses-shaped completions are accounted before unchanged-core validation and authenticated gameplay admission. Full authorized policy input, durable response claims, cancellation and independent game/accounting crash recovery are implemented. All 1016 Vitest + 80 native = 1096 tests and TypeScript pass. The historical $0.019114 hold and nine combined admissions are carried forward; unknown diagnostics/billing remain unknown. No actual operator settlement, API/key work or live transport. See [current rebuild](docs/recovery/BROKER_ACCOUNTING_REBUILD.md). Earlier status below is historical.

> Latest continuation, 2026-10-17: added a synthetic-only cumulative accounting journal and budgeted in-memory mock adapter. Fifty new tests cover durable reservations, unrefunded counts, unknown holds, idempotent settlement, overruns, crash recovery and independent game/checkpoint failures. Both single-worker and standard two-worker full regressions pass: 926 Vitest + 80 native = 1006 tests, with TypeScript passing. See [synthetic accounting and limits](docs/recovery/SYNTHETIC_ACCOUNTING.md). No real-account ledger was created, historical hold settled, paid allowance granted or core changed; earlier status below is historical.

> Latest development audit, 2026-10-17: audited GitHub reconstruction tip c1238de, preserved its core hardening and merged the local mock-provider history. Fixed fixture attempts/halts being forgotten across checkpoint reopening with version-2 durable execution records; v1 game history is preserved without granting unknown fixture authority. All 876 Vitest + 80 native = 956 tests and TypeScript pass. See [audit](docs/recovery/DEVELOPMENT_BRANCH_AUDIT.md) and [durable fixture recovery](docs/recovery/DURABLE_FIXTURE_RECOVERY.md). Earlier stage status below is historical; original spending remains unresolved and live admission stays closed.

> Latest, 2026-10-17: offline provider contract and mock-to-host integration pass 32 new tests; full verification is 855 Vitest + 74 native = 929 tests, with TypeScript passing. The accounting inventory found a count-label conflict: the support report records nine combined admissions including the original actor attempt; do not add a separate one to nine. No ledger settlement or API access. Work is in a new local branch, broker-provider-offline-2026-10-17. See [mock boundary](docs/recovery/OFFLINE_PROVIDER_BOUNDARY.md) and [accounting inventory](docs/recovery/ACCOUNTING_RECOVERY_INVENTORY.md). Earlier stage status below is historical.

> Current: opt-in durable participant checkpoints and process-crash recovery are implemented. 823 regression tests plus 74 native checks pass; TypeScript passes. Socket admissions wait for durable tick completion. Windows power-loss durability is not claimed. See [checkpoint recovery](docs/recovery/CHECKPOINT_RECOVERY.md). Spending records and validated core remain untouched.

> Current: reviewed, authenticated loopback WebSocket transport is implemented and tested on the reconstruction branch. 802 Vitest tests plus 74 native checks pass; TypeScript passes. No model requests, paid execution or persistent listener. See [local transport review](docs/recovery/LOCAL_TRANSPORT_REVIEW.md). Earlier status below is historical.

> Current: offline participant identity, authenticated in-memory observation/action admission, kernel effects and complete-state replay are reconstructed. 74 native checks and 757 existing offline regression tests pass; TypeScript passes. Live transport/accounting remain disabled or unresolved. See [integration status](docs/recovery/OFFLINE_INTEGRATION_STATUS.md). Earlier recovery notes below are historical.

> Separate offline broker reconstruction: 40 new checks pass; no live provider or participant integration. See [reconstruction status](docs/recovery/BROKER_RECONSTRUCTION.md).

# NODE

*Nobody is fully anonymous here. Nobody is fully known either. Everyone knows
something; nobody knows everything. There's always another shard to run to —
but what the node did together, it did for good.*

There's no combat in NODE. The tension comes from somewhere quieter: you can
never be sure who knows what about you, whether the price you just saw is
real or a message, whether the shop that's been quiet for three days is a
coincidence or a squeeze. A node holds somewhere between 50 and 80 people.
Small enough that everyone is, eventually, someone's business. Big enough
that you'll never actually know all of them.

The world is built to sit permanently a little uphill — never comfortable
for long, never actually collapsing either. If a place ever starts to feel
safe, that's the system telling on itself. Somebody's about to notice.

## Recovery status (2026-10-17)

The running environment restored the original source without the earlier local agent
integration or private spending ledger. [Recovered experiment records](docs/recovery/README.md)
preserve the decisions, protocol, safeguards and known results; they do not claim the
missing code is installed. Revision-3 API credential check still returns **401 invalid_api_key**.
No generation started. Paid agent work is stopped pending secure credential and source/
accounting recovery. Historical 868-test results apply to the missing integration, not this
restored checkout. No game logic was changed during this recovery.

## Status (2026-08-24)

**Live and wired**: the Miller/Baker economic core, the vacancy/backstop
system, role conscription, the grammar-constrained Wall and private diary,
proximity conversation, rumour decay, district weather, identity resolution,
role-holder occupancy, the Oracle, universal housing with reputation gating,
and a real multi-shard registry. The economy tracks wealth (Gini coefficient
plateaus around 0.5, stays stable), Courier pay indexes actual distance, and
role completion is uniformly tested across all five roles (Journalist and Detective merged
into Investigator, 2026-08-22). 780 tests cover all of it.

**The basic day (2026-08-24)**: offline downtime and Import/Export supply now
have real UTC-anchored windows (twice daily each) instead of one blended
number — see `docs/BLUEPRINT.md` §2/§4. The live server's own tick cadence
isn't wall-clock-anchored yet; that's the deliberate next step.

**Action vocabulary (2026-08-24)**: the inbound pipe now interprets three real
actions — Wall posting, diary entries, proximity conversation — gated to a
connection's bound identity. Everything else (Miller/Baker's price/quantity,
the other three roles) still has no real player-input slot in the engine;
see `docs/BLUEPRINT.md` §9.

**Presence/session primitive (2026-08-24)**: `World` now tracks real
online/offline state per role-holder, fed from the live server's actual
connections — the foundation the login-buffer, Shift Cover, trespass, and
arson designs all depend on. Deliberately withheld from the wire (same
privacy boundary as wealth).

**Trespass and arson eligibility (2026-08-25)**: both now wired onto real
presence data. Building arson's caught a real bug before it shipped — a
first draft mirroring trespass's own pattern turned out to be provably
always-false, since presence only tracks people arson's gate is designed
to exclude. Fixed by resolving each signal independently rather than
gating the whole function on one. Both still share the same open gap:
no per-player abode-location tracking exists anywhere in the engine, so
that half of each gate stays caller-supplied — see `docs/BLUEPRINT.md` §9.

**Visual (Godot 4.3)**: isometric 3D rendering with real settlement geometry.
Role-holders occupy their buildings (not drawn on street), marked by glyphs
above roofs. Streets carry district tension as color (blue–Ember–red). Stations
glow with economic heat (radius and intensity encode occupancy state). Courier
routes show as ribbons from stations to the hub. Watch it run with `npm run
playtest` (terminal, synthetic drivers) or connect the Godot client to `npm
run server`.

**Inbound pipe (2026-08-19)**: WebSocket now receives client actions. Parser
is defensive—malformed frames drop without killing the connection. Action
vocabulary is deliberately undesigned; the grammar belongs to a later session.
Queue caps at 256 actions/tick.

**What's next**: design the action vocabulary (players interacting with the
world), then wire it into the simulation.

## How to run it

```bash
npm install
npm test                # 714 tests

npm run server          # Real world over WebSocket
npm run playtest        # Terminal render with synthetic drivers
npm run typecheck
```

**With the Godot client:** See [`client/README.md`](client/README.md) for
setup. The client connects to `npm run server` and renders the live world.

## Where things are

**Architecture**: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — what's built now
(constants, state shape, data flow, invariants). [`docs/HANDOVER.md`](docs/HANDOVER.md)
— fast orientation, current state, open work.

**History**: [`docs/DEVLOG.md`](docs/DEVLOG.md) — build log, session by session,
including failures. [`docs/NODE_Build_Brief_v1.pdf`](docs/NODE_Build_Brief_v1.pdf)
— the original design intent (§0 is load-bearing).

**Repo layout**: `src/engine/` (pure mechanics), `src/world/` (the kernel),
`src/server/` (WebSocket), `client/` (Godot), `test/` (714 tests).
