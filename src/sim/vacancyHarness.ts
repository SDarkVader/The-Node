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
}

export interface VacancyRunResult {
  voluntaryFills: number;
  backstopFires: number;
  /** Slot-days spent in VACANT specifically (not FILLED, not BACKSTOPPED) — genuinely
   *  unserved, before the safety net catches it. */
  vacantSlotDays: number;
  /** Slot-days spent in BACKSTOPPED — covered by the NPC, not "starved" in the sense the
   *  backstop exists to prevent, but also not a real player. Tracked separately so
   *  "starved fraction" can be defined either way. */
  backstoppedSlotDays: number;
  totalSlotDays: number;
  /** Length in days of every resolved vacancy episode (voluntary fill or backstop-capped). */
  gapDays: number[];
}

const DEFAULTS = { beta: 0.0008, tPain: 14, vBoost: 3.0, tFlag: 3, tHard: 14 };

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
  };

  let slots: RoleSlot[] = Array.from({ length: config.R }, () => ({ state: 'FILLED', vacantSince: null }));

  let voluntaryFills = 0;
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
        voluntaryFills += 1;
        // Only push a "gap" for fills straight out of VACANT. A fill that displaces an
        // NPC (fromBackstopped) isn't a longer vacancy gap — the role was continuously
        // covered by the backstop; its gap was already recorded, capped at tHard, when
        // backstopFires originally fired.
        if (!event.fromBackstopped) {
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
    voluntaryFills,
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
