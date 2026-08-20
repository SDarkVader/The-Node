# NODE — Godot client (PC)

Renders the live settlement from the running simulation. Two processes: the Node server holds
the world and ticks it, Godot connects over a WebSocket and draws what it is told.

**Status, stated plainly**: this client was written in an environment with no Godot installed,
so it has never been visually verified. The wire protocol is checked automatically
(`test/clientProtocolConformance.test.ts` fails if the client reads a field the server does not
send, and that check is itself mutation-tested), but whether the town *looks* right is unknown
until someone opens it. Expect to adjust `CELL`, `BUILDING_SIZE` and the role palette by eye.

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
| Squares, blue→amber | **Stations.** Colour is economic heat: blue-grey is cool, amber is hot. Thin border = role hue. |
| Dimmer squares | `BACKSTOPPED` (half brightness) or `VACANT` (28%). Quieter, never broken. |
| Flat grey-brown squares | Buildings with no role slot — housing only. 16 of 62 in the shipped config. |
| Warm dots with a coloured ring | Role-holders, ring = their role |
| Pale cream dots | Grifters (roleless players) |
| Background wash, near-black → dark red | District tension |

Both mood signals **auto-range** against observed maxima (heat ~0.5, tension ~0.25) rather than
a literal 0–1 scale. Real measured tension sits around 0.06–0.08, so a naive mapping renders the
whole town permanently flat and calm. Same discipline as the terminal renderer.

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
