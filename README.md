# The-Node
A world where human interaction, relationships, disputes and conflict resolutions are never certain. Information is both enemy and your friend. It's up to you to navigate and find your place in order to thrive in The Node, or lose alliances and community standing? There's always another shard to discover, but the past is immortal.

## Design brief

Full build spec: [`docs/NODE_Build_Brief_v1.pdf`](docs/NODE_Build_Brief_v1.pdf). Build order and design intent (§0) are load-bearing — read that before touching any phase past what's built here.

## Documentation

This section is the current-state snapshot; for detail see:

- [`docs/HANDOVER.md`](docs/HANDOVER.md) — start here, fast orientation for picking up work.
- [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — system architecture as actually implemented.
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — chronological build log, including failures and dead ends.

## Status

**Phase 1 (Economic Core) is built and tested. The §8 MVP mechanic — two Bakers plus a working rumour mill — is also built and tested.** Everything still runs headless (CLI + tests only) — no server, client, or persistence yet.

- `src/engine/` — the chained Cournot (Miller) → Bertrand (Baker) market, pure functions, no I/O.
- `src/sim/` — deterministic seeded harness + parameter sweeps (`npm run sim` prints a stability-curve table).
- `src/comms/` — grammar-constrained Wall/Envelopes (§3.1) + rumour mill (§3.2).
- `src/mvp/run.ts` — the §8 scenario: two Bakers on the real engine, hardcoded flour price, price shocks trigger Wall posts that propagate through connected players (`npm run mvp`).
- `test/` — 21 tests: Phase 1's §1.4 regression findings, the grammar template table's structural constraints, and rumour mill propagation/decay/distortion behavior.

```
npm install
npm test         # 21 tests
npm run sim      # Phase 1 stability-curve sweep to stdout
npm run mvp      # two-Baker + rumour-mill scenario, day-by-day output
npm run typecheck
```

Not yet built: Phase 2 (vacancy/churn/backstop), Phase 4 (camera/identity/ambient visuals — rendering entirely, not just the isometric parts), Phase 5 (voice/safety), Phase 6 (full stress-test harness beyond Phase 1's sweep). The next real decision is what the playable surface is (client/hosting/persistence) — see `docs/HANDOVER.md`.
