import { reputationLevelForProgress } from './reputation.js';

/**
 * Shift Cover (2026-08-11 addendum item 7, "offline slots as opportunity, not just backstop"
 * — fulfils the long-open brief §2.6 item, reshaped). Pure, same style as every other
 * `src/engine/` module — a single, minimal dependency on `reputation.ts` was added 2026-08-18
 * (see `orderGrifterCandidatesForNotice`'s own doc comment below), not dependency-free anymore.
 *
 * WHAT "OFFLINE" MEANS HERE, AND WHY. The brief's original §2.6 needed a real player-session/
 * presence concept ("is this specific player currently active") that this headless,
 * day-tick-deterministic kernel has never had and isn't gaining here — see `BLUEPRINT.md`'s
 * Phase 2 table, which flagged exactly this gap. The addendum's own examples — "a Courier
 * running an uncovered route, a player working a vacant bakery in another district" — map
 * cleanly onto a state this engine ALREADY has: `vacancy.ts`'s `BACKSTOPPED`, a slot the
 * mechanical backstop keeps alive at reduced productivity with nobody real credited for it
 * (constraint 2's "no permanent zero-state," extended). "Offline slot" IS "BACKSTOPPED slot"
 * — the reshaping the addendum's own title names. Shift Cover doesn't touch slot STATE at
 * all (a covered slot stays BACKSTOPPED tomorrow — this is a one-day side-payment, not a role
 * transfer; that already exists as the conscription/draft mechanic and is untouched).
 *
 * WHO CAN COVER, AND HOW "NOTICING" IS MODELLED. Only grifters (roleless community players)
 * are eligible — an existing role-holder covering a second role at once is a bigger design
 * question the addendum never raises, so it's out of scope here, not silently allowed. The
 * addendum is explicit: "nothing assigns it, nothing notifies... watching the world is the
 * skill being rewarded. Do not build a scheduler, a queue, or a notification system." With no
 * real per-player attention signal to read in a deterministic sim, "noticing" is modelled as
 * one independent Bernoulli draw per BACKSTOPPED slot per day (`SHIFT_COVER_NOTICE_
 * PROBABILITY`) — no state carried between attempts, the same "no learnable pattern"
 * discipline `importExport.ts`'s interception already uses for an unrelated mechanic.
 *
 * "COVERING MUST ALWAYS BE A WORSE DEAL THAN HOLDING THE ROLE PROPERLY" — MADE STRUCTURAL,
 * NOT MEASURED. The earlier temptation was to pick a flat rate and check it stays below every
 * role's measured minimum wage — rejected, because Courier's wage is now real-geometry-
 * indexed (`courierPay.ts`, item 6) with no proven analytic floor, so a flat number could
 * silently drift above it if geometry or role constants ever move. Instead, `shiftCoverPay`
 * takes the SAME reference wage a genuine FILLED occupant of that exact slot would have
 * earned that exact day (computed once, at the call site, from each role's own real income
 * formula — nothing new invented) and returns `SHIFT_COVER_FRACTION` of it. Since
 * `SHIFT_COVER_FRACTION < 1` unconditionally, Shift Cover pay is strictly less than the real
 * thing for every role, every day, by construction — no separate calibration or cross-role
 * comparison needed, and nothing here can go stale as other constants change.
 *
 * THE COORDINATED-ABUSE CASE, PROVED, NOT SIMULATED. The addendum: "two players deliberately
 * alternating self-created gaps to farm each other's slots... prove it in simulation, with
 * numbers." There is no player-controlled "leave my role on purpose" action in this engine at
 * all (churn is a stochastic hazard, not a choice — see `vacancy.ts`), so the literal
 * collusion pattern isn't a constructible player action to simulate here. What IS provable,
 * exactly rather than approximately, is the economics it would depend on: substituting Shift
 * Cover for genuine occupancy earns `SHIFT_COVER_FRACTION * wage` instead of `wage`, strictly
 * less on EVERY single day, not just in long-run average — a stronger guarantee than a
 * stochastic simulation could give, because it holds for any pattern of alternation
 * whatsoever, not just the one pattern that happened to get simulated. `test/shiftCover.test.ts`
 * makes this concrete with real numbers alongside the structural proof, per the addendum's own
 * "with numbers" instruction.
 */

/**
 * Share of a slot's real FILLED-that-day wage a covering grifter earns. [ILLUSTRATIVE]. Must
 * stay strictly below 1 — this single constraint is the entire "always worse than holding the
 * role properly" guarantee and the entire coordinated-abuse proof; nothing else needs tuning
 * against it.
 */

export const SHIFT_COVER_FRACTION = 0.4;

/**
 * Probability any single BACKSTOPPED slot gets noticed and covered on a given day.
 * [ILLUSTRATIVE] — deliberately modest: Shift Cover is meant to be a real but occasional
 * opportunity for an attentive grifter, not a guaranteed daily top-up for the whole pool.
 */
export const SHIFT_COVER_NOTICE_PROBABILITY = 0.15;

/**
 * What a grifter covering one BACKSTOPPED slot earns for the day — strictly less than
 * `referenceFilledWage` (what that same slot would have earned genuinely FILLED that day)
 * whenever `referenceFilledWage > 0`, by construction. Never negative even if a caller passes
 * a stale/negative reference by mistake.
 */
export function shiftCoverPay(referenceFilledWage: number, fraction: number = SHIFT_COVER_FRACTION): number {
  return Math.max(0, referenceFilledWage) * fraction;
}

/**
 * The level-2 reputation gate ("the level-2 trap," measured 2026-08-13,
 * `docs/BLUEPRINT.md`'s "Investigating the level-2 rarity" entry): 83-90% of grifters who
 * reach reputation level 1 get swept into a role via `genuineFill` within a mean 6.9-16.3
 * days, before ever earning the 3 additional Shift Cover completions level 2 needs. Root
 * cause, measured not guessed: reaching level 1 makes a grifter an immediate voluntary-fill
 * target for FOUR roles at once (Courier/Journalist/Detective/Import-Export), each rolling its
 * own daily hazard against the same shared pool — while THIS function, the only way a grifter
 * earns MORE progress, had never given them any priority for it. A threshold change
 * (`REPUTATION_LEVEL_THRESHOLDS`) was measured and offered 2026-08-13 but explicitly declined
 * in favor of "a different mechanism" — this is that mechanism (2026-08-18).
 *
 * `orderGrifterCandidatesForNotice` is the SAME "prefer X, fall back to the existing rule"
 * shape already used twice this session (grifter conscription's lowest-level-first;
 * `conscriptionFromOtherRole`'s `occupantTenure`/`ESTABLISHED_TENURE_DAYS` eviction
 * preference): grifters at EXACTLY level 1 (progress in `[REPUTATION_LEVEL_THRESHOLDS[0]`,
 * `REPUTATION_LEVEL_THRESHOLDS[1])`) — the ones actually racing `genuineFill`'s clock toward
 * level 2 — are preferred for Shift Cover, sorted closest-to-the-threshold first among
 * themselves (most progress spent for least additional opportunity needed). Once no racing
 * grifter remains among the candidates being considered, the ordering degenerates to the
 * ORIGINAL "neediest (lowest wealth) first" rule, byte-identical to before this function
 * existed — preference, not a replacement of the existing fairness signal, and never
 * permanent: the moment a grifter reaches level 2 (or falls back to level 0, which cannot
 * happen — reputation only grants, per constraint 6) they stop racing and this stops applying
 * to them.
 */
export function orderGrifterCandidatesForNotice(
  grifters: readonly { wealth: number; reputationProgress?: number }[],
): number[] {
  return grifters
    .map((g, i) => ({ i, wealth: g.wealth, progress: g.reputationProgress ?? 0 }))
    .sort((a, b) => {
      const aRacing = reputationLevelForProgress(a.progress) === 1;
      const bRacing = reputationLevelForProgress(b.progress) === 1;
      if (aRacing !== bRacing) return aRacing ? -1 : 1;
      if (aRacing) return b.progress - a.progress || a.i - b.i;
      return a.wealth - b.wealth || a.i - b.i;
    })
    .map((o) => o.i);
}

/**
 * Which of `backstoppedCount` BACKSTOPPED opportunities (indices 0..backstoppedCount-1, in
 * whatever order the caller built its opportunity list) get noticed and covered today. Each
 * slot is an independent Bernoulli draw — no state carried between slots or between days, so
 * there is no learnable pattern to which slots tend to get covered. Capped at `grifterCount`
 * (one grifter can cover at most one slot per day — a real player can only actually work one
 * shift): if more slots are noticed than there are grifters available, only the first
 * `grifterCount` in draw order are actually covered, a deterministic stand-in for "whoever
 * got there first" rather than a second randomised selection on top of the first.
 */
export function shiftCoverNoticedIndices(
  backstoppedCount: number,
  grifterCount: number,
  rand: () => number,
  noticeProbability: number = SHIFT_COVER_NOTICE_PROBABILITY,
): number[] {
  const noticed: number[] = [];
  for (let i = 0; i < backstoppedCount; i++) {
    if (rand() < noticeProbability) noticed.push(i);
  }
  return noticed.slice(0, Math.max(0, grifterCount));
}
