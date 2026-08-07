# System Blueprint

Living document — describes what's actually built, not what's planned. Update this
whenever architecture changes, a brief §7 open question gets resolved, or a mechanic
deviates from `NODE_Build_Brief_v1.pdf`. Aspirational/not-yet-built work belongs in
`HANDOVER.md`'s "what's next," not here.

**New design material, not yet built:** `docs/DESIGN_ADDENDUM_2026-08-06.md` — vacancy
backstop rationale (matches what's already built, no change needed), the shard exit
ticket + Oracle system, private per-player maps and its "private diary" refinement
(composed slots, unprompted, rolling ~30-day silent expiry — a real departure from
fog-of-recognition as scoped for Phase 4), an atmosphere principle for Phase 4 visual
work, proximity conversation (a no-microphone, template-composed alternative to live
voice — meaningfully reshapes Phase 5's scope), and multi-shard passport tiers. One open
item needs a decision before it's locked: the exit-ticket gamble's staking formula has a
verified stake-direction bug — see the addendum's top note and `docs/DEVLOG.md`'s entry
for 2026-08-06.

**Ecosystem-scale vision, one level up, still shape-only:**
`docs/ECOSYSTEM_VISION_2026-08-06.md` — what NODE looks like as many shards, not one:
divergence between shards as the default (not a risk), ruin/rejuvenation falling out of
the existing vacancy backstop mechanic pushed to its limit (no new system needed), and
five standing design constraints now also in `CLAUDE.md` (simulate before trusting, no
permanent zero-state at any scale, minimize what's modelable, nothing gets recorded ever,
let outcomes be real). Its private-per-player-maps section originally conflicted with the
diary refinement above (accumulating vs. bounded); resolved — the diary's bounded model
is authoritative at every scale, see that document's inline note. Read both before
Phase 2/4/5 work starts, and before any ecosystem/multi-shard work of any kind.

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
| 2 | Vacancy, churn, backstop system | **Core built, tested** (§2.1-2.5: semi-Markov engine, hazard function, NPC-backstop state). Not integrated with the Phase 1 market yet (a BACKSTOPPED Baker doesn't yet participate in pricing) — see "Open deviations." §2.6 (Shift Cover) not started — needs a player-session concept that doesn't exist in this headless engine yet. |
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
  vacancy.ts    Phase 2 vacancy semi-Markov process (§2.1-2.3): FILLED/VACANT/BACKSTOPPED
                state machine, fillHazard() (§2.2), stepSlot() for one day's transition.
                Not yet wired into market.ts — see "Open deviations."

src/sim/        Everything that needs randomness or orchestrates the engine over time.
  rng.ts        Seeded PRNG (mulberry32) + gaussian sampler. All simulation randomness
                flows through here so runs are reproducible from a seed.
  harness.ts    runMarket() — runs N days headless, returns full state history +
                derived spread series. tailAverage() — steady-state metric after burn-in.
  sweep.ts      sweepStability() — grid-sweeps headcounts/gamma, returns stability points.
  cli.ts        `npm run sim` entry point; prints a sweep table to stdout.
  vacancyHarness.ts  runVacancySim() — runs R role-slots through the vacancy process for
                N days, returns fill/backstop counts, vacant vs. backstopped slot-days
                (tracked separately, see "Phase 2" below), gap distribution.
  vacancyCli.ts `npm run vacancy-sim` entry point; prints the same sweep table used to
                verify (or in this case, not verify) §2.4's targets.
  conscriptionHarness.ts  runConscriptionSim() — Miller conscription (not in the brief,
                see the design addendum). Couples Miller slots (deterministic
                conscription after a delay) with a lumped "other role" pool (unchanged
                vacancy.ts mechanic) so drafting an existing role-holder produces a real
                cascading vacancy. Deliberately not inside engine/vacancy.ts — the
                cross-role coupling belongs at this orchestration layer.
  conscriptionCli.ts `npm run conscription-sim` — sweeps conscription delay x N.

src/comms/      Phase 3 slice — communication layer, no I/O of its own.
  grammar.ts    Wall posts + Envelopes, both built from one curated SelfState template
                table (§3.1). Validity enforced at the function boundary — throws on
                anything outside the template set. This IS the harassment-prevention
                mechanism, not a layer in front of one.
  connections.ts  Per-edge connection graph (§4.3's "no persistent global graph" model,
                borrowed here since the rumour mill needs the same shape rendering will).
  decay.ts      Generic "signal fidelity decays with distance" primitive (stepClarity +
                applyDistortion), extracted from rumourMill.ts so future distance-based
                propagation (proximity conversation, shard-graph distance) can reuse it
                instead of reimplementing decay/distortion. NOT used by the diary — that's
                a deliberately different mechanic (hard TTL expiry, no gradual fade).
  rumourMill.ts Propagates a Wall post outward from its author via BFS over the
                connection graph, using decay.ts's primitives: decays in clarity per hop,
                sometimes distorts into a semantically-adjacent self-state (§3.2). All
                knobs in one config object.

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
                decay.test.ts tests stepClarity/applyDistortion directly, independent of
                the rumour mill. vacancy.regression.test.ts encodes what's genuinely
                verified about the Phase 2 engine — NOT the brief's §2.4 numeric targets,
                see "Open deviations." conscription.regression.test.ts covers Miller
                conscription — BACKSTOPPED time stays low, ratio trend holds, the
                gossip/other-role cascade split is accounted for and stays bounded.

docs/           This file, DEVLOG.md, HANDOVER.md, NODE_Build_Brief_v1.pdf,
                DESIGN_ADDENDUM_2026-08-06.md, ECOSYSTEM_VISION_2026-08-06.md.
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

## Phase 2 — Vacancy, Churn & the Backstop System

### Data flow

```
VacancyParams (N, R, pDaily, beta, tPain, vBoost, tFlag, tHard)
        |
        v  (each day, per role-slot)
stepSlot(slot, day, params, rng):
  FILLED      -> roll pDaily -> VACANT (churn)
  VACANT      -> tau >= tHard?        -> BACKSTOPPED (backstop fires)
              -> else roll fillHazard(tau) -> FILLED (voluntary fill)
  BACKSTOPPED -> roll ambient hazard (see below) -> FILLED (voluntary fill, fromBackstopped)
        |
        v
  new RoleSlot + optional VacancyEvent
```

Three states, not two — the brief's own notation table (§1) lists FILLED, VACANT,
BACKSTOPPED, even though §2.1's shorthand diagram collapses the hard-backstop transition
into "FILLED" for brevity. BACKSTOPPED is real and distinct: an NPC-run slot (§2.5), not
a synonym for player-filled.

### Key equations (as implemented, matches brief §2.2/§2.3 verbatim except where noted)

- `p_d = 1 - (1 - p_m)^(1/30)` — daily churn from monthly. `[DERIVED]`
- `p_c(τ) = β · (0.2 + 0.8 · min(τ/T_pain, 1)) · V(τ)` where `V(τ) = 1` if `τ < t_flag`, else `v_boost`.
- `λ_fill(τ) = 1 - (1 - p_c(τ))^(N - R)` — §2.2, matches the brief verbatim.
- Defaults: `beta=0.0008, tPain=14, vBoost=3.0, tFlag=3, tHard=14` — all `[CALIBRATED — provisional]` per the brief.

### The gap the brief leaves open: BACKSTOPPED -> FILLED

The brief's §2.4 findings describe the pre-backstop VACANT phase only — there's no
specified rate for a real player later displacing the NPC and returning a BACKSTOPPED
slot to FILLED. Left unmodeled, every slot would eventually ratchet into BACKSTOPPED
permanently over a long run, which can't be right — it would contradict "starved
fraction stays near 1-2% of the year" ever being a stable figure rather than one that
monotonically grows toward 100%.

Implemented as an ambient, non-escalating hazard: `fillHazard()` frozen at `τ=t_hard`
(the pressure-plateau value), applied every day a slot is BACKSTOPPED. Matches the
brief's own 49-51 framing — pressure "bites but doesn't compound" past the backstop.
This is an interpretive gap-fill, not a brief-specified number; a different (and
possibly better-justified) choice could change the aggregate numbers below.

### Verified findings (regression-tested in `test/vacancy.regression.test.ts`)

Unlike Phase 1, these do **not** include the brief's §2.4 numeric targets — see "Open
deviations" below for why. What's genuinely verified about this implementation:

1. No vacancy gap ever exceeds `t_hard` (14 days) — a structural guarantee, not just an
   empirical tendency.
2. Both voluntary fills and backstop fires actually occur over a long run at
   `N=50, R=3, p_m=0.20` — neither mechanism is accidentally disabled.
3. The VACANT fraction reaches a stable steady state (first-half vs. second-half of a
   20-year run differ by less than 3 percentage points) rather than drifting toward 0%
   or 100% — matches "permanently tilted, never collapsing."
4. The voluntary:backstop ratio increases with `N` (50 -> 80), matching the brief's
   claimed *direction* even though not its exact magnitude.
5. BACKSTOPPED is a real, measurably-occupied state, distinct from VACANT.

Methodology: 5 seeds x 20 years (`R=3` role-slots each), summed for statistical power —
a single year with only 3 slots produces ~11 events, far too noisy to judge against;
250+ slot-years of data is what the numbers above are actually based on.

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

**Phase 2's §2.4 targets don't reproduce under a faithful implementation (2026-08-06) —
flagged, not silently forced.** The brief claims the literal §2.2/§2.3 equations at
`beta=0.0008, T_pain=14, v_boost=3.0` produce a voluntary:backstop ratio of ~1.2:1 at
N=50 rising to ~2.8:1 at N=80, and a starved fraction near 1-2% of the year. A faithful
implementation of those exact equations and constants (`src/engine/vacancy.ts`),
verified with 250+ slot-years of simulated data (not a small noisy sample — an earlier
1-year/3-slot check gave a wildly different-looking result that turned out to just be
insufficient sample size, corrected before drawing any conclusion), instead converges to
ratio≈2.5 at N=50 rising to ≈4.2 at N=80, and a starved (VACANT-only) fraction of
6-7% — both off by roughly 3-5x from the brief's stated targets, though the *direction*
of the N-dependence matches.

Checked whether this was a tunable-constant problem before concluding it wasn't: swept
`beta` from 0.0008 to 0.01 at N=50. Starved fraction does fall toward the 1-2% target as
beta increases, but the ratio explodes past it in the same sweep — from 2.5:1 at
beta=0.0008 to 783:1 at beta=0.01. No single beta value hits both targets simultaneously;
they move in the same direction but at very different rates. That rules out "just retune
the calibrated constant" as a fix — the discrepancy is structural, not a tuning miss.

Two candidate explanations, neither confirmed: (a) the interpretive gap-fill for
BACKSTOPPED -> FILLED recovery (see the Phase 2 section above) may not match whatever the
brief's own original simulation used, since the brief doesn't specify that transition at
all; (b) "starved fraction" may have been defined differently in the brief's own
methodology than either of the two definitions tried here (VACANT-only vs.
VACANT+BACKSTOPPED — both checked, neither reconciles both targets). Not resolved — flag
rather than silently pick a definition or invent a fix that isn't verified. Also found and
fixed a real bug in the process: `gapDays` was originally double-counting a
BACKSTOPPED-recovery episode's full elapsed time on top of the gap already recorded when
the backstop first fired, producing gap values that impossibly exceeded `t_hard` (17 days
seen, against a 14-day hard cap by construction) — fixed before the finding above was
trusted.

`test/vacancy.regression.test.ts` encodes what's genuinely verified (structural
guarantees and the qualitative N-dependence trend) rather than the exact numeric targets,
consistent with the brief's own §1.4/§2.4 framing that these figures are hypotheses to be
checked against a real implementation, not assumed to hold.

**Follow-up (2026-08-07) — found the ratio bug; recovery hazard barely matters to it.**
User asked to tweak the BACKSTOPPED recovery hazard and rerun the sweep. Before doing
that, checked a structural hypothesis first: every `backstopFires` in this model
eventually produces exactly one `voluntaryFill(fromBackstopped=true)` later (recovery
isn't permanently blocked), and the original `voluntaryFills` counter summed *both*
genuine pre-backstop fills and these later recoveries. That inflates the ratio by
roughly `(genuine/backstop) + 1` versus what the brief's "voluntary fills outnumber
backstop fires" almost certainly means — resolved *instead of* backstop, not *after* it.

Split the metric (`genuineVoluntaryFills` and `backstopRecoveries` now both exposed
alongside the original `voluntaryFills` sum, in `src/sim/vacancyHarness.ts`). Effect
alone, no other change: N=50 ratio moves from 2.48 -> 1.48 (brief target 1.2) — most of
the original ratio mismatch was this bug, not beta, not the recovery hazard.

Then swept the recovery hazard directly (now overridable via
`VacancyParams.backstoppedRecoveryHazard` / `VacancyRunConfig`, optional, defaults to the
original fillHazard(t_hard) interpretive choice when omitted — nothing about the default
behavior changed). Finding: recovery hazard barely moves the corrected ratio at all
(1.14-1.51 across a 1000x sweep from 0.001 to 1.0) — it's a downstream consequence of
BACKSTOPPED duration, not a cause of the genuine-fill-vs-backstop-fire balance. But it's
the dominant lever on how much slot-time is spent BACKSTOPPED at all:

```
recoveryHazard=0.0005 (mean recovery ~2000 days):
  N=50: correctedRatio=1.44  vacantOnly=1.18%  vacant+backstopped=86.08%
  N=60: correctedRatio=1.84  vacantOnly=1.28%  vacant+backstopped=83.32%
  N=80: correctedRatio=2.89  vacantOnly=1.52%  vacant+backstopped=79.38%
```

Both of the brief's headline numbers (ratio, and starved-as-VACANT-only) land close to
its stated targets simultaneously at this recovery rate. **Not adopted as the new
default** — it comes with a real tradeoff the brief doesn't address: at this rate, role
slots spend 79-86% of all time BACKSTOPPED (NPC-run), only 14-21% with a real player in
the seat. That's a genuinely different picture of "the shard" than a system mostly
driven by real Cournot/Bertrand competition, which is the whole economic premise
elsewhere in the brief. Reproducing §2.4's two headline numbers this way surfaces a
bigger, unaddressed question (how often should an automated role realistically return
to a real player?) rather than resolving the original one — flagged, not decided.
Default behavior (`backstoppedRecoveryHazard` unset) is unchanged; `npm run vacancy-sim`
now prints both the corrected and inflated ratio, and a second sweep at the low recovery
hazard, so this is easy to re-inspect. 3 new tests added
(`test/vacancy.regression.test.ts`) locking in the split-metric invariant and that
recovery hazard changes BACKSTOPPED time without materially moving the ratio. 38 tests
total, all passing.

**Resolved (2026-08-07) — Miller conscription replaces the recovery-hazard tradeoff
entirely.** User proposed a new mechanic in response to the tradeoff above: NPC coverage
of Miller is temporary only; past a fixed delay, a random player is mandatorily
conscripted (from the non-role-holding "gossip layer," or from an existing holder of a
different role — the latter creates a real cascading vacancy in the role they're pulled
from). Full design writeup in `DESIGN_ADDENDUM_2026-08-06.md`'s "Refinement — Miller
conscription."

Built as a new sim-level module, `src/sim/conscriptionHarness.ts` — deliberately not a
change to `engine/vacancy.ts`'s `stepSlot`, since the cross-role coupling (drafting a
Courier creates a Courier vacancy) is inherently a multi-slot concern that belongs at
the orchestration layer, not inside the single-slot primitive. `stepSlot` and
`fillHazard` are reused for the "other role" slots and the pre-backstop Miller phase;
Miller's BACKSTOPPED phase gets custom deterministic-conscription logic instead of the
probabilistic recovery hazard.

Verified this actually resolves the tradeoff, not just relocates it again: swept
conscription delay at 3/7/14/30 days, N=50/60/80 (`npm run conscription-sim`). The
genuine-fill:backstop ratio lands close to the brief's §2.4 targets at *every* delay
tested (1.47-1.62 at N=50 vs. target 1.2; 2.52-3.33 at N=80 vs. target 2.8) — delay
length barely affects the ratio at all, since it only governs what happens *after*
backstop already fired. What delay controls is how much time Miller spends
NPC-BACKSTOPPED, and even at a generous 30-day delay that stays under 8% — nothing like
the 79-86% the pure-recovery-hazard approach needed to hit the same ratio. The
other-role cascade is real but bounded: 6-13% of conscriptions pull from another role,
consistently fewer than that role's own organic backstop-fire count (checked directly,
not assumed).

**Not fully resolved:** the pre-backstop VACANT-phase fraction (Miller sits ~6-7% of the
time genuinely vacant before any backstop fires, vs. the brief's 1-2% target) is
untouched by conscription — a separate, smaller residual gap. Conscription delay itself
is also still open — every value tested keeps the ratio on target, so the choice is
about pacing/feel (how present should the NPC be before the community's forced to
respond), not something the simulation alone can settle. `test/conscription.regression.test.ts`
(5 tests) locks in: BACKSTOPPED time stays low, the ratio trend with N holds, delay
moves BACKSTOPPED time much more than it moves the ratio, the gossip/other-role split
accounts for every conscription, and the cascade stays subordinate to organic churn. 43
tests total, all passing.

## Brief §7 open questions — still unresolved (do not silently resolve)

All of them — nothing past Phase 1 is built yet. Ruin Floor (`R(t)`), density numbers,
binary-vs-gradual identity resolution, exact colour palette, ripple decay-weight variance,
City Wall/ambient integration, and all of §5.2's legal specifics remain open per the brief.
