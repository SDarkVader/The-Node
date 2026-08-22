import type { Driver, DriverAction } from './types.js';
import type { SelfState } from '../../comms/grammar.js';

const HIGH_HEALTH_STATES: readonly SelfState[] = ['secure', 'hopeful', 'grateful'];
const LOW_HEALTH_STATES: readonly SelfState[] = ['uneasy', 'overwhelmed', 'isolated'];

/**
 * The three probabilities that shape honest behaviour. Fixed for one agent's whole life once
 * assigned (see `heterogeneity.ts`) — a per-agent constant, not evolving state. That distinction
 * matters: this file's own architecture forbids a driver that learns or develops a personality
 * (see the header comment on `types.ts`); sampling a disposition once at creation is population
 * *variation*, not an agent with memory.
 */
export interface HonestParams {
  occupySlotChance: number;
  postToWallChance: number;
  moveChance: number;
}

/** The values every honest agent shared before per-agent dispositions existed. Kept as the
 *  default so `honestDriver` below stays byte-identical to its pre-heterogeneity behaviour. */
export const DEFAULT_HONEST_PARAMS: HonestParams = {
  occupySlotChance: 0.3,
  postToWallChance: 0.15,
  moveChance: 0.2,
};

/**
 * Ordinary, cooperative behaviour: steps up to fill a vacancy it's positioned for, speaks
 * honestly about how the shard's own `economicHealth` actually reads (the one piece of
 * ambient state this strategy reacts to — distinct from `opportunist`, which reacts to
 * `flourPrice` instead), otherwise wanders locally or stays put. Never attempts sabotage.
 * All thresholds are illustrative, not calibrated — this is test instrumentation, not a
 * balanced NPC.
 */
export function createHonestDriver(params: HonestParams = DEFAULT_HONEST_PARAMS): Driver {
  return (state, rng): DriverAction => {
    if (state.role !== 'gossip' && state.slotIsVacant && rng() < params.occupySlotChance) {
      return { type: 'occupySlot' };
    }

    if (rng() < params.postToWallChance) {
      const pool = state.economicHealth >= 0.7 ? HIGH_HEALTH_STATES : LOW_HEALTH_STATES;
      return { type: 'postToWall', state: pool[Math.floor(rng() * pool.length)]! };
    }

    if (rng() < params.moveChance) {
      const dx = rng() < 0.5 ? 1 : -1;
      const dy = rng() < 0.5 ? 1 : -1;
      return { type: 'move', toX: state.atPlot.x + dx, toY: state.atPlot.y + dy };
    }

    return { type: 'idle' };
  };
}

/** The shared, undifferentiated instance every honest agent used before heterogeneity — still
 *  exported so existing callers and `test/drivers.regression.test.ts` see no change at all. */
export const honestDriver: Driver = createHonestDriver();
