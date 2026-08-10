import { mulberry32 } from './rng.js';
import { dailyChurnFromMonthly, fillHazard, stepSlot, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS } from './vacancyHarness.js';

/**
 * Miller conscription (2026-08-07 design, not in the original brief): the mechanical
 * backstop covers a vacant Miller slot only temporarily. Past a fixed delay, the
 * community is forced to
 * cover it — a random player is conscripted, mandatory, no opt-out ("like it or not").
 * The draft pool is everyone not already Miller: the non-role-holding "gossip layer"
 * AND existing holders of other roles. Drafting a gossip-layer player has no further
 * consequence; drafting an existing role-holder (e.g. a Courier) pulls them out of that
 * role, creating a real cascading vacancy there, which re-enters the ordinary vacancy/
 * backstop cycle (no conscription for non-Miller roles in this model — only Miller is
 * specified as needing it).
 *
 * This is a genuine multi-role coupling, so it lives at the sim/harness layer rather
 * than inside engine/vacancy.ts's stepSlot — that function stays the pure, tested,
 * single-slot primitive; the cross-role logic below composes several instances of it.
 * "Other" roles are lumped into one role type for this simulation, not modeled
 * individually — a simplification, not a design decision.
 */

export interface ConscriptionRunConfig {
  N: number;
  rMiller: number;
  rOther: number;
  pMonthly: number;
  days: number;
  seed: number;
  /** Days after a Miller backstop fires before conscription forces a fill. */
  conscriptionDelay: number;
  beta?: number;
  tPain?: number;
  vBoost?: number;
  tFlag?: number;
  tHard?: number;
}

export interface ConscriptionRunResult {
  millerGenuineFills: number;
  millerConscriptions: number;
  millerBackstopFires: number;
  millerVacantSlotDays: number;
  millerBackstoppedSlotDays: number;
  conscriptionsFromGossip: number;
  conscriptionsFromOtherRole: number;
  otherVoluntaryFills: number;
  otherBackstopFires: number;
  otherVacantSlotDays: number;
  otherBackstoppedSlotDays: number;
  totalMillerSlotDays: number;
  totalOtherSlotDays: number;
}

export function runConscriptionSim(config: ConscriptionRunConfig): ConscriptionRunResult {
  const rng = mulberry32(config.seed);
  const pDaily = dailyChurnFromMonthly(config.pMonthly);
  const millerParams: VacancyParams = {
    N: config.N,
    R: config.rMiller,
    pDaily,
    beta: config.beta ?? DEFAULTS.beta,
    tPain: config.tPain ?? DEFAULTS.tPain,
    vBoost: config.vBoost ?? DEFAULTS.vBoost,
    tFlag: config.tFlag ?? DEFAULTS.tFlag,
    tHard: config.tHard ?? DEFAULTS.tHard,
  };
  const otherParams: VacancyParams = { ...millerParams, R: config.rOther };

  // Gossip-layer pool size held constant — a drafted gossip player isn't tracked as a
  // distinct identity afterward (no per-player state in this model), so the pool size
  // used to weight draft-source probability doesn't shrink permanently. Simplification.
  const gossipSize = Math.max(config.N - config.rMiller - config.rOther, 0);

  let millerSlots: RoleSlot[] = Array.from({ length: config.rMiller }, () => ({ state: 'FILLED', vacantSince: null }));
  let otherSlots: RoleSlot[] = Array.from({ length: config.rOther }, () => ({ state: 'FILLED', vacantSince: null }));

  let millerGenuineFills = 0;
  let millerConscriptions = 0;
  let millerBackstopFires = 0;
  let millerVacantSlotDays = 0;
  let millerBackstoppedSlotDays = 0;
  let conscriptionsFromGossip = 0;
  let conscriptionsFromOtherRole = 0;
  let otherVoluntaryFills = 0;
  let otherBackstopFires = 0;
  let otherVacantSlotDays = 0;
  let otherBackstoppedSlotDays = 0;

  for (let day = 0; day < config.days; day++) {
    // Other roles: unchanged existing mechanic (probabilistic BACKSTOPPED recovery, no conscription).
    otherSlots = otherSlots.map((slot) => {
      if (slot.state === 'VACANT') otherVacantSlotDays += 1;
      else if (slot.state === 'BACKSTOPPED') otherBackstoppedSlotDays += 1;
      const { slot: next, event } = stepSlot(slot, day, otherParams, rng);
      if (event?.type === 'voluntaryFill') otherVoluntaryFills += 1;
      else if (event?.type === 'backstopFires') otherBackstopFires += 1;
      return next;
    });

    // Miller roles: custom step — deterministic conscription instead of probabilistic recovery.
    millerSlots = millerSlots.map((slot) => {
      if (slot.state === 'FILLED') {
        if (rng() < millerParams.pDaily) {
          return { state: 'VACANT', vacantSince: day };
        }
        return slot;
      }

      const tau = day - (slot.vacantSince ?? day);

      if (slot.state === 'VACANT') {
        millerVacantSlotDays += 1;
        if (tau >= millerParams.tHard) {
          millerBackstopFires += 1;
          return { state: 'BACKSTOPPED', vacantSince: slot.vacantSince };
        }
        if (rng() < fillHazard(tau, millerParams)) {
          millerGenuineFills += 1;
          return { state: 'FILLED', vacantSince: null };
        }
        return slot;
      }

      // BACKSTOPPED
      millerBackstoppedSlotDays += 1;
      if (tau - millerParams.tHard >= config.conscriptionDelay) {
        millerConscriptions += 1;
        const filledOtherCount = otherSlots.filter((s) => s.state === 'FILLED').length;
        const draftFromOther = rng() < filledOtherCount / (gossipSize + filledOtherCount);
        if (draftFromOther) {
          conscriptionsFromOtherRole += 1;
          const filledIndices = otherSlots.map((s, i) => (s.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
          const pick = filledIndices[Math.floor(rng() * filledIndices.length)]!;
          otherSlots = otherSlots.map((s, i) => (i === pick ? { state: 'VACANT', vacantSince: day } : s));
        } else {
          conscriptionsFromGossip += 1;
        }
        return { state: 'FILLED', vacantSince: null };
      }
      return slot;
    });
  }

  return {
    millerGenuineFills,
    millerConscriptions,
    millerBackstopFires,
    millerVacantSlotDays,
    millerBackstoppedSlotDays,
    conscriptionsFromGossip,
    conscriptionsFromOtherRole,
    otherVoluntaryFills,
    otherBackstopFires,
    otherVacantSlotDays,
    otherBackstoppedSlotDays,
    totalMillerSlotDays: config.rMiller * config.days,
    totalOtherSlotDays: config.rOther * config.days,
  };
}
