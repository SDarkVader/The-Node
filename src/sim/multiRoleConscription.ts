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
 */

export interface RoleGroupState {
  roleId: string;
  slots: RoleSlot[];
  params: VacancyParams;
}

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
export function stepMultiRoleConscriptionDay(
  roleGroups: readonly RoleGroupState[],
  grifterPoolSize: number,
  day: number,
  conscriptionDelay: number,
  rng: () => number,
): MultiRoleConscriptionResult {
  const events: MultiRoleEvent[] = [];
  let grifterPoolDelta = 0;
  const working: RoleSlot[][] = roleGroups.map((g) => [...g.slots]);

  for (let gi = 0; gi < roleGroups.length; gi++) {
    const group = roleGroups[gi]!;
    const params = group.params;
    working[gi] = working[gi]!.map((slot) => {
      if (slot.state === 'FILLED') {
        if (rng() < params.pDaily) {
          events.push({ type: 'churn', roleId: group.roleId });
          grifterPoolDelta += 1;
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
        if (rng() < fillHazard(tau, params)) {
          events.push({ type: 'genuineFill', roleId: group.roleId });
          grifterPoolDelta -= 1;
          return { state: 'FILLED' as const, vacantSince: null };
        }
        return slot;
      }

      // BACKSTOPPED
      if (tau - params.tHard >= conscriptionDelay) {
        const otherCandidates: { gi: number; si: number }[] = [];
        for (let oi = 0; oi < working.length; oi++) {
          if (oi === gi) continue;
          working[oi]!.forEach((s, si) => {
            if (s.state === 'FILLED') otherCandidates.push({ gi: oi, si });
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
          const pick = otherCandidates[Math.floor(rng() * otherCandidates.length)]!;
          const fromRoleId = roleGroups[pick.gi]!.roleId;
          working[pick.gi]![pick.si] = { state: 'VACANT', vacantSince: day };
          events.push({ type: 'conscriptionFromOtherRole', roleId: group.roleId, fromRoleId });
        } else {
          grifterPoolDelta -= 1;
          events.push({ type: 'conscriptionFromGrifters', roleId: group.roleId });
        }
        return { state: 'FILLED' as const, vacantSince: null };
      }
      return slot;
    });
  }

  return {
    roleGroups: roleGroups.map((g, i) => ({ roleId: g.roleId, slots: working[i]!, params: g.params })),
    grifterPoolDelta,
    events,
  };
}

/** Re-exported so callers don't need a second import from `engine/vacancy.js` just for the type. */
export type { RoleSlot, VacancyParams };
// stepSlot is imported for potential future direct single-group use by callers of this
// module that don't need the multi-role draft logic; re-exported for that convenience.
export { stepSlot };
