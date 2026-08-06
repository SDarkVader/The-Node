# NODE client (scaffold)

Godot 4.3+ project. Proves the client/server wire-up for the §8 MVP scenario — not the
real Phase 4 renderer (no isometric scene, no ambient colour system, no fog-of-recognition
yet). See `docs/BLUEPRINT.md` at the repo root for what this is and isn't.

**Not yet verified in the Godot editor** — this environment has no Godot binary/GUI, so
these files were written by hand against Godot 4 GDScript/scene syntax but never actually
opened or run. Open it locally and report back what happens, especially if the editor
throws a parse error on first load.

## Run it

1. From the repo root: `npm run server` (starts the WebSocket server on `ws://127.0.0.1:8080`, ticking every 2.5s by default — see `src/server/ws.ts` for env vars to change the port/interval).
2. Open `client/project.godot` in Godot 4.3 or later.
3. Run the main scene (F5). It should show "Connecting...", then "Connected", then start printing Baker prices and Wall/rumour activity as the server ticks.

## Layout

- `project.godot` — project config. Renderer is set to GL Compatibility for broad PC + mobile device support; revisit once Phase 4's ambient lighting (§4.5) needs Forward+/Mobile-only features.
- `scenes/Main.tscn` — root scene: a Control with a status label, a prices label, and a scrolling log.
- `scripts/Main.gd` — connects via Godot's built-in `WebSocketPeer`, parses the server's JSON tick messages, updates the UI. No addons required.
