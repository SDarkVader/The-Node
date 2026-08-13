/**
 * Generic "signal fidelity decays with distance" primitive, extracted from the rumour
 * mill (§3.2) so future distance-based propagation can reuse it instead of
 * reimplementing decay/distortion from scratch — candidates per
 * docs/ECOSYSTEM_VISION_2026-08-06.md are proximity conversation (physical distance)
 * and shard-graph propagation (ecosystem scale). "Distance" is deliberately abstract
 * here — the rumour mill uses graph hops, a future system might use metres or
 * shard-graph hops; this module doesn't care which.
 *
 * Also used by the private diary (corrected 2026-08-13 — an earlier version of this
 * comment said the opposite). The diary's own stored entries are nudged through
 * `applyDistortion` once per server day-tick they survive, on top of their own short
 * rolling expiry — "mechanical memory," not a faithful transcript held until it
 * silently vanishes. See docs/DESIGN_ADDENDUM_2026-08-06.md and
 * ../engine/privateStore.ts's `getAlive`.
 */

export interface ClarityStepConfig {
  /** Base chance information registers at all, before closeness/clarity scaling. [CALIBRATED — provisional] */
  baseSuccessChance: number;
  /** Clarity lost per step of distance traveled. [CALIBRATED — provisional] */
  decayPerStep: number;
  /** Propagation stops once clarity would drop below this. [CALIBRATED — provisional] */
  clarityFloor: number;
}

export interface ClarityStepResult {
  passed: boolean;
  nextClarity: number;
}

/**
 * One step of propagation: closeness (e.g. a connection weight, or an inverse physical
 * distance) combines with the carrier's current clarity to decide whether the signal
 * gets through at all, and if so, how much clarity survives the step.
 */
export function stepClarity(
  currentClarity: number,
  closeness: number,
  config: ClarityStepConfig,
  rng: () => number,
): ClarityStepResult {
  const successChance = config.baseSuccessChance * closeness * currentClarity;
  if (rng() >= successChance) {
    return { passed: false, nextClarity: currentClarity };
  }
  const nextClarity = currentClarity - config.decayPerStep;
  if (nextClarity < config.clarityFloor) {
    return { passed: false, nextClarity };
  }
  return { passed: true, nextClarity };
}

export interface DistortionConfig<T extends string> {
  /** Chance a passed-through value drifts to a plausible-adjacent one instead of relaying faithfully. [CALIBRATED — provisional] */
  distortionRate: number;
  /** Plausible drift targets per value — keeps distortion semantically adjacent, not pure noise. */
  neighbors: Record<T, readonly T[]>;
}

export interface DistortionResult<T extends string> {
  value: T;
  distorted: boolean;
}

/** Rolls whether a value distorts in transit, and if so, picks a plausible-adjacent replacement. */
export function applyDistortion<T extends string>(
  value: T,
  config: DistortionConfig<T>,
  rng: () => number,
): DistortionResult<T> {
  const distorted = rng() < config.distortionRate;
  if (!distorted) {
    return { value, distorted: false };
  }
  const options = config.neighbors[value];
  const idx = Math.min(Math.floor(rng() * options.length), options.length - 1);
  return { value: options[idx]!, distorted: true };
}
