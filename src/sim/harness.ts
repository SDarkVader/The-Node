import { mulberry32 } from './rng.js';
import { initMarket, stepMarket, type MarketConfig, type MarketState } from '../engine/market.js';
import { spread } from '../engine/util.js';

export interface RunConfig {
  nMillers: number;
  nBakers: number;
  gamma: number;
  days: number;
  seed: number;
  noiseSigma?: number;
}

export interface RunResult {
  states: MarketState[];
  bakerSpread: number[];
  millerSpread: number[];
}

const DEFAULT_NOISE_SIGMA = 0.01; // [CALIBRATED — provisional], see MarketConfig.noiseSigma

/** Runs the Phase 1 chained market headlessly for `days` ticks (§1.5). Deterministic given `seed`. */
export function runMarket(run: RunConfig): RunResult {
  const rng = mulberry32(run.seed);
  const config: MarketConfig = {
    nMillers: run.nMillers,
    nBakers: run.nBakers,
    gamma: run.gamma,
    noiseSigma: run.noiseSigma ?? DEFAULT_NOISE_SIGMA,
    rng,
  };
  let state = initMarket(config);
  const states: MarketState[] = [state];
  for (let d = 0; d < run.days; d++) {
    state = stepMarket(state, config);
    states.push(state);
  }
  return {
    states,
    bakerSpread: states.map((s) => spread(s.bakerP)),
    millerSpread: states.map((s) => spread(s.millerQ)),
  };
}

/** Average of a series after discarding the first `burnIn` samples (lets transients settle). */
export function tailAverage(series: number[], burnIn: number): number {
  const tail = series.slice(burnIn);
  if (tail.length === 0) throw new Error('burnIn discards the entire series');
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
