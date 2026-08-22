import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

const FAVORABLE_STATES: readonly SelfState[] = ['grateful', 'secure'];
const UNFAVORABLE_STATES: readonly SelfState[] = ['suspicious', 'distrustful'];

/** The parameters that shape opportunist behaviour, fixed per agent for its whole life once
 *  assigned (see `heterogeneity.ts`) — a sampled disposition, not evolving state. */
export interface OpportunistParams {
  favorableOccupyChance: number;
  unfavorableOccupyChance: number;
  postToWallChance: number;
  moveChance: number;
  /** Flour price at or below this reads as a favorable market to this agent. */
  favorablePriceThreshold: number;
}

/** Values every opportunist shared before per-agent dispositions existed. Default so
 *  `opportunistDriver` stays byte-identical to its pre-heterogeneity behaviour. */
export const DEFAULT_OPPORTUNIST_PARAMS: OpportunistParams = {
  favorableOccupyChance: 0.5,
  unfavorableOccupyChance: 0.15,
  postToWallChance: 0.15,
  moveChance: 0.25,
  favorablePriceThreshold: 0.4,
};

/**
 * Self-interested, price-sensitive, not malicious: jumps on a visibly favorable market
 * (low flour price, an open vacancy) more readily than `honestDriver` does, and reacts to
 * `flourPrice` rather than `economicHealth` — a mechanically distinct trigger from
 * `honestDriver`, not just a relabeled copy of it. Never attempts sabotage.
 */
export function createOpportunistDriver(params: OpportunistParams = DEFAULT_OPPORTUNIST_PARAMS): Driver {
  return (state, rng): DriverAction => {
    const favorable = state.flourPrice <= params.favorablePriceThreshold;

    if (state.role !== 'gossip' && state.slotIsVacant) {
      const chance = favorable ? params.favorableOccupyChance : params.unfavorableOccupyChance;
      if (rng() < chance) return { type: 'occupySlot' };
    }

    if (rng() < params.postToWallChance) {
      const pool = favorable ? FAVORABLE_STATES : UNFAVORABLE_STATES;
      return { type: 'postToWall', state: pool[Math.floor(rng() * pool.length)]! };
    }

    if (favorable && state.visibleBuildingIds.length > 0 && rng() < params.moveChance) {
      // Moves toward opportunity rather than wandering randomly — still bounded to a single
      // adjacent step, the same action shape `honestDriver` uses.
      const dx = rng() < 0.5 ? 1 : -1;
      const dy = rng() < 0.5 ? 1 : -1;
      return { type: 'move', toX: state.atPlot.x + dx, toY: state.atPlot.y + dy };
    }

    return { type: 'idle' };
  };
}

/** The shared, undifferentiated instance every opportunist agent used before heterogeneity —
 *  still exported so existing callers and `test/drivers.regression.test.ts` see no change. */
export const opportunistDriver: Driver = createOpportunistDriver();
