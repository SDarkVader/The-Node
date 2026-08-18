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
 *
 * CORRECTED 2026-08-13, same day, before this ever shipped a second version: the first cap
 * (50% of EXPERIENCE_CAP, reachable in just 5 shifts) was flagged as a real problem, not a
 * style note — "if a lvl 2 player had a distinct advantage over a grifter after the
 * backstop, then we're also giving people an opportunity to just jump the queue and
 * grifters won't be able to get anywhere... otherwise the experienced become the only
 * players." Two things are true at once here, and both matter:
 *
 * 1. Selection was never affected — `stepWorld`'s conscription event loop picks WHO fills
 *    a vacant slot purely by lowest reputation level then longest wait, with zero input
 *    from `shiftsCoveredByRole`. Nobody skips the queue because of this mechanism; it only
 *    ever changes what experience the already-selected person's slot starts with.
 * 2. The SIZE of that starting boost was still a real, unverified risk. A cushion big
 *    enough to functionally erase the productivity dip stops reading as "softened," it
 *    reads as "a real edge" — precisely the compounding-advantage shape this whole
 *    project's constraint 6 exists to rule out elsewhere. Cut hard, not trimmed: cap
 *    dropped 50%->15% of EXPERIENCE_CAP, keeping the same "5 real shifts to max it out"
 *    shape so genuine practice still means something, but the ceiling itself can now only
 *    ever be a cushion, never anything resembling a distinct advantage. Still
 *    `[CALIBRATED — provisional]` — this number is a considered, conservative guess made
 *    under real constraints, not a measured one; simulate it before trusting it further,
 *    same as everything else in this file.
 */

/** [CALIBRATED — provisional] experience granted per prior shift covered in that same role. */
export const EXPERIENCE_FLOOR_PER_SHIFT = EXPERIENCE_CAP * 0.03;

/** [CALIBRATED — provisional, corrected 2026-08-13 — was 0.5, cut hard after a real
 *  compounding-advantage concern, not trimmed] the floor never exceeds this fraction of
 *  EXPERIENCE_CAP — a small cushion, not anything resembling parity with a real veteran;
 *  growing the rest still has to be earned exactly like everyone else. */
export const EXPERIENCE_FLOOR_MAX_FRACTION = 0.15;

/**
 * The experience a grifter starts a role with, given how many times they've covered that
 * exact role before. 0 prior covers (the common case, since most conscripts are green) is
 * identical to today's `experience: 0` — this never makes a fresh grifter worse off.
 */
export function experienceFloorFromShiftsCovered(shiftsCoveredInThisRole: number): number {
  const floor = Math.max(0, shiftsCoveredInThisRole) * EXPERIENCE_FLOOR_PER_SHIFT;
  return Math.min(EXPERIENCE_CAP * EXPERIENCE_FLOOR_MAX_FRACTION, floor);
}
