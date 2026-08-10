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

export type ConscriptionDayEvent =
  | { type: 'millerVacantSlotDay' }
  | { type: 'millerBackstoppedSlotDay' }
  | { type: 'millerGenuineFill' }
  | { type: 'millerBackstopFires' }
  | { type: 'millerConscriptionFromGossip' }
  | { type: 'millerConscriptionFromOther' }
  | { type: 'otherVacantSlotDay' }
  | { type: 'otherBackstoppedSlotDay' }
  | { type: 'otherVoluntaryFill' }
  | { type: 'otherBackstopFires' };

export interface ConscriptionDayResult {
  millerSlots: RoleSlot[];
  otherSlots: RoleSlot[];
  events: ConscriptionDayEvent[];
}

/**
 * One day's update for a Miller role-slot array (deterministic conscription past
 * `conscriptionDelay`) and its coupled "other roles" array (plain `stepSlot`, no
 * conscription — the draft pool a conscription can pull from). Extracted from
 * `runConscriptionSim`'s day loop 2026-08-10 so `src/world/world.ts`'s unified kernel can
 * call the exact same logic instead of reimplementing it — per the Observatory build
 * spec's explicit "existing engine modules are called, not reimplemented" instruction.
 * Behavior is byte-for-byte identical to the pre-refactor inline loop; `runConscriptionSim`
 * below now just calls this and tallies its events, and every existing test in
 * `test/conscription.regression.test.ts` still passes unchanged as the regression check
 * on that claim.
 */
export function stepConscriptionDay(
  millerSlots: RoleSlot[],
  otherSlots: RoleSlot[],
  day: number,
  millerParams: VacancyParams,
  otherParams: VacancyParams,
  conscriptionDelay: number,
  gossipSize: number,
  rng: () => number,
): ConscriptionDayResult {
  const events: ConscriptionDayEvent[] = [];

  // Other roles: unchanged existing mechanic (probabilistic BACKSTOPPED recovery, no conscription).
  const nextOtherSlots = otherSlots.map((slot) => {
    if (slot.state === 'VACANT') events.push({ type: 'otherVacantSlotDay' });
    else if (slot.state === 'BACKSTOPPED') events.push({ type: 'otherBackstoppedSlotDay' });
    const { slot: next, event } = stepSlot(slot, day, otherParams, rng);
    if (event?.type === 'voluntaryFill') events.push({ type: 'otherVoluntaryFill' });
    else if (event?.type === 'backstopFires') events.push({ type: 'otherBackstopFires' });
    return next;
  });

  // Miller roles: custom step — deterministic conscription instead of probabilistic recovery.
  // Mutated in place within this closure (mirroring the pre-refactor loop's `otherSlots =
  // otherSlots.map(...)` reassignment inside the miller step) since a conscription-from-other
  // event needs to evict from whichever "other" array state the miller step is currently
  // looking at, not the pre-this-day snapshot.
  let workingOtherSlots = nextOtherSlots;
  const nextMillerSlots = millerSlots.map((slot) => {
    if (slot.state === 'FILLED') {
      if (rng() < millerParams.pDaily) {
        return { state: 'VACANT' as const, vacantSince: day };
      }
      return slot;
    }

    const tau = day - (slot.vacantSince ?? day);

    if (slot.state === 'VACANT') {
      events.push({ type: 'millerVacantSlotDay' });
      if (tau >= millerParams.tHard) {
        events.push({ type: 'millerBackstopFires' });
        return { state: 'BACKSTOPPED' as const, vacantSince: slot.vacantSince };
      }
      if (rng() < fillHazard(tau, millerParams)) {
        events.push({ type: 'millerGenuineFill' });
        return { state: 'FILLED' as const, vacantSince: null };
      }
      return slot;
    }

    // BACKSTOPPED
    events.push({ type: 'millerBackstoppedSlotDay' });
    if (tau - millerParams.tHard >= conscriptionDelay) {
      const filledOtherCount = workingOtherSlots.filter((s) => s.state === 'FILLED').length;
      const draftFromOther = rng() < filledOtherCount / (gossipSize + filledOtherCount);
      if (draftFromOther) {
        events.push({ type: 'millerConscriptionFromOther' });
        const filledIndices = workingOtherSlots.map((s, i) => (s.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
        const pick = filledIndices[Math.floor(rng() * filledIndices.length)]!;
        workingOtherSlots = workingOtherSlots.map((s, i) => (i === pick ? { state: 'VACANT' as const, vacantSince: day } : s));
      } else {
        events.push({ type: 'millerConscriptionFromGossip' });
      }
      return { state: 'FILLED' as const, vacantSince: null };
    }
    return slot;
  });

  return { millerSlots: nextMillerSlots, otherSlots: workingOtherSlots, events };
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

  const tally: Record<ConscriptionDayEvent['type'], number> = {
    millerVacantSlotDay: 0,
    millerBackstoppedSlotDay: 0,
    millerGenuineFill: 0,
    millerBackstopFires: 0,
    millerConscriptionFromGossip: 0,
    millerConscriptionFromOther: 0,
    otherVacantSlotDay: 0,
    otherBackstoppedSlotDay: 0,
    otherVoluntaryFill: 0,
    otherBackstopFires: 0,
  };

  for (let day = 0; day < config.days; day++) {
    const result = stepConscriptionDay(millerSlots, otherSlots, day, millerParams, otherParams, config.conscriptionDelay, gossipSize, rng);
    millerSlots = result.millerSlots;
    otherSlots = result.otherSlots;
    for (const event of result.events) tally[event.type] += 1;
  }

  return {
    millerGenuineFills: tally.millerGenuineFill,
    millerConscriptions: tally.millerConscriptionFromGossip + tally.millerConscriptionFromOther,
    millerBackstopFires: tally.millerBackstopFires,
    millerVacantSlotDays: tally.millerVacantSlotDay,
    millerBackstoppedSlotDays: tally.millerBackstoppedSlotDay,
    conscriptionsFromGossip: tally.millerConscriptionFromGossip,
    conscriptionsFromOtherRole: tally.millerConscriptionFromOther,
    otherVoluntaryFills: tally.otherVoluntaryFill,
    otherBackstopFires: tally.otherBackstopFires,
    otherVacantSlotDays: tally.otherVacantSlotDay,
    otherBackstoppedSlotDays: tally.otherBackstoppedSlotDay,
    totalMillerSlotDays: config.rMiller * config.days,
    totalOtherSlotDays: config.rOther * config.days,
  };
}
