import { fillHazard, stepSlot, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';

/**
 * N-role conscription (2026-08-11, user-specified 5-role roster: Miller, Baker, Courier,
 * Journalist, Detective, plus a roleless "grifter"/community-player pool). Generalizes
 * `conscriptionHarness.ts`'s existing `stepConscriptionDay` — which is deliberately left
 * UNMODIFIED here, still validated by `test/conscription.regression.test.ts`, still the
 * function actually driving the 2-role (Miller vs. lumped "Other") model wherever that
 * model is still in use — from exactly 2 role groups to N, with the draft pool generalized
 * from "gossip layer + one lumped Other role" to "the grifter pool + every other role's
 * currently-FILLED members individually."
 *
 * Per the user's own framing ("drafted or selected into any open role"), a churned
 * role-holder doesn't leave the population — they fall back into the grifter pool, a
 * roleless community player, until drafted or self-selected into any open role again.
 * That single reframing is what makes the generalization work: `stepSlot`'s FILLED/VACANT/
 * BACKSTOPPED primitive is reused completely unmodified (imported directly from
 * `engine/vacancy.ts`, not reimplemented); the only new logic is the drafting/pool
 * bookkeeping layered on top, exactly matching this codebase's existing separation (pure
 * single-slot primitive vs. cross-role harness logic) established by `stepConscriptionDay`
 * itself.
 *
 * This module tracks the grifter pool as a plain COUNT, not individual identities — same
 * abstraction level as the existing model's `gossipSize`. Per-grifter identity (the
 * `daysAsGrifter` counter the user asked for, to measure "the effect of grifters being
 * under the minimum income floor until they obtain a role") is a `src/world/world.ts`
 * concern layered on top of this count via `grifterPoolDelta`, not built into this pure
 * sim primitive — deliberate, mirrors how `RoleEconomicSlot.wealth` already layers
 * identity-bearing state on top of `vacancy.ts`'s identity-free `RoleSlot`.
 *
 * REPUTATION GATE (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.5).
 * `RoleGroupState.minReputationLevelForFill` and the optional `grifterLevelCounts` param
 * below extend — not replace — the count-only abstraction: instead of one raw pool number,
 * a caller MAY also pass the same pool's breakdown by reputation level, and a role group MAY
 * declare a minimum level a voluntary (`genuineFill`) fill requires. Both are optional and
 * default to today's ungated behavior — every caller written before this date passes neither
 * and sees byte-identical results, verified by the pre-existing test suite passing unchanged.
 * `conscriptionFromGrifters`/`conscriptionFromOtherRole`/`backstopFires` never consult the
 * level breakdown at all — backstop/conscription always overrides, per constraint 2/§3.5;
 * only the `genuineFill` hazard roll is gated. Still identity-free: this function tracks
 * COUNTS per level, the same way it already tracked one count for the whole pool — WHICH
 * real grifter fills the role is still `world.ts`'s job, done after this returns, using the
 * same longest-wait selection convention it already used, now filtered to grifters whose
 * real reputation level meets the filled role's requirement.
 */

export interface RoleGroupState {
  roleId: string;
  slots: RoleSlot[];
  params: VacancyParams;
  /** Minimum reputation level a grifter needs for a VOLUNTARY (`genuineFill`) fill of this
   *  role. Omitted or 0 (every pre-2026-08-13 caller's implicit behavior) means ungated —
   *  identical to this field not existing. Only takes effect when `grifterLevelCounts` is
   *  also passed to `stepMultiRoleConscriptionDay`; never affects
   *  `conscriptionFromGrifters`/`conscriptionFromOtherRole`/`backstopFires`. */
  minReputationLevelForFill?: number;
  /** Per-slot count of consecutive days the current occupant has held this exact slot —
   *  parallel array to `slots`, meaningful only where the slot is FILLED. Optional; omitted
   *  (every pre-2026-08-18 caller) reproduces the exact old `conscriptionFromOtherRole`
   *  eviction pick — pure uniform random across every other-role FILLED candidate.
   *
   *  2026-08-18 (resolves the V_i/constraint-6 open question, docs/DEVLOG.md's matching
   *  entry): the external v8 material proposed a `V_i` "reputation velocity" shield that
   *  makes conscription-immunity conditional on reputation being able to FALL, which
   *  constraint 6 (grant-only, never remove) forbids outright — and even a grant-only,
   *  PERMANENT version of that shield is independently dangerous to constraint 2 (no
   *  permanent zero-state), since a monotonically-growing unconscriptable population can
   *  eventually starve the shard's own conscription draft pool. This field is the buildable
   *  alternative offered instead: PREFERENCE, not immunity, via `ESTABLISHED_TENURE_DAYS`
   *  below — nobody is ever permanently un-pickable, and once every other-role candidate has
   *  cleared the bar, selection falls back to plain uniform random (no permanent ranking
   *  even among established players, same "no permanent zero-state"-adjacent discipline). */
  occupantTenure?: readonly number[];
}

/** [CALIBRATED — provisional, 2026-08-18] How many consecutive days a role-holder must have
 *  held their current slot before counting as "established" for `conscriptionFromOtherRole`
 *  eviction-preference purposes. Below this, an other-role FILLED candidate is preferred for
 *  eviction over anyone at or above it (protects whoever just started from being drafted out
 *  of a role they barely began, ahead of a genuine veteran elsewhere); once nobody remains
 *  below the bar, the pick reverts to uniform random among all candidates — deliberately not
 *  a permanent full ranking of veterans against each other. Exported specifically so a dev
 *  can retune it in one place without touching the selection logic if the feel needs
 *  adjusting — no simulation run has calibrated this number yet, unlike EXPERIENCE_FLOOR_*
 *  in engine/experienceFloor.ts, which was. */
export const ESTABLISHED_TENURE_DAYS = 30;

export type MultiRoleEvent =
  | { type: 'churn'; roleId: string }
  | { type: 'genuineFill'; roleId: string }
  | { type: 'backstopFires'; roleId: string }
  | { type: 'conscriptionFromGrifters'; roleId: string }
  | { type: 'conscriptionFromOtherRole'; roleId: string; fromRoleId: string };

export interface MultiRoleConscriptionResult {
  /** Same role groups, same order, same `roleId`/`params` — only `slots` changes. */
  roleGroups: RoleGroupState[];
  /**
   * Net change to the grifter pool count from today's events (churn adds a departing
   * role-holder; a genuine fill or grifter conscription removes one; a conscription that
   * evicts another role's FILLED member does not touch the pool — that player moves
   * directly from one role to the other, never passing through "grifter").
   */
  grifterPoolDelta: number;
  events: MultiRoleEvent[];
}

/**
 * One day's update across every role group plus the shared grifter pool. Role groups are
 * processed in array order; an eviction triggered while processing group `i` (a
 * conscription-from-other-role event) is visible to group `i+1`'s own draft weighting the
 * same day — deliberate same-day cascading, matching `stepConscriptionDay`'s existing
 * `workingOtherSlots` mutation pattern exactly, not a new behavior invented for this
 * generalization.
 */
/**
 * Decrements the lowest available level bucket at or above `minLevel`, mutating
 * `counts` in place. Returns the level consumed, or undefined if none was available.
 * Shared by both the reputation-gated `genuineFill` path (minLevel = the role's real
 * requirement) and `conscriptionFromGrifters` (minLevel = 0, i.e. any level at all) — the
 * SAME running state has to be kept in sync by BOTH paths, not just the gated one, or the
 * gate's internal bookkeeping silently drifts out of sync with the real pool within a single
 * day's processing (real bug found and fixed 2026-08-13: `conscriptionFromGrifters` was
 * decrementing the aggregate `grifterPoolDelta` but never this per-level breakdown, so a
 * LATER role group's `genuineFill` gate could evaluate against a stale snapshot that hadn't
 * accounted for a grifter an EARLIER role group already consumed the same day — caught by
 * `test/world.regression.test.ts`'s population-conservation test, which found a real
 * 15-vs-14 mismatch before this fix, not a hypothetical).
 */
function consumeFromLowestLevel(counts: Record<number, number>, minLevel: number): number | undefined {
  const eligibleLevels = Object.keys(counts)
    .map(Number)
    .filter((lvl) => lvl >= minLevel && counts[lvl]! > 0)
    .sort((a, b) => a - b);
  const chosen = eligibleLevels[0];
  if (chosen !== undefined) counts[chosen] = counts[chosen]! - 1;
  return chosen;
}

export function stepMultiRoleConscriptionDay(
  roleGroups: readonly RoleGroupState[],
  grifterPoolSize: number,
  day: number,
  conscriptionDelay: number,
  rng: () => number,
  /** Optional per-level breakdown of the SAME pool `grifterPoolSize` already describes in
   *  aggregate — e.g. `{0: 12, 1: 3, 2: 1}`. Omit entirely (every pre-2026-08-13 caller's
   *  behavior) to skip reputation gating altogether, regardless of any role group's
   *  `minReputationLevelForFill`. When provided, tracked as a running count WITHIN this
   *  call (across every role group processed this same day, same pattern `grifterPoolDelta`
   *  already uses for the aggregate pool) so two gated role groups processed the same day
   *  can never double-book the same real grifter. */
  grifterLevelCounts?: Readonly<Record<number, number>>,
): MultiRoleConscriptionResult {
  const events: MultiRoleEvent[] = [];
  let grifterPoolDelta = 0;
  const runningLevelCounts: Record<number, number> | undefined = grifterLevelCounts
    ? { ...grifterLevelCounts }
    : undefined;
  const working: RoleSlot[][] = roleGroups.map((g) => [...g.slots]);

  for (let gi = 0; gi < roleGroups.length; gi++) {
    const group = roleGroups[gi]!;
    const params = group.params;
    working[gi] = working[gi]!.map((slot) => {
      if (slot.state === 'FILLED') {
        if (rng() < params.pDaily) {
          events.push({ type: 'churn', roleId: group.roleId });
          grifterPoolDelta += 1;
          // A freshly-churned grifter starts at reputation level 0 (world.ts's real
          // GrifterSlot construction never seeds reputationProgress) — reflected here too,
          // for full within-day consistency, even though it can never affect a gated fill's
          // availability (every real role's minLevel is >= 1).
          if (runningLevelCounts) runningLevelCounts[0] = (runningLevelCounts[0] ?? 0) + 1;
          return { state: 'VACANT' as const, vacantSince: day };
        }
        return slot;
      }

      const tau = day - (slot.vacantSince ?? day);

      if (slot.state === 'VACANT') {
        if (tau >= params.tHard) {
          events.push({ type: 'backstopFires', roleId: group.roleId });
          return { state: 'BACKSTOPPED' as const, vacantSince: slot.vacantSince };
        }
        // fillHazard's willingness math is a pure function of (tau, N, R) — it has no
        // concept of a real, finite, shared candidate pool running low, because the
        // original 2-role model never shared one candidate pool across 5 simultaneous
        // roles. Generalizing to N roles drawing from ONE real grifter pool means a
        // voluntary fill must not be allowed to succeed when nobody is actually left to
        // fill it — gated here the same way the BACKSTOPPED branch below already gates
        // conscription on real availability, using the running same-day pool total.
        const minLevel = group.minReputationLevelForFill ?? 0;
        // Peek without mutating: only actually consume once the hazard roll below also
        // succeeds (an available-but-untaken candidate this tick isn't spent).
        const wouldBeAvailable =
          runningLevelCounts && minLevel > 0
            ? Object.keys(runningLevelCounts).some((k) => Number(k) >= minLevel && runningLevelCounts![Number(k)]! > 0)
            : grifterPoolSize + grifterPoolDelta > 0;
        if (wouldBeAvailable && rng() < fillHazard(tau, params)) {
          events.push({ type: 'genuineFill', roleId: group.roleId });
          grifterPoolDelta -= 1;
          if (runningLevelCounts && minLevel > 0) consumeFromLowestLevel(runningLevelCounts, minLevel);
          return { state: 'FILLED' as const, vacantSince: null };
        }
        return slot;
      }

      // BACKSTOPPED
      if (tau - params.tHard >= conscriptionDelay) {
        const otherCandidates: { gi: number; si: number; tenure: number }[] = [];
        for (let oi = 0; oi < working.length; oi++) {
          if (oi === gi) continue;
          working[oi]!.forEach((s, si) => {
            // Missing tenure data defaults to ESTABLISHED_TENURE_DAYS (i.e. "already
            // established, no preference applied") — the one value that makes the pool
            // below collapse back to every candidate, reproducing old byte-identical
            // behavior whenever a caller doesn't pass occupantTenure at all.
            if (s.state === 'FILLED') otherCandidates.push({ gi: oi, si, tenure: roleGroups[oi]!.occupantTenure?.[si] ?? ESTABLISHED_TENURE_DAYS });
          });
        }
        const effectiveGrifterPool = Math.max(0, grifterPoolSize + grifterPoolDelta);
        const denom = effectiveGrifterPool + otherCandidates.length;
        if (denom <= 0) {
          // Nobody anywhere to draft from today — stays BACKSTOPPED, the mechanical
          // zero-player-attached state (BACKSTOP_PRODUCTIVITY still covers the slot; this
          // is not a "permanent zero-state" for any PLAYER, constraint 2's actual concern).
          return slot;
        }
        const draftFromOther = rng() < otherCandidates.length / denom;
        if (draftFromOther) {
          // Prefer whoever hasn't cleared ESTABLISHED_TENURE_DAYS yet; only fall back to
          // the full candidate pool once nobody qualifies as "not yet established" — see
          // occupantTenure's own doc comment above for why this is preference, not immunity.
          const notYetEstablished = otherCandidates.filter((c) => c.tenure < ESTABLISHED_TENURE_DAYS);
          const evictionPool = notYetEstablished.length > 0 ? notYetEstablished : otherCandidates;
          const pick = evictionPool[Math.floor(rng() * evictionPool.length)]!;
          const fromRoleId = roleGroups[pick.gi]!.roleId;
          working[pick.gi]![pick.si] = { state: 'VACANT', vacantSince: day };
          events.push({ type: 'conscriptionFromOtherRole', roleId: group.roleId, fromRoleId });
        } else {
          grifterPoolDelta -= 1;
          // Unrestricted (any level, min 0) — conscription bypasses the reputation gate
          // entirely (constraint 2/§3.5), but the per-level running count still has to be
          // decremented here too, or a LATER role group's gated genuineFill check would
          // evaluate against a stale snapshot that doesn't reflect this consumption (see
          // consumeFromLowestLevel's own header for the real bug this fixes).
          if (runningLevelCounts) consumeFromLowestLevel(runningLevelCounts, 0);
          events.push({ type: 'conscriptionFromGrifters', roleId: group.roleId });
        }
        return { state: 'FILLED' as const, vacantSince: null };
      }
      return slot;
    });
  }

  return {
    // Preserves `minReputationLevelForFill` (real bug found and fixed 2026-08-13: dropping
    // it here meant any caller that reuses `result.roleGroups` as next day's input — which
    // `world.ts` doesn't do, it rebuilds fresh every tick, but this module's own tests and
    // any other future caller reasonably would — silently ran ungated from day 2 onward).
    roleGroups: roleGroups.map((g, i) => ({
      roleId: g.roleId,
      slots: working[i]!,
      params: g.params,
      minReputationLevelForFill: g.minReputationLevelForFill,
      occupantTenure: g.occupantTenure,
    })),
    grifterPoolDelta,
    events,
  };
}

/** Re-exported so callers don't need a second import from `engine/vacancy.js` just for the type. */
export type { RoleSlot, VacancyParams };
// stepSlot is imported for potential future direct single-group use by callers of this
// module that don't need the multi-role draft logic; re-exported for that convenience.
export { stepSlot };
