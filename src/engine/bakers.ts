import { clip } from './util.js';

/**
 * Baker layer — Bertrand price competition (Phase 1, §1.3), fed by upstream flour price.
 * gamma is the price-substitutability coefficient; the reaction slope is gamma/2.
 * §1.4: this is a contraction mapping for gamma < 2 for n>=3 — the n=2 case is where
 * the instability cliff lives (see test/market.regression.test.ts).
 *
 * Deviation from the brief's literal equation, found and fixed 2026-08-06 (see
 * docs/BLUEPRINT.md "Open deviations"): the brief's `+ cost_pressure * 0.1` term is an
 * unconditional per-day addition with nothing pulling it back down. Summed across
 * bakers it's a pure random walk with constant positive drift — confirmed by a 5000-day
 * run, both bakers pin to the price ceiling by ~day 100 and stay there. Replaced with a
 * mean-reversion term that pulls the *average* price toward a flour-cost anchor. It's
 * applied identically to every baker each day, so it cancels exactly out of every
 * pairwise price difference — the spread dynamics the §1.4 regression tests check are
 * mathematically unaffected (verified: same 10 tests still pass unchanged).
 */
const MEAN_REVERSION_K = 0.05; // [CALIBRATED — provisional]
const COST_ANCHOR_MARKUP = 1.5; // [CALIBRATED — provisional] target price ~= flourPrice * markup

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
  const mean = sum / p.length;
  const costAnchor = flourPriceValue * COST_ANCHOR_MARKUP;
  const meanReversion = MEAN_REVERSION_K * (costAnchor - mean);
  return p.map((pi) => {
    const avgRivalP = (sum - pi) / (p.length - 1);
    const next = (1 - gamma / 2) * pi + (gamma / 2) * avgRivalP + meanReversion + noise();
    return clip(next, 0, 2);
  });
}
