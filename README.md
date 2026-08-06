# The-Node
A world where human interaction, relationships, disputes and conflict resolutions are never certain. Information is both enemy and your friend. It's up to you to navigate and find your place in order to thrive in The Node, or lose alliances and community standing? There's always another shard to discover, but the past is immortal.

## Design brief

Full build spec: [`docs/NODE_Build_Brief_v1.pdf`](docs/NODE_Build_Brief_v1.pdf). Build order and design intent (§0) are load-bearing — read that before touching any phase past what's built here.

## Documentation

This section is the current-state snapshot; for detail see:

- [`docs/HANDOVER.md`](docs/HANDOVER.md) — start here, fast orientation for picking up work.
- [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — system architecture as actually implemented.
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — chronological build log, including failures and dead ends.

## Platform

**PC + mobile, client in Godot 4.** The TypeScript engine in this repo is the authoritative server; the Godot project in `client/` is a thin renderer talking to it over WebSocket. Decided 2026-08-06 — see `docs/BLUEPRINT.md` for why.

## Status

**Phase 1 (Economic Core) and the §8 MVP mechanic (two Bakers + a working rumour mill) are built and tested. A client/server scaffold proves the network wire-up.** The Godot client itself is unverified — no Godot binary in the environment that built it; needs someone to open it locally and confirm it runs.

- `src/engine/` — the chained Cournot (Miller) → Bertrand (Baker) market, pure functions, no I/O.
- `src/sim/` — deterministic seeded harness + parameter sweeps (`npm run sim` prints a stability-curve table).
- `src/comms/` — grammar-constrained Wall/Envelopes (§3.1) + rumour mill (§3.2).
- `src/mvp/` — the §8 scenario (real engine, hardcoded flour price), shared by the CLI runner and the WebSocket server.
- `src/server/` — WebSocket server broadcasting the MVP scenario live (`npm run server`).
- `client/` — Godot 4 scaffold client. See `client/README.md` to run it against the server.
- `test/` — 24 tests: Phase 1's §1.4 regression findings (plus a price-drift fix, see `docs/BLUEPRINT.md`), the grammar template table's structural constraints, and rumour mill propagation/decay/distortion behavior.

```
npm install
npm test         # 24 tests
npm run sim      # Phase 1 stability-curve sweep to stdout
npm run mvp      # two-Baker + rumour-mill scenario, CLI, day-by-day output
npm run server   # WebSocket server for the Godot client to connect to
npm run typecheck
```

Not yet built: real Phase 4 rendering (the current client is plain text, not the isometric/ambient-colour system), Phase 2 (vacancy/churn/backstop), Phase 5 (voice/safety), Phase 6 (full stress-test harness beyond Phase 1's sweep). See `docs/HANDOVER.md` for what's next.
