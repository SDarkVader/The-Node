# NODE — Godot client (PC)

Renders the live settlement from the running simulation. Two processes: the Node server holds
the world and ticks it, Godot connects over a WebSocket and draws what it is told.

**Status**: verified running against a real server on Godot 4.3 — connects, parses geometry
and ticks, and `_draw` executes with the full settlement under a real OpenGL renderer, no script
errors. It was also screenshotted and looked at, which caught three things reading the code did
not: the window background was Godot's default grey rather than Ember's ground tone (the `GROUND`
constant was declared and never applied), the town rendered too small to read, and the Wall did
not stand out from ordinary buildings. All three are fixed.

The six role icons are drawn procedurally in `WorldView.gd` (`_draw_role_icon`) rather than
shipped as art, so the client stays self-contained with no import step: windmill, loaf, parcel,
page, magnifier, and two passing arrows. They mean the job rather than spelling its initial — a
letter is a label, a shape is an identity.

Rendering was then pushed further, each step screenshotted and checked rather than assumed:
heat moved out of flat per-box tint into an **additive emissive field** (flat boxes read as a
spreadsheet; overlapping glows read as a town), the ground wash stopped being a hard rectangle,
emotional weather became a **diverging blue↔Ember↔red** scale anchored on measured percentiles,
and **the Wall's Emissive Soul** — specified since 2026-08-12, never built — now carries shard
health as hue.

Still unverified by anyone but me: whether it *feels* right to move around in, and the per-role
palette, which is a first proposal rather than a derived decision.

## What you need

- **Godot 4.3+**, standard build (not .NET/Mono — there is no C# here). https://godotengine.org
- **Node 20+** and this repo's deps: `npm install` at the repo root.

## Run it

Two terminals, both at the repo root.

**1 — the world:**
```
npm run server
```
Expect: `NODE ws server listening on :8080 (tick every 2500ms, real world)`.
It ticks one simulated day every 2.5s. Nothing is persisted; restarting gives a fresh shard.

Useful knobs:
```
NODE_TICK_MS=500 npm run server     # faster days
NODE_WS_PORT=9000 npm run server    # different port (also change SERVER_HOST in WorldView.gd)
NODE_LEGACY_MVP=1 npm run server    # the old two-Baker scenario, for scenes/Main.tscn
```

**2 — the client:**

Open Godot → **Import** → select `client/project.godot` → **Import & Edit** → press **F5**
(or the ▶ play button).

The main scene is already set to `scenes/WorldView.tscn`. If Godot asks you to pick one, choose
that; `scenes/Main.tscn` is the older MVP-scenario scaffold and expects `NODE_LEGACY_MVP=1`.

## Controls

- **Left-drag** — pan
- **Mouse wheel** — zoom (clamped 0.25×–4×)
- Top-left readout — day, economic health, mean tension, live population

## What you are looking at

| On screen | What it is |
|---|---|
| Pale gold block, centre | **The Wall** (the hub). Always bright and intact, whatever the shard's state — that is deliberate. |
| Ochre tiles | Plaza |
| Dark brown tiles | Streets and open ground |
| Squares with a coloured border | **Stations.** The box is structure only — border is the role. How busy it is comes from the glow, not the box. |
| Emissive glow, amber → white core | **Economic heat.** Radius AND intensity both scale with it, so a hot station is obvious at a glance. Glows blend additively, so a cluster reads as one bright region. |
| A dark, unlit box | A genuinely cold station. Contrast comes from cold being dark — that is what makes hot mean something. |
| Dimmer glow | `BACKSTOPPED` (half) or `VACANT` (28%). Quieter, never broken. |
| Flat grey-brown squares | Buildings with no role slot — housing only. 16 of 62 in the shipped config. |
| Warm dot under a floating icon | A role-holder |
| Plain pale dot, no glyph | A roleless player (grifter). No glyph because they hold no role — but the same size and brightness as anyone else. |
| Soft ground field: **blue → Ember → red** | District tension. Diverging, not a ramp — cold blue when unusually calm, Ember at the normal state, red when tense. |
| Gold disc + bar, one cell, centre | **The Wall.** Circular substrate with a bar across it, occupying only its own cell at 3/4 of a cell wide. The gold **never changes** — that is the hope, and it is structural. |
| The halo around it, gold → amber → red | **The Wall's sentiment.** The radiance, not the monument, carries how the node is doing. A shard in crisis shows a red glow around an unchanged gold Wall. Anchored on measured health: p05 0.857 / median 0.909 / p95 0.948. |
| Small icon in a station's top-left | That building's **role**, hung like a shop sign — quiet, because a building's role never changes. |
| Icon floating above a person | That player's **role**, carried with them. Same glyph as their station, so a Bakery and a Baker read as the same thing. |

**Heat** auto-ranges against its observed maximum (~0.5). **Tension** uses a diverging scale
anchored on its real measured distribution — p05 0.03, median 0.06, p95 0.10, from 5600
district-day samples. The old 0.25 ceiling left the town permanently in the bottom third of the
range, always reading calm; anchoring on the real median means the ordinary state of the node
looks like the node, and genuine swings in either direction are visible.

## Verify without opening a window

The client prints two diagnostic lines on connect, so a headless run is a real smoke test —
it proves the socket connected, the JSON parsed, and geometry landed:

```
godot --headless --path client --quit-after 300
```
Expect:
```
[NODE] geometry: 62 buildings, 91 plots, hub (0,0)
[NODE] first tick: day 12, 67 people, 46 stations, health 0.98
```
`--quit-after` matters: without it, killing the process can discard buffered output and make a
working client look silent. Headless does not call `_draw`, so this checks the wiring, not the
rendering. To exercise drawing without a monitor, run it under a virtual display instead
(`xvfb-run -a godot --path client --quit-after 300`).

## If it does not work

- **"Disconnected — is `npm run server` running?"** — the server is not up, or is on another
  port. `SERVER_HOST` is at the top of `scripts/WorldView.gd`.
- **Connects but nothing draws** — the `hello` message did not arrive or did not parse. Check
  the Godot **Output** panel; `_handle_hello` is where geometry lands.
- **Everything is one colour** — likely auto-ranging, not a bug. Check the readout's tension
  value; if it is ~0.07 the town genuinely is calm.
- **Runtime type errors on numbers** — JSON numbers always parse as `float` in GDScript. Any
  field assigned into a declared `int` needs an explicit `int()` cast. There are casts already
  where they are needed; a new field you add will need one too.

## Where things live

```
client/scripts/WorldView.gd     the renderer + socket client
client/scenes/WorldView.tscn    Node2D + Camera2D + HUD label
src/server/ws.ts                startWorldServer — sockets, timers, per-connection secrets
src/server/worldProtocol.ts     what may go on the wire (READ THIS BEFORE CHANGING IT)
```

`worldProtocol.ts` is a privacy boundary, not a serialization detail. Geometry and ambient mood
are public; wealth, experience, Gini, diary contents and in-flight sabotage campaigns are
withheld; people appear only under a per-connection pseudonymous `handle`, so two clients cannot
compare notes to unmask anyone. Its header explains each decision — worth reading before adding
a field, because "just send the whole world" quietly breaks the Silhouette Shield.

## Known gaps

- No player avatar. You watch the town; you are not in it yet.
- Movement is sim-side only — the shipped `stepWorld` does not move role-holders, so people will
  mostly sit at their stations. `npm run playtest` (terminal) drives them via synthetic drivers.
- Per-role colours are a **first proposal**, chosen in `WorldView.gd`, not derived from anything
  in the engine. No per-role hue exists in code yet.
- Identity resolution (`identityResolved`) is built and tested server-side but nothing sends it —
  it needs per-connection observer state that does not exist yet. So every body stays a
  silhouette.
