import { createWorld, stepWorld, type World, type WorldConfig } from '../world/world.js';
import { stepMultiRoleConscriptionDay, ESTABLISHED_TENURE_DAYS, PERFORMANCE_BAR, type RoleGroupState } from './multiRoleConscription.js';
import { dailyChurnFromMonthly, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS } from './vacancyHarness.js';
import { TYPICAL_COMPLETION_RATIO, type CompletionStats, type CompletionRoleType } from '../engine/roleCompletion.js';
import { mulberry32 } from './rng.js';

/**
 * Measures the real, aggregate effect of the 2026-08-18 `occupantTenure`/
 * `ESTABLISHED_TENURE_DAYS` eviction-preference bias under real `stepWorld` dynamics — user:
 * "simulate it — verify the eviction preference under real load." The pure-function unit
 * tests in `test/multiRoleConscription.test.ts` already prove the SELECTION LOGIC is correct
 * against synthetic candidate pools; what those can't show is whether the mechanism actually
 * fires with any real frequency at `DEFAULT_WORLD_CONFIG` scale, and whether it produces a
 * measurable protective effect once real churn, backstop timing, and conscription compete for
 * the same finite candidate pool simultaneously across all six roles.
 *
 * Unlike `experienceFloorHarness.ts`, this is NOT a same-tick rng-lockstep comparison — the
 * two arms are expected to genuinely diverge in WHICH specific building fills/vacates on which
 * day, because the preference changes SELECTION itself (which candidate a conscription event
 * picks), not just a value computed after an already-identical selection. That divergence is
 * real and expected, not a bug in the harness: `occupantTenure` never changes the NUMBER of
 * rng() calls, whether/when a conscriptionFromOtherRole event fires, or any other role's own
 * churn/fill hazard (confirmed directly in `multiRoleConscription.ts` — only the specific
 * index picked within an already-computed candidate pool differs). So the two arms are
 * compared on STEADY-STATE AGGREGATE statistics, not tick-by-tick equality.
 *
 * REAL BUG CAUGHT BUILDING THIS (worth recording, not quietly fixing in silence): the first
 * version of this harness fed the "without" arm's OWN (stripped) `daysInRole` back into
 * `meanFilledTenure` — measuring the exact constant it had just been reset to, every single
 * day, by construction. That produced a fabricated "276% protective effect" that was really
 * just "30.00 always equals 30.00." Fixed by separating the two roles `daysInRole` was being
 * asked to play at once: an EXTERNAL ledger (`trueTenureFor`), keyed by buildingId and
 * completely independent of `World`, tracks what tenure would REALLY have accumulated under
 * no-preference dynamics; `world.daysInRole` itself is still reset to a neutral constant
 * before every `stepWorld` call in the "without" arm — that reset is what actually neutralizes
 * SELECTION (the real counterfactual manipulation) — but it is never read back out as a
 * measurement again.
 *
 * SECOND STALENESS BUG CAUGHT (2026-08-18, same day the performance dimension was added):
 * once `world.ts` started passing real `occupantPerformance` unconditionally (from
 * `completionStats`, never optional the way `occupantTenure` was designed to be skippable),
 * `neutralizeTenure` alone stopped being a true "no eviction preference at all" baseline —
 * the "without" arm still had a live, real performance-based preference running underneath,
 * silently understating the measured effect. Fixed by also resetting `completionStats` to the
 * exact "meets PERFORMANCE_BAR, no more" value for every FILLED slot, mirroring
 * `ESTABLISHED_TENURE_DAYS`'s own "reset to exactly the bar" convention — caught by comparing
 * this run's numbers against the pre-performance-dimension measurement and noticing the
 * "without" arm's own mean tenure had moved, which it should never do on its own.
 */

export interface EvictionProtectionRunResult {
  /** Mean tenure across every FILLED slot, all six roles, each day. */
  meanFilledTenure: number[];
  economicHealthSeries: number[];
  /** grifters.length + total FILLED across all roles, each day — sanity/no-crash check
   *  (NOT strict conservation — arrivals/migration mean population isn't fixed). */
  totalAccountedFor: number[];
}

interface SlotView {
  buildingId: string;
  filled: boolean;
  daysInRole: number;
}

function slotViews(w: World): SlotView[] {
  return [...w.millers, ...w.bakers, ...w.couriers, ...w.journalists, ...w.detectives, ...w.importExporters].map((s) => ({
    buildingId: s.buildingId,
    filled: s.slot.state === 'FILLED',
    daysInRole: s.daysInRole,
  }));
}

/** The exact-bar `CompletionStats` for one role — completionRatio/typical lands precisely at
 *  PERFORMANCE_BAR, the same "reset to exactly the threshold, no more" convention
 *  ESTABLISHED_TENURE_DAYS itself uses for daysInRole below. */
function neutralCompletionStats(role: CompletionRoleType): CompletionStats {
  const attempts = 100;
  return { attempts, completions: Math.round(PERFORMANCE_BAR * TYPICAL_COMPLETION_RATIO[role] * attempts) };
}

/** Neutralizes BOTH dimensions the 2026-08-18 eviction preference can act on — tenure AND
 *  real performance — so the "without" arm is a true "as if this whole feature didn't exist"
 *  baseline, not just half of one. See this module's header for the staleness bug this fixes. */
function neutralizeEvictionPreference(world: World): World {
  const completionStats: Record<string, CompletionStats> = { ...world.completionStats };
  for (const m of world.millers) completionStats[m.buildingId] = neutralCompletionStats('miller');
  for (const b of world.bakers) completionStats[b.buildingId] = neutralCompletionStats('baker');
  for (const c of world.couriers) completionStats[c.buildingId] = neutralCompletionStats('courier');
  for (const j of world.journalists) completionStats[j.buildingId] = neutralCompletionStats('journalist');
  for (const d of world.detectives) completionStats[d.buildingId] = neutralCompletionStats('detective');
  for (const x of world.importExporters) completionStats[x.buildingId] = neutralCompletionStats('importExport');
  return {
    ...world,
    millers: world.millers.map((m) => ({ ...m, daysInRole: ESTABLISHED_TENURE_DAYS })),
    bakers: world.bakers.map((b) => ({ ...b, daysInRole: ESTABLISHED_TENURE_DAYS })),
    couriers: world.couriers.map((c) => ({ ...c, daysInRole: ESTABLISHED_TENURE_DAYS })),
    journalists: world.journalists.map((j) => ({ ...j, daysInRole: ESTABLISHED_TENURE_DAYS })),
    detectives: world.detectives.map((d) => ({ ...d, daysInRole: ESTABLISHED_TENURE_DAYS })),
    importExporters: world.importExporters.map((x) => ({ ...x, daysInRole: ESTABLISHED_TENURE_DAYS })),
    completionStats,
  };
}

function meanOf(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Tracks what daysInRole would REALLY be under no-preference dynamics, entirely outside
 *  `World` — see the module header for why this has to be external to the stripped field. */
class ExternalTenureLedger {
  private tenure = new Map<string, number>();
  private prevFilled = new Set<string>();

  seedFromInitialWorld(w: World): void {
    for (const v of slotViews(w)) {
      if (v.filled) {
        this.tenure.set(v.buildingId, ESTABLISHED_TENURE_DAYS); // "start maxed, established shard"
        this.prevFilled.add(v.buildingId);
      }
    }
  }

  /** Call once per tick with the POST-stepWorld world (before it gets neutralized). */
  advance(w: World): void {
    const nowFilled = new Set<string>();
    for (const v of slotViews(w)) {
      if (!v.filled) continue;
      nowFilled.add(v.buildingId);
      const wasFilled = this.prevFilled.has(v.buildingId);
      this.tenure.set(v.buildingId, wasFilled ? (this.tenure.get(v.buildingId) ?? 0) + 1 : 0);
    }
    this.prevFilled = nowFilled;
  }

  meanFilled(): number {
    return meanOf([...this.prevFilled].map((id) => this.tenure.get(id) ?? 0));
  }
}

function totalFilledCount(w: World): number {
  return slotViews(w).filter((v) => v.filled).length;
}

/**
 * Confirms `conscriptionFromOtherRole` — the event type the eviction preference actually
 * touches — fires with real, nonzero frequency at `DEFAULT_WORLD_CONFIG`'s real role/
 * population scale (M9 B9 C7 J7 D8 IE6, N=100), directly at the pure-function level (no full
 * `World` needed for this specific question). If `tHard`/`conscriptionDelay` were tuned such
 * that this branch almost never triggers in practice, the preference — however correct in
 * isolation — would be effectively dead weight under real load, which is exactly the kind of
 * gap unit tests against a synthetic fixture can't surface.
 */
export function realisticEventFrequency(seed: number, days: number): Record<string, number> {
  const roleCounts: Record<string, number> = { miller: 9, baker: 9, courier: 7, journalist: 7, detective: 8, importExport: 6 };
  const N = 100;
  const makeParams = (R: number): VacancyParams => ({
    N,
    R,
    pDaily: dailyChurnFromMonthly(0.2), // matches DEFAULT_WORLD_CONFIG's pMonthly
    beta: DEFAULTS.beta,
    tPain: DEFAULTS.tPain,
    vBoost: DEFAULTS.vBoost,
    tFlag: DEFAULTS.tFlag,
    tHard: DEFAULTS.tHard,
  });
  let groups: RoleGroupState[] = Object.entries(roleCounts).map(([roleId, R]) => ({
    roleId,
    slots: Array.from({ length: R }, () => ({ state: 'FILLED' as const, vacantSince: null })),
    params: makeParams(R),
  }));
  const totalRoleSlots = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  let pool = N - totalRoleSlots;
  const rng = mulberry32(seed);
  const tally: Record<string, number> = {};
  for (let day = 0; day < days; day++) {
    const result = stepMultiRoleConscriptionDay(groups, pool, day, 14, rng); // conscriptionDelay matches DEFAULT_WORLD_CONFIG
    groups = result.roleGroups;
    pool += result.grifterPoolDelta;
    for (const e of result.events) tally[e.type] = (tally[e.type] ?? 0) + 1;
  }
  return tally;
}

export function runEvictionProtectionComparison(
  seed: number,
  days: number,
  config: WorldConfig,
): { withPreference: EvictionProtectionRunResult; withoutPreference: EvictionProtectionRunResult } {
  let withWorld = createWorld(seed, config);
  let withoutWorld = createWorld(seed, config);
  const ledger = new ExternalTenureLedger();
  ledger.seedFromInitialWorld(withoutWorld);

  const withPreference: EvictionProtectionRunResult = { meanFilledTenure: [], economicHealthSeries: [], totalAccountedFor: [] };
  const withoutPreference: EvictionProtectionRunResult = { meanFilledTenure: [], economicHealthSeries: [], totalAccountedFor: [] };

  for (let day = 0; day < days; day++) {
    withWorld = stepWorld(withWorld);
    withPreference.meanFilledTenure.push(meanOf(slotViews(withWorld).filter((v) => v.filled).map((v) => v.daysInRole)));
    withPreference.economicHealthSeries.push(withWorld.economicHealth);
    withPreference.totalAccountedFor.push(withWorld.grifters.length + totalFilledCount(withWorld));

    const steppedWithout = stepWorld(withoutWorld);
    ledger.advance(steppedWithout); // measure the TRUE tenure before it gets neutralized below
    withoutPreference.meanFilledTenure.push(ledger.meanFilled());
    withoutPreference.economicHealthSeries.push(steppedWithout.economicHealth);
    withoutPreference.totalAccountedFor.push(steppedWithout.grifters.length + totalFilledCount(steppedWithout));
    withoutWorld = neutralizeEvictionPreference(steppedWithout); // neutralizes SELECTION for the next tick only
  }

  return { withPreference, withoutPreference };
}
