/**
 * Spatial primitive (Observatory build spec, Phase A). Pure, deterministic, and — like
 * `vacancy.ts`/`ecosystem.ts`/`market.ts` — free of dependencies on any other module in
 * `src/engine/`, so composing this with them (Phase B's `world.ts`) is additive, not
 * entangling. The one deliberate exception: `mulberry32` from `../sim/rng.js`, imported
 * only because `generateShardLayout(seed, config)`'s required signature takes a raw seed
 * number rather than an `rand: () => number` callback (the pattern every other engine
 * module uses) — `rng.ts` is a tiny seeding utility, not a game mechanic, so importing it
 * doesn't create the kind of engine-to-engine coupling this file is otherwise built to
 * avoid.
 *
 * Closes the "NODE has no spatial primitive" gap: `districtArrivalChoice()` resolved
 * core-vs-periphery as a coin flip with nothing persisting afterward; `decay.ts` degraded
 * signals by an abstract hop count; `detectionProbability()`/`patternSabotageAttempt()`
 * took a witness count as a bare parameter with no derivation; District Weather and the
 * Wall's Emissive Soul need persistent per-district state that never existed. This module
 * gives all of that real coordinates and a real district entity to live in — Phase B is
 * where those existing functions actually get fed real numbers from here; see
 * `src/sim/spatialWitnessReport.ts` for the sabotage-calibration report this phase
 * produces without wiring `space.ts` itself to `ecosystem.ts`.
 *
 * IMPLEMENTATION NOTE on `distance()` (flagged for review, not silently decided): "walking
 * distance, not euclidean-through-walls" is implemented as Manhattan/grid distance
 * (|dx| + |dy|) rather than full pathfinding around buildings-as-obstacles. Two reasons:
 * the spec's own signature — `distance(a: Plot, b: Plot): number` — takes no shard/graph
 * argument, so it cannot search a walkability graph; and Manhattan distance is a proper
 * metric (satisfies symmetry and the triangle inequality, both required by this phase's
 * own test list) without the added complexity of BFS pathfinding, which nothing in the
 * spec's function list actually asks for. If buildings-blocking-sightlines turns out to
 * matter for a specific mechanic later (e.g. detection realism), that's a real pathfinding
 * feature to build deliberately, not something to retrofit here silently.
 *
 * IMPLEMENTATION NOTE on `plotsWithin`/`occupantsWithin`: the spec's abbreviated
 * signatures (`plotsWithin(centre, radius)`, `occupantsWithin(world, centre, radius)`)
 * omit the plot/occupant universe to search — neither function can return anything
 * without one. Both take an explicit `shard: Shard` parameter here; `occupantsWithin`
 * also takes a plain `occupants: PlayerPosition[]` list rather than Phase B's not-yet-built
 * `World` type, so this module stays usable before `world.ts` exists and Phase B can wrap
 * it with `world.players` once it does.
 */

import { mulberry32 } from '../sim/rng.js';

export type DistrictId = string;
export type BuildingId = string;
export type PlayerId = string;
export type PlotKind = 'street' | 'plaza' | 'building' | 'empty';
export type DistrictClassification = 'core' | 'periphery';

export interface Plot {
  x: number;
  y: number;
  districtId: DistrictId;
  kind: PlotKind;
  buildingId?: BuildingId;
}

export interface Building {
  id: BuildingId;
  x: number;
  y: number;
  districtId: DistrictId;
  /**
   * Opaque reference to a role slot elsewhere (e.g. a `vacancy.ts` `RoleSlot`) — this
   * module has zero dependency on `vacancy.ts`, so it cannot resolve or store
   * FILLED/VACANT/BACKSTOPPED state itself. A building's visible state is derived from
   * that state by whoever composes this with real slot data (Phase B), never stored here.
   * Null until Phase B assigns a real role to this building.
   */
  roleSlotRef: string | null;
}

export interface WeatherSample {
  tick: number;
  /** 0 (cool/calm) .. 1 (warm/tense) — District Weather's local mood, per the visual brief. */
  tension: number;
}

export interface District {
  id: DistrictId;
  classification: DistrictClassification;
  /** Generation-time radius (grid cells) — used by `districtPlotDensity`, not a live bound. */
  radius: number;
  plazaPlot: { x: number; y: number };
  plots: Plot[];
  buildings: Building[];
  /** Current player count in this district — 0 at generation; Phase B updates it as players move. */
  population: number;
  /** Accumulating per-tick history — empty at generation; Phase B appends as the world steps. */
  economicHealthHistory: number[];
  detectionHistory: number[];
  weatherHistory: WeatherSample[];
}

export interface Shard {
  id: string;
  seed: number;
  districts: District[];
}

export interface PlayerPosition {
  playerId: PlayerId;
  x: number;
  y: number;
}

// ---- Distance / adjacency -----------------------------------------------------------

/** Manhattan (grid) distance — see header note on why this, not full pathfinding. */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** All plots in `shard` within `radius` walking-distance steps of `centre` (inclusive). */
export function plotsWithin(shard: Shard, centre: { x: number; y: number }, radius: number): Plot[] {
  const plots: Plot[] = [];
  for (const district of shard.districts) {
    for (const plot of district.plots) {
      if (distance(centre, plot) <= radius) plots.push(plot);
    }
  }
  return plots;
}

/** Player ids among `occupants` within `radius` walking-distance steps of `centre`. */
export function occupantsWithin(
  shard: Shard,
  occupants: readonly PlayerPosition[],
  centre: { x: number; y: number },
  radius: number,
): PlayerId[] {
  void shard; // kept in the signature for API symmetry with plotsWithin / future shard-aware filtering (e.g. district-crossing rules); occupant positions are self-contained today.
  return occupants.filter((o) => distance(centre, o) <= radius).map((o) => o.playerId);
}

/** A plot already knows its own district — this is a stable lookup, not a search. */
export function districtOf(plot: Plot): DistrictId {
  return plot.districtId;
}

// ---- Wiring points for existing mechanics ---------------------------------------------

/**
 * Converts a real walking distance into a (0,1] closeness value — the real number
 * `src/comms/decay.ts`'s `stepClarity()` (as its `closeness` parameter) or
 * `src/comms/connections.ts`'s `ConnectionGraph.connect()` (as `weight`) can now be given,
 * in place of an arbitrary hardcoded number. `decay.ts`'s own decay curve is completely
 * unchanged by this — this only supplies where the distance value comes from, per the
 * spec's explicit instruction. Linear falloff: 1 at distance 0, approaching (never
 * reaching — `ConnectionGraph.connect` rejects a weight of exactly 0) a small floor at
 * `maxRange`. Returns null beyond `maxRange` — proximity-based closeness doesn't exist
 * past that range at all, distinct from a *social* connection existing at low weight
 * (the two are meant to compose, e.g. `min(spatialCloseness, socialWeight)` or similar at
 * the call site — this function only supplies the spatial half).
 */
export function proximityCloseness(dist: number, maxRange: number): number | null {
  if (dist > maxRange || maxRange <= 0) return null;
  return Math.max(0.01, 1 - dist / maxRange);
}

/**
 * Composes with `ecosystem.ts`'s `districtArrivalChoice()` (called separately — this
 * module stays dependency-free of `ecosystem.ts`) to close the actual gap: that function
 * only ever returned a `'core' | 'periphery'` label with nothing persisting afterward.
 * Given that label, this places the arrival at an actual district's plaza plot (a new
 * arrival's natural first stop) and increments that district's `population`, so the
 * choice accumulates into real, persistent state instead of evaporating after one coin
 * flip. Pure — returns a new `Shard` rather than mutating the one passed in, matching
 * every other function in this module.
 *
 * District selection among same-classification districts is by lowest current
 * population (ties broken by array/generation order) so repeated arrivals spread out
 * rather than piling onto district index 0 — not specified by the brief, a reasonable
 * default, flagged as such rather than treated as a settled design decision.
 */
export function placeArrival(
  shard: Shard,
  classification: DistrictClassification,
): { shard: Shard; districtId: DistrictId; plot: { x: number; y: number } } | null {
  const candidates = shard.districts.filter((d) => d.classification === classification);
  if (candidates.length === 0) return null;
  const target = candidates.reduce((least, d) => (d.population < least.population ? d : least));

  const nextShard: Shard = {
    ...shard,
    districts: shard.districts.map((d) => (d.id === target.id ? { ...d, population: d.population + 1 } : d)),
  };

  return { shard: nextShard, districtId: target.id, plot: { x: target.plazaPlot.x, y: target.plazaPlot.y } };
}

/**
 * Buildable-plot density local to a district's own generated area (Manhattan distance
 * <= district.radius from its plaza), deliberately excluding the inter-district corridor
 * plots that also carry this district's id — see `generateShardLayout`'s corridor step.
 * Including them would dilute the density number with a long thin strip of connective
 * street, defeating the point of measuring the district's own built-up area.
 */
export function districtPlotDensity(district: District): number {
  const area = 2 * district.radius * district.radius; // diamond of "radius" r has area 2r^2
  if (area <= 0) return 0;
  const localPlots = district.plots.filter((p) => distance(district.plazaPlot, p) <= district.radius);
  return localPlots.length / area;
}

// ---- Shard generation -----------------------------------------------------------------

export interface ShardLayoutConfig {
  /** Target player population for this shard — 50-80 per the brief. Informational at this
   *  phase; Phase A lays out static geography only, it doesn't place players. */
  targetPopulation: number;
  coreDistrictCount: number;
  peripheryDistrictCount: number;
  /** Grid-cell radius of each district's buildable diamond area around its plaza. */
  coreDistrictRadius: number;
  peripheryDistrictRadius: number;
  /** Step between buildable plots — 1 = every cell (dense), >1 = every Nth (sparser). */
  coreSpacing: number;
  peripherySpacing: number;
  buildingsPerCoreDistrict: number;
  buildingsPerPeripheryDistrict: number;
}

// District count (6: 2 core + 4 periphery) checked, not just inherited, 2026-08-11 —
// sim/multiShardRoleDistrictSweep.ts swept 3/6/11 districts through the real multi-shard
// system and found a genuine, monotonic tradeoff: fewer/bigger districts staff better but
// are less equal and leave grifters waiting longer (district-consolidation's irreversible
// ratchet trips less often when each district's filled-fraction averages over more role
// slots); more/smaller districts are fairer and faster for grifters but worse-staffed. 6
// districts sits almost exactly between both extremes on every metric measured — kept as
// the deliberate balance point, not a default nobody re-examined. See docs/BLUEPRINT.md's
// "5-role/district allocation, re-derived" entry for the full numbers.
export const DEFAULT_SHARD_CONFIG: ShardLayoutConfig = {
  targetPopulation: 65,
  coreDistrictCount: 2,
  peripheryDistrictCount: 4,
  coreDistrictRadius: 6,
  peripheryDistrictRadius: 5,
  coreSpacing: 1,
  peripherySpacing: 2,
  buildingsPerCoreDistrict: 10,
  buildingsPerPeripheryDistrict: 5,
};

interface DistrictCenter {
  x: number;
  y: number;
  classification: DistrictClassification;
}

/**
 * Deterministic district center placement. Core districts cluster near the shard hub
 * (0,0); periphery districts sit further out. Jitter (angle and radius) comes from `rand`
 * specifically so the layout reads as organic rather than a perfect ring or grid — the
 * visual brief explicitly rejects "perfect rings... radial symmetry" as a known failure
 * mode of an earlier prototype.
 */
function placeDistrictCenters(config: ShardLayoutConfig, rand: () => number): DistrictCenter[] {
  const centers: DistrictCenter[] = [];
  const coreGap = config.coreDistrictRadius * 2 + 4;

  for (let i = 0; i < config.coreDistrictCount; i++) {
    const angle = (i / Math.max(1, config.coreDistrictCount)) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const r = coreGap * 0.5 + (rand() - 0.5) * 4;
    centers.push({ x: Math.round(Math.cos(angle) * r), y: Math.round(Math.sin(angle) * r), classification: 'core' });
  }

  const peripheryBaseRadius = coreGap * 1.8;
  for (let i = 0; i < config.peripheryDistrictCount; i++) {
    const angle = (i / Math.max(1, config.peripheryDistrictCount)) * Math.PI * 2 + (rand() - 0.5) * 0.8 + 0.3;
    const r = peripheryBaseRadius + (rand() - 0.5) * peripheryBaseRadius * 0.4 + i * 3;
    centers.push({ x: Math.round(Math.cos(angle) * r), y: Math.round(Math.sin(angle) * r), classification: 'periphery' });
  }

  return centers;
}

/**
 * One district's buildable plots: a diamond of radius `radius` around `center`, stepped
 * by `spacing` (core=1 dense, periphery=2 sparser — this is what actually produces the
 * density gradient the visual brief's §3 table requires). Outer-ring plots are randomly
 * skipped so the edge reads as ragged rather than a clean diamond boundary — "real
 * gaps... not a clean ring boundary," per the same brief.
 */
function generateDistrictPlots(
  id: DistrictId,
  center: { x: number; y: number },
  radius: number,
  spacing: number,
  buildingCount: number,
  rand: () => number,
): { plots: Plot[]; buildings: Building[]; plazaPlot: { x: number; y: number } } {
  // Grid is aligned to (0,0) — iterate every integer offset and keep only those on the
  // spacing lattice, rather than stepping from -radius by `spacing` (which, whenever
  // radius is odd and spacing is even, never lands on 0 and silently drops the plaza
  // center itself — found via a failing "every district has exactly one plaza" test).
  const candidates: { x: number; y: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    if (dx % spacing !== 0) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      if (dy % spacing !== 0) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > radius) continue;
      const edgeFactor = d / radius;
      if (edgeFactor > 0.7 && rand() < 0.3) continue; // ragged edge, not a clean boundary
      candidates.push({ x: center.x + dx, y: center.y + dy });
    }
  }

  const plots: Plot[] = candidates.map((c) => ({ x: c.x, y: c.y, districtId: id, kind: 'street' as PlotKind }));
  const plazaPlot = { x: center.x, y: center.y };
  const plazaEntry = plots.find((p) => p.x === plazaPlot.x && p.y === plazaPlot.y);
  if (plazaEntry) plazaEntry.kind = 'plaza';

  const buildingCandidates = plots.filter((p) => p.kind === 'street');
  const buildings: Building[] = [];
  const pool = [...buildingCandidates];
  const n = Math.min(buildingCount, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * pool.length);
    const chosen = pool.splice(idx, 1)[0]!;
    const buildingId = `${id}-b${i}`;
    chosen.kind = 'building';
    chosen.buildingId = buildingId;
    buildings.push({ id: buildingId, x: chosen.x, y: chosen.y, districtId: id, roleSlotRef: null });
  }

  return { plots, buildings, plazaPlot };
}

/**
 * L-shaped street corridor from `from` to `to` (horizontal leg then vertical leg) —
 * connects every district back to the shard hub so the whole shard is one walkable graph,
 * not disjoint islands. Attributed to `districtId` purely for `Plot.districtId`'s sake
 * (every plot needs one); `districtPlotDensity` deliberately excludes these plots from a
 * district's own density measurement — see that function's doc comment.
 */
function corridorPlots(
  from: { x: number; y: number },
  to: { x: number; y: number },
  districtId: DistrictId,
): Plot[] {
  const plots: Plot[] = [];
  let x = from.x;
  let y = from.y;
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    plots.push({ x, y, districtId, kind: 'street' });
  }
  while (y !== to.y) {
    y += y < to.y ? 1 : -1;
    plots.push({ x, y, districtId, kind: 'street' });
  }
  return plots;
}

/**
 * Deterministic procedural shard layout. Same `seed` + same `config` always produces a
 * byte-identical `Shard` — every random draw goes through `mulberry32(seed)` in a fixed
 * order (district centers, then each district's plots/buildings in array order), nothing
 * depends on object-key iteration order or any other non-deterministic source.
 */
export function generateShardLayout(seed: number, config: ShardLayoutConfig = DEFAULT_SHARD_CONFIG): Shard {
  const rand = mulberry32(seed);
  const centers = placeDistrictCenters(config, rand);
  const hub = { x: 0, y: 0 };

  // Pass 1: each district's own plots (plaza/street/building) — generated in center order,
  // nothing here depends on any other district yet.
  const districtData = centers.map((center, i) => {
    const id = `${center.classification}-${i}`;
    const radius = center.classification === 'core' ? config.coreDistrictRadius : config.peripheryDistrictRadius;
    const spacing = center.classification === 'core' ? config.coreSpacing : config.peripherySpacing;
    const buildingCount =
      center.classification === 'core' ? config.buildingsPerCoreDistrict : config.buildingsPerPeripheryDistrict;
    const { plots, buildings, plazaPlot } = generateDistrictPlots(id, center, radius, spacing, buildingCount, rand);
    return { id, classification: center.classification, radius, plazaPlot, plots, buildings };
  });

  // Every real (non-corridor) plot claims its cell before any corridor is considered, so a
  // corridor can never silently overwrite a plaza or building plot — regardless of which
  // district is processed first.
  const claimed = new Set<string>();
  for (const d of districtData) {
    for (const p of d.plots) claimed.add(`${p.x},${p.y}`);
  }

  // Pass 2: corridors, in district order — a cell goes to whichever district (real plot or
  // earlier corridor) claimed it first; later corridors crossing the same cell skip it
  // rather than adding a second, ambiguous Plot at that coordinate.
  const districts: District[] = districtData.map((d) => {
    const corridor = corridorPlots(d.plazaPlot, hub, d.id).filter((p) => {
      const key = `${p.x},${p.y}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });

    return {
      id: d.id,
      classification: d.classification,
      radius: d.radius,
      plazaPlot: d.plazaPlot,
      plots: [...d.plots, ...corridor],
      buildings: d.buildings,
      population: 0,
      economicHealthHistory: [],
      detectionHistory: [],
      weatherHistory: [],
    };
  });

  return { id: `shard-${seed}`, seed, districts };
}
