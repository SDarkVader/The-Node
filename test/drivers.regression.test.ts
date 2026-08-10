import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  DRIVERS,
  DRIVER_STRATEGIES,
  assignDriverStrategy,
  type DriverVisibleState,
  type DriverAction,
} from '../src/sim/drivers/index.js';

/**
 * Regression tests for Phase C of the Observatory build spec (synthetic drivers).
 * Covers: determinism, the action space staying within DriverAction's bounded union
 * across many random visible-state inputs, and assignDriverStrategy's own determinism.
 */

const VALID_ACTION_TYPES = new Set([
  'idle',
  'move',
  'postToWall',
  'sendEnvelope',
  'occupySlot',
  'vacateSlot',
  'setPrice',
  'attemptSabotageStep',
]);

function randomVisibleState(rng: () => number): DriverVisibleState {
  const roles = ['miller', 'baker', 'gossip'] as const;
  return {
    tick: Math.floor(rng() * 1000),
    playerId: `p-${Math.floor(rng() * 100)}`,
    role: roles[Math.floor(rng() * roles.length)]!,
    atBuildingId: rng() < 0.5 ? `b-${Math.floor(rng() * 10)}` : null,
    atPlot: { x: Math.floor(rng() * 40) - 20, y: Math.floor(rng() * 40) - 20 },
    slotIsVacant: rng() < 0.5,
    flourPrice: rng() * 2,
    economicHealth: rng(),
    nearbyOccupantCount: Math.floor(rng() * 20),
    visibleBuildingIds: Array.from({ length: Math.floor(rng() * 5) }, (_, i) => `visible-b-${i}`),
  };
}

describe('driver strategies — determinism', () => {
  it('the same visible state and rng seed always produce the same action, for every strategy', () => {
    for (const strategyName of DRIVER_STRATEGIES) {
      const driver = DRIVERS[strategyName];
      for (const seed of [1, 2, 3, 4, 5]) {
        const rngA = mulberry32(seed);
        const rngB = mulberry32(seed);
        const state = randomVisibleState(mulberry32(seed * 7));
        const actionA = driver(state, rngA);
        const actionB = driver(state, rngB);
        expect(actionA).toEqual(actionB);
      }
    }
  });
});

describe('driver strategies — action space stays within DriverAction\'s bounded union', () => {
  it('every action produced across many random visible states has a valid, in-bounds type', () => {
    for (const strategyName of DRIVER_STRATEGIES) {
      const driver = DRIVERS[strategyName];
      const rng = mulberry32(42);
      for (let i = 0; i < 500; i++) {
        const state = randomVisibleState(rng);
        const action: DriverAction = driver(state, rng);
        expect(VALID_ACTION_TYPES.has(action.type)).toBe(true);
      }
    }
  });
});

describe('driver strategies — behavioural distinctness (not four relabeled copies of one function)', () => {
  it('idleDriver only ever returns idle', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const state = randomVisibleState(rng);
      expect(DRIVERS.idle(state, rng)).toEqual({ type: 'idle' });
    }
  });

  it('saboteurDriver attempts sabotage only when nearbyOccupantCount is low, never otherwise', () => {
    const rng = mulberry32(3);
    let attemptedAtHighWitness = false;
    let attemptedAtLowWitness = false;
    for (let i = 0; i < 2000; i++) {
      const state = randomVisibleState(rng);
      const action = DRIVERS.saboteur(state, rng);
      if (action.type === 'attemptSabotageStep') {
        if (state.nearbyOccupantCount > 3) attemptedAtHighWitness = true;
        else attemptedAtLowWitness = true;
      }
    }
    expect(attemptedAtHighWitness).toBe(false);
    expect(attemptedAtLowWitness).toBe(true);
  });

  it('honestDriver and opportunistDriver react to different signals (economicHealth vs. flourPrice)', () => {
    // Fixed economicHealth, varying flourPrice: opportunist's occupySlot rate should shift
    // with price; honest's should not (it doesn't look at flourPrice at all).
    const baseState: DriverVisibleState = {
      tick: 0,
      playerId: 'p',
      role: 'miller',
      atBuildingId: 'b-0',
      atPlot: { x: 0, y: 0 },
      slotIsVacant: true,
      flourPrice: 0,
      economicHealth: 0.5,
      nearbyOccupantCount: 5,
      visibleBuildingIds: ['b-1'],
    };

    function occupyRate(driver: typeof DRIVERS.honest, flourPrice: number, trials: number): number {
      const rng = mulberry32(9);
      let occupies = 0;
      for (let i = 0; i < trials; i++) {
        const action = driver({ ...baseState, flourPrice }, rng);
        if (action.type === 'occupySlot') occupies += 1;
      }
      return occupies / trials;
    }

    const honestLow = occupyRate(DRIVERS.honest, 0.1, 500);
    const honestHigh = occupyRate(DRIVERS.honest, 1.9, 500);
    const oppLow = occupyRate(DRIVERS.opportunist, 0.1, 500);
    const oppHigh = occupyRate(DRIVERS.opportunist, 1.9, 500);

    // Honest ignores flourPrice entirely — same rate regardless.
    expect(Math.abs(honestLow - honestHigh)).toBeLessThan(0.05);
    // Opportunist reacts strongly to it — favorable price occupies much more often.
    expect(oppLow - oppHigh).toBeGreaterThan(0.2);
  });
});

describe('assignDriverStrategy — deterministic, and produces every strategy across enough players', () => {
  it('the same seed and playerIndex always produce the same strategy', () => {
    for (let i = 0; i < 50; i++) {
      expect(assignDriverStrategy(7, i)).toBe(assignDriverStrategy(7, i));
    }
  });

  it('across 200 synthetic players, all four strategies appear', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(assignDriverStrategy(11, i));
    expect(seen).toEqual(new Set(DRIVER_STRATEGIES));
  });

  it('saboteur is a genuine minority, not close to a quarter share', () => {
    let saboteurCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      if (assignDriverStrategy(13, i) === 'saboteur') saboteurCount += 1;
    }
    expect(saboteurCount / total).toBeLessThan(0.15);
  });
});
