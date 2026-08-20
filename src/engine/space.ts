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
  /** Residential floors above/alongside whatever role function (if any) occupies this
   *  building's ground floor — housing is decoupled from role slot entirely, per
   *  `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.1-1.2 ("above bakeries, and
   *  elsewhere across the city"). Every building carries the same illustrative floor count
   *  today (`HOUSING_FLOORS_PER_BUILDING`) — real per-building variation is future work,
   *  not needed for the first housing-capacity pass. */
  floors: number;
  /** True for a small, deterministic subset of buildings chosen at generation as local
   *  peaks of the district's anisotropic texture field (see `textureField()` below) —
   *  purely a rendering/landmark hint, read by nothing in this module and by no other
   *  gameplay mechanic. Optional and defaulted false so every existing caller/test that
   *  constructs a `Building` literal without this field keeps compiling unchanged. */
  isLandmark?: boolean;
}

/** [ILLUSTRATIVE] — not yet measured against a real run; named and factored out so it's
 *  easy to find and retune later rather than buried inline, per the user's own "we can name
 *  every variable in play later, just ensure we can track them easily." */
export const HOUSING_FLOORS_PER_BUILDING = 3;
/** [ILLUSTRATIVE] — residents one floor houses. */
export const HOUSING_RESIDENTS_PER_FLOOR = 2;

/** A district's total housing capacity: every building's floors x residents-per-floor,
 *  independent of whether that building also carries a role slot — a Home-only building
 *  (no `roleSlotRef`) looks identical to this function. */
export function districtHousingCapacity(district: District): number {
  return district.buildings.reduce((sum, b) => sum + b.floors * HOUSING_RESIDENTS_PER_FLOOR, 0);
}

/**
 * Chooses the district with the most housing headroom (capacity minus already-housed
 * residents), ties broken by array order — the housing-capacity analogue of
 * `placeArrival`'s lowest-population selection, but keyed to housing capacity rather than
 * raw population so residents spread across whatever housing actually exists rather than
 * piling into whichever district happens to have the fewest role-holders. Never fails to
 * return a district when at least one exists (per constraint 2, no permanent zero-state) —
 * if every district is technically over capacity, it returns the LEAST overcrowded one
 * rather than refusing to house anyone.
 */
export function chooseHousingDistrict(
  shard: Shard,
  housedCountByDistrict: Readonly<Record<DistrictId, number>>,
): DistrictId | undefined {
  if (shard.districts.length === 0) return undefined;
  let best = shard.districts[0]!;
  let bestHeadroom = districtHousingCapacity(best) - (housedCountByDistrict[best.id] ?? 0);
  for (const d of shard.districts.slice(1)) {
    const headroom = districtHousingCapacity(d) - (housedCountByDistrict[d.id] ?? 0);
    if (headroom > bestHeadroom) {
      best = d;
      bestHeadroom = headroom;
    }
  }
  return best.id;
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
  /** Districts this one connects to directly via a side street, generated once at shard
   *  creation from geometry alone (2026-08-12, `docs/VISUAL_FRAMEWORK_2026-08-12.md` §6 —
   *  district barriers). Static for the shard's whole life; see `engine/districtAccess.ts`
   *  for who actually gets to use these. Empty for a district with no side streets (e.g. a
   *  single-district shard) — the hub route always still works regardless. */
  neighborDistrictIds: DistrictId[];
}

export interface Shard {
  id: string;
  seed: number;
  districts: District[];
  /** The one point every district's corridor connects back to and none of them own —
   *  always (0,0), same for every shard, per `generateShardLayout`'s own hub placement.
   *  Exposed as a named field (2026-08-12, `docs/VISUAL_FRAMEWORK_2026-08-12.md` §1) rather
   *  than left as an implicit convention: this is where "the Wall" (the visual brief's
   *  shard-wide landmark, `NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §5 — "true center,
   *  equidistant from all districts, never belonging to one") belongs. Not a new placement
   *  decision; a real one `generateShardLayout` already made, now given a name. */
  hubPlot: { x: number; y: number };
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

// ---- Anisotropic texture field --------------------------------------------------------

/**
 * A deterministic, direction-dependent density field over (x, y) — NOT a function of
 * distance-from-plaza (that's `edgeFactor`, already handled by `generateDistrictPlots`'s
 * ragged-edge dropout). Two low-frequency sine waves at independently-seeded orientations,
 * summed and normalised to [-1, 1]. Purpose: `edgeFactor` alone is radially symmetric — a
 * district generated from it reads the same in every compass direction, which is the
 * "featureless" quality this field exists to break. `angleA`/`angleB` are drawn once per
 * shard (`generateShardLayout`, same `rand()` stream as everything else) so every shard
 * gets its own fixed "grain" direction — deterministic given the same seed, never the same
 * shape twice across different seeds. Pure function of its inputs; no state, no side
 * effects, matches every other function in this module.
 */
export function textureField(x: number, y: number, angleA: number, angleB: number): number {
  const a = Math.sin(x * Math.cos(angleA) + y * Math.sin(angleA) * 0.31);
  const b = Math.sin(x * Math.cos(angleB) * 0.17 + y * Math.sin(angleB));
  return (a + b) / 2;
}

/** [ILLUSTRATIVE] — how many of a district's building plots get flagged `isLandmark`.
 *  Small and fixed rather than proportional to building count: landmarks are meant to read
 *  as rare, not as a percentage-of-density effect. */
export const LANDMARKS_PER_DISTRICT = 3;

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

// District count REVISED 2026-08-13 — the 6-district (2 core + 4 periphery) call above was
// real but was made on aggregate multi-shard metrics alone (health/gini/wait/flourRatio),
// never on real per-district population, because `District.population` was silently never
// incremented by the tick loop (found and fixed this same session, `world.ts`'s
// `stepWorld`). Once fixed, the real numbers were decisive, not a close call: at a single
// shard, 800 days, 3 seeds —
//
//   layout        districts  meanPop  meanRoleHolders  meanRoleHoldersPerDistrict  health  gini
//   1 district     1          69.0     43.0             43.0                       0.961   0.619
//   3 districts    3          66.0     43.0             14.3                       0.961   0.628
//   6 districts    6          58.7     40.7              6.8                       0.930   0.649
//
// 1 district wins on EVERY metric measured — there is no tradeoff being traded away here,
// unlike the pop/district-count calls made earlier this project. More districts fragment the
// same role-slot pool across more separately-consolidatable units; district-consolidation's
// irreversible health ratchet (districtConsolidation.ts) trips more often the thinner each
// district's own filled-fraction sample is, which is worse for health AND equality, not just
// a "feel" issue. This directly resolves the user's own rejection of the 6-district default
// ("6 is unreasonable" / "how many players per district? ... it's absurd") with real numbers,
// not a guess, and separately matches the 2026-08-13 addendum's concept art: one addendum
// "district" is one single plaza+3-wedge settlement (`docs/DESIGN_ADDENDUM_2026-08-13.md`
// §5-6), not several separate ones. A SEPARATE real bug was found and fixed alongside this
// (`assignRoleBuildings` in world.ts starved whichever districts landed last in iteration
// order once role count < building count — 2 of the old 4 periphery districts held literally
// zero role-holders, ever, before that fix); the numbers above are POST-fix, so they're not
// an artifact of that bug either.
//
// Population beyond what one dense district comfortably holds (currently ~55-70 in these
// single-shard runs, below `targetPopulation=100`) is NOT handled by adding more districts —
// it's handled by the already-built, already-tested multi-shard system (`shardRegistry.ts`,
// `multiShardHarness.ts`): a new shard opens once existing ones are genuinely full and
// healthy. This is a real simplification, not a compromise: one settlement per shard, and
// shard count (not district count) absorbs population growth — exactly what "Beyond one
// shard" in README.md already describes as built and tested.
//
// KNOWN RIPPLE, not resolved here: this removes the separate core-district/periphery-district
// distinction the Silhouette Shield's resolution-speed gradient and the visual brief's
// density table were built around (`identity.ts`'s `coreSpacing`/`peripherySpacing`). See
// `test/identityResolutionHarness.test.ts` and `docs/BLUEPRINT.md`'s entry on this exact
// change for how that test was actually handled, not silently dropped. If a felt busy-center-
// vs-quiet-edge gradient is still wanted, it needs re-deriving as a distance-from-plaza
// gradient WITHIN this one district (which `generateDistrictPlots`'s existing edge-raggedness
// factor already gestures at) rather than between separate District objects — real follow-up
// work, not decided today.
//
// buildingsPerCoreDistrict=62 keeps the prior total building count (2*15 + 4*8 = 62)
// unchanged, now concentrated in one district instead of split six ways — same headroom over
// the 46-role-slot split, now real headroom every district shares rather than some districts
// getting none. coreDistrictRadius raised 6->7 because radius=6 empirically tops out at 68
// buildable plots (measured directly, `generateDistrictPlots`'s own candidate-plot count) —
// workable but no slack; radius=7 supports up to 88, comfortable room to grow (e.g. Home-only
// buildings, `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.1, not yet built).
// peripheryDistrictCount=0: periphery fields kept in the type/config (not deleted) so a
// future cascading-district-opening feature (addendum §4 — a real district 2/3 opening only
// once population genuinely crosses a threshold, not built yet) has somewhere to plug in
// without a config-shape change.
export const DEFAULT_SHARD_CONFIG: ShardLayoutConfig = {
  targetPopulation: 100,
  coreDistrictCount: 1,
  peripheryDistrictCount: 0,
  coreDistrictRadius: 7,
  peripheryDistrictRadius: 5,
  coreSpacing: 1,
  peripherySpacing: 2,
  buildingsPerCoreDistrict: 62,
  buildingsPerPeripheryDistrict: 8,
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

  // THE WESTERN-EDGE WALL FIX (2026-08-19). This ring placement is correct for SEVERAL core
  // districts arranged around a shared hub, and was never updated when the shard dropped to
  // one district (2026-08-13). With `coreDistrictCount: 1` the loop below still displaces that
  // lone district ~9 units off origin, which put the hub — The Wall — on the settlement's
  // western rim with all ~62 buildings east of it. Measured before fixing, across 8 seeds:
  // hub 6.5-10.5 units off the district's true centre, zero buildings west of it.
  //
  // The single-district case is therefore special-cased to sit ON the hub. The two `rand()`
  // draws are still consumed rather than skipped, so every downstream consumer of this stream
  // (texture angles, plot dropout, everything in pass 1 and after) sees the identical sequence
  // it saw before — the district TRANSLATES onto the origin rather than regenerating into a
  // different shape, which keeps this diff readable and its effects attributable.
  const singleCoreDistrict = config.coreDistrictCount === 1 && config.peripheryDistrictCount === 0;

  for (let i = 0; i < config.coreDistrictCount; i++) {
    const angle = (i / Math.max(1, config.coreDistrictCount)) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const r = coreGap * 0.5 + (rand() - 0.5) * 4;
    if (singleCoreDistrict) {
      centers.push({ x: 0, y: 0, classification: 'core' });
      continue;
    }
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
  angleA: number,
  angleB: number,
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
      if (edgeFactor > 0.7) {
        // Same outer-ring dropout band as before, now modulated by the anisotropic
        // texture field instead of a flat 0.3 — the sparse side of the field (texture
        // < 0) drops more, the dense side (texture > 0) drops less. Still exactly one
        // rand() call per candidate in this band, same as the original flat version, so
        // this changes WHERE the raggedness lands, not the determinism/call-count
        // properties anything else in this module relies on.
        const texture = textureField(center.x + dx, center.y + dy, angleA, angleB);
        const dropoutChance = 0.3 - texture * 0.2; // ~0.1 (dense side) .. ~0.5 (sparse side)
        if (rand() < dropoutChance) continue;
      }
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
    buildings.push({
      id: buildingId,
      x: chosen.x,
      y: chosen.y,
      districtId: id,
      roleSlotRef: null,
      floors: HOUSING_FLOORS_PER_BUILDING,
    });
  }

  // Landmarks: the LANDMARKS_PER_DISTRICT buildings with the strongest texture-field
  // MAGNITUDE (peak or trough, either direction counts) — not simply the first N or the
  // largest — so landmarks spread across both the district's densest and its most open
  // pockets rather than clustering in whichever sub-region happens to be busiest. Purely
  // a post-hoc flag on already-chosen buildings; doesn't consume rand() and doesn't change
  // which plots became buildings above, so building COUNT and the existing rand()-driven
  // selection are both untouched by this step.
  const landmarkOrder = [...buildings].sort(
    (b1, b2) =>
      Math.abs(textureField(b2.x, b2.y, angleA, angleB)) - Math.abs(textureField(b1.x, b1.y, angleA, angleB)),
  );
  for (const b of landmarkOrder.slice(0, LANDMARKS_PER_DISTRICT)) {
    b.isLandmark = true;
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

/** How many nearest OTHER districts each district connects directly to via a side street,
 *  bypassing the hub. [ILLUSTRATIVE] — deliberately small: "genuine alternate routes, not a
 *  fully-connected mesh," per `NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §2. The final mesh is
 *  the UNION of every district's own K choices (see `sideStreetPairs`), so a district often
 *  ends up with more than K neighbours once other districts' own choices include it too. */
export const DISTRICT_SIDE_STREET_NEIGHBOR_COUNT = 2;

/**
 * Every district's own K nearest OTHER districts by plaza-to-plaza distance, deduped into
 * unordered pairs — the side-street mesh `generateShardLayout` builds corridors from and
 * `District.neighborDistrictIds` records. A pair appears once whether both districts picked
 * each other or only one did: the corridor is physically bidirectional regardless of which
 * side "chose" it first, so this is a symmetric union of directed K-NN choices, not a
 * mutual-nearest-neighbour requirement. Deterministic: `others` is sorted by real (integer,
 * exact) Manhattan distance, and JS's stable sort preserves `districtData`'s own array order
 * on ties, which is itself fixed generation order — no reliance on object-key iteration.
 */
function sideStreetPairs(
  districtData: readonly { id: DistrictId; plazaPlot: { x: number; y: number } }[],
  k: number,
): Array<[DistrictId, DistrictId]> {
  const seen = new Set<string>();
  const pairs: Array<[DistrictId, DistrictId]> = [];
  for (const d of districtData) {
    const nearest = districtData
      .filter((o) => o.id !== d.id)
      .map((o) => ({ id: o.id, dist: distance(d.plazaPlot, o.plazaPlot) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k);
    for (const o of nearest) {
      const key = [d.id, o.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([d.id, o.id]);
    }
  }
  return pairs;
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

  // Texture field orientation — drawn once per shard, unconditionally (same two rand()
  // calls happen every time regardless of district/config shape), so every shard gets its
  // own fixed "grain" direction and the existing same-seed-same-output determinism test
  // still holds byte-for-byte. Drawn AFTER placeDistrictCenters so district-center jitter
  // is completely unaffected by this addition — nothing upstream of this line changes.
  const textureAngleA = rand() * Math.PI * 2;
  const textureAngleB = rand() * Math.PI * 2;

  // Pass 1: each district's own plots (plaza/street/building) — generated in center order,
  // nothing here depends on any other district yet.
  const districtData = centers.map((center, i) => {
    const id = `${center.classification}-${i}`;
    const radius = center.classification === 'core' ? config.coreDistrictRadius : config.peripheryDistrictRadius;
    const spacing = center.classification === 'core' ? config.coreSpacing : config.peripherySpacing;
    const buildingCount =
      center.classification === 'core' ? config.buildingsPerCoreDistrict : config.buildingsPerPeripheryDistrict;
    const { plots, buildings, plazaPlot } = generateDistrictPlots(
      id,
      center,
      radius,
      spacing,
      buildingCount,
      textureAngleA,
      textureAngleB,
      rand,
    );
    return { id, classification: center.classification, radius, plazaPlot, plots, buildings };
  });

  // Every real (non-corridor) plot claims its cell before any corridor is considered, so a
  // corridor can never silently overwrite a plaza or building plot — regardless of which
  // district is processed first.
  const claimed = new Set<string>();
  for (const d of districtData) {
    for (const p of d.plots) claimed.add(`${p.x},${p.y}`);
  }

  // Pass 2: hub-spoke corridors, in district order — a cell goes to whichever district (real
  // plot or earlier corridor) claimed it first; later corridors crossing the same cell skip
  // it rather than adding a second, ambiguous Plot at that coordinate.
  const hubCorridors = new Map<DistrictId, Plot[]>();
  for (const d of districtData) {
    const corridor = corridorPlots(d.plazaPlot, hub, d.id).filter((p) => {
      const key = `${p.x},${p.y}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    hubCorridors.set(d.id, corridor);
  }

  // Pass 3: side-street corridors (2026-08-12, district barriers — see
  // districtAccess.ts for who actually gets to use these; this pass only builds the
  // physical mesh, which is the same for every player). Runs AFTER hub corridors claim
  // their cells, same "first claim wins" discipline; a side street sharing a cell with an
  // already-placed hub corridor is fine (both are plain 'street' plots), it just skips
  // adding a second Plot at that coordinate.
  const pairs = sideStreetPairs(districtData, DISTRICT_SIDE_STREET_NEIGHBOR_COUNT);
  const sideStreetCorridors = new Map<DistrictId, Plot[]>();
  const neighborsById = new Map<DistrictId, Set<DistrictId>>(districtData.map((d) => [d.id, new Set<DistrictId>()]));
  for (const [a, b] of pairs) {
    neighborsById.get(a)!.add(b);
    neighborsById.get(b)!.add(a);
    const from = districtData.find((d) => d.id === a)!;
    const to = districtData.find((d) => d.id === b)!;
    const corridor = corridorPlots(from.plazaPlot, to.plazaPlot, a).filter((p) => {
      const key = `${p.x},${p.y}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    sideStreetCorridors.set(a, [...(sideStreetCorridors.get(a) ?? []), ...corridor]);
  }

  const districts: District[] = districtData.map((d) => ({
    id: d.id,
    classification: d.classification,
    radius: d.radius,
    plazaPlot: d.plazaPlot,
    plots: [...d.plots, ...(hubCorridors.get(d.id) ?? []), ...(sideStreetCorridors.get(d.id) ?? [])],
    buildings: d.buildings,
    population: 0,
    economicHealthHistory: [],
    detectionHistory: [],
    weatherHistory: [],
    neighborDistrictIds: [...(neighborsById.get(d.id) ?? [])].sort(),
  }));

  return { id: `shard-${seed}`, seed, districts, hubPlot: hub };
}



