import { mulberry32 } from './rng.js';
import { dailyChurnFromMonthly, stepSlot, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';

export interface VacancyRunConfig {
  N: number;
  R: number;
  /** p_m — monthly churn probability per role-holder. */
  pMonthly: number;
  days: number;
  seed: number;
  beta?: number;
  tPain?: number;
  vBoost?: number;
  tFlag?: number;
  tHard?: number;
  /** Override for the BACKSTOPPED -> FILLED ambient recovery hazard; see VacancyParams. */
  backstoppedRecoveryHazard?: number;
}

export interface VacancyRunResult {
  /** genuineVoluntaryFills + backstopRecoveries. Kept for backward compatibility; prefer
   *  the split fields below for anything comparing against the brief's §2.4 ratio, since
   *  that ratio almost certainly means "resolved voluntarily instead of via backstop,"
   *  not "resolved voluntarily instead of OR after backstop." */
  voluntaryFills: number;
  /** Fills straight out of VACANT — resolved before the hard backstop ever fired. This is
   *  what §2.4's "voluntary fills outnumber backstop fires" almost certainly means. */
  genuineVoluntaryFills: number;
  /** Fills that take a slot back out of BACKSTOPPED — happen strictly *after* a backstop
   *  already fired, not instead of it. Every backstopFires eventually produces exactly
   *  one of these in this model (recovery is not permanently blocked), so including them
   *  in the same ratio as backstopFires inflates it by roughly +1 systematically. */
  backstopRecoveries: number;
  backstopFires: number;
  /** Slot-days spent in VACANT specifically (not FILLED, not BACKSTOPPED) — genuinely
   *  unserved, before the safety net catches it. */
  vacantSlotDays: number;
  /** Slot-days spent in BACKSTOPPED — covered mechanically, not "starved" in the sense the
   *  backstop exists to prevent, but also not a real player. Tracked separately so
   *  "starved fraction" can be defined either way. */
  backstoppedSlotDays: number;
  totalSlotDays: number;
  /** Length in days of every resolved vacancy episode (voluntary fill or backstop-capped). */
  gapDays: number[];
}

/**
 * beta and tHard were recalibrated 2026-08-07 from the brief's literal provisional
 * values (beta=0.0008, tHard=14) after proving those two targets are structurally
 * incompatible at tHard=14 — see docs/BLUEPRINT.md "Open deviations" for the bound
 * (starved_fraction >= backstopShare(ratio) * tHard * pDaily) and the grid search that
 * found this pair. Verified across N=50/60/80 and 12 seeds to hit both the ratio target
 * (~1.2:1 at N=50, ~2.8:1 at N=80) and the starved-fraction target (1-2%) simultaneously,
 * with BACKSTOPPED time landing lower than before (0.2-0.4%), not the mechanical-backstop-dominance
 * tradeoff the recovery-hazard-only fix required. tPain/vBoost/tFlag left at the brief's
 * literal values — tPain's plateau is now largely moot pre-backstop since tau caps at
 * tHard=3 before it ramps far, which is an emergent consequence of the fit, not a
 * separate deviation.
 */
export const DEFAULTS = { beta: 0.03, tPain: 14, vBoost: 3.0, tFlag: 3, tHard: 3 };

/** Runs R independent role-slots through the vacancy semi-Markov process for `days` days. */
export function runVacancySim(config: VacancyRunConfig): VacancyRunResult {
  const rng = mulberry32(config.seed);
  const params: VacancyParams = {
    N: config.N,
    R: config.R,
    pDaily: dailyChurnFromMonthly(config.pMonthly),
    beta: config.beta ?? DEFAULTS.beta,
    tPain: config.tPain ?? DEFAULTS.tPain,
    vBoost: config.vBoost ?? DEFAULTS.vBoost,
    tFlag: config.tFlag ?? DEFAULTS.tFlag,
    tHard: config.tHard ?? DEFAULTS.tHard,
    backstoppedRecoveryHazard: config.backstoppedRecoveryHazard,
  };

  let slots: RoleSlot[] = Array.from({ length: config.R }, () => ({ state: 'FILLED', vacantSince: null }));

  let genuineVoluntaryFills = 0;
  let backstopRecoveries = 0;
  let backstopFires = 0;
  let vacantSlotDays = 0;
  let backstoppedSlotDays = 0;
  const gapDays: number[] = [];

  for (let day = 0; day < config.days; day++) {
    slots = slots.map((slot) => {
      if (slot.state === 'VACANT') vacantSlotDays += 1;
      else if (slot.state === 'BACKSTOPPED') backstoppedSlotDays += 1;
      const { slot: nextSlot, event } = stepSlot(slot, day, params, rng);
      if (event?.type === 'voluntaryFill') {
        if (event.fromBackstopped) {
          backstopRecoveries += 1;
          // No gap push: the gap was already recorded, capped at tHard, when
          // backstopFires originally fired. This isn't a second vacancy gap.
        } else {
          genuineVoluntaryFills += 1;
          gapDays.push(event.gapDays);
        }
      } else if (event?.type === 'backstopFires') {
        backstopFires += 1;
        gapDays.push(params.tHard);
      }
      return nextSlot;
    });
  }

  return {
    voluntaryFills: genuineVoluntaryFills + backstopRecoveries,
    genuineVoluntaryFills,
    backstopRecoveries,
    backstopFires,
    vacantSlotDays,
    backstoppedSlotDays,
    totalSlotDays: config.R * config.days,
    gapDays,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}
