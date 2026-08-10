import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

const HIGH_HEALTH_STATES: readonly SelfState[] = ['secure', 'hopeful', 'grateful'];
const LOW_HEALTH_STATES: readonly SelfState[] = ['uneasy', 'overwhelmed', 'isolated'];

/**
 * Ordinary, cooperative behaviour: steps up to fill a vacancy it's positioned for, speaks
 * honestly about how the shard's own `economicHealth` actually reads (the one piece of
 * ambient state this strategy reacts to — distinct from `opportunist`, which reacts to
 * `flourPrice` instead), otherwise wanders locally or stays put. Never attempts sabotage.
 * All thresholds below are illustrative fixed constants, not calibrated — this is test
 * instrumentation, not a balanced NPC.
 */
export const honestDriver: Driver = (state, rng): DriverAction => {
  if (state.role !== 'gossip' && state.slotIsVacant && rng() < 0.3) {
    return { type: 'occupySlot' };
  }

  if (rng() < 0.15) {
    const pool = state.economicHealth >= 0.7 ? HIGH_HEALTH_STATES : LOW_HEALTH_STATES;
    return { type: 'postToWall', state: pool[Math.floor(rng() * pool.length)]! };
  }

  if (rng() < 0.2) {
    const dx = rng() < 0.5 ? 1 : -1;
    const dy = rng() < 0.5 ? 1 : -1;
    return { type: 'move', toX: state.atPlot.x + dx, toY: state.atPlot.y + dy };
  }

  return { type: 'idle' };
};
