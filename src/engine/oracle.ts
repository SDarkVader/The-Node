/**
 * The Oracle (2026-08-18) — first code for a mechanic the brief specified back on 2026-08-06
 * and `docs/DESIGN_ORACLE_2026-08-13.md` gave real odds/prize shape to, but that has had zero
 * engine code until now. Pure, dependency-free, same style as every other `src/engine/`
 * module — `world.ts` is the only place that touches real player/grifter state.
 *
 * THE SHAPE, PER THE EXISTING DESIGN DOC (not reinvented here): a daily, universal, flat-odds
 * errand — "the same odds for a three-year veteran as for someone who joined this morning...
 * no story, no face behind it, nothing to resent when it goes against you." Odds float on
 * shard economic health (`economicHealthWithExperience`, chosen over plain `economicHealth`
 * in that doc specifically because it shows real movement under stress instead of hiding
 * behind the backstop's flat productivity floor), clamped so they never reach zero
 * (constraint 2 — a draw with truly zero odds would itself be a small permanent zero-state).
 *
 * WHAT CHANGED FROM THIS SESSION'S DISCUSSION, NOT SILENTLY, USER-DIRECTED EACH STEP:
 * - No role or reputation-level prize, ever — matches the design doc's own §3 ("nothing that
 *   grants a role, a reputation level, or any kind of standing... a lucky Oracle draw buying
 *   real standing would make the Oracle a second, colder reputation system") AND the user's
 *   own explicit "not a direct path to grifter upwards mobility."
 * - No login/visit ritual — "activity bonus... active players receive it naturally," so
 *   PARTICIPATION itself is modeled the same mechanical, no-scheduler way `shiftCover.ts`
 *   already models "noticing": an independent Bernoulli draw per eligible candidate per day,
 *   not a real per-player action this headless kernel has no way to represent honestly.
 * - Entry costs a real resource so it's optional, not automatic — user: "it should cost a
 *   resource... making it optional for some." Wealth, not postcards (postcards stay reserved
 *   for the exit-ticket system, and no real per-player postcard balance exists in this engine
 *   yet to spend from anyway — HANDOVER's own still-open item).
 * - A prize can only ever touch what the winner already has real access to — never a
 *   different role's resource, never a role or level they don't hold. This is what keeps a
 *   solo player from using lucky streaks to assemble a multi-role crafting recipe (a Key, a
 *   Firestarter) alone — user: "can't win every resource or they'll craft weapons... solo
 *   players can't do things on their own." Not a probability argument bolted on after the
 *   fact — structural: `ORACLE_PRIZE_TABLE`'s `resourceStock` prize tops up the SAME personal
 *   stock `personalResourceStock.ts` already caps, for the role the winner already holds and
 *   nothing else.
 * - "Time" is a real, already-tracked quantity, not invented for this: a grifter's own
 *   `daysAsGrifter` (their real standing in the existing "longest wait" conscription
 *   tie-break) or a role-holder's own `daysInRole` (their real standing in the 2026-08-18
 *   eviction preference) — a minor, bounded nudge to a metric that already exists and already
 *   does something, not a new currency.
 *
 * ADAPTABLE ON PURPOSE (user: "leave it so we can consider alterations to prizes etc. can't
 * be static otherwise we can't balance the numbers under testing" / "I have to be able to
 * update the game over time"). Every constant below is named, exported, and
 * `[CALIBRATED — provisional]`; `ORACLE_PRIZE_TABLE` is a plain data table with a `weight`
 * field even though every entry is currently equal-weighted, specifically so rebalancing a
 * prize's likelihood later is an edit to a number, not a restructure of the selection logic.
 */

/** [CALIBRATED — provisional] Reference "healthy shard" `economicHealthWithExperience` value
 *  — matches the real measured healthy-condition figure `docs/DESIGN_ORACLE_2026-08-13.md`
 *  §1 cites (mean 0.96 under real, sustained attack; higher in ordinary play). Odds are at
 *  their healthy maximum at or above this value. */
export const ORACLE_HEALTH_REFERENCE = 0.96;

/** [CALIBRATED — provisional] Health value at or below which odds bottom out at
 *  `ORACLE_ODDS_FLOOR` rather than continuing to shrink — matches the doc's own measured
 *  "genuinely worse" figure (mean 0.77 under real sustained attack) as the floor's
 *  neighborhood, not its exact value; needs its own sweep before being trusted further. */
export const ORACLE_HEALTH_FLOOR = 0.4;

/** [CALIBRATED — provisional] Win probability at or above `ORACLE_HEALTH_REFERENCE` — chosen
 *  near the exit-ticket gamble's own already-population-validated flat rate (~28-30%,
 *  `docs/DESIGN_ORACLE_2026-08-13.md` §2) as a reasonable starting reference, not because the
 *  two mechanics need to match exactly. */
export const ORACLE_BASE_ODDS_HEALTHY = 0.3;

/** [CALIBRATED — provisional] Win probability never drops below this, however sick the shard
 *  — constraint 2's "no permanent zero-state" applied to the draw itself, per the design doc. */
export const ORACLE_ODDS_FLOOR = 0.05;

/**
 * Linear, clamped health -> win-probability mapping, exactly the shape
 * `docs/DESIGN_ORACLE_2026-08-13.md` §2 specifies (its own header explains why linear: nothing
 * measured yet justifies a fancier curve).
 */
export function oracleWinProbability(economicHealthWithExperience: number): number {
  const raw =
    (ORACLE_BASE_ODDS_HEALTHY * (economicHealthWithExperience - ORACLE_HEALTH_FLOOR)) /
    (ORACLE_HEALTH_REFERENCE - ORACLE_HEALTH_FLOOR);
  return Math.min(ORACLE_BASE_ODDS_HEALTHY, Math.max(ORACLE_ODDS_FLOOR, raw));
}

/** [CALIBRATED — provisional] Flat wealth cost to enter one day's draw — real enough that not
 *  everyone bothers every day, per the user's own explicit requirement. */
export const ORACLE_ENTRY_COST = 0.3;

/** [CALIBRATED — provisional] Independent per-candidate daily probability of choosing to
 *  enter at all (before affordability is even checked) — the mechanical stand-in for "some
 *  players show up, some don't," same modeling convention `SHIFT_COVER_NOTICE_PROBABILITY`
 *  already uses for an analogous no-real-session problem. */
export const ORACLE_PARTICIPATION_PROBABILITY = 0.4;

export type OraclePrizeType = 'wealth' | 'resourceStock' | 'time';

export interface OraclePrizeDefinition {
  type: OraclePrizeType;
  /** Relative weight among prize types this candidate is eligible for — NOT a probability by
   *  itself, only meaningful relative to the other eligible entries' weights. */
  weight: number;
  grifterEligible: boolean;
  roleHolderEligible: boolean;
}

/** The full prize table — a plain data list, not a switch statement, specifically so adding,
 *  removing, or reweighting a prize type is an edit here, never a change to the selection
 *  logic in `pickPrizeType` below. All weights currently equal; nothing requires them to stay
 *  that way. */
export const ORACLE_PRIZE_TABLE: readonly OraclePrizeDefinition[] = [
  { type: 'wealth', weight: 1, grifterEligible: true, roleHolderEligible: true },
  { type: 'resourceStock', weight: 1, grifterEligible: false, roleHolderEligible: true },
  { type: 'time', weight: 1, grifterEligible: true, roleHolderEligible: true },
];

/** [CALIBRATED — provisional] Wealth granted on a `wealth`-prize win — small relative to
 *  ordinary daily income (`GRIFTER_DAILY_INCOME`/`SUPPORT_ROLE_DAILY_WAGE`, `engine/wealth.ts`)
 *  on purpose, per the design doc's own "be most careful with wealth" flag: a real prize pool
 *  has to stay small enough relative to ordinary income that it can't quietly reopen the
 *  already-measured "no runaway inequality" finding (`test/wealth.regression.test.ts`). */
export const ORACLE_WEALTH_PRIZE_AMOUNT = 0.3;

/** [CALIBRATED — provisional] Personal resource stock granted on a `resourceStock`-prize win
 *  — still hard-capped at `PERSONAL_RESOURCE_CAP` by the caller, same as ordinary accrual, so
 *  a win can never be used to bypass the cap that makes crafting a real, felt choice. */
export const ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT = 1;

/** [CALIBRATED — provisional] Days granted on a `time`-prize win — added to a grifter's own
 *  `daysAsGrifter` (a real nudge in the existing longest-wait conscription tie-break) or a
 *  role-holder's own `daysInRole` (a real nudge toward the 2026-08-18 eviction preference's
 *  established threshold). Deliberately small relative to `ESTABLISHED_TENURE_DAYS` (30) —
 *  a nudge, not a shortcut past real presence. */
export const ORACLE_TIME_NUDGE_DAYS = 5;

/**
 * Weighted pick among whichever of `ORACLE_PRIZE_TABLE`'s entries `isGrifter` makes eligible.
 * Pure, one `rand()` call, never throws (falls back to the first eligible entry if weights are
 * somehow all zero, rather than returning nothing for a real win that must pay out something).
 */
export function pickPrizeType(isGrifter: boolean, rand: () => number): OraclePrizeType {
  const eligible = ORACLE_PRIZE_TABLE.filter((p) => (isGrifter ? p.grifterEligible : p.roleHolderEligible));
  const totalWeight = eligible.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return eligible[0]!.type;
  let roll = rand() * totalWeight;
  for (const p of eligible) {
    roll -= p.weight;
    if (roll <= 0) return p.type;
  }
  return eligible[eligible.length - 1]!.type;
}
