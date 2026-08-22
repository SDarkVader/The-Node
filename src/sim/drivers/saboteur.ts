import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

const BLEND_IN_STATES: readonly SelfState[] = ['secure', 'hopeful', 'grateful', 'uneasy'];

/** The parameters that shape saboteur behaviour, fixed per agent for its whole life once
 *  assigned (see `heterogeneity.ts`) — a sampled disposition, not evolving state. Nothing here
 *  lets an agent get bolder after a success or more cautious after a near-miss; that would be
 *  the "learning/personality" this file's own architecture (see `types.ts`) rules out. */
export interface SaboteurParams {
  /** nearbyOccupantCount at or below this reads as a low-detection window to this agent. */
  lowWitnessThreshold: number;
  attemptChance: number;
  blendInPostChance: number;
}

/** Values every saboteur shared before per-agent dispositions existed. Default so
 *  `saboteurDriver` stays byte-identical to its pre-heterogeneity behaviour. */
export const DEFAULT_SABOTEUR_PARAMS: SaboteurParams = {
  lowWitnessThreshold: 3,
  attemptChance: 0.4,
  blendInPostChance: 0.2,
};

/**
 * Attempts a sabotage step only when the ambient witness count is at or below this agent's
 * own threshold — `nearbyOccupantCount` is an observable fact (how many occupants are visibly
 * nearby right now), not the driver reasoning about whether anyone is specifically watching
 * it. Otherwise behaves indistinguishably from an ordinary player (posts an unremarkable
 * self-state or stays put) — matching the pattern-based sabotage design's own premise that
 * any single observed action should read as individually innocuous.
 */
export function createSaboteurDriver(params: SaboteurParams = DEFAULT_SABOTEUR_PARAMS): Driver {
  return (state, rng): DriverAction => {
    if (
      state.nearbyOccupantCount <= params.lowWitnessThreshold &&
      state.visibleBuildingIds.length > 0 &&
      rng() < params.attemptChance
    ) {
      const target = state.visibleBuildingIds[Math.floor(rng() * state.visibleBuildingIds.length)]!;
      return { type: 'attemptSabotageStep', targetBuildingId: target };
    }

    if (rng() < params.blendInPostChance) {
      return { type: 'postToWall', state: BLEND_IN_STATES[Math.floor(rng() * BLEND_IN_STATES.length)]! };
    }

    return { type: 'idle' };
  };
}

/** The shared, undifferentiated instance every saboteur agent used before heterogeneity — still
 *  exported so existing callers and `test/drivers.regression.test.ts` see no change at all. */
export const saboteurDriver: Driver = createSaboteurDriver();
