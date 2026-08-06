# The-Node
A world where human interaction, relationships, disputes and conflict resolutions are never certain. Information is both enemy and your friend. It's up to you to navigate and find your place in order to thrive in The Node, or lose alliances and community standing? There's always another shard to discover, but the past is immortal.

## Design brief

Full build spec: [`docs/NODE_Build_Brief_v1.pdf`](docs/NODE_Build_Brief_v1.pdf). Build order and design intent (§0) are load-bearing — read that before touching any phase past what's built here.

## Status

**Phase 1 — Economic Core** (Miller/Baker reaction engine, §1) is implemented and tested, headless, per the brief's build order. Nothing player-facing exists yet.

- `src/engine/` — the chained Cournot (Miller) → Bertrand (Baker) market, pure functions, no I/O.
- `src/sim/` — deterministic seeded harness + parameter sweeps (`npm run sim` prints a stability-curve table).
- `test/market.regression.test.ts` — encodes the §1.4 validated findings (γ=2 boundary, the n=2 instability cliff, Miller-vs-Baker headcount effects) as regression tests, per the brief's own instruction to preserve these across refactors.

```
npm install
npm test        # regression tests
npm run sim      # prints a stability-curve sweep to stdout
npm run typecheck
```

Not yet built: Phase 2 (vacancy/churn/backstop), Phase 3 (Wall/Envelopes/rumour mill), Phase 4 (camera/identity/ambient visuals), Phase 5 (voice/safety), Phase 6 (full stress-test harness). Per §8, the next milestone is the two-Baker + rumour-mill MVP, which needs a slice of Phase 3 and Phase 4 on top of what's here.
