import { describe, expect, it } from 'vitest';
import {
  stepResourceFlows,
  accumulate,
  emptyLedger,
  flourBalance,
  RESOURCE_NAMES,
  RESOURCE_OWNER,
  GRAIN_PER_FLOUR,
  FLOUR_PER_BREAD,
  PARCELS_PER_COURIER_DAY,
  STORIES_PER_JOURNALIST_DAY,
  LEADS_PER_DETECTIVE_DAY,
} from '../src/engine/resources.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

describe('resources — named per-role variables', () => {
  it('every named resource has exactly one owning role', () => {
    for (const name of RESOURCE_NAMES) expect(RESOURCE_OWNER[name]).toBeTruthy();
    expect(new Set(Object.values(RESOURCE_OWNER)).size).toBe(RESOURCE_NAMES.length);
  });

  it('flour comes from Miller quantities and grain demand follows it at the stated ratio', () => {
    const f = stepResourceFlows([0.5, 0.5], [], [], [], [], 1);
    expect(f.flourProduced).toBeCloseTo(1.0, 10);
    expect(f.grainConsumed).toBeCloseTo(1.0 * GRAIN_PER_FLOUR, 10);
  });

  it('bread comes from served customers and draws flour at the stated ratio', () => {
    const f = stepResourceFlows([], [4, 6], [], [], [], 1);
    expect(f.breadProduced).toBeCloseTo(10, 10);
    expect(f.flourConsumed).toBeCloseTo(10 * FLOUR_PER_BREAD, 10);
  });

  it('support roles produce their own named resource, scaled by friction and activity', () => {
    const f = stepResourceFlows([], [], [1, 0.5], [1], [1, 1], 0.5);
    expect(f.parcelsDelivered).toBeCloseTo(1.5 * PARCELS_PER_COURIER_DAY * 0.5, 10);
    expect(f.storiesFiled).toBeCloseTo(1 * STORIES_PER_JOURNALIST_DAY * 0.5, 10);
    expect(f.leadsDeveloped).toBeCloseTo(2 * LEADS_PER_DETECTIVE_DAY * 0.5, 10);
  });

  it('a role with nobody FILLED produces exactly zero of its resource', () => {
    const f = stepResourceFlows([], [], [], [], [], 1);
    for (const v of Object.values(f)) expect(v).toBe(0);
  });

  it('accumulate sums over days and never loses the running total', () => {
    let ledger = emptyLedger();
    for (let i = 0; i < 10; i++) ledger = accumulate(ledger, stepResourceFlows([0.5], [2], [1], [1], [1], 1));
    expect(ledger.cumulative.flourProduced).toBeCloseTo(5, 10);
    expect(ledger.cumulative.breadProduced).toBeCloseTo(20, 10);
    expect(ledger.today.flourProduced).toBeCloseTo(0.5, 10);
  });

  it('flourBalance reports the real milled-minus-baked gap, signed', () => {
    expect(flourBalance(stepResourceFlows([1], [1], [], [], [], 1))).toBeCloseTo(1 - FLOUR_PER_BREAD, 10);
  });
});

describe('resources — wired into the world kernel and trackable over time', () => {
  it('every resource accumulates monotonically across a real run (never decreases)', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    let prev = world.resources.cumulative;
    for (let i = 0; i < 200; i++) {
      world = stepWorld(world);
      const c = world.resources.cumulative;
      for (const k of Object.keys(c) as (keyof typeof c)[]) expect(c[k]).toBeGreaterThanOrEqual(prev[k]);
      prev = c;
    }
    expect(prev.flourProduced).toBeGreaterThan(0);
    expect(prev.breadProduced).toBeGreaterThan(0);
    expect(prev.parcelsDelivered).toBeGreaterThan(0);
    expect(prev.storiesFiled).toBeGreaterThan(0);
    expect(prev.leadsDeveloped).toBeGreaterThan(0);
  });

  it('grain demand is real and accumulating despite having no producer yet — the Import/Export gap, measurable', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 100; i++) world = stepWorld(world);
    expect(world.resources.cumulative.grainConsumed).toBeGreaterThan(0);
    expect(world.resources.cumulative.grainConsumed).toBeCloseTo(world.resources.cumulative.flourProduced * GRAIN_PER_FLOUR, 6);
  });

  it('the grain->flour->bread chain is coherent at the shipped role ratio — no chronic flour deficit', () => {
    // Regression for a real defect these resources exposed: at FLOUR_PER_BREAD=0.35 the
    // shard ran a permanent deficit (Bakers drawing flour that was never milled). Guards
    // the chain against silently drifting incoherent if role counts or ratios change.
    // Per-seed surplus/deficit is noisy, so this asserts the RATIO stays near parity
    // rather than demanding surplus on every seed. The original 0.35 defect sat at ~1.31.
    for (const seed of [1, 2, 3, 4, 5]) {
      let w = createWorld(seed, DEFAULT_WORLD_CONFIG);
      for (let i = 0; i < 1500; i++) w = stepWorld(w);
      const c = w.resources.cumulative;
      expect(c.flourConsumed / c.flourProduced).toBeLessThan(1.05);
    }
  });

  it('resource tracking is deterministic for a given seed', () => {
    const run = () => {
      let w = createWorld(11, DEFAULT_WORLD_CONFIG);
      for (let i = 0; i < 120; i++) w = stepWorld(w);
      return w.resources;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
