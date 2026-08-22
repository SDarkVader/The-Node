import type { Driver, DriverStrategy } from './types.js';
import { idleDriver } from './idle.js';
import { honestDriver } from './honest.js';
import { opportunistDriver } from './opportunist.js';
import { saboteurDriver } from './saboteur.js';

export * from './types.js';
export { idleDriver } from './idle.js';
export { honestDriver, createHonestDriver, DEFAULT_HONEST_PARAMS, type HonestParams } from './honest.js';
export {
  opportunistDriver,
  createOpportunistDriver,
  DEFAULT_OPPORTUNIST_PARAMS,
  type OpportunistParams,
} from './opportunist.js';
export { saboteurDriver, createSaboteurDriver, DEFAULT_SABOTEUR_PARAMS, type SaboteurParams } from './saboteur.js';
export {
  assignHonestParams,
  assignOpportunistParams,
  assignSaboteurParams,
  driverForPlayer,
} from './heterogeneity.js';

export const DRIVER_STRATEGIES: readonly DriverStrategy[] = ['honest', 'opportunist', 'saboteur', 'idle'];

export const DRIVERS: Record<DriverStrategy, Driver> = {
  honest: honestDriver,
  opportunist: opportunistDriver,
  saboteur: saboteurDriver,
  idle: idleDriver,
};

/**
 * Deterministic strategy assignment for one synthetic occupant, given a shard seed and
 * that occupant's own stable index — the "chosen by seed" the spec asks for. Weighted so
 * saboteurs are a minority (illustrative weights, not calibrated): honest is the plurality
 * baseline, opportunist and idle each a meaningful slice, saboteur deliberately rare.
 */
export function assignDriverStrategy(seed: number, playerIndex: number): DriverStrategy {
  // A small, self-contained deterministic hash — not mulberry32, deliberately: assignment
  // must be a pure function of (seed, playerIndex) alone, computable independently for any
  // index without stepping a shared generator forward, unlike a threaded rng closure.
  let h = (seed * 2654435761 + playerIndex * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  const roll = ((h ^ (h >>> 14)) >>> 0) / 4294967296;

  if (roll < 0.5) return 'honest';
  if (roll < 0.8) return 'opportunist';
  if (roll < 0.95) return 'idle';
  return 'saboteur';
}
