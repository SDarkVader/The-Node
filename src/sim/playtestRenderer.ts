import type { World, RoleEconomicSlot, SupportRoleSlot } from '../world/world.js';
import { computeEconomicHeat, type EconomicHeatField } from '../engine/economicHeat.js';
import { completionRatio, TYPICAL_COMPLETION_RATIO, type CompletionRoleType } from '../engine/roleCompletion.js';
import { knownFraction } from '../engine/pressureDetection.js';
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
  /** Phase B: the inspection cursor's world position, or undefined for no cursor. Held by the
   *  caller (the CLI owns input); this module only draws it and reports what is under it. */
  cursor?: { x: number; y: number };
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

/**
 * The EMBER palette (chosen 2026-08-18 from four directions explored on a real-data design
 * canvas — Ember / Signal / Phosphor / Ledger). Warm, low, lamplit: the settlement reads as a
 * town at dusk, and scarcity glows. Kept dark on purpose so foreground glyphs stay legible on
 * top of the background at every tension value.
 */
const TENSION_CALM: Rgb = [20, 16, 12];
const TENSION_TENSE: Rgb = [67, 23, 15];

/** Foreground ramp for role buildings: cool/supplied -> hot/scarce. Matches the addendum's
 *  "read scarcity from the plaza" intent — a hot station is visibly hot. */
const HEAT_COOL: Rgb = [74, 107, 122];
const HEAT_HOT: Rgb = [255, 171, 62];

/** The inspection cursor. Deliberately a lifted, warmer ground rather than a full inversion —
 *  Ember's whole point is that nothing in the node is high-contrast, and an inverted block
 *  would read as a UI element sitting on top of the town rather than a light moved across it. */
const CURSOR_BG: Rgb = [92, 62, 34];
const CURSOR_EMPTY_FG: Rgb = [150, 120, 88];

const COLOUR_WALL: Rgb = [239, 220, 174];
const COLOUR_PLAZA: Rgb = [176, 144, 86];
const COLOUR_STREET: Rgb = [47, 40, 34];
/** A real building carrying no role slot — 16 of the shipped config's 62. */
const COLOUR_PLAIN: Rgb = [74, 64, 56];
/** A grifter — reuses Ember's own ink tone (otherwise only used for UI text), deliberately
 *  distinct from every other map hue: not on the heat ramp (they aren't a role, so "scarcity"
 *  doesn't apply to them), not the Wall's pale gold, not the plaza's ochre. */
const COLOUR_GRIFTER: Rgb = [217, 201, 176];

/**
 * AUTO-RANGING, and why it is on by default.
 *
 * Both mood fields have far less dynamic range than their 0..1 scale suggests. Measured on a
 * real 220-day run at `DEFAULT_WORLD_CONFIG`: district tension sat at 0.08, and economic heat
 * spanned 0 to 0.499 — and reads exactly 0 for all four support roles while the district is
 * healthy, since their heat derives from consolidation friction that simply isn't present.
 * Mapped naively onto the full ramp, the entire node renders flat and near-monochrome, which
 * defeats the whole "read scarcity from the plaza rather than computing it from numbers"
 * intent this view exists to serve.
 *
 * So both signals are normalized against their OBSERVED maxima rather than their theoretical
 * ones. [CALIBRATED — provisional]: these are two measurements from one config, not a
 * derivation — if the economy is retuned, re-measure them. The honest tradeoff, stated rather
 * than hidden: a genuinely calm shard no longer looks calm, because calm is now the bottom of
 * a stretched scale rather than the bottom of an absolute one.
 */
export const HEAT_OBSERVED_MAX = 0.5;
export const TENSION_OBSERVED_MAX = 0.25;

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
  // Clamped: every existing caller scales by <=1 (STATE_BRIGHTNESS), which never overflows,
  // but a >1 factor (the multi-grifter brightness boost) can genuinely push a channel past
  // 255 — found live, `rgb(282,261,229)`, an invalid ANSI truecolor sequence.
  const c8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [c8(c[0] * factor), c8(c[1] * factor), c8(c[2] * factor)];
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

  // 2026-08-19: the first population ever rendered on this map that isn't a role slot.
  // Deliberately drawn on top of open ground only (plaza/street), never over a building or the
  // hub — those are fixed points a person can stand AT, not be indistinguishable from.
  const grifterCountAt = new Map<string, number>();
  for (const g of world.grifters) {
    const key = `${g.x},${g.y}`;
    grifterCountAt.set(key, (grifterCountAt.get(key) ?? 0) + 1);
  }

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
        colour = COLOUR_WALL;
      } else if (building) {
        glyph = building.state === 'VACANT' ? building.glyph.toLowerCase() : building.glyph;
        const t = Math.min(1, building.heat / HEAT_OBSERVED_MAX);
        colour = scaleRgb(lerpRgb(HEAT_COOL, HEAT_HOT, t), STATE_BRIGHTNESS[building.state]);
      } else if (buildingId) {
        glyph = '.'; // a real building with no role slot attached to it
        colour = COLOUR_PLAIN;
      } else if (grifterCountAt.has(key)) {
        glyph = 'o';
        colour = grifterCountAt.get(key)! > 1 ? scaleRgb(COLOUR_GRIFTER, 1.3) : COLOUR_GRIFTER;
      } else if (plazaAt.has(key)) {
        glyph = '+';
        colour = COLOUR_PLAZA;
      } else if (plot) {
        glyph = ':';
        colour = COLOUR_STREET;
      }

      const onCursor = opts.cursor !== undefined && opts.cursor.x === x && opts.cursor.y === y;

      if (!opts.color) {
        // Plain mode still has to show the cursor, or the inspection pane refers to a cell
        // nobody can locate. Brackets are the only affordance available without colour.
        line += onCursor ? `[${glyph}` : glyph + pad;
        continue;
      }

      // Outside the settlement entirely: emit plain spaces rather than a coloured run —
      // there is nothing there to tint, and the escapes were pure noise on the wire. The
      // cursor still draws, so it can be moved across empty ground.
      if (!plot && key !== hubKey && !onCursor) {
        line += ' '.repeat(CELL_WIDTH);
        continue;
      }

      const raw = plot ? (tensions.get(plot.districtId) ?? 0) : 0;
      const tension = Math.min(1, raw / TENSION_OBSERVED_MAX);
      const cellBg = onCursor ? CURSOR_BG : lerpRgb(TENSION_CALM, TENSION_TENSE, tension);
      const cellFg = onCursor && glyph === ' ' ? CURSOR_EMPTY_FG : colour;
      const cellGlyph = onCursor && glyph === ' ' ? '·' : glyph;
      line += `${bg(cellBg)}${fg(cellFg)}${cellGlyph}${pad}${RESET}`;
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
  // Drawn against the same stretched scale the map's background uses, so the meter and the
  // colour agree — a bar filling while the node stays visually calm would be a lie.
  lines.push(`Tension      ${bar(meanTension, 12, TENSION_OBSERVED_MAX)} ${meanTension.toFixed(3)}`);
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

// ---- Inspection (Phase B) ----------------------------------------------------------------

const ROLE_NAMES: Record<RoleGlyph, string> = {
  M: 'Miller',
  B: 'Baker',
  C: 'Courier',
  J: 'Journalist',
  D: 'Detective',
  X: 'Import/Export',
};

/** Which of `World`'s six role arrays holds this building, plus the slot itself. Role is only
 *  ever derivable this way — `space.ts` keeps `Building.roleSlotRef` deliberately opaque. */
function roleSlotFor(
  world: World,
  buildingId: string,
): { glyph: RoleGlyph; role: CompletionRoleType; slot: RoleEconomicSlot | SupportRoleSlot } | undefined {
  const groups: [RoleGlyph, CompletionRoleType, readonly (RoleEconomicSlot | SupportRoleSlot)[]][] = [
    ['M', 'miller', world.millers],
    ['B', 'baker', world.bakers],
    ['C', 'courier', world.couriers],
    ['J', 'journalist', world.journalists],
    ['D', 'detective', world.detectives],
    ['X', 'importExport', world.importExporters],
  ];
  for (const [glyph, role, slots] of groups) {
    const slot = slots.find((s) => s.buildingId === buildingId);
    if (slot) return { glyph, role, slot };
  }
  return undefined;
}

/**
 * What is actually under the cursor, read straight off the `World` snapshot. Nothing is
 * derived or invented here beyond calling existing pure projections (`completionRatio`,
 * `knownFraction`, `computeEconomicHeat`) — this pane's job is to make already-real state
 * legible, which is the whole of Phase B.
 *
 * A REAL LIMITATION, surfaced rather than hidden: grifters cannot be inspected, because they
 * have no coordinates anywhere in this engine — they carry a housing `districtId` and nothing
 * finer (`world.ts`'s own header). At the shipped config that is 20-26 of ~64 people who are
 * simply not on the map. The status pane's own grifter count is the only view of them.
 */
export function renderInspector(world: World, opts: RenderOptions, heat: EconomicHeatField): string[] {
  if (!opts.cursor) return [];
  const { x, y } = opts.cursor;
  // Hard-capped to the map's own width so the status column never shifts as the cursor moves.
  // A pane that jostles the rest of the screen is worse than one that abbreviates.
  const width = mapWidth(world);
  const out: string[] = [];
  const push = (s: string) => out.push(s.length > width ? s.slice(0, width) : s);

  const label = ` (${x}, ${y}) `;
  push(`──${label}${'─'.repeat(Math.max(0, width - 2 - label.length))}`);

  const district = world.shard.districts.find((d) => d.plots.some((p) => p.x === x && p.y === y));
  const building = world.shard.districts.flatMap((d) => d.buildings).find((b) => b.x === x && b.y === y);
  const isHub = world.shard.hubPlot.x === x && world.shard.hubPlot.y === y;
  const isPlaza = world.shard.districts.some((d) => d.plazaPlot.x === x && d.plazaPlot.y === y);

  if (isHub) push('  The Wall — shard hub');
  if (!district && !building) {
    push('  outside the settlement');
    return out;
  }
  if (district) {
    const tension = district.weatherHistory.at(-1)?.tension ?? 0;
    push(`  ${district.id} (${district.classification})`);
    push(`  tension ${tension.toFixed(3)}  pop ${district.population}`);
  }

  if (!building) {
    push(isPlaza ? '  the plaza' : isHub ? '  open ground' : '  street');
    return out;
  }

  const found = roleSlotFor(world, building.id);
  if (!found) {
    push(`  ${building.id} — no role`);
    push(`  ${building.floors} residential floors`);
    return out;
  }

  const { glyph, role, slot } = found;
  const stats = world.completionStats[building.id];
  push(`  ${ROLE_NAMES[glyph]} — ${slot.slot.state}`);
  push(`  ${building.id}`);
  push(`  wealth ${slot.wealth.toFixed(2)}  stock ${slot.personalResourceStock}`);
  push(`  in role ${slot.daysInRole}d`);
  if ('experience' in slot) push(`  exp ${slot.experience.toFixed(3)}  val ${slot.value.toFixed(3)}`);
  push(`  heat ${(heat[building.id] ?? 0).toFixed(3)}`);
  push(
    stats && stats.attempts > 0
      ? `  done ${(completionRatio(stats) * 100).toFixed(0)}% of ${stats.attempts} (typ ${(TYPICAL_COMPLETION_RATIO[role] * 100).toFixed(0)}%)`
      : '  done — no attempts yet',
  );
  push(`  known to ${(knownFraction(world.identityLedger, building.id) * 100).toFixed(0)}% of node`);
  if (slot.slot.state !== 'FILLED' && slot.slot.vacantSince !== null) {
    push(`  empty since day ${slot.slot.vacantSince}`);
  }

  // A DESIGNER'S X-RAY, and worth being clear about: a real player could never see this. A
  // sabotage campaign is covert by design — that is the entire mechanic. It is shown here
  // because this harness is an instrument for building the game, not the player's view of it.
  const campaign = world.sabotageCampaigns.find((c) => c.targetBuildingId === building.id);
  if (campaign) {
    push(`  ⚠ campaign ${campaign.stepsCompleted}/${campaign.stepsRequired} since d${campaign.startedDay}`);
    push(campaign.investigatedBy ? '  ⚠ a detective is on it' : '  ⚠ nobody is investigating');
  }
  return out;
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

  // Campaign events, not `lastSabotage` — richer, and a campaign now has a life worth watching
  // (opened -> caught | succeeded) rather than only an outcome.
  for (const e of world.lastSabotageCampaignEvents) {
    if (e.type === 'opened') out.push(`d${d} someone starts working on ${e.targetBuildingId} (${e.witnesses} nearby)`);
    else if (e.type === 'caught') out.push(`d${d} caught at ${e.targetBuildingId}, step ${e.atStep} (${e.witnesses} nearby)`);
    else if (e.type === 'abandoned') out.push(`d${d} gave up on ${e.targetBuildingId} — already gone`);
    else out.push(`d${d} ${e.targetBuildingId} FORCED OUT after ${e.atStep} steps`);
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

const LEGEND = 'M B C J D X = roles   # Wall   + plaza   o grifter   UPPER held  lower vacant  dim backstopped';
const KEYS = '[space] day  [n] x10  [hjkl/arrows] look  [i] cursor  [d] drivers  [q] quit';

/**
 * One complete frame. Side-by-side when the terminal is wide enough for both panes, stacked
 * otherwise — the design doc's own "graceful degradation on a terminal narrower than the map"
 * requirement.
 */
export function renderFrame(world: World, opts: RenderOptions = DEFAULT_RENDER_OPTIONS): string {
  const heat = computeEconomicHeat(world);
  const map = renderMap(world, opts, heat);
  const status = renderStatus(world, opts);
  const inspector = renderInspector(world, opts, heat);
  const mw = mapWidth(world);
  const gap = 3;
  const sideBySide = opts.width >= mw + gap + 34;

  const lines: string[] = [];
  lines.push(`NODE — shard ${world.shard.id}`);
  lines.push('');

  if (sideBySide) {
    // The map column carries the inspector beneath it, so the map's own position on screen
    // never shifts as the cursor moves on and off something inspectable.
    const left = inspector.length > 0 ? [...map, '', ...inspector] : map;
    const rows = Math.max(left.length, status.length);
    for (let i = 0; i < rows; i++) {
      // Map cell strings carry escape sequences, so visible width is not string length — pad
      // against known geometry for map rows, and against real length for the plain-text
      // inspector rows below them.
      const row = left[i] ?? '';
      const visibleWidth = row === '' ? 0 : i < map.length ? mw : row.length;
      lines.push(row + ' '.repeat(Math.max(0, mw - visibleWidth) + gap) + (status[i] ?? ''));
    }
  } else {
    lines.push(...map);
    if (inspector.length > 0) {
      lines.push('');
      lines.push(...inspector);
    }
    lines.push('');
    lines.push(...status);
  }

  lines.push('');
  lines.push(LEGEND);
  lines.push(KEYS);
  return lines.join('\n');
}
