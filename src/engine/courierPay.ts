/**
 * Courier pay (2026-08-11 addendum item 6, "distance-indexed, commissioner-funded" — the
 * user's own words: "distance and time only, never cargo value"). Pure, dependency-thin:
 * reads only `space.ts`'s real geometry (`Shard.hubPlot`, `District.plazaPlot`, `distance()`)
 * — the same hub-and-spoke corridors every district already has, reused a second way, the
 * same pattern `districtAccess.ts` (2026-08-12) already set for this geometry.
 *
 * WHAT CHANGED FROM THE FLAT WAGE, AND WHY ONLY COURIER. Journalist/Detective/Import-Export
 * keep `wealth.ts`'s flat `SUPPORT_ROLE_DAILY_WAGE` unchanged — the addendum's item 6 names
 * Courier specifically, and none of the other three has a distance component anywhere in the
 * brief or lore to derive one from. Courier's flat wage is replaced with a real per-district
 * figure: the Manhattan distance from a Courier's own district's plaza to the shard hub —
 * the real transit distance their route already runs along. A courier based further out
 * genuinely travels further every day, and now earns accordingly. Cargo value never enters
 * the formula at all, which satisfies the addendum's explicit anti-collusion requirement
 * structurally (there is no cargo-value term to collude over), rather than by policing it.
 *
 * "COMMISSIONER-FUNDED, REAL TRANSFER" — WHAT WAS BUILT, AND WHAT WASN'T, FLAGGED HONESTLY,
 * same discipline item 4 used for its own Detective-task gap. The addendum's own words: "the
 * fee is paid by whoever commissioned the delivery... the commissioner's margin is what
 * survives after paying for distance." Taken completely literally, this would mean debiting
 * a specific other role's wealth (Miller/Baker, whose goods a Courier's parcels stand in for)
 * every time a Courier is paid. Measured before building it, per constraint 1: at the shipped
 * defaults, total courier pay runs roughly a third of Miller+Baker's COMBINED daily income —
 * not a minor fee line, but a first-order shock to a wealth balance this whole session's
 * history spent calibrating (flourRatio, Gini, wealth cap, completion-reward parity). No
 * other role's wealth anywhere in this codebase is computed by debiting another role's
 * ledger — Miller/Baker income is each its own market-clearing formula, not drawn from a
 * shared pool — so a literal transfer here would be a genuinely NEW kind of mechanic, which
 * is exactly what this addendum's own scope discipline says to stop and flag rather than
 * build ("if any item below seems to require... a new subsystem, that is a signal the item
 * has been misread"). What IS built: Courier income stops being an arbitrary flat number and
 * becomes a real, derived quantity — earned from the shard's actual geometry, the same
 * discipline every other formula in this codebase already follows (Miller/Baker's market
 * clearing, District Weather's tension, Economic Heat's readout). That is the honest,
 * buildable core of "commissioner-funded": paid for real transit, not summoned from nothing.
 * The literal cross-role wealth debit is left OPEN, not silently declined — see
 * `docs/BLUEPRINT.md`/`docs/HANDOVER.md`, to be revisited only alongside a dedicated
 * calibration pass (the `FLOUR_PER_BREAD` precedent), never folded in here at throwaway scale.
 */

import { distance, type Shard, type DistrictId } from './space.js';

/**
 * Wealth earned per unit of Manhattan distance a Courier's home district sits from the shard
 * hub, per day. [ILLUSTRATIVE — measured, not guessed, per constraint 1]: mean courier route
 * distance at the shipped 6-district default is ~20 units across 5 seeds (core couriers
 * ~6-10, periphery ~35-45; `distFor`/`courierRouteDistance` gives the real per-seed numbers).
 * `SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER` at friction=1 is ~1.05/day — this
 * constant is chosen so a courier at the MEAN distance earns close to that same figure
 * (0.075 * 20 * 0.7 ≈ 1.05), preserving `SUPPORT_ROLE_DAILY_WAGE`'s own calibration intent (a
 * support role should be a genuine economic option, not strictly dominant or dominated by
 * Miller/Baker) while introducing real distance variance the flat wage never had: a periphery
 * courier now genuinely earns more per day than a core one, and pays for it in exactly the
 * trade-route friction their own declining district may already impose (`frictionFor` in
 * `world.ts`) — the two pressures compose rather than duplicate.
 */
export const COURIER_FEE_PER_DISTANCE_UNIT = 0.075;

/**
 * Real Manhattan distance from a district's plaza to the shard hub — the corridor every
 * courier based there actually travels, the same geometry `districtAccess.ts` reads for
 * shortcut eligibility. Returns 0, not a crash, for an unknown districtId.
 */
export function courierRouteDistance(shard: Shard, districtId: DistrictId): number {
  const district = shard.districts.find((d) => d.id === districtId);
  return district ? distance(district.plazaPlot, shard.hubPlot) : 0;
}

/**
 * A FILLED Courier's daily pay: distance x rate x activity x friction — the same
 * activity/friction shape every other role's income already uses, so this composes with
 * existing pressure (a Courier in a declining district earns less, same as everyone else
 * there) rather than sitting apart from it. Never a function of parcel count or cargo value.
 */
export function courierDailyPay(
  routeDistance: number,
  activityMultiplier: number,
  frictionMultiplier: number,
  feePerDistanceUnit: number = COURIER_FEE_PER_DISTANCE_UNIT,
): number {
  return routeDistance * feePerDistanceUnit * activityMultiplier * frictionMultiplier;
}
