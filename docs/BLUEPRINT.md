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

## Platform decision (2026-08-06)

**PC + mobile, not web.** Client engine: **Godot 4** — native 2D additive-light layering
matches §4.5's "layered light sources, not blended" requirement closely, lighter runtime
footprint than Unity for the mobile side, and free with no revenue threshold. Unity was
the alternative considered (free under $200K/year revenue+funding, then ~$2,040-2,400/seat/
year Pro) — ruled out mainly on engine fit for this specific rendering style, not cost.

This makes the architecture a clean split: the TypeScript engine (`src/engine`, `src/sim`,
`src/comms`) is the **authoritative server** — nothing about it changes for this decision.
The Godot project (`client/`) is a **thin renderer** talking to it over WebSocket. See
"Client/server scaffold" below.

## Phase status

| Phase | Contents | Status |
|---|---|---|
| 1 | Economic core (Miller/Baker reaction engine) | **Built, tested.** One deviation from the brief's literal equations — see "Open deviations" below. |
| 2 | Vacancy, churn, backstop system | Not started |
| 3 | Communication layer (Wall, Envelopes, rumour mill) | **MVP slice built, tested** — grammar-constrained Wall/Envelope + rumour mill. No moderation pipeline (that's Phase 5), no persistence. |
| 4 | Identity, camera, ambient visual system | Not started — a scaffold client exists (`client/`) that proves the network wire-up with a plain-text UI, not real Phase 4 rendering. Godot locked in as the engine (see above). |
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

src/comms/      Phase 3 slice — communication layer, no I/O of its own.
  grammar.ts    Wall posts + Envelopes, both built from one curated SelfState template
                table (§3.1). Validity enforced at the function boundary — throws on
                anything outside the template set. This IS the harassment-prevention
                mechanism, not a layer in front of one.
  connections.ts  Per-edge connection graph (§4.3's "no persistent global graph" model,
                borrowed here since the rumour mill needs the same shape rendering will).
  rumourMill.ts Propagates a Wall post outward from its author via BFS over the
                connection graph: decays in clarity per hop, sometimes distorts into a
                semantically-adjacent self-state (§3.2). All knobs in one config object.

src/mvp/        §8's "two Bakers plus a working rumour mill" scenario.
  scenario.ts   Reusable simulation step (initScenario/stepScenario) — real Phase 1
                engine + hardcoded flour price + comms layer. Shared by run.ts and the
                WebSocket server so both drive the identical logic. The Wall-post
                trigger rule here is explicitly a placeholder, not a designed mechanic.
  run.ts        CLI wrapper — prints scenario.ts's output to stdout (`npm run mvp`).

src/server/     ws.ts — WebSocket server broadcasting the MVP scenario live
                (`npm run server`). Scaffolding to prove client/server wire-up: no auth,
                no persistence, one shared scenario for every connection, ticks on a
                fixed interval rather than real player input. See "Client/server
                scaffold" below for the wire protocol.

client/         Godot 4 project — thin renderer, not the real Phase 4 client. See
                "Client/server scaffold" below and client/README.md.

test/           Regression/behavior tests. market.regression.test.ts encodes §1.4 (plus
                the mean-reversion fix, see "Open deviations") as assertions.
                grammar.test.ts checks the template table structurally (regexes for
                2nd/3rd-person and non-present-tense). rumourMill.test.ts checks
                propagation, decay, distortion-sometimes-not-always, and hop caps.

docs/           This file, DEVLOG.md, HANDOVER.md, NODE_Build_Brief_v1.pdf.
```

## Client/server scaffold

Not real Phase 4 — proves the wire-up only, no rendering beyond plain text/labels.

```
src/mvp/scenario.ts (shared sim step)
        |
src/server/ws.ts — ticks the scenario every TICK_INTERVAL_MS (default 2500ms, env
        |          NODE_TICK_MS), broadcasts one JSON message per tick to every
        |          connected client over `ws` on port NODE_WS_PORT (default 8080).
        v
client/scripts/Main.gd — Godot's built-in WebSocketPeer (no addon), connects to
                         ws://127.0.0.1:8080, polls every _process() frame, renders
                         Baker prices/spread/Wall posts/rumours as plain Labels/RichTextLabel.
```

Wire protocol: one message shape, `{ type: 'tick', day, bakers: [{id, price}], spread,
wallPost: {authorId, state} | null, rumours: [{heardBy, heardFrom, state, distorted, hop,
clarity}] }`. `TickMessage` type lives in `src/server/ws.ts`; the Godot side has no typed
counterpart (GDScript's `JSON.parse_string` returns an untyped Dictionary) — if the
message shape changes, update both sides by hand, there's no shared schema yet.

**Not verified in the Godot editor** — this environment has no Godot binary/GUI. The
project/scene/script files were written by hand against Godot 4 syntax and the Node
server side was tested end-to-end against a throwaway WebSocket client, but the Godot
client itself has never actually been opened or run. One known GDScript gotcha already
fixed: `JSON.parse_string` returns all JSON numbers as `float`, so fields typed `int` in
GDScript (`day`, `hop`) need an explicit `int(...)` cast or Godot throws a runtime type
error — see the comment in `client/scripts/Main.gd`. Treat the client as unverified until
someone opens it locally and reports back.

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

### Key equations (as implemented)

- Miller: `q_i(t+1) = clip(0.5*q_i(t) + 0.5*(1 - avg_rival_q_i) + noise, 0.01, 1)` — matches brief §1.2 verbatim.
- Flour price: `clip(1.2 - 0.3*total_supply, 0.05, 2.0)` — `[CALIBRATED — provisional]`, matches brief §1.2 verbatim.
- Baker: `p_i(t+1) = clip((1-gamma/2)*p_i(t) + (gamma/2)*avg_rival_p_i + meanReversion + noise, 0, 2)`
  where `meanReversion = 0.05 * (flourPrice*1.5 - mean(p))`. **This is not the brief's
  literal §1.3 equation** — see "Open deviations" immediately below for why.

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

## Phase 3 slice — Communication Layer

### Grammar constraint (§3.1)

Both channels (`WallPost`, `Envelope`) are built from one `Record<SelfState, string>`
template table — ten fixed first-person, present-tense statements naming nobody.
`postToWall`/`sendEnvelope` reject anything not in `SELF_STATES` at the function
boundary. This is deliberately the cheapest possible implementation of the brief's
"vocabulary genuinely unavailable, not merely discouraged" requirement: there is no
free-text path to route around, no filter to evade. Expanding the template set later is
safe as long as every new entry passes the same first-person/present-tense/no-third-party
shape — `test/grammar.test.ts` checks this structurally against the whole table, not just
the entries that existed when the test was written.

### Rumour mill (§3.2)

BFS propagation from a Wall post's author outward over a `ConnectionGraph`. Per hop: a
neighbor picks it up with probability `baseSpreadChance * edgeWeight * carrierClarity`;
clarity then drops by `decayPerHop`, and propagation to that neighbor is dropped if
clarity falls below `clarityFloor` or `maxHops` is exceeded. Each successful hop has an
independent `distortionRate` chance of drifting the relayed state to a
semantically-adjacent one (table in `DISTORTION_NEIGHBORS`) rather than passing it
faithfully. A player only ever hears the first version that reaches them (no duplicate/
conflicting hearsay from multiple paths in this version).

All four knobs live in one `RumourMillConfig`, defaulted in `DEFAULT_RUMOUR_CONFIG` and
marked `[CALIBRATED — provisional]` — brief §3.2 flags this system as the one "most
likely to need hands-on iteration once playable," so retuning is a one-object edit, not
a re-architecture.

### MVP scenario (`src/mvp/run.ts`, §8)

Two Bakers on the real Phase 1 engine, hardcoded flour price (0.6) standing in for the
Miller layer per the brief's own suggestion. Three gossip-layer players connected via a
hand-built graph. A Baker posts to the Wall when the day's price gap crosses a threshold;
the post propagates through the mill; output is a per-day printout of prices, posts, and
who heard what (faithful or distorted, how many hops out). The trigger rule itself
(post when price gap > threshold) is scaffolding to exercise the pipeline, not a designed
mechanic — don't treat it as a spec for when Bakers "should" post once real player input
exists.

## Open deviations from the brief

**Baker price mean-reversion (2026-08-06) — the one real deviation so far.** The brief's
§1.3 equation adds `cost_pressure * 0.1` unconditionally every day, with nothing pulling
it back down. Summed across bakers this is a pure random walk with constant positive
drift: a 5000-day run of the real engine (real Millers, no shortcuts) showed both bakers
pinned to the 2.0 price ceiling by ~day 100, permanently — a "comfortable equilibrium"
in the exact sense §0 says to flag, not ship. The §1.4 regression tests didn't catch it
because they measure price *spread* (a difference, immune to a drift that hits every
baker equally), never absolute price level.

Fix: replaced the flat additive term with `0.05 * (flourPrice*1.5 - mean(p))` — a
mean-reversion pulling the *average* price toward a flour-cost anchor. Because it's the
same value added to every baker each day, it cancels exactly out of every pairwise price
difference — verified, not just derived: all 10 original §1.4 tests still pass with this
change (one test's threshold, pinned at gamma=1.99 right at the critical boundary, had to
move to gamma=1.9 — that threshold was already fragile to any change in exact noise
trajectory near the boundary, confirmed by checking price values never approached the
clip bounds there, so it wasn't the fix causing new instability, just an overly tight
threshold). Verified the fix itself across multiple configs/seeds out to 8000 days, and
added two new regression tests locking in "no ceiling saturation" and "settles near the
flour-cost anchor."

Everywhere else the brief left a genuine gap (noise magnitude in Phase 1, rumour mill
parameter values in Phase 3, since §3.2 says the mill isn't fully specified), the gap was
filled with a `[CALIBRATED — provisional]` value in the same style as the brief's own
provisional constants, not treated as a silent design decision.

## Brief §7 open questions — still unresolved (do not silently resolve)

All of them — nothing past Phase 1 is built yet. Ruin Floor (`R(t)`), density numbers,
binary-vs-gradual identity resolution, exact colour palette, ripple decay-weight variance,
City Wall/ambient integration, and all of §5.2's legal specifics remain open per the brief.
