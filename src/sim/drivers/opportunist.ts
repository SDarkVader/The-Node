import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

const FAVORABLE_STATES: readonly SelfState[] = ['grateful', 'secure'];
const UNFAVORABLE_STATES: readonly SelfState[] = ['suspicious', 'distrustful'];

/** Flour price below this reads as a favorable market to an opportunist. Illustrative, not calibrated. */
const FAVORABLE_PRICE_THRESHOLD = 0.4;

/**
 * Self-interested, price-sensitive, not malicious: jumps on a visibly favorable market
 * (low flour price, an open vacancy) more readily than `honestDriver` does, and reacts to
 * `flourPrice` rather than `economicHealth` — a mechanically distinct trigger from
 * `honestDriver`, not just a relabeled copy of it. Never attempts sabotage.
 */
export const opportunistDriver: Driver = (state, rng): DriverAction => {
  const favorable = state.flourPrice <= FAVORABLE_PRICE_THRESHOLD;

  if (state.role !== 'gossip' && state.slotIsVacant) {
    const chance = favorable ? 0.5 : 0.15;
    if (rng() < chance) return { type: 'occupySlot' };
  }

  if (rng() < 0.15) {
    const pool = favorable ? FAVORABLE_STATES : UNFAVORABLE_STATES;
    return { type: 'postToWall', state: pool[Math.floor(rng() * pool.length)]! };
  }

  if (favorable && state.visibleBuildingIds.length > 0 && rng() < 0.25) {
    // Moves toward opportunity rather than wandering randomly — still bounded to a single
    // adjacent step, the same action shape `honestDriver` uses.
    const dx = rng() < 0.5 ? 1 : -1;
    const dy = rng() < 0.5 ? 1 : -1;
    return { type: 'move', toX: state.atPlot.x + dx, toY: state.atPlot.y + dy };
  }

  return { type: 'idle' };
};
