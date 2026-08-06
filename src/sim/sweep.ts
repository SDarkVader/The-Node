import { runMarket, tailAverage, type RunConfig } from './harness.js';

export interface StabilityPoint {
  nMillers: number;
  nBakers: number;
  gamma: number;
  avgBakerSpread: number;
  avgMillerSpread: number;
  avgFlourPrice: number;
}

/**
 * Sweeps market headcounts and gamma, returning steady-state stability metrics per point.
 * This is the harness §1.5/§6 asks for: reproduce the stability curves in §1.4 and
 * flag drift if a future change moves the n=2 cliff or the gamma=2 boundary.
 */
export function sweepStability(params: {
  nMillersRange: number[];
  nBakersRange: number[];
  gammaRange: number[];
  days?: number;
  seed?: number;
  burnInFraction?: number;
}): StabilityPoint[] {
  const days = params.days ?? 400;
  const seed = params.seed ?? 42;
  const burnIn = Math.floor(days * (params.burnInFraction ?? 0.5));

  const points: StabilityPoint[] = [];
  for (const nMillers of params.nMillersRange) {
    for (const nBakers of params.nBakersRange) {
      for (const gamma of params.gammaRange) {
        const run: RunConfig = { nMillers, nBakers, gamma, days, seed };
        const result = runMarket(run);
        points.push({
          nMillers,
          nBakers,
          gamma,
          avgBakerSpread: tailAverage(result.bakerSpread, burnIn),
          avgMillerSpread: tailAverage(result.millerSpread, burnIn),
          avgFlourPrice: tailAverage(
            result.states.map((s) => s.flourPrice),
            burnIn,
          ),
        });
      }
    }
  }
  return points;
}
