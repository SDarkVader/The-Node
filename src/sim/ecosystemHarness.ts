import { mulberry32 } from './rng.js';
import { dailyChurnFromMonthly, stepSlot, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS } from './vacancyHarness.js';
import {
  S_DEFAULT,
  economicHealth,
  economicHealthWithExperience,
  growExperience,
  EXPERIENCE_CAP,
  detectionProbability,
  sabotageAttempt,
} from '../engine/ecosystem.js';

/**
 * Runs the two economic-health formulas together on one real trajectory — closing the
 * "known gap" flagged in `src/engine/ecosystem.ts`'s header (they were validated
 * independently and never run together). Uses `vacancy.ts`'s real per-slot semi-Markov
 * dynamics (FILLED/VACANT/BACKSTOPPED via `stepSlot`), not the toy aggregate-count model
 * `ecosystem.ts`'s own acceptance tests used — a stronger, more integrated check.
 *
 * Two verified findings this produced (2026-08-08, user: "run the economies together.
 * we won't know otherwise"), both locked into `test/ecosystem.regression.test.ts`:
 *
 * 1. Under sustained sabotage, `economicHealth()` alone understates the damage.
 *    Forced slot turnover keeps re-filled slots perpetually inexperienced, so
 *    `economicHealthWithExperience()` reads meaningfully lower — the gap between the
 *    two roughly triples under sustained sabotage versus baseline churn alone. A
 *    dashboard using only the no-experience formula would miss real, ongoing damage.
 * 2. Wiring `sabotageAttempt()`'s real detection roll into the sabotage mechanic
 *    (the original acceptance test bypassed it entirely — it called
 *    `applySabotageDamage(filled, 3, 4)` directly, hardcoding "3 successes," never
 *    exercising `sabotageAttempt()` at all) shows sabotage is nearly non-viable at
 *    realistic populated-shard witness counts (~20+) under the given
 *    `DETECTION_P_PER_WITNESS=0.05` — detection probability saturates near-certain
 *    per acquisition window regardless of cadence, so successful sabotage rounds are
 *    rare. This also interacts with the Phase 2 VACANT-gap recalibration
 *    (`beta=0.03, tHard=3`): a depleted shard heals back to near-full occupancy well
 *    within 20 days regardless of starting point, so slower sabotage cadences never
 *    even get a depleted, low-witness shard to attack.
 *
 * Per the user's explicit boundary: this only simulates the *mechanical* precondition
 * (was an act witnessed — `sabotageRounds[].successCount`/`witnesses`). It does not
 * model any consequence of being witnessed — no reputation, no scripted retaliation, no
 * NPC response. "People react — the outcome is unknowable until players decide how to
 * respond" is a boundary on what this file simulates, not an oversight.
 *
 * Modeling assumptions this combination required that neither `vacancy.ts` nor
 * `ecosystem.ts` specify on their own (flagged, not silently picked):
 * - Per-slot experience grows while FILLED, resets to 0 the moment a slot transitions
 *   INTO FILLED (a new occupant, whether from VACANT or BACKSTOPPED-recovery) — modeled
 *   as belonging to whoever currently holds the role, not the slot itself.
 * - Experience is frozen (neither grows nor decays) while VACANT or BACKSTOPPED.
 * - Sabotage-evicted slots freeze their experience at eviction rather than resetting —
 *   the slot was forced empty, not handed to a new occupant yet; the reset happens on
 *   the later `voluntaryFill` event when someone actually re-fills it.
 */

export type SabotageMode = 'none' | 'fixed-success' | 'detection-driven';

export interface CombinedEconomyConfig {
  seed: number;
  days: number;
  s?: number;
  n?: number;
  pMonthly?: number;
  sabotageMode?: SabotageMode;
  sabotageCadenceDays?: number;
  saboteurCount?: number;
  acquireDays?: number;
  damagePerSuccess?: number;
}

export interface SabotageRound {
  day: number;
  witnesses: number;
  successCount: number;
}

export interface CombinedEconomyResult {
  filledSeries: number[];
  avgExpSeries: number[];
  economicHealthSeries: number[];
  economicHealthWithExperienceSeries: number[];
  sabotageRounds: SabotageRound[];
}

const SABOTEUR_COUNT_DEFAULT = 3;
const ACQUIRE_DAYS_DEFAULT = 5; // [ILLUSTRATIVE] — not specified in the source material
const DAMAGE_PER_SUCCESS_DEFAULT = 4; // matches the original acceptance test's scenario
const SABOTAGE_CADENCE_DEFAULT = 20; // matches the original acceptance test's scenario

export function runCombinedEconomySim(config: CombinedEconomyConfig): CombinedEconomyResult {
  const s = config.s ?? S_DEFAULT;
  const n = config.n ?? 50;
  const pMonthly = config.pMonthly ?? 0.2;
  const sabotageMode = config.sabotageMode ?? 'none';
  const cadence = config.sabotageCadenceDays ?? SABOTAGE_CADENCE_DEFAULT;
  const saboteurCount = config.saboteurCount ?? SABOTEUR_COUNT_DEFAULT;
  const acquireDays = config.acquireDays ?? ACQUIRE_DAYS_DEFAULT;
  const damagePerSuccess = config.damagePerSuccess ?? DAMAGE_PER_SUCCESS_DEFAULT;

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
  const exp: number[] = new Array(s).fill(EXPERIENCE_CAP); // start maxed, "established shard"

  const result: CombinedEconomyResult = {
    filledSeries: [],
    avgExpSeries: [],
    economicHealthSeries: [],
    economicHealthWithExperienceSeries: [],
    sabotageRounds: [],
  };

  for (let day = 1; day <= config.days; day++) {
    slots = slots.map((slot, i) => {
      const wasFilled = slot.state === 'FILLED';
      const { slot: next, event } = stepSlot(slot, day, params, rng);
      if (event?.type === 'voluntaryFill') {
        exp[i] = 0;
      } else if (wasFilled && next.state === 'FILLED') {
        exp[i] = growExperience(exp[i]!);
      }
      return next;
    });

    if (sabotageMode !== 'none' && day % cadence === 0) {
      const filledIdx = slots.map((slot, i) => (slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
      const witnesses = filledIdx.length;
      const successCount =
        sabotageMode === 'fixed-success'
          ? saboteurCount
          : sabotageAttempt(saboteurCount, acquireDays, detectionProbability(Math.max(0, witnesses - 1)), rng);
      const evictCount = Math.min(successCount * damagePerSuccess, filledIdx.length);
      for (let k = 0; k < evictCount; k++) {
        const pick = filledIdx[Math.floor(rng() * filledIdx.length)]!;
        filledIdx.splice(filledIdx.indexOf(pick), 1);
        slots[pick] = { state: 'BACKSTOPPED', vacantSince: day };
      }
      result.sabotageRounds.push({ day, witnesses, successCount });
    }

    const filledCount = slots.filter((slot) => slot.state === 'FILLED').length;
    const filledExpValues = slots
      .map((slot, i) => (slot.state === 'FILLED' ? exp[i]! : null))
      .filter((v): v is number => v !== null);
    const avgExp = filledExpValues.length > 0 ? filledExpValues.reduce((a, b) => a + b, 0) / filledExpValues.length : 0;

    result.filledSeries.push(filledCount);
    result.avgExpSeries.push(avgExp);
    result.economicHealthSeries.push(economicHealth(filledCount, s));
    result.economicHealthWithExperienceSeries.push(economicHealthWithExperience(filledCount, avgExp, s));
  }

  return result;
}

export function tailMean(series: number[], burnIn: number): number {
  const tail = series.slice(burnIn);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
