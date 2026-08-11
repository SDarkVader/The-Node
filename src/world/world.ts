/**
 * Unified deterministic world kernel (Observatory build spec, Phase B). Composes the
 * three previously-separate models — Phase 1 market (`millers.ts`/`bakers.ts`), Phase 2
 * vacancy/conscription (`vacancy.ts`, `sim/multiRoleConscription.ts`), and the ecosystem
 * layer (`ecosystem.ts`) — into one `World` object and one `stepWorld()` tick, now sited
 * on real geography via Phase A's `space.ts`. Existing engine modules are called, not
 * reimplemented.
 *
 * TICK ORDER (pinned by `test/world.regression.test.ts`'s determinism/order test — do not
 * reorder without updating both): space/occupancy -> vacancy and conscription -> market
 * (Miller then Baker, then support-role and grifter income) -> ecosystem (sabotage,
 * arrivals, migration, health, experience) -> comms (rumour propagation). Matches the
 * Observatory spec's given order exactly. Within the ecosystem stage, sabotage is applied
 * BEFORE arrivals, per `design/tick_order_check.py`'s own validated finding ("shock BEFORE
 * arrival" — the prior art the spec explicitly said to check before choosing an order) —
 * checked, not reinvented.
 *
 * DETERMINISM: `World.rng` is a single `mulberry32` closure created once in `createWorld`
 * and threaded through every `stepWorld` call via the returned `World`'s own field —
 * identical to how every existing harness in this repo (`vacancyHarness.ts`,
 * `ecosystemHarness.ts`) already threads one `rng` through a whole run. This means `World`
 * is not literally a plain JSON value (it carries a function) — `stepWorld` is still
 * deterministic given the same starting `World` (no `Math.random()`, no external mutable
 * state), but it is NOT the same thing as `structuredClone(world)` producing an
 * independently-steppable fork; two `World`s only diverge by calling `createWorld` with a
 * new seed. Phase D's snapshot contract will need its own explicit projection from `World`
 * to a serializable schema — deliberately not attempted here.
 *
 * ROLE ROSTER (2026-08-11, user-specified, replacing the earlier 2-role-only scope):
 * Miller and Baker keep their existing competitive (Cournot/Bertrand) market mechanics,
 * unchanged. Courier, Journalist, and Detective have no differentiated economic mechanic
 * designed anywhere in this project's lore/brief — each gets a flat `SUPPORT_ROLE_DAILY_WAGE`
 * (`wealth.ts`), explicitly flagged as an undifferentiated placeholder standing in for
 * three genuinely different unbuilt economies, not a claim that couriering, reporting, and
 * detective work are actually economically identical.
 *
 * "Grifters" (2026-08-11, user's own term) are roleless community players — individually
 * tracked (`GrifterSlot`, unlike the prior "gossip layer," which was only ever an aggregate
 * count), earning `GRIFTER_DAILY_INCOME` (below every role's wage — constraint 2's "no
 * permanent zero-state" still applies, so it is a real positive floor, not zero) until
 * drafted or self-selected into any open role. Role-vacancy handling for all 5 roles now
 * runs through `sim/multiRoleConscription.ts`'s `stepMultiRoleConscriptionDay` — a NEW,
 * separate N-role generalization of the original 2-role `conscriptionHarness.ts`, which is
 * left untouched and still covers its own tests. A departing role-holder (churn, or a
 * sabotage eviction) falls back into the grifter pool rather than leaving the population —
 * they are still present, just roleless, until re-drafted; only true emigration
 * (`migrationValveStep`) removes someone from `population` entirely.
 *
 * WEALTH-INEQUALITY SCOPE (widened 2026-08-11): `wealthGini`/`wealthTop10Share` previously
 * covered Miller+Baker only, because the gossip layer had no individually-tracked wealth to
 * include. Grifters now do — this task's whole point — so these two fields now span every
 * identity-bearing player in the shard (all 5 roles' FILLED slots + every grifter), which is
 * what the original "90%/10%" concern in docs/BLUEPRINT.md was actually asking about.
 * `wealthTaxRate`/`wealthCap` remediation stays scoped to Miller+Baker only, deliberately
 * NOT widened in this pass — flagged as an open scoping question, not silently decided;
 * both remain off by default (`wealthTaxRate: 0`, `wealthCap: undefined`) regardless.
 *
 * Comms only propagates `pendingWallPosts` from role-holders with a fixed building position
 * (Miller/Baker/Courier/Journalist/Detective); grifters have no fixed position in this model
 * (same simplification `space.ts`'s own `placeArrival()` already left unused) and are not
 * part of the proximity graph.
 */

import { mulberry32, gaussian } from '../sim/rng.js';
import {
  generateShardLayout,
  occupantsWithin,
  proximityCloseness,
  type Shard,
  type Building,
  type PlayerPosition,
  type ShardLayoutConfig,
  type PlayerId,
  DEFAULT_SHARD_CONFIG,
} from '../engine/space.js';
import { dailyChurnFromMonthly, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS as VACANCY_DEFAULTS } from '../sim/vacancyHarness.js';
import { stepMultiRoleConscriptionDay, type RoleGroupState } from '../sim/multiRoleConscription.js';
import {
  stepDistrictHealth,
  initialDistrictHealth,
  districtFilledFraction,
  consolidationFrictionMultiplier,
  CONSOLIDATION_GRACE_DAYS,
  type DistrictHealth,
} from '../engine/districtConsolidation.js';
import { stepMillers, flourPrice as computeFlourPrice } from '../engine/millers.js';
import { stepBakers } from '../engine/bakers.js';
import {
  economicHealth,
  economicHealthWithExperience,
  growExperience,
  migrationValveStep,
  detectionProbability,
  sabotageAttempt,
  applySabotageDamage,
  BACKSTOP_PRODUCTIVITY,
  EXPERIENCE_CAP,
} from '../engine/ecosystem.js';
import { stepClarity, applyDistortion } from '../comms/decay.js';
import { ConnectionGraph } from '../comms/connections.js';
import type { WallPost, SelfState } from '../comms/grammar.js';
import {
  millerDailyIncome,
  bakerDailyIncome,
  dailyDueCustomers,
  splitBakerDemand,
  giniCoefficient,
  topShare,
  taxAndRedistributeIncome,
  applyWealthCap,
  DAILY_ACTIVITY_MULTIPLIER,
  SUPPORT_ROLE_DAILY_WAGE,
  GRIFTER_DAILY_INCOME,
} from '../engine/wealth.js';

export type RoleType = 'miller' | 'baker' | 'courier' | 'journalist' | 'detective';
export const ROLE_TYPES: readonly RoleType[] = ['miller', 'baker', 'courier', 'journalist', 'detective'];

export interface WorldConfig {
  shardConfig: ShardLayoutConfig;
  rMiller: number;
  rBaker: number;
  /** Support role — flat SUPPORT_ROLE_DAILY_WAGE, no competitive market mechanic. [ILLUSTRATIVE] */
  rCourier: number;
  /** Support role — flat SUPPORT_ROLE_DAILY_WAGE, no competitive market mechanic. [ILLUSTRATIVE] */
  rJournalist: number;
  /** Support role — flat SUPPORT_ROLE_DAILY_WAGE, no competitive market mechanic. [ILLUSTRATIVE] */
  rDetective: number;
  targetPopulation: number;
  pMonthly: number;
  conscriptionDelay: number;
  gamma: number;
  noiseSigma: number;
  vacancy?: Partial<Pick<VacancyParams, 'beta' | 'tPain' | 'vBoost' | 'tFlag' | 'tHard' | 'backstoppedRecoveryHazard'>>;
  sabotageCadenceDays: number;
  saboteurCount: number;
  acquireDays: number;
  damagePerSuccess: number;
  /** Flagged unresolved by Phase A's spatial-witness report — no canonical value exists.
   *  Exposed as config rather than hardcoded so it stays visible as an open question. */
  witnessRadius: number;
  /** [ILLUSTRATIVE] — matches design/tick_order_check.py's own test scenario (0.10), not a
   *  brief-specified or calibrated arrival rate. */
  arrivalPDaily: number;
  migrationTheta: number;
  migrationK: number;
  /** Radius used to build the proximity-based connection graph for Wall-post propagation. */
  commsProximityRange: number;
  /** PROPOSAL, not shipped as default (0). Flat daily income tax, redistributed equally
   *  across all currently-FILLED Miller+Baker role-holders — see wealth.ts's
   *  taxAndRedistributeIncome(). Deliberately NOT widened to the other 3 roles or grifters
   *  in this pass — see this file's header "WEALTH-INEQUALITY SCOPE" note. */
  wealthTaxRate: number;
  /** PROPOSAL, not shipped as default (undefined = no cap). Hard ceiling on accumulated
   *  Miller+Baker wealth only — see wealth.ts's applyWealthCap() and the scoping note above. */
  wealthCap?: number;
  /** Average days between one customer's bread purchases — feeds dailyDueCustomers().
   *  Defaults to wealth.ts's own PURCHASE_CYCLE_DAYS; exposed here so it's a real,
   *  sweepable knob rather than requiring a source edit to test different values. */
  purchaseCycleDays?: number;
}

// Five-role split, re-derived 2026-08-11 against the ACTUAL fixed system (district
// consolidation + shard registry + live-N), via sim/multiShardRoleDistrictSweep.ts —
// superseding the earlier S=24 default, which was anchored to ecosystem.ts's S_DEFAULT
// (a pre-multi-shard calibration point that no longer describes what's actually running).
// Swept 6 role-slot totals through the real multi-shard harness: every S=24 split tested
// clustered tightly together (44.1-44.7/65 mean per-shard population, 0.847-0.860 health)
// with no meaningful difference between which of the 5 roles got the slots — the total
// mattered, not the split. S=30 was the one candidate that meaningfully out-staffed the
// rest (53.3/65, 82%, health 0.875) at a real but smaller equality cost (Gini 0.563 vs.
// 0.518-0.542 for the S=24 cluster) — judged worth it since "cleanest and fairest" means
// both staffed AND equitable, not equity at any staffing cost, and S=18 was strictly worse
// on every axis (not a real tradeoff). The specific 4/8/8/7/3 split is the one S=30
// configuration tested, not an exhaustive search across every possible split at that
// total — see docs/BLUEPRINT.md's "5-role/district allocation, re-derived" entry for the
// full numbers and the district-count decision (kept at 6 — see DEFAULT_SHARD_CONFIG's
// own note). [ILLUSTRATIVE, sweep-informed against the real, current system]
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  shardConfig: DEFAULT_SHARD_CONFIG,
  rMiller: 4,
  rBaker: 8,
  rCourier: 8,
  rJournalist: 7,
  rDetective: 3,
  targetPopulation: 65,
  pMonthly: 0.2,
  conscriptionDelay: 14,
  gamma: 1.0,
  noiseSigma: 0.01,
  sabotageCadenceDays: 20,
  saboteurCount: 3,
  acquireDays: 5,
  damagePerSuccess: 4,
  witnessRadius: 6,
  arrivalPDaily: 0.1,
  migrationTheta: 0.3,
  migrationK: 0.08,
  commsProximityRange: 10,
  wealthTaxRate: 0, // PROPOSAL disabled by default — see docs/BLUEPRINT.md's "Wealth inequality" entry
  wealthCap: undefined,
  purchaseCycleDays: undefined, // undefined = wealth.ts's own PURCHASE_CYCLE_DAYS default
};

export interface RoleEconomicSlot {
  slot: RoleSlot;
  buildingId: string;
  /** Miller: Cournot quantity. Baker: Bertrand price. Frozen while not FILLED. */
  value: number;
  /** Resets to 0 the moment a slot transitions into FILLED; frozen while VACANT/BACKSTOPPED. */
  experience: number;
  /** Accumulated personal earnings. Resets to 0 the moment a slot transitions into FILLED
   *  (a new occupant starts with nothing — no inherited wealth from whoever held the slot
   *  before); frozen while VACANT/BACKSTOPPED (nobody there to earn or lose anything). */
  wealth: number;
}

/** Courier/Journalist/Detective — same slot/wealth reset convention as RoleEconomicSlot,
 *  minus `value`/`experience` since none of the three have a competitive market mechanic. */
export interface SupportRoleSlot {
  slot: RoleSlot;
  buildingId: string;
  wealth: number;
}

/** A roleless community player ("grifter" — user's own term). Individually tracked, unlike
 *  the aggregate-only gossip-layer population this replaces for identity purposes. */
export interface GrifterSlot {
  id: string;
  /** Accumulated personal earnings at GRIFTER_DAILY_INCOME/day. Resets to 0 on creation
   *  (churn, sabotage eviction, or a fresh arrival never inherits anyone's balance). */
  wealth: number;
  /** Consecutive days spent roleless so far. Reset to 0 on creation; the identity is popped
   *  from the pool (not decremented) the moment it fills or is drafted into an open role.
   *  This is the direct measurement of "the effect of grifters being under the minimum
   *  income floor until they obtain a role." */
  daysAsGrifter: number;
  /** Set only for grifters displaced by a district MERGE (see `stepWorld`'s district-health
   *  stage) — the day index by which they must be placed into an open role, "2 weeks to
   *  gain a role or be drafted." undefined for ordinary churn/sabotage/arrival grifters,
   *  who have no such deadline and wait on the ordinary conscription timers instead. */
  consolidationDeadline?: number;
}

export interface SabotageLogEntry {
  tick: number;
  targetBuildingId: string;
  witnesses: number;
  successfulSaboteurs: number;
  evicted: number;
}

export interface RumourEventLite {
  heardBy: PlayerId;
  heardFrom: PlayerId;
  state: SelfState;
  distorted: boolean;
  clarity: number;
}

export interface World {
  seed: number;
  tick: number;
  rng: () => number;
  config: WorldConfig;
  shard: Shard;
  millers: RoleEconomicSlot[];
  bakers: RoleEconomicSlot[];
  couriers: SupportRoleSlot[];
  journalists: SupportRoleSlot[];
  detectives: SupportRoleSlot[];
  grifters: GrifterSlot[];
  /** Monotonic counter for grifter ids — deterministic, not time-based. */
  nextGrifterId: number;
  flourPrice: number;
  population: number;
  economicHealth: number;
  /** Scoped to Miller+Baker only — the only two roles with a tracked `experience` field
   *  (support roles have no differentiated productivity mechanic to grow experience in). */
  economicHealthWithExperience: number;
  /** Gini coefficient over every identity-bearing player's wealth: all 5 roles' FILLED
   *  slots plus every grifter. Widened 2026-08-11 — see this file's header note. 0 when
   *  fewer than 2 people are tracked (nothing meaningful to compare). */
  wealthGini: number;
  /** Share of total tracked wealth held by the richest 10% of all tracked players, same scope. */
  wealthTop10Share: number;
  /** Per-district consolidation state, keyed by `District.id`. Every district starts ACTIVE;
   *  see `engine/districtConsolidation.ts`. A MERGED district's record stays in this map
   *  forever (constraint: shard ids/records only ever grow, nothing is ever deleted) — its
   *  buildings are logically, not physically, excluded from role assignment from then on. */
  districtHealth: Record<string, DistrictHealth>;
  /** Real emigrants this tick — exposed (rather than silently absorbed into `population`)
   *  so a multi-shard orchestrator can route them to an actual destination shard instead of
   *  having them vanish. See `sim/multiShardHarness.ts`. */
  lastEmigrants: number;
  /** Whether the flat brand-new-player arrival channel (`config.arrivalPDaily`) fired this
   *  tick (0 or 1) — kept distinct from cross-shard migration inflow, which arrives via
   *  `receiveMigrants()` instead. */
  lastNewArrivals: number;
  pendingWallPosts: WallPost[];
  lastRumourEvents: RumourEventLite[];
  lastSabotage: SabotageLogEntry | null;
}

/**
 * `population` here is intentionally the LIVE `world.population`, not the static
 * `config.targetPopulation` — a real, previously-flagged simplification (see HANDOVER.md's
 * "Things to know" history) fixed as part of this session's population-collapse work:
 * `fillHazard`'s `N-R` candidate-pool exponent should track how many people are actually
 * in the shard right now, not a fixed target that stays wrong for as long as real
 * population sits away from it (which is precisely the collapsed/recovering state this
 * whole mechanism now spends most of its time in).
 */
function vacancyParamsFor(R: number, population: number, pMonthly: number, config: WorldConfig): VacancyParams {
  return {
    N: population,
    R,
    pDaily: dailyChurnFromMonthly(pMonthly),
    beta: config.vacancy?.beta ?? VACANCY_DEFAULTS.beta,
    tPain: config.vacancy?.tPain ?? VACANCY_DEFAULTS.tPain,
    vBoost: config.vacancy?.vBoost ?? VACANCY_DEFAULTS.vBoost,
    tFlag: config.vacancy?.tFlag ?? VACANCY_DEFAULTS.tFlag,
    tHard: config.vacancy?.tHard ?? VACANCY_DEFAULTS.tHard,
    backstoppedRecoveryHazard: config.vacancy?.backstoppedRecoveryHazard,
  };
}

/**
 * District-aware assignment across all 5 roles (2026-08-11, replacing the old "first
 * rMiller+rBaker buildings in generation order" approach, which wasn't district-aware at
 * all — every role clustered into whichever districts happened to be generated first).
 * Walks every building in shard-generation (district-by-district) order, round-robining a
 * cursor across `ROLE_TYPES` so each role's slots are spread across the district sequence
 * roughly in proportion to its share of the total — "roles required locally," not just
 * globally. A deterministic, simple, testable policy; not claimed to be the only possible
 * one — see docs/BLUEPRINT.md's "5-role roster" entry.
 */
function assignRoleBuildings(shard: Shard, roleCounts: Record<RoleType, number>): Record<RoleType, Building[]> {
  const totalRoles = ROLE_TYPES.reduce((sum, r) => sum + roleCounts[r], 0);
  const totalBuildings = shard.districts.reduce((sum, d) => sum + d.buildings.length, 0);
  if (totalBuildings < totalRoles) {
    throw new Error(
      `shard has ${totalBuildings} buildings, but ${ROLE_TYPES.map((r) => `${r}=${roleCounts[r]}`).join('+')} = ${totalRoles} role slots requested — increase the shard config's building counts or lower the role counts`,
    );
  }

  const remaining: Record<RoleType, number> = { ...roleCounts };
  const result: Record<RoleType, Building[]> = { miller: [], baker: [], courier: [], journalist: [], detective: [] };

  let cursor = 0;
  let assigned = 0;
  for (const district of shard.districts) {
    for (const building of district.buildings) {
      if (assigned >= totalRoles) break;
      let attempts = 0;
      while (remaining[ROLE_TYPES[cursor % ROLE_TYPES.length]!] <= 0 && attempts < ROLE_TYPES.length) {
        cursor += 1;
        attempts += 1;
      }
      const role = ROLE_TYPES[cursor % ROLE_TYPES.length]!;
      if (remaining[role]! > 0) {
        result[role].push(building);
        remaining[role]! -= 1;
        assigned += 1;
        cursor += 1;
      }
    }
  }

  return result;
}

export function createWorld(seed: number, config: WorldConfig = DEFAULT_WORLD_CONFIG): World {
  const rng = mulberry32(seed);
  const shard = generateShardLayout(seed, config.shardConfig);
  const roleCounts: Record<RoleType, number> = {
    miller: config.rMiller,
    baker: config.rBaker,
    courier: config.rCourier,
    journalist: config.rJournalist,
    detective: config.rDetective,
  };
  const assigned = assignRoleBuildings(shard, roleCounts);

  // Bind buildings to their role slot — space.ts's own building.roleSlotRef, resolved here.
  // Mutates the just-generated shard's building objects in place — acceptable only
  // because this shard isn't shared with anything yet at construction time; stepWorld()
  // below never mutates an already-returned world's shard the same way.
  for (const shardDistrict of shard.districts) {
    for (const building of shardDistrict.buildings) {
      for (const role of ROLE_TYPES) {
        const idx = assigned[role].indexOf(building);
        if (idx >= 0) building.roleSlotRef = `${role}-${idx}`;
      }
    }
  }

  const millers: RoleEconomicSlot[] = assigned.miller.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.3 + rng() * 0.2, // matches initMarket's own initial-quantity draw
    experience: EXPERIENCE_CAP, // "start maxed, established shard" — matches ecosystemHarness's convention
    wealth: 0,
  }));
  const bakers: RoleEconomicSlot[] = assigned.baker.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.5 + rng() * 0.2, // matches initMarket's own initial-price draw
    experience: EXPERIENCE_CAP,
    wealth: 0,
  }));
  const couriers: SupportRoleSlot[] = assigned.courier.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0 }));
  const journalists: SupportRoleSlot[] = assigned.journalist.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0 }));
  const detectives: SupportRoleSlot[] = assigned.detective.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0 }));

  const supply = millers.reduce((a, m) => a + m.value, 0);
  const flourPriceValue = computeFlourPrice(supply);
  const totalRoleSlots = config.rMiller + config.rBaker + config.rCourier + config.rJournalist + config.rDetective;
  const avgExp = EXPERIENCE_CAP;

  const grifterCount = Math.max(0, config.targetPopulation - totalRoleSlots);
  const grifters: GrifterSlot[] = Array.from({ length: grifterCount }, (_, i) => ({
    id: `grifter-${i}`,
    wealth: 0,
    daysAsGrifter: 0,
  }));

  const districtHealth: Record<string, DistrictHealth> = {};
  for (const d of shard.districts) districtHealth[d.id] = initialDistrictHealth();

  return {
    seed,
    tick: 0,
    rng,
    config,
    shard,
    millers,
    bakers,
    couriers,
    journalists,
    detectives,
    grifters,
    nextGrifterId: grifterCount,
    flourPrice: flourPriceValue,
    population: config.targetPopulation,
    economicHealth: economicHealth(totalRoleSlots, totalRoleSlots), // all FILLED at creation
    economicHealthWithExperience: economicHealthWithExperience(millers.length + bakers.length, avgExp, config.rMiller + config.rBaker),
    wealthGini: 0, // everyone starts at 0 wealth — perfect equality, honestly
    wealthTop10Share: 0,
    districtHealth,
    lastEmigrants: 0,
    lastNewArrivals: 0,
    pendingWallPosts: [],
    lastRumourEvents: [],
    lastSabotage: null,
  };
}

/**
 * A newly-opened shard with no world yet — "everything else on your second empty shard
 * goes into automated economic stability until a new player lands." Reuses `createWorld`'s
 * geography/role-slot layout, then vacates every role slot and clears population/grifters —
 * no new "dormant mode" is needed inside `stepWorld` itself: a world with 0 population and
 * every slot VACANT already behaves as mechanically stable (BACKSTOPPED coverage kicks in
 * via the ordinary vacancy timers, <2 FILLED already freezes the competitive layer) for
 * free, from behavior that was already correct. See `sim/multiShardHarness.ts`.
 */
export function createDormantWorld(seed: number, config: WorldConfig): World {
  const w = createWorld(seed, config);
  const vacantizeRole = <T extends { slot: RoleSlot }>(arr: T[]): T[] =>
    arr.map((s) => ({ ...s, slot: { state: 'VACANT' as const, vacantSince: 0 } }));
  const totalRoleSlots = config.rMiller + config.rBaker + config.rCourier + config.rJournalist + config.rDetective;
  return {
    ...w,
    millers: vacantizeRole(w.millers),
    bakers: vacantizeRole(w.bakers),
    couriers: vacantizeRole(w.couriers),
    journalists: vacantizeRole(w.journalists),
    detectives: vacantizeRole(w.detectives),
    grifters: [],
    nextGrifterId: 0,
    population: 0,
    economicHealth: economicHealth(0, totalRoleSlots),
    economicHealthWithExperience: 0,
    wealthGini: 0,
    wealthTop10Share: 0,
  };
}

/**
 * Injects `count` real migrants (from another shard, via a multi-shard orchestrator) as
 * new grifters — they arrive roleless, same as any other fresh arrival, and take their
 * place in the ordinary vacancy/conscription cycle from the next tick on.
 */
export function receiveMigrants(world: World, count: number): World {
  if (count <= 0) return world;
  let grifters = world.grifters;
  let nextGrifterId = world.nextGrifterId;
  for (let i = 0; i < count; i++) {
    grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0 }];
    nextGrifterId += 1;
  }
  return { ...world, grifters, nextGrifterId, population: world.population + count };
}

/**
 * Runs Cournot/Bertrand competition among only the currently-FILLED slots, freezing every
 * other slot's `value`. A real, found contradiction (documented in docs/BLUEPRINT.md's
 * "Phase B" entry, not silently papered over): `stepMillers`/`stepBakers` both require at
 * least 2 array entries — vacancy.ts's semi-Markov process makes zero or one FILLED slot
 * a perfectly ordinary outcome, especially at small role counts, with no natural
 * "who do they compete against" answer below 2. Resolved here as: fewer than 2 FILLED
 * slots means no competition happens that day (every slot's value freezes, same as a
 * VACANT/BACKSTOPPED slot already does) — reads naturally as "no rival, no Cournot/
 * Bertrand step," not as an error, and never throws regardless of role-slot configuration.
 */
function stepCompetitiveLayer(
  slots: RoleEconomicSlot[],
  justFilled: Set<string>,
  competitor: (values: number[]) => number[],
  freshDraw: () => number,
): RoleEconomicSlot[] {
  const filledIndices = slots.map((s, i) => (s.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
  const filledValues = filledIndices.map((i) => slots[i]!.value);
  const nextFilledValues = filledValues.length >= 2 ? competitor(filledValues) : filledValues;

  return slots.map((s, i) => {
    const wasJustFilled = justFilled.has(s.buildingId);
    if (wasJustFilled) {
      // wealth resets too — a new occupant inherits nothing from whoever held this slot
      // before. Income for this same day still accrues afterward, in stepWorld's market
      // stage, once flourPrice is known.
      return { ...s, value: freshDraw(), experience: 0, wealth: 0 };
    }
    const filledPos = filledIndices.indexOf(i);
    if (filledPos >= 0) {
      return { ...s, value: nextFilledValues[filledPos]!, experience: growExperience(s.experience) };
    }
    return s; // VACANT or BACKSTOPPED and not newly filled: value, experience, and wealth all frozen
  });
}

/**
 * Aggregate Miller supply feeding `flourPrice()` — FILLED slots contribute their own
 * competed-for `value`; BACKSTOPPED slots contribute `BACKSTOP_PRODUCTIVITY` mechanically
 * (reusing ecosystem.ts's own constant, not a separate invented one — see the doc comment
 * at its call site in `stepWorld`); VACANT slots contribute nothing. This is the specific
 * "a BACKSTOPPED or conscripted Miller must actually participate in pricing" requirement
 * the Observatory spec names — exported standalone so it's directly testable without
 * needing to reverse-engineer it from a full `stepWorld` tick.
 */
export function computeMillerSupply(millers: RoleEconomicSlot[]): number {
  return millers.reduce((total, m) => {
    if (m.slot.state === 'FILLED') return total + m.value;
    if (m.slot.state === 'BACKSTOPPED') return total + BACKSTOP_PRODUCTIVITY;
    return total;
  }, 0);
}

function buildProximityGraph(occupants: PlayerPosition[], maxRange: number): ConnectionGraph {
  const graph = new ConnectionGraph();
  for (let i = 0; i < occupants.length; i++) {
    for (let j = i + 1; j < occupants.length; j++) {
      const a = occupants[i]!;
      const b = occupants[j]!;
      const closeness = proximityCloseness(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), maxRange);
      if (closeness !== null) graph.connect(a.playerId, b.playerId, closeness);
    }
  }
  return graph;
}

interface RoleArrays {
  millers: RoleEconomicSlot[];
  bakers: RoleEconomicSlot[];
  couriers: SupportRoleSlot[];
  journalists: SupportRoleSlot[];
  detectives: SupportRoleSlot[];
}

/** Every currently-FILLED slot across all 5 roles, with enough to identify and evict it. */
function filledEntries(arrays: RoleArrays): { role: RoleType; index: number; buildingId: string }[] {
  const out: { role: RoleType; index: number; buildingId: string }[] = [];
  arrays.millers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'miller', index: i, buildingId: s.buildingId });
  });
  arrays.bakers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'baker', index: i, buildingId: s.buildingId });
  });
  arrays.couriers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'courier', index: i, buildingId: s.buildingId });
  });
  arrays.journalists.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'journalist', index: i, buildingId: s.buildingId });
  });
  arrays.detectives.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'detective', index: i, buildingId: s.buildingId });
  });
  return out;
}

/** One deterministic tick. See this file's header comment for the pinned stage order. */
export function stepWorld(world: World): World {
  const { rng, config } = world;
  const day = world.tick;

  // ---- Stage 1: space/occupancy -----------------------------------------------------
  // A pure derivation from current role-slot state, not a stateful process of its own —
  // no synthetic drivers exist yet (Phase C) to actually move anyone. Recomputes each
  // building's occupant position (its own plot, static) and feeds district population.
  const allBuildingsById = new Map(world.shard.districts.flatMap((d) => d.buildings).map((b) => [b.id, b]));
  const occupantsOf = (slots: { slot: RoleSlot; buildingId: string }[]): PlayerPosition[] =>
    slots
      .filter((s) => s.slot.state === 'FILLED')
      .map((s) => {
        const b = allBuildingsById.get(s.buildingId)!;
        return { playerId: s.buildingId, x: b.x, y: b.y };
      });

  // ---- Stage 1b: district health (2026-08-11) ----------------------------------------
  // Underpopulation-triggered, irreversible per district — see districtConsolidation.ts's
  // header for the full reasoning. Stepped from the INCOMING (pre-tick) role-slot state,
  // so a district that flips to MERGED today already excludes its slots from today's own
  // conscription pass below, same same-day-cascading discipline as everything else here.
  const buildingDistrictId = new Map<string, string>();
  for (const d of world.shard.districts) {
    for (const b of d.buildings) buildingDistrictId.set(b.id, d.id);
  }
  const allRoleSlotsForHealth: { buildingId: string; slot: RoleSlot }[] = [
    ...world.millers,
    ...world.bakers,
    ...world.couriers,
    ...world.journalists,
    ...world.detectives,
  ];
  const districtHealth: Record<string, DistrictHealth> = {};
  const newlyMergedDistrictIds: string[] = [];
  for (const d of world.shard.districts) {
    const districtSlots = allRoleSlotsForHealth.filter((s) => buildingDistrictId.get(s.buildingId) === d.id);
    const filledCount = districtSlots.filter((s) => s.slot.state === 'FILLED').length;
    const fraction = districtFilledFraction(filledCount, districtSlots.length);
    const prevHealth = world.districtHealth[d.id] ?? initialDistrictHealth();
    const nextHealth = stepDistrictHealth(prevHealth, fraction, day);
    districtHealth[d.id] = nextHealth;
    if (prevHealth.state !== 'MERGED' && nextHealth.state === 'MERGED') newlyMergedDistrictIds.push(d.id);
  }

  // ---- Stage 2: vacancy and conscription (all 5 roles + grifter pool) ----------------
  let millers = world.millers;
  let bakers = world.bakers;
  let couriers = world.couriers;
  let journalists = world.journalists;
  let detectives = world.detectives;
  let grifters = world.grifters;
  let nextGrifterId = world.nextGrifterId;

  // A district crossing into MERGED today evicts every role-holder physically in it —
  // "excess players" pushed into the grifter pool with a hard consolidationDeadline (the
  // district's own grace period, so "2 weeks to gain a role or be drafted" lands on the
  // same calendar the district itself just finished counting down). Their buildings are
  // logically excluded from every future conscription pass below (never physically
  // spliced from shard.districts — see districtConsolidation.ts's header).
  if (newlyMergedDistrictIds.length > 0) {
    const isInMergedDistrict = (buildingId: string) => newlyMergedDistrictIds.includes(buildingDistrictId.get(buildingId)!);
    const evictWithDeadline = <T extends { slot: RoleSlot; buildingId: string }>(arr: T[]): T[] =>
      arr.map((s) => {
        if (s.slot.state === 'FILLED' && isInMergedDistrict(s.buildingId)) {
          grifters = [
            ...grifters,
            { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0, consolidationDeadline: day + CONSOLIDATION_GRACE_DAYS },
          ];
          nextGrifterId += 1;
          return { ...s, slot: { state: 'VACANT' as const, vacantSince: day } };
        }
        return s;
      });
    millers = evictWithDeadline(millers);
    bakers = evictWithDeadline(bakers);
    couriers = evictWithDeadline(couriers);
    journalists = evictWithDeadline(journalists);
    detectives = evictWithDeadline(detectives);
  }

  // A MERGED district's slots are NOT permanently excluded from ordinary refilling —
  // deliberately reverted from an earlier version of this change that did exclude them,
  // once testing showed it over a long enough run collapses every role slot toward zero
  // with nowhere for that capacity to go (contradicts "combine into half the shard,"
  // which concentrates capacity, not deletes it; also contradicts constraint 2, no
  // permanent zero-state, applied to the whole shard's economy). A MERGED district's
  // buildings stay part of the ordinary vacancy/conscription pool going forward — the
  // real, lasting consequence of a merge is the one-time eviction above plus the
  // permanent friction floor on income (Stage 3 below), not a capacity cliff. Physically
  // relocating a merged district's buildings into a surviving district's geography is a
  // larger change (real building reassignment, not just a state flag) deliberately left
  // for a later pass — flagged in docs/BLUEPRINT.md, not silently narrowed.
  function justFilledSet(before: { slot: RoleSlot; buildingId: string }[], afterSlots: RoleSlot[]): Set<string> {
    const s = new Set<string>();
    before.forEach((b, i) => {
      if (b.slot.state !== 'FILLED' && afterSlots[i]!.state === 'FILLED') s.add(b.buildingId);
    });
    return s;
  }

  const roleGroupsIn: RoleGroupState[] = [
    { roleId: 'miller', slots: millers.map((m) => m.slot), params: vacancyParamsFor(config.rMiller, world.population, config.pMonthly, config) },
    { roleId: 'baker', slots: bakers.map((b) => b.slot), params: vacancyParamsFor(config.rBaker, world.population, config.pMonthly, config) },
    { roleId: 'courier', slots: couriers.map((c) => c.slot), params: vacancyParamsFor(config.rCourier, world.population, config.pMonthly, config) },
    { roleId: 'journalist', slots: journalists.map((j) => j.slot), params: vacancyParamsFor(config.rJournalist, world.population, config.pMonthly, config) },
    { roleId: 'detective', slots: detectives.map((d) => d.slot), params: vacancyParamsFor(config.rDetective, world.population, config.pMonthly, config) },
  ];
  const conscriptionResult = stepMultiRoleConscriptionDay(roleGroupsIn, grifters.length, day, config.conscriptionDelay, rng);
  const byRole = new Map(conscriptionResult.roleGroups.map((g) => [g.roleId, g.slots] as const));

  const millerJustFilled = justFilledSet(millers, byRole.get('miller')!);
  const bakerJustFilled = justFilledSet(bakers, byRole.get('baker')!);
  const courierJustFilled = justFilledSet(couriers, byRole.get('courier')!);
  const journalistJustFilled = justFilledSet(journalists, byRole.get('journalist')!);
  const detectiveJustFilled = justFilledSet(detectives, byRole.get('detective')!);

  millers = millers.map((m, i) => ({ ...m, slot: byRole.get('miller')![i]! }));
  bakers = bakers.map((b, i) => ({ ...b, slot: byRole.get('baker')![i]! }));
  couriers = couriers.map((c, i) => {
    const slot = byRole.get('courier')![i]!;
    return courierJustFilled.has(c.buildingId) ? { ...c, slot, wealth: 0 } : { ...c, slot };
  });
  journalists = journalists.map((j, i) => {
    const slot = byRole.get('journalist')![i]!;
    return journalistJustFilled.has(j.buildingId) ? { ...j, slot, wealth: 0 } : { ...j, slot };
  });
  detectives = detectives.map((d, i) => {
    const slot = byRole.get('detective')![i]!;
    return detectiveJustFilled.has(d.buildingId) ? { ...d, slot, wealth: 0 } : { ...d, slot };
  });

  // Grifter pool bookkeeping: age everyone still waiting by one day, then apply today's
  // events in the exact order stepMultiRoleConscriptionDay produced them. A fill or
  // grifter-sourced conscription pops whoever has waited LONGEST — a real, simulate-able
  // policy (not left unspecified) that directly answers "the effect of grifters being
  // under the floor until they obtain a role."
  grifters = grifters.map((g) => ({ ...g, daysAsGrifter: g.daysAsGrifter + 1 }));
  for (const event of conscriptionResult.events) {
    if (event.type === 'churn') {
      grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0 }];
      nextGrifterId += 1;
    } else if (event.type === 'genuineFill' || event.type === 'conscriptionFromGrifters') {
      if (grifters.length > 0) {
        let longestIdx = 0;
        for (let i = 1; i < grifters.length; i++) {
          if (grifters[i]!.daysAsGrifter > grifters[longestIdx]!.daysAsGrifter) longestIdx = i;
        }
        grifters = grifters.filter((_, i) => i !== longestIdx);
      }
    }
    // conscriptionFromOtherRole / backstopFires: no grifter-pool change — that player
    // moves directly between roles, or the slot stays mechanically covered.
  }

  // Forced 2-week deadline draft (2026-08-11): any grifter whose consolidation window has
  // expired must be placed into an open role today if one exists anywhere — "2 weeks to
  // gain a role or be drafted." Runs AFTER ordinary conscription above (so a
  // self-selected voluntary fill during the 2 weeks always takes priority) and bypasses
  // the ordinary probabilistic machinery entirely — this is a hard deadline, not another
  // hazard roll. Excess overdue grifters beyond however many slots are open simply stay
  // overdue (their deadline has already passed, so they claim the very next slot that
  // opens, on any future tick, with no re-arming needed) — not a permanent-zero-state
  // violation, since GRIFTER_DAILY_INCOME keeps accruing to them meanwhile.
  const overdue = grifters.filter((g) => g.consolidationDeadline !== undefined && day >= g.consolidationDeadline);
  if (overdue.length > 0) {
    const openSlots: { role: RoleType; index: number }[] = [];
    millers.forEach((m, i) => {
      if (m.slot.state === 'VACANT') openSlots.push({ role: 'miller', index: i });
    });
    bakers.forEach((b, i) => {
      if (b.slot.state === 'VACANT') openSlots.push({ role: 'baker', index: i });
    });
    couriers.forEach((c, i) => {
      if (c.slot.state === 'VACANT') openSlots.push({ role: 'courier', index: i });
    });
    journalists.forEach((j, i) => {
      if (j.slot.state === 'VACANT') openSlots.push({ role: 'journalist', index: i });
    });
    detectives.forEach((d, i) => {
      if (d.slot.state === 'VACANT') openSlots.push({ role: 'detective', index: i });
    });

    const placedGrifterIds = new Set<string>();
    const placeCount = Math.min(overdue.length, openSlots.length);
    for (let k = 0; k < placeCount; k++) {
      const grifter = overdue[k]!;
      const target = openSlots[k]!;
      placedGrifterIds.add(grifter.id);
      const fill = { state: 'FILLED' as const, vacantSince: null };
      if (target.role === 'miller') {
        millers = millers.map((m, i) => (i === target.index ? { ...m, slot: fill, value: 0.3 + rng() * 0.2, experience: 0, wealth: 0 } : m));
      } else if (target.role === 'baker') {
        bakers = bakers.map((b, i) => (i === target.index ? { ...b, slot: fill, value: 0.5 + rng() * 0.2, experience: 0, wealth: 0 } : b));
      } else if (target.role === 'courier') {
        couriers = couriers.map((c, i) => (i === target.index ? { ...c, slot: fill, wealth: 0 } : c));
      } else if (target.role === 'journalist') {
        journalists = journalists.map((j, i) => (i === target.index ? { ...j, slot: fill, wealth: 0 } : j));
      } else {
        detectives = detectives.map((d, i) => (i === target.index ? { ...d, slot: fill, wealth: 0 } : d));
      }
    }
    if (placedGrifterIds.size > 0) grifters = grifters.filter((g) => !placedGrifterIds.has(g.id));
  }

  // ---- Stage 3: market (Miller then Baker, then support-role wage + grifter floor) ---
  const noise = () => gaussian(rng, config.noiseSigma);
  millers = stepCompetitiveLayer(
    millers,
    millerJustFilled,
    (values) => stepMillers(values, noise),
    () => 0.3 + rng() * 0.2,
  );

  // BACKSTOPPED millers participate mechanically, not competitively — this is the
  // specific unwired gap the spec named. See computeMillerSupply()'s doc comment.
  const millerSupply = computeMillerSupply(millers);
  const flourPriceValue = computeFlourPrice(millerSupply);

  bakers = stepCompetitiveLayer(
    bakers,
    bakerJustFilled,
    (values) => stepBakers(values, flourPriceValue, config.gamma, noise),
    () => 0.5 + rng() * 0.2,
  );

  // Wealth accrual (2026-08-10, user-requested; demand model + downtime window revised
  // 2026-08-11; support-role wage + grifter floor added 2026-08-11) — the stock variable
  // wealth.ts adds on top of the market's existing flow variables. A Miller sells its whole
  // quantity at the market-clearing flour price. A Baker earns margin-over-flour-cost times
  // however many customers it actually served today — served-customer counts come from
  // splitBakerDemand(), which bounds total daily demand by population (not baker count),
  // dilutes it by a multi-day purchase cycle, splits it toward whoever's priced lower, and
  // caps any one baker's daily customers at a realistic ceiling. BACKSTOPPED slots earn
  // nothing — nobody is there to receive it. Every income stream is scaled by
  // DAILY_ACTIVITY_MULTIPLIER — the daily blended consequence of an 8-hour low-activity
  // window every day, "all round." See wealth.ts's header for the full reasoning.
  //
  // Trade-route friction (2026-08-11) — "underpopulated areas can't access certain
  // services without greater effort": a role-holder physically in a CONSOLIDATING or
  // MERGED district earns proportionally less, ramping down across the district's own
  // grace period. This is the "cracks forming" made felt, not just visible — real pressure
  // to relocate into the consolidated half before being forced to, and grifters have no
  // fixed position in this model (same flagged simplification as everywhere else in this
  // file) so friction only applies to role-holders with a building, not the grifter floor.
  const frictionFor = (buildingId: string): number => {
    const districtId = buildingDistrictId.get(buildingId);
    if (!districtId) return 1;
    return consolidationFrictionMultiplier(districtHealth[districtId]!, day);
  };

  const millerIncomes = millers.map((m) =>
    m.slot.state === 'FILLED' ? millerDailyIncome(m.value, flourPriceValue) * DAILY_ACTIVITY_MULTIPLIER * frictionFor(m.buildingId) : 0,
  );

  const bakerFilledForDemand = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
  const dueCustomers =
    config.purchaseCycleDays !== undefined
      ? dailyDueCustomers(world.population, config.purchaseCycleDays)
      : dailyDueCustomers(world.population);
  const servedCustomers = splitBakerDemand(
    bakerFilledForDemand.map((i) => bakers[i]!.value),
    dueCustomers,
  );
  const bakerIncomes = bakers.map((b, i) => {
    const pos = bakerFilledForDemand.indexOf(i);
    if (pos < 0) return 0;
    return bakerDailyIncome(b.value, flourPriceValue, servedCustomers[pos]!) * DAILY_ACTIVITY_MULTIPLIER * frictionFor(b.buildingId);
  });

  // Income is computed as a flow first (0 for non-FILLED slots), optionally taxed and
  // redistributed across the combined Miller+Baker FILLED pool (one shared pool, not two
  // separate ones — matches "daily resource allocation" as untargeted and unconditional),
  // THEN accrued onto wealth. The wealth cap, if enabled, then bounds the resulting stock.
  // Both are PROPOSALS, simulated and reported in docs/BLUEPRINT.md, neither shipped as a
  // default, and deliberately scoped to Miller+Baker only — see this file's header note.
  let finalMillerIncomes = millerIncomes;
  let finalBakerIncomes = bakerIncomes;
  if (config.wealthTaxRate > 0) {
    const millerFilledIdx = millers.map((m, i) => (m.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const bakerFilledIdx = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const combinedIncomes = [...millerFilledIdx.map((i) => millerIncomes[i]!), ...bakerFilledIdx.map((i) => bakerIncomes[i]!)];
    if (combinedIncomes.length > 0) {
      const afterTax = taxAndRedistributeIncome(combinedIncomes, config.wealthTaxRate);
      finalMillerIncomes = [...millerIncomes];
      finalBakerIncomes = [...bakerIncomes];
      millerFilledIdx.forEach((idx, k) => {
        finalMillerIncomes[idx] = afterTax[k]!;
      });
      bakerFilledIdx.forEach((idx, k) => {
        finalBakerIncomes[idx] = afterTax[millerFilledIdx.length + k]!;
      });
    }
  }

  millers = millers.map((m, i) => (m.slot.state === 'FILLED' ? { ...m, wealth: m.wealth + finalMillerIncomes[i]! } : m));
  bakers = bakers.map((b, i) => (b.slot.state === 'FILLED' ? { ...b, wealth: b.wealth + finalBakerIncomes[i]! } : b));

  if (config.wealthCap !== undefined) {
    const millerFilledIdx = millers.map((m, i) => (m.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const bakerFilledIdx = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const combinedWealth = [...millerFilledIdx.map((i) => millers[i]!.wealth), ...bakerFilledIdx.map((i) => bakers[i]!.wealth)];
    if (combinedWealth.length > 0) {
      const capped = applyWealthCap(combinedWealth, config.wealthCap);
      millers = millers.map((m, i) => {
        const pos = millerFilledIdx.indexOf(i);
        return pos >= 0 ? { ...m, wealth: capped[pos]! } : m;
      });
      bakers = bakers.map((b, i) => {
        const pos = bakerFilledIdx.indexOf(i);
        return pos >= 0 ? { ...b, wealth: capped[millerFilledIdx.length + pos]! } : b;
      });
    }
  }

  // Support-role wage and grifter floor — uncapped, untaxed (see header scoping note).
  // Support wages get the same trade-route friction as Miller/Baker; the grifter floor
  // doesn't (grifters have no fixed position — see frictionFor's own comment above).
  const supportDaily = SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER;
  couriers = couriers.map((c) => (c.slot.state === 'FILLED' ? { ...c, wealth: c.wealth + supportDaily * frictionFor(c.buildingId) } : c));
  journalists = journalists.map((j) => (j.slot.state === 'FILLED' ? { ...j, wealth: j.wealth + supportDaily * frictionFor(j.buildingId) } : j));
  detectives = detectives.map((d) => (d.slot.state === 'FILLED' ? { ...d, wealth: d.wealth + supportDaily * frictionFor(d.buildingId) } : d));
  grifters = grifters.map((g) => ({ ...g, wealth: g.wealth + GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER }));

  // ---- Stage 4: ecosystem (sabotage -> arrivals -> migration, then health/experience) --
  // Sabotage-before-arrival order matches design/tick_order_check.py's own validated
  // finding — checked before choosing this order, not reinvented.
  let population = world.population;
  let lastSabotage: SabotageLogEntry | null = null;

  if (day > 0 && day % config.sabotageCadenceDays === 0) {
    const filled = filledEntries({ millers, bakers, couriers, journalists, detectives });
    if (filled.length > 0) {
      const targetIdx = Math.floor(rng() * filled.length);
      const target = filled[targetIdx]!;
      const targetBuilding = allBuildingsById.get(target.buildingId)!;

      const occupants = [
        ...occupantsOf(millers),
        ...occupantsOf(bakers),
        ...occupantsOf(couriers),
        ...occupantsOf(journalists),
        ...occupantsOf(detectives),
      ].filter((o) => o.playerId !== target.buildingId);
      const witnesses = occupantsWithin(world.shard, occupants, targetBuilding, config.witnessRadius).length;

      const successfulSaboteurs = sabotageAttempt(config.saboteurCount, config.acquireDays, detectionProbability(witnesses), rng);
      const remainingAfterDamage = applySabotageDamage(filled.length, successfulSaboteurs, config.damagePerSuccess);
      const evictCount = filled.length - remainingAfterDamage;

      if (evictCount > 0) {
        const evictable = [...filled];
        for (let k = 0; k < evictCount; k++) {
          const pick = Math.floor(rng() * evictable.length);
          const chosen = evictable.splice(pick, 1)[0]!;
          // Evicted to BACKSTOPPED, and rejoins the grifter pool — sabotage costs someone
          // their role, not their place in the population (same framing as ordinary churn).
          grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0 }];
          nextGrifterId += 1;
          const evict = { state: 'BACKSTOPPED' as const, vacantSince: day };
          if (chosen.role === 'miller') millers = millers.map((m, i) => (i === chosen.index ? { ...m, slot: evict } : m));
          else if (chosen.role === 'baker') bakers = bakers.map((b, i) => (i === chosen.index ? { ...b, slot: evict } : b));
          else if (chosen.role === 'courier') couriers = couriers.map((c, i) => (i === chosen.index ? { ...c, slot: evict } : c));
          else if (chosen.role === 'journalist') journalists = journalists.map((j, i) => (i === chosen.index ? { ...j, slot: evict } : j));
          else detectives = detectives.map((d, i) => (i === chosen.index ? { ...d, slot: evict } : d));
        }
      }

      lastSabotage = { tick: day, targetBuildingId: target.buildingId, witnesses, successfulSaboteurs, evicted: evictCount };
    }
  }

  let lastNewArrivals = 0;
  if (rng() < config.arrivalPDaily) {
    population += 1;
    lastNewArrivals = 1;
    grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0 }];
    nextGrifterId += 1;
  }

  const preEmigrationFilledCount = filledEntries({ millers, bakers, couriers, journalists, detectives }).length;
  const emigrants = migrationValveStep(population, preEmigrationFilledCount, rng, config.migrationTheta, config.migrationK);
  const actualEmigrants = Math.min(emigrants, population);
  for (let k = 0; k < actualEmigrants; k++) {
    if (grifters.length > 0) {
      // Emigration draws from the grifter pool first — someone with no role yet is the
      // least invested, and this is what keeps population exactly conserved without ever
      // touching a role-holder's slot unless there's truly nobody roleless left to leave.
      const idx = Math.floor(rng() * grifters.length);
      grifters = grifters.filter((_, i) => i !== idx);
    } else {
      const filled = filledEntries({ millers, bakers, couriers, journalists, detectives });
      if (filled.length > 0) {
        const pick = filled[Math.floor(rng() * filled.length)]!;
        const vacate = { state: 'VACANT' as const, vacantSince: day };
        if (pick.role === 'miller') millers = millers.map((m, i) => (i === pick.index ? { ...m, slot: vacate } : m));
        else if (pick.role === 'baker') bakers = bakers.map((b, i) => (i === pick.index ? { ...b, slot: vacate } : b));
        else if (pick.role === 'courier') couriers = couriers.map((c, i) => (i === pick.index ? { ...c, slot: vacate } : c));
        else if (pick.role === 'journalist') journalists = journalists.map((j, i) => (i === pick.index ? { ...j, slot: vacate } : j));
        else detectives = detectives.map((d, i) => (i === pick.index ? { ...d, slot: vacate } : d));
      }
    }
  }
  population = Math.max(0, population - actualEmigrants);

  const totalRoleSlots = config.rMiller + config.rBaker + config.rCourier + config.rJournalist + config.rDetective;
  const finalFilledCount = filledEntries({ millers, bakers, couriers, journalists, detectives }).length;
  const filledExpValues = [...millers, ...bakers].filter((x) => x.slot.state === 'FILLED').map((x) => x.experience);
  const avgExp = filledExpValues.length > 0 ? filledExpValues.reduce((a, b) => a + b, 0) / filledExpValues.length : 0;

  // Wealth-inequality scope widened (2026-08-11) — see this file's header note.
  const allWealthValues = [
    ...millers.filter((m) => m.slot.state === 'FILLED').map((m) => m.wealth),
    ...bakers.filter((b) => b.slot.state === 'FILLED').map((b) => b.wealth),
    ...couriers.filter((c) => c.slot.state === 'FILLED').map((c) => c.wealth),
    ...journalists.filter((j) => j.slot.state === 'FILLED').map((j) => j.wealth),
    ...detectives.filter((d) => d.slot.state === 'FILLED').map((d) => d.wealth),
    ...grifters.map((g) => g.wealth),
  ];

  // ---- Stage 5: comms (rumour propagation) ------------------------------------------
  let lastRumourEvents: RumourEventLite[] = [];
  if (world.pendingWallPosts.length > 0) {
    const occupants = [
      ...occupantsOf(millers),
      ...occupantsOf(bakers),
      ...occupantsOf(couriers),
      ...occupantsOf(journalists),
      ...occupantsOf(detectives),
    ];
    const graph = buildProximityGraph(occupants, config.commsProximityRange);
    for (const post of world.pendingWallPosts) {
      for (const { id: neighborId, weight } of graph.neighbors(post.authorId)) {
        const step = stepClarity(1, weight, { baseSuccessChance: 0.6, decayPerStep: 0.3, clarityFloor: 0.15 }, rng);
        if (!step.passed) continue;
        const { value: state, distorted } = applyDistortion(
          post.state,
          {
            distortionRate: 0.25,
            neighbors: {
              isolated: ['distrustful', 'overwhelmed'],
              manipulated: ['exploited', 'suspicious'],
              distrustful: ['suspicious', 'isolated'],
              exploited: ['manipulated', 'overwhelmed'],
              suspicious: ['distrustful', 'manipulated'],
              uneasy: ['suspicious', 'overwhelmed'],
              overwhelmed: ['uneasy', 'isolated'],
              hopeful: ['secure', 'grateful'],
              secure: ['hopeful', 'grateful'],
              grateful: ['hopeful', 'secure'],
            },
          },
          rng,
        );
        lastRumourEvents.push({ heardBy: neighborId, heardFrom: post.authorId, state, distorted, clarity: step.nextClarity });
      }
    }
  }

  return {
    ...world,
    tick: world.tick + 1,
    shard: world.shard, // static geography — Phase B doesn't move anyone (see header note)
    millers,
    bakers,
    couriers,
    journalists,
    detectives,
    grifters,
    nextGrifterId,
    flourPrice: flourPriceValue,
    population,
    economicHealth: economicHealth(finalFilledCount, totalRoleSlots),
    economicHealthWithExperience: economicHealthWithExperience(
      millers.filter((m) => m.slot.state === 'FILLED').length + bakers.filter((b) => b.slot.state === 'FILLED').length,
      avgExp,
      config.rMiller + config.rBaker,
    ),
    // giniCoefficient/topShare both return 0 for an empty array — 0 tracked players reads
    // as "no meaningful comparison," not an error.
    wealthGini: giniCoefficient(allWealthValues),
    wealthTop10Share: topShare(allWealthValues, 0.1),
    districtHealth,
    lastEmigrants: actualEmigrants,
    lastNewArrivals,
    pendingWallPosts: [],
    lastRumourEvents,
    lastSabotage,
  };
}
