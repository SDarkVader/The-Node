import { gaussian } from '../sim/rng.js';
import { flourPrice, stepMillers } from './millers.js';
import { stepBakers } from './bakers.js';

export interface MarketConfig {
  nMillers: number;
  nBakers: number;
  /** Bertrand price-substitutability coefficient, gamma (§1, §1.3). */
  gamma: number;
  /** Shock magnitude for the per-tick noise term. Not specified in the brief;
   *  [CALIBRATED — provisional] like the brief's other unvalidated constants. */
  noiseSigma: number;
  rng: () => number;
}

export interface MarketState {
  day: number;
  millerQ: number[];
  bakerP: number[];
  flourPrice: number;
}

export function initMarket(config: MarketConfig): MarketState {
  const millerQ = Array.from({ length: config.nMillers }, () => 0.3 + config.rng() * 0.2);
  const bakerP = Array.from({ length: config.nBakers }, () => 0.5 + config.rng() * 0.2);
  const supply = millerQ.reduce((a, b) => a + b, 0);
  return { day: 0, millerQ, bakerP, flourPrice: flourPrice(supply) };
}

/** Runs one day of the chained Cournot (Miller) -> Bertrand (Baker) market (§1.1). */
export function stepMarket(state: MarketState, config: MarketConfig): MarketState {
  const noise = () => gaussian(config.rng, config.noiseSigma);
  const millerQ = stepMillers(state.millerQ, noise);
  const supply = millerQ.reduce((a, b) => a + b, 0);
  const price = flourPrice(supply);
  const bakerP = stepBakers(state.bakerP, price, config.gamma, noise);
  return { day: state.day + 1, millerQ, bakerP, flourPrice: price };
}
