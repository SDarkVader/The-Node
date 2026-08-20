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
 * Wealth earned per unit of Manhattan distance a Courier's own station sits from the shard
 * hub, per day. [CALIBRATED — measured, not guessed, per constraint 1].
 *
 * RE-DERIVED 2026-08-19 against real geometry, twice over, because the population you average
 * matters and the obvious choice is the wrong one. Across 8 seeds with the district centred:
 * all 90-odd lattice plots mean 4.829 from the hub, all ~62 buildings mean 4.724 — but the
 * only population this constant should be calibrated against is REAL COURIER STATIONS, which
 * mean **4.357**, because `assignRoleBuildings` does not scatter roles uniformly. Using either
 * broader mean underpays couriers by 8-12% against target.
 *
 * `SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER` at friction=1 is ~1.05/day, so:
 *   4.357 x 0.344 x 0.70 = 1.049/day at the mean.
 * This preserves `SUPPORT_ROLE_DAILY_WAGE`'s calibration intent (a support role should be a
 * genuine economic option, neither dominant nor dominated) while keeping the real distance
 * variance a flat wage never had — an edge courier earns more per day than one beside the
 * Wall, and pays for it in the trade-route friction their district may already impose
 * (`frictionFor` in `world.ts`), the two pressures composing rather than duplicating.
 *
 * The previous value (0.075) was calibrated against ~20-unit routes in the pre-2026-08-13
 * 6-district layout and was never re-derived when the shard dropped to one district. That is
 * why couriers had been earning ~40% of their peers in every run since.
 */
export const COURIER_FEE_PER_DISTANCE_UNIT = 0.344;

/**
 * Minimum billable route distance (2026-08-19). A Courier whose own station sits ON the hub
 * would otherwise bill zero and earn nothing, forever, with no action available to them that
 * changes it — a permanent zero-state for that player, which **constraint 2** rules out
 * outright. Rare but real: measured across 8 seeds, 1 of 496 generated buildings lands exactly
 * on the centre (no Courier drew it in that sample, which is precisely what makes it dangerous
 * — it would have shipped as an invisible edge case rather than an obvious breakage).
 *
 * A floor rather than an exclusion, deliberately: a courier at the Wall still walks a route,
 * still hands over parcels, still works a day. One unit is what "you did the job, however
 * short the trip" costs. Nothing above the floor is affected.
 */
export const COURIER_MIN_ROUTE_DISTANCE = 1;

/**
 * Real Manhattan distance from a Courier's OWN STATION to the shard hub (2026-08-19 — station
 * level, was district-plaza level).
 *
 * WHY THIS CHANGED, and why it could not have changed sooner. With one district per shard
 * (2026-08-13) every courier shared one plaza, so a "distance-indexed" wage indexed nothing —
 * every courier earned an identical 0.42-0.47/day against the 1.05 the other three support
 * roles get, in every run since that decision. The obvious fix (centre the district on the
 * hub, fixing the misplaced Wall) made it strictly worse: `plazaPlot` would equal `hubPlot`,
 * route distance would be exactly 0, and every courier would earn nothing at all. The two bugs
 * could only ever be fixed together, and only once a role-holder had a position of their own
 * to measure from — which arrived the same day (`RoleEconomicSlot.x`/`y`).
 *
 * Station-level distance restores real variance inside a single district: measured over real
 * Courier buildings across 8 seeds, distances run 1 to 7 with a mean of 4.357. A courier posted
 * at the settlement's edge genuinely walks further than one beside the Wall, and is paid for it.
 */
export function courierRouteDistance(pos: { x: number; y: number }, hubPlot: { x: number; y: number }): number {
  return Math.max(COURIER_MIN_ROUTE_DISTANCE, distance(pos, hubPlot));
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
