import { describe, expect, it } from 'vitest';
import { runMarket, tailAverage } from '../src/sim/harness.js';

/**
 * Encodes the §1.4 findings from the NODE build brief — confirmed by the design's own
 * simulation session and marked as "hard truth" to preserve across refactors. If any of
 * these break, the model has drifted from a validated property, not just a tuned constant.
 */

const DAYS = 400;
const BURN_IN = 200;
const SEED = 42;

function steadyBakerSpread(nMillers: number, nBakers: number, gamma: number): number {
  const result = runMarket({ nMillers, nBakers, gamma, days: DAYS, seed: SEED });
  return tailAverage(result.bakerSpread, BURN_IN);
}

describe('§1.4 — reaction slope gamma/2 boundary is gamma = 2, not 0.85', () => {
  it('n=2 bakers: stable for gamma < 2', () => {
    expect(steadyBakerSpread(3, 2, 1.99)).toBeLessThan(0.05);
  });

  it('n=2 bakers: no instability at the old rejected 0.85 threshold', () => {
    // An earlier draft spec claimed a chaos threshold at gamma < 0.85; that
    // boundary does not exist in this model and must not be resurrected.
    expect(steadyBakerSpread(3, 2, 0.85)).toBeLessThan(0.05);
    expect(steadyBakerSpread(3, 2, 1.5)).toBeLessThan(0.05);
  });

  it('n=2 bakers: price spread blows up once gamma exceeds 2', () => {
    const belowBoundary = steadyBakerSpread(3, 2, 1.99);
    const pastBoundary = steadyBakerSpread(3, 2, 2.5);
    expect(pastBoundary).toBeGreaterThan(0.3);
    expect(pastBoundary).toBeGreaterThan(belowBoundary * 10);
  });
});

describe('§1.4 — instability is a headcount property, not just a gamma property', () => {
  it('at n=2 in a role slot, gamma=2.5 destabilizes the slot', () => {
    expect(steadyBakerSpread(3, 2, 2.5)).toBeGreaterThan(0.3);
  });

  it('at n>=3 in a role slot, the system self-averages the same shock away', () => {
    // Same gamma that blows up n=2 must stay stable at n=3.
    expect(steadyBakerSpread(3, 3, 2.5)).toBeLessThan(0.05);
  });

  it('n>=3 role slots stay stable well past gamma=2 (not just up to it)', () => {
    expect(steadyBakerSpread(3, 3, 2.5)).toBeLessThan(0.05);
    expect(steadyBakerSpread(3, 4, 2.5)).toBeLessThan(0.05);
  });
});

describe('§1.4 — Miller headcount drives system volatility, not Baker headcount', () => {
  it('more millers -> lower flour price', () => {
    const fewMillers = runMarket({ nMillers: 2, nBakers: 3, gamma: 1.5, days: DAYS, seed: SEED });
    const manyMillers = runMarket({ nMillers: 4, nBakers: 3, gamma: 1.5, days: DAYS, seed: SEED });
    const priceFew = tailAverage(
      fewMillers.states.map((s) => s.flourPrice),
      BURN_IN,
    );
    const priceMany = tailAverage(
      manyMillers.states.map((s) => s.flourPrice),
      BURN_IN,
    );
    expect(priceMany).toBeLessThan(priceFew);
  });

  it('more millers -> higher baker-side volatility (upstream jostling propagates downstream)', () => {
    const fewMillers = steadyBakerSpread(2, 3, 1.5);
    const manyMillers = steadyBakerSpread(4, 3, 1.5);
    expect(manyMillers).toBeGreaterThan(fewMillers);
  });

  it('baker headcount (3, 4, or 5) barely changes flour price once millers set it', () => {
    const threeBakers = runMarket({ nMillers: 3, nBakers: 3, gamma: 1.5, days: DAYS, seed: SEED });
    const fiveBakers = runMarket({ nMillers: 3, nBakers: 5, gamma: 1.5, days: DAYS, seed: SEED });
    const price3 = tailAverage(
      threeBakers.states.map((s) => s.flourPrice),
      BURN_IN,
    );
    const price5 = tailAverage(
      fiveBakers.states.map((s) => s.flourPrice),
      BURN_IN,
    );
    expect(Math.abs(price3 - price5)).toBeLessThan(0.01);
  });

  it('baker headcount (3, 4, or 5) barely changes baker-side spread outcomes', () => {
    const spread3 = steadyBakerSpread(3, 3, 1.5);
    const spread5 = steadyBakerSpread(3, 5, 1.5);
    expect(Math.abs(spread3 - spread5)).toBeLessThan(0.01);
  });
});
