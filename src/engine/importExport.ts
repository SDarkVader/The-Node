/**
 * Import/Export — nodules, grain supply, and cross-shard movement (2026-08-11,
 * user-specified). Pure, dependency-free, same style as every other `src/engine/` module.
 *
 * The role does two jobs the rest of the economy already has holes shaped for:
 *
 * 1. SUPPLY. "They receive nodules every day to trade with the Miller." Nodules arrive
 *    daily and automatically (not a player action — "must be set daily and automated to
 *    the miller if offline etc"), and convert to grain, which Millers consume to mill
 *    flour. `resources.ts` has been tracking `grainConsumed` as real accumulating demand
 *    with no supply behind it precisely so this could be sized from a measured number
 *    rather than a guess: ~1.28 grain/day/shard at the shipped defaults.
 *
 * 2. MOVEMENT. "They also control human movement across shards with legal and illegal
 *    routes." This replaces `multiShardHarness.ts`'s flat `MIGRATION_FAILURE_RATE=0.15`
 *    placeholder with a real mechanism — a migrant's success now depends on which route
 *    they can afford, not on a constant.
 *
 * ROUTES, mapped onto the EXISTING postcard/tier exit-ticket system
 * (`docs/DESIGN_ADDENDUM_2026-08-07.md`) rather than inventing a second currency:
 *   - A COMPLETE exit ticket ("gambled or not") is the legal route: passage without
 *     friction, never intercepted. How the ticket was completed is irrelevant — a gambled
 *     ticket is exactly as valid as a ground-out one, per the user's explicit framing.
 *   - "Half a postcard full" — any real partial progress short of a complete ticket —
 *     opens the ILLEGAL route: passage is possible but subject to interception.
 *   - Nothing at all means no crossing attempt is available.
 *
 * DETECTION, and why it is not an agent. Interception runs continuously ("ncp for detection
 * running 24/7") with "behaviour randomised so you can't figure out any pattern." Modelled
 * as a per-attempt probability jittered around a base rate — drawn fresh each attempt from
 * the shard's own RNG, with NO state carried between attempts. That is a stronger guarantee
 * than a patrol schedule that merely looks random: there is literally no pattern to learn
 * because there is nothing persistent generating one, and nothing with behaviour, memory or
 * intent for a player to model or deceive (constraint 3 — the same reasoning that keeps the
 * vacancy backstop and the Oracle mechanical).
 *
 * CONSTRAINT 2 (no permanent zero-state) is load-bearing here in a way it was not for the
 * other roles: grain is now an INPUT to milling, so an unstaffed Import/Export could
 * otherwise starve the flour supply, and through it the whole shard, with no way back.
 * `BACKSTOPPED_NODULE_FRACTION` keeps a mechanically-covered slot delivering a reduced but
 * real supply — the shard is squeezed, never killed, exactly as `BACKSTOP_PRODUCTIVITY`
 * already does for Millers.
 */

/**
 * Nodules one FILLED Import/Export receives per day, automatically. [ILLUSTRATIVE — sized
 * from measured demand, and corrected once]. A first value of 4.0 was set against a grain
 * demand figure measured BEFORE this supply gate existed (~1.28/day/shard) — which turned
 * out to be circular, because `resources.ts`'s `grainConsumed` is derived from flour
 * actually milled, so once milling became grain-limited the "demand" it reported was
 * itself already suppressed. Measuring the UNCONSTRAINED demand instead (intended Cournot
 * supply x activity x GRAIN_PER_FLOUR) gives ~1.68 grain/day/shard at the shipped role
 * counts, against which 4.0 delivered only ~1.14 — throttling Millers to ~68% capacity
 * permanently. 6.0 covers it with real headroom at typical staffing (2 slots at ~88%
 * filled deliver ~1.85/day), so grain binds only when Import/Export is genuinely
 * understaffed, which is the intended pressure rather than a constant tax.
 */
export const NODULES_PER_DAY = 6.0;
/** Grain yielded per nodule traded on. [ILLUSTRATIVE] */
export const GRAIN_PER_NODULE = 0.25;
/**
 * Share of the normal nodule intake a BACKSTOPPED (mechanically covered, no player)
 * Import/Export still delivers. Deliberately generous enough that a vacant Import/Export
 * squeezes the grain supply without ever being able to zero it — see constraint 2 above.
 * Mirrors `ecosystem.ts`'s `BACKSTOP_PRODUCTIVITY` in intent. [ILLUSTRATIVE]
 */
export const BACKSTOPPED_NODULE_FRACTION = 0.4;

/** Base per-attempt interception probability on the illegal route. [ILLUSTRATIVE] */
export const INTERCEPT_BASE_P = 0.35;
/**
 * Half-width of the random band the per-attempt interception probability is drawn from.
 * This is the "randomised so you can't figure out any pattern" requirement: the rate a
 * player faces on any given crossing is never the same number twice and never trends.
 * [ILLUSTRATIVE]
 */
export const INTERCEPT_JITTER = 0.15;
/**
 * Share of would-be migrants holding a COMPLETE exit ticket, and so travelling legally.
 * [ILLUSTRATIVE] — chosen so the emergent failure rate reproduces the previously
 * hand-set `MIGRATION_FAILURE_RATE=0.15` that all existing multi-shard calibration was
 * validated against: (1 - 0.57) x 0.35 ~= 0.15. The mechanism replaces the constant
 * without silently moving the equilibrium underneath everything already measured.
 * A real exit-ticket implementation should compute this from actual per-player postcard
 * holdings; until that exists this is the honest aggregate stand-in.
 */
export const COMPLETE_TICKET_FRACTION = 0.57;

export type RouteKind = 'legal' | 'illegal' | 'none';

/** How much exit-ticket progress a would-be migrant holds. */
export interface TicketProgress {
  /** True when a full exit ticket is held — however it was completed, gamble or grind. */
  complete: boolean;
  /** Any real partial progress short of completion ("half a postcard full"). */
  partial: boolean;
}

/** Which route a given holding actually opens. */
export function routeFor(progress: TicketProgress): RouteKind {
  if (progress.complete) return 'legal';
  if (progress.partial) return 'illegal';
  return 'none';
}

/**
 * Per-attempt interception probability on the illegal route — drawn fresh, stateless, so
 * no pattern exists to learn across attempts. Clipped to stay a valid probability.
 */
export function interceptProbability(
  rand: () => number,
  base: number = INTERCEPT_BASE_P,
  jitter: number = INTERCEPT_JITTER,
): number {
  const p = base + (rand() - 0.5) * 2 * jitter;
  return Math.min(1, Math.max(0, p));
}

/**
 * Resolves one crossing attempt. A legal route always succeeds ("full complete tickets
 * move without friction"); an illegal route is rolled against a freshly-drawn interception
 * probability; no ticket at all cannot cross.
 */
export function attemptCrossing(progress: TicketProgress, rand: () => number, base?: number, jitter?: number): boolean {
  const route = routeFor(progress);
  if (route === 'legal') return true;
  if (route === 'none') return false;
  const p = interceptProbability(rand, base, jitter);
  return rand() >= p;
}

/**
 * Draws a would-be migrant's ticket holding. Aggregate stand-in until real per-player
 * postcard accrual exists — see `COMPLETE_TICKET_FRACTION`. Anyone without a complete
 * ticket is assumed to hold at least partial progress, since postcards accrue passively
 * just by being present (the exit-ticket addendum's own rule), so "none" is not reachable
 * for an established player and no one is ever trapped with no route at all (constraint 2).
 */
export function drawTicketProgress(rand: () => number, completeFraction: number = COMPLETE_TICKET_FRACTION): TicketProgress {
  const complete = rand() < completeFraction;
  return { complete, partial: !complete };
}

/**
 * Nodules delivered by the Import/Export layer today — THE root of the whole economy
 * (2026-08-12 addendum item 5: "nodules as the foundational input... nothing else enters
 * the world from outside"). FILLED slots deliver in full; BACKSTOPPED slots deliver
 * `BACKSTOPPED_NODULE_FRACTION` of normal (squeezed, never zero — constraint 2); VACANT
 * slots deliver nothing. `activityMultiplier` is `wealth.ts`'s daily downtime blend, applied
 * for the same reason every other flow takes it.
 */
export function nodulesReceivedToday(
  filledCount: number,
  backstoppedCount: number,
  activityMultiplier: number,
  nodulesPerDay: number = NODULES_PER_DAY,
): number {
  const effectiveSlots = filledCount + backstoppedCount * BACKSTOPPED_NODULE_FRACTION;
  return effectiveSlots * nodulesPerDay * activityMultiplier;
}

/**
 * Grain delivered by the Import/Export layer today — DERIVED from `nodulesReceivedToday`,
 * not computed independently, so "nodules arrive -> Import/Export converts" (item 5) is real
 * code structure, not just prose repeated over an unrelated calculation. Nothing else in
 * this codebase produces grain from nothing; this is its only source.
 */
export function grainDeliveredToday(
  filledCount: number,
  backstoppedCount: number,
  activityMultiplier: number,
  nodulesPerDay: number = NODULES_PER_DAY,
  grainPerNodule: number = GRAIN_PER_NODULE,
): number {
  return nodulesReceivedToday(filledCount, backstoppedCount, activityMultiplier, nodulesPerDay) * grainPerNodule;
}

/**
 * How much a Miller layer can actually mill, given the grain available to it. Returns a
 * multiplier in [0, 1] applied to intended output: 1 when grain covers demand, falling
 * proportionally when it does not. Grain is the binding constraint Millers have never had
 * — this is the mechanism that forces a real Miller/Import-Export dependency rather than
 * a nominal one.
 *
 * Never returns 0 while ANY grain is present, and callers pair it with the BACKSTOPPED
 * supply floor above, so a shard cannot be milled into a permanent dead stop.
 */
export function millingCapacityFactor(grainAvailable: number, grainDemanded: number): number {
  if (grainDemanded <= 0) return 1;
  if (grainAvailable >= grainDemanded) return 1;
  return Math.max(0, grainAvailable / grainDemanded);
}
