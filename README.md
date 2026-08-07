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

**Phase 1 (Economic Core), Phase 2's vacancy engine (recalibrated to hit the brief's own §2.4 targets, plus Miller conscription), and the §8 MVP mechanic (two Bakers + a working rumour mill) are built and tested. The client/server scaffold now has real per-player targeted delivery, not pure broadcast.** The Godot client itself is unverified — no Godot binary in the environment that built it; needs someone to open it locally and confirm it runs. Phase 2's raw vacancy dynamics didn't match the brief's own §2.4 claims under a faithful implementation with the brief's literal provisional constants; found the ratio was partly a counting bug, and proved the brief's two §2.4 numbers are structurally incompatible at its literal `t_hard=14` for any `beta`. A joint `(beta, t_hard)` recalibration plus Miller conscription (a new mechanic, mandatory role drafting once NPC coverage runs too long) together close the gap. Separately, a real player-identity primitive now backs the WebSocket server: rumours used to broadcast to every connected client regardless of who they were, defeating the rumour mill's whole point; they're now targeted per-recipient — see `docs/BLUEPRINT.md`.

- `src/engine/` — the chained Cournot (Miller) → Bertrand (Baker) market, the Phase 2 vacancy semi-Markov process (`vacancy.ts`, not yet wired into the market), and two new identity primitives: `player.ts` (binary identity resolution) and `privateStore.ts` (per-player private state with silent TTL expiry). Pure functions, no I/O.
- `src/sim/` — deterministic seeded harnesses + parameter sweeps for the market (`npm run sim`), vacancy (`npm run vacancy-sim`), and Miller conscription (`npm run conscription-sim`).
- `src/comms/` — grammar-constrained Wall/Envelopes (§3.1), rumour mill (§3.2), and a shared decay/distortion primitive (`decay.ts`) extracted from it for reuse by future distance-based systems.
- `src/mvp/` — the §8 scenario (real engine, hardcoded flour price), shared by the CLI runner and the WebSocket server.
- `src/server/` — WebSocket server (`npm run server`) broadcasting shared state (Baker prices, Wall posts) to everyone, but targeting rumours only to the connection identified as their recipient via `?player=<id>`.
- `client/` — Godot 4 scaffold client. See `client/README.md` to run it against the server.
- `test/` — 58 tests across Phase 1 (§1.4 + price-drift fix), Phase 2 vacancy + Miller conscription (structural guarantees and the now-met §2.4 numeric targets), the grammar template table, rumour mill, the decay primitive, the identity/private-store primitives, and a real-socket integration test verifying targeted rumour delivery.

```
npm install
npm test              # 58 tests
npm run sim            # Phase 1 stability-curve sweep to stdout
npm run vacancy-sim     # Phase 2 vacancy sweep to stdout
npm run conscription-sim # Miller conscription sweep (delay x N)
npm run mvp            # two-Baker + rumour-mill scenario, CLI, day-by-day output
npm run server         # WebSocket server for the Godot client to connect to
npm run typecheck
```

Not yet built: real Phase 4 rendering (the current client is plain text, not the isometric/ambient-colour system), Phase 2's integration into the market engine and §2.6 Shift Cover, Phase 5 (voice/safety), Phase 6 (full stress-test harness beyond Phase 1's sweep). The identity primitive unblocks but doesn't yet build the private diary, proximity conversation, or the Oracle. See `docs/HANDOVER.md` for what's next.

There's also substantial not-yet-built design material in `docs/DESIGN_ADDENDUM_2026-08-06.md` (the Oracle, a private diary, proximity conversation — its original exit-ticket gamble section is superseded, see below), `docs/DESIGN_ADDENDUM_2026-08-07.md` (the postcard/tier exit-ticket system that replaces it, plus organic shard-opening — independently verified, see the note at the top), and `docs/ECOSYSTEM_VISION_2026-08-06.md` (what NODE looks like as many shards, not one) — the latter's five standing design constraints are now binding rules in `CLAUDE.md`.
