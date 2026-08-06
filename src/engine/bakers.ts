import { clip } from './util.js';

/**
 * Baker layer — Bertrand price competition (Phase 1, §1.3), fed by upstream flour price.
 * gamma is the price-substitutability coefficient; the reaction slope is gamma/2.
 * §1.4: this is a contraction mapping for gamma < 2 for n>=3 — the n=2 case is where
 * the instability cliff lives (see test/market.regression.test.ts).
 */
export function stepBakers(
  p: number[],
  flourPriceValue: number,
  gamma: number,
  noise: () => number,
): number[] {
  if (p.length < 2) {
    throw new Error('stepBakers requires at least 2 bakers (avg_rival_p_i divides by n-1)');
  }
  const sum = p.reduce((a, b) => a + b, 0);
  const costPressure = flourPriceValue * 0.3; // [CALIBRATED — provisional cost passthrough]
  return p.map((pi) => {
    const avgRivalP = (sum - pi) / (p.length - 1);
    const next = (1 - gamma / 2) * pi + (gamma / 2) * avgRivalP + costPressure * 0.1 + noise();
    return clip(next, 0, 2);
  });
}
