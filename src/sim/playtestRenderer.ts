import type { World } from '../world/world.js';
import { computeEconomicHeat, type EconomicHeatField } from '../engine/economicHeat.js';
import type { Shard } from '../engine/space.js';

/**
 * Phase A of the terminal playtest harness (`docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`) —
 * the first time anything in this repo gets LOOKED at rather than measured. User's own
 * framing: "I really need to get to the position where I can play test the game and design
 * the precise gameplay from experience and what's fun, rather than assuming simulations will
 * do so."
 *
 * PURE BY CONSTRUCTION, and that is the whole point of splitting this from `playtestCli.ts`.
 * Every function here takes a `World` and returns strings. Nothing mutates, nothing steps,
 * nothing touches stdin/stdout — so the renderer is directly testable without a terminal, and
 * attaching it to a run cannot perturb determinism. This mirrors the relationship
 * `engine/economicHeat.ts` already documents about ITSELF ("deliberately NOT stored on
 * `World` or computed inside `stepWorld`... it cannot affect determinism, tick order, or any
 * existing test in this repo"), and it is the same harness/cli split every other `src/sim/`
 * mechanic already uses.
 *
 * WHY A TERMINAL IS A REAL INSTRUMENT HERE, not a consolation prize (design doc §2): the
 * shipped shard is a 14x15 grid — 90 plots, 62 buildings, measured, not estimated — so the
 * whole settlement fits in 28x15 characters. And the game's own visual language is already
 * ambient rather than representational ("a player should be able to read scarcity from the
 * plaza rather than computing it from numbers"), which is exactly what a grid of coloured
 * cells is good at. Two mood fields drive it, and they deliberately share one 0..1 scale:
 * `districtWeather.ts`'s `tension` (background) and `economicHeat.ts`'s heat (foreground).
 *
 * DELIBERATELY NOT sub-cell rendered. Half-block (`▀`) tricks were considered and rejected
 * on the real numbers: 90 discrete plots is a coarse grid, so sub-plot detail would carry no
 * game state. One plot renders as one chunky 2x1 cell. See the design doc's own recorded
 * correction on this.
 */

/** Terminal columns per plot. Cells are ~2:1 tall, so 2 makes a plot read roughly square. */
export const CELL_WIDTH = 2;

export interface RenderOptions {
  /** False emits plain ASCII with zero escape sequences — for NO_COLOR, dumb terminals,
   *  piped output, and the golden-string tests below. */
  color: boolean;
  /** Total terminal width available. Drives the side-by-side vs. stacked layout choice. */
  width: number;
  /** Most recent events, newest last — accumulated by the caller across ticks, since a single
   *  `World` only ever reports its OWN tick's `last*` fields. Kept out of this module so it
   *  stays pure. */
  eventLog: readonly string[];
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = { color: true, width: 80, eventLog: [] };

type RoleGlyph = 'M' | 'B' | 'C' | 'J' | 'D' | 'X';
type SlotState = 'FILLED' | 'VACANT' | 'BACKSTOPPED';

interface BuildingRender {
  glyph: RoleGlyph;
  state: SlotState;
  heat: number;
}

// ---- Colour ----------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** Background ramp: calm (cool, near-black blue) -> tense (dim ember red). Kept dark on
 *  purpose so foreground glyphs stay legible on top of it at every tension value. */
const TENSION_CALM: Rgb = [10, 14, 26];
const TENSION_TENSE: Rgb = [54, 17, 15];

/** Foreground ramp for role buildings: cool/supplied -> hot/scarce. Matches the addendum's
 *  "read scarcity from the plaza" intent — a hot station is visibly hot. */
const HEAT_COOL: Rgb = [92, 172, 204];
const HEAT_HOT: Rgb = [255, 170, 62];

/**
 * Brightness by slot state, implementing `ecosystem.ts`'s already-stated visual contract:
 * "player-held vs. backstopped slot -> solid saturated outline vs. dashed/desaturated
 * outline, quieter never broken." Nothing ever renders as absent — VACANT is the quietest
 * value, not an empty cell (constraint 2's "no permanent zero-state," applied to the view).
 */
const STATE_BRIGHTNESS: Record<SlotState, number> = { FILLED: 1, BACKSTOPPED: 0.5, VACANT: 0.28 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

function scaleRgb(c: Rgb, factor: number): Rgb {
  return [Math.round(c[0] * factor), Math.round(c[1] * factor), Math.round(c[2] * factor)];
}

export function fg(c: Rgb): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}

export function bg(c: Rgb): string {
  return `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
}

export const RESET = '\x1b[0m';

// ---- World -> renderable projection -----------------------------------------------------

/** Bounding box over every plot in every district, plus the hub (which is a landmark at
 *  (0,0) and not necessarily a plot of its own). */
export function shardBounds(shard: Shard): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = shard.hubPlot.x;
  let maxX = shard.hubPlot.x;
  let minY = shard.hubPlot.y;
  let maxY = shard.hubPlot.y;
  for (const d of shard.districts) {
    for (const p of d.plots) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * buildingId -> what to draw there. Role is derived by which of `World`'s six role arrays
 * holds the building, which is the only place that association exists — there is no `role`
 * field on `Building` itself (`space.ts` keeps `roleSlotRef` deliberately opaque).
 */
export function buildingRenderMap(world: World, heat: EconomicHeatField): Map<string, BuildingRender> {
  const map = new Map<string, BuildingRender>();
  const add = (slots: readonly { buildingId: string; slot: { state: SlotState } }[], glyph: RoleGlyph) => {
    for (const s of slots) {
      map.set(s.buildingId, { glyph, state: s.slot.state, heat: heat[s.buildingId] ?? 0 });
    }
  };
  add(world.millers, 'M');
  add(world.bakers, 'B');
  add(world.couriers, 'C');
  add(world.journalists, 'J');
  add(world.detectives, 'D');
  add(world.importExporters, 'X');
  return map;
}

/** Latest tension per district. `weatherHistory` is empty at world creation (nothing has been
 *  stepped yet), which reads as calm rather than as an error. */
export function districtTensions(world: World): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of world.shard.districts) {
    map.set(d.id, d.weatherHistory.at(-1)?.tension ?? 0);
  }
  return map;
}

// ---- Map pane ---------------------------------------------------------------------------

/**
 * The settlement itself. One plot per `CELL_WIDTH`-wide cell; `minY` renders at the top.
 * Every cell's background carries its district's tension, so the map reads as a mood field
 * first and a set of glyphs second — which is the intended order of legibility.
 */
export function renderMap(world: World, opts: RenderOptions, heat: EconomicHeatField): string[] {
  const bounds = shardBounds(world.shard);
  const buildings = buildingRenderMap(world, heat);
  const tensions = districtTensions(world);

  const plotAt = new Map<string, { districtId: string; kind: string; buildingId?: string }>();
  for (const d of world.shard.districts) {
    for (const p of d.plots) {
      plotAt.set(`${p.x},${p.y}`, { districtId: d.id, kind: p.kind, buildingId: p.buildingId });
    }
  }
  const buildingAt = new Map<string, string>();
  for (const d of world.shard.districts) {
    for (const b of d.buildings) buildingAt.set(`${b.x},${b.y}`, b.id);
  }
  const plazaAt = new Set(world.shard.districts.map((d) => `${d.plazaPlot.x},${d.plazaPlot.y}`));
  const hubKey = `${world.shard.hubPlot.x},${world.shard.hubPlot.y}`;

  const pad = ' '.repeat(CELL_WIDTH - 1);
  const lines: string[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    let line = '';
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const key = `${x},${y}`;
      const plot = plotAt.get(key);
      const buildingId = buildingAt.get(key);
      const building = buildingId ? buildings.get(buildingId) : undefined;

      let glyph = ' ';
      let colour: Rgb = [120, 120, 120];

      if (key === hubKey) {
        glyph = '#'; // The Wall — the shard's one landmark, equidistant from everything, owned by nobody.
        colour = [214, 206, 180];
      } else if (building) {
        glyph = building.state === 'VACANT' ? building.glyph.toLowerCase() : building.glyph;
        colour = scaleRgb(lerpRgb(HEAT_COOL, HEAT_HOT, building.heat), STATE_BRIGHTNESS[building.state]);
      } else if (buildingId) {
        glyph = '.'; // a real building with no role slot attached to it
        colour = [70, 70, 78];
      } else if (plazaAt.has(key)) {
        glyph = '+';
        colour = [150, 140, 110];
      } else if (plot) {
        glyph = ':';
        colour = [48, 50, 58];
      }

      if (!opts.color) {
        line += glyph + pad;
        continue;
      }

      // Outside the settlement entirely: emit plain spaces rather than a coloured run —
      // there is nothing there to tint, and the escapes were pure noise on the wire.
      if (!plot && key !== hubKey) {
        line += ' '.repeat(CELL_WIDTH);
        continue;
      }

      const tension = plot ? (tensions.get(plot.districtId) ?? 0) : 0;
      line += `${bg(lerpRgb(TENSION_CALM, TENSION_TENSE, tension))}${fg(colour)}${glyph}${pad}${RESET}`;
    }
    lines.push(line);
  }

  return lines;
}

export function mapWidth(world: World): number {
  const b = shardBounds(world.shard);
  return (b.maxX - b.minX + 1) * CELL_WIDTH;
}

// ---- Status pane ------------------------------------------------------------------------

function bar(value: number, width: number, max = 1): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function filledCount(slots: readonly { slot: { state: string } }[]): number {
  return slots.filter((s) => s.slot.state === 'FILLED').length;
}

/**
 * Everything a `World` already exposes, read straight off the snapshot. No derived game
 * state is invented here — if a number isn't already on `World` or computable by an existing
 * pure projection, it doesn't appear.
 */
export function renderStatus(world: World, opts: RenderOptions): string[] {
  const roles: [string, readonly { slot: { state: string } }[]][] = [
    ['Miller', world.millers],
    ['Baker', world.bakers],
    ['Courier', world.couriers],
    ['Journalist', world.journalists],
    ['Detective', world.detectives],
    ['Import/Ex', world.importExporters],
  ];
  const totalSlots = roles.reduce((sum, [, s]) => sum + s.length, 0);
  const totalFilled = roles.reduce((sum, [, s]) => sum + filledCount(s), 0);
  const tension = [...districtTensions(world).values()];
  const meanTension = tension.length ? tension.reduce((a, b) => a + b, 0) / tension.length : 0;

  const lines: string[] = [];
  lines.push(`Day ${world.tick}`);
  lines.push('');
  lines.push(`Population   ${world.population}`);
  lines.push(`Grifters     ${world.grifters.length}`);
  lines.push(`Roles held   ${totalFilled}/${totalSlots}`);
  lines.push('');
  lines.push(`Flour price  ${world.flourPrice.toFixed(3)}`);
  lines.push(`Health       ${bar(world.economicHealth, 12)} ${world.economicHealth.toFixed(3)}`);
  lines.push(`  w/ exp     ${bar(world.economicHealthWithExperience, 12)} ${world.economicHealthWithExperience.toFixed(3)}`);
  lines.push(`Tension      ${bar(meanTension, 12)} ${meanTension.toFixed(3)}`);
  lines.push(`Gini         ${bar(world.wealthGini, 12)} ${world.wealthGini.toFixed(3)}`);
  lines.push('');
  for (const [name, slots] of roles) {
    lines.push(`  ${name.padEnd(11)}${filledCount(slots)}/${slots.length}`);
  }
  lines.push('');
  lines.push('Events');
  const feed = opts.eventLog.slice(-8);
  if (feed.length === 0) lines.push('  (quiet)');
  for (const e of feed) lines.push(`  ${e}`);

  return lines;
}

// ---- Events ------------------------------------------------------------------------------

/**
 * Reads one stepped `World`'s own-tick `last*` fields into human lines. Pure — the caller
 * accumulates these across ticks, because a `World` snapshot only ever knows about its own
 * tick and deliberately keeps nothing older (the ephemerality several of these mechanics were
 * built around).
 */
export function collectEvents(world: World): string[] {
  const out: string[] = [];
  const d = world.tick;

  if (world.lastSabotage) {
    const s = world.lastSabotage;
    out.push(`d${d} sabotage on ${s.targetBuildingId}: ${s.witnesses} witnesses, ${s.successfulSaboteurs} through, ${s.evicted} evicted`);
  }
  if (world.lastRumourEvents.length > 0) out.push(`d${d} ${world.lastRumourEvents.length} rumour(s) heard`);
  if (world.lastProximityConversations.length > 0) out.push(`d${d} ${world.lastProximityConversations.length} overheard nearby`);
  if (world.lastDiaryWrites.length > 0) out.push(`d${d} ${world.lastDiaryWrites.length} diary entr(ies) written`);
  if (world.lastEmigrants > 0) out.push(`d${d} ${world.lastEmigrants} left the shard`);
  if (world.lastNewArrivals > 0) out.push(`d${d} ${world.lastNewArrivals} arrived`);

  // The Oracle is deliberately NOT in this feed. It draws every single day for every
  // eligible candidate, so a per-day line is routine, not news — and at real scale it
  // flooded the feed and buried the things that actually matter (sabotage, evictions,
  // arrivals). Found by looking at a real 220-day run, which is the entire point of this
  // harness existing. Its live numbers are on the status pane instead.

  return out;
}

// ---- Frame -------------------------------------------------------------------------------

const LEGEND = 'M B C J D X = roles   # Wall   + plaza   UPPER held  lower vacant  dim backstopped';
const KEYS = '[space] next day   [n] x10 days   [q] quit';

/**
 * One complete frame. Side-by-side when the terminal is wide enough for both panes, stacked
 * otherwise — the design doc's own "graceful degradation on a terminal narrower than the map"
 * requirement.
 */
export function renderFrame(world: World, opts: RenderOptions = DEFAULT_RENDER_OPTIONS): string {
  const heat = computeEconomicHeat(world);
  const map = renderMap(world, opts, heat);
  const status = renderStatus(world, opts);
  const mw = mapWidth(world);
  const gap = 3;
  const sideBySide = opts.width >= mw + gap + 34;

  const lines: string[] = [];
  lines.push(`NODE — shard ${world.shard.id}`);
  lines.push('');

  if (sideBySide) {
    const rows = Math.max(map.length, status.length);
    for (let i = 0; i < rows; i++) {
      // The map cell strings carry escape sequences, so their visible width is not their
      // string length — pad against the known geometry (mw) instead of measuring the string.
      const left = map[i] ?? '';
      const leftWidth = map[i] === undefined ? 0 : mw;
      lines.push(left + ' '.repeat(Math.max(0, mw - leftWidth) + gap) + (status[i] ?? ''));
    }
  } else {
    lines.push(...map);
    lines.push('');
    lines.push(...status);
  }

  lines.push('');
  lines.push(LEGEND);
  lines.push(KEYS);
  return lines.join('\n');
}
