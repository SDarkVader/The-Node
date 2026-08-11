import type { RoleSlot } from './vacancy.js';

/**
 * Ecosystem-scale mechanics — economic floor, occupancy/experience, migration valve,
 * sabotage, districting. Ported 2026-08-07 from a parallel design session's validated
 * reference implementation (Python + TypeScript, cross-checked against a shared 6-case
 * acceptance suite). Independently re-verified before porting, not trusted on the
 * source material's claim alone — both original files were actually run in this repo's
 * environment and reproduced every stated result before a line of this module was
 * written.
 *
 * This generalizes the same idea `docs/ECOSYSTEM_VISION_2026-08-06.md` §2 already
 * worked out qualitatively — shard ruin/rejuvenation falls out of pushing the existing
 * vacancy backstop to its limit — into real numbers: `economicHealth(0, S)` is exactly
 * that "every slot BACKSTOPPED simultaneously" ruin state, floored at
 * BACKSTOP_PRODUCTIVITY, never zero. Same guarantee `vacancy.ts` already gives one slot,
 * now aggregated to shard scale.
 *
 * Naming note (2026-08-08, see `docs/BLUEPRINT.md`'s "Open deviations" for the full
 * reasoning): renamed `NPC_PRODUCTIVITY` to `BACKSTOP_PRODUCTIVITY` and reworded every
 * comment below away from "NPC" language. Behaviour is byte-for-byte unchanged — this
 * was a framing fix, not a mechanics change. A BACKSTOPPED slot was never a character
 * standing in for a missing player; it's the simulation continuing to run that slot's
 * rules exactly as it always does, whether or not a real player currently occupies it.
 * "NPC" implies a person to model, which is exactly what `CLAUDE.md` constraint 3 says
 * to avoid.
 *
 * This is also the data model the visual design brief's §3 mapping table depends on —
 * every export below is annotated with which row it feeds, so a future renderer can
 * trace data to visual directly from this file rather than rediscovering the mapping.
 * One real gap the brief's own examples need that nothing here (or in the source
 * material) provides yet: persistent per-district state. "A warm front rolling through
 * one district while another stays cool" and "the oldest cluster reads denser" both
 * require districts to exist as ongoing, trackable entities with their own economic
 * health / migration / detection history — `districtArrivalChoice()` below only decides
 * where one new arrival lands, it doesn't model a district as a thing that persists and
 * accumulates state. Flagged, not built — a real district data structure is unstarted
 * work, not an oversight to route around silently.
 *
 * KNOWN GAP, carried forward from the source material unresolved: `economicHealth()`
 * and `economicHealthWithExperience()` use different denominators and have never been
 * run together in one simulation. Do not silently merge them into one model.
 *
 * KNOWN OPEN QUESTION, not resolved here: `TRAVEL_DAYS_TARGET` (168 days, ~6 months)
 * may be a holdover from the exit ticket's *original* 2026-08-06 baseline (~6 months,
 * see `docs/DESIGN_ADDENDUM_2026-08-06.md`), which the postcard/tier system explicitly
 * revised down to 4-8 weeks on 2026-08-07 for a stated reason ("weeks, not months, not
 * years"). Whether this constant describes the same clock (in which case it's stale) or
 * a genuinely separate post-departure/in-transit window is unresolved — flagged, not
 * decided either way.
 *
 * KNOWN GAP: `sabotageAttempt()` has no defined consequence for a *caught* saboteur —
 * it only tracks who succeeds undetected. A real gap in the mechanic as given, not
 * something invented here to fill silently. Still true of `patternSabotageAttempt()`
 * below.
 *
 * PROPOSAL, not shipped (2026-08-10): `patternSabotageAttempt()` and its supporting
 * functions below re-specify sabotage as a sequence of individually-innocuous steps
 * rather than one witnessed act — see docs/BLUEPRINT.md's "Sabotage re-specification
 * proposal" for the full rationale and simulation results. This is additive: the
 * original `sabotageAttempt()`/`applySabotageDamage()` pair above is untouched, still
 * exercised by `test/ecosystem.regression.test.ts`, and remains what
 * `ecosystemHarness.ts`/`ecosystemCli.ts` actually run by default. The pattern-based
 * functions are not wired into any default config or existing test — per the user's
 * explicit instruction, this is a calibration proposal for review, not a silent
 * recalibration.
 *
 * DESIGN CORRECTION (2026-08-07, user directive, supersedes brief §1.5): the brief's
 * own role-slot mix recommendation (~1/3 of players role-holding, ~2/3 pure gossip-layer
 * with no stake) is explicitly rejected — "we can't have a population with 2/3 with
 * nothing to stake. each role produces a resource someone else needs." The specific
 * expanded role roster ("role increase") is deliberately not designed here — that's
 * the nuance layer the user is building on top of this foundation, not this module's
 * job. Nothing below hardcodes the old 1/3-role assumption; `S` (role slots per shard)
 * and `N` (population) are independent parameters throughout, so raising the fraction
 * of the population that holds a role is a calibration change at the call site, not a
 * structural one here.
 */

// ---- Canonical constants — all [CALIBRATED — provisional], see doc notes above ----

/** Role slots per shard. Visual brief §3: sets the scale a district's tile count implies. */
export const S_DEFAULT = 24;
/** BACKSTOPPED slot output multiplier — the proven floor, never lower than this. */
export const BACKSTOP_PRODUCTIVITY = 0.4;
/** Player-held slot base output multiplier. */
export const PLAYER_PRODUCTIVITY_BASE = 1.0;
/** Max experience bonus — a maxed veteran outputs at 1.5x base. */
export const EXPERIENCE_CAP = 0.5;
/** Experience growth rate per day while actively in-role. */
export const EXPERIENCE_GAIN_PER_DAY = 0.01;
/** Roleless-fraction threshold before emigration pressure engages. */
export const MIGRATION_THETA = 0.3;
/** Emigration rate coefficient once the roleless fraction exceeds theta. */
export const MIGRATION_K = 0.08;
/** ~6 months. See "KNOWN OPEN QUESTION" above — not confirmed consistent with the postcard system. */
export const TRAVEL_DAYS_TARGET = 168;
/** Experience decay per day while in a traveling state. */
export const TRAVEL_DECAY_PER_DAY = 0.001;
/** Per-witness, per-day probability of a witnessed action being detected. */
export const DETECTION_P_PER_WITNESS = 0.05;

/**
 * Count of role-slots actually held by a player — not VACANT, not BACKSTOPPED. The
 * integration point with `vacancy.ts`'s existing slot-state machine: this repo's
 * canonical source of slot state, not duplicated here.
 */
export function filledByPlayerCount(slots: RoleSlot[]): number {
  return slots.filter((s) => s.state === 'FILLED').length;
}

// ---- Economic floor ----------------------------------------------------------------

/**
 * Baseline shard economic health, 0..1, no experience factored in. Floors at exactly
 * BACKSTOP_PRODUCTIVITY when filledByPlayer=0 — a shard can never actually reach zero
 * output, because a vacated slot always reverts to the simulation's own mechanical
 * (BACKSTOPPED) output, never to nothing. This is the number behind the visual brief's
 * §3 row "local activity/economic health → glow radius and brightness" — call this per
 * shard/district and drive the heatmap glow from its output directly, not a separate
 * derived stat.
 */
export function economicHealth(filledByPlayer: number, s: number = S_DEFAULT): number {
  const backstoppedSlots = s - filledByPlayer;
  const total = filledByPlayer * PLAYER_PRODUCTIVITY_BASE + backstoppedSlots * BACKSTOP_PRODUCTIVITY;
  return total / (s * PLAYER_PRODUCTIVITY_BASE);
}

/**
 * Experience-aware variant — different denominator than `economicHealth()` above, not
 * interchangeable. See "KNOWN GAP" at the top of this file. Not yet wired to a visual
 * brief row on its own; would sharpen the same glow mapping once the two formulas are
 * reconciled.
 */
export function economicHealthWithExperience(
  filledByPlayer: number,
  avgExperience: number,
  s: number = S_DEFAULT,
): number {
  const backstoppedSlots = s - filledByPlayer;
  const playerOutput = filledByPlayer * (PLAYER_PRODUCTIVITY_BASE + avgExperience);
  const backstoppedOutput = backstoppedSlots * BACKSTOP_PRODUCTIVITY;
  const maxPossible = s * (PLAYER_PRODUCTIVITY_BASE + EXPERIENCE_CAP);
  return (playerOutput + backstoppedOutput) / maxPossible;
}

// ---- Occupancy: detection, experience, districting ----------------------------------

/**
 * P(at least one witness sees a given action), given n other role-holders present.
 * Visual brief §3: "detection risk / population scaling → more witnesses = more
 * ambient light and activity noise in dense areas; sparse areas feel more exposed."
 */
export function detectionProbability(
  otherRoleHolders: number,
  pPerWitness: number = DETECTION_P_PER_WITNESS,
): number {
  return 1 - Math.pow(1 - pPerWitness, Math.max(0, otherRoleHolders));
}

export function growExperience(
  current: number,
  gainPerDay: number = EXPERIENCE_GAIN_PER_DAY,
  cap: number = EXPERIENCE_CAP,
): number {
  return Math.min(cap, current + gainPerDay);
}

export function decayExperienceTraveling(
  current: number,
  decayPerDay: number = TRAVEL_DECAY_PER_DAY,
): number {
  return Math.max(0, current - decayPerDay);
}

/**
 * coreBias: weight ratio favoring core when both districts are open (e.g. 2.0 = 2x
 * more likely to choose core over periphery). Validated defensible range without
 * emptying periphery: 2.0-3.0 (60-75% core share); beyond ~10, periphery starts to
 * genuinely empty out — treat that as an upper bound not to cross, not a tuning target.
 * Visual brief §3: "core vs. periphery district → density gradient, tightly packed
 * near landmarks, progressively sparser toward the edges." This function decides where
 * one new arrival lands; see the "persistent per-district state" gap noted at the top
 * of this file — nothing here yet accumulates that choice into an ongoing density map.
 */
export function districtArrivalChoice(
  coreOpen: boolean,
  peripheryOpen: boolean,
  coreBias: number,
  rand: () => number,
): 'core' | 'periphery' | null {
  if (coreOpen && peripheryOpen) {
    return rand() < coreBias / (coreBias + 1) ? 'core' : 'periphery';
  }
  if (coreOpen) return 'core';
  if (peripheryOpen) return 'periphery';
  return null;
}

// ---- Migration valve ------------------------------------------------------------------

/**
 * Emigrants for this step (stochastic rounding). f = roleless fraction = R/N. No
 * emigration below theta (the "comfortable" cutoff); above theta, rate scales with
 * (f - theta) — negative feedback, self-stabilizing at any density. Validated:
 * equilibrium f* rises smoothly toward a ceiling around 0.6 across arrival pressure
 * from near-zero to unbounded; never diverges. Visual brief §3: "migration pressure /
 * roleless population → loose, unattached figures or dim unlit markers moving between
 * clusters, visually distinct from role-holders" — `n - filled` at any tick is exactly
 * that population.
 */
export function migrationValveStep(
  n: number,
  filled: number,
  rand: () => number,
  theta: number = MIGRATION_THETA,
  k: number = MIGRATION_K,
): number {
  const r = n - filled;
  if (r <= 0 || n <= 0) return 0;
  const f = r / n;
  if (f <= theta) return 0;
  const rate = k * (f - theta);
  const expected = r * rate;
  const emigrants = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
  return Math.min(emigrants, r);
}

/**
 * Weight on economic opportunity in `opportunityAdjustedMigrationStep` below. 0 reproduces
 * `migrationValveStep` exactly; higher values mean open role-slots hold people more
 * strongly. Set from a real sweep (3000 days, 3 seeds, multi-shard), not guessed —
 * per-shard population and the WEAKEST shard's population by weight:
 *   0 -> 54.6 (weakest 51.7), 3.0 shards   1 -> 57.9 (57.3), 3.3
 *   2 -> 59.0 (57.0), 3.7 shards           3 -> 59.8 (60.3), 5.3
 *   5 -> 60.2 (61.0), 9.7 shards           8 -> 61.1 (61.3), 13.3
 * 2.0 takes most of the available gain (84% -> 91% of target) while the shard registry
 * stays essentially bounded; past it, population flattens while shard count accelerates
 * into the growth regime documented in sim/multiShardEquilibriumSweep.ts.
 * [ILLUSTRATIVE — swept, see sim/multiShardEquilibriumSweep.ts]
 */
export const OPPORTUNITY_WEIGHT = 2.0;

/**
 * Migration valve, modulated by real economic opportunity (2026-08-11, user-specified:
 * "adapt the mechanics of the Oracle and economic opportunity possibilities to stabilize
 * ... purely statistics, no bias"). A NEW function alongside `migrationValveStep` above,
 * which is left untouched and still covered by its own validated tests — same discipline
 * as `multiRoleConscription.ts` vs. `stepConscriptionDay`.
 *
 * THE FLAW THIS FIXES, found by instrumenting the multi-shard equilibrium rather than
 * theorized: `migrationValveStep` keys emigration purely off the roleless FRACTION
 * `f = (n - filled) / n`, which conflates two completely different situations — 28
 * roleless players with 4 open role-slots (real, reachable opportunity) and 70 roleless
 * players with every slot already filled (none whatsoever). Both produce a high `f` and
 * therefore identical emigration pressure, which is wrong, and it is why the system had
 * no negative feedback holding population up: nothing about a shard emptying out made it
 * any more attractive to stay in.
 *
 * THE MECHANISM. `opportunity` = open role-slots per roleless player. As a shard thins,
 * `filled` drops (more open slots) while the roleless pool shrinks too, so opportunity
 * rises sharply and emigration is damped — the shard becomes genuinely worth staying in,
 * and recovers. As a shard fills toward its role-slot ceiling, open slots approach zero,
 * damping vanishes, and emigration returns to full strength — so this cannot cause the
 * runaway-growth regime documented in `sim/multiShardEquilibriumSweep.ts` (it has no
 * effect at all at the crowded end, exactly where that risk lives). Negative feedback in
 * both directions, which is what the valve was missing.
 *
 * Deliberately pure arithmetic on counts the simulation already tracks — no per-player
 * modelling, nothing with behavior or belief to infer (constraint 3), and no way for it to
 * favour or disfavour any individual: every player in a shard sees the identical
 * opportunity figure, the same "purely statistics, no bias, deterministic outputs only"
 * property the Oracle is specified to have. It only ever REDUCES emigration relative to
 * the unmodulated valve, never increases it — so it cannot push any shard toward a
 * zero-state (constraint 2).
 */
export function opportunityAdjustedMigrationStep(
  n: number,
  filled: number,
  totalRoleSlots: number,
  rand: () => number,
  theta: number = MIGRATION_THETA,
  k: number = MIGRATION_K,
  opportunityWeight: number = OPPORTUNITY_WEIGHT,
): number {
  const r = n - filled;
  if (r <= 0 || n <= 0) return 0;
  const f = r / n;
  if (f <= theta) return 0;

  const openSlots = Math.max(0, totalRoleSlots - filled);
  const opportunity = openSlots / r; // open role-slots per roleless player
  const damping = 1 / (1 + opportunityWeight * opportunity); // in (0, 1]; 1 when no slots are open

  const rate = k * (f - theta) * damping;
  const expected = r * rate;
  const emigrants = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
  return Math.min(emigrants, r);
}

// ---- Sabotage ---------------------------------------------------------------------------

/**
 * Returns the number of saboteurs who reach the acquisition deadline undetected. See
 * "KNOWN GAP" at the top of this file — no consequence is defined here for a caught
 * saboteur, only who succeeds.
 */
export function sabotageAttempt(
  saboteurCount: number,
  timeToAcquireDays: number,
  detectionPPerDay: number,
  rand: () => number,
): number {
  let successful = 0;
  for (let i = 0; i < saboteurCount; i++) {
    let caught = false;
    for (let t = 0; t < timeToAcquireDays; t++) {
      if (rand() < detectionPPerDay) {
        caught = true;
        break;
      }
    }
    if (!caught) successful++;
  }
  return successful;
}

/**
 * Slots evicted revert to the mechanical backstop (BACKSTOPPED), never to zero — see
 * `economicHealth()` above. Visual brief §3: "player-held vs. backstopped slot → solid
 * saturated outline vs. dashed/desaturated outline, quieter never broken" — a
 * sabotage-evicted slot should render exactly like any other BACKSTOPPED slot, no
 * separate visual state.
 */
export function applySabotageDamage(
  filledByPlayer: number,
  successfulSaboteurs: number,
  damagePerSuccess: number,
): number {
  return Math.max(0, filledByPlayer - successfulSaboteurs * damagePerSuccess);
}

// ---- Sabotage, pattern-based re-specification (PROPOSAL — 2026-08-10, not shipped) ------

/**
 * Diagnosis this responds to: `sabotageAttempt()` above rolls detection every day of the
 * whole acquisition window against `detectionProbability(witnesses)`, which saturates
 * near-certain well before a realistic healthy-shard witness count (~23) is reached
 * (~69% per acquisition window at DETECTION_P_PER_WITNESS=0.05, compounding across
 * ~5 days to near-100%) — see docs/BLUEPRINT.md and the 2026-08-08 combined-economy
 * findings. That models sabotage as one witnessed act, caught or not. Real successful
 * betrayal typically doesn't work that way: many individually-innocuous steps, and only
 * the accumulated pattern across them is incriminating.
 *
 * Re-specified here as `stepsRequired` sequential steps, one roughly every
 * `PATTERN_STEP_CADENCE_DAYS_DEFAULT` days. Each step's own detection hazard is scaled by
 * `patternLegibility()`, which starts near zero and grows only as more steps accumulate —
 * a single step is deliberately near-undetectable regardless of witness count; the
 * *pattern* becomes progressively legible as it lengthens, not any individual step. This
 * also makes a Detective-type role structurally necessary as counter-play: passive
 * ambient witnessing (`pPerWitness`) alone stays weak even late in a campaign (it's still
 * gated by the same slow-growing legibility ramp as the ambient term), but a Detective
 * actively assembling observations into a pattern (`detectiveBonus`, gated by a *linear*
 * ramp instead of the ambient term's quadratic one) closes far faster — modeling
 * deliberately piecing together individually-fine observations, not another passive
 * witness.
 */

/** Steps a sabotage campaign requires to complete, if never caught first. */
export const PATTERN_STEPS_DEFAULT = 6;
/** Days between successive steps of one campaign. */
export const PATTERN_STEP_CADENCE_DAYS_DEFAULT = 15;
/** Per-witness, per-step ambient detection contribution — an order of magnitude below
 *  DETECTION_P_PER_WITNESS, reflecting that any single step reads as innocuous on its own. */
export const PATTERN_P_PER_WITNESS_DEFAULT = 0.01;
/** Flat additional per-step detection contribution when a Detective is actively
 *  investigating this campaign, ramped linearly (not quadratically) with steps completed. */
export const PATTERN_DETECTIVE_BONUS_DEFAULT = 0.15;

/**
 * 0..1, how legible the accumulated pattern is after `stepsCompleted` of `stepsRequired`.
 * Quadratic on purpose: early steps contribute almost nothing (a single step stays near
 * (1/stepsRequired)^2, i.e. ~2.8% of full legibility at stepsRequired=6), late steps
 * contribute a lot more — the pattern "clicks into focus," it doesn't accumulate linearly.
 */
export function patternLegibility(stepsCompleted: number, stepsRequired: number): number {
  const frac = Math.min(1, Math.max(0, stepsCompleted / stepsRequired));
  return frac * frac;
}

/**
 * Detection probability for the step that just brought the campaign to `stepsCompleted`.
 * Two independent channels combined: ambient witnessing (ramped by the quadratic
 * `patternLegibility`) and, if a Detective is actively investigating, a flat bonus ramped
 * linearly by steps completed instead — see the header note above for why the two ramps
 * differ.
 */
export function patternStepDetectionProbability(
  stepsCompleted: number,
  stepsRequired: number,
  witnesses: number,
  detectiveActive: boolean,
  pPerWitness: number = PATTERN_P_PER_WITNESS_DEFAULT,
  detectiveBonus: number = PATTERN_DETECTIVE_BONUS_DEFAULT,
): number {
  const ambient = detectionProbability(witnesses, pPerWitness) * patternLegibility(stepsCompleted, stepsRequired);
  const detectiveFrac = Math.min(1, Math.max(0, stepsCompleted / stepsRequired));
  const detective = detectiveActive ? detectiveBonus * detectiveFrac : 0;
  return 1 - (1 - ambient) * (1 - detective);
}

/**
 * Runs one pattern-based sabotage campaign step-by-step to completion or discovery.
 * `caughtAtStep` is null on success. No consequence for being caught is modeled here —
 * see the "PROPOSAL" note above.
 */
export function patternSabotageAttempt(
  stepsRequired: number,
  witnesses: number,
  detectiveActive: boolean,
  rand: () => number,
  pPerWitness: number = PATTERN_P_PER_WITNESS_DEFAULT,
  detectiveBonus: number = PATTERN_DETECTIVE_BONUS_DEFAULT,
): { succeeded: boolean; caughtAtStep: number | null } {
  for (let k = 1; k <= stepsRequired; k++) {
    const p = patternStepDetectionProbability(k, stepsRequired, witnesses, detectiveActive, pPerWitness, detectiveBonus);
    if (rand() < p) {
      return { succeeded: false, caughtAtStep: k };
    }
  }
  return { succeeded: true, caughtAtStep: null };
}
