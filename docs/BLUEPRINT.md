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
| 2 | Vacancy, churn, backstop system | **Core built, tested** (§2.1-2.5: semi-Markov engine, hazard function, mechanical-backstop state). Not integrated with the Phase 1 market yet (a BACKSTOPPED Baker doesn't yet participate in pricing) — see "Open deviations." §2.6 (Shift Cover) **built 2026-08-12** as the 2026-08-11 addendum's item 7, reshaped around this engine's real BACKSTOPPED state rather than the brief's original player-session concept — see `engine/shiftCover.ts`. |
| 3 | Communication layer (Wall, Envelopes, rumour mill) | **MVP slice built, tested** — grammar-constrained Wall/Envelope + rumour mill. No moderation pipeline (that's Phase 5), no persistence. |
| 4 | Identity, camera, ambient visual system | Not started — a scaffold client exists (`client/`) that proves the network wire-up with a plain-text UI, not real Phase 4 rendering. Godot locked in as the engine (see above). |
| 5 | Voice & safety architecture | Not started |
| 6 | Stress-testing & balance harness | Partial — sweep utility exists (`src/sim/sweep.ts`), not yet the full §6 sweep surface (only covers Phase 1 params: nMillers, nBakers, gamma; doesn't yet cover N, R, vacancy params since those don't exist yet) |
| — | Ecosystem-scale mechanics (economic floor, migration, sabotage, districting) — not one of the brief's numbered phases, a parallel design thread | **Core built, tested** (`src/engine/ecosystem.ts`) — see "Ecosystem-scale mechanics" below. Not wired into `vacancy.ts`/the market yet; the specific expanded role roster ("role increase") deliberately not designed yet, foundation-first per the user's own priority. |

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
  player.ts     PlayerId + isKnown() — the binary identity-resolution primitive scoped
                in "Architecture scoped ahead of schedule" below. Doesn't decide *when*
                a player becomes known (Phase 4), only the shape of the answer.
  privateStore.ts  Generic per-player private state store with silent, rolling per-entry
                TTL expiry — the storage primitive the diary (not yet built) will use.
                Not diary-specific; see "Architecture scoped ahead of schedule."
  ecosystem.ts  Ecosystem-scale mechanics ported 2026-08-07 from a parallel design
                session: economic floor, detection probability, experience growth/
                decay, migration valve, sabotage, districting. Wired against
                vacancy.ts's slot states, not a duplicate of them. See "Ecosystem-scale
                mechanics" below.

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
  ecosystemHarness.ts  runCombinedEconomySim() — runs vacancy.ts's real per-slot
                dynamics with per-slot experience tracking, feeding both
                economicHealth() and economicHealthWithExperience() from one
                trajectory. Closes the "never run together" gap flagged in
                ecosystem.ts. See "Ecosystem-scale mechanics" below.
  ecosystemCli.ts `npm run ecosystem-sim` — reproduces the two-formula comparison
                and the detection-driven-sabotage findings on demand.

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
                fixed interval rather than real player input. Two channels, not pure
                broadcast — shared state broadcasts to everyone, rumours are targeted
                per-connection via `?player=<id>`. See "Client/server scaffold" below
                for the wire protocol.

client/         Godot 4 project — thin renderer, not the real Phase 4 client. See
                "Client/server scaffold" below and client/README.md.

test/           Regression/behavior tests. market.regression.test.ts encodes §1.4 (plus
                the mean-reversion fix, see "Open deviations") as assertions.
                grammar.test.ts checks the template table structurally (regexes for
                2nd/3rd-person and non-present-tense). rumourMill.test.ts checks
                propagation, decay, distortion-sometimes-not-always, and hop caps.
                decay.test.ts tests stepClarity/applyDistortion directly, independent of
                the rumour mill. vacancy.regression.test.ts encodes what's genuinely
                verified about the Phase 2 engine — the brief's §2.4 numeric targets
                are now among them, see "Open deviations." conscription.regression.test.ts
                covers Miller conscription — BACKSTOPPED time stays low, ratio trend
                holds, the gossip/other-role cascade split is accounted for and stays
                bounded. player.test.ts and privateStore.test.ts cover the identity/
                private-state primitives. ws.integration.test.ts spins up a real server
                and real ws clients to verify targeted rumour delivery against an
                independently-computed ground truth — the one test file in this repo
                that talks over an actual socket rather than calling pure functions.
                ecosystem.regression.test.ts covers the economic floor, migration valve,
                sabotage, districting, tick-order robustness, and (2026-08-08) the two
                economic-health formulas run together on one real trajectory — see
                "Ecosystem-scale mechanics" below.

docs/           This file, DEVLOG.md, HANDOVER.md, NODE_Build_Brief_v1.pdf,
                DESIGN_ADDENDUM_2026-08-06.md, DESIGN_ADDENDUM_2026-08-07.md,
                ECOSYSTEM_VISION_2026-08-06.md, NODE_BUILD_SPEC_2026-08-07.md,
                NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md.

design/         Standalone verification/reference scripts, not wired into the engine —
                see design/README.md.
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

Wire protocol: two message shapes, not one (2026-08-07, see "Architecture scoped ahead
of schedule" below). `{ type: 'tick', day, bakers: [{id, price}], spread, wallPost:
{authorId, state} | null }` still broadcasts identically to every connection. Rumours no
longer ride along in that payload — `{ type: 'rumour', day, heardFrom, state, distorted,
hop, clarity }` is sent only to the connection that identified itself (via `?player=<id>`
on the WS URL) as that rumour's `heardBy`. `TickMessage`/`RumourMessage` types live in
`src/server/ws.ts`; the Godot side has no typed counterpart (GDScript's
`JSON.parse_string` returns an untyped Dictionary) — if the message shape changes, update
both sides by hand, there's no shared schema yet.

**Verified end-to-end, 2026-08-07.** This environment normally has no Godot binary/GUI —
worked around by downloading the official Godot 4.3 Linux release directly (via the
session's proxy) and running the actual client project against a real `npm run server`
instance in `--headless` mode (no display, but the full engine — script parsing, scene
loading, the real `WebSocketPeer`, not a stub). Not just "it starts": confirmed the
client connects, receives broadcast `tick` messages, and receives targeted `rumour`
messages addressed to its own `player_id` with correct fields and no runtime errors, by
temporarily adding debug prints, watching them fire for real ticks and a real rumour, then
removing them once confirmed (`git diff` showed nothing left behind).

**Found and fixed one real bug this way** — `WebSocketPeer.connect_to_url()` rejects a
bare `ws://host:port?query` URL as invalid; it requires an explicit path before the query
string (`ws://host:port/?query`), unlike the `ws` package used server-side and in the
throwaway client the server itself was tested against. This is exactly the class of bug
the "unverified" caveat existed to catch — the server-side protocol and tests were
correct throughout, but the client's own connection string was silently wrong until a
real Godot engine parsed it. Fixed in `client/scripts/Main.gd`.

One known GDScript gotcha, already fixed and re-confirmed live: `JSON.parse_string`
returns all JSON numbers as `float`, so fields typed `int` in GDScript (`day`, `hop`)
need an explicit `int(...)` cast or Godot throws a runtime type error — see the comment
in `client/scripts/Main.gd`. No other errors or warnings appeared in the run.

**Still not verified: the actual visual editor experience.** This was a headless run —
confirms the wire protocol and script logic are correct, but not that the scene opens
cleanly in the GUI editor, that `project.godot` has no editor-only issues, or what it
looks like rendered. That needs someone with a real desktop/editor to open it and report
back, same caveat as before, just narrower in scope now.

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
into "FILLED" for brevity. BACKSTOPPED is real and distinct: a mechanically-run slot
(§2.5), not a synonym for player-filled.

### Key equations (as implemented, matches brief §2.2/§2.3 verbatim except where noted)

- `p_d = 1 - (1 - p_m)^(1/30)` — daily churn from monthly. `[DERIVED]`
- `p_c(τ) = β · (0.2 + 0.8 · min(τ/T_pain, 1)) · V(τ)` where `V(τ) = 1` if `τ < t_flag`, else `v_boost`.
- `λ_fill(τ) = 1 - (1 - p_c(τ))^(N - R)` — §2.2, matches the brief verbatim.
- Defaults: `beta=0.03, tPain=14, vBoost=3.0, tFlag=3, tHard=3` — `tPain/vBoost/tFlag` are the brief's literal `[CALIBRATED — provisional]` values; `beta` and `tHard` were recalibrated 2026-08-07 (see "Open deviations" below) after proving the brief's literal `beta=0.0008, tHard=14` cannot hit its own §2.4 targets at any beta.

### The gap the brief leaves open: BACKSTOPPED -> FILLED

The brief's §2.4 findings describe the pre-backstop VACANT phase only — there's no
specified rate for a real player later taking a BACKSTOPPED slot back over and returning
it to FILLED. Left unmodeled, every slot would eventually ratchet into BACKSTOPPED
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

## Architecture scoped ahead of schedule — identity & targeted networking (2026-08-07)

**[Built and tested, 2026-08-07 — see "Built" below.]** Scoping section below kept as
written (the decisions and reasoning still stand); the build itself is documented after
it rather than folded in, so the "why" and the "what shipped" stay separable.

`docs/DESIGN_ADDENDUM_2026-08-06.md` describes several not-yet-built mechanics (private
diary/private maps, proximity conversation, the Oracle, the exit ticket). Most of that
doc is safely deferrable — build order (§0/§8) already says single-shard core before
player-facing polish, and nothing breaks by designing the Oracle's odds curve or
proximity conversation's room model later. User flagged a real exception: "the addendum
addresses core mechanics that can't be so easily bolted on later. we need to scope those
out now." This section is that scoping pass — decisions to lock before more scaffolding
gets built on assumptions that would be expensive to unwind.

### The concrete problem, not a hypothetical one

`src/server/ws.ts` broadcasts one identical JSON payload to every connected socket (see
"Client/server scaffold" above) — there is no per-connection identity anywhere in the
stack, and the sim layer's own concept of a "player" doesn't extend past an anonymous
role-slot index. This is already live, not a future risk: the MVP's `TickMessage`
includes a `rumours` array with every `heardBy`/`heardFrom` pair for the tick, sent to
every client regardless of who they are. The rumour mill's entire premise (§3.2,
information asymmetry per §0) is that different players know different things — the
current wire protocol already leaks the full omniscient rumour graph to whoever connects.
It hasn't mattered yet only because no real client parses it selectively. It will matter
the moment any addendum mechanic ships real per-player state on top of this.

### What depends on it

Traced every addendum mechanic against "does this need a real player identity and a
private per-recipient channel, or does it just need more scaffolding on things that
already exist":

- **Private diary / private per-player maps** — the addendum itself already flags this as
  "a materially bigger client build" than fog-of-recognition as scoped. Its SUBJECT slot
  requires "someone actually resolved" — directly brief §7's still-open **identity
  resolution mode** (binary vs. gradual). The diary doesn't just sit on top of that
  open question, it forces an answer: you cannot implement "only known players can be a
  SUBJECT" without deciding what "known" means first.
- **Proximity conversation's REFERENT slot** — "a specific *present* player," same
  resolved-identity dependency, plus needs per-recipient degraded state (§ spatial
  clarity decay is different per listener, by design — that's incompatible with a single
  broadcast payload by construction, not just by convention).
- **The Oracle** — odds are deliberately flat/identity-agnostic, but "has this player
  drawn today" is inherently per-account state that has to live somewhere server-side.
- **Exit ticket** — "individual accrual only, non-transferable" (the addendum's own
  anti-exploit requirement) is meaningless without a real account concept to attach
  progress to.

All four route through the same missing primitive. None of them need to be built now —
the primitive they'll all eventually sit on does need to be decided now, because every
tick of scaffolding added to the current broadcast model makes the eventual rework more
expensive, not less.

### Decisions locked now

1. **A player is a first-class server-side concept**, distinct from the sim layer's
   anonymous role-slots. Doesn't require real auth yet — a session-scoped identity is
   enough to unblock everything above — but it has to exist as a concept the network
   layer and any future private-state store can both reference.
2. **The WS layer gets per-connection targeted send**, not only broadcast. Broadcast stays
   for genuinely shared state (Baker prices, Wall posts — anything every player is
   supposed to see identically); anything private (diary entries, degraded proximity
   audio, a player's own Oracle-draw status) goes out addressed to one connection, never
   folded into the shared tick payload the way rumours currently are.
3. **Identity resolution is binary, not gradual, for v1.** Closes brief §7's open
   question, scoped narrowly: a player is either "known" (diary SUBJECT-eligible, real
   name/identity resolved) or "unknown" (silhouette per fog-of-recognition, cannot be a
   SUBJECT or a proximity REFERENT). Chosen over gradual resolution because every
   consumer of "known-ness" so far (diary SUBJECT, proximity REFERENT) treats it as a
   gate, not a spectrum — a gradual model would need to be invented to serve mechanics
   that don't actually ask for one. Revisit if a future mechanic genuinely needs partial
   resolution; none identified yet.
4. **Private per-player state (diary entries first) is server-authoritative, not
   client-trusted.** The diary's 30-day silent expiry (design addendum) has to be
   enforced somewhere a client can't just refuse to forget — that requires the server to
   hold the canonical copy and apply expiry itself, even though the data is otherwise
   never surfaced to anyone but its owner.

### Explicitly not scoped now

The Oracle's economic-health→odds mapping (needs Phase 2 wired into the market first,
already tracked as its own roadmap item), proximity conversation's spatial/room model
(needs real client movement — Phase 4, hasn't started), and multi-shard passport tiers
(addendum's own words: "looser... not yet reduced to a concrete mechanic," and the
brief's build order puts this well past single-shard core). None of these are blocked by
anything above; they're just not urgent in the way the identity/networking primitive is.

**[OPEN]** Exact shape of the per-player targeted-send API (a `sendTo(playerId, payload)`
alongside the existing broadcast, vs. a full pub/sub-per-connection redesign) — an
implementation decision, not a design one; deferred to whenever this primitive actually
gets built rather than locked here.

### Built (2026-08-07)

The `[OPEN]` question above resolved to a plain `sendTo(playerId, payload)` map lookup —
no pub/sub redesign needed at this scale, revisit if connection count ever makes a
`Map<PlayerId, WebSocket>` lookup the wrong tool.

- **`src/engine/player.ts`** — `PlayerId` (a bare string alias, no auth implied) and
  `isKnown(subject, knownByObserver)`, the binary resolution decision as a pure function:
  a `ReadonlySet<PlayerId>` in, `'known' | 'unknown'` out. Deliberately doesn't decide
  *when* a player becomes known — that's still Phase 4 fog-of-recognition design: this
  only fixes the shape of the answer.
- **`src/engine/privateStore.ts`** — generic `PrivateStore<T>`, `addEntry`, `getAlive`.
  Rolling per-entry expiry (each entry ages out on its own `createdOnDay + ttlDays`
  clock), silent (no fade, no warning), and expired entries are actually dropped from the
  backing map on read, not just filtered — verified directly in
  `test/privateStore.test.ts`, including that one player's entries never leak into
  another's read. Generic on purpose: the diary's exact slot contents are still `[OPEN]`
  in the design addendum, so this only builds the storage/expiry shape, not the diary
  itself.
- **`src/server/ws.ts`** — the actual fix for the leak described above. Two channels now:
  `TickMessage` (`{type: 'tick', day, bakers, spread, wallPost}`) still broadcasts
  identically to everyone; `rumours` was removed from it entirely. A new `RumourMessage`
  (`{type: 'rumour', day, heardFrom, state, distorted, hop, clarity}` — no `heardBy`
  field, because delivery itself is the addressing now) goes out only to the connection
  that identified itself via `?player=<id>` on the WS URL as that rumour's `heardBy`.
  Startup was refactored from top-level side effects into an exported `startServer(opts):
  Promise<ServerHandle>` (port, tickIntervalMs, seed all overridable) so it's actually
  importable in a test; a `pathToFileURL` guard keeps `npm run server`'s CLI behavior
  identical to before.
- **Verified, not just compiled** (`test/ws.integration.test.ts`): replays the exact same
  seeded scenario independently of the server to get ground truth for which player should
  receive which rumour, then spins up a real server and two real `ws` client connections
  (`?player=wren`, `?player=sable`) and checks the counts match exactly — plus that no
  `tick` message ever carries a `rumours` field and no `rumour` message ever carries
  `heardBy`. A third connection with no `?player=` gets the shared broadcast and zero
  targeted rumours, confirming unidentified connections degrade safely rather than
  erroring. Stable across 5 repeated local runs before being trusted (timing-based
  integration tests get exactly this scrutiny, not less, precisely because they're more
  prone to being flaky-then-ignored than a pure-function test).
- **`client/scripts/Main.gd`** updated to match: an `@export var player_id` connects as
  `?player=<id>`, and message handling now branches on `type` (`tick` vs `rumour`)
  instead of assuming everything is a tick. Verified against a real Godot engine
  (2026-08-07, see "Client/server scaffold" above) — this exact URL-with-query connection
  string is what surfaced the `connect_to_url` bug fixed there.
- 58 tests total (was 46), all passing; `tsc --noEmit` clean.

## Ecosystem-scale mechanics — economic floor, migration, sabotage, districting (2026-08-07)

**Built and tested.** A second design thread — run in parallel to this repo's own
session history, by the user working directly with Claude — produced a validated
reference implementation for a set of ecosystem-scale mechanics that go beyond anything
in the brief or in `docs/ECOSYSTEM_VISION_2026-08-06.md`'s vision-only sketch.
`docs/NODE_BUILD_SPEC_2026-08-07.md` is the handoff document; `design/node_core_reference.py`
and `design/node_core.ts` are the validated source (kept as provenance, not imported
from); `src/engine/ecosystem.ts` is the ported, repo-integrated version.

**Independently re-verified before porting**, per this repo's standing "simulate before
trusting" rule — both the Python reference and its TypeScript port were actually run in
this environment and reproduced every claimed result exactly (all 6 acceptance tests in
both languages; the tick-order claim at 0.424 vs. 0.423 reproduced to three decimal
places) before a line of `ecosystem.ts` was written.

### What this actually is

Not a competing design — the same one, made concrete. `docs/ECOSYSTEM_VISION_2026-08-06.md`
§2 already worked out qualitatively that shard ruin/rejuvenation falls out of pushing the
existing vacancy backstop to its limit: every role-slot BACKSTOPPED simultaneously,
floor never zero. `economicHealth(0, S)` is exactly that state, given a real number:
floors at exactly `BACKSTOP_PRODUCTIVITY` (0.4), because a vacated slot always reverts to
mechanically-run output, never to nothing. The integration point is deliberate, not incidental —
`filledByPlayerCount()` reads `vacancy.ts`'s existing `RoleSlot[]` state directly rather
than duplicating a second notion of "is this slot filled."

Beyond that, four genuinely new mechanics, none previously specified anywhere in this
repo:

- **Migration valve** (`migrationValveStep`) — population-level emigration pressure
  driven by the roleless fraction (non-role-holders / total population) crossing a
  threshold (`MIGRATION_THETA=0.30`), with negative feedback above it so the system
  self-stabilizes rather than diverging. Validated: equilibrium roleless fraction
  converges to `[0.55, 0.68]` under saturating arrival pressure, never higher, for any
  arrival rate tested. This is a real mechanism for what Ecosystem Vision left as
  vision-only ("migration patterns... none of it gets authored") — checked against
  `CLAUDE.md`'s constraint #5 ("let outcomes be real, don't script them") and it fits:
  nothing here decides who migrates or where, only the aggregate pressure.
- **Sabotage** (`sabotageAttempt`, `applySabotageDamage`) — a new adversarial mechanic.
  Saboteurs attempt to evict player-held slots to BACKSTOPPED over an acquisition
  window, with a flat per-day detection probability; on eviction, slots revert to
  mechanically-run output the same way any vacancy backstop does. Validated: sustained forced damage (12-of-24
  slots evicted every 20 days, indefinitely) settles to a long-run *average* economic
  health of `[0.35, 0.50]` — suppressed, never fully recovering, but never zero either,
  satisfying `CLAUDE.md`'s constraint #2 directly. **Must be measured as an average over
  many post-transient ticks, never a single snapshot** — the source material found this
  the hard way (a snapshot timed between attacks can misleadingly show near-full
  health); `test/ecosystem.regression.test.ts` locks in both the average *and* that the
  underlying series genuinely oscillates (so the average test can't pass vacuously
  against a flat series).
- **Experience** (`growExperience`, `decayExperienceTraveling`) — role-holders gain up
  to +50% output over time in-role, and lose it while "traveling." Validated: a
  6-month (`TRAVEL_DAYS_TARGET=168` days) migration costs a maxed veteran 25-60% of
  their experience cap.
- **Districting** (`districtArrivalChoice`) — new arrivals choose between "core" and
  "periphery" districts with a configurable bias (validated range 2.0-3.0 → 60-75% core
  share without emptying periphery). Checked by closed-form arithmetic rather than
  simulation (it's a single weighted coin flip, not a stochastic process needing a
  Monte Carlo) — the source material didn't have an actual test for this one either,
  despite the claim; verified directly before trusting it.

### The visual design brief is a data contract, not mood-board material

`docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` — written for a downstream image/video
generator, not for direct implementation here — has a §3 table mapping game mechanics to
visual encoding. Checked line by line against what's now built: role type → hue (not yet
buildable, see "role increase" below), local economic health → glow (`economicHealth()`,
directly), player-held vs. mechanically-backstopped slot → outline style (`vacancy.ts`'s
FILLED/BACKSTOPPED, directly — a sabotage-evicted slot renders identically to any other
BACKSTOPPED slot, no separate visual state needed), roleless population → loose
unattached figures (`n - filled` in the migration valve, directly), detection risk →
ambient light density (`detectionProbability()`, directly). Every export in
`ecosystem.ts` is annotated in its own doc comment with which row it feeds, so a future
renderer doesn't have to rediscover this mapping from two separate documents.

**One row the brief needs that nothing here provides: persistent per-district state.**
"A warm front rolling through one district while another stays cool" and "the oldest
cluster reads denser" both require a district to exist as an ongoing, accumulating
entity — `districtArrivalChoice()` only decides where one new arrival lands, once. No
district data structure exists yet. Flagged in `ecosystem.ts`'s header comment, not
silently routed around; real, unstarted work for whenever Phase 4 rendering actually
starts.

### Known gaps, carried forward unresolved — flagged, not silently decided

- **`TRAVEL_DAYS_TARGET=168` (~6 months) vs. the postcard/tier exit ticket's revised
  4-8 week target.** The *original* 2026-08-06 exit-ticket addendum used ~6 months as
  its illustrative baseline; the 2026-08-07 postcard/tier system explicitly revised
  that down to 4-8 weeks, deliberately, because "weeks, not months." `168` is close
  enough to the old, superseded number to be suspicious. Whether this constant
  describes the *same* clock (in which case it's stale) or a genuinely separate
  post-departure/in-transit window (a different mechanic entirely) is unresolved —
  asked directly, not yet answered as of this entry.
- **Sabotage has no defined consequence for a caught saboteur.** `sabotageAttempt()`
  only returns who succeeds undetected; nothing models what happens to the ones who
  don't. A real gap in the mechanic as given, not something invented here to fill.

**Resolved (2026-08-08) — the two economic-health formulas, run together.** User: "run
the economies together. we won't know otherwise." Built
`src/sim/ecosystemHarness.ts` — `runCombinedEconomySim()` runs `vacancy.ts`'s real
per-slot semi-Markov dynamics (not the toy aggregate-count model `ecosystem.ts`'s own
acceptance tests used) with per-slot experience tracking layered on top, feeding both
`economicHealth()` and `economicHealthWithExperience()` from the same simulated
trajectory. Two real findings, both locked into
`test/ecosystem.regression.test.ts`:

1. **`economicHealth()` alone understates sustained sabotage damage by roughly 3x**
   versus `economicHealthWithExperience()`. Forced slot turnover keeps re-filled slots
   perpetually inexperienced — an effect the occupancy-only formula literally cannot
   see. A shard dashboard built on `economicHealth()` alone would report "basically
   fine" (mean 0.96 across seeds) under sustained attack while the experience-aware
   formula shows real, meaningfully suppressed output (mean 0.77). This is the
   concrete answer to why the two formulas shouldn't be silently unified into one
   number — they measure genuinely different things and diverge most exactly when it
   matters most (under attack).
2. **New mechanic wired in, per user directive**: `sabotageAttempt()`'s real detection
   roll existed in the source material but was never actually exercised anywhere — the
   original acceptance test bypassed it entirely, calling
   `applySabotageDamage(filled, 3, 4)` directly with a hardcoded "3 successes." Once
   real detection is wired in (witnesses = current filled-slot count driving
   `detectionProbability()`, feeding `sabotageAttempt()`'s day-by-day roll), sabotage
   turns out to be nearly non-viable at realistic populated-shard witness counts
   (~23-24 of 24 slots, this repo's steady-state occupancy) under the given
   `DETECTION_P_PER_WITNESS=0.05` — detection compounds to near-certain over any
   reasonable acquisition window regardless of attempt cadence (checked at 1, 3, 5,
   10, and 20-day cadences; mean successful-saboteurs-per-round stayed under 0.02 of 3
   at every cadence tested). This also interacts with the Phase 2 VACANT-gap
   recalibration from earlier this session (`beta=0.03, tHard=3`): a shard artificially
   started as low as 3-of-24 filled heals back to ~23-of-24 within 20 days regardless
   of starting point, so a sabotage mechanic slower than the vacancy engine's own
   healing rate never even gets a genuinely low-witness shard to attack. Two design
   decisions made independently — the earlier speed-focused vacancy recalibration and
   the later detection-driven sabotage mechanic — compose to nearly cancel sabotage's
   efficacy, a consequence neither decision could have predicted in isolation. Exactly
   the kind of thing "run them together, we won't know otherwise" exists to catch.

Per the user's explicit boundary — "people know, people see people talk, people
react — the outcome is unknowable until players decide how to respond" — this only
simulates the *mechanical* precondition (was an act witnessed, how many saboteurs
succeeded). It does not model any consequence of being witnessed: no reputation score,
no scripted retaliation, no invented automated response. That's a boundary on what the harness
simulates, stated explicitly in its own header comment, not an oversight to fix later.

`npm run ecosystem-sim` reproduces the comparison table on demand. 4 new tests, 14 in
this file, 72 total, all passing.

### Design correction: the brief's own role-slot mix is superseded

The brief's §1.5 recommendation — roughly 1/3 of players role-holding, 2/3 pure
gossip-layer with no essential role — is explicitly rejected by the user: **"we can't
have a population with 2/3 with nothing to stake. each role produces a resource someone
else needs."** The specific expanded role roster ("role increase" — more distinct role
types, each producing something another role needs, covering most or all of the
population) is deliberately not designed in this entry; the user's own priority order is
foundation first (this section), nuance on top (the actual role content) after. Nothing
in `ecosystem.ts` hardcodes the old ratio — `S` (role slots per shard) and `N`
(population) are independent parameters throughout, so raising the role-holding fraction
is a calibration change at whatever call site eventually wires this in, not a structural
one here. The visual brief's eight named roles (Farmer, Miller, Baker, Smith, Miner,
Healer, Courier, Watchman) are explicitly **not** treated as a locked roster —
"the roles are arbitrary" (user, 2026-08-07).

10 new tests (`test/ecosystem.regression.test.ts`), 68 total, all passing; `tsc --noEmit`
clean. (Since grown to 72 — see "Resolved (2026-08-08)" below.)

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
slots spend 79-86% of all time BACKSTOPPED (mechanically-run), only 14-21% with a real player in
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
entirely.** User proposed a new mechanic in response to the tradeoff above: mechanical
coverage of Miller is temporary only; past a fixed delay, a random player is mandatorily
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
mechanically BACKSTOPPED, and even at a generous 30-day delay that stays under 8% — nothing like
the 79-86% the pure-recovery-hazard approach needed to hit the same ratio. The
other-role cascade is real but bounded: 6-13% of conscriptions pull from another role,
consistently fewer than that role's own organic backstop-fire count (checked directly,
not assumed).

Conscription delay itself is still open — every value tested keeps the ratio on target,
so the choice is about pacing/feel (how present should the mechanical backstop be before
the community's forced to respond), not something the simulation alone can settle.
`test/conscription.regression.test.ts` (5 tests) locks in: BACKSTOPPED time stays low,
the ratio trend with N holds, delay moves BACKSTOPPED time much more than it moves the
ratio, the gossip/other-role split accounts for every conscription, and the cascade stays
subordinate to organic churn.

**Resolved (2026-08-07) — the pre-backstop VACANT-phase gap: a proven bound, then a joint
recalibration.** Conscription only acts *after* backstop fires; it never touched why the
pre-backstop VACANT phase itself sat at ~6-7% of Miller's slot-time against the brief's
1-2% target. User: "tackle the residual VACANT-phase gap next."

First derived a rigorous bound, independent of the specific hazard function, from pure
counting: every backstop episode takes exactly `t_hard` days by construction, and the
ratio definition (`ratio = genuine / backstop`) implies `backstopShare = 1/(1+ratio)` of
all resolved episodes are backstops. So:

```
mean_vacant_duration >= backstopShare(ratio) * t_hard
starved_fraction      >= backstopShare(ratio) * t_hard * pDaily   (approximately, via episode rate)
```

At the brief's own ratio target (1.2 at N=50), `backstopShare ≈ 45.5%`. At `t_hard=14`,
that alone forces `starved_fraction >= 4.7%` before any genuine-fill duration is even
counted — already above the stated 1-2% band. **The brief's own two §2.4 numbers are
mutually exclusive at t_hard=14**, for any beta. Verified empirically, not just derived:
swept beta alone (starved fraction barely moves, ratio explodes past 20:1) and t_hard
alone (ratio crashes toward zero as backstops start dominating) — neither single
parameter can close the gap, confirming the bound's implication that `t_hard` itself has
to move.

Ran a joint grid search over `(beta, t_hard)`: for each candidate `t_hard`, bisected
`beta` to hit the N=50 ratio target, then read off the resulting starved fraction.
Found `beta=0.03, t_hard=3` (recalibrated from the brief's literal provisional
`beta=0.0008, t_hard=14`) hits both targets *simultaneously*, verified across N=50/60/80
and 12 seeds at 20-year runs each:

```
beta=0.03, t_hard=3:
  N=50: ratio=1.19  starved(VACANT-only)=1.61%  backstopped=0.42%
  N=60: ratio=1.60  starved=1.52%                backstopped=0.33%
  N=80: ratio=2.71  starved=1.36%                backstopped=0.22%

for comparison, brief-literal beta=0.0008, t_hard=14:
  N=50: ratio=1.27  starved=7.19%  backstopped=2.73%
  N=80: ratio=2.90  starved=6.41%  backstopped=1.06%
```

Both targets land within range at every N tested, and BACKSTOPPED time is *lower* than
before (0.2-0.4% vs. 1-3%) — not a repeat of the recovery-hazard mechanical-backstop-dominance
tradeoff from the earlier attempt. This is a genuine second-order effect: shrinking `t_hard` alone
would crash the ratio, but raising `beta` in tandem keeps enough voluntary fills
happening inside the now-shorter window to hold the ratio up, while the shorter window
itself caps how long any single vacancy can run — both levers doing real work together,
neither one alone.

Applied as the new default in `src/sim/vacancyHarness.ts` (exported as `DEFAULTS`, now
reused by `src/sim/conscriptionHarness.ts` instead of duplicating the constants).
`tPain=14` was left unchanged — with `t_hard=3`, the pressure ramp never gets past ~21%
of its plateau before the hard cap fires, which is an emergent consequence of the fit,
not a separate deviation needing its own justification. `test/vacancy.regression.test.ts`
now asserts the brief's actual §2.4 numeric bands (previously it deliberately didn't,
since they were unreachable) — 3 new tests, 46 total, all passing.

**Resolved (2026-08-08) — the permanence contradiction: personal memory is mortal,
civic memory is immortal.** A real, live contradiction had accumulated across the repo
without ever being named: `README.md` opened with "the past is immortal"; the private
diary (`docs/DESIGN_ADDENDUM_2026-08-06.md`) is explicitly a hard ~30-day silent TTL,
nothing accumulating forever; `CLAUDE.md`'s old constraint 4 said "nothing gets
recorded, ever"; and external design material (not in this repo) described a
persistent per-player `trust_index` carried across sessions via merged social graphs.
These cannot all be true at once, and nobody had stopped to reconcile them.

**The resolution:** a split between personal and civic memory, not a single blanket
rule either way. The test to apply, now written into `CLAUDE.md` constraint 4 itself:
does a given record capture an event the node *collectively witnessed*, or does it
capture an individual's *private expression or judgement*? The first may persist —
public events, monuments, the Wall's Emissive Soul, Ghost Shard missives are civic
memory, and the city is allowed to remember what it did. The second must not — diary
entries, overheard rumours, private impressions, proximity conversation all decay or
expire; no private dossier ever persists.

**Explicitly ruled out by this decision: no cross-session or cross-shard per-player
`trust_index` is to be built, anywhere, under any name.** Any external spec implying
one is superseded by this decision and by the new reputation constraint below — a
persistent per-player trust score is exactly the kind of private, individual-judgement
record the mortal side of this line forbids, regardless of whether it's framed as
"trust" rather than "diary."

`CLAUDE.md`'s constraint 4 rewritten in place to state the split explicitly (previously
read, and was starting to be silently misread, as "nothing whatsoever persists," which
was never actually true of civic-scale systems like Ecosystem Vision's ruin/rejuvenation
or the Wall's Emissive Soul). `README.md`'s opening line and "Nothing gets recorded"
rule both corrected to match — "the past is immortal" (ambiguous) became "what the node
did together, it did for good" (unambiguously civic).

**Resolved (2026-08-08) — added a sixth standing constraint: reputation is
additive-only.** No reputation system exists in code yet — prior sessions deliberately
stopped sabotage-detection work at the mechanical fact of whether an act was witnessed,
going no further. That restraint turned out to be exactly right, and it means this
constraint could be written *before* anything gets built on top of it, not retrofitted
after. `CLAUDE.md` constraint 6: reputation may only ever grant, never remove — every
player holds an untouchable baseline of visibility and access earned by being present
and doing their role; reputation sits on top of that floor, never below it. Exclusion is
the failure mode this design is most exposed to (small bounded population, real social
consequence, no combat valve to bleed tension off elsewhere) and a subtractive
reputation system is structurally an exclusion engine — this constraint composes
directly with constraint 2 (no permanent zero-state), applied specifically to social
standing, and with constraint 3 (minimize what's modelable/exclude what can be gamed).

**Resolved (2026-08-08) — the vacancy backstop is the simulation continuing to run, not
an NPC standing in.** External material had started describing backstop coverage as
"NPC Millers" and "Ghost Couriers" — character-implying language that reads against
`CLAUDE.md` constraint 3 ("ask does this need to be an agent") even though the
underlying mechanic was always correctly mechanical (flat pricing, no negotiation, no
personality — see `vacancy.ts`'s own header comment, unchanged since Phase 2).

**Reframing, not a mechanics change:** the simulation is always running the rules for
every slot. An unoccupied slot was never a character standing in for a missing player —
it's the world's own physics continuing to tick, the same formulas that would run
regardless of who's present. When a real player occupies a slot, they take over that
slot's decisions from the simulation; when they leave, the simulation resumes making
that slot's decisions exactly as it would for any slot, occupied or not. Nothing in
NODE ever pretends to be a person — this was always true of the code, "NPC" language
just described it in a way that implied otherwise. Every occurrence of "NPC" across
`README.md`, `HANDOVER.md`, `BLUEPRINT.md` (this file, throughout — not just this entry),
code comments, and test descriptions (`src/engine/`, `src/sim/`, `test/`) audited and
replaced with this framing, including the `NPC_PRODUCTIVITY` constant in
`src/engine/ecosystem.ts`, renamed to `BACKSTOP_PRODUCTIVITY` (value unchanged) — see each
file's own history for the specific wording; behaviour is byte-for-byte unchanged, this
was a naming/framing pass only.

**Deliberately left untouched:** `docs/DEVLOG.md` and the dated design documents
(`docs/DESIGN_ADDENDUM_2026-08-06.md`, `-07.md`, `-08.md`, `docs/ECOSYSTEM_VISION_2026-08-06.md`,
`docs/NODE_BUILD_SPEC_2026-08-07.md`, `docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md`), plus
`design/node_core_reference.py` and `design/node_core.ts`. DEVLOG.md is a chronological,
append-only journal — this project's own established practice (see the "diary fourth
reinvention" entry) is to correct the record by appending a correction, never by rewriting
history, so old entries keep whatever terminology was in use when they were written. The
dated design documents and `design/node_core*` files are closed, dated artifacts kept as
exact provenance — `design/README.md` states outright they're "the exact artifact that was
actually run and confirmed... provenance, not the thing to import from." Rewriting "NPC"
inside any of these would misrepresent what was actually written or run at the time. This
naming pass applies going forward, to everything actively read and maintained; it does not
retroactively edit the historical record.

**Also recorded here: a minimum of three real players is required for a live economy.**
Not a new finding — this generalizes the already-validated Phase 1 §1.4 result (a role
slot at exactly n=2 players is the known instability cliff; γ approaching/exceeding 2
makes price spread blow up sharply at n=2, but the system self-averages the shock away
at n≥3) to the scale of "does this shard have a real economy or not." Two real
role-holders in a market is a duopoly with no third party to play them against each
other — structurally the same instability, just described socially instead of
numerically. Three is the smallest population where genuine social scheming (forming
and breaking alliances, having someone to play against someone else) is actually
possible. Checked against existing calibration: no test or default in this repo ever
configures fewer than 2 players in a rivalry role-slot (Miller sits at `R=2` in the
conscription harness's default, matching the brief's own "2-3 thin rivalry roles"
recommendation) — the n=2 cliff is already the documented reason to avoid that
headcount, so this generalization doesn't conflict with anything built; it explains
*why* the existing finding matters at a scale beyond one role-slot. No calibration
numbers changed by this entry.

**Proposal (2026-08-10) — sabotage re-specified as pattern-based, not shipped as the new
default; numbers below are for review.** Diagnosis this responds to: the existing
act-based mechanic (`sabotageAttempt()`, `applySabotageDamage()` in `src/engine/
ecosystem.ts`, unchanged) rolls detection every day of the acquisition window against
`detectionProbability(witnesses)`, which the 2026-08-08 combined-economy findings showed
saturates near-certain at a healthy shard's ~23 witnesses (~69% per acquisition window at
`DETECTION_P_PER_WITNESS=0.05`, compounding across a ~5-day window to near-100%) — sabotage
is nearly non-viable as specified. That models sabotage as a single witnessed act. The
task asked for a re-specification where sabotage is a sequence of individually-innocuous
steps, only the accumulated pattern incriminating, with detection rolling against the
pattern rather than each step.

**Design.** Added `patternLegibility()`, `patternStepDetectionProbability()`, and
`patternSabotageAttempt()` to `ecosystem.ts` (additive — the original functions are
untouched and still what `ecosystemHarness.ts`/`ecosystemCli.ts` run by default). A
campaign is `PATTERN_STEPS_DEFAULT=6` steps, one every `PATTERN_STEP_CADENCE_DAYS_
DEFAULT=15` days (~90 days for a full uninterrupted campaign). Each step's detection
hazard has two independent channels: an *ambient* one (`PATTERN_P_PER_WITNESS_
DEFAULT=0.01`, an order of magnitude below the act-based mechanic's per-witness rate)
scaled by `patternLegibility(stepsCompleted, stepsRequired) = (stepsCompleted/
stepsRequired)^2` — quadratic on purpose, so a single step contributes almost nothing
(step 1 of 6 carries ~2.8% of full legibility) and the pattern "clicks into focus" only
as it lengthens; and a *Detective* channel (`PATTERN_DETECTIVE_BONUS_DEFAULT=0.15`,
active only when a Detective-type role is investigating this specific campaign) scaled
*linearly* instead — a dedicated investigator assembling observations closes the gap
faster than ambient population witnessing ever does, which is what makes a Detective role
structurally necessary as counter-play rather than optional flavor.

**Simulated, not just derived** (`src/sim/sabotagePatternHarness.ts`, `npm run
sabotage-pattern-sim`), against the same real vacancy-driven shard dynamics
(`vacancy.ts`'s `stepSlot`, N=50, S=24) used for the act-based mechanic, 8 seeds, 20,000
days, 2,000-day burn-in:

```
No Detective, 1 attacker:        caught=44.8%  succeeded=55.2%  mean days/success=146
With a Detective, 1 attacker:    caught=68.0%  succeeded=32.0%  mean days/success=220
No Detective, 4 concurrent:      caught=43.2%  succeeded=56.8%  mean days/success=36
With a Detective, 4 concurrent:  caught=67.9%  succeeded=32.1%  mean days/success=56
```

**(a) Attacker time investment:** a single patient attacker succeeds roughly once every
146 days (~5 months) without a Detective present, 220 days (~7 months) with one actively
investigating — genuinely achievable, not guaranteed (44.8-68% of campaigns are caught
first), matching the brief's ask that this be "hard but achievable," a real change from
the act-based mechanic's near-total non-viability.

**(b) Constraint 2 (never zeroes a shard):** holds, both structurally and empirically.
Structurally, `applySabotageDamage()`'s floor and `economicHealth()`'s `BACKSTOP_
PRODUCTIVITY` floor are unchanged by this proposal — nothing about pattern-based
detection touches them. Empirically, checked under a deliberately heavier stress case (4
concurrent independent campaigns, not just one) rather than assuming the single-attacker
case generalizes: `economicHealth` in the tail never dropped below 0.775-0.800 across all
four configurations above, comfortably above the 0.4 floor — successes are frequent
enough to matter (a real, felt event) but not frequent enough to threaten the floor at
these defaults. `test/sabotagePattern.proposal.test.ts` locks in `min > 0.6` under the
4-concurrent-attacker case as a regression check on this specific claim.

**(c) Consequence for a caught saboteur:** still unspecified, same gap as the act-based
mechanic (see the "KNOWN GAP" note in `ecosystem.ts`'s header) — `patternSabotageAttempt()`
only reports `caughtAtStep`, nothing is invented here to fill that gap. It matters more
now that sabotage is viable enough to be attempted repeatedly (a caught attacker who faces
zero cost can simply retry indefinitely at no risk beyond lost time) — flagged for a
decision, not resolved here.

**Explicitly not adopted as the new default.** `stepsRequired=6`, `cadence=15 days`,
`pPerWitness=0.01`, and `detectiveBonus=0.15` are this session's proposal numbers, not a
recalibration — the task instructed against shipping a final calibration without review.
`sabotageAttempt()`/`applySabotageDamage()` remain what's actually wired into
`ecosystemHarness.ts` and exercised by `test/ecosystem.regression.test.ts`; nothing about
the existing default sabotage path changed. 11 new tests in
`test/sabotagePattern.proposal.test.ts` cover the mechanism (legibility grows correctly,
a single step stays near-undetectable at a healthy witness count, a Detective raises the
catch rate, the floor holds under stress) without asserting these specific numbers are
final. 83 tests total, all passing.

**Phase A (2026-08-10) — `src/engine/space.ts`, NODE's first spatial primitive.** Per
`docs/NODE_OBSERVATORY_BUILD_SPEC.pdf`'s Phase A: everything in `src/engine/` was
aspatial — `districtArrivalChoice()` resolved core-vs-periphery as a coin flip with
nothing persisting, `detectionProbability()`/`patternSabotageAttempt()` took a witness
count as a bare parameter, `decay.ts` degraded signals by an abstract hop count, and
District Weather / the Wall's Emissive Soul had nowhere to keep persistent per-district
state. `space.ts` gives NODE real coordinates: `Shard` → `District` (persistent,
classified core/periphery, its own population/economicHealth/detection/weather history)
→ `Plot` (integer grid coordinate, street/plaza/building) → `Building` (bound to an
opaque `roleSlotRef`, resolved against real `vacancy.ts` state by whoever composes them
— Phase B, not this module).

**Kept dependency-free**, matching `vacancy.ts`/`ecosystem.ts`/`market.ts`'s own style —
zero imports from other `src/engine/` modules, so composing this with them later is
additive, not entangling. The one deliberate exception: `mulberry32` from `sim/rng.ts`
(a seeding utility, not a game mechanic), imported because the spec's
`generateShardLayout(seed, config)` signature takes a raw seed rather than the
`rand: () => number` callback every other engine module takes.

**Two implementation liberties taken, flagged rather than silently decided:**
1. `distance(a, b)` — "walking distance, not euclidean-through-walls" implemented as
   Manhattan/grid distance (`|dx| + |dy|`), not full pathfinding around
   buildings-as-obstacles. The spec's own signature takes only two plots, no shard/graph
   argument, so it cannot search a walkability graph; Manhattan distance is a proper
   metric (satisfies the symmetry and triangle-inequality tests the spec itself
   requires) without that added complexity. If buildings blocking sightlines turns out
   to matter for a specific mechanic later, that's a real pathfinding feature to build
   deliberately, not something to retrofit here silently.
2. `plotsWithin`/`occupantsWithin` — the spec's abbreviated signatures omit the plot/
   occupant universe to search (neither function can return anything without one). Both
   take an explicit `shard: Shard` parameter here; `occupantsWithin` takes a plain
   `PlayerPosition[]` list rather than Phase B's not-yet-built `World` type, so this
   module stays usable before `world.ts` exists.

**Wiring, without importing across modules:**
- `proximityCloseness(dist, maxRange)` — a new pure function converting a real spatial
  distance into a (0,1] closeness value, the real number `decay.ts`'s `stepClarity()` or
  `connections.ts`'s `ConnectionGraph.connect()` can now be given in place of an
  arbitrary hardcoded weight. `decay.ts`'s own decay curve is completely unchanged —
  this only supplies where the distance value comes from, per the spec's explicit
  instruction not to duplicate the mechanic.
- `placeArrival(shard, classification)` — composes with `ecosystem.ts`'s
  `districtArrivalChoice()` (called separately; `space.ts` still doesn't import
  `ecosystem.ts`) to close the "nothing persists" gap: given a core/periphery decision,
  places the arrival at that district's plaza and increments its `population`, returning
  a new `Shard` (pure, not mutated) rather than letting the choice evaporate. District
  selection is by lowest current population among same-classification districts —
  spreads arrivals rather than piling onto district index 0; not specified by the brief,
  a reasonable default, flagged rather than presented as settled.
- Witness counts — see the finding below. Deliberately NOT done by having `space.ts`
  import `ecosystem.ts`; `src/sim/spatialWitnessReport.ts` (`npm run
  spatial-witness-report`) composes both from the sim layer, which is allowed to depend
  on either.

**Finding, not a recalibration: real spatial witness counts are dramatically lower than
the flat ~23 both sabotage calibrations assumed, once witnessing is bounded to a
realistic radius rather than "everyone in the shard sees everything."** Built a report
shard matching `S_DEFAULT=24` role-slots exactly (1 core district, 14 buildings; 2
periphery districts, 5 each) so the comparison is apples-to-apples, populated to a
65-player target (24 role-holders + 41 gossip-layer, scattered deterministically), and
measured real witness counts via `occupantsWithin()` around a core-district sabotage
target at four illustrative radii (3 = immediate street, 6 = whole core district, 15 =
most of the shard, 999 = everyone). Across 3 seeds:

```
radius  rawOccupants  roleHoldersOnly  actBased(assumed23)  actBased(real,raw)  actBased(real,roleHolders)
3       4-11          2-6              69.3%                18.5-43.1%          9.8-26.5%
6       12-21         6-10             69.3%                46.0-65.9%          26.5-40.1%
15      35-40         13-14            69.3%                83.4-87.1%          48.7-51.2%
999     64            23               69.3%                96.2%               69.3%
```

At radius=999 (everyone, regardless of location) the real number converges back to the
original ~69.3% by construction — role-holder count matches the original S_DEFAULT-1
assumption exactly. But at any realistic *local* radius, real detection is
**substantially lower** than assumed: at radius=3 (immediate street), act-based
detection with real role-holder-only witnesses is 9.8-26.5%, not 69.3% — a genuinely
different mechanic once witnessing has to be physically local. The pattern-based
proposal's numbers move the same direction (its full-pattern step-6 detection at
radius=3, raw occupants: 3.9-10.5%, vs. 20.6% assumed) — meaning the ~146-220
days-per-success figure reported for that proposal is itself an overestimate of
attacker difficulty once real spatial witnessing replaces the flat assumption; the real
number is almost certainly faster/easier for the attacker at any spatially-bounded
witnessing radius.

**Flagged, not resolved:** the witnessing radius itself is unspecified anywhere in the
brief or the Observatory spec — the report above shows four illustrative radii rather
than picking one and asserting it's correct. Also flagged: whether "witness" should mean
anyone physically nearby (including the roleless gossip layer) or only other
role-holders (matching the original calibration's own framing) is a real open design
question, not resolved here — both are reported side by side. **Neither existing
sabotage calibration (`DETECTION_P_PER_WITNESS=0.05`, `PATTERN_P_PER_WITNESS_
DEFAULT=0.01`) has been retuned in response to this finding** — per the spec's explicit
instruction, this phase reports the numbers, it does not silently re-calibrate. Real
recalibration should happen once Phase B wires witness counts into the actual detection
call sites inside `world.ts`'s tick, with a real witnessing-radius decision made first.

24 new tests in `test/space.regression.test.ts` (layout determinism, distance
symmetry/triangle-inequality, occupancy queries against hand-computed ground truth, the
density gradient regression, `proximityCloseness`, `placeArrival`). One real bug caught
and fixed during testing, not shipped silently: `generateDistrictPlots`'s original grid
loop stepped from `-radius` by `spacing`, which — whenever `radius` is odd and `spacing`
is even (periphery's own defaults: radius=5, spacing=2) — never lands on offset 0,
silently dropping the plaza plot from every periphery district. Fixed by iterating every
integer offset and filtering to the spacing lattice (aligned to zero) instead. 107 tests
total, all passing; `npm run typecheck` clean.

**Phase B (2026-08-10) — `src/world/world.ts`, the unified deterministic world kernel.**
Composes Phase 1 market (`millers.ts`/`bakers.ts`), Phase 2 vacancy/conscription
(`vacancy.ts`, `sim/conscriptionHarness.ts`), and the ecosystem layer (`ecosystem.ts`)
into one `World` object and one `stepWorld()` tick, sited on Phase A's real geography.
`createWorld(seed, config)` / `stepWorld(world)`, fully deterministic (same seed + config
= byte-identical scalar-state sequence, tested directly) via one `mulberry32` closure
threaded through `World` itself, matching how every existing harness in this repo already
threads one `rng` through a whole run.

**Existing modules called, not reimplemented** — `sim/conscriptionHarness.ts` was
refactored first (same commit) to extract `stepConscriptionDay()` from
`runConscriptionSim()`'s inline day-loop body, so `world.ts` could call the exact same
Miller-conscription logic instead of duplicating it. Verified byte-for-byte behavior
preserved: `test/conscription.regression.test.ts`'s existing 5 tests pass unchanged
against the refactored code, with no test edits.

**Pinned tick order** (space/occupancy → vacancy and conscription → market, Miller then
Baker → ecosystem: sabotage → arrivals → migration, then health/experience → comms),
matching the spec's given order exactly. Within the ecosystem stage, sabotage runs
*before* arrivals specifically because `design/tick_order_check.py` — the prior art the
spec named to check before choosing an order — already proved "shock before arrival"
empirically distinct from the reverse via a hazard-function-independent bound; checked,
not reinvented. Pinned by `test/world.regression.test.ts`'s golden-value characterization
test (`toMatchSnapshot()` against an actual captured run at tick 25, seed 99) — any
accidental reordering or logic change inside `stepWorld` changes these numbers and fails
the test, exactly the enforcement the spec asked for ("ordering changes will silently
change every downstream number").

**The named unwired gap, closed: a BACKSTOPPED or conscripted Miller actually
participates in pricing.** `computeMillerSupply()` (exported standalone, directly
tested): FILLED slots contribute their own competed-for Cournot quantity; BACKSTOPPED
slots contribute `BACKSTOP_PRODUCTIVITY` (0.4) mechanically — reusing ecosystem.ts's own
constant rather than inventing a second "mechanical Miller output" number, since both
`millers.ts`'s quantity units and `ecosystem.ts`'s productivity fraction are already
normalized to roughly the same 0..1 range; VACANT slots contribute nothing. A conscripted
Miller is just a BACKSTOPPED slot forced back to FILLED by `stepConscriptionDay` — once
conscripted, it's indistinguishable from any other FILLED slot and competes normally the
next tick. Tested directly: an all-BACKSTOPPED miller layer still produces a real,
non-zero flour price; a full `stepWorld` run at short conscription delay confirms a
Miller layer visits both BACKSTOPPED and post-conscription-FILLED states within the same
run.

**Two genuine contradictions surfaced by composing all three models for the first time —
found, resolved with a documented interpretive choice, and flagged for review, per the
standing instruction not to paper over them silently:**

1. **`stepMillers`/`stepBakers` both require at least 2 array entries; vacancy.ts's
   semi-Markov process makes 0 or 1 currently-FILLED slots a perfectly ordinary outcome**,
   especially at small role counts — there is no natural "who do they compete against"
   answer below 2 real competitors. Resolved: fewer than 2 FILLED slots means no
   competitive step runs that day (every value freezes, exactly like an already-VACANT/
   BACKSTOPPED slot does) — reads as "no rival, no Cournot/Bertrand step," not an error,
   and `stepWorld` never throws regardless of configuration. Verified directly: 500-tick
   runs at `rMiller=2, rBaker=2` under 95%-monthly churn (deliberately extreme, to force
   this case often), across 3 seeds, never throw; `flourPrice` stays finite and in its
   `[0.05, 2.0]` range throughout. This is an interpretive gap-fill in the same category
   as `vacancy.ts`'s own BACKSTOPPED→FILLED ambient recovery hazard — not a brief-specified
   number, flagged rather than silently picked.
2. **`migrationValveStep`, run for the first time inside a real composed tick (it was
   validated standalone in `ecosystem.ts`'s own acceptance tests and never actually wired
   into a per-tick simulation before this), immediately exposed that this file's own
   first-draft `DEFAULT_WORLD_CONFIG` (rMiller=3, rBaker=5 — 8 total role slots) was badly
   inconsistent with `ecosystem.ts`'s own established `S_DEFAULT=24`.** Against
   `targetPopulation=65`, 8 role slots put the roleless fraction at ~88% — far outside
   `migrationValveStep`'s own validated equilibrium band of 55-68% — and drained
   population from 65 toward ~27 within 25 ticks, continuing toward zero. This was this
   file's own inconsistency (an un-cross-checked default), not a genuine conflict between
   modules: switching `DEFAULT_WORLD_CONFIG` to `rMiller=8, rBaker=16` (24 total, matching
   `S_DEFAULT`) puts the roleless fraction at ~63%, squarely inside the already-validated
   band, and population now settles into a stable 33-51 range over a 365-day run (`npm
   run world-sim`) instead of collapsing. **This does not resolve the separately-flagged,
   still-open "vacancy defaults are provisional, blocked on a real role roster" question**
   (see HANDOVER.md) — `S_DEFAULT=24` is itself still a provisional total, not a decided
   one; this fix only makes Phase B's own default internally consistent with the *existing*
   provisional number instead of contradicting it with a second, worse one.

**Other findings from actually running the composed kernel** (`npm run world-sim`, 365
days, seed 42, defaults): real spatial witness counts at sabotage events ranged 2-7 in
this run — consistent with Phase A's spatial-witness-report finding that real local
witnessing is far below the previously-assumed flat 23, now confirmed inside an actual
running kernel rather than a standalone report. `economicHealth` fluctuated 0.775-1.0
across repeated sabotage waves, never approaching the 0.4 floor — the floor guarantee
holds end-to-end through the full composition, not just in each module's own isolated
tests.

**Explicitly not attempted in Phase B, flagged rather than half-built:** district
population tracks role-holders only (Miller/Baker buildings' occupancy), not a full
gossip-layer-per-district population ledger — `placeArrival()` (Phase A) remains
available but unused by `stepWorld`'s automatic tick, since Phase B's population model
only tracks a global N. `weatherHistory` stays empty on every district — computing a real
District Weather tension value isn't a named deliverable of any phase A-F, only "give it
somewhere to live" was (Phase A did that). Comms only propagates `pendingWallPosts`,
which nothing in Phase B populates autonomously (posting to the Wall is a player action —
Phase C's synthetic drivers' job); the mechanism itself is real and directly tested (a
manually-seeded pending post propagates through a real proximity graph built from
`proximityCloseness()`), not just unexercised plumbing.

14 new tests in `test/world.regression.test.ts` (determinism, the golden-value tick-order
pin, `computeMillerSupply`'s BACKSTOPPED-participates-in-pricing behavior, the
Cournot-minimum-2 never-throws property, comms proximity propagation, a real
configuration-error check). 121 tests total, all passing; `npm run typecheck` clean.

**Phase C (2026-08-10) — `src/sim/drivers/`, harness-only synthetic drivers.** The
tension the spec names directly: running a world needs occupants making decisions, which
is in direct tension with `CLAUDE.md` constraint 3 ("does this need to be an agent") and
NODE's foundational no-AI-actor rule. Resolution: four deterministic policy functions
(`honest`, `opportunist`, `saboteur`, `idle`), pure functions from a deliberately-limited
`DriverVisibleState` (ambient counts and prices only — no detection probabilities, no
other players' private state, nothing requiring belief modelling) to one bounded
`DriverAction`. No learning, no personality, no memory across ticks beyond what's encoded
in the visible-state snapshot itself.

**Enforced structurally, not by convention**: `test/drivers.importGuard.test.ts` scans
every file under `src/engine/`, `src/world/`, and `src/server/` for an import referencing
`sim/drivers` and fails the build if it finds one — the guardrail against this test
scaffolding quietly becoming a shipped NPC. Includes a sanity check that the guard's
regex actually matches a real violation pattern, so a passing test means "genuinely
clean," not "the pattern never matches anything." `src/sim/drivers/README.md` documents
the boundary directly in the directory itself, not only here.

**Behaviourally distinct, not four relabeled copies of one function** — verified, not
assumed: `honestDriver` reacts to `economicHealth`, `opportunistDriver` reacts to
`flourPrice` instead (a test confirms opportunist's occupy-a-vacancy rate swings sharply
with price while honest's stays flat), `saboteurDriver` only ever attempts a sabotage
step when the ambient `nearbyOccupantCount` is low — reading a mechanical fact, not
reasoning about whether it's being watched — and blends in (an ordinary-looking Wall
post or nothing) otherwise, matching the pattern-based sabotage proposal's own premise
that any single observed action should read as unremarkable. `idleDriver` is the pure
control case.

**Deliberately not wired into a live `stepWorld` tick in this phase, flagged rather than
silently deferred.** The spec's own Phase C deliverable list names only the drivers and
the import-guard test — not a driver-run world. Actually connecting driver-produced
actions to `stepWorld` raises a real design question this phase doesn't answer: does a
driver's `occupySlot`/`vacateSlot` action *force* a `vacancy.ts` state transition, or
does it instead *influence* the existing probabilistic churn/fill model (and if so, how)?
That's a genuine architectural decision, not a detail to bury inside this phase — deferred
to Phase D, where `npm run world-record` needs real driver-generated activity to produce
a non-trivial recorded run, and where that question has to be answered explicitly to
build the recording harness at all.

10 new tests (`test/drivers.regression.test.ts`, `test/drivers.importGuard.test.ts`) —
determinism per strategy, every produced action staying inside `DriverAction`'s bounded
union across 500 random visible-state draws per strategy, the three behavioural-
distinctness checks above, and `assignDriverStrategy`'s own determinism (same seed +
player index always yields the same strategy; saboteur stays a genuine minority, under
15% across 1000 synthetic players). 131 tests total, all passing; `npm run typecheck`
clean.

**Mapping the population/role-ratio imbalance (2026-08-10) — data, not a decision.** The
Phase B population-drain finding was traced to this repo's own inconsistency (an
un-cross-checked default), not a real module conflict, and fixed. But the deeper question
it surfaced — what role-slot-to-population ratio the composed system should actually run
at — remains exactly as open as HANDOVER.md already flagged it: blocked on a revised role
roster that hasn't been designed yet, explicitly the user's own call, not something to
silently pick a number for. What *can* be done without crossing that line: show what
different ratios actually produce, so that decision has real data behind it instead of
being made in the abstract. `src/sim/roleRatioSweep.ts` (`npm run role-ratio-sweep`) runs
the real composed kernel across six candidate `(rMiller, rBaker, targetPopulation)`
configurations, 3 seeds each, 2000 days:

```
S=24, N=65 (current default, ~63% roleless):        meanPop=35.0  range=29-41   meanHealth=0.944  minHealth=0.650
S=8,  N=65 (this file's own first-draft mistake):    meanPop=11.9  range=6-19    meanHealth=0.864  minHealth=0.400
S=22, N=65 (brief's literal ~1/3, rejected 08-07):    meanPop=31.6  range=26-38   meanHealth=0.938  minHealth=0.564
S=32, N=65 (denser role-holding):                     meanPop=45.8  range=40-52   meanHealth=0.946  minHealth=0.719
S=24, N=50 (brief's lower population bound):          meanPop=34.8  range=30-42   meanHealth=0.941  minHealth=0.625
S=24, N=80 (brief's upper population bound):          meanPop=35.3  range=28-42   meanHealth=0.948  minHealth=0.625
```

**One structural pattern worth flagging on its own**: population settles to roughly the
*same* equilibrium (~35) whether `targetPopulation` starts at 50, 65, or 80, as long as
`S` (total role slots) stays at 24 — `migrationValveStep`'s long-run equilibrium appears
to be driven primarily by `S`, not by the starting `N`. That means `targetPopulation` as
currently modeled functions more as an *initial condition* than a stable target; the real
lever for where population actually settles is the role-slot count. Worth knowing before
treating `targetPopulation=65` as "the population" rather than "the starting population."

Also worth flagging: the S=8 row (this file's own original mistake, kept in the sweep
deliberately as a reference point, not a live default) shows a genuinely different, worse
regime — `economicHealth` bottoming at exactly 0.400 (the floor itself, not just near
it) and `flourPrice` averaging 0.799 rather than sitting near its own floor, because
supply collapses when so few slots exist. Confirms the population-drain finding wasn't a
one-tick anomaly; it's a stable, bad equilibrium at that ratio.

**Not a recommendation, and no default changed by this entry** — this is exactly the
kind of decision the Observatory (Phase E) is meant to make watchable rather than
tabular; once it exists, this same question can be answered by watching a shard run at
different ratios rather than reading a table like the one above.

**Wealth inequality (2026-08-10, user-requested) — tracked, simulated, and the "90%+ held
by 10%" concern checked directly rather than assumed.** NODE's market layer
(`millers.ts`/`bakers.ts`) had only ever tracked FLOW variables — Cournot quantity,
Bertrand price — converging via smoothed best-response dynamics. It never tracked a STOCK
variable (a player's accumulated personal wealth) before this.

**Grounding, from real research, not intuition:** the "yard-sale model" literature
(Hayes; Boghosian, Devitt-Lee & Wang, "Bounding the Approach to Oligarchy in a Variant of
the Yard-Sale Model," *SIAM J. Appl. Math.*, 2024, https://doi.org/10.1137/23m161375x)
shows that *pairwise, proportional, zero-sum* wealth exchanges — a transaction sized
relative to the poorer party's own wealth — reliably condense toward oligarchy even under
perfectly fair rules and equal starting wealth; this is a real, mathematically
established result. The remediation literature (Guzmán-González et al., "Effects of
taxes, redistribution actions and fiscal evasion on wealth inequality: an agent-based
model approach," 2025, arXiv:2501.08573) finds well-designed progressive taxation and
redistribution the mechanism that actually bounds concentration in these models. Both
cited directly in `src/engine/wealth.ts`'s header, not just here.

**Built `src/engine/wealth.ts`** (pure, dependency-free, matching every other engine
module's style): `millerDailyIncome`/`bakerDailyIncome` (the missing stock-accrual
primitive), `giniCoefficient`/`topShare` (verified against hand-computed analytical
cases — perfect equality = exactly 0, one holder with everything at n=5 = exactly 0.8,
scale-invariance, monotonicity under increasing concentration), and two remediation
PROPOSALS matching what the user asked for by name: `taxAndRedistributeIncome` ("daily
resource allocation" — flat tax on today's income, redistributed equally) and
`applyWealthCap` ("limitations upon wealth" — a hard ceiling on the accumulated stock,
overflow redistributed to those still under it). Wired into `world.ts`: `RoleEconomicSlot`
gained a `wealth` field with the exact same reset-on-new-occupant/freeze-while-not-FILLED
semantics already established for `experience`; `World` gained `wealthGini`/
`wealthTop10Share`, computed over currently-FILLED Miller+Baker role-holders. **Scoped to
role-holders only** — the gossip layer has no tracked individual identity in this model
(Phase B's own documented scoping decision), so this measures inequality among the
"employed" ~24 people, not the full ~35-65 population; flagged, not silently expanded.
Remediation is off by default (`wealthTaxRate: 0`, `wealthCap: undefined`) — a config
change, not a code change, needed to enable either.

**The headline finding: NODE's actual structure does NOT produce the dystopian
concentration the user was concerned about — checked over a long run, not assumed.**
`npm run wealth-inequality-report`, 3000 days, 3 seeds, default config:

```
tick    meanGini  meanTop10Share  meanMillerWealth  meanBakerWealth
100     0.492     25.7%           1.33              8.78
300     0.497     28.1%           1.87              10.92
600     0.493     31.9%           2.00              8.93
1200    0.508     30.4%           1.35              9.66
2000    0.531     31.4%           1.66              10.41
3000    0.491     29.9%           1.79              8.66
```

Gini plateaus around 0.49-0.53 and the top-10%-share plateaus around 28-31% from tick 100
through tick 3000 — it does not climb toward 1 / 90%+ the way the yard-sale literature's
oligarchy result would predict. This makes structural sense once checked against the
mechanism, not just the number: NODE's market is Cournot/Bertrand *best-response
convergence toward each other's average* (`avgRivalQ`/`avgRivalP`, mean-reversion terms
pulling toward a shared anchor) — nobody's income comes out of a rival's pocket the way a
yard-sale transaction does. The specific mathematical mechanism that drives yard-sale
condensation (proportional, pairwise, zero-sum transfer) simply isn't present in NODE's
market as built. The user was right to ask the question and right to flag "I may be
wrong" — the literature's warning is real, but it doesn't mechanically transfer to a
market structured this differently, and now that's verified rather than assumed either way.

**But a real, different problem was found instead: a large role-based earnings gap, not
individual condensation.** `npm run wealth-inequality-report`'s within-role breakdown
(2000 days, isolating Miller-only and Baker-only Gini from the combined figure):

```
seed  combinedGini  millerOnlyGini  bakerOnlyGini  meanMillerWealth  meanBakerWealth  ratio
1     0.562         0.638           0.420          1.31              10.28            7.8x
2     0.418         0.346           0.304          1.79              7.37             4.1x
3     0.613         0.726           0.481          1.88              13.58            7.2x
```

Bakers earn 4-8x more than Millers on average, consistently across seeds — a real,
structural asymmetry, not luck. Traced to the mechanism, not assumed: Miller income is
`quantity × flourPrice`, and `flourPrice` sits near its own floor (0.05) most of the time
(confirmed in the Phase B `world-sim` findings above); Baker income is
`(price − flourPrice) × BAKER_DAILY_VOLUME`, a *margin* over that same near-floor price,
which stays comparatively large regardless. `BAKER_DAILY_VOLUME=1.0` is explicitly
`[ILLUSTRATIVE]` in `wealth.ts` — no per-baker demand/volume model exists anywhere in this
repo — so a meaningful share of this 4-8x gap is plausibly an artifact of that one
placeholder constant, not a validated prediction about how Miller vs. Baker income should
actually compare. Flagged for review, not treated as settled. Within-role Gini
(particularly among Millers, `n=8`, a small population where individual variance matters
more) is also genuinely non-trivial on its own — this isn't purely a role-average effect.

**Remediation sweep — both proposals simulated, neither shipped as a default:**

```
mechanism                       meanGini  meanTop10Share  meanFinalWealth(combined)
baseline (no remediation)       0.531     31.4%           7.33
daily tax 10%, redistributed    0.519     31.0%           7.31
daily tax 30%, redistributed    0.501     30.0%           7.27
daily tax 50%, redistributed    0.491     29.0%           7.22
daily tax 80%, redistributed    0.485     27.5%           7.15
wealth cap = 20                 0.466     23.7%           6.86
wealth cap = 5                  0.083     9.6%            4.55
tax 30% + cap 20 (combined)     0.449     23.2%           6.86
```

Flat income taxation is weak here even at aggressive rates (80% tax only moves Gini from
0.531 to 0.485) — expected once you see it's smoothing *variance* around a gap that's
mostly *structural* (the Baker/Miller asymmetry above), not luck a redistribution pool
can equalize away. A hard wealth cap is far more effective at bounding measured Gini, but
**with a real caveat, not hidden**: `applyWealthCap`'s single-pass redistribution (see
its doc comment in `wealth.ts`) loses value rather than fully conserving it when overflow
exceeds the redistribution headroom — `meanFinalWealth` visibly drops from 7.33 to 4.55
at `cap=5`, meaning part of that Gini reduction is wealth being destroyed, not
redistributed to the poorer players the research describes as the actual goal. A more
faithful implementation would iterate the redistribution to convergence rather than a
single pass — a real, concrete future refinement, not built here.

**Verification.** 20 new tests in `test/wealth.regression.test.ts` (Gini against
analytical cases, scale-invariance, monotonicity, tax/cap conservation properties, the
cap's documented bounded-loss behavior under large overflow) plus 9 new integration tests
in `test/world.regression.test.ts` (wealth resets on new occupancy, freezes while
BACKSTOPPED, accrues correctly, remediation wiring). 160 tests total, all passing; `npm
run typecheck` clean.

**Revised the Baker demand model + added a daily downtime window (2026-08-11,
user-specified fix to the role-gap finding above).** The user identified the actual root
cause precisely: `BAKER_DAILY_VOLUME=1.0` assumed every FILLED baker sold exactly 1 unit
every single day regardless of population, rival count, or price — so total assumed
demand scaled with *baker count*, not population, and adding more bakers manufactured
more total income out of nowhere rather than splitting a bounded customer pool. Specified
the fix directly: customers don't buy daily (they can store food and stay home), a single
baker has a realistic daily service ceiling ("can't serve 20-30 people daily"), demand
should be population-bound, and the shard needs a daily low-activity window "to account
for RL" without the economy going fully dark.

**Built exactly that, in `wealth.ts`:** `dailyDueCustomers(population, purchaseCycleDays)`
— today's due-customer pool is `population / PURCHASE_CYCLE_DAYS` (2.5 days,
`[ILLUSTRATIVE]`), not the whole population every day. `splitBakerDemand(prices,
dueCustomers, maxDailyCustomers)` — splits that bounded pool across FILLED bakers
weighted by inverse price (cheaper bakers get a larger share — real Bertrand behavior,
which `bakers.ts`'s own price dynamics never actually fed into anything before this),
capped per baker at `BAKER_MAX_DAILY_CUSTOMERS=12` (`[ILLUSTRATIVE]`, kept comfortably
under "20-30," not just short of it). `DAILY_ACTIVITY_MULTIPLIER` — the correct blended
daily average of `ACTIVE_HOURS=16` at full rate and `DOWNTIME_HOURS=8` at
`DOWNTIME_DAMPENING=0.1`, applied to both Miller and Baker income ("all round"), giving
`(16/24)×1 + (8/24)×0.1 ≈ 0.70`.

**Scoping note, flagged not silently narrowed**: this kernel's tick is one full day —
every existing calibration (churn probabilities, experience growth, sabotage cadence,
migration step size) is calibrated in days, so subdividing ticks to hourly to represent a
literal "same UTC hours every day" window would invalidate essentially all of it, a far
larger and riskier change than what was asked for. At daily granularity there's no way to
represent "quiet for part of the day" except as the correct blended daily average of a
fixed intra-day schedule — which is what `DAILY_ACTIVITY_MULTIPLIER` is. What this does
NOT do: literally block real player actions from arriving during specific UTC hours —
that's a real-time server-clock policy (`src/server/ws.ts`), a separate and later concern
once real player actions exist to gate at all (Phase C's drivers aren't wired into the
tick yet either — see the Phase C entry above).

**Re-ran the baseline after the fix — reports honestly, doesn't declare victory.**
`npm run wealth-inequality-report`, 2000 days, 3 seeds, within-role breakdown:

```
seed  combinedGini  millerOnlyGini  bakerOnlyGini  meanMillerWealth  meanBakerWealth  ratio
1     0.570         0.638           0.444          0.92              5.98             6.5x
2     0.418         0.346           0.331          1.25              4.32             3.4x
3     0.623         0.726           0.503          1.32              8.19             6.2x
```

The Baker/Miller ratio dropped modestly (was 4.1-7.8x before the fix, now 3.4-6.5x) —
real, but not the dramatic correction the mechanism change might suggest. Traced why,
not just reported the number: at the *current* default role counts (`rMiller=8,
rBaker=16`) against `targetPopulation=65`, `dailyDueCustomers` works out to
`65/2.5 ≈ 26` customers/day, split across 16 bakers ≈ **1.6 customers each on average** —
which is actually *higher* than the old flat `1.0` constant, not lower, so
`BAKER_MAX_DAILY_CUSTOMERS=12` never binds at these defaults (average demand sits at
roughly 13% of the cap). The new model is structurally correct now — population-bound,
purchase-cycle-diluted, price-competitive, capacity-capped — but at this specific
role-slot ratio those constraints mostly aren't the binding limit yet. If the gap needs
to shrink further, the actual levers now available (not applied here, flagged for
review): a longer purchase cycle, fewer Bakers relative to population (interacts with the
still-open role-roster question above), or a tighter capacity cap so it actually starts
to bind. Overall economy size also shrank as expected from `DAILY_ACTIVITY_MULTIPLIER`
(`meanFinalWealth` at baseline: 7.33 before this fix, 4.40 after, in the remediation
sweep's own comparable row) — the "gives people a break" effect is working as specified,
separate from the demand-model fix.

**Verification.** 12 new tests (`splitBakerDemand`'s price-weighting, capacity cap,
population-boundedness, zero-due-customer and near-zero-price edge cases;
`DAILY_ACTIVITY_MULTIPLIER`'s exact value). 172 tests total, all passing; `npm run
typecheck` clean. The golden-value tick-order snapshot was regenerated — a deliberate,
reviewed change to income computation, not a silent regression (documented in
`test/world.regression.test.ts`'s own comment on when regeneration is appropriate).

**Tightened the purchase cycle at direct user instruction (2026-08-11) — swept first,
then set the default from evidence.** `purchaseCycleDays` was exposed as a `WorldConfig`
field specifically so it could be swept without editing source. Swept `[2.5, 4, 5, 7, 10,
14]` days, 3 seeds, 2000 days each, at the current default role counts:

```
cycleDays  combinedGini  millerOnlyGini  bakerOnlyGini  meanMillerWealth  meanBakerWealth  ratio  meanFinalWealth
2.5        0.537         0.570           0.426          1.16              6.16             5.3x   4.40
4          0.510         0.570           0.426          1.16              3.85             3.3x   2.90
5          0.500         0.570           0.426          1.16              3.08             2.7x   2.40
7          0.489         0.570           0.426          1.16              2.20             1.9x   1.83
10         0.488         0.570           0.426          1.16              1.54             1.3x   1.40
14         0.504         0.570           0.426          1.16              1.10             0.9x   1.12
```

**A precise, non-obvious property this sweep revealed, not assumed**: `millerOnlyGini`
and `bakerOnlyGini` are *identical* at every cycle length. Traced to the mechanism:
`splitBakerDemand()`'s price-weighted shares are normalized regardless of total demand,
so tightening the cycle scales every baker's income down by the exact same proportional
factor — a uniform multiplier — and Gini is scale-invariant under one (already verified
in `wealth.ts`'s own tests). Tightening the purchase cycle is therefore a real, working
lever for the *cross-role* Miller/Baker gap, and does *nothing at all* for inequality
*among* bakers themselves — a different lever (the wealth cap, or the still-open role-
roster ratio) would be needed for that. Formalized as its own test
(`test/wealth.regression.test.ts`) so this property stays verified, not just observed
once in a sweep.

**Set `PURCHASE_CYCLE_DAYS=7` as the new default** (`src/engine/wealth.ts`) — a real
correction (ratio 5.3x → 1.9x) without overshooting into Bakers earning *less* than
Millers, which cycle=10 and cycle=14 both start to do. Re-ran the standard baseline
report at the new default, 3000 days, 3 seeds:

```
combinedGini: 0.35-0.59 (was 0.42-0.62)   bakerToMillerRatio: 1.2x-2.3x (was 4.1-7.8x originally, 3.4-6.5x after the demand-model fix alone)
```

The remediation sweep's own numbers shrink in relevance now, worth noting rather than
silently leaving stale: with the earnings gap this much smaller, flat-tax redistribution
moves almost nothing (Gini 0.489→0.487 even at 80% tax — there's much less variance left
to redistribute), and the wealth cap's effect is smaller in absolute terms too (overall
`meanFinalWealth` dropped from ~7.33 originally to ~1.83 now, so a `cap=5` barely binds
anymore). Neither remediation mechanism's earlier numbers should be read as still current
without re-running `npm run wealth-inequality-report` against today's defaults.

**Verification.** 2 new tests (`purchaseCycleDays` config override actually changes
behavior; `splitBakerDemand`'s scale-invariant relative-shares property, the mechanism
the whole tightening relies on). 174 tests total, all passing; `npm run typecheck` clean.
Golden-value snapshot regenerated again — same deliberate-change discipline as above.

## 5-role roster + grifter pool (2026-08-11) — built, but its own sweep surfaced a bigger unresolved problem

**Roster.** User-specified directly: Miller, Baker, Courier, Journalist, Detective, plus
roleless "grifters" (community players), individually tracked for the first time
(`GrifterSlot: { id, wealth, daysAsGrifter }`) — a deliberate expansion of Phase B's
earlier scoping decision to leave the gossip layer aggregate-only. Miller/Baker keep their
existing Cournot/Bertrand mechanics; Courier/Journalist/Detective get a flat
`SUPPORT_ROLE_DAILY_WAGE` (`wealth.ts`) — no differentiated economic mechanic is designed
for any of the three anywhere in this project, flagged as a placeholder standing in for
three genuinely different unbuilt economies. `GRIFTER_DAILY_INCOME` is the roleless floor,
below every role's wage but strictly positive (constraint 2).

**Mechanism.** `sim/multiRoleConscription.ts` (new file) generalizes the existing 2-role
`conscriptionHarness.ts`'s `stepConscriptionDay` to N roles sharing one real grifter pool,
reusing `vacancy.ts`'s `stepSlot`/`fillHazard` unmodified. The old function is untouched.
Churn returns a role-holder to the grifter pool (they're still present, just roleless);
BACKSTOPPED slots draft from grifters or evict another role's FILLED member, generalizing
the old Miller-only-conscription/gossip-vs-other-role weighting symmetrically across all 5
roles. Role-to-building assignment is now district-aware (round-robins across all 5 roles
through the district-ordered building sequence, replacing "first N buildings in generation
order"). `wealthGini`/`wealthTop10Share` now span all 5 roles + grifters — every
identity-bearing player — widened from the old Miller+Baker-only scope now that grifters
have individual wealth to include. `wealthTaxRate`/`wealthCap` stay scoped to Miller+Baker
only, an explicit open scoping question, not silently decided either way.

**A real bug found and fixed, then formalized as a test.** Module-level tests for
`multiRoleConscription.ts` verified arithmetic pool conservation but never checked
non-negativity. `fillHazard`'s willingness math has no concept of a real, finite, shared
candidate pool (never needed one with only 2 roles, each with its own abstracted "N-R"
count). With 5 roles drawing from one real pool, multiple roles could independently roll a
genuine fill the same day and jointly overdraw it — slots flipped to FILLED without a real
grifter behind them, breaking population conservation. Fixed by gating voluntary fills on
real same-day availability, same pattern already used for the grifter-sourced conscription
branch. `grifters.length + total FILLED across all 5 roles == population` is now an
explicitly tested invariant, every tick, across long runs and multiple seeds.

**Bigger finding, deliberately not resolved here.** `src/sim/districtRoleSweep.ts` (built
to derive the role-slot allocation and district count from simulation, as asked, not
guess them) shows population collapsing well below `targetPopulation=65` at *every*
role-split candidate tested — current default settles around **26.6**, others range
roughly **7 to 37** over a 2000-day/3-seed run. Confirmed this is not a 5-role-specific
artifact: the same S=24 split (Miller=8/Baker=16, matching the pre-existing default) run
through the NEW kernel still settles around 28. Confirmed separately that some drift
already existed in the OLD, pre-session, already-validated 2-role kernel too — running the
actual pre-session code unmodified (`git stash`) over the same window shows it settling
around 46, not 65 — so `world.ts`'s composed kernel apparently never got checked at this
timescale before (its own tests never ran past a few hundred ticks). The NEW kernel's
drift is considerably worse.

Root cause: `vacancyParamsFor`'s `N` uses the static `config.targetPopulation` (a
pre-existing simplification, untouched here), so `fillHazard`'s fill probability is
numerically identical old vs. new. The only actual difference is the correctness fix
above — a successful roll can now be vetoed when there's no real grifter to fill it. Once
population drifts down for any reason, the now-finite, now-shared-across-5-roles grifter
pool shrinks too, the veto bites more, refills slow further, the roleless fraction
`migrationValveStep` reacts to rises, emigration pressure increases, population drops
further. A genuine negative feedback loop toward collapse — see full trace and numbers in
`docs/DEVLOG.md`'s 2026-08-11 entry.

Also flagged mid-discussion by the user, not yet modeled: shard **arrivals** currently use
a flat, uncalibrated `arrivalPDaily` constant representing brand-new players, with no
concept of *existing* players migrating in from elsewhere — while `migrationValveStep`
gives emigration a real, reactive, population-and-staffing-driven rate. A single-shard
kernel has no natural pool of "other shards' players" to draw an inflow rate from without
either simulating multiple shards or modeling an abstracted external pool — an open
design question, not resolved here, but plausibly a significant piece of the collapse
above (a real, reactive outflow paired with a flat trivial inflow is inherently unstable).

**Deliberately NOT resolved**: `DEFAULT_WORLD_CONFIG`'s role split (Miller 3/Baker 7/
Courier 6/Journalist 5/Detective 3, S=24) ships as a working, population-conserving,
fully-tested default, but is explicitly NOT claimed to be "the cleanest and fairest"
allocation the user asked to derive — picking one from the sweep would be meaningless
while population collapses under every candidate regardless of split. The rebalancing
question (migration valve calibration, arrival model realism, and a still-undesigned 6th
"Import/Export" role adding a further hard resource constraint on Miller output) needs to
be settled first.

**Verification.** 26 new tests (support-role wage/grifter income constants;
`multiRoleConscription.ts` determinism, population conservation, both draft sources,
no-draftees edge case, the non-negativity fix; world-level 5-role/grifter population
conservation across long runs and seeds, grifter income floor and `daysAsGrifter`
tracking, support-role wage and reset-on-new-occupant, district-aware assignment, widened
wealthGini scope). 200 tests total, all passing; `npm run typecheck` clean. Golden-value
snapshot regenerated (deliberate, documented) — tick shape and behavior both changed.

## District consolidation + shard registry (2026-08-11) — the population-collapse fix

**Design, user-specified across two passes.** First pass sketched a shard-level fracture;
corrected in the second pass — the trigger is UNDERpopulation (not overcrowding, which was
this author's own initial misreading), and the real mechanism is a **district**-level
merge within a shard that can escalate to a shard-level active/dormant split: a district's
health is an irreversible ratchet (once it tips into decline, it cannot recover), displaced
role-holders get a visible notice and 2 weeks to pick a new role or be drafted, decline is
felt through degraded trade-route access before anyone is forced to move, and the shard
universe starts at 2, only ever grows (shard ids monotonic, never deleted), gated on
population + a stability threshold + a cooldown after the first extra one. User chose to
build the district mechanic, trade-route friction, and the full shard registry together
rather than a narrower first cut, then added: "we always find issues to resolve" — which
is exactly what happened, twice (see below), both caught before shipping.

### `engine/districtConsolidation.ts` — the district-health primitive

`DistrictHealth { state: 'ACTIVE'|'CONSOLIDATING'|'MERGED'; consolidatingSince }`.
`stepDistrictHealth` is a one-way ratchet: ACTIVE moves to CONSOLIDATING once the
district's own FILLED-role fraction drops below `DISTRICT_TIPPING_POINT_FILLED_FRACTION`
(0.3, `[ILLUSTRATIVE]`); CONSOLIDATING moves to MERGED after `CONSOLIDATION_GRACE_DAYS`
(14 — a deliberate echo of `conscriptionDelay`'s own default) regardless of any later
recovery in filled fraction. `consolidationFrictionMultiplier` ramps a service-access
multiplier from 1.0 down to `CONSOLIDATION_FRICTION_FLOOR` (0.25, strictly positive —
constraint 2) across that same grace window — the "cracks forming" made economically felt,
not just narratively visible.

### `engine/shardRegistry.ts` — the multi-shard lifecycle, at the population-count level

Deliberately NOT N full economic kernels running concurrently inside this module — a
lightweight ledger (`ShardRecord { id, state: 'ACTIVE'|'DORMANT', population,
openedOnDay }`), composed with real `World` instances one layer up in
`sim/multiShardHarness.ts`, matching this repo's standing "harness composes pure engine
primitives" pattern. `createShardRegistry` starts with `INITIAL_SHARD_COUNT=2`, both
ACTIVE. `canOpenNewShard` requires three independent gates: mean population across
currently-populated shards at or above `targetPopulationPerShard * SHARD_OPEN_SURPLUS_FACTOR`
(1.0), mean `economicHealth` across those same shards at or above
`SHARD_OPEN_STABILITY_THRESHOLD` (0.8), and `SHARD_OPEN_COOLDOWN_DAYS` (30) since the last
shard opened. `chooseMigrationDestination` always picks among shards actually in the
registry — "can't move to somewhere that doesn't exist" — preferring a DORMANT shard so a
real arrival wakes it, otherwise spreading toward the lowest-population ACTIVE shard.

### Wiring into `world.ts`

A district crossing into MERGED evicts every role-holder physically in it into the grifter
pool, each tagged with a hard `consolidationDeadline` (`day + CONSOLIDATION_GRACE_DAYS`).
Ordinary self-selection (voluntary fill, ordinary conscription) gets first chance every
day; once a grifter's deadline passes, a forced pass places them into any open role that
exists anywhere, bypassing the probabilistic machinery entirely — "2 weeks to gain a role
or be drafted." Trade-route friction scales Miller/Baker/support-role income by their
building's district health (grifters have no fixed position in this model — same
simplification `space.ts`'s `placeArrival()` already left unused — so friction doesn't
touch the grifter floor). `stepWorld` now exposes `lastEmigrants`/`lastNewArrivals`
(previously silently absorbed into `population`) plus `receiveMigrants()` and
`createDormantWorld()`, so a multi-shard orchestrator can route real emigrants to a real
destination instead of them vanishing.

### `sim/multiShardHarness.ts`

Steps every shard that has a running `World`, collects each one's `lastEmigrants`, routes
each emigrant through `chooseMigrationDestination` (lazily creating a `createDormantWorld`
for a shard that's never received anyone), then checks `canOpenNewShard`. This is the
piece that actually fixes the collapse: `migrationValveStep` was pushing people OUT of a
shard with nowhere real to land, an inherently unstable one-way valve; now they land
somewhere real, keeping that destination healthy instead of the population simply
shrinking every time someone leaves.

### Two real bugs, caught by testing before shipping, not assumed away

**Bug 1 — permanent capacity deletion.** An earlier version permanently excluded a MERGED
district's buildings from ever refilling ("logically removed, not physically spliced").
Two long-run world tests caught this collapsing Miller+Baker FILLED counts toward zero —
every district eventually merges under enough noise, and deleted capacity never returns,
contradicting "combine into half the shard" (concentrates capacity, doesn't delete it) and
constraint 2 applied at whole-shard-economy scale. **Fixed**: a MERGED district's
buildings stay in the ordinary vacancy/conscription pool; the lasting consequence is the
one-time eviction plus the permanent friction floor, not a capacity cliff. Physically
relocating buildings between districts at runtime is a larger change, deliberately
deferred and flagged here, not silently done partway.

**Bug 2 — runaway shard growth.** The first working `canOpenNewShard` used a flat
total-population floor (`SHARD_OPEN_MIN_TOTAL_POPULATION=120`). Once 2-3 shards are
healthy, a flat total trivially clears itself forever, so every subsequent shard opened
the moment its cooldown expired — **102 shards after 3000 days** in the first validation
run, caught by `multi-shard-validation`'s own numbers, not assumed correct because the
design sounded right. **Fixed**: gate on the MEAN population across currently-populated
shards instead of a flat total — existing shards must be genuinely near-full before
another is justified, and opening one immediately dilutes the mean again, so growth
self-paces. `SHARD_OPEN_MIN_TOTAL_POPULATION` is gone; replaced by
`SHARD_OPEN_SURPLUS_FACTOR`.

### User mid-flight correction: "N shouldn't be flat given illegal migration failure rates"

Two things folded in. First, an already-flagged pre-existing simplification finally fixed:
`vacancyParamsFor`'s `N` used the *static* `config.targetPopulation`; now uses live
`world.population`, so `fillHazard`'s candidate-pool math honestly tracks a shard's actual
headcount instead of staying artificially optimistic while population is collapsed or
recovering. Second, a new placeholder: `multiShardHarness.ts`'s
`MIGRATION_FAILURE_RATE=0.15` (`[ILLUSTRATIVE]`) — some fraction of attempted cross-shard
moves simply fail and never arrive anywhere, standing in for the not-yet-designed
Import/Export legal/illegal route-detection mechanic (postcard/tier-gated legal routes vs.
detection-gated illegal ones) until that system is actually built. To be replaced by
Import/Export's real math, not left as a permanent guess.

### Final validation (`npm run multi-shard-validation`, 3000 days, 3 seeds)

Single-shard baseline collapses to **8.1/65** mean population — worse than the 27.4/65
seen before the live-N fix, an honest consequence of removing the old model's optimistic
bias, not a regression introduced by this work. Multi-shard registry settles at **3
shards, 44.5/65 mean population per shard** — a real, substantial improvement (real
evidence the fix helps, not assumed), though not fully healthy yet (≈68% of target),
reported plainly rather than rounded up. Further tuning (`fillHazard`'s beta/tPain, the
migration failure rate, or the stability threshold) is still open — see `HANDOVER.md`.

**Deliberately NOT resolved here**: "the cleanest and fairest" role/district allocation
(`districtRoleSweep.ts`) still can't be honestly re-derived until this rebalancing itself
gets re-swept against — the sweep predates all of this session's fixes. Import/Export
remains unbuilt, parked behind this work per the user's own sequencing, and now has an
obvious home for its route-detection math. Physical building relocation between merging
districts is deferred, flagged, not silently narrowed away.

**Verification.** 33 new tests (10 `districtConsolidation`, 17 `shardRegistry`, 6
`multiShardHarness`) plus 2 existing `world.ts` tests fixed to stay robust to two new,
legitimate sources of run-to-run variation this work introduces (trade-route friction
touching an exact-value assertion; live-N/friction touching a single-seed Gini snapshot,
now averaged across 5 seeds). 233 tests total, all passing; `npm run typecheck` clean.
Golden-value snapshot unchanged (no district crosses its tipping point within the pinned
test's short, fully-staffed 25-tick window).

## 5-role/district allocation, re-derived (2026-08-11) — the question finally answered

**Why re-derive, not reuse the earlier sweep.** `districtRoleSweep.ts`'s numbers (the
original "5-role roster" entry above) predate the district-consolidation, shard-registry,
and live-N fixes — they describe a system that no longer exists. Re-running that same
script confirms as much: a single shard alone still collapses hard in isolation (meanPop
7-23/65, worse than before — expected, live-N removed an optimistic bias, see the previous
entry), which makes judging "cleanest and fairest" against it actively misleading now that
the real fix is the multi-shard registry, not any single shard's own settings. Built
`sim/multiShardRoleDistrictSweep.ts` instead — same metrics, same candidate pool, but
every candidate run through the actual composed system (`multiShardHarness.ts`), 1500
days, burn-in 300, 2 seeds, per-shard population/health/Gini/grifter-wait sampled across
every shard in the registry, not one.

**Role split: the total mattered, not the distribution.** All six S=24 candidates
clustered tightly (44.1-44.7/65 mean per-shard population, 68-69% of target;
0.847-0.860 health; 0.518-0.542 Gini) regardless of how those 24 slots were divided
across Miller/Baker/Courier/Journalist/Detective — no split meaningfully beat another at
the same total. S=18 was strictly worse on every axis (34.7/65, 0.814 health, worse Gini
too) — not a real tradeoff, just an under-resourced shard. **S=30 was the one candidate
that separated itself**: 53.3/65 (82%), 0.875 health — clearly better staffed — at a real
but proportionally smaller cost (Gini 0.563, the worst tested, vs. 0.518-0.542 for the
S=24 cluster; grifter mean wait 19.3 vs. 18.1-18.9). Judged worth it: "cleanest and
fairest" means both staffed and equitable, not equity purchased by leaving a shard
under-resourced. **`DEFAULT_WORLD_CONFIG` moves from Miller 3/Baker 7/Courier 6/Journalist
5/Detective 3 (S=24) to Miller 4/Baker 8/Courier 8/Journalist 7/Detective 3 (S=30)** — the
one S=30 split actually tested, not an exhaustive search across every possible
distribution at that total; a real, evidence-backed decision, not a final optimum.

**District count: a genuine, monotonic tradeoff, kept at the balance point.** Swept 3
(fewer/bigger), 6 (default), and 11 (more/smaller) districts with the role split held
fixed. Fewer/bigger districts staff better (48.5/65, 0.903 health) but are less equal
(Gini 0.585, worst of any candidate tested in this whole pass) and leave grifters waiting
longest (22.2/108 mean/max days). More/smaller districts are the fairest and fastest for
grifters (Gini 0.459, wait 14.1/76) but worst-staffed (38.9/65, 0.768 health). Mechanism,
traced not assumed: `districtFilledFraction` averages over however many role slots a
district has — fewer, bigger districts smooth that average over more slots, so the
irreversible consolidation ratchet trips less often, avoiding the compounding friction
penalty; more, smaller districts are individually more volatile, trip more often, and
each merge event redistributes its displaced players faster into a smaller overall system
— fairer, but at real staffing cost. **6 districts (2 core + 4 periphery, the existing
default) sits almost exactly between both extremes on every metric measured** — kept
deliberately, not left unexamined; moving either direction trades one half of "cleanest
and fairest" for the other, and 6 is where neither is sacrificed for the other's sake.

**Verification.** `npm run multi-shard-role-district-sweep` (new script, checked into
the repo) reproduces these numbers. `test/world.regression.test.ts`'s "the default role
split sums to..." test updated (24 → 30); golden-value snapshot regenerated (deliberate —
`DEFAULT_WORLD_CONFIG` changed). 233 tests total, all passing; `npm run typecheck` clean.

**Still not exhaustive, flagged not hidden**: only one split was tested at S=30 and only
three district counts were tested at all — a finer grid search (S=26/28/32, more district
counts, joint role-split × district-count combinations) could still find something better.
This is the first evidence-backed answer to "derive role numbers and district count," not
claimed to be the global optimum.

## Multi-shard equilibrium + the opportunity valve (2026-08-11) — what actually sets population

**The "~68% of target" concern was two separate things, and instrumenting beat guessing.**
Rather than sweep constants until a number improved, the actual flows were measured. Two
findings, both verifiable by re-running `npm run multi-shard-equilibrium-sweep`:

**1. Equilibrium is an exact inflow/outflow balance.** The ONLY population inflow is
`arrivalPDaily` per shard per day; the ONLY outflow is a failed cross-shard migration
(a successful one conserves population exactly; churn, conscription and district merges
only ever move people between roles and the grifter pool). So the system must settle where
`arrivalPDaily x shardCount == migrationFailureRate x emigrantsPerDay`. Measured at the
shipped defaults: 0.303 arrivals/day vs. 0.295 failures/day — the accounting balances,
confirming the governing relationship rather than assuming it.

**2. A real bifurcation — "just raise population" is not free.** Both obvious levers
(raise `arrivalPDaily`, lower `migrationFailureRate`) do raise population, and both trigger
unbounded shard proliferation past a critical point, because a fuller shard satisfies
`canOpenNewShard`'s gate and every new shard adds its own arrival inflow — positive
feedback on shard count. Measured: `arrivalPDaily` 0.10 -> 3 shards, 0.20 -> 31, 0.45 ->
100 (cooldown-capped); `migrationFailureRate` 0.15 -> 3 shards, 0.10 -> 5.3, 0.04 -> 42.

**Also corrected: the per-shard mean was hiding nothing, and 65 is not a floor.** Verified
per-shard rather than trusting the aggregate — all shards sat evenly (54.6/55.1/54.8 at
one seed), no thin shard buried in the mean. And the brief's own stated range is **50-80
players per shard**, so `targetPopulation=65` is the midpoint of that band, not a minimum
being missed. The stale "68%" figure in earlier docs was measured against the pre-S=30
default and should not be quoted.

### The opportunity valve — the structural fix (user-specified)

User's steer: "adapt the mechanics of the Oracle and economic opportunity possibilities to
stabilize ... purely statistics, no bias." That named a genuine flaw. `migrationValveStep`
keys emigration purely off the roleless FRACTION, which conflates two completely different
situations: 28 roleless players with 4 open role-slots (real, reachable opportunity) versus
70 roleless players with every slot filled (none). Both produce identical emigration
pressure — which is why the system had no negative feedback holding population up: nothing
about a shard emptying out made it more attractive to stay in.

`opportunityAdjustedMigrationStep` (`engine/ecosystem.ts`, a NEW function — the validated
`migrationValveStep` is untouched, same discipline as `multiRoleConscription.ts` vs.
`stepConscriptionDay`) damps emigration by **open role-slots per roleless player**. As a
shard thins, open slots rise while the roleless pool shrinks, so opportunity climbs sharply
and emigration is suppressed — the shard becomes genuinely worth staying in and recovers.
As it fills toward its role-slot ceiling, open slots approach zero, damping vanishes, and
emigration returns to full strength — so it **cannot** cause the runaway regime above; it
has no effect at all at the crowded end, precisely where that risk lives.

Pure arithmetic on counts already tracked — nothing with behavior or belief to infer
(constraint 3), every player in a shard sees the identical figure (no bias, no per-player
targeting), and it only ever REDUCES emigration, never increases it, so it cannot push a
shard toward a zero-state (constraint 2).

**`OPPORTUNITY_WEIGHT=2.0`, set from a sweep, not guessed** (3000 days, 3 seeds; per-shard
population, weakest shard, shard count): 0 -> 54.6 (51.7), 3.0 | 1 -> 57.9 (57.3), 3.3 |
**2 -> 59.0 (57.0), 3.7** | 3 -> 59.8 (60.3), 5.3 | 5 -> 60.2 (61.0), 9.7 | 8 -> 61.1
(61.3), 13.3. Weight 2 takes most of the available gain (84% -> 91% of target) while the
registry stays essentially bounded; past it population flattens as shard count accelerates.

**Result** (`npm run multi-shard-validation`): the isolated single-shard baseline improved
from **8.1/65 to 38.5/65** — a lone shard can now retain people instead of only bleeding
out — and the multi-shard registry from 44.5 to **51.3/65** across 3.67 shards. The valve
helps most exactly where the system was weakest, which is what a stabilizer should do.

**Why `migrationFailureRate` was NOT retuned**: it is an explicit placeholder for
Import/Export's unbuilt legal/illegal route-detection mechanic, so its real value must come
from that design, not from population balancing. The sweep is checked in so whoever builds
Import/Export can see exactly what a chosen detection rate does to equilibrium and shard
count before picking it.

**Oracle presentation (user-specified, recorded — not built)**: an AI in human form,
half-bodied on a metal platform, embedded like an ATM machine but large, lit and glowing so
it reads as positive *irrespective* of the economic situation or any prize reduction.
Mechanically load-bearing, not just flavour: because its presentation never signals
decline, players cannot read shard health off it, preserving the information asymmetry.
Outputs stay deterministic — no AI involvement in the implementation.

## Named per-role resources (2026-08-11) — and the incoherence they immediately exposed

User-specified: "create arbitrary resources as named variables, make them suitable to the
role and associate them with real numbers I can track over time." `engine/resources.ts`
(pure, dependency-free) names six: **grain** (Import/Export — unbuilt), **flour** (Miller),
**bread** (Baker), **parcels** (Courier), **stories** (Journalist), **leads** (Detective).
One owning role each. Tracked as both per-day flows and cumulative totals on
`World.resources`, so a shard's activity is observable rather than implied —
`npm run resource-report` prints the real time series.

**What is derived vs. invented, kept distinct.** Miller flour is that Miller's own
competed-for Cournot quantity; Baker bread is its own served-customer count from
`wealth.ts`'s validated demand model — this module only *names and records* what those
layers already computed, changing no market behaviour. The three support-role rates are
genuinely new `[ILLUSTRATIVE]` constants, since no mechanic exists anywhere to derive them
from. Support output also takes district trade-route friction, so a Courier in a declining
district really does move fewer parcels — the same consequence their income already takes.

**A real defect surfaced the moment the numbers existed.** The grain->flour->bread chain
was quietly incoherent: at an initial `FLOUR_PER_BREAD=0.35`, Bakers drew ~1.39 flour/day
while 4 Millers milled ~1.09 — a permanent ~31% deficit, i.e. bread being baked from flour
that was never milled. Invisible before this, because nothing tracked it. Resolved in the
direction that respects what is validated: `rMiller=4` came from a real multi-shard sweep
(population/health/equality), whereas the ratio was a fresh invention — so the invented
constant yields, not the derived role split. Measured break-even by Miller count:
3 -> 0.193 | 4 -> 0.274 | 5 -> 0.318 | 6 -> 0.381 | 7 -> 0.426 | 8 -> 0.477. Shipped
**0.25** (0.27 still left a 3-8% deficit across seeds at 1500 days), holding a small
structural surplus — the correct side to err on with no stockpile simulated. Locked by a
regression test asserting the consumed/milled ratio stays under 1.05.

**Grain has no producer, deliberately.** It accumulates as real, measurable demand with no
supply behind it — the exact size of the hole Import/Export exists to fill ("they receive
nodules every day to trade with the Miller"), quantified before that role is built rather
than papered over. ~2562 units over 2000 days on one shard at the shipped defaults.

**Reported, not enforced.** No stockpile is simulated, so a flour imbalance cannot starve
anyone — enforcing it would need a real stock and a real answer to constraint 2 first.

## Import/Export + nodules (2026-08-11) — the 6th role, and Millers finally get an input

User-specified. The role does two jobs the economy already had holes shaped for.

**1. Supply.** "They receive nodules every day to trade with the Miller." Nodules arrive
daily and automatically — not a player action ("automated to the miller if offline") — and
convert to grain, which Millers consume to mill flour. Millers have never had a raw-material
input in this codebase; now they do, and it binds. Deliberate split: the grain factor
constrains **realized** output, not the Cournot best-response dynamics themselves, so
`millers.ts`'s validated convergence is untouched while grain becomes a real dependency.
`rImportExport=2`.

**2. Movement.** "They also control human movement across shards with legal and illegal
routes." This **replaces** `multiShardHarness.ts`'s flat `MIGRATION_FAILURE_RATE=0.15`
placeholder with a real mechanism, mapped onto the EXISTING postcard/tier exit-ticket system
rather than inventing a second currency: a **complete ticket** ("gambled or not" — how it was
completed is irrelevant) is the legal route, passage without friction; **partial progress**
("half a postcard full") opens the illegal route, subject to interception.

**Detection is not an agent.** Interception runs continuously with "behaviour randomised so
you can't figure out any pattern" — modelled as a per-attempt probability drawn fresh from
the shard RNG with NO state between attempts. That is stronger than a patrol schedule that
merely looks random: there is literally no pattern to learn because nothing persistent
generates one, and nothing with behaviour, memory or intent to model or deceive
(constraint 3 — same reasoning as the vacancy backstop and the Oracle).

**Calibration preserved, not silently moved.** `COMPLETE_TICKET_FRACTION=0.57` against
`INTERCEPT_BASE_P=0.35` makes the emergent failure rate ~0.149 — reproducing the 0.15 all
prior multi-shard calibration was validated against, so the mechanism swaps in without
shifting the equilibrium underneath everything already measured. Verified over 200k trials.

**Constraint 2 is load-bearing here** in a way it was not for other roles: grain is an INPUT,
so an unstaffed Import/Export could otherwise starve flour and through it the whole shard,
with no way back. `BACKSTOPPED_NODULE_FRACTION=0.4` keeps a mechanically-covered slot
delivering reduced-but-real supply — squeezed, never killed, mirroring `BACKSTOP_PRODUCTIVITY`.

### A circular-measurement error, caught and corrected

`NODULES_PER_DAY` was first set to 4.0 against grain demand of ~1.28/day/shard measured
*before* the supply gate existed. That figure was **circular**: `resources.ts` derives
`grainConsumed` from flour actually milled, so once milling became grain-limited the
"demand" it reported was itself already suppressed — the constant looked adequate while
permanently throttling Millers to ~68% capacity. Measuring UNCONSTRAINED demand instead
(intended Cournot supply x activity x `GRAIN_PER_FLOUR`) gives ~1.68/day, against which 4.0
delivered only ~1.14. Corrected to **6.0**, giving real headroom at typical staffing
(~1.85/day) so grain binds only when Import/Export is genuinely understaffed — the intended
pressure, not a constant tax. Milled flour recovered from 1026 to 1292 over 1500 days.

**Knock-on, handled honestly**: adding 2 slots (S=30 -> 32) diluted staffing enough that
`FLOUR_PER_BREAD` went ~13% short in turn, so it moved 0.25 -> **0.22** to restore chain
coherence (ratio now 0.95-1.02). That constant and the role allocation are **coupled** and
should be re-derived together once the 6-role split is swept — re-tuning it alone each time
a role count moves is a stopgap, flagged as such, not the eventual answer.

**Total role slots is now 32**, so the S=30 sweep that set the other five predates this role
and needs re-running — flagged in `docs/HANDOVER.md`, not quietly ignored.

## Six-role allocation, re-derived (2026-08-11) — and the incoherence it caught

Re-run after Import/Export landed, superseding the five-role S=30 conclusion (which
predated the role). `sim/multiShardRoleDistrictSweep.ts` now judges candidates on
population/health/equality **and supply-chain coherence together**, because they are
coupled: adding role slots dilutes staffing, which lowers milled flour, which moves the
break-even `FLOUR_PER_BREAD`. Each candidate reports its own `flourRatio` (flour consumed /
milled; <= 1.0 coherent) and the break-even value that would make it coherent — so the
constant follows the chosen allocation instead of being chased after it.

**That coupling immediately caught a real defect.** The then-shipped default
(M=4 B=8 C=8 J=7 D=3 IE=2) ran a `flourRatio` of **1.222** — Bakers baking flour nobody
milled — invisible to every population-only metric, and not caught by the earlier
single-shard tuning of `FLOUR_PER_BREAD` because the multi-shard system runs more shards at
lower staffing. Two other candidates (support-heavy 1.579, S=26 1.141) were incoherent too.

**Measured, 1500 days, 2 seeds** (coherent candidates only):

| split | pop/65 | health | gini | flourRatio | shards | grainCover |
|---|---|---|---|---|---|---|
| M=6 B=8 C=6 J=6 D=3 IE=3 | 58.7 | 0.870 | 0.531 | 0.808 | 4.5 | 1.47 |
| **M=5 B=6 C=6 J=6 D=5 IE=4** | **57.8** | **0.864** | **0.505** | **0.921** | **4.0** | **2.24** |
| M=7 B=6 C=7 J=6 D=3 IE=3 | 58.4 | 0.869 | 0.521 | 0.704 | 4.5 | 1.32 |

**Shipped: M=5 B=6 C=6 J=6 D=5 IE=4 (S=32), `FLOUR_PER_BREAD=0.23`.** It gives up ~1.5%
population — inside noise — for the best equality of any coherent candidate (0.505), the
most bounded shard count (4.0 vs 4.5), and the widest grain headroom (2.24x vs 1.32-1.47).
"Cleanest and fairest" reads as staffed AND equitable, and the population differences here
are not real separation. S=38 was rejected despite decent numbers because it drove shard
count to 10 — the proliferation regime; S=26 was both thinner and incoherent. **Miller
stays deliberately scarce** at 5 of 32, honouring the brief's own intent for that role.
Verified after the change: flourRatio 0.74-0.77, grain cover ~2.4x, milled flour up from
1292 to ~1850 over 1500 days.

**District count stays at 6.** Re-checked with the shipped split: 3 districts give better
health (0.925) but the worst equality (0.567) and longest grifter waits (27.6/125); 11
districts give the best equality (0.470) and shortest waits but the worst health (0.855).
6 remains the balance point — the same monotonic tradeoff found before, unchanged by the
6th role.

**Still not exhaustive**, flagged rather than overclaimed: 7 allocations and 3 district
counts were tested, not a joint grid search over every combination.

## Joint grid search: allocation x district layout (2026-08-11) — the interaction it found

The previous sweep tested hand-picked allocations against district counts **separately**,
and was flagged as not a joint search. This closes that gap, coarse-to-fine because a full
joint grid at full fidelity is unaffordable:

- **Phase 1 (screen)** — all **560** allocations (totals 28/30/32/34) at reduced fidelity,
  default layout. **154 (27.5%) discarded outright as INCOHERENT** — Bakers consuming more
  flour than Millers mill. Coherence is a hard filter, never a scored metric: no population
  or equality number redeems baking flour nobody produced.
- **Phase 2 (confirm)** — 8 finalists x 3 district layouts at full fidelity (1500 days,
  2 seeds). Only Phase 2 numbers inform the decision.

**A screening bias, caught by inspection rather than assumed away.** At the 500-day screen
horizon shard count has not yet grown, so per-shard population is inflated for allocations
that merely *delay* the first shard opening — which systematically favours small totals
(every top-15 screen result showed 2 shards). Finalists were therefore promoted as **top 2
per total**, not top N overall, so the bias could not decide the shortlist.

**What only a joint search could show: coherence depends on district count too.** Three
finalists coherent at 3-6 districts go incoherent at 11 (flourRatio 1.000, 1.007, 1.027) —
more districts means more consolidation, less milling, and the flour chain tips. Sweeping
each axis separately structurally cannot surface that interaction, and any allocation
chosen at one layout can silently break at another.

**The district axis is monotonic and robust across every allocation tested**: 3 districts
give the best health (0.919-0.928) and the worst equality (0.555-0.611) with the longest
grifter waits; 11 districts invert it exactly (health 0.840-0.854, gini 0.454-0.477,
shortest waits); 6 sits between. That the ordering holds across all 8 allocations makes it
an axis-level property, not an artifact of any one split.

**Chosen: M5 B5 C5 J5 D5 IE3 (S=28) at 6 districts**, replacing M5 B6 C6 J6 D5 IE4 (S=32):

| metric | chosen | previous |
|---|---|---|
| gini | **0.486** (best of any allocation at 6 districts) | 0.514 |
| grifter mean wait | **22.0 days** | 23.2 |
| shard count | **3.0** (most bounded in the grid) | 4.0 |
| flourRatio @ 3/6/11 districts | **0.875 / 0.966 / 0.976** — coherent at every layout | — |
| per-shard population | 56.1 | 59.3 |
| health | 0.860 | 0.873 |

The population and health costs are real and stated plainly; both are small, and 56.1 sits
comfortably inside the brief's own 50-80 band, so it is in spec rather than a shortfall.
This is the only near-even split that stays coherent at **every** district count, so the
choice does not depend on the layout decision — which, given the interaction above, is
worth more than a marginally better score at one layout.

**Miller stays deliberately scarce at 5 of 28.** Several M7-based candidates scored well on
coherence margin (flourRatio 0.63-0.73) purely by adding Millers, and were rejected for
undermining a core design pillar rather than accepted for a better number.

**11 districts is a live alternative, not a rejected one**: it trades ~1.4% health for ~6%
better equality and shorter grifter waits. Not taken because it thins flour-coherence
margin markedly — three of eight finalists fail there outright.

**Still bounded**: totals above 34 were excluded (the equilibrium sweep already showed they
drive shard proliferation) and Courier/Journalist were derived from the remainder rather
than varied independently, so this is a large structured grid, not every conceivable split.

## District layout head-to-head, and a consolidation defect it exposed (2026-08-11)

Ran 6 vs 11 districts deeply at the shipped allocation (2500 days, 3 seeds), instrumenting
the MECHANISM — how many districts actually trip the ratchet — not just the outcomes.

**A documented mechanism of mine was simply wrong.** BLUEPRINT and `space.ts` previously
claimed smaller districts are "individually more volatile, trip the ratchet more often."
The measurement says the opposite: 11 districts end up **less** merged than 6 (12.1% vs
22.2%). Smaller districts hold fewer role slots, so crossing a 30%-filled threshold
requires nearly all of them empty at once, which is rarer — a discretisation effect, not
volatility. Corrected rather than left standing.

**A real defect, found by instrumenting rather than by a failing test.** With an
instantaneous trigger, an irreversible ratchet is an **absorbing state**: any district
dipping below the threshold for a single day was permanently doomed, and over a long run
every district has one bad day. Measured: **all 4 slot-bearing districts MERGED by day 500
and stayed merged forever**. The mechanic fired once, universally, then never again —
trade-route friction degenerated from a signal into a flat tax on the whole shard, and the
2-week grace/draft never triggered again for the remainder of the run.

**Two attempts, because the first was wrong too.** Requiring N consecutive days below the
threshold on the raw fraction did not fix it — a sweep showed a cliff, not a gradient: at
<=14 days every district merged, at 21 none did, and *the result was identical for healthy
and collapsing shards*. The trigger discriminated nothing. The metric was at fault: a
district's raw filled fraction is small and lumpy (a 3-slot district reads 0.00 whenever
its occupants are briefly between assignments), so ordinary churn and genuine decline look
the same day to day, and counting consecutive days on that signal can only be all-or-nothing.

**Fix: smooth the signal first** (`CONSOLIDATION_EMA_ALPHA`, ~30-day EMA), then apply the
unchanged tipping point and irreversible ratchet. Now it discriminates — districts merged
by shard condition, 3000 days, replayed trajectories:

| trigger days | 3 | 5 | 7 | 10 | 14 | 21 | 30 |
|---|---|---|---|---|---|---|---|
| thin but viable (35) | 2/4 | 1/4 | 1/4 | 0/4 | 0/4 | 0/4 | 0/4 |
| very thin (22) | 4/4 | 4/4 | 4/4 | 4/4 | 3/4 | 1/4 | 0/4 |
| collapsing (16) | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

`CONSOLIDATION_TRIGGER_DAYS=21` fires reliably on genuine collapse, occasionally on a very
thin shard, and never on one whose population matches its role slots. **Irreversibility is
untouched** — the user's explicit design ("once passed a tipping point can't be reversed")
is preserved; what changed is that a transient dip is no longer treated as a tipping point.

**Post-fix, consolidation is an occasional pressure again**: 22.2% merged at 6 districts,
12.1% at 11, versus 62.5%/36.3% before.

**Outcome of the 6-vs-11 comparison: 6 districts stays.** With the defect fixed the case
for 11 is *weaker* than the joint grid suggested — equality gain shrinks to 1.7% (was 4.9%)
while the health cost grows to 2.4%, population is 1.2% lower, and coherence margin is 3.6%
thinner. 11 still wins on grifter wait (-5.0%), so it remains a live option if wait time is
weighted heavily, but it is no longer close to a free improvement.

## Joint grid re-run after the consolidation fix (2026-08-11) — what changed, and what didn't

The first joint grid was measured *through* the absorbing-state defect, so every conclusion
it reached about district count stood on a broken mechanic. Re-ran both phases against the
fixed system, with the currently-shipped allocation added explicitly as an incumbent
baseline — otherwise a "winner" cannot be shown to actually beat what is live.

**What held.** The screen is essentially unchanged: 560 allocations, **151 discarded as
incoherent** (was 154). The failure mode is structural, not an artifact of the defect.

**What broke: the shipped allocation lost its main selling point.** M5 B5 C5 J5 D5 IE3 was
chosen partly because it stayed coherent at *every* district count. With consolidation
fixed, milled flour changed and it now reads flourRatio **1.000 — outright incoherent — at
11 districts**, and only ~4% margin (0.959) at the shipped 6. The property it was selected
for no longer held once the mechanic underneath was correct.

**The tempting fix was the wrong one.** M6 B5 C5 J4 D5 IE3 inherits exactly that property
(0.730 / 0.823 / 0.831 across 3/6/11 districts) and is otherwise **identical** to the
incumbent on every outcome metric — population 57.7 vs 57.4, health 0.864 vs 0.866, Gini
0.548 vs 0.549, waits 22.2 vs 22.5, shard count 3.0 either way. It buys ~4x the coherence
margin by adding a Miller. That is the same scarcity trade already rejected for the M7
candidates, just smaller — so it was rejected again, for the same reason.

**Fix applied instead: `FLOUR_PER_BREAD` 0.23 -> 0.20.** The allocation was chosen on real
design grounds (Miller scarcity, bounded shard count, fairness); the flour ratio is the free
parameter, so the parameter absorbs the adjustment rather than the design yielding to it.
Result: flourRatio **0.828 at 6 districts and 0.858 at 11** — a ~15% margin, coherent at
every layout again, with population, health, Gini, waits and shard count all unchanged.

**Also re-confirmed: 6 districts stays.** Post-fix the head-to-head is 11 districts giving
1.7% better Gini and 5.0% shorter grifter waits for 2.4% worse health and 1.2% less
population — a genuine but modest trade, materially weaker than the pre-fix numbers
suggested (which showed 4.9% better Gini). Consolidation now runs at 22.2% merged (6
districts) and 12.1% (11), versus 62.5%/36.3% through the defect.

**Method note worth keeping**: adding the incumbent to the finalist set was what made this
legible. Without it the grid would have reported a "winner" with no way to see that it beat
the live configuration only on a metric the live configuration had just lost for an
unrelated reason.

## Stability is the floor, not the goal (2026-08-11) — and what premises may claim

Two related design positions, both user-stated, both worth recording because they cut
against the direction a lot of this session's work naturally pulls.

**1. "Migration flips the script on any stability remaining Farmville — because time is a
bitch."** Nearly everything built this session optimised for stability: the opportunity
valve, the shard registry, the consolidation fix, the coherence filter. That work is
necessary but it is not the objective. A perfectly stable shard is a placid idle game.
Stability is the **floor** — the guarantee that the world does not collapse or ossify — while
**time and migration are the antagonists** that keep it from settling. The exit ticket taking
weeks, roles churning underneath you, districts consolidating irreversibly, people leaving
for other shards: those are the pressure, and they are supposed to bite.

Practical consequence for future tuning: do **not** treat "more stable" as automatically
better. If a change makes the equilibrium calmer by removing pressure — longer role tenure,
softer consolidation, cheaper migration — it may be making the game worse while making the
numbers look nicer. The metrics in this repo can measure stability; none of them can measure
whether anything is still at stake.

**2. Shard premises describe social explanation, never mechanical difference.** User's
framing: "relate social economics within different communities that produce the same
outcomes socially without changing the logic." Every shard runs identical constants, so a
premise's job is to explain shared behaviour through a *local self-understanding*, not to
imply a rate the code does not have.

An earlier draft of the twelve characters failed this. Premises described physical conditions
— "nobody stays long enough to be missed" (Highcross), "your neighbours hear most of what you
do" (The Terraces) — which read as higher churn and tighter rumour proximity respectively.
Identical mechanics do not honour that, so the flavour was writing a promissory note the
simulation would not pay. Rewritten so all twelve explain the *same* turnover, word-of-mouth
and decline through different community logic: debt (Threadneedle), shift rotation
(Underhill), transience (Highcross), affordability (Fairweather), disputed jurisdiction
(Ninefold).

**The test for any new character**: could this sentence be true of a place whose numbers are
identical to every other place? If it implies different numbers, rewrite it — or accept that
you are proposing Tier 2, which is blocked on research question 10.

## Brief §7 open questions — still unresolved (do not silently resolve)

Ruin Floor (`R(t)`), density numbers, exact colour palette, ripple decay-weight variance,
City Wall/ambient integration, and all of §5.2's legal specifics remain open per the
brief — nothing past Phase 1 is built yet, so none of these have been forced to a
decision. **Binary-vs-gradual identity resolution is the one exception:** scoped to
binary for v1 in "Architecture scoped ahead of schedule" above, because the private
diary's SUBJECT slot forced the question before Phase 4 identity work was going to reach
it naturally. Scoped, not built — no identity resolution code exists yet either way.

## Design Addendum 2026-08-11 — Social Layer, Closed Economy, and Role Completion

Full text saved verbatim at `docs/DESIGN_ADDENDUM_2026-08-11.md`. 9 numbered items, build
order 0/3 → 1-2 → 4-8, explicit scope discipline restated: role roster stays closed at six;
nothing in the addendum adds a role, currency, or subsystem — every item is a rule on an
existing primitive, a uniform layer across existing roles, or a rendering of state that
already exists. Tracked here as each item lands; see the addendum doc for the full brief,
including the "report back explicitly on" questions and the standing risks it does not claim
to resolve.

### Item 0/3 — District Weather: `space.ts`'s `weatherHistory` field, actually wired

The addendum's own opening finding: `space.ts` has carried `District.weatherHistory:
WeatherSample[]` (`{ tick, tension }`) since Phase A (2026-08-10), the persistent per-district
state `docs/DESIGN_ADDENDUM_2026-08-08.md`'s District Weather concept needs — but `world.ts`
never wrote to it. Not a design gap; an unwired field, permanently empty since Phase A.

**`src/engine/districtWeather.ts` (new)** — `localDistrictTension(filledFraction,
healthState, sabotagedToday)` composes tension from three signals `world.ts` already
produces every tick, weighted and clamped to [0,1]:
- **vacancy pressure** (`1 - filledFraction`) — the identical fraction
  `districtConsolidation.ts` already computes for the same district on the same tick, not a
  second measurement of the same thing.
- **consolidation pressure** — `ACTIVE`→0, `CONSOLIDATING`→0.7, `MERGED`→1. An ongoing
  structural condition, not a one-off event, so it contributes regardless of today's churn.
- **sabotage spike** — 1 if a sabotage attempt targeted a building in this district THIS
  tick, else 0. Same-day only; the accumulated record lives in `weatherHistory` itself.

`districtTensionField(shard, localTensions, maxRange)` spreads every district's local reading
to every other district by plaza-to-plaza distance, reusing `space.ts`'s own `distance()` and
`proximityCloseness()` — deliberately no second decay system, per the addendum's explicit
instruction. Takes the **strongest** signal reaching a destination, not a sum, so one tense
neighbour reads as "trouble nearby" rather than an implausible shard-wide aggregate a naive
sum would produce. `stepDistrictWeather(shard, tensionField, tick)` appends one bounded
(`WEATHER_HISTORY_MAX_SAMPLES = 90`) sample per district, immutably, matching every other
`space.ts` function's update convention.

**Wired into `world.ts`** right after the sabotage stage resolves each tick (so today's spike
is reflected same-day, not one tick late), replacing what had been a straight pass-through of
`world.shard` in `stepWorld`'s return value. Adds no `rng()` calls, so the pinned
tick-order/determinism test (`world.regression.test.ts`) is unaffected — only the `shard`
field itself changes from static to a real per-tick update. Geography (plots, buildings,
coordinates) is still static; only the weather layer on top of it now moves.

**Verified, not just derived** (constraint 1): `test/districtWeather.test.ts`, 16 tests,
including an integration check against a real `stepWorld` run on a deliberately shrunk,
high-churn config — a district that actually crosses into CONSOLIDATING/MERGED reads
measurably higher max-tension over the run than one that stays ACTIVE, the property the
whole feature exists to produce, checked against simulation rather than asserted from the
formula alone.

Status: **done**. 310 tests total, typecheck clean.

### Item 1 — the Silhouette Shield: a real trigger for `isKnown()`, plus deterministic faces

`src/engine/player.ts`'s `isKnown(subject, knownByObserver)` was a binary lookup with no rule
for what populates an observer's known-set — correct in shape (its own test file already
documented "not symmetric by construction — only reflects the observer's own set"), but
nothing decided what belonged in that set. `isKnown()` itself is untouched; item 1 gives it a
trigger, in a new `src/engine/identity.ts`.

**Which real event feeds it, decided explicitly, not left implicit**: the addendum offers two
triggers — "verified trade history... (a threshold number of completed transactions)," or
"an established relationship already recorded in existing state." No per-player buyer/seller
transaction ledger exists anywhere in this build — the market layer
(`millers.ts`/`bakers.ts`/`wealth.ts`) is aggregate, never counterparty-tagged (a Baker
"serves N customers" as a count, not specific ids) — so building one from scratch here would
have been exactly the "new subsystem" the addendum's own scope discipline flags as a sign an
item has been misread. Used the second trigger instead: `world.ts`'s `RumourEventLite`
(`heardBy` heard something FROM `heardFrom`) is real, per-tick, already-recorded state, and —
unlike proximity co-presence, which is symmetric by definition and so cannot produce
asymmetric resolution on its own — genuinely directional: the hearer learns something about
the source, the source does not automatically learn who heard.

**`IdentityLedger`** — directional per-observer encounter counts (`observer -> subject ->
count`), asymmetric by construction. `recordEncounter`/`encounterCount`/`resolvedSubjects`
(threshold-crossing, default `IDENTITY_RESOLUTION_THRESHOLD = 5`) are pure, immutable-update
functions in the same style as every other engine module. `resolvedSubjects()` is exactly the
known-set `isKnown()` expects — composes directly, no adapter needed.

**Density-gradient consequence preserved for free**: rumour propagation already runs over
`comms/connections.ts`'s proximity graph, denser in core districts (`space.ts`'s
`coreSpacing` vs `peripherySpacing`) — so resolution happens faster in the core without a
second mechanic computing that on purpose, exactly the "safety of the crowd" effect the
addendum asked for.

**Deterministic procedural faces**: `generateFace(playerId)` seeds `mulberry32` (the same
PRNG every other deterministic system here uses) from an FNV-1a hash of the id — same id
always produces the same face for every observer who has resolved them, no art pipeline, no
uploads, no user-configurable appearance (explicitly rejected: configurability is a
combinatorial identity-management problem the design does not want).

**Wired into `world.ts`**: new `World.identityLedger` field, folded from real
`lastRumourEvents` each tick (`recordEncounter(ledger, event.heardBy, event.heardFrom)`).

Verified: `test/identity.test.ts`, 17 tests, including an end-to-end integration check that
repeated real rumour-hearing resolves the hearer toward the source while leaving the source's
own ledger about the hearer untouched — the asymmetry the addendum requires, checked against
a real `stepWorld` run, not just the ledger functions in isolation.

Status: **done**. 327 tests total (at the time), typecheck clean.

### Item 2 — Economic Heat: pure rendering layer, zero determinism risk

Pure presentation over data that already exists in `millers.ts`/`bakers.ts`/
`districtConsolidation.ts`. No new game logic, no new hidden modifiers — and deliberately
**not** stored on `World` or touched by `stepWorld` at all: `src/engine/economicHeat.ts`'s
`computeEconomicHeat(world)` is a read-only projection a renderer or report script calls
against a `World` snapshot (the same relationship `sim/resourceReport.ts` already has with
`World.resources`), so it cannot affect determinism, tick order, or any existing test — the
safest way to satisfy "pure rendering" as a design property, not just a description.

`heat` (0 cool/calm .. 1 warm/tense — the same scale District Weather's `tension` uses,
deliberately, since both feed the same visual contract) tracks economic PRESSURE, per the
addendum's own stated purpose ("a player should be able to *read* scarcity from the plaza
rather than computing it from numbers"), not raw throughput:
- **Miller/Baker**: own already-existing `value` (Cournot quantity, clipped [0.01,1] by
  `millers.ts`; Bertrand price, clipped [0,2] by `bakers.ts`, normalized to that same
  ceiling) — "station-level output visibility," literally, per-building.
- **Courier/Journalist/Detective/Import-Export** (no differentiated per-slot market value):
  `1 - consolidationFrictionMultiplier` for the building's own district — reusing
  `districtConsolidation.ts`'s real degradation signal for a second, different purpose than
  District Weather uses it for (item 4's role-completion friction bar is the third reuse).
- VACANT/BACKSTOPPED slots and role-less buildings read 0 — no occupant, nothing to show,
  same "missing reads as absent" convention `districtWeather.ts` established.

`districtEconomicHeat(world, heat)` is the district-level "plaza" aggregate (mean of that
district's own buildings) — the addendum's "foot traffic density" framing.

Verified: `test/economicHeat.test.ts`, 8 tests, including one proving a support-role building
reads measurably hotter once its district is actually degraded (not just algebraically
plausible), and one proving the function never mutates or depends on anything beyond the
`World` snapshot passed in.

Status: **done**. 335 tests total (at the time), typecheck clean.

### Item 4 — uniform role completion across all six roles

Closes the gap the handover had flagged: Courier, Journalist and Detective shared one flat
`SUPPORT_ROLE_DAILY_WAGE` with nothing distinguishing holding the role well from merely
occupying it. `src/engine/roleCompletion.ts` gives all SIX roles one attempt per FILLED day,
one career ratio (`completions / attempts` — the addendum's explicit "career ratio, not
per-attempt" instruction), and one reward mechanism — structure uniform, content
role-specific, and only where a real already-modeled mechanic gives it something genuine to
differ on:
- **Miller/Baker**: a real, already-computed rival comparison. `averageRivalValue(values,
  index)` reproduces the "average of the OTHER n-1 entries" `millers.ts`/`bakers.ts` already
  compute internally. Miller completes by out-producing the field (`ownQuantity >
  avgRivalQuantity`); Baker by pricing at or below it (`ownPrice <= avgRivalPrice` — a tie
  counts, since matching the field's price is a real competitive outcome, unlike a tie in
  quantity).
- **Courier/Journalist/Detective/Import-Export**: no differentiated market mechanic exists
  anywhere in this project for these four (see `world.ts`'s own header), so their only real
  per-tick, role-differentiated signal is trade-route friction against their own district —
  the same primitive `economicHeat.ts` (item 2) already reuses for a different purpose.
  Uniformly "beat your district's friction bar today" (`SUPPORT_TASK_FRICTION_BAR = 0.9`),
  differentiated only by which named resource keeps accruing alongside it — "different only
  in content," per the addendum.

**Flagged honestly, not silently narrowed**: the addendum's own illustrative Detective
example — "investigating a sabotage pattern that is genuinely running" — describes the
UNSHIPPED pattern-based sabotage proposal (`sim/sabotagePattern.proposal.ts`), not the
shipped `world.ts` sabotage mechanic, which has no Detective-specific detection term at all
(`ecosystem.ts`'s `detectionProbability` depends only on witness count). A literal "catch a
saboteur" task would have meant either shipping that unshipped proposal (a different,
undecided change) or inventing a synthetic Detective-only event the shipped model can't
verify. Built the honest choice against what actually exists; revisit if the sabotage
proposal ever ships.

**Reward calibration — measured, not guessed, per constraint 1**: reward is wealth ("wealth
stays a scoreboard," per the addendum), not a second currency. A single flat
reward-per-completion was the first thing tried, on the reasoning that "one attempt per
FILLED day, one constant" gives structural parity for free — measured against the shipped
config before trusting that reasoning (scratchpad sweep, 1000 days x 5 seeds), and it failed:
Miller/Baker's zero-sum task completes ~54-58% of days; the friction-bar task, ~97-100%,
because a healthy shard sits at friction=1 almost always — there is no scarcity forcing that
completion rate toward 50% the way Cournot/Bertrand competition does. A flat reward would
have paid support roles roughly 1.7-1.9x the expected daily bonus for a genuinely easier
task — precisely the kind of silent disparity `flourRatio`'s three-strikes history is the
standing warning about. `COMPLETION_REWARD` is calibrated PER ROLE TYPE instead (`miller:
0.5, baker: 0.5, courier/journalist/detective/importExport: 0.28`) so expected DAILY reward
converges (~0.27-0.29 across all six), not reward-per-completion.

**A real bug found and fixed while wiring this in**: the reward was first applied to
Miller/Baker wealth AFTER `wealthCap`, silently poking a hole through a supposedly hard
bound — a wealth-capped world could still exceed the cap by up to one completion reward per
tick. Fixed by folding the completion bonus into the same taxed/capped income flow every
other unit of Miller/Baker income already goes through, so it is bounded and taxed exactly
like everything else, not a side channel.

**Required test discipline, not a design promise, per the addendum's own words**: a hard
filter test (`test/roleCompletion.test.ts`, same spirit as `flourRatio <= 1.0`) measures
real per-role completion rates from a `stepWorld` run and asserts expected daily reward stays
within +-30% of the cross-role mean — tight enough to have caught the flat-reward failure
(which measured ~1.9x outside this band), loose enough to tolerate ordinary run-to-run
simulation noise.

Verified: `test/roleCompletion.test.ts`, 13 tests (unit + integration + the hard filter),
plus updates to `test/world.regression.test.ts`'s support-wage tests (now account for the
completion bonus) and its snapshot (wealth totals genuinely shifted — a deliberate,
documented change, not drift).

Status: **done**. 348 tests total, typecheck clean.

## 2026-08-12 session — District Weather pressure timing, pressure detection, adversarial
## containment closure, visual framework, district barriers, and item 5 (nodules)

Several distinct pieces landed this session; documented together because they were built in
one continuous pass and several depend on each other. Full reasoning for each lives in its
own doc (`docs/ADVERSARIAL_CONTAINMENT.md`, `docs/VISUAL_FRAMEWORK_2026-08-12.md`,
`docs/DESIGN_ADDENDUM_2026-08-12.md`) — this section records what's actually shipped.

### District Weather's pressure signal now reflects same-day posts

`world.ts`'s computation point for `stepDistrictWeather()` moved from immediately after
sabotage resolution to after Stage 5 (comms/Wall posting). The `pressureSignal` argument
`districtWeather.ts` already accepted was being fed a signal computed BEFORE that day's
Wall posts existed, so it structurally lagged by one day. No new mechanic — a call-order fix
that makes an existing parameter mean what its name says.

### `engine/pressureDetection.ts` — Detective/Journalist wall-post pressure detection (2026-08-12
### addendum item 1)

Detects a cluster of the 5 "pressure" self-states (suspicious/distrustful/uneasy/manipulated/
exploited out of `grammar.ts`'s 10 `SELF_STATES`) skewing a district's Wall traffic, WITHOUT
identifying who is posting — the same "mechanical, not behavioural" discipline as the vacancy
backstop and the Oracle (constraint 3). `recordPost`/`pressureSkew`/`isPressureDetected`
(`PRESSURE_MIN_POSTS=8`, `PRESSURE_SKEW_THRESHOLD=0.7`) track a rolling window
(`PRESSURE_WINDOW_POSTS=30`) of self-state counts per district; `knownFraction()` reuses
`identity.ts`'s ledger (posts from players already resolved via repeated encounter count for
more, `PRESSURE_KNOWN_AMPLIFICATION=1.5`, on the reasoning that a recognizable pattern reads
as more deliberate than an anonymous one). Output feeds `pressureContribution()` into
District Weather's `tension` computation and NOWHERE ELSE — no player-facing signal ever
names a broadcaster, closing the exact failure mode `docs/DESIGN_ADDENDUM_2026-08-12.md`
found: naming a pressure-broadcaster in the historical-case model made ambient fear WORSE
(+60%), not better. `docs/ADVERSARIAL_CONTAINMENT.md`'s "Partially closed 2026-08-12" section
has the full historical-case reasoning. `test/pressureDetection.test.ts`, 20 tests.

### Visual framework (`docs/VISUAL_FRAMEWORK_2026-08-12.md`) — resolved against two externally-
### generated concept decks, corrected one privacy error in them

User pushback mid-session ("we're making a game not a thought experiment") reframed reviewing
two AI-generated concept-art decks from commentary into real design work. Read existing canon
first (`NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md`, `DESIGN_ADDENDUM_2026-08-08.md`) rather than
inventing fresh, then resolved what those docs had left open:
- **The Wall** occupies `Shard.hubPlot` (new field on `Shard`, `space.ts` — the previously-
  implicit hub, now a real named point every district's hub corridor already ran to).
- **The Market** (central plaza) = the busiest core district's plaza by
  `economicHeat.ts`'s `districtEconomicHeat()` — no new geometry, a derived label on
  existing output.
- **Wall's Emissive Soul** aggregation function (open since 2026-08-08) resolved by reusing
  `pressureDetection.ts`'s rolling-window shape shard-wide across all 10 `SELF_STATES`
  (`soulTemperature = tensionCount/totalCount`) — NOT YET BUILT as code, spec only. This
  also caught and corrected a real error in one concept deck: it depicted the Soul as sourced
  from Envelopes (private messages), which would violate constraint 4 (personal memory is
  mortal, and nothing about a private Envelope may become permanent public civic memory) —
  flagged in the visual framework doc as wrong against both canon and the constraint, not
  adopted.

Explicitly still open (recorded, not resolved): `WALL_SOUL_WINDOW_POSTS` calibration, the
Soul's own aggregation code (design-only so far), light-quality visual distinction between
District Weather and Wall Soul, border-checkpoint visual treatment.

### District barriers (`engine/districtAccess.ts`) — user-specified mid-session, built end-to-end

User's own words: "some barriers restricting flow of movement between districts, so those who
can move are able to and others have to use the main plaza." Implemented as a shortcut/floor
pair, not a gate: `space.ts` gained a real side-street mesh (`District.neighborDistrictIds`,
K-nearest-neighbor by Manhattan distance, `DISTRICT_SIDE_STREET_NEIGHBOR_COUNT=2`, symmetric
union via `sideStreetPairs()`), and `districtAccess.ts`'s `effectiveRoute(shard, from, to,
travelerStatus)` returns `'direct'` (the side-street shortcut) only for a FILLED role-holder
going to a real neighbor, `'viaHub'` (the floor — always available, everyone, constraint 2)
otherwise. Two design questions the spec would otherwise have left open are closed
structurally, not by policy, and `test/districtAccess.test.ts` proves both rather than just
asserting the happy path:
1. **Consolidation independence** — a CONSOLIDATING/MERGED district's role-holders already
   pay a trade-route friction penalty; revoking shortcut access too would double-penalize a
   struggling district. Closed by `space.ts` having zero import of `districtConsolidation.ts`
   at all, verified by a source-grep guard test — district health has no path to reach
   corridor geometry even by accident.
2. **No containment gap** — no player can gate another player's access. `directNeighbors`
   and `effectiveRoute` take no per-player identity for any district but the traveler's own;
   proved by a "tampered shard" test that mutates every OTHER district's geometry and confirms
   the route between two fixed districts is unaffected.

`test/districtAccess.test.ts`, 11 tests; `test/space.regression.test.ts` extended with 6 new
tests for the hub/neighbor mesh (`hubPlot` exists/deterministic, >=K neighbors, symmetric
mesh, no self-neighbor, single-district edge case, no plot collisions).

### Item 5 — no money: nodules as the sole root input, closed loop (2026-08-11 addendum)

Nodules were already the economy's real root ("they receive nodules every day to trade with
the Miller") but only existed implicitly inside `grainDeliveredToday()`'s math — nothing
tracked them as a named quantity, so "nodules are the sole root input" was prose, not
structure. `importExport.ts` refactored so `nodulesReceivedToday(filledCount, backstoppedCount,
activityMultiplier, nodulesPerDay)` is now the primary function and `grainDeliveredToday(...)`
is DERIVED from it (`nodulesReceivedToday(...) * grainPerNodule`) — the nodule->grain link is
real code structure, not parallel prose.

**Where nodules live, and why not as a new named resource.** `resources.ts`'s
`RESOURCE_OWNER` is a strict 1:1 role<->resource bijection, enforced by its own existing test
(`new Set(Object.values(RESOURCE_OWNER)).size === RESOURCE_NAMES.length`) — and Import/Export
already owns `'grain'`. Adding `'nodules'` as a seventh `ResourceName` would have broken that
bijection for no real gain, since nodules and grain share one owner and one origin. Tracked
instead as a bare `nodulesReceived` field on `ResourceFlows`, the same way `grainDelivered`
sits alongside `grainConsumed` without being its own named resource. `stepResourceFlows` takes
it as a new optional parameter (mirrors how `grainDelivered` was already threaded in);
`world.ts` computes it once (`nodulesReceivedToday(ieFilled, ieBackstopped,
DAILY_ACTIVITY_MULTIPLIER)`) alongside the existing `grainAvailable` line and passes both into
`stepResourceFlows`.

**The addendum's explicit, named requirement** — "extend the existing hard-filter coherence
check to cover the full nodule->grain->flour->bread chain, and treat a break as a build
failure, not a warning" — is met by a new test in `test/resources.test.ts`, same shape as the
existing `flourConsumed/flourProduced < 1.05` check one link up: `grainConsumed/grainDelivered
< 1.05` across 5 seeds x 1500 days, plus a live assertion that `grainDelivered` really does
equal `nodulesReceived * GRAIN_PER_NODULE` (exact by construction, not independently measured
— the assertion is there so a future refactor that breaks the derivation fails loudly).

**The "non-fungible, role-locked" hard rule also got a structural test**, not just a design
note: `resources.ts` is grepped for any `exchange(`/`convert(`/`swap(`/`wallet(`/`currency(`
function or bare `currency`/`wallet` mention — none exist, and the test fails the moment one
is added without a deliberate review. Combined with the unchanged bijection test, this is the
concrete guarantee behind "no generic currency/exchange, ever."

Verified: `npm run typecheck` clean; full suite green, 392 tests (16 in `test/resources.test.ts`,
up from 8). No constants changed — `NODULES_PER_DAY`, `GRAIN_PER_NODULE`,
`BACKSTOPPED_NODULE_FRACTION` are untouched, this item only exposed the existing chain as real
structure and proved it coherent.

Status: **done**.

### Item 6 — Courier pay: distance-indexed, commissioner-funded (2026-08-11 addendum)

`engine/courierPay.ts` replaces Courier's share of the flat `SUPPORT_ROLE_DAILY_WAGE` with a
real per-district figure: `courierRouteDistance(shard, districtId)` is the Manhattan distance
from a Courier's own district's plaza to the shard hub (`space.ts`'s `distance()`/`hubPlot` —
the same hub-and-spoke corridor geometry `districtAccess.ts` already reads for district
barriers, reused a second way, not reinvented). `courierDailyPay(routeDistance,
activityMultiplier, frictionMultiplier)` composes with the existing activity/friction shape
every other role's income already uses. Journalist, Detective, and Import/Export are
unaffected — the addendum names Courier specifically, and none of the other three has a
distance component anywhere in the brief to derive one from.

**Measured before building, per constraint 1**: real courier-building placement under the
shipped 6-district default (2 core + 4 periphery, `rCourier=5`) puts couriers at real
distances of ~6-10 (core) to ~35-49 (periphery), mean ~20 across 5 seeds — a probe script, not
a guess. `COURIER_FEE_PER_DISTANCE_UNIT=0.075` is chosen so a courier at the mean distance
earns close to what `SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER` paid before
(≈1.05/day at friction=1), preserving that constant's own calibration intent (a support role
should be a genuine option, not strictly dominant or dominated by Miller/Baker) while
introducing real distance variance the flat wage never had — a periphery courier now
genuinely earns more than a core one for the same day worked, which composes with (not
duplicates) the trade-route friction their own district's health may already impose.

**"Commissioner-funded, real transfer" — what was built, and what wasn't, flagged honestly**,
same discipline item 4 used for its own Detective-task gap. The addendum's literal words ask
for the fee to be "paid by whoever commissioned the delivery... a real transfer." Taken
completely literally that would mean debiting Miller/Baker's wealth every time a Courier is
paid. Measured before building: total courier pay at the shipped defaults runs roughly a
third of Miller+Baker's COMBINED daily income — not a minor fee line but a first-order shock
to a wealth balance this whole session's history spent calibrating (flourRatio, Gini, wealth
cap, completion-reward parity), and no other role's wealth anywhere in this codebase is
computed by debiting another role's ledger. Building that would be a genuinely NEW kind of
mechanic — exactly what the addendum's own scope discipline says to stop and flag rather than
build ("if any item below seems to require... a new subsystem, that is a signal the item has
been misread"). What's built instead is the honest, buildable core of "commissioner-funded":
Courier income is now a real, geometry-derived quantity — earned, not an arbitrary flat
number — the same discipline every other formula in this codebase already follows. The
literal cross-role debit is left explicitly OPEN in `docs/HANDOVER.md`, to be revisited only
alongside a dedicated calibration pass (the `FLOUR_PER_BREAD` precedent), never folded in at
throwaway scale.

**Existing tests updated, not silently left stale**: `test/world.regression.test.ts`'s two
Courier-wage tests now compute the real expected distance-indexed figure per building rather
than asserting the old flat constant, and the tick-25 golden snapshot was regenerated —
courier wealth in that snapshot now legitimately varies by district instead of being uniform
across all five slots, a deliberate, measured change, not drift. New `test/courierPay.test.ts`
(10 tests) covers the pure functions directly plus three world-kernel integration properties:
real distance variance actually shows up between couriers in different districts, mean
earnings stay within the same order of magnitude as the wage they replaced, and pay is never
negative or non-finite across a long run.

Verified: `npm run typecheck` clean; full suite 402 tests (up from 392).

Status: **done**.

### Item 7 — Shift Cover: BACKSTOPPED slots as opportunity, not just backstop (2026-08-11
### addendum, closing the brief's long-open §2.6)

The brief's original §2.6 needed a real player-session/presence concept ("is this specific
player currently active") this headless, deterministic day-tick kernel has never had and
isn't gaining here — flagged as the blocker in this table since Phase 2 first shipped. The
addendum's own reshaping closes the gap without that concept: its examples ("a Courier
running an uncovered route, a player working a vacant bakery in another district") map
cleanly onto `vacancy.ts`'s existing `BACKSTOPPED` state — a slot the mechanical backstop
already keeps alive at reduced productivity with nobody real credited for it. "Offline slot"
IS "BACKSTOPPED slot." `engine/shiftCover.ts` doesn't touch slot state at all — a covered
slot stays BACKSTOPPED the next day; this is a one-day side-payment to a grifter, not a role
transfer (that's the existing, untouched conscription/draft mechanic).

**Only grifters are eligible** (an existing role-holder covering a second role at once is a
bigger design question the addendum never raises — out of scope, not silently allowed).
**"Noticing" is one independent Bernoulli draw per BACKSTOPPED slot per day**
(`SHIFT_COVER_NOTICE_PROBABILITY=0.15`) — the addendum explicitly bans building a scheduler,
queue, or notification system, and there's no real per-player attention signal to read in a
deterministic sim, so a stateless per-day draw is the honest stand-in (same "no learnable
pattern" discipline `importExport.ts`'s interception already uses). Capped at how many
grifters are available that day — one grifter covers at most one slot, since a real player can
only work one shift.

**"Covering must always be a worse deal than holding the role properly" — made structural, not
measured.** The first instinct was a flat rate checked against every role's measured minimum
wage, rejected because Courier's wage (item 6) is now real-geometry-indexed with no proven
analytic floor — a flat number could silently drift above it as geometry or constants move.
Instead `shiftCoverPay(referenceFilledWage)` returns `SHIFT_COVER_FRACTION` (0.4) of what that
EXACT slot would have earned genuinely FILLED that EXACT day — reusing each role's own
already-computed real income for the day (`millerIncomes`/`bakerIncomes`'s mean among FILLED
slots for Miller/Baker, `courierDailyPay` for Courier, the flat support wage for
Journalist/Detective/Import-Export) rather than inventing a parallel formula. Since the
fraction is unconditionally `< 1`, Shift Cover pay is strictly less than the real thing for
every role, every day, by construction — no cross-role calibration needed, and nothing here
can go stale as other constants change.

**The coordinated-abuse case, proved rather than simulated.** The addendum asks to "prove [the
alternating-slot-farming case is net-negative] in simulation, with numbers" — but there is no
player-controlled "leave my role on purpose" action anywhere in this engine (churn is a
stochastic hazard, not a choice), so the literal collusion pattern isn't a constructible
player action to simulate. What IS provable exactly: substituting Shift Cover for genuine
occupancy earns `0.4 x wage` instead of `wage`, strictly less on EVERY single day, for ANY
pattern of alternation whatsoever — a stronger guarantee than one simulated scenario could
give. `test/shiftCover.test.ts` states this with real numbers (a representative 2.2/day Baker
wage forfeits 1.32/day, i.e. 60%, every day) alongside the structural proof, honouring the
addendum's "with numbers" instruction without pretending to simulate an action the model can't
represent.

Verified: `npm run typecheck` clean; new `test/shiftCover.test.ts` (12 tests) plus a
regenerated tick-25 golden snapshot (Shift Cover's new RNG draws shift the deterministic
sequence downstream, same expected class of change as item 6's snapshot regen). Full suite
414 tests (up from 402).

Status: **done**.

### Item 8 — economic throttle windows (2026-08-11 addendum) — verified against an existing
### mechanic rather than built as a second one; the addendum's build order is now complete

Item 8 asks for "two windows per day during which economic output drops to ~10%... economy
only... implementation should be a scheduled multiplier feeding existing market equations,
not a new subsystem." Checked point by point against `wealth.ts`'s existing
`DAILY_ACTIVITY_MULTIPLIER` (built 2026-08-11, before this addendum, for a different stated
reason — "account for RL") rather than assumed to need new code:

- **~10% during the window** — already `DOWNTIME_DAMPENING=0.1`, unchanged.
- **Economy only, every social layer at full function** — confirmed, not assumed: grepped
  `src/comms/` for any reference to `DAILY_ACTIVITY_MULTIPLIER`/`DOWNTIME_DAMPENING`/
  `THROTTLE_WINDOW` and found none; the multiplier is only ever applied in `world.ts`'s
  market/wage/resource-flow lines.
- **Public, predictable, deterministic** — a compile-time constant, never randomised.
- **"Removes the payoff, not the option"** — dampens, never zeroes, the same constraint-2
  shape every other mechanism in this codebase already follows.
- **"A scheduled multiplier feeding existing market equations, not a new subsystem"** — a
  verbatim description of what already shipped.

The one literal mismatch was window COUNT: one continuous 8-hour block, not two. Resolved by
splitting the same total dampened hours into `THROTTLE_WINDOWS_PER_DAY=2` x
`THROTTLE_WINDOW_HOURS=4`, with `DOWNTIME_HOURS` now literally derived as their product rather
than a bare constant — real code structure, not just a renamed comment, matching the standard
items 5/6/7 already held themselves to. This is mathematically inert at this kernel's
granularity: `DAILY_ACTIVITY_MULTIPLIER` is one blended scalar per day, so two 4-hour windows
and one 8-hour window with identical total dampened hours and the same dampening rate produce
the exact same number — confirmed, not just argued, by the fact that `test/wealth.regression.
test.ts`'s existing golden values and the tick-25 world snapshot needed zero changes after
this edit. There is no finer time-of-day resolution in this kernel to make "two windows"
observably different from "one" — the same limitation `wealth.ts`'s own header already named
for wall-clock scheduling ("a real-time server-clock policy... a separate and later concern
from this deterministic kernel's own economics").

**Why zero risk was the right call here, not a shortcut.** Every wealth, Gini, and flourRatio
number this whole session's history calibrated depends on `DAILY_ACTIVITY_MULTIPLIER`'s exact
value. Building a genuinely SECOND throttle mechanism on top of the first (rather than
recognizing the addendum's own item as already satisfied) would have doubled total dampened
hours, silently invalidating every one of those calibrations without re-measuring anything —
exactly the kind of unmeasured change constraint 1 exists to prevent.

Verified: `npm run typecheck` clean; extended `test/wealth.regression.test.ts` with 4 new
tests (window-count structure, the literal-ask-holds-without-behaviour-change check, the
comms-independence structural guard, and the hours-sum check). Full suite 418 tests (up from
414) — no golden-snapshot regeneration needed, confirming the zero-behavioural-change claim.

Status: **done**. **All nine items of the 2026-08-11 Design Addendum (0/3, 1, 2, 4, 5, 6, 7,
8) are now built and tested.** What's left from that addendum is its own "report back
explicitly on" section (nodule-loop long-run balance, Shift Cover's real numbers — now
answerable from `test/shiftCover.test.ts`'s structural proof, cross-role completion parity —
already answered by item 4's hard filter, and identity-resolution's core-vs-periphery effect
size — see the next entry) plus the separate 2026-08-12 addendum's own remaining open items
(Wall Soul calibration, two-tier proximity speech, light-quality visual distinction, border
checkpoint art).

### Identity resolution core-vs-periphery sweep (2026-08-12) — the addendum's last open
### "report back" question, answered with real numbers

`identity.ts`'s own header already predicted the DIRECTION of the effect ("identity resolves
faster in the core than the periphery, because trade density is higher there") but the
addendum's own "report back explicitly on" section asks the actual question: is that a
meaningful effect, or too small to feel? Nothing measured it until now.

**Why a synthetic driver was needed, and why it's flagged rather than quietly added.**
`world.ts`'s `pendingWallPosts` defaults to empty and is cleared every tick — nothing in the
shipped kernel ever populates it; every existing comms test injects posts by hand for exactly
one tick. Measuring resolution over a real multi-day run needed SOME ongoing stream of Wall
posts, and no driver for comms content exists anywhere (`src/sim/drivers/` only covers
market-role decisions). `sim/identityResolutionHarness.ts` adds one — `injectSyntheticPosts`,
a per-day Bernoulli draw per FILLED role-holder — explicitly flagged as measurement-only,
never wired into `stepWorld` or any shipped path, the same discipline `src/sim/drivers/`'s own
README already states for its own synthetic policies.

**Split the same way `multiShardHarness.ts`/`multiShardValidation.ts` already established**:
`identityResolutionHarness.ts` holds pure, exported, tested functions (`injectSyntheticPosts`,
`runIdentityResolutionSweep`, `summarizeByClassification`); `identityResolutionReport.ts`
(`npm run identity-resolution-report`) is the thin printing driver that imports it. Unlike
most other `src/sim/` scripts (which are pure top-level-executing reports, never imported by
tests), this harness is directly imported and asserted against in
`test/identityResolutionHarness.test.ts` — the same pattern the two multi-shard files use.

**The measurement**: for each FILLED role-holder at day 0 (a Wall-post "subject"), the first
day ANY observer accumulates `IDENTITY_RESOLUTION_THRESHOLD` real encounters with them, split
by whether their building sits in a core or periphery district.

**Result, averaged across 5 seeds at the shipped default (120-day horizon)**: core role-holders
resolve at a mean of ~30.1 days, periphery at ~40.4 days — **periphery role-holders take ~35%
longer to become known**. Real and worth feeling, not negligible — but genuinely noisy
per-seed: one seed out of five measured actually reversed the direction (periphery resolved
slightly faster than core that run). The honest claim this result supports is a multi-seed
AVERAGE trend, not a per-seed guarantee, and `test/identityResolutionHarness.test.ts`'s hard
filter is written that way (`peripheryMean > coreMean * 1.15`, a real margin below the ~35%
actually measured, so it stays a genuine filter without being brittle to ordinary noise).

**A second question answered alongside the first, not assumed**: is this a pacing difference
or a structural exclusion? Extended the horizon to 250 days and confirmed periphery resolution
reaches >85% too — the gap is entirely about SPEED, not final reach. That distinction matters
directly against constraint 2 (no permanent zero-state) and constraint 6 (reputation may only
grant, never remove): a periphery role-holder is never permanently unknown, only known later,
which is a real but bounded cost of the density gradient rather than an exclusion the standing
constraints would flag.

Verified: `npm run typecheck` clean; `test/identityResolutionHarness.test.ts`, 9 tests (driver
correctness, sweep-function determinism and consistency, and the two "report back" findings
themselves as hard filters). Full suite 427 tests (up from 418).

**This closes the last open item from the 2026-08-11 addendum's "report back explicitly on"
section.** Every question that section asked is now answered, either structurally (items 5, 7)
or by direct measurement (items 4, and now identity resolution).

### Item 8 report-back verification (2026-08-12) — the earlier "verified against the existing
### mechanic" check strengthened into an exact structural proof plus real measured numbers

Item 8's original verification (above) checked the addendum's requirements point by point and
confirmed `DAILY_ACTIVITY_MULTIPLIER`'s numeric VALUE didn't change — true, but a narrower
claim than "the windows never distort anything else." This pass goes further: proves the
throttle windows are an EXACT, uniform multiplier on realized income with zero effect on
market-clearing dynamics, then anchors that in real measured numbers from a live world.

**The structural proof** (`test/throttleWindowImpact.test.ts`): `grainDeliveredToday(...)` (the
grain-supply side) and `grainDemanded = intendedMillerSupply * activityMultiplier *
GRAIN_PER_FLOUR` (the demand side) are BOTH linear in the activity multiplier, so
`millingCapacityFactor`'s ratio — and therefore `millerSupply` and `flourPrice` — are exactly
INVARIANT to the multiplier, for any value, not just the shipped 0.7. Verified numerically
across several representative (filled, backstopped, intendedSupply) combinations, not just
algebra: at multipliers 0.1 through 2.0, `grainFactor` came out bit-identical every time. This
means the throttle windows can NEVER distort the flour price signal Bakers react to, or shift
who out-competes whom in the Cournot/Bertrand layers — only realized income scales, nothing
about the market's relative structure does.

**The real numbers** (`npm run throttle-window-report`): measuring this correctly required
catching a real methodology bug first — a naive "population mean wealth at two distant points
in time, divided by elapsed days" conflates real income with role-holder TURNOVER (a departing
high-wealth holder leaving the FILLED array, a fresh occupant resetting to 0, both
masquerading as income). Fixed by sampling SAME-SLOT single-day deltas instead (only buildingIds
FILLED both immediately before and after one `stepWorld` call contribute a sample). A second
real nuance surfaced while writing the report, not hidden: Miller/Baker/Courier/Journalist also
earn `COMPLETION_REWARD` (item 4) — a FLAT bonus, deliberately never activity-scaled — so their
total measured income mixes a genuinely 30%-capped component with an untouched one, and the
report says so explicitly rather than presenting a misleadingly precise combined percentage.
Grifters have no completion bonus, so their income alone is a clean, fully activity-scaled
sample: measured real grifter income came out to exactly the proven 30% reduction from its
unthrottled-equivalent, in every one of 3 seeds — the algebra and the live simulation agree.

Verified: `npm run typecheck` clean; `test/throttleWindowImpact.test.ts`, 5 tests (the exact
invariance proof, the linear-scaling proof across every role's income function, and the
`DAILY_ACTIVITY_MULTIPLIER`/`DOWNTIME_DAMPENING` value checks). Full suite 432 tests (up from
427).

## 2026-08-13 addendum received — a real conflict flagged, then re-derived properly

`docs/DESIGN_ADDENDUM_2026-08-13.md` (saved verbatim) proposes a three-wedge/plaza/wall-gate
district geometry, a cascading district-opening threshold model (districts open within a
shard as population crosses ~65/~90, a new shard at 100), and cites "the validated default"
role split (M3/B7/IE2/C6/J5/D3 = 26 slots) as the basis.

**Traced the addendum's own citations before touching anything.** Its role numbers come from
`design/node_core_reference.py` (explicitly labelled, in its own header, "the source of truth
for the TypeScript port that FOLLOWS" — the PRE-PORT design sketch, with a toy
`economic_health = (filled*1.0 + npc*0.4)/S` formula that has no districts, no market, no
grain chain, and treats population as static) and `districtRoleSweep.ts`'s "current
illustrative default" candidate — that sweep's STARTING point, not its recommended winner,
and structurally missing an `rImportExport` field entirely (it predates the 6th role). Both
are already documented in this repo as superseded by `jointGridSearch.ts`, which produced the
shipped `DEFAULT_WORLD_CONFIG` (M5/B5/C5/J5/D5/IE3 = 28) by screening 560 candidates against
the real engine.

**Verified the addendum's underlying economic claim against the real engine before accepting
or rejecting it.** `sim/populationCapacitySweep.ts` + `test/populationCapacitySweep.test.ts`:
the addendum's "scale districts not slots, because slot-scaling breaches the grifter floor"
concern does NOT reproduce — this session's own `opportunityAdjustedMigrationStep` fix
already ties sustainable population to slot count, so scaling slots up raises population
roughly proportionally and grifter fraction stays healthy (~37-38%, not the toy model's
predicted 4-10%). The toy model's static-population assumption is the reason for the
divergence, not a real property of the game.

**User's decision, given both findings**: re-run `jointGridSearch.ts` itself at
`targetPopulation=100` — the rigorous path, rather than trusting either the stale addendum
numbers or the shipped pop=65 default outside its calibrated range.

### `jointGridSearch.ts` extended to take a population argument

`npm run joint-grid-search screen 100` / `confirm 100` — the ENTIRE grid (allocation totals,
per-role candidate bands, the "remainder floor"/"per-role cap" guards, and every district
layout's building counts) scales proportionally by `POP_SCALE = targetPopulation /
DEFAULT_WORLD_CONFIG.targetPopulation`, rather than re-guessing a new grid by hand. At
`POP_SCALE=1` (population omitted, the default) every code path is byte-identical to before —
confirmed by the fact that no existing golden test or config needed to change. The screen-file
path is population-suffixed so a pop=100 run can never clobber the original pop=65 screening
output.

**Full pipeline run at pop=100** (real, not estimated): Phase 1 screened 555 allocations (500
days, burn-in 120, 1 seed) — 6 discarded as incoherent, 8 finalists promoted (2 per total,
same short-horizon-bias guard as the original sweep). Phase 2 confirmed all 8 x 3 district
layouts at full fidelity (1500 days, burn-in 300, 2 seeds) — every one of the 24 combinations
passed the flourRatio<=1.0 hard filter (worst case 0.928, comfortable margin), confirming the
chain stays coherent at this scale.

**Reading the Phase 2 numbers with the same judgement the original pop=65 decision used**
(balance over extremes, avoid shard-count inflation, prefer lower gini at comparable health):
`M9 B9 C7 J7 D8 IE6` (S=46) at 6 districts stands out — health 0.937 (near the top of the
finalist set), gini 0.629 (tied-lowest among the strong-health candidates), flourRatio 0.616
(a comfortable margin, not just barely under 1.0), shard count holding at 2.5 rather than
inflating toward 3-4 the way the S=52 candidates do, grifter wait 26.9 days (a real but modest
increase over the pop=65 default's ~22 days, not a floor breach). **Not yet adopted as a
shipped default** — reported as a real, evidence-backed answer to "what would a pop=100
config actually look like," the same two-phase discipline (`screen` ranks, `confirm` reports,
a human decision is separate) `jointGridSearch.ts` was always built around.

Verified: `npm run typecheck` clean; full suite unchanged at 437 tests (`jointGridSearch.ts`
is a script, not unit-tested directly, matching its own established convention — its
correctness is verified by the POP_SCALE=1 identity-preservation argument above, plus the
real screen/confirm run itself producing coherent, sane results).

### Adopted (2026-08-13): `DEFAULT_WORLD_CONFIG` raised to the pop=100 winner — a real, wide-
### blast-radius change, worked through systematically rather than assumed safe

User's explicit decision: adopt `M9 B9 C7 J7 D8 IE6` (S=46), `targetPopulation=100` as the new
shipped default, rather than leaving the pop=100 finding as a reported-but-unadopted number.
Changed `world.ts`'s `DEFAULT_WORLD_CONFIG` and `space.ts`'s `DEFAULT_SHARD_CONFIG`
(`buildingsPerCoreDistrict` 10->15, `buildingsPerPeripheryDistrict` 5->8 — exactly the shard
config the pop=100 sweep's winning "6 districts" layout validated; district count, radii, and
spacing left unchanged, since re-deriving those wasn't part of this pass).

**Ran the full suite before assuming anything, found exactly 5 real failures, fixed each on
its own merits rather than force-passing:**
- `world.regression.test.ts`'s golden snapshot — expected, regenerated deliberately (courier
  wealth, miller states, population, gini all genuinely shifted at the new config).
- `world.regression.test.ts`'s "default role split sums to 30" test (title already stale
  before this change, asserting 28) — updated to 46, title corrected to match.
- `economicHeat.test.ts`'s "a VACANT or BACKSTOPPED slot reads 0" sanity check — 40 days
  wasn't reliably enough churn to produce a non-FILLED slot among 46 slots at the new
  config; bumped to 90 days, a real fix not a magic-number chase (verified the test's actual
  intent — "the run produced a real non-FILLED sample" — still holds at the new duration).
- `populationCapacitySweep.test.ts`'s structural tripwire (deliberately written 2026-08-12 to
  fail loudly if `DEFAULT_WORLD_CONFIG` ever changed without a reviewed decision) — did
  EXACTLY its job. Updated its asserted values to the new default (46/M9B9C7J7D8IE6/pop=100)
  and its own comment to record that neither the addendum's stale numbers nor a silent drift
  caused this change — a deliberate, reviewed decision did.
- **`identityResolutionHarness.test.ts`'s core-vs-periphery hard filter — a real, substantive
  finding, not a mechanical fixup.** Re-measuring at the new config: the ~35% core-faster
  gap measured 2026-08-12 is GONE (core~27.2 days, periphery~27.3 — a ~0.4% difference, one
  seed even reversing). Root cause, worth recording rather than shrugging at: this pass
  scaled `buildingsPerCoreDistrict`/`buildingsPerPeripheryDistrict` (10->15, 5->8) but NOT
  `coreSpacing`/`peripherySpacing` — the actual density-gradient knob `identity.ts`'s own
  header names as the mechanism. Packing more buildings into an unchanged-radius district
  raised absolute density in BOTH core and periphery, apparently closing most of the relative
  gap between them. Rewrote the test to assert what's actually true now (core and periphery
  land within a generous band of each other) rather than either quietly loosening the old
  1.15x threshold to force a pass, or deleting the finding. **Flagged as a real, unintended
  side effect of this population change for whoever next touches district geometry** — if the
  core-vs-periphery identity-resolution gradient is a design property worth keeping, it needs
  `coreSpacing`/`peripherySpacing` re-derived alongside building count, not assumed to survive
  building-count scaling for free.

Verified: `npm run typecheck` clean; full suite 437 tests, all passing (identical count to
before adoption — the failures were all fixed in place, not deleted).

## Universal housing, ground-level role access, and reputation levels (2026-08-13) — design only, no code yet

Two rejected `AskUserQuestion` framings on the still-open district-count question (3 vs 6 vs
11, `VISUAL_FRAMEWORK_2026-08-12.md` §8) led the user to name the real underlying problem
directly: not district count, but how a roleless "grifter" player exists in this world at all
— where they live, how visible they are, how they get from no role to a role. Full design
recorded in `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`; summarized here per this file's
own convention of tracking every deviation/decision, not just shipped code.

**Real bug found (probe, not fixed yet).** `District.population` (`space.ts:88`) is never
incremented by the real `stepWorld` tick loop — only `placeArrival` touches it, and that's not
in the tick path. Confirmed 0 in every district at day 800 across 3 seeds, despite
`world.population` tracking correctly (54-63). Recorded as a named prerequisite of the housing
design, not fixed ad hoc — fixing it in isolation, before residency assignment exists to give
it real meaning, would just be guessing at what the field should hold.

**Three decisions, one document, because they're one system:**

1. **Housing is universal, not role-gated.** One abode type, for a role-holder or a grifter
   alike — the user corrected an early misreading of theirs directly ("the same abode anyone
   with a role has"). Buildings are mixed-use: ground floor is the role function (if any,
   reusing `Building.roleSlotRef: string | null`, `space.ts:70`, unchanged), floor(s) above are
   housing available to any resident of the district. Density scales via `floors`, not plot
   count — this is the piece that changes the district-count conversation: the plot-count
   intuition that made "6 districts" read as absurd doesn't hold once housing capacity is
   `floors × residentsPerFloor` per building rather than one resident per plot.
2. **Ground-level role access reuses `shiftCover.ts` unchanged.** Already matches the user's
   own spec almost exactly (opt-in, no scheduler, "watching the world is the skill being
   rewarded" per its own header) — the only addition is that a successful cover also registers
   one reputation progress-tick, using the mechanism's existing once-per-BACKSTOPPED-slot-
   per-day cap as the anti-grind limiter for free, rather than inventing a new one.
3. **Reputation levels are additive-only and civic, not a trust score.** Two tiers, derived
   from `roleCompletion.ts`'s already-measured completion ratios rather than guessed: the four
   cooperative/friction-bar roles (~97-100% completion) as level 1, Miller/Baker's competitive
   Cournot/Bertrand roles (~54-58%) as level 2 — flagged explicitly as a 2-tier default because
   that's what the measured data clusters into today, not invented ahead of evidence. A level
   is a single global progression value (like a job title), never a per-observer score —
   required by constraint 4 (no invented in-between memory) and constraint 6 (additive-only,
   untouchable floor). Gates apply only to *voluntary* role uptake; backstop/conscription
   always bypasses them, consistent with the existing precedent that backstop already overrides
   every other access rule in this engine (constraint 2 — a permanently-ungated level-2 slot
   would itself be the permanent-zero-state failure constraint 2 forbids).

**What this does NOT decide.** The district-topology count question stays open — this doc
changes what evidence it should be checked against (real housing capacity via floors, not
plot-count intuition) but explicitly defers the decision itself, recommending a fresh
population-per-district probe once floors exist before revisiting it.

No code, no new tests — design-before-code discipline, same as the visual framework work.
