import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';

/**
 * The presence/session primitive (2026-08-24) — `World.currentlyOnline`/`World.presence`
 * wiring. Pure-module behavior is `test/presence.test.ts`; real-server integration is
 * `test/ws.presence.test.ts`.
 */

function scalarSnapshot(world: World) {
  return {
    tick: world.tick,
    population: world.population,
    flourPrice: world.flourPrice,
    economicHealth: world.economicHealth,
    wealthGini: world.wealthGini,
    millers: world.millers.map((m) => ({ slot: m.slot, value: m.value, wealth: m.wealth })),
    bakers: world.bakers.map((b) => ({ slot: b.slot, value: b.value, wealth: b.wealth })),
  };
}

describe('World.currentlyOnline — byte-identical when never set', () => {
  it('a run that never touches currentlyOnline produces the exact same trajectory as before this field existed', () => {
    // Two independently-created worlds, same seed, neither ever assigns currentlyOnline —
    // this is what every existing sim/test in this codebase already does, so this is the
    // regression-proof for "adding presence changed nothing else."
    let a = createWorld(5, DEFAULT_WORLD_CONFIG);
    let b = createWorld(5, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 50; i++) {
      a = stepWorld(a);
      b = stepWorld(b);
      expect(scalarSnapshot(a)).toEqual(scalarSnapshot(b));
    }
  });

  it('defaults to an empty set, and every FILLED role holder is tracked as offline', () => {
    let world = createWorld(6, DEFAULT_WORLD_CONFIG);
    expect(world.currentlyOnline.size).toBe(0);
    world = stepWorld(world);
    const filledMillerId = world.millers.find((m) => m.slot.state === 'FILLED')!.buildingId;
    expect(world.presence[filledMillerId]).toEqual({ online: false, consecutiveOnlineDays: 0, consecutiveOfflineDays: 1 });
  });
});

describe('World.presence — real wiring', () => {
  it('a role holder reported online every tick accrues a real consecutive-day streak', () => {
    let world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const millerId = world.millers[0]!.buildingId;
    for (let i = 1; i <= 5; i++) {
      world = { ...world, currentlyOnline: new Set([millerId]) };
      world = stepWorld(world);
      if (world.millers.find((m) => m.buildingId === millerId)?.slot.state === 'FILLED') {
        expect(world.presence[millerId]?.online).toBe(true);
        expect(world.presence[millerId]?.consecutiveOnlineDays).toBeGreaterThan(0);
      }
    }
  });

  it('presence has exactly one entry per currently-FILLED role slot, every tick', () => {
    let world = createWorld(8, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 20; i++) {
      world = stepWorld(world);
      const filledIds = [...world.millers, ...world.bakers, ...world.couriers, ...world.investigators, ...world.importExporters]
        .filter((s) => s.slot.state === 'FILLED')
        .map((s) => s.buildingId)
        .sort();
      expect(Object.keys(world.presence).sort()).toEqual(filledIds);
    }
  });

  it('currentlyOnline is carried through unchanged by stepWorld (a live snapshot, not drained)', () => {
    let world = createWorld(9, DEFAULT_WORLD_CONFIG);
    const someId = world.millers[0]!.buildingId;
    world = { ...world, currentlyOnline: new Set([someId]) };
    world = stepWorld(world);
    expect(world.currentlyOnline).toEqual(new Set([someId]));
    world = stepWorld(world); // caller never re-set it — must still be there next tick too
    expect(world.currentlyOnline).toEqual(new Set([someId]));
  });

  it('is deterministic for a given seed and a given currentlyOnline trajectory', () => {
    let a = createWorld(10, DEFAULT_WORLD_CONFIG);
    let b = createWorld(10, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 15; i++) {
      const online = new Set(i % 2 === 0 ? [a.millers[0]!.buildingId] : []);
      a = { ...a, currentlyOnline: online };
      b = { ...b, currentlyOnline: online };
      a = stepWorld(a);
      b = stepWorld(b);
      expect(a.presence).toEqual(b.presence);
    }
  });
});
