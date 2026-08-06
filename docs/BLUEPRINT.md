# System Blueprint

Living document — describes what's actually built, not what's planned. Update this
whenever architecture changes, a brief §7 open question gets resolved, or a mechanic
deviates from `NODE_Build_Brief_v1.pdf`. Aspirational/not-yet-built work belongs in
`HANDOVER.md`'s "what's next," not here.

## Design intent (from the brief, §0 — do not drift from this)

Persistent multiplayer social-economic game, ~50–80 players per node. No combat — tension
comes from asymmetric information, structural economic pressure, and partial anonymity.
"49-51" philosophy: the system stays permanently, slightly tilted — never comfortable,
never collapsing. Any mechanic trending toward comfortable equilibrium or catastrophic
collapse has drifted from intent and should be flagged, not shipped.

## Phase status

| Phase | Contents | Status |
|---|---|---|
| 1 | Economic core (Miller/Baker reaction engine) | **Built, tested** |
| 2 | Vacancy, churn, backstop system | Not started |
| 3 | Communication layer (Wall, Envelopes, rumour mill) | Not started |
| 4 | Identity, camera, ambient visual system | Not started |
| 5 | Voice & safety architecture | Not started |
| 6 | Stress-testing & balance harness | Partial — sweep utility exists (`src/sim/sweep.ts`), not yet the full §6 sweep surface (only covers Phase 1 params: nMillers, nBakers, gamma; doesn't yet cover N, R, vacancy params since those don't exist yet) |

## Repo layout

```
src/engine/     Pure market simulation functions. No I/O, no randomness source of its own
                (noise is injected via a callback) — deterministic given its inputs.
  millers.ts    Cournot quantity layer (§1.2) + inverse-demand flour price.
  bakers.ts     Bertrand price layer (§1.3), fed by flour price.
  market.ts     Chains the two into one tick (§1.1); owns MarketState/MarketConfig shape.
  util.ts       clip/mean/spread helpers.

src/sim/        Everything that needs randomness or orchestrates the engine over time.
  rng.ts        Seeded PRNG (mulberry32) + gaussian sampler. All simulation randomness
                flows through here so runs are reproducible from a seed.
  harness.ts    runMarket() — runs N days headless, returns full state history +
                derived spread series. tailAverage() — steady-state metric after burn-in.
  sweep.ts      sweepStability() — grid-sweeps headcounts/gamma, returns stability points.
  cli.ts        `npm run sim` entry point; prints a sweep table to stdout.

test/           Regression tests. market.regression.test.ts encodes the brief's §1.4
                findings as assertions (see below) — these are "hard truth," not tunable.

docs/           This file, DEVLOG.md, HANDOVER.md, NODE_Build_Brief_v1.pdf.
```

## Phase 1 — Economic Core

### Data flow

```
MarketConfig (nMillers, nBakers, gamma, noiseSigma, rng)
        |
        v
initMarket() -> MarketState { day, millerQ[], bakerP[], flourPrice }
        |
        v  (each day)
stepMarket(state, config):
  1. stepMillers(millerQ, noise)         Cournot best-response toward (1 - avg rival q)
  2. flourPrice(sum(millerQ))            inverse demand, clip [0.05, 2.0]
  3. stepBakers(bakerP, flourPrice, gamma, noise)   Bertrand best-response + cost passthrough
        |
        v
  new MarketState
```

`stepMillers`/`stepBakers` both require `n >= 2` (the reaction function divides by `n-1`)
and throw otherwise — this isn't a validated input path, it's a structural precondition
matching the brief's own framing of role slots always having >=2 holders.

### Key equations (as implemented, matches brief §1.2/§1.3 verbatim)

- Miller: `q_i(t+1) = clip(0.5*q_i(t) + 0.5*(1 - avg_rival_q_i) + noise, 0.01, 1)`
- Flour price: `clip(1.2 - 0.3*total_supply, 0.05, 2.0)` — `[CALIBRATED — provisional]`
- Baker: `p_i(t+1) = clip((1-gamma/2)*p_i(t) + (gamma/2)*avg_rival_p_i + flourPrice*0.3*0.1 + noise, 0, 2)`

### Noise magnitude — a gap the brief left open

The brief specifies `+ noise` in both reaction functions without a magnitude. Implemented
as `gaussian(rng, noiseSigma)` with `noiseSigma` defaulting to `0.01` in the harness
(`DEFAULT_NOISE_SIGMA` in `harness.ts`). Treat this the same as the brief's other
`[CALIBRATED — provisional]` constants — expect to retune once real players exist. It does
not affect the qualitative regression findings below, which are about stability boundaries,
not exact magnitudes.

### Regression-tested findings (§1.4 — preserve these across refactors)

Verified against the actual implementation (not just design reasoning) in
`test/market.regression.test.ts`:

1. **Gamma boundary is 2, not 0.85.** n=2 baker slot is stable for gamma up to and
   including 2.0; blows up (spread > 0.3, saturates toward the [0,2] clip bound) once
   gamma exceeds 2. The earlier-rejected 0.85 threshold shows no instability at all.
2. **Instability is a headcount property.** The exact same gamma (2.5) that destabilizes
   a 2-player role slot leaves a 3- or 4-player slot stable — confirms the brief's "never
   let a role slot sit at exactly n=2" design implication empirically, not just by assertion.
3. **Miller headcount drives volatility, not Baker headcount.** More millers -> lower
   steady-state flour price and higher baker-side price spread. Baker headcount (3 vs 5)
   changes both metrics by less than 0.01 in absolute terms — i.e., noise-floor level,
   confirming "barely changes outcomes" from the brief.

Simulation methodology: seeded (`seed=42`, deterministic), 400 days, first 200 days
discarded as burn-in before averaging. If you change the noise model, the reaction
equations, or the burn-in/day count, re-verify these hold — they're checked automatically
by `npm test` either way.

## Open deviations from the brief

None yet. Nothing in Phase 1 required deviating from the equations as specified.

## Brief §7 open questions — still unresolved (do not silently resolve)

All of them — nothing past Phase 1 is built yet. Ruin Floor (`R(t)`), density numbers,
binary-vs-gradual identity resolution, exact colour palette, ripple decay-weight variance,
City Wall/ambient integration, and all of §5.2's legal specifics remain open per the brief.
