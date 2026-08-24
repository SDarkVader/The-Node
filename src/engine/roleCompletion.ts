/**
 * Role completion (2026-08-11, Design Addendum item 4) — a uniform completion/reward layer
 * across every role, closing the gap the handover flagged: Courier, Journalist and
 * Detective shared one flat `SUPPORT_ROLE_DAILY_WAGE` with nothing distinguishing holding
 * the role well from merely occupying it. (Journalist and Detective merged into Investigator
 * 2026-08-22 — see `world.ts`'s header — so this is now five roles, not six; the reasoning
 * below is otherwise unchanged.)
 *
 * STRUCTURE is uniform across every role — one attempt per FILLED day, one career ratio
 * (`completions / attempts`, per the addendum's explicit "career ratio, not per-attempt"
 * instruction), one reward constant. CONTENT differs per role, and only where a real,
 * already-modeled mechanic gives it something genuine to differ on:
 *   - Miller (Cournot quantity competition) and Baker (Bertrand price competition) each
 *     have a real, already-computed rival comparison — out-producing or out-pricing the
 *     field is a genuine role-specific condition, not invented for this.
 *   - Courier/Investigator/Import-Export have NO differentiated market mechanic anywhere in
 *     this project (see `world.ts`'s own header) — their only real per-tick,
 *     role-differentiated signal is trade-route friction against their own district
 *     (`districtConsolidation.ts`), the same primitive `economicHeat.ts` already reuses for
 *     a different purpose. So their task is uniformly "beat your district's friction today,"
 *     differentiated only by which named resource keeps accruing alongside it
 *     (parcels/stories/leads/grain) — exactly the addendum's "different only in content."
 *     (Investigator ALSO has the real `investigatedBy` sabotage-detection mechanic inherited
 *     from the former Detective — see `world.ts` — but that isn't wired into completion here.)
 *
 * FLAGGED HONESTLY, not silently narrowed: the addendum's own illustrative example for
 * Detective — "investigating a sabotage pattern that is genuinely running" — describes the
 * UNSHIPPED pattern-based sabotage proposal (`sim/sabotagePattern.proposal.ts`), not the
 * shipped `world.ts` sabotage mechanic, which has no Investigator-specific COMPLETION term at
 * all (`ecosystem.ts`'s `detectionProbability` depends only on witness count; the real
 * `investigatedBy` bonus lives entirely in the sabotage stage, not here). Building a literal
 * "catch a saboteur" task now would mean either shipping that unshipped proposal (a different,
 * undecided change) or inventing a synthetic Investigator-only event the shipped model can't
 * actually verify — both out of scope here. The friction-based task is the honest choice
 * against what is actually built today; revisit if/when the sabotage proposal ships.
 *
 * Reward: the same resource every role already earns — wealth (item 4's own words: "wealth
 * stays a scoreboard") — not a second currency, not a role-specific one (which item 5 makes
 * explicit: named resources are non-fungible and role-locked).
 *
 * A single flat per-completion bonus was the first thing tried here, on the reasoning that
 * "one attempt per FILLED day, one constant" gives structural parity for free. Measured
 * against the shipped config (`scratchpad` sweep, 1000 days x 5 seeds) before trusting that
 * reasoning, per constraint 1 — and it does NOT hold: Miller/Baker complete a genuinely
 * competitive, zero-sum task (beat the field average) at ~54-58%, while the four
 * friction-bar roles complete theirs at ~97-100%, because a healthy shard's districts sit
 * at friction=1 almost all the time — there is no scarcity forcing their completion rate
 * toward 50% the way Cournot/Bertrand competition does for Miller/Baker. A flat reward would
 * have paid support roles nearly double the expected daily bonus for a genuinely easier
 * task — exactly the silent disparity `flourRatio`'s history is the standing warning about,
 * and exactly why the addendum demands a hard filter test rather than trusting the
 * "structural" argument on paper.
 *
 * `COMPLETION_REWARD` is therefore calibrated PER ROLE TYPE, not flat, so that equal effort
 * and time (one attempt per FILLED day, same as every role) converges on comparable
 * EXPECTED daily reward — the addendum's actual requirement — rather than comparable
 * reward-per-completion, which turns out not to be the same thing once tasks differ
 * genuinely in difficulty. `test/roleCompletion.test.ts`'s hard filter test verifies this
 * empirically against a real `stepWorld` run, the same discipline `flourRatio <= 1.0` uses.
 */

/** Career completion record — attempts and completions accumulate for as long as the same
 *  occupant holds the slot, and reset to empty the moment a slot is freshly (re)FILLED (see
 *  `world.ts`'s existing `justFilledSet`/wealth-reset convention, mirrored here identically
 *  for all six roles rather than left asymmetric). */
export interface CompletionStats {
  attempts: number;
  completions: number;
}

export function emptyCompletionStats(): CompletionStats {
  return { attempts: 0, completions: 0 };
}

/** Pure — returns a new record, the same immutable-update convention every engine module here follows. */
export function recordAttempt(stats: CompletionStats, completed: boolean): CompletionStats {
  return { attempts: stats.attempts + 1, completions: stats.completions + (completed ? 1 : 0) };
}

/** The career ratio itself — 0 with no attempts yet, never NaN. */
export function completionRatio(stats: CompletionStats): number {
  return stats.attempts === 0 ? 0 : stats.completions / stats.attempts;
}

export type CompletionRoleType = 'miller' | 'baker' | 'courier' | 'investigator' | 'importExport';

/**
 * Wealth granted for one completed task, calibrated PER ROLE TYPE against measured
 * completion rates at the shipped config (see header) so expected daily reward converges
 * across every role rather than reward-per-completion. [ILLUSTRATIVE — the two-value
 * split (competitive vs. friction-bar tasks), not the exact decimals, is the load-bearing
 * part; re-measure and re-derive if either task's completion condition or the shipped role
 * counts change materially.]
 *
 * Miller/Baker (~54-58% measured): 0.5 per completion -> ~0.27-0.29 expected/day.
 * The three friction-bar roles (~97-100% measured): 0.28 per completion -> ~0.27-0.28
 * expected/day. Both land in the same ~0.27-0.29 band — see `test/roleCompletion.test.ts`'s
 * hard filter test for the empirical check this rests on, not just the arithmetic above.
 */
export const COMPLETION_REWARD: Readonly<Record<CompletionRoleType, number>> = {
  miller: 0.5,
  baker: 0.5,
  courier: 0.28,
  investigator: 0.28,
  importExport: 0.28,
};

/** Friction multiplier a support-role station must reach or exceed to count today's output
 *  as "completed" — see this file's header for why friction is the real, existing signal
 *  these four roles share. [ILLUSTRATIVE] */
export const SUPPORT_TASK_FRICTION_BAR = 0.9;

/**
 * Real, measured typical career `completionRatio` per role (2026-08-18) — the same numbers
 * this file's own header already documents in prose (Miller/Baker's zero-sum competitive task
 * completes ~54-58% of the time; the four friction-bar roles complete ~97-100%), named here so
 * a caller can compare one occupant's REAL performance against what's normal FOR THEIR OWN
 * ROLE, not a single global bar that would be meaningless across two structurally different
 * task difficulties (the exact reasoning `COMPLETION_REWARD` above is calibrated per-type for,
 * reused here for the same underlying reason).
 *
 * Built for `multiRoleConscription.ts`'s eviction-preference: an occupant only counts as
 * genuinely "established" (protected from `conscriptionFromOtherRole`) if they're both
 * tenured AND actually performing at or near their own role's typical rate — a long-tenured
 * but chronically underperforming occupant should not get the same protection as a
 * long-tenured, genuinely productive one. See `world.ts`'s own wiring for how
 * `completionRatio(...) / TYPICAL_COMPLETION_RATIO[role]` becomes a single, role-agnostic
 * normalized score (1.0 = exactly typical) that the eviction-preference logic can compare
 * against one shared bar regardless of which role an occupant holds.
 */
export const TYPICAL_COMPLETION_RATIO: Readonly<Record<CompletionRoleType, number>> = {
  miller: 0.55,
  baker: 0.55,
  courier: 0.97,
  investigator: 0.97,
  importExport: 0.97,
};

/**
 * Average of every OTHER entry in `values` (excludes `values[index]` itself) — the same
 * "average rival" comparison `millers.ts`/`bakers.ts` already compute internally for their
 * own competitive dynamics, exposed here so a completion task can reuse it rather than
 * re-deriving competition logic. With fewer than 2 entries there is no rival to compare
 * against; returns the entry's own value so the completion condition below is vacuously
 * false (never silently "always completes") rather than throwing over a config this module
 * doesn't own the validity of.
 */
export function averageRivalValue(values: readonly number[], index: number): number {
  if (values.length < 2) return values[index] ?? 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum - values[index]!) / (values.length - 1);
}

/** Miller task: out-produce the field's average today — a real Cournot-competition outcome. */
export function millerTaskCompleted(ownQuantity: number, avgRivalQuantity: number): boolean {
  return ownQuantity > avgRivalQuantity;
}

/** Baker task: price at or below the field's average today — competitive Bertrand pricing
 *  that would actually win share, not an arbitrary threshold. */
export function bakerTaskCompleted(ownPrice: number, avgRivalPrice: number): boolean {
  return ownPrice <= avgRivalPrice;
}

/** Support-role task (Courier/Investigator/Import-Export): beat today's own
 *  trade-route friction bar — see this file's header for why this, not a per-role synthetic. */
export function supportTaskCompleted(frictionMultiplier: number, bar: number = SUPPORT_TASK_FRICTION_BAR): boolean {
  return frictionMultiplier >= bar;
}
