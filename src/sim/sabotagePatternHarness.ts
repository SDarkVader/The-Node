import { mulberry32 } from './rng.js';
import { dailyChurnFromMonthly, stepSlot, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS } from './vacancyHarness.js';
import {
  S_DEFAULT,
  economicHealth,
  patternStepDetectionProbability,
  PATTERN_STEPS_DEFAULT,
  PATTERN_STEP_CADENCE_DAYS_DEFAULT,
  PATTERN_P_PER_WITNESS_DEFAULT,
  PATTERN_DETECTIVE_BONUS_DEFAULT,
} from '../engine/ecosystem.js';

/**
 * Simulates the pattern-based sabotage PROPOSAL (see `ecosystem.ts`'s "Sabotage,
 * pattern-based re-specification" section) against a real vacancy-driven shard, so its
 * numbers are checked the same way the act-based mechanic was in `ecosystemHarness.ts` —
 * per CLAUDE.md constraint 1, simulated before trusted, not just derived. Not wired into
 * any default; this file exists to produce the numbers `docs/BLUEPRINT.md`'s proposal
 * writeup reports, for review, not to become the new default sabotage path.
 *
 * One campaign runs at a time per config (a single patient attacker, stepping once every
 * `stepCadenceDays`); a caught or successful campaign immediately restarts a fresh one, so
 * a long run measures the steady-state rate of both outcomes.
 */

export interface PatternSabotageConfig {
  seed: number;
  days: number;
  s?: number;
  n?: number;
  pMonthly?: number;
  stepsRequired?: number;
  stepCadenceDays?: number;
  pPerWitness?: number;
  detectiveActive?: boolean;
  detectiveBonus?: number;
  damagePerSuccess?: number;
  /** Independent concurrent campaigns (separate attackers), each on its own cadence timer. */
  campaignCount?: number;
}

export interface CampaignOutcome {
  day: number;
  witnesses: number;
  outcome: 'caught' | 'succeeded';
  stepsCompleted: number;
}

export interface PatternSabotageResult {
  economicHealthSeries: number[];
  campaigns: CampaignOutcome[];
}

const S_DEFAULT_SLOTS = S_DEFAULT;

export function runPatternSabotageSim(config: PatternSabotageConfig): PatternSabotageResult {
  const s = config.s ?? S_DEFAULT_SLOTS;
  const n = config.n ?? 50;
  const pMonthly = config.pMonthly ?? 0.2;
  const stepsRequired = config.stepsRequired ?? PATTERN_STEPS_DEFAULT;
  const cadence = config.stepCadenceDays ?? PATTERN_STEP_CADENCE_DAYS_DEFAULT;
  const pPerWitness = config.pPerWitness ?? PATTERN_P_PER_WITNESS_DEFAULT;
  const detectiveActive = config.detectiveActive ?? false;
  const detectiveBonus = config.detectiveBonus ?? PATTERN_DETECTIVE_BONUS_DEFAULT;
  const damagePerSuccess = config.damagePerSuccess ?? 4;
  const campaignCount = config.campaignCount ?? 1;

  const rng = mulberry32(config.seed);
  const params: VacancyParams = {
    N: n,
    R: s,
    pDaily: dailyChurnFromMonthly(pMonthly),
    beta: DEFAULTS.beta,
    tPain: DEFAULTS.tPain,
    vBoost: DEFAULTS.vBoost,
    tFlag: DEFAULTS.tFlag,
    tHard: DEFAULTS.tHard,
  };

  let slots: RoleSlot[] = Array.from({ length: s }, () => ({ state: 'FILLED', vacantSince: null }));

  const result: PatternSabotageResult = { economicHealthSeries: [], campaigns: [] };

  const campaigns = Array.from({ length: campaignCount }, (_, i) => ({
    stepsCompleted: 0,
    nextStepDay: cadence + i, // offset so concurrent campaigns don't all roll on the same day
  }));

  for (let day = 1; day <= config.days; day++) {
    slots = slots.map((slot) => stepSlot(slot, day, params, rng).slot);

    for (const campaign of campaigns) {
      if (day !== campaign.nextStepDay) continue;

      const witnesses = slots.filter((slot) => slot.state === 'FILLED').length;
      campaign.stepsCompleted += 1;
      const p = patternStepDetectionProbability(
        campaign.stepsCompleted,
        stepsRequired,
        witnesses,
        detectiveActive,
        pPerWitness,
        detectiveBonus,
      );
      if (rng() < p) {
        result.campaigns.push({ day, witnesses, outcome: 'caught', stepsCompleted: campaign.stepsCompleted });
        campaign.stepsCompleted = 0;
      } else if (campaign.stepsCompleted >= stepsRequired) {
        result.campaigns.push({ day, witnesses, outcome: 'succeeded', stepsCompleted: campaign.stepsCompleted });
        const filledIdx = slots.map((slot, i) => (slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
        const evictCount = Math.min(damagePerSuccess, filledIdx.length);
        for (let k = 0; k < evictCount; k++) {
          const pick = filledIdx[Math.floor(rng() * filledIdx.length)]!;
          filledIdx.splice(filledIdx.indexOf(pick), 1);
          slots[pick] = { state: 'BACKSTOPPED', vacantSince: day };
        }
        campaign.stepsCompleted = 0;
      }
      campaign.nextStepDay = day + cadence;
    }

    const filledCount = slots.filter((slot) => slot.state === 'FILLED').length;
    result.economicHealthSeries.push(economicHealth(filledCount, s));
  }

  return result;
}
