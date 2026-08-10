import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

/** nearbyOccupantCount at or below this reads as a low-detection window. Illustrative, not calibrated. */
const LOW_WITNESS_THRESHOLD = 3;
const BLEND_IN_STATES: readonly SelfState[] = ['secure', 'hopeful', 'grateful', 'uneasy'];

/**
 * Attempts a sabotage step only when the ambient witness count is mechanically low —
 * `nearbyOccupantCount` is an observable fact (how many occupants are visibly nearby
 * right now), not the driver reasoning about whether anyone is specifically watching it.
 * Otherwise behaves indistinguishably from an ordinary player (posts an unremarkable
 * self-state or stays put) — matching the pattern-based sabotage design's own premise
 * that any single observed action should read as individually innocuous.
 */
export const saboteurDriver: Driver = (state, rng): DriverAction => {
  if (state.nearbyOccupantCount <= LOW_WITNESS_THRESHOLD && state.visibleBuildingIds.length > 0 && rng() < 0.4) {
    const target = state.visibleBuildingIds[Math.floor(rng() * state.visibleBuildingIds.length)]!;
    return { type: 'attemptSabotageStep', targetBuildingId: target };
  }

  if (rng() < 0.2) {
    return { type: 'postToWall', state: BLEND_IN_STATES[Math.floor(rng() * BLEND_IN_STATES.length)]! };
  }

  return { type: 'idle' };
};
