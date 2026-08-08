# NODE — Buildable Architecture Specification

**This document supersedes the narrative version (`NODE_FOUNDATION.md`,
`NODE_ARCHITECTURE.md`) as the thing to actually hand to Claude Code.** Those documents
explain *why* the numbers below are what they are, with full simulation traces. This
document only states *what to build*, points to the code that proves it, and defines
the tests that must keep passing.

**Companion files, same output directory:**
- `node_core_reference.py` — the validated reference implementation. Source of truth.
- `node_core.ts` — TypeScript port, cross-validated against the Python reference
  (both produce matching results on the same 6-case acceptance suite; verified this
  session by actually running both, not just inspecting the code).

Both files are runnable as-is. `node_core.ts` compiles clean under `tsc` (needs
`@types/node` in the real project for the `require.main` guard, which the actual repo
already has) and prints `ALL TESTS PASS` when executed.

---

## 1. What is actually proven vs. what is still a design choice

| Status | Item |
|---|---|
| **Proven, both languages, cross-checked** | NPC floor formula, detection probability formula, migration valve step formula, experience growth/decay formulas, sabotage damage application |
| **Proven, single language only (Python)** | Districting arrival-bias logic (ported to TS but not yet exercised by a TS-side test) |
| **Known unresolved gap** | Two economic-health formulas (`economicHealth` vs. `economicHealthWithExperience`) have never been run together in one simulation — see code comments, do not silently merge |
| **Design choice, not derived** | Exact constant values where a *range* was validated, not a single number (e.g. district `coreBias` validated as reasonable across 2.0–3.0, not proven to be exactly 2.5) |
| **Not designed at all** | Importer/Exporter role mechanics, discretionary shard-side migration pricing, border/legality risk on travel, Wall naming-tier trust threshold, Watchman mechanic |

---

## 2. Canonical parameters (from `node_core.ts` / `node_core_reference.py`)

```
S_DEFAULT                = 24      // role slots per shard
NPC_PRODUCTIVITY          = 0.4    // BACKSTOPPED slot output multiplier
PLAYER_PRODUCTIVITY_BASE  = 1.0    // player-held slot base output multiplier
EXPERIENCE_CAP            = 0.5    // max experience bonus (player caps at 1.5x)
EXPERIENCE_GAIN_PER_DAY   = 0.01   // growth rate while actively in-role
MIGRATION_THETA           = 0.30   // roleless-fraction threshold before emigration
MIGRATION_K               = 0.08   // emigration rate coefficient above theta
TRAVEL_DAYS_TARGET        = 168    // ~6 months, corrected migration commitment window
TRAVEL_DECAY_PER_DAY      = 0.0010 // experience decay/day while traveling
DETECTION_P_PER_WITNESS   = 0.05   // per-witness, per-day detection probability
```

**These are starting values, not tuned targets** — every one was chosen to land in a
validated *band*, not derived as a unique optimum. Re-sweep before shipping to
production balance, same discipline used to find them.

---

## 3. Function-by-function build spec

### 3.1 `economicHealth(filledByPlayer, s=24) → number [0,1]`
**Guarantee, proven by test T1:** returns exactly `0.4` when `filledByPlayer=0`.
This is Layer 1's entire contract — call this anywhere a shard's aggregate output
needs to be known, and it can never return less than `NPC_PRODUCTIVITY`.
**Integration note:** should read directly from `vacancy.ts`'s existing slot-state
enum (`VACANT` / `BACKSTOPPED` / player-held) — `filledByPlayer` is simply the count
of slots not in `BACKSTOPPED` or `VACANT` state.

### 3.2 `economicHealthWithExperience(filledByPlayer, avgExperience, s=24) → number [0,1]`
Use only where per-player experience is being tracked (see 3.4). **Do not use
interchangeably with 3.1** — different denominator, different meaning of "1.0."

### 3.3 `detectionProbability(otherRoleHolders, p=0.05) → number [0,1]`
**Guarantee, proven by test T3:** ≈0.693 at 23 other role-holders (a full 24-slot
shard). Call this wherever an action needs a witnessed/unwitnessed roll — grey-market
dealing, sabotage acquisition windows (see 3.6), anything under the
visible-action/illegible-intent principle.

### 3.4 `growExperience` / `decayExperienceTraveling`
Straightforward accumulator functions. **Integration note:** experience should live
on the player record, incremented once/day (or per game-tick equivalent) while
`in_role === true`, and decayed once/day while in a `traveling` state. The `168`-day
travel window and `0.001`/day decay rate together were validated (test T6) to produce
a 25–60% loss band for a maxed-out veteran — if travel duration changes, decay rate
must be re-swept, they are coupled, not independent dials.

### 3.5 `migrationValveStep(n, filled, rand, theta=0.30, k=0.08) → number`
**Guarantee, proven by test T4:** run to convergence under saturating arrival
pressure, equilibrium roleless fraction lands in 0.55–0.68 and never diverges higher.
**Integration note:** call once per simulation tick with current shard population and
filled-slot count; subtract the returned emigrant count from population, and route
those emigrants into the ecosystem-level waitlist/postcard system
(`ROLE_WEB_DRAFT.md` §9) rather than deleting them — where they land next is a
separate, already-partially-designed system, not this function's concern.

### 3.6 `sabotageAttempt` / `applySabotageDamage`
**Guarantee, proven by test T5:** sustained forced damage (12-of-24 slots, every 20
days, indefinitely, at baseline arrival pressure λ=0.10) settles to a **long-run
average** economic health of 0.35–0.50, never fully recovering but never reaching
zero. **Critical integration note, surfaced by a real bug caught while building
this:** this must be measured as an average over many post-transient ticks, never a
single snapshot — the system oscillates between attacks, and a snapshot timed between
hits can misleadingly show near-full health. Any dashboard or admin tool built on top
of this must expose a rolling average, not an instantaneous read, or it will
misreport shard health during sustained conflict.

### 3.7 `districtArrivalChoice(coreOpen, peripheryOpen, coreBias, rand)`
**Validated range for `coreBias`:** 2.0–3.0 produces a defensible split (60–75% core
share) without emptying periphery. Values above ~10 start to genuinely empty the
periphery — treat that as an upper bound not to cross, not a tuning target.

---

## 4. Test-driven acceptance criteria — do not merge without these passing

Run `node_core.ts` directly (`tsc` + `node`, or `ts-node` with a working config) or
`node_core_reference.py` (`python3 node_core_reference.py`). Both must print
`ALL TESTS PASS`. The six assertions, restated as acceptance criteria for any future
port or refactor:

1. Zero player-held slots → economic health exactly `0.4`.
2. Fully player-held, all at max experience → economic health exactly `1.0`.
3. Detection probability at 23 witnesses → `0.693 ± 0.005`.
4. Migration valve under saturating pressure → equilibrium roleless fraction in
   `[0.55, 0.68]`, run for at least 6000 ticks to reach convergence.
5. Sustained sabotage (12/24 slots every 20 days, λ=0.10, ≥400 tick burn-in) →
   long-run average economic health in `[0.35, 0.50]`.
6. Six-month migration decay (168 ticks at `0.001`/day) on a maxed veteran → loss
   in `[25%, 60%]` of their experience cap.

**If a future change breaks any of these, that is either an intentional rebalance
(update the range deliberately and document why) or a regression (fix it) — it should
never be silently different.**

---

## 5. What integrating this into the real repo requires, concretely

- Wire `economicHealth()` into wherever shard-level aggregate stats are computed —
  likely a new function in `src/engine/`, reading slot state from the existing
  `vacancy.ts` machinery rather than duplicating it.
- Add `experience: number` to the player record type (wherever that's currently
  defined — not located in this session's repo reads, flagged for the implementer to
  find), defaulting to 0, capped at `EXPERIENCE_CAP`.
- Add a `traveling: boolean` or equivalent state to the player record for the
  migration-decay window, with a `daysRemaining` counter.
- **Tick cadence — CONFIRMED this session: 1 tick = 24 hours, aligned to server
  reset.** Every simulation in this document was already run in units of "days,"
  so no rescaling is needed — `EXPERIENCE_GAIN_PER_DAY`, `TRAVEL_DECAY_PER_DAY`,
  `TRAVEL_DAYS_TARGET=168`, and the migration valve's daily step all map directly
  onto one server-reset tick each, with no conversion factor. Call
  `migrationValveStep`, sabotage checks, and experience growth/decay once per shard
  per reset.
- **Order of operations within a single tick — checked, not assumed:** whether
  sabotage damage is applied before or after that tick's arrival roll was tested
  directly (see `tick_check.py` logic, same output directory) and makes negligible
  difference to the long-run average (0.424 vs. 0.423 economic health) — implementers
  do not need to match a specific internal ordering to reproduce validated behavior.
- Detection rolls (`detectionProbability`, `sabotageAttempt`) need to be hooked into
  whatever action/visibility system the game actually uses for witnessing — this
  session modeled it abstractly; the real implementation needs to query actual
  spatial/social proximity, not a flat random roll against a headcount.

---

## 6. Explicitly not covered by this document

Everything in `NODE_FOUNDATION.md` §11.3 and `NODE_ARCHITECTURE.md`'s Layer 3 open
list remains open: Importer/Exporter mechanics, discretionary shard-side migration
terms, border/legality risk, Wall naming-tier trust thresholds, Watchman mechanics,
apprenticeship betrayal shape, and the global cross-shard meta-channel's exact data
schema. None of these have a tested formula yet — do not invent one to fill a gap in
this document; flag it back for a design pass first, same discipline as everything
else today.
