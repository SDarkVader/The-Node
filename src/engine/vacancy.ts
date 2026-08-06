/**
 * Vacancy as a semi-Markov process (Phase 2, §2.1-2.3). Three states per the brief's own
 * notation table (§1): FILLED, VACANT, BACKSTOPPED — not the two implied by §2.1's
 * shorthand diagram, which collapses "hard backstop fires" into "FILLED" for brevity.
 * BACKSTOPPED is a real, distinct, stable state (an NPC-run slot), not a synonym for
 * player-filled — see §2.5.
 */

export type SlotState = 'FILLED' | 'VACANT' | 'BACKSTOPPED';

export interface RoleSlot {
  state: SlotState;
  /** Day the slot most recently left FILLED. null while FILLED. */
  vacantSince: number | null;
}

export interface VacancyParams {
  /** N — node population. */
  N: number;
  /** R — number of essential role-slots. */
  R: number;
  /** p_d — daily churn probability per FILLED slot. [DERIVED] from p_m, see dailyChurnFromMonthly. */
  pDaily: number;
  /** β — baseline willingness-per-candidate-per-day. [CALIBRATED — provisional] */
  beta: number;
  /** T_pain — days for economic pressure to reach plateau. [CALIBRATED — provisional] */
  tPain: number;
  /** v_boost — visibility multiplier once a vacancy is publicly flagged. [CALIBRATED — provisional] */
  vBoost: number;
  /** t_flag — day a vacancy becomes publicly visible. [CALIBRATED — provisional] */
  tFlag: number;
  /** t_hard — day a vacancy is force-filled (hard backstop). [CALIBRATED — provisional] */
  tHard: number;
}

/** p_d = 1 - (1 - p_m)^(1/30) — daily churn probability derived from monthly (§1's notation table). */
export function dailyChurnFromMonthly(pMonthly: number): number {
  return 1 - Math.pow(1 - pMonthly, 1 / 30);
}

function visibility(tau: number, params: VacancyParams): number {
  return tau < params.tFlag ? 1 : params.vBoost;
}

function candidateWillingness(tau: number, params: VacancyParams): number {
  return params.beta * (0.2 + 0.8 * Math.min(tau / params.tPain, 1)) * visibility(tau, params);
}

/** λ_fill(τ) — hazard that a vacant slot gets voluntarily filled on a given day (§2.2). */
export function fillHazard(tau: number, params: VacancyParams): number {
  const pc = candidateWillingness(tau, params);
  return 1 - Math.pow(1 - pc, params.N - params.R);
}

export type VacancyEvent =
  | { type: 'churn'; day: number }
  | { type: 'voluntaryFill'; day: number; gapDays: number; fromBackstopped: boolean }
  | { type: 'backstopFires'; day: number };

export interface SlotStepResult {
  slot: RoleSlot;
  event: VacancyEvent | null;
}

/**
 * One day's transition for a single role-slot.
 *
 * BACKSTOPPED -> FILLED (a real player displacing the NPC) has no rate specified by the
 * brief at all — §2.4's findings are entirely about the pre-backstop VACANT phase. Left
 * unmodeled, every slot would eventually ratchet into BACKSTOPPED permanently over a long
 * run, which contradicts "starved fraction stays near 1-2% of the year" being a stable
 * steady-state figure rather than a monotonically growing one. Modeled here as an
 * ambient, non-escalating hazard equal to the pressure-plateau value (fillHazard frozen
 * at tau=t_hard) — pressure "bites but doesn't compound" past the backstop, matching the
 * brief's own 49-51 framing. This is an interpretive gap-fill, not a brief-specified
 * number — see docs/BLUEPRINT.md.
 */
export function stepSlot(
  slot: RoleSlot,
  day: number,
  params: VacancyParams,
  rng: () => number,
): SlotStepResult {
  if (slot.state === 'FILLED') {
    if (rng() < params.pDaily) {
      return { slot: { state: 'VACANT', vacantSince: day }, event: { type: 'churn', day } };
    }
    return { slot, event: null };
  }

  const tau = day - (slot.vacantSince ?? day);

  if (slot.state === 'VACANT') {
    if (tau >= params.tHard) {
      return {
        slot: { state: 'BACKSTOPPED', vacantSince: slot.vacantSince },
        event: { type: 'backstopFires', day },
      };
    }
    if (rng() < fillHazard(tau, params)) {
      return {
        slot: { state: 'FILLED', vacantSince: null },
        event: { type: 'voluntaryFill', day, gapDays: tau, fromBackstopped: false },
      };
    }
    return { slot, event: null };
  }

  // BACKSTOPPED
  const ambientHazard = fillHazard(params.tHard, params);
  if (rng() < ambientHazard) {
    return {
      slot: { state: 'FILLED', vacantSince: null },
      event: { type: 'voluntaryFill', day, gapDays: tau, fromBackstopped: true },
    };
  }
  return { slot, event: null };
}
