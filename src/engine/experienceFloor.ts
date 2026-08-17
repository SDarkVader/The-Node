import { EXPERIENCE_CAP } from './ecosystem.js';

/**
 * Experience head-start from real, role-specific Shift Cover practice (2026-08-13).
 * Answers a real question raised in design: when a Miller or Baker leaves and the only
 * replacement available is a grifter, the shard survives regardless (constraint 2 —
 * backstop/conscription bypass the reputation gate entirely) but the role's productivity
 * resets to zero experience, a real and previously un-mitigated cost.
 *
 * The first version of this idea scaled the head-start by overall reputation LEVEL —
 * wrong, because grifters essentially never reach level 2 (the "level-2 trap": level 1
 * already unlocks four roles at once, so 83-90% of grifters who reach level 1 get swept
 * into one within 7-16 days, per this session's own measurement). Scaling by level would
 * almost never have anything to draw from.
 *
 * This version scales by something that doesn't depend on that gate at all: how many
 * times THIS grifter has actually covered THIS SPECIFIC role via Shift Cover before —
 * real, witnessable, mechanical practice (constraint 3), tracked per-role rather than as
 * one aggregate counter. A grifter who's covered three Miller shifts should start a Miller
 * role closer to competent than one who's covered three Journalist shifts and never
 * touched a mill. Grant-only by construction (constraint 6): this only ever adds a floor
 * on top of the usual `experience: 0` reset, never subtracts from anyone.
 */

/** [CALIBRATED — provisional] experience granted per prior shift covered in that same role. */
export const EXPERIENCE_FLOOR_PER_SHIFT = EXPERIENCE_CAP * 0.1;

/** [CALIBRATED — provisional] the floor never exceeds this fraction of EXPERIENCE_CAP — a
 *  head start, not full parity with a real veteran; growing the rest still has to be earned. */
export const EXPERIENCE_FLOOR_MAX_FRACTION = 0.5;

/**
 * The experience a grifter starts a role with, given how many times they've covered that
 * exact role before. 0 prior covers (the common case, since most conscripts are green) is
 * identical to today's `experience: 0` — this never makes a fresh grifter worse off.
 */
export function experienceFloorFromShiftsCovered(shiftsCoveredInThisRole: number): number {
  const floor = Math.max(0, shiftsCoveredInThisRole) * EXPERIENCE_FLOOR_PER_SHIFT;
  return Math.min(EXPERIENCE_CAP * EXPERIENCE_FLOOR_MAX_FRACTION, floor);
}
