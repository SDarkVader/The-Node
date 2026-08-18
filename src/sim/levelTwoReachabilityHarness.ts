import { stepMultiRoleConscriptionDay, type RoleGroupState, type RoleSlot } from './multiRoleConscription.js';
import { dailyChurnFromMonthly, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS } from './vacancyHarness.js';
import { shiftCoverPay, shiftCoverNoticedIndices, orderGrifterCandidatesForNotice, SHIFT_COVER_FRACTION } from '../engine/shiftCover.js';
import { reputationLevelForProgress, minLevelForRole, MAX_REPUTATION_LEVEL } from '../engine/reputation.js';
import { GRIFTER_DAILY_INCOME, SUPPORT_ROLE_DAILY_WAGE, DAILY_ACTIVITY_MULTIPLIER } from '../engine/wealth.js';
import { mulberry32 } from './rng.js';

/**
 * Measures the real effect of the 2026-08-18 level-2-gate fix
 * (`engine/shiftCover.ts`'s `orderGrifterCandidatesForNotice`) against the "level-2 trap"
 * measured 2026-08-13 (`docs/BLUEPRINT.md`'s "Investigating the level-2 rarity" entry): 83-90%
 * of grifters who reach level 1 get swept into a role within a mean 6.9-16.3 days, before
 * earning the 3 additional Shift Cover completions level 2 needs.
 *
 * Reconstructs real, calibrated dynamics at `DEFAULT_WORLD_CONFIG` scale directly from the
 * same real engine primitives `world.ts` itself uses — `stepMultiRoleConscriptionDay`, the
 * real reputation gate, the real grifter-removal selection ("lowest eligible level first,
 * longest wait," mirrored exactly from `world.ts`'s own `genuineFill`/`conscriptionFromGrifters`
 * handling) — rather than a toy model, the same discipline `realisticEventFrequency` in
 * `evictionProtectionHarness.ts` already established for a comparable question. Simplified
 * relative to full `stepWorld`: no market/district/wealth-cap machinery, since none of it
 * feeds back into conscription, Shift Cover selection, or reputation progress — wealth here
 * exists only to drive the ORIGINAL "neediest first" fallback rule faithfully, using a flat
 * per-role wage stand-in rather than Miller/Baker's full Cournot/Bertrand market.
 *
 * Unlike `experienceFloorHarness.ts`, this does NOT run two worlds in rng-lockstep — the fix
 * changes SELECTION (which grifter gets notice priority), so the two arms genuinely diverge,
 * same reasoning `evictionProtectionHarness.ts` already documented for its own comparison.
 * Compared on aggregate steady-state/cumulative statistics instead.
 */

const ROLE_COUNTS: Record<string, number> = { miller: 9, baker: 9, courier: 7, journalist: 7, detective: 8, importExport: 6 };
const TOTAL_ROLE_SLOTS = Object.values(ROLE_COUNTS).reduce((a, b) => a + b, 0);
const N_POPULATION = 100;
const CONSCRIPTION_DELAY = 14;
const P_MONTHLY = 0.2;

interface Grifter {
  id: number;
  wealth: number;
  daysAsGrifter: number;
  reputationProgress: number;
}

export interface LevelTwoRunResult {
  /** Distinct grifter ids that ever reached level 2. */
  everReachedLevel2: Set<number>;
  /** For every grifter removed (genuineFill/conscriptionFromGrifters) while below level 2 but
   *  at level >= 1 at time of removal: days spent at level >= 1 before removal. */
  daysAtLevelOneBeforeRemoval: number[];
  /** Total Shift Cover completions credited to grifters who were still level 0 at the time —
   *  a companion safety check that the new priority doesn't starve level-0 grifters entirely. */
  level0CoversCredited: number;
  totalCoversCredited: number;
}

function makeParams(R: number): VacancyParams {
  return {
    N: N_POPULATION,
    R,
    pDaily: dailyChurnFromMonthly(P_MONTHLY),
    beta: DEFAULTS.beta,
    tPain: DEFAULTS.tPain,
    vBoost: DEFAULTS.vBoost,
    tFlag: DEFAULTS.tFlag,
    tHard: DEFAULTS.tHard,
  };
}

export function runLevelTwoReachability(seed: number, days: number, useNewOrdering: boolean): LevelTwoRunResult {
  const roleIds = Object.keys(ROLE_COUNTS);
  let groups: RoleGroupState[] = roleIds.map((roleId) => ({
    roleId,
    slots: Array.from({ length: ROLE_COUNTS[roleId]! }, () => ({ state: 'FILLED' as const, vacantSince: null })),
    params: makeParams(ROLE_COUNTS[roleId]!),
    minReputationLevelForFill: minLevelForRole(roleId),
  }));

  let grifters: Grifter[] = [];
  let nextId = 0;
  const grifterCount = Math.max(0, N_POPULATION - TOTAL_ROLE_SLOTS);
  for (let i = 0; i < grifterCount; i++) grifters.push({ id: nextId++, wealth: 0, daysAsGrifter: 0, reputationProgress: 0 });

  const rng = mulberry32(seed);
  const result: LevelTwoRunResult = {
    everReachedLevel2: new Set(),
    daysAtLevelOneBeforeRemoval: [],
    level0CoversCredited: 0,
    totalCoversCredited: 0,
  };
  const levelOneReachedDay = new Map<number, number>();
  const supportDaily = SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER;

  for (let day = 0; day < days; day++) {
    const grifterLevelCounts: Record<number, number> = {};
    for (const g of grifters) {
      const level = reputationLevelForProgress(g.reputationProgress);
      grifterLevelCounts[level] = (grifterLevelCounts[level] ?? 0) + 1;
    }

    const conscriptionResult = stepMultiRoleConscriptionDay(groups, grifters.length, day, CONSCRIPTION_DELAY, rng, grifterLevelCounts);
    groups = conscriptionResult.roleGroups;

    grifters = grifters.map((g) => ({ ...g, daysAsGrifter: g.daysAsGrifter + 1 }));

    for (const event of conscriptionResult.events) {
      if (event.type === 'churn') {
        grifters = [...grifters, { id: nextId++, wealth: 0, daysAsGrifter: 0, reputationProgress: 0 }];
      } else if (event.type === 'genuineFill') {
        const minLevel = minLevelForRole(event.roleId);
        const eligible = grifters
          .map((g, i) => ({ i, level: reputationLevelForProgress(g.reputationProgress), days: g.daysAsGrifter }))
          .filter((o) => o.level >= minLevel);
        if (eligible.length > 0) {
          const lowestEligibleLevel = Math.min(...eligible.map((o) => o.level));
          const atLowestLevel = eligible.filter((o) => o.level === lowestEligibleLevel);
          let longest = atLowestLevel[0]!;
          for (const o of atLowestLevel) if (o.days > longest.days) longest = o;
          recordRemoval(grifters[longest.i]!, day, levelOneReachedDay, result);
          grifters = grifters.filter((_, i) => i !== longest.i);
        }
      } else if (event.type === 'conscriptionFromGrifters') {
        if (grifters.length > 0) {
          const lowestLevel = Math.min(...grifters.map((g) => reputationLevelForProgress(g.reputationProgress)));
          let longestIdx = -1;
          for (let i = 0; i < grifters.length; i++) {
            if (reputationLevelForProgress(grifters[i]!.reputationProgress) !== lowestLevel) continue;
            if (longestIdx === -1 || grifters[i]!.daysAsGrifter > grifters[longestIdx]!.daysAsGrifter) longestIdx = i;
          }
          if (longestIdx >= 0) {
            recordRemoval(grifters[longestIdx]!, day, levelOneReachedDay, result);
            grifters = grifters.filter((_, i) => i !== longestIdx);
          }
        }
      }
    }

    grifters = grifters.map((g) => ({ ...g, wealth: g.wealth + GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER }));

    // Real BACKSTOPPED-opportunity count per role, this tick's post-conscription state —
    // matches world.ts's own shiftCoverOpportunities construction (flat payout stand-in,
    // see module header for why the full market isn't needed here).
    let backstoppedCount = 0;
    for (const g of groups) backstoppedCount += g.slots.filter((s: RoleSlot) => s.state === 'BACKSTOPPED').length;

    const noticedIdx = shiftCoverNoticedIndices(backstoppedCount, grifters.length, rng);
    if (noticedIdx.length > 0) {
      const order = useNewOrdering
        ? orderGrifterCandidatesForNotice(grifters)
        : grifters.map((g, i) => ({ i, wealth: g.wealth })).sort((a, b) => a.wealth - b.wealth || a.i - b.i).map((o) => o.i);
      const selected = order.slice(0, noticedIdx.length);
      grifters = grifters.map((g, i) => {
        const pos = selected.indexOf(i);
        if (pos < 0) return g;
        const wasLevel0 = reputationLevelForProgress(g.reputationProgress) === 0;
        result.totalCoversCredited += 1;
        if (wasLevel0) result.level0CoversCredited += 1;
        const nextProgress = g.reputationProgress + 1;
        if (reputationLevelForProgress(g.reputationProgress) < 1 && reputationLevelForProgress(nextProgress) >= 1) {
          levelOneReachedDay.set(g.id, day);
        }
        if (reputationLevelForProgress(nextProgress) >= MAX_REPUTATION_LEVEL) result.everReachedLevel2.add(g.id);
        return { ...g, wealth: g.wealth + shiftCoverPay(supportDaily, SHIFT_COVER_FRACTION), reputationProgress: nextProgress };
      });
    }
  }

  return result;
}

function recordRemoval(g: Grifter, day: number, levelOneReachedDay: Map<number, number>, result: LevelTwoRunResult): void {
  if (result.everReachedLevel2.has(g.id)) return; // already counted as a level-2 success, not a trap victim
  const reachedDay = levelOneReachedDay.get(g.id);
  if (reachedDay !== undefined) result.daysAtLevelOneBeforeRemoval.push(day - reachedDay);
}
