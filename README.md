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

## Status (2026-08-21)

**Live and wired**: the Miller/Baker economic core, the vacancy/backstop
system, role conscription, the grammar-constrained Wall and private diary,
proximity conversation, rumour decay, district weather, identity resolution,
role-holder occupancy, the Oracle, universal housing with reputation gating,
and a real multi-shard registry. The economy tracks wealth (Gini coefficient
plateaus around 0.5, stays stable), Courier pay indexes actual distance, and
role completion is uniformly tested across all six roles. 714 tests cover all
of it.

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
