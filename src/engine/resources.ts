/**
 * Named per-role resources (2026-08-11, user-specified: "create arbitrary resources as
 * named variables, make them suitable to the role and associate them with real numbers I
 * can track over time"). Pure, dependency-free, same style as every other `src/engine/`
 * module.
 *
 * WHY THIS EXISTS. Until now only two roles had any physical quantity attached at all —
 * Miller's Cournot `value` (a quantity) and Baker's Bertrand `value` (a price) — and
 * Courier/Journalist/Detective had nothing but a flat undifferentiated wage. That made
 * three of five roles economically indistinguishable and impossible to observe over time.
 * These are real named stocks and flows, tracked per day and cumulatively, so a shard's
 * activity is inspectable rather than implied.
 *
 * WHAT IS AND ISN'T DERIVED. Miller's and Baker's outputs are *derived from mechanics that
 * already exist and are validated* — flour produced is the Miller's own competed-for Cournot
 * quantity, bread produced is the Baker's own served-customer count from `wealth.ts`'s
 * demand model. Nothing about their market behaviour is changed or second-guessed here;
 * this only names and records what those layers were already computing. The three support
 * roles' rates are genuinely new `[ILLUSTRATIVE]` constants, because no mechanic for them
 * exists anywhere in the brief or lore to derive from — flagged, not quietly invented as
 * though they were validated.
 *
 * THE CHAIN, and the gap it makes visible. grain -> flour -> bread is a real dependency:
 * a Miller consumes grain to make flour, a Baker consumes flour to make bread, and the
 * population eats bread. Grain currently has NO producer in this codebase — that is exactly
 * the Import/Export role's unbuilt job ("they receive nodules every day to trade with the
 * Miller"). Rather than paper over it, `grainConsumed` is tracked as a real, accumulating
 * demand figure with no supply behind it: the size of the hole Import/Export has to fill,
 * measurable before it is built.
 */

/** Every named resource currently tracked in a shard. */
export type ResourceName = 'grain' | 'flour' | 'bread' | 'parcels' | 'stories' | 'leads';

export const RESOURCE_NAMES: readonly ResourceName[] = ['grain', 'flour', 'bread', 'parcels', 'stories', 'leads'];

/** Which role is responsible for producing each resource — one owner each, no ambiguity. */
export const RESOURCE_OWNER: Readonly<Record<ResourceName, string>> = {
  grain: 'importExport', // NOT YET BUILT — see this file's header
  flour: 'miller',
  bread: 'baker',
  parcels: 'courier',
  stories: 'journalist',
  leads: 'detective',
};

/** Tonnes of grain consumed per unit of flour milled. [ILLUSTRATIVE] */
export const GRAIN_PER_FLOUR = 1.2;
/**
 * Units of flour consumed per loaf-equivalent baked. [ILLUSTRATIVE — but derived, not
 * guessed]. An initial guess of 0.35 made the shard run a permanent flour DEFICIT at the
 * shipped role ratio: Bakers drew ~1.39 flour/day while 4 Millers milled only ~1.09, so
 * the grain->flour->bread chain was quietly incoherent (invisible until these resources
 * were named and tracked — which is the point of tracking them).
 *
 * Resolved in the direction that respects what is actually validated: `rMiller=4` comes
 * from a real multi-shard sweep against population, health and equality
 * (`sim/multiShardRoleDistrictSweep.ts`), whereas this ratio was a fresh invention with
 * nothing behind it — so the invented constant yields to the derived role split, not the
 * reverse. Measured break-even flour-per-bread by Miller count (1500 days, burn-in 300):
 *   rMiller 3 -> 0.193 | 4 -> 0.274 | 5 -> 0.318 | 6 -> 0.381 | 7 -> 0.426 | 8 -> 0.477
 * Break-even is also seed- and horizon-dependent (0.27 still left a 3-8% deficit across 5
 * seeds at 1500 days), AND it moves whenever the role allocation moves: adding the 2
 * Import/Export slots (S=30 -> 32) diluted staffing enough that average milled flour fell
 * and 0.25 went ~13% short in turn. Shipped value is now **0.22**, holding a small
 * structural SURPLUS — the correct side to err on, since no stockpile is simulated and a chronic
 * deficit would be an unbacked claim that Bakers can bake flour that was never milled.
 *
 * RESOLVED 2026-08-11: this constant and the role allocation are now derived TOGETHER by
 * sim/multiShardRoleDistrictSweep.ts, which reports each candidate's own break-even value
 * so the constant follows the chosen allocation instead of being chased after it. Doing so
 * immediately caught that the then-shipped split ran a flourRatio of 1.222 — Bakers baking
 * flour nobody milled — which no population-only metric could have surfaced. The shipped
 * value 0.23 sits just under the chosen allocation's break-even of 0.239, holding a small
 * surplus. Re-run that sweep, not this constant alone, whenever role counts change.
 */
export const FLOUR_PER_BREAD = 0.20;
/** Parcels one Courier moves in a full active day. [ILLUSTRATIVE] */
export const PARCELS_PER_COURIER_DAY = 14;
/** Stories one Journalist files in a full active day. [ILLUSTRATIVE] */
export const STORIES_PER_JOURNALIST_DAY = 1.5;
/** Investigative leads one Detective develops in a full active day. [ILLUSTRATIVE] */
export const LEADS_PER_DETECTIVE_DAY = 2.5;

/** One day's resource flows for a whole shard. All values are per-day, not cumulative. */
export interface ResourceFlows {
  /** Grain delivered by Import/Export — the supply side, real since 2026-08-11. */
  grainDelivered: number;
  grainConsumed: number;
  flourProduced: number;
  flourConsumed: number;
  breadProduced: number;
  parcelsDelivered: number;
  storiesFiled: number;
  leadsDeveloped: number;
}

/** Running cumulative totals since shard creation, plus the most recent day's flows. */
export interface ResourceLedger {
  cumulative: ResourceFlows;
  today: ResourceFlows;
}

export function emptyFlows(): ResourceFlows {
  return {
    grainDelivered: 0,
    grainConsumed: 0,
    flourProduced: 0,
    flourConsumed: 0,
    breadProduced: 0,
    parcelsDelivered: 0,
    storiesFiled: 0,
    leadsDeveloped: 0,
  };
}

export function emptyLedger(): ResourceLedger {
  return { cumulative: emptyFlows(), today: emptyFlows() };
}

/**
 * One day's resource flows.
 *
 * `millerQuantities` are the FILLED Millers' own competed-for Cournot quantities and
 * `bakerServedCustomers` the FILLED Bakers' own served-customer counts — both passed in
 * from the layers that already compute them, never recomputed here. `activityMultiplier`
 * is `wealth.ts`'s `DAILY_ACTIVITY_MULTIPLIER` (the daily downtime blend); support-role
 * `frictionMultipliers` are per-holder trade-route friction from district consolidation, so
 * a Courier working out of a declining district really does move fewer parcels — the same
 * consequence their income already takes.
 */
export function stepResourceFlows(
  millerQuantities: readonly number[],
  bakerServedCustomers: readonly number[],
  courierFrictions: readonly number[],
  journalistFrictions: readonly number[],
  detectiveFrictions: readonly number[],
  activityMultiplier: number,
  grainDelivered = 0,
): ResourceFlows {
  const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

  const flourProduced = sum(millerQuantities) * activityMultiplier;
  const breadProduced = sum(bakerServedCustomers) * activityMultiplier;

  return {
    grainDelivered,
    flourProduced,
    grainConsumed: flourProduced * GRAIN_PER_FLOUR,
    breadProduced,
    flourConsumed: breadProduced * FLOUR_PER_BREAD,
    parcelsDelivered: sum(courierFrictions) * PARCELS_PER_COURIER_DAY * activityMultiplier,
    storiesFiled: sum(journalistFrictions) * STORIES_PER_JOURNALIST_DAY * activityMultiplier,
    leadsDeveloped: sum(detectiveFrictions) * LEADS_PER_DETECTIVE_DAY * activityMultiplier,
  };
}

export function accumulate(ledger: ResourceLedger, today: ResourceFlows): ResourceLedger {
  const c = ledger.cumulative;
  return {
    today,
    cumulative: {
      grainDelivered: c.grainDelivered + today.grainDelivered,
      grainConsumed: c.grainConsumed + today.grainConsumed,
      flourProduced: c.flourProduced + today.flourProduced,
      flourConsumed: c.flourConsumed + today.flourConsumed,
      breadProduced: c.breadProduced + today.breadProduced,
      parcelsDelivered: c.parcelsDelivered + today.parcelsDelivered,
      storiesFiled: c.storiesFiled + today.storiesFiled,
      leadsDeveloped: c.leadsDeveloped + today.leadsDeveloped,
    },
  };
}

/**
 * Net flour balance: what Millers produced minus what Bakers consumed. Positive means the
 * shard milled more than it baked; negative means Bakers drew down more flour than was
 * milled that day. Reported rather than enforced — no stockpile is simulated yet, so this
 * is a diagnostic of whether the Miller/Baker ratio is actually coherent, not a constraint
 * that can starve anyone (which would need a real stock, and a real answer to constraint 2
 * first).
 */
export function flourBalance(flows: ResourceFlows): number {
  return flows.flourProduced - flows.flourConsumed;
}

/** Grain delivered by Import/Export minus grain Millers drew. Positive = supply covers milling. */
export function grainBalance(flows: ResourceFlows): number {
  return flows.grainDelivered - flows.grainConsumed;
}
