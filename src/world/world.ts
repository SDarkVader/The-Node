/**
 * Unified deterministic world kernel (Observatory build spec, Phase B). Composes the
 * three previously-separate models — Phase 1 market (`millers.ts`/`bakers.ts`), Phase 2
 * vacancy/conscription (`vacancy.ts`, `sim/conscriptionHarness.ts`), and the ecosystem
 * layer (`ecosystem.ts`) — into one `World` object and one `stepWorld()` tick, now sited
 * on real geography via Phase A's `space.ts`. Existing engine modules are called, not
 * reimplemented — `conscriptionHarness.ts` was refactored (2026-08-10, same commit) to
 * expose `stepConscriptionDay()` specifically so this file could reuse its Miller
 * conscription logic verbatim instead of duplicating it.
 *
 * TICK ORDER (pinned by `test/world.regression.test.ts`'s determinism/order test — do not
 * reorder without updating both): space/occupancy -> vacancy and conscription -> market
 * (Miller then Baker) -> ecosystem (sabotage, arrivals, migration, health, experience) ->
 * comms (rumour propagation). Matches the Observatory spec's given order exactly. Within
 * the ecosystem stage, sabotage is applied BEFORE arrivals, per `design/
 * tick_order_check.py`'s own validated finding ("shock BEFORE arrival" — the prior art the
 * spec explicitly said to check before choosing an order) — checked, not reinvented.
 *
 * DETERMINISM: `World.rng` is a single `mulberry32` closure created once in `createWorld`
 * and threaded through every `stepWorld` call via the returned `World`'s own field —
 * identical to how every existing harness in this repo (`vacancyHarness.ts`,
 * `ecosystemHarness.ts`, `conscriptionHarness.ts`) already threads one `rng` through a
 * whole run. This means `World` is not literally a plain JSON value (it carries a
 * function) — `stepWorld` is still deterministic given the same starting `World` (no
 * `Math.random()`, no external mutable state), but it is NOT the same thing as
 * `structuredClone(world)` producing an independently-steppable fork; two `World`s only
 * diverge by calling `createWorld` with a new seed. Phase D's snapshot contract will need
 * its own explicit projection from `World` to a serializable schema — deliberately not
 * attempted here, since a snapshot should not expose seed-continuation internals that
 * would let an observer predict future rolls anyway.
 *
 * SCOPE NOTE: only Miller and Baker are modeled as role types (matching every existing
 * harness's own convention — "the roles are arbitrary," an expanded roster is explicitly
 * not designed yet, see HANDOVER.md). District-level population tracks role-holders only
 * (Miller/Baker slots physically in that district); a persistent gossip-layer-per-district
 * population ledger is not built here — `placeArrival()` (Phase A) remains available but
 * unused by this tick, since Phase B's population model only tracks a global N. Weather
 * history stays empty — District Weather's actual tension value isn't computed by any
 * named phase of this task, only given somewhere to live (Phase A). Comms only propagates
 * `pendingWallPosts` — nothing in Phase B autonomously posts to the Wall (that's a driver
 * action, Phase C's job), so this stage is a real, tested mechanism that is a no-op in
 * practice until Phase C appends to that queue.
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
import { stepSlot, dailyChurnFromMonthly, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS as VACANCY_DEFAULTS } from '../sim/vacancyHarness.js';
import { stepConscriptionDay } from '../sim/conscriptionHarness.js';
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

export interface WorldConfig {
  shardConfig: ShardLayoutConfig;
  rMiller: number;
  rBaker: number;
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
}

// rMiller + rBaker = 24, matching ecosystem.ts's own S_DEFAULT — not an arbitrary choice.
// An earlier draft of this default used rMiller=3/rBaker=5 (8 total), which produced a
// roleless fraction of ~88% against targetPopulation=65 and drained population toward
// zero within ~25 ticks once migrationValveStep actually ran for the first time in a real
// composed tick. That was this file's own inconsistency, not a genuine module conflict —
// S_DEFAULT=24 against N=65 lands at ~63% roleless, inside migrationValveStep's own
// already-validated [55%, 68%] equilibrium band. See docs/BLUEPRINT.md's "Phase B" entry.
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  shardConfig: DEFAULT_SHARD_CONFIG,
  rMiller: 8,
  rBaker: 16,
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
};

export interface RoleEconomicSlot {
  slot: RoleSlot;
  buildingId: string;
  /** Miller: Cournot quantity. Baker: Bertrand price. Frozen while not FILLED. */
  value: number;
  /** Resets to 0 the moment a slot transitions into FILLED; frozen while VACANT/BACKSTOPPED. */
  experience: number;
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
  flourPrice: number;
  population: number;
  economicHealth: number;
  economicHealthWithExperience: number;
  pendingWallPosts: WallPost[];
  lastRumourEvents: RumourEventLite[];
  lastSabotage: SabotageLogEntry | null;
}

function vacancyParamsFor(rMiller: number, targetPopulation: number, pMonthly: number, config: WorldConfig): VacancyParams {
  return {
    N: targetPopulation,
    R: rMiller,
    pDaily: dailyChurnFromMonthly(pMonthly),
    beta: config.vacancy?.beta ?? VACANCY_DEFAULTS.beta,
    tPain: config.vacancy?.tPain ?? VACANCY_DEFAULTS.tPain,
    vBoost: config.vacancy?.vBoost ?? VACANCY_DEFAULTS.vBoost,
    tFlag: config.vacancy?.tFlag ?? VACANCY_DEFAULTS.tFlag,
    tHard: config.vacancy?.tHard ?? VACANCY_DEFAULTS.tHard,
    backstoppedRecoveryHazard: config.vacancy?.backstoppedRecoveryHazard,
  };
}

/** Assigns the first `rMiller` + `rBaker` buildings (generation order, deterministic) to roles. */
function assignRoleBuildings(shard: Shard, rMiller: number, rBaker: number): { millerBuildings: Building[]; bakerBuildings: Building[] } {
  const allBuildings = shard.districts.flatMap((d) => d.buildings);
  if (allBuildings.length < rMiller + rBaker) {
    throw new Error(
      `shard has ${allBuildings.length} buildings, but rMiller (${rMiller}) + rBaker (${rBaker}) = ${rMiller + rBaker} role slots requested — increase the shard config's building counts or lower rMiller/rBaker`,
    );
  }
  return {
    millerBuildings: allBuildings.slice(0, rMiller),
    bakerBuildings: allBuildings.slice(rMiller, rMiller + rBaker),
  };
}

export function createWorld(seed: number, config: WorldConfig = DEFAULT_WORLD_CONFIG): World {
  const rng = mulberry32(seed);
  const shard = generateShardLayout(seed, config.shardConfig);
  const { millerBuildings, bakerBuildings } = assignRoleBuildings(shard, config.rMiller, config.rBaker);

  // Bind buildings to their role slot — space.ts's own building.roleSlotRef, resolved here.
  // Mutates the just-generated shard's building objects in place — acceptable only
  // because this shard isn't shared with anything yet at construction time; stepWorld()
  // below never mutates an already-returned world's shard the same way.
  for (const shardDistrict of shard.districts) {
    for (const building of shardDistrict.buildings) {
      if (millerBuildings.includes(building)) building.roleSlotRef = `miller-${millerBuildings.indexOf(building)}`;
      else if (bakerBuildings.includes(building)) building.roleSlotRef = `baker-${bakerBuildings.indexOf(building)}`;
    }
  }

  const millers: RoleEconomicSlot[] = millerBuildings.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.3 + rng() * 0.2, // matches initMarket's own initial-quantity draw
    experience: EXPERIENCE_CAP, // "start maxed, established shard" — matches ecosystemHarness's convention
  }));
  const bakers: RoleEconomicSlot[] = bakerBuildings.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.5 + rng() * 0.2, // matches initMarket's own initial-price draw
    experience: EXPERIENCE_CAP,
  }));

  const supply = millers.reduce((a, m) => a + m.value, 0);
  const flourPriceValue = computeFlourPrice(supply);
  const s = config.rMiller + config.rBaker;
  const filled = millers.length + bakers.length; // all FILLED at creation
  const avgExp = EXPERIENCE_CAP;

  return {
    seed,
    tick: 0,
    rng,
    config,
    shard,
    millers,
    bakers,
    flourPrice: flourPriceValue,
    population: config.targetPopulation,
    economicHealth: economicHealth(filled, s),
    economicHealthWithExperience: economicHealthWithExperience(filled, avgExp, s),
    pendingWallPosts: [],
    lastRumourEvents: [],
    lastSabotage: null,
  };
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
      return { ...s, value: freshDraw(), experience: 0 };
    }
    const filledPos = filledIndices.indexOf(i);
    if (filledPos >= 0) {
      return { ...s, value: nextFilledValues[filledPos]!, experience: growExperience(s.experience) };
    }
    return s; // VACANT or BACKSTOPPED and not newly filled: value and experience both frozen
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

/** One deterministic tick. See this file's header comment for the pinned stage order. */
export function stepWorld(world: World): World {
  const { rng, config } = world;
  const day = world.tick;

  // ---- Stage 1: space/occupancy -----------------------------------------------------
  // A pure derivation from current role-slot state, not a stateful process of its own —
  // no synthetic drivers exist yet (Phase C) to actually move anyone. Recomputes each
  // building's occupant position (its own plot, static) and feeds district population.
  const allBuildingsById = new Map(world.shard.districts.flatMap((d) => d.buildings).map((b) => [b.id, b]));
  const occupantsOf = (slots: RoleEconomicSlot[]): PlayerPosition[] =>
    slots
      .filter((s) => s.slot.state === 'FILLED')
      .map((s) => {
        const b = allBuildingsById.get(s.buildingId)!;
        return { playerId: s.buildingId, x: b.x, y: b.y };
      });

  // ---- Stage 2: vacancy and conscription --------------------------------------------
  const millerParams = vacancyParamsFor(config.rMiller, config.targetPopulation, config.pMonthly, config);
  const bakerParams = { ...millerParams, R: config.rBaker };
  const millerSlotsIn = world.millers.map((m) => m.slot);
  const bakerSlotsIn = world.bakers.map((b) => b.slot);
  const gossipSize = Math.max(config.targetPopulation - config.rMiller - config.rBaker, 0);

  const conscriptionResult = stepConscriptionDay(
    millerSlotsIn,
    bakerSlotsIn,
    day,
    millerParams,
    bakerParams,
    config.conscriptionDelay,
    gossipSize,
    rng,
  );

  const millerJustFilled = new Set<string>();
  const bakerJustFilled = new Set<string>();
  world.millers.forEach((m, i) => {
    if (m.slot.state !== 'FILLED' && conscriptionResult.millerSlots[i]!.state === 'FILLED') millerJustFilled.add(m.buildingId);
  });
  world.bakers.forEach((b, i) => {
    if (b.slot.state !== 'FILLED' && conscriptionResult.otherSlots[i]!.state === 'FILLED') bakerJustFilled.add(b.buildingId);
  });

  let millers = world.millers.map((m, i) => ({ ...m, slot: conscriptionResult.millerSlots[i]! }));
  let bakers = world.bakers.map((b, i) => ({ ...b, slot: conscriptionResult.otherSlots[i]! }));

  // ---- Stage 3: market (Miller then Baker) ------------------------------------------
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

  // ---- Stage 4: ecosystem (sabotage -> arrivals -> migration, then health/experience) --
  // Sabotage-before-arrival order matches design/tick_order_check.py's own validated
  // finding — checked before choosing this order, not reinvented.
  let population = world.population;
  let lastSabotage: SabotageLogEntry | null = null;

  if (day > 0 && day % config.sabotageCadenceDays === 0) {
    const combined = [...millers, ...bakers];
    const filledCombined = combined.filter((s) => s.slot.state === 'FILLED');
    if (filledCombined.length > 0) {
      const targetIdx = Math.floor(rng() * filledCombined.length);
      const target = filledCombined[targetIdx]!;
      const targetBuilding = allBuildingsById.get(target.buildingId)!;

      const occupants = occupantsOf(millers).concat(occupantsOf(bakers)).filter((o) => o.playerId !== target.buildingId);
      const witnesses = occupantsWithin(world.shard, occupants, targetBuilding, config.witnessRadius).length;

      const successfulSaboteurs = sabotageAttempt(config.saboteurCount, config.acquireDays, detectionProbability(witnesses), rng);
      const remainingAfterDamage = applySabotageDamage(filledCombined.length, successfulSaboteurs, config.damagePerSuccess);
      const evictCount = filledCombined.length - remainingAfterDamage;

      if (evictCount > 0) {
        const evictable = [...filledCombined];
        for (let k = 0; k < evictCount; k++) {
          const pick = Math.floor(rng() * evictable.length);
          const chosen = evictable.splice(pick, 1)[0]!;
          const isMiller = millers.some((m) => m.buildingId === chosen.buildingId);
          if (isMiller) {
            millers = millers.map((m) => (m.buildingId === chosen.buildingId ? { ...m, slot: { state: 'BACKSTOPPED', vacantSince: day } } : m));
          } else {
            bakers = bakers.map((b) => (b.buildingId === chosen.buildingId ? { ...b, slot: { state: 'BACKSTOPPED', vacantSince: day } } : b));
          }
        }
      }

      lastSabotage = { tick: day, targetBuildingId: target.buildingId, witnesses, successfulSaboteurs, evicted: evictCount };
    }
  }

  if (rng() < config.arrivalPDaily) {
    population += 1;
  }

  const combinedFilledCount = millers.filter((m) => m.slot.state === 'FILLED').length + bakers.filter((b) => b.slot.state === 'FILLED').length;
  const emigrants = migrationValveStep(population, combinedFilledCount, rng, config.migrationTheta, config.migrationK);
  population = Math.max(0, population - emigrants);

  const s = config.rMiller + config.rBaker;
  const filledExpValues = [...millers, ...bakers].filter((x) => x.slot.state === 'FILLED').map((x) => x.experience);
  const avgExp = filledExpValues.length > 0 ? filledExpValues.reduce((a, b) => a + b, 0) / filledExpValues.length : 0;

  // ---- Stage 5: comms (rumour propagation) ------------------------------------------
  let lastRumourEvents: RumourEventLite[] = [];
  if (world.pendingWallPosts.length > 0) {
    const occupants = occupantsOf(millers).concat(occupantsOf(bakers));
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
    flourPrice: flourPriceValue,
    population,
    economicHealth: economicHealth(combinedFilledCount, s),
    economicHealthWithExperience: economicHealthWithExperience(combinedFilledCount, avgExp, s),
    pendingWallPosts: [],
    lastRumourEvents,
    lastSabotage,
  };
}
