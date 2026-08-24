/**
 * Does the Godot client read fields the server actually sends? (2026-08-19)
 *
 * WHY THIS EXISTS. Godot is not installed in the environment this client was written in, so it
 * could not be run, and a GDScript typo — `economicHealth` vs `economic_health`, `buildingId`
 * vs `building_id` — fails silently at runtime as a null or a zero rather than loudly. That is
 * the single most likely way this client breaks, and it is exactly the class of bug a static
 * check can catch without a game engine.
 *
 * This is NOT a substitute for looking at the thing. It cannot tell you the town renders
 * legibly, that the palette reads well, or that the camera feels right. Visual verification is
 * still owed, on a machine with Godot. What this guarantees is narrower and still worth having:
 * every key the client reaches for is a key the protocol emits, and the enum values it
 * branches on are values the protocol produces.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorld, stepWorld } from '../src/world/world.js';
import { helloMessage, tickMessage, skyMessage } from '../src/server/worldProtocol.js';
import { createShardRegistry, openNewShard } from '../src/engine/shardRegistry.js';

const GD_PATH = new URL('../client/scripts/WorldView.gd', import.meta.url);
/**
 * `IsoView.tscn` is the client's REAL `run/main_scene` (`client/project.godot`) — checked
 * against the actual file rather than assumed, because `docs/HANDOVER.md` and
 * `client/README.md` both still (2026-08-24) describe `WorldView.tscn` as "the main scene",
 * which was true until `94bbed0` repointed `project.godot` at the isometric 3D view and neither
 * doc was updated. This test file had ONLY ever scanned `WorldView.gd` — a real, pre-existing
 * gap where the client someone actually runs was never checked for wire-key conformance at all.
 * Closed here for the field this session touches (`targetPopulationPerShard`, `sky`); a full
 * conformance audit of `IsoView.gd`'s pre-existing hello/tick handling is a separate, broader
 * task not attempted here — see `docs/DEVLOG.md`'s matching entry.
 */
const ISO_GD_PATH = new URL('../client/scripts/IsoView.gd', import.meta.url);
/** SkyLayer.gd is shared, unmodified, by both scenes (see its own header) — one drawing script,
 *  read by both WorldView.gd's and IsoView.gd's `Sky/SkyDraw` child node. */
const SKY_GD_PATH = new URL('../client/scripts/SkyLayer.gd', import.meta.url);

/** Every key present anywhere in a message, at any depth. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysOf(v, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

/** String literals the GDScript uses to index into a parsed message. */
function accessedKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const m of source.matchAll(/\.get\(\s*"([^"]+)"/g)) keys.add(m[1]!);
  for (const m of source.matchAll(/\[\s*"([^"]+)"\s*\]/g)) keys.add(m[1]!);
  return keys;
}

function realMessages() {
  let w = createWorld(3);
  for (let i = 0; i < 120; i++) w = stepWorld(w);
  let registry = createShardRegistry(w.config.targetPopulation);
  registry = openNewShard(registry, 10); // a DORMANT shard too, so `health: null` is exercised
  const worlds = new Map([[0, w], [1, createWorld(4)]]); // shard 2 (DORMANT) genuinely has no World
  return {
    hello: helloMessage(w),
    tick: tickMessage(w, 'conformance'),
    sky: skyMessage(registry, worlds, 0),
    world: w,
  };
}

describe('Godot client / wire protocol conformance', () => {
  it('every key the client reads is a key the protocol actually sends', () => {
    const source =
      readFileSync(GD_PATH, 'utf8') + readFileSync(ISO_GD_PATH, 'utf8') + readFileSync(SKY_GD_PATH, 'utf8');
    const { hello, tick, sky } = realMessages();
    const emitted = new Set([...keysOf(hello), ...keysOf(tick), ...keysOf(sky)]);

    // Literals that are VALUES rather than keys — the client compares against these, it does
    // not index with them. Listed explicitly so a genuine typo cannot hide among them.
    const valueLiterals = new Set([
      'hello',
      'tick',
      'plaza',
      'FILLED',
      'BACKSTOPPED',
      'VACANT',
      'ACTIVE',
      'DORMANT',
      'miller',
      'baker',
      'courier',
      'journalist',
      'detective',
      'importExport',
      'minX',
      'minY',
      'maxX',
      'maxY',
      'x',
      'y',
      // IsoView.gd's own internal bookkeeping dict (`ranked`, in `_update_dynamic`) — station
      // lights sorted by heat for the current frame. Not a wire key at all; flagged here rather
      // than silently widening `emitted` so a genuine future typo in THIS dict still has
      // somewhere to be caught (it just isn't this check's job).
      'pos',
    ]);

    const unknown = [...accessedKeys(source)].filter((k) => !emitted.has(k) && !valueLiterals.has(k));
    expect(unknown).toEqual([]);
  });

  it('the sky message: every key SkyLayer.gd reads is a key skyMessage actually sends, including the null-health case', () => {
    const skySource = readFileSync(SKY_GD_PATH, 'utf8');
    const { sky } = realMessages();
    expect(sky.siblings.some((s) => s.health === null)).toBe(true); // exercised, not assumed
    expect(sky.siblings.some((s) => s.health !== null)).toBe(true);
    for (const required of ['id', 'state', 'population', 'health']) {
      expect(skySource).toContain(`"${required}"`);
    }
    for (const state of new Set(sky.siblings.map((s) => s.state))) {
      expect(skySource).toContain(`"${state}"`);
    }
  });

  it('reads the fields it actually needs — a silently-empty render would pass a key check alone', () => {
    const source = readFileSync(GD_PATH, 'utf8');
    // The minimum set without which the client draws nothing meaningful.
    for (const required of ['plots', 'buildings', 'hub', 'stations', 'people', 'economicHealth', 'districtTension']) {
      expect(source).toContain(`"${required}"`);
    }
  });

  it('the real main scene (IsoView.gd) reads the same minimum set, and the new sky field', () => {
    const source = readFileSync(ISO_GD_PATH, 'utf8');
    for (const required of ['plots', 'buildings', 'hub', 'stations', 'people', 'economicHealth', 'districtTension']) {
      expect(source).toContain(`"${required}"`);
    }
    expect(source).toContain('"targetPopulationPerShard"');
    expect(source).toContain('"sky"');
  });

  it('branches on exactly the slot states the protocol emits, no more and no fewer', () => {
    const source = readFileSync(GD_PATH, 'utf8');
    const { tick } = realMessages();
    const emittedStates = new Set(tick.stations.map((s) => s.state));
    expect(emittedStates.size).toBeGreaterThan(0);
    for (const state of emittedStates) expect(source).toContain(`"${state}"`);
  });

  it('knows every role the protocol can label a building with', () => {
    const source = readFileSync(GD_PATH, 'utf8');
    const { hello } = realMessages();
    const roles = new Set(hello.buildings.map((b) => b.role).filter((r): r is NonNullable<typeof r> => r !== null));
    expect(roles.size).toBe(5);
    for (const role of roles) expect(source).toContain(`"${role}"`);
  });

  it('uses the shipped Ember palette values, not invented ones', () => {
    // Two renderers of the same world must not disagree about what "hot" looks like. These are
    // the real constants from src/sim/playtestRenderer.ts.
    const source = readFileSync(GD_PATH, 'utf8');
    for (const rgb of [
      'Color8(255, 171, 62)', // HEAT_HOT
      'Color8(74, 107, 122)', // HEAT_COOL
      'Color8(239, 220, 174)', // COLOUR_WALL
      'Color8(176, 144, 86)', // COLOUR_PLAZA
      'Color8(217, 201, 176)', // COLOUR_GRIFTER
      'Color8(20, 38, 66)', // TENSION_COLD
      'Color8(40, 30, 20)', // TENSION_EMBER
      'Color8(104, 28, 18)', // TENSION_HOT
    ]) {
      expect(source).toContain(rgb);
    }
  });
});
