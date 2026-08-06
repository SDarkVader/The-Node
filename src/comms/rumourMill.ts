import type { SelfState, WallPost } from './grammar.js';
import type { ConnectionGraph } from './connections.js';
import { stepClarity, applyDistortion } from './decay.js';

/**
 * Rumour mill (§3.2) — explicitly under-specified in the brief, built to be easy to
 * retune (spread chance, distortion, decay) without re-architecture, per the brief's
 * own instruction. Starting shape: a Wall post seeds a rumour that propagates hop by
 * hop through the connection graph, decaying in clarity and sometimes distorting into
 * an adjacent self-state — reliably imperfect, not a faithful relay.
 */

/**
 * Plausible mishearings/amplifications a rumour can drift toward per hop. Keeps
 * distortion semantically adjacent (tension states drift to other tension states)
 * rather than pure noise, consistent with real gossip-transmission research per §3.2.
 */
const DISTORTION_NEIGHBORS: Record<SelfState, SelfState[]> = {
  isolated: ['distrustful', 'overwhelmed'],
  manipulated: ['exploited', 'suspicious'],
  distrustful: ['suspicious', 'isolated'],
  exploited: ['manipulated', 'overwhelmed'],
  suspicious: ['distrustful', 'manipulated'],
  uneasy: ['suspicious', 'overwhelmed'],
  overwhelmed: ['uneasy', 'isolated'],
  hopeful: ['secure', 'grateful'],
  secure: ['hopeful', 'grateful'],
  grateful: ['hopeful', 'secure'],
};

export interface RumourMillConfig {
  /** Base per-edge chance a neighbor picks up the rumour at all. [CALIBRATED — provisional] */
  baseSpreadChance: number;
  /** Per-hop chance the relayed state drifts to a distortion-neighbor instead of the true one. [CALIBRATED — provisional] */
  distortionRate: number;
  /** Clarity lost per hop; propagation stops once clarity drops below clarityFloor. [CALIBRATED — provisional] */
  decayPerHop: number;
  clarityFloor: number;
  maxHops: number;
  rng: () => number;
}

export const DEFAULT_RUMOUR_CONFIG: Omit<RumourMillConfig, 'rng'> = {
  baseSpreadChance: 0.6,
  distortionRate: 0.25,
  decayPerHop: 0.3,
  clarityFloor: 0.15,
  maxHops: 4,
};

export interface RumourEvent {
  id: string;
  originId: string;
  heardBy: string;
  heardFrom: string;
  state: SelfState;
  distorted: boolean;
  hop: number;
  clarity: number;
}

let nextId = 0;

/** Propagates one Wall post through the connection graph. Deterministic given config.rng. */
export function propagateRumour(
  seed: WallPost,
  graph: ConnectionGraph,
  config: RumourMillConfig,
): RumourEvent[] {
  const events: RumourEvent[] = [];
  const heard = new Set<string>([seed.authorId]);

  let frontier: Array<{ carrierId: string; state: SelfState; clarity: number; hop: number }> = [
    { carrierId: seed.authorId, state: seed.state, clarity: 1, hop: 0 },
  ];

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const carrier of frontier) {
      if (carrier.hop >= config.maxHops) continue;
      for (const { id: neighborId, weight } of graph.neighbors(carrier.carrierId)) {
        if (heard.has(neighborId)) continue;

        const step = stepClarity(
          carrier.clarity,
          weight,
          { baseSuccessChance: config.baseSpreadChance, decayPerStep: config.decayPerHop, clarityFloor: config.clarityFloor },
          config.rng,
        );
        if (!step.passed) continue;

        const { value: state, distorted } = applyDistortion(
          carrier.state,
          { distortionRate: config.distortionRate, neighbors: DISTORTION_NEIGHBORS },
          config.rng,
        );

        heard.add(neighborId);
        nextId += 1;
        events.push({
          id: `rumour-${nextId}`,
          originId: seed.authorId,
          heardBy: neighborId,
          heardFrom: carrier.carrierId,
          state,
          distorted,
          hop: carrier.hop + 1,
          clarity: step.nextClarity,
        });
        next.push({ carrierId: neighborId, state, clarity: step.nextClarity, hop: carrier.hop + 1 });
      }
    }
    frontier = next;
  }

  return events;
}
