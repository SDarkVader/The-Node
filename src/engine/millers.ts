import { clip } from './util.js';

/**
 * Miller layer — Cournot quantity competition (Phase 1, §1.2).
 * Each miller's quantity converges toward a best response to rivals' average output.
 * Requires n_millers >= 2 (avg_rival_q_i divides by n-1); the design's n=2 instability
 * cliff (§1.4) is a case of this function, not a separate code path.
 */
export function stepMillers(q: number[], noise: () => number): number[] {
  if (q.length < 2) {
    throw new Error('stepMillers requires at least 2 millers (avg_rival_q_i divides by n-1)');
  }
  const sum = q.reduce((a, b) => a + b, 0);
  return q.map((qi) => {
    const avgRivalQ = (sum - qi) / (q.length - 1);
    const next = 0.5 * qi + 0.5 * (1 - avgRivalQ) + noise();
    return clip(next, 0.01, 1);
  });
}

/** Inverse demand curve, flour price from aggregate miller supply (§1.2). [CALIBRATED — provisional] */
export function flourPrice(totalSupply: number): number {
  return clip(1.2 - 0.3 * totalSupply, 0.05, 2.0);
}
