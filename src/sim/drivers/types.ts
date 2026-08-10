/**
 * Synthetic driver types (Observatory build spec, Phase C). Read `src/sim/drivers/README.md`
 * (this directory's own doc, plus `docs/BLUEPRINT.md`'s "Phase C" entry) before extending
 * anything here — these are test instrumentation, never game content, and that boundary is
 * enforced structurally by `test/drivers.importGuard.test.ts`, not just by convention.
 *
 * A driver is a pure, deterministic function from *visible* state to one bounded action —
 * no learning, no belief modelling, no personality, nothing that infers another player's
 * intent. `DriverVisibleState` is deliberately limited to information a real player could
 * plausibly have (ambient counts and prices, not exact detection probabilities or anyone
 * else's private state) — a driver "noticing few people are nearby" is a mechanical fact
 * (`nearbyOccupantCount`), not the driver reasoning about whether it's being watched.
 */

import type { SelfState } from '../../comms/grammar.js';

export type DriverStrategy = 'honest' | 'opportunist' | 'saboteur' | 'idle';
export type DriverRole = 'miller' | 'baker' | 'gossip';

export interface DriverVisibleState {
  tick: number;
  playerId: string;
  role: DriverRole;
  /** Building this player currently occupies, if a role-holder; null for the gossip layer. */
  atBuildingId: string | null;
  atPlot: { x: number; y: number };
  /** Whether the role-slot this player would occupy (if role !== 'gossip') is currently vacant. */
  slotIsVacant: boolean;
  flourPrice: number;
  economicHealth: number;
  /** A purely mechanical, ambiently-observable count — not a detection-probability estimate. */
  nearbyOccupantCount: number;
  /** Building ids visible from this player's current plot — what a real player could
   *  plausibly know is nearby, not a privileged view of the whole shard. */
  visibleBuildingIds: string[];
}

/**
 * Bounded to exactly what the spec names as a real player's action space: occupy or vacate
 * a role slot, set a price, move between plots, speak in the constrained grammar
 * (Wall post or Envelope), and attempt a sabotage step. A driver's return type can never
 * be anything outside this union — that boundedness is the actual safety property, not a
 * runtime check.
 */
export type DriverAction =
  | { type: 'idle' }
  | { type: 'move'; toX: number; toY: number }
  | { type: 'postToWall'; state: SelfState }
  | { type: 'sendEnvelope'; toPlayerId: string; state: SelfState }
  | { type: 'occupySlot' }
  | { type: 'vacateSlot' }
  | { type: 'setPrice'; value: number }
  | { type: 'attemptSabotageStep'; targetBuildingId: string };

export type Driver = (state: DriverVisibleState, rng: () => number) => DriverAction;
