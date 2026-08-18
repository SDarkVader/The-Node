import { createWorld, stepWorld, type World, type WorldConfig, type OracleTickStats } from '../world/world.js';
import { oracleWinProbability } from '../engine/oracle.js';

/**
 * The Oracle's population-scale simulation harness — `docs/HANDOVER.md`'s top deferred item
 * as of 2026-08-18 ("measure the Oracle's real win rates and wealth/Gini impact under load
 * before trusting its illustrative constants further"), and the exact re-simulation
 * `docs/DESIGN_ORACLE_2026-08-13.md` §5 asks for: confirm a REAL, health-linked `base_odds`
 * doesn't break the exit-ticket gamble's own already-validated properties (stable win rate,
 * no death-spiral) before trusting the Oracle's constants any further.
 *
 * Unlike `experienceFloorHarness.ts`/`evictionProtectionHarness.ts`, this is NOT a with/
 * without counterfactual — the Oracle is unconditionally wired into every `stepWorld` tick
 * (no config flag gates it), and its own effects (wealth, personalResourceStock, daysAsGrifter/
 * daysInRole) compound with ordinary market activity in ways a "strip the field back out"
 * approach can't honestly separate mid-run. Instead this measures the REAL, single-world
 * run directly against `World.lastOracleStats` (2026-08-18's side-channel, added specifically
 * to make this measurement possible without inferring activity from field deltas) and the
 * `wealthGini`/`economicHealthWithExperience` `World` already tracks every tick — the same
 * "report what actually happened" discipline every other harness in this session already uses.
 */

export interface OracleRunResult {
  statsSeries: OracleTickStats[];
  /** `oracleWinProbability` evaluated on the SAME pre-tick `economicHealthWithExperience`
   *  the Oracle stage inside that exact `stepWorld` call actually rolled against — not
   *  reconstructed after the fact, so there's no off-by-one risk against the "yesterday's
   *  health" timing `world.ts`'s own Oracle stage comment documents. */
  winProbabilitySeries: number[];
  economicHealthWithExperienceSeries: number[];
  wealthGiniSeries: number[];
  wealthTop10ShareSeries: number[];
  populationSeries: number[];
}

export function runOracleSimulation(seed: number, days: number, config: WorldConfig): OracleRunResult {
  let world: World = createWorld(seed, config);
  const result: OracleRunResult = {
    statsSeries: [],
    winProbabilitySeries: [],
    economicHealthWithExperienceSeries: [],
    wealthGiniSeries: [],
    wealthTop10ShareSeries: [],
    populationSeries: [],
  };

  for (let day = 0; day < days; day++) {
    result.winProbabilitySeries.push(oracleWinProbability(world.economicHealthWithExperience));
    world = stepWorld(world);
    result.statsSeries.push(world.lastOracleStats);
    result.economicHealthWithExperienceSeries.push(world.economicHealthWithExperience);
    result.wealthGiniSeries.push(world.wealthGini);
    result.wealthTop10ShareSeries.push(world.wealthTop10Share);
    result.populationSeries.push(world.population);
  }

  return result;
}
