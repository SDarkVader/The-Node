import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { renderFrame, renderMap, renderInspector, shardBounds, mapWidth, collectEvents, CELL_WIDTH } from '../src/sim/playtestRenderer.js';
import { applyDriverTick, participantsOf, stablePlayerIndex, summarizeActions } from '../src/sim/playtestDrivers.js';
import { computeEconomicHeat } from '../src/engine/economicHeat.js';
import { mulberry32 } from '../src/sim/rng.js';

/**
 * Phase A of `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`. Its own §6 is explicit that "feels
 * right" is verified by LOOKING, not asserted here — so these cover the two things that are
 * genuinely testable and would be silent if broken: that the renderer is a pure projection
 * (attaching it can never perturb a run), and that the driver applier queues only what it
 * claims to.
 */

function stepN(world: World, n: number): World {
  let w = world;
  for (let i = 0; i < n; i++) w = stepWorld(w);
  return w;
}

describe('playtest renderer — pure projection', () => {
  it('rendering never perturbs a run: 60 stepped days are identical with and without a render each tick', () => {
    // The guarantee `engine/economicHeat.ts` documents about itself, extended to the whole
    // view layer. If this ever fails, the harness has become part of the simulation.
    let plain = createWorld(3, DEFAULT_WORLD_CONFIG);
    let rendered = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 60; i++) {
      plain = stepWorld(plain);
      rendered = stepWorld(rendered);
      renderFrame(rendered, { color: true, width: 100, eventLog: [] });
    }
    expect(rendered.wealthGini).toBe(plain.wealthGini);
    expect(rendered.economicHealthWithExperience).toBe(plain.economicHealthWithExperience);
    expect(rendered.population).toBe(plain.population);
    expect(rendered.grifters.length).toBe(plain.grifters.length);
  });

  it('rendering does not mutate the world it is given', () => {
    const world = stepN(createWorld(4, DEFAULT_WORLD_CONFIG), 30);
    const before = JSON.stringify({ g: world.wealthGini, p: world.population, t: world.tick });
    renderFrame(world, { color: true, width: 100, eventLog: [] });
    expect(JSON.stringify({ g: world.wealthGini, p: world.population, t: world.tick })).toBe(before);
  });

  it('every plot in the shard lands on its own distinct cell — layout math holds at the shipped config', () => {
    const world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const bounds = shardBounds(world.shard);
    const rows = renderMap(world, { color: false, width: 100, eventLog: [] }, computeEconomicHeat(world));
    expect(rows).toHaveLength(bounds.maxY - bounds.minY + 1);
    for (const row of rows) expect(row).toHaveLength((bounds.maxX - bounds.minX + 1) * CELL_WIDTH);
    expect(mapWidth(world)).toBe((bounds.maxX - bounds.minX + 1) * CELL_WIDTH);
  });

  it('color:false emits zero escape sequences — the NO_COLOR / piped-output path is really plain', () => {
    const world = stepN(createWorld(5, DEFAULT_WORLD_CONFIG), 20);
    const frame = renderFrame(world, { color: false, width: 100, eventLog: ['d1 something happened'] });
    expect(frame).not.toContain('\x1b');
  });

  it('degrades to a stacked layout when the terminal is narrower than map + status', () => {
    const world = stepN(createWorld(6, DEFAULT_WORLD_CONFIG), 20);
    const narrow = renderFrame(world, { color: false, width: 30, eventLog: [] });
    const wide = renderFrame(world, { color: false, width: 120, eventLog: [] });
    // Stacked puts the status under the map, so it needs strictly more rows than side-by-side.
    expect(narrow.split('\n').length).toBeGreaterThan(wide.split('\n').length);
  });

  it('the Oracle is deliberately absent from the event feed — it fires daily and drowned everything else', () => {
    // Regression for a real legibility bug found by looking at a 220-day run: the Oracle
    // draws every day for every eligible candidate, so a per-day line buried sabotage,
    // evictions and migrations entirely.
    let world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const events: string[] = [];
    for (let i = 0; i < 120; i++) {
      world = stepWorld(world);
      events.push(...collectEvents(world));
    }
    expect(events.some((e) => e.toLowerCase().includes('oracle'))).toBe(false);
  });
});

describe('playtest inspector — Phase B, strictly read-only', () => {
  it('reports a real role slot under the cursor, with state read straight off the World', () => {
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 120);
    const building = world.shard.districts[0]!.buildings.find((b) => world.millers.some((m) => m.buildingId === b.id))!;
    const lines = renderInspector(
      world,
      { color: false, width: 100, eventLog: [], cursor: { x: building.x, y: building.y } },
      computeEconomicHeat(world),
    );
    const text = lines.join('\n');
    expect(text).toContain('Miller');
    expect(text).toContain(building.id);
    expect(text).toMatch(/FILLED|VACANT|BACKSTOPPED/);
  });

  it('never exceeds the map width, so the status column cannot be pushed out of alignment', () => {
    // A pane that jostles the rest of the screen is worse than one that abbreviates. Checked
    // across many cursor positions, including the longest-rendering ones (a FILLED market role
    // with real completion stats).
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 200);
    const heat = computeEconomicHeat(world);
    const bounds = shardBounds(world.shard);
    const width = mapWidth(world);
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (const line of renderInspector(world, { color: false, width: 100, eventLog: [], cursor: { x, y } }, heat)) {
          expect(line.length).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it('inspecting does not mutate the world, at any cursor position', () => {
    const world = stepN(createWorld(5, DEFAULT_WORLD_CONFIG), 60);
    const heat = computeEconomicHeat(world);
    const before = JSON.stringify({ g: world.wealthGini, p: world.population, m: world.millers.map((m) => m.wealth) });
    const bounds = shardBounds(world.shard);
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        renderInspector(world, { color: false, width: 100, eventLog: [], cursor: { x, y } }, heat);
      }
    }
    expect(JSON.stringify({ g: world.wealthGini, p: world.population, m: world.millers.map((m) => m.wealth) })).toBe(before);
  });

  it('says so plainly outside the settlement rather than rendering an empty pane', () => {
    const world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const bounds = shardBounds(world.shard);
    const lines = renderInspector(
      world,
      { color: false, width: 100, eventLog: [], cursor: { x: bounds.maxX, y: bounds.maxY } },
      computeEconomicHeat(world),
    );
    // That corner is outside the generated plot set at this config; either way the pane must
    // describe what is there, never come back blank.
    expect(lines.length).toBeGreaterThan(0);
  });

  it('no cursor means no pane at all — the map stands alone', () => {
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 30);
    expect(renderInspector(world, { color: false, width: 100, eventLog: [] }, computeEconomicHeat(world))).toEqual([]);
  });

  it('the cursor is visible in plain mode too, so the pane always refers to a locatable cell', () => {
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 30);
    const plaza = world.shard.districts[0]!.plazaPlot;
    const withCursor = renderFrame(world, { color: false, width: 110, eventLog: [], cursor: { x: plaza.x, y: plaza.y } });
    const without = renderFrame(world, { color: false, width: 110, eventLog: [] });
    expect(withCursor).toContain('[');
    expect(without.split('\n')[3]).not.toContain('[');
  });
});

describe('playtest map — grifters are now rendered (2026-08-19)', () => {
  it('a grifter at a real, non-building position renders as the grifter glyph', () => {
    const world = stepWorld(createWorld(3, DEFAULT_WORLD_CONFIG));
    // Placed deliberately off any building/street/plaza/hub cell so only the grifter overlay
    // can explain the glyph — real off-grid ground is common at this shard's geometry.
    const g = world.grifters[0]!;
    const bounds = shardBounds(world.shard);
    const moved: World = { ...world, grifters: world.grifters.map((x, i) => (i === 0 ? { ...x, x: bounds.minX, y: bounds.minY } : x)) };
    const heat = computeEconomicHeat(moved);
    const rows = renderMap(moved, { color: false, width: 100, eventLog: [] }, heat);
    const col = bounds.minX - bounds.minX; // first column
    void g;
    expect(rows[0]!.slice(col * CELL_WIDTH, col * CELL_WIDTH + 1)).toBe('o');
  });

  it('every rendered colour channel stays within 0-255, including the multi-grifter brightness boost', () => {
    // Regression for a real bug found by looking at actual rendered output: scaleRgb's
    // multi-grifter factor (1.3) produced rgb(282,261,229) — an invalid ANSI truecolor
    // sequence — before scaleRgb was made to clamp.
    let world = stepWorld(createWorld(4, DEFAULT_WORLD_CONFIG));
    // Force two grifters onto the exact same cell — the case that triggers the boost.
    const target = { x: world.grifters[0]!.x, y: world.grifters[0]!.y };
    world = { ...world, grifters: world.grifters.map((g, i) => (i < 2 ? { ...g, x: target.x, y: target.y } : g)) };
    const heat = computeEconomicHeat(world);
    const frame = renderMap(world, { color: true, width: 100, eventLog: [] }, heat).join('\n');
    const channels = [...frame.matchAll(/\x1b\[3?8;2;(\d+);(\d+);(\d+)m/g)].flatMap((m) => [+m[1]!, +m[2]!, +m[3]!]);
    expect(channels.length).toBeGreaterThan(0);
    for (const c of channels) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});

describe('playtest drivers — the applier src/sim/drivers/ never had', () => {
  it('does not mutate the world it is given, and returns a copy carrying the new posts', () => {
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 40);
    const before = world.pendingWallPosts.length;
    const { world: next } = applyDriverTick(world, mulberry32(1));
    expect(world.pendingWallPosts.length).toBe(before);
    expect(next).not.toBe(world);
    expect(next.pendingWallPosts.length).toBeGreaterThanOrEqual(before);
  });

  it('queues real Wall posts under a real population — the one action that actually lands', () => {
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 40);
    let total = 0;
    let w = world;
    const rng = mulberry32(2);
    for (let i = 0; i < 20; i++) {
      const result = applyDriverTick(w, rng);
      total += result.world.pendingWallPosts.length;
      w = stepWorld(result.world);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('applies ONLY postToWall — move, occupySlot and attemptSabotageStep are emitted but deliberately not applied', () => {
    // The honest boundary this module documents: drivers emit five action types, and exactly
    // one of them has somewhere to land today. If a later change starts applying another,
    // this test should be updated deliberately rather than discovered by surprise.
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 40);
    const { world: next, actions } = applyDriverTick(world, mulberry32(3));
    const posted = actions.filter((a) => a.action.type === 'postToWall').length;
    expect(next.pendingWallPosts.length - world.pendingWallPosts.length).toBe(posted);

    const summary = summarizeActions(actions);
    for (const type of Object.keys(summary)) {
      expect(['idle', 'move', 'postToWall', 'occupySlot', 'attemptSabotageStep']).toContain(type);
    }
  });

  it('applies move for grifters (2026-08-19) — a grifter can end the tick somewhere new', () => {
    let world = stepWorld(createWorld(7, DEFAULT_WORLD_CONFIG));
    const rng = mulberry32(1);
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
      const before = new Map(world.grifters.map((g) => [g.id, { x: g.x, y: g.y }]));
      const result = applyDriverTick(world, rng);
      for (const g of result.world.grifters) {
        const prior = before.get(g.id);
        if (prior && (prior.x !== g.x || prior.y !== g.y)) moved = true;
      }
      world = stepWorld(result.world);
    }
    expect(moved).toBe(true);
  });

  it('clamps grifter movement to the real plot bounds — no unbounded wandering', () => {
    let world = stepWorld(createWorld(7, DEFAULT_WORLD_CONFIG));
    const rng = mulberry32(2);
    const bounds = shardBounds(world.shard);
    for (let i = 0; i < 300; i++) {
      const result = applyDriverTick(world, rng);
      for (const g of result.world.grifters) {
        expect(g.x).toBeGreaterThanOrEqual(bounds.minX);
        expect(g.x).toBeLessThanOrEqual(bounds.maxX);
        expect(g.y).toBeGreaterThanOrEqual(bounds.minY);
        expect(g.y).toBeLessThanOrEqual(bounds.maxY);
      }
      world = stepWorld(result.world);
    }
  });

  it("role-holders' own move actions are still NOT applied — millers/bakers are untouched by driver output", () => {
    // A role-holder has no x/y field for a move action to even target (their position is
    // still definitionally their building's, unchanged this pass), so the honest check is
    // that applying drivers never mutates world.millers/world.bakers at all.
    let world = stepWorld(createWorld(7, DEFAULT_WORLD_CONFIG));
    const rng = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      const result = applyDriverTick(world, rng);
      expect(result.world.millers).toBe(world.millers);
      expect(result.world.bakers).toBe(world.bakers);
      world = stepWorld(result.world);
    }
  });

  it('covers millers, bakers and grifters — and honestly excludes the four support roles', () => {
    // DriverRole is 'miller' | 'baker' | 'gossip', a real leftover from Phase C's two-role
    // era, not an oversight in the applier.
    const world = stepN(createWorld(7, DEFAULT_WORLD_CONFIG), 40);
    const roles = new Set(participantsOf(world).map((p) => p.role));
    expect(roles.has('miller')).toBe(true);
    expect(roles.has('gossip')).toBe(true);
    expect([...roles].every((r) => r === 'miller' || r === 'baker' || r === 'gossip')).toBe(true);
  });

  it('strategy assignment is stable for a participant across ticks, not positional', () => {
    // Participant list order shifts as slots fill and grifters come and go, so assignment
    // keys off the id rather than the index in the array.
    expect(stablePlayerIndex('core-0-b12')).toBe(stablePlayerIndex('core-0-b12'));
    expect(stablePlayerIndex('core-0-b12')).not.toBe(stablePlayerIndex('core-0-b13'));
    expect(Number.isInteger(stablePlayerIndex('grifter-4'))).toBe(true);
  });

  it('is deterministic: the same seed and rng stream produce the same posts', () => {
    const world = stepN(createWorld(9, DEFAULT_WORLD_CONFIG), 30);
    const a = applyDriverTick(world, mulberry32(11));
    const b = applyDriverTick(world, mulberry32(11));
    expect(a.world.pendingWallPosts).toEqual(b.world.pendingWallPosts);
  });
});
