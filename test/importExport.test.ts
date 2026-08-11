import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/rng.js';
import {
  routeFor, attemptCrossing, interceptProbability, drawTicketProgress,
  grainDeliveredToday, millingCapacityFactor,
  NODULES_PER_DAY, GRAIN_PER_NODULE, BACKSTOPPED_NODULE_FRACTION,
  INTERCEPT_BASE_P, INTERCEPT_JITTER, COMPLETE_TICKET_FRACTION,
} from '../src/engine/importExport.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

describe('Import/Export — routes and interception', () => {
  it('a complete exit ticket always crosses, however it was completed (gambled or ground out)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i++) expect(attemptCrossing({ complete: true, partial: false }, rng)).toBe(true);
  });

  it('partial postcard progress opens the illegal route — possible, but genuinely risky', () => {
    const rng = mulberry32(2);
    let crossed = 0;
    for (let i = 0; i < 20000; i++) if (attemptCrossing({ complete: false, partial: true }, rng)) crossed++;
    const rate = crossed / 20000;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.75); // ~1 - INTERCEPT_BASE_P
  });

  it('holding nothing at all cannot cross', () => {
    expect(attemptCrossing({ complete: false, partial: false }, mulberry32(3))).toBe(false);
  });

  it('routeFor maps holdings to routes unambiguously', () => {
    expect(routeFor({ complete: true, partial: false })).toBe('legal');
    expect(routeFor({ complete: false, partial: true })).toBe('illegal');
    expect(routeFor({ complete: false, partial: false })).toBe('none');
  });

  it('interception is randomised per attempt with no learnable pattern, and stays a valid probability', () => {
    const rng = mulberry32(4);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const p = interceptProbability(rng);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(INTERCEPT_BASE_P - INTERCEPT_JITTER - 1e-9);
      expect(p).toBeLessThanOrEqual(INTERCEPT_BASE_P + INTERCEPT_JITTER + 1e-9);
      seen.add(Math.round(p * 1e6));
    }
    expect(seen.size).toBeGreaterThan(4000); // essentially never repeats — no fixed schedule
  });

  it('the emergent failure rate reproduces the 0.15 all prior multi-shard calibration used', () => {
    const rng = mulberry32(5);
    let failed = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) if (!attemptCrossing(drawTicketProgress(rng), rng)) failed++;
    expect(failed / N).toBeCloseTo((1 - COMPLETE_TICKET_FRACTION) * INTERCEPT_BASE_P, 2);
  });

  it('drawTicketProgress never leaves anyone with no route at all (constraint 2)', () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 5000; i++) expect(routeFor(drawTicketProgress(rng))).not.toBe('none');
  });
});

describe('Import/Export — nodules, grain, and the milling constraint', () => {
  it('grain scales with FILLED slots at the stated nodule/conversion rates', () => {
    expect(grainDeliveredToday(2, 0, 1)).toBeCloseTo(2 * NODULES_PER_DAY * GRAIN_PER_NODULE, 10);
  });

  it('a BACKSTOPPED slot still delivers a reduced but real supply — squeezed, never zeroed (constraint 2)', () => {
    const backstopped = grainDeliveredToday(0, 2, 1);
    expect(backstopped).toBeGreaterThan(0);
    expect(backstopped).toBeCloseTo(2 * BACKSTOPPED_NODULE_FRACTION * NODULES_PER_DAY * GRAIN_PER_NODULE, 10);
    expect(backstopped).toBeLessThan(grainDeliveredToday(2, 0, 1));
  });

  it('millingCapacityFactor is 1 when grain covers demand and proportional when it does not', () => {
    expect(millingCapacityFactor(10, 5)).toBe(1);
    expect(millingCapacityFactor(5, 5)).toBe(1);
    expect(millingCapacityFactor(2.5, 5)).toBeCloseTo(0.5, 10);
    expect(millingCapacityFactor(5, 0)).toBe(1); // nothing demanded, nothing constrained
  });

  it('an unstaffed Import/Export squeezes the shard but never mills it to a dead stop', () => {
    const config = { ...DEFAULT_WORLD_CONFIG, rImportExport: 1, pMonthly: 0.95 };
    let world = createWorld(9, config);
    for (let i = 0; i < 400; i++) {
      world = stepWorld(world);
      expect(world.flourPrice).toBeGreaterThan(0);
      expect(Number.isFinite(world.flourPrice)).toBe(true);
    }
    expect(world.resources.cumulative.flourProduced).toBeGreaterThan(0);
  });

  it('grain supply is real and covers milling demand at the shipped defaults', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 800; i++) world = stepWorld(world);
    const c = world.resources.cumulative;
    expect(c.grainDelivered).toBeGreaterThan(0);
    expect(c.grainDelivered).toBeGreaterThan(c.grainConsumed); // Import/Export actually covers the Millers
  });

  it('fewer Import/Export slots really does reduce flour milled — the dependency is not nominal', () => {
    const run = (rImportExport: number) => {
      let w = createWorld(4, { ...DEFAULT_WORLD_CONFIG, rImportExport });
      for (let i = 0; i < 600; i++) w = stepWorld(w);
      return w.resources.cumulative.flourProduced;
    };
    expect(run(1)).toBeLessThan(run(3));
  });
});
