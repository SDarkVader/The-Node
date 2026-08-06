/**
 * §8 MVP scenario logic, extracted so both the CLI (`run.ts`) and the WebSocket
 * server (`src/server/ws.ts`) can drive the exact same simulation. See run.ts's
 * original header comment for context: hardcoded flour price standing in for the
 * Miller layer, and the Wall-post trigger rule is scaffolding, not a designed mechanic.
 */
import { stepBakers } from '../engine/bakers.js';
import { spread } from '../engine/util.js';
import { postToWall, type SelfState, type WallPost } from '../comms/grammar.js';
import { ConnectionGraph } from '../comms/connections.js';
import { DEFAULT_RUMOUR_CONFIG, propagateRumour, type RumourEvent } from '../comms/rumourMill.js';
import { gaussian } from '../sim/rng.js';

export const HARDCODED_FLOUR_PRICE = 0.6; // placeholder for the full Miller layer, per §8
export const GAMMA = 1.0; // comfortably below the n=2 instability cliff (§1.4)
export const PRICE_GAP_TRIGGER = 0.015;
export const NOISE_SIGMA = 0.02; // livelier than the Phase 1 default, so the scenario actually exercises the mill

export const BAKER_A = 'baker-astra';
export const BAKER_B = 'baker-corin';
export const GOSSIP_PLAYERS = ['wren', 'sable', 'idris'] as const;

export function buildConnectionGraph(): ConnectionGraph {
  const graph = new ConnectionGraph();
  graph.connect(BAKER_A, 'wren', 0.8);
  graph.connect('wren', 'sable', 0.6);
  graph.connect('sable', 'idris', 0.5);
  graph.connect(BAKER_B, 'idris', 0.7);
  graph.connect('wren', BAKER_B, 0.3);
  graph.connect(BAKER_A, BAKER_B, 0.4); // rivals still see each other
  return graph;
}

export interface ScenarioState {
  day: number;
  bakerP: [number, number];
  graph: ConnectionGraph;
  rng: () => number;
}

export function initScenario(rng: () => number): ScenarioState {
  return { day: 0, bakerP: [0.6, 0.65], graph: buildConnectionGraph(), rng };
}

export interface DayResult {
  day: number;
  bakerP: [number, number];
  spread: number;
  wallPost?: WallPost;
  rumours: RumourEvent[];
}

export function stepScenario(state: ScenarioState): { state: ScenarioState; result: DayResult } {
  const day = state.day + 1;
  const nextP = stepBakers(state.bakerP, HARDCODED_FLOUR_PRICE, GAMMA, () =>
    gaussian(state.rng, NOISE_SIGMA),
  ) as [number, number];
  const gap = spread(nextP);

  let wallPost: WallPost | undefined;
  let rumours: RumourEvent[] = [];
  if (gap > PRICE_GAP_TRIGGER) {
    const author: string = nextP[0]! < nextP[1]! ? BAKER_A : BAKER_B;
    const state_: SelfState = 'exploited';
    wallPost = postToWall(author, state_, day);
    rumours = propagateRumour(wallPost, state.graph, { ...DEFAULT_RUMOUR_CONFIG, rng: state.rng });
  }

  const nextState: ScenarioState = { ...state, day, bakerP: nextP };
  return { state: nextState, result: { day, bakerP: nextP, spread: gap, wallPost, rumours } };
}
