import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { renderFrame, renderMap, shardBounds, mapWidth, collectEvents, CELL_WIDTH } from '../src/sim/playtestRenderer.js';
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
