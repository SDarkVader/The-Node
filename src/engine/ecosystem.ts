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
 * that "every slot BACKSTOPPED simultaneously" ruin state, floored at NPC_PRODUCTIVITY,
 * never zero. Same guarantee `vacancy.ts` already gives one slot, now aggregated to
 * shard scale.
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
 * something invented here to fill silently.
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
export const NPC_PRODUCTIVITY = 0.4;
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
 * NPC_PRODUCTIVITY when filledByPlayer=0 — a shard can never actually reach zero
 * output, because a vacated slot always reverts to NPC-run (BACKSTOPPED) output, never
 * to nothing. This is the number behind the visual brief's §3 row "local
 * activity/economic health → glow radius and brightness" — call this per shard/district
 * and drive the heatmap glow from its output directly, not a separate derived stat.
 */
export function economicHealth(filledByPlayer: number, s: number = S_DEFAULT): number {
  const npcSlots = s - filledByPlayer;
  const total = filledByPlayer * PLAYER_PRODUCTIVITY_BASE + npcSlots * NPC_PRODUCTIVITY;
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
  const npcSlots = s - filledByPlayer;
  const playerOutput = filledByPlayer * (PLAYER_PRODUCTIVITY_BASE + avgExperience);
  const npcOutput = npcSlots * NPC_PRODUCTIVITY;
  const maxPossible = s * (PLAYER_PRODUCTIVITY_BASE + EXPERIENCE_CAP);
  return (playerOutput + npcOutput) / maxPossible;
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
 * Slots evicted revert to NPC (BACKSTOPPED), never to zero — see `economicHealth()`
 * above. Visual brief §3: "player-held vs. NPC-backstopped slot → solid saturated
 * outline vs. dashed/desaturated outline, quieter never broken" — a sabotage-evicted
 * slot should render exactly like any other BACKSTOPPED slot, no separate visual state.
 */
export function applySabotageDamage(
  filledByPlayer: number,
  successfulSaboteurs: number,
  damagePerSuccess: number,
): number {
  return Math.max(0, filledByPlayer - successfulSaboteurs * damagePerSuccess);
}
