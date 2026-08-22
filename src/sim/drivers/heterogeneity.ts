import type { Driver, DriverStrategy } from './types.js';
import { createHonestDriver, type HonestParams } from './honest.js';
import { createOpportunistDriver, type OpportunistParams } from './opportunist.js';
import { createSaboteurDriver, type SaboteurParams } from './saboteur.js';
import { idleDriver } from './idle.js';

/**
 * Per-agent DISPOSITION, not per-agent MEMORY. `assignDriverStrategy` (in `index.ts`) already
 * picks WHICH of the four strategies an agent gets, as a pure function of `(seed, playerIndex)`
 * — but every agent given the same strategy then shared one literal set of constants, so 500
 * "honest" agents were 500 copies of one coin. That's the actual mechanism behind a flat
 * population-level Gini over a long run: identical agents produce identical-in-expectation
 * outcomes, and averaging many copies of one coin converges, it doesn't diverge.
 *
 * This module gives each agent its OWN fixed parameters within its strategy — sampled once,
 * deterministically, from `(seed, playerIndex)`, exactly the way `assignDriverStrategy` already
 * derives which strategy an agent gets. It is NOT the stateful/evolving version (a saboteur
 * that gets bolder after a success, a mood that drifts with personal history) — that would be
 * the "learning" and "personality" `types.ts`'s own header comment explicitly rules out for
 * this directory, mirroring `CLAUDE.md` constraint 3 (minimize what's modelable — an agent with
 * an internal arc is a deception surface a real player could eventually learn to read). A
 * disposition sampled once and held fixed for an agent's whole life is a population fact
 * ("not everyone has the same risk tolerance"), not a mind to infer.
 *
 * Every range below is centred on the exact constant the pre-heterogeneity driver used
 * (`DEFAULT_*_PARAMS` in each driver file) — deliberately mean-preserving, so the population's
 * AVERAGE behaviour under heterogeneity should be statistically indistinguishable from before;
 * only the SPREAD is new. That is what makes this a fair, isolated variable to measure, rather
 * than a re-tuning in disguise.
 */

/** Self-contained deterministic hash, same family as `assignDriverStrategy`'s own — not
 *  mulberry32, deliberately: a pure function of (seed, playerIndex, salt) alone, computable
 *  independently for any agent without stepping a shared generator forward. `salt` separates
 *  one parameter's roll from another so two params for the same agent don't correlate. */
function paramRoll(seed: number, playerIndex: number, salt: number): number {
  let h = (seed * 2654435761 + playerIndex * 2246822519 + salt * 374761393) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

// Salts are just distinct small integers, one per (strategy, field) pair, so no two fields for
// the same agent ever roll the same underlying hash.
const SALT = {
  honestOccupy: 101,
  honestPost: 102,
  honestMove: 103,
  oppFavorableOccupy: 201,
  oppUnfavorableOccupy: 202,
  oppPost: 203,
  oppMove: 204,
  oppPriceThreshold: 205,
  sabWitnessThreshold: 301,
  sabAttempt: 302,
  sabPost: 303,
} as const;

/** +/- spread around each `DEFAULT_HONEST_PARAMS` value. Illustrative, not calibrated — the
 *  point of this first pass is to prove non-zero spread changes anything at all, not to land on
 *  a final width. */
export function assignHonestParams(seed: number, playerIndex: number): HonestParams {
  return {
    occupySlotChance: lerp(0.15, 0.45, paramRoll(seed, playerIndex, SALT.honestOccupy)),
    postToWallChance: lerp(0.05, 0.25, paramRoll(seed, playerIndex, SALT.honestPost)),
    moveChance: lerp(0.1, 0.3, paramRoll(seed, playerIndex, SALT.honestMove)),
  };
}

export function assignOpportunistParams(seed: number, playerIndex: number): OpportunistParams {
  return {
    favorableOccupyChance: lerp(0.35, 0.65, paramRoll(seed, playerIndex, SALT.oppFavorableOccupy)),
    unfavorableOccupyChance: lerp(0.05, 0.25, paramRoll(seed, playerIndex, SALT.oppUnfavorableOccupy)),
    postToWallChance: lerp(0.05, 0.25, paramRoll(seed, playerIndex, SALT.oppPost)),
    moveChance: lerp(0.15, 0.35, paramRoll(seed, playerIndex, SALT.oppMove)),
    favorablePriceThreshold: lerp(0.3, 0.5, paramRoll(seed, playerIndex, SALT.oppPriceThreshold)),
  };
}

export function assignSaboteurParams(seed: number, playerIndex: number): SaboteurParams {
  return {
    // Integer in {2,3,4,5} — kept an integer since it's compared against a whole-number count.
    lowWitnessThreshold: Math.min(5, Math.floor(lerp(2, 6, paramRoll(seed, playerIndex, SALT.sabWitnessThreshold)))),
    attemptChance: lerp(0.25, 0.55, paramRoll(seed, playerIndex, SALT.sabAttempt)),
    blendInPostChance: lerp(0.1, 0.3, paramRoll(seed, playerIndex, SALT.sabPost)),
  };
}

/**
 * The one thing `applyDriverTick` needs: a driver instance for this specific agent. Pure and
 * deterministic in `(seed, playerIndex, strategy)` alone — rebuilding it every tick is cheap
 * (a closure over three to five numbers) and guarantees it can never drift from what a fresh
 * call would produce, so there is nothing to cache for correctness.
 */
export function driverForPlayer(seed: number, playerIndex: number, strategy: DriverStrategy): Driver {
  switch (strategy) {
    case 'honest':
      return createHonestDriver(assignHonestParams(seed, playerIndex));
    case 'opportunist':
      return createOpportunistDriver(assignOpportunistParams(seed, playerIndex));
    case 'saboteur':
      return createSaboteurDriver(assignSaboteurParams(seed, playerIndex));
    case 'idle':
      return idleDriver;
  }
}

