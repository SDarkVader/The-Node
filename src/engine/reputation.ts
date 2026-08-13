/**
 * Reputation levels (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3). Pure,
 * dependency-free, same style as every other `src/engine/` module.
 *
 * THE GATE ITSELF (2026-08-13, restructured). §3.5 says reputation gates apply only to
 * *voluntary* role uptake, never to backstop/conscription. The real fill mechanism
 * (`sim/multiRoleConscription.ts`'s `genuineFill` event) was a hazard-driven AGGREGATE COUNT
 * increment with no per-grifter selection at all — extended (not replaced) to optionally
 * accept a per-level breakdown of the same pool, gating `genuineFill` on real eligible
 * headroom while leaving `conscriptionFromGrifters`/`conscriptionFromOtherRole`/
 * `backstopFires` completely untouched. `world.ts` does the actual per-real-grifter selection
 * once an event comes back (same longest-wait convention it already used, now filtered to
 * eligible grifters for `genuineFill` specifically). See `multiRoleConscription.ts`'s own
 * header for the restructuring detail and why it's backward-compatible with every
 * pre-2026-08-13 caller.
 *
 * SCOPE OF THIS PASS — LEVEL/PROGRESS PERSISTENCE. Reputation is stored on `GrifterSlot`
 * (`world.ts`), which is itself session-scoped to one grifter "episode" — this engine has no
 * persistent per-player identity that survives a grifter becoming a role-holder and back
 * (`player.ts`'s own header: "a session-scoped id... real accounts/auth are a separate, later
 * concern, not decided here"; role slots reset wealth/experience to 0 on every new occupant,
 * with no reference back to which grifter, if any, they used to be). So: reputation
 * genuinely resets to 0 if someone cycles grifter -> role -> grifter again. This is a real,
 * known limitation inherited from that pre-existing architecture gap, not something this
 * module is doing wrong — flagged here rather than silently assumed away.
 */

/**
 * Progress-ticks needed to reach level 1, then level 2. A rising bar per §3.4 (each
 * threshold higher than the last).
 *
 * MEASURED, not left as an untested guess (2026-08-13): first shipped as `[3, 8]`,
 * [ILLUSTRATIVE], picked with no real data. Verified against real `stepWorld` runs (1000
 * days, 3 seeds, 3 churn rates) tracking every grifter's progress every tick, not just a
 * final snapshot (a snapshot alone undercounts — a grifter who accrues enough progress to
 * matter is often the same grifter who then gets genuinely conscripted into a role and
 * disappears from the pool, which is the mechanic working as intended, not a measurement
 * artifact to correct for). Finding: level 1 (3) is robustly reached — hundreds to
 * thousands of grifter-days cross it per 1000-day run. The original level-2 threshold (8)
 * was NEVER reached once across all 9 (seed, churn-rate) combinations — max progress ever
 * observed, across the whole grid, topped out at 7. Lowered to 6, which real grifters do
 * reach (0-177 times per 1000-day run depending on churn), while staying meaningfully
 * harder than level 1 (double the bar) — matches the intended "harder, rarer" shape (§3.2)
 * without being a dead tier nobody can ever occupy.
 */
export const REPUTATION_LEVEL_THRESHOLDS: readonly number[] = [3, 6];

export const MAX_REPUTATION_LEVEL = REPUTATION_LEVEL_THRESHOLDS.length;

/** Derives level from accumulated progress — the single source of truth; level is never
 *  stored independently of progress, so the two can't drift out of sync. */
export function reputationLevelForProgress(progress: number): number {
  let level = 0;
  for (const threshold of REPUTATION_LEVEL_THRESHOLDS) {
    if (progress >= threshold) level += 1;
  }
  return level;
}

/**
 * Roles eligible for VOLUNTARY uptake at a given level — level 0 unlocks none (a brand-new
 * grifter can still be conscripted/backstopped into anything, per constraint 2; they just
 * can't be voluntarily placed until they've built some reputation). Level 1 unlocks the four
 * cooperative, high-completion-rate roles (§3.2 — Courier/Journalist/Detective/Import-Export,
 * ~97-100% measured completion). Level 2 adds the two competitive roles (Miller/Baker,
 * ~54-58% measured completion) on top — additive, per constraint 6, never replaces level 1's
 * set.
 */
const LEVEL_1_ROLES = ['courier', 'journalist', 'detective', 'importExport'] as const;
const LEVEL_2_ROLES = ['miller', 'baker'] as const;

export function rolesEligibleFor(level: number): readonly string[] {
  if (level <= 0) return [];
  if (level === 1) return LEVEL_1_ROLES;
  return [...LEVEL_1_ROLES, ...LEVEL_2_ROLES];
}

/**
 * The inverse of `rolesEligibleFor`: smallest level at which `roleId` becomes eligible for
 * voluntary uptake. Miller/Baker -> 2; the four cooperative roles -> 1. A role not in any
 * level's set (shouldn't occur for the real six roles) falls back to `MAX_REPUTATION_LEVEL +
 * 1` — deliberately unreachable rather than 0, so an unrecognized roleId reads as "gated
 * shut" rather than silently wide open.
 */
export function minLevelForRole(roleId: string): number {
  for (let level = 1; level <= MAX_REPUTATION_LEVEL; level++) {
    if (rolesEligibleFor(level).includes(roleId)) return level;
  }
  return MAX_REPUTATION_LEVEL + 1;
}
