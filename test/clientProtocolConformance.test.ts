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
import { helloMessage, tickMessage } from '../src/server/worldProtocol.js';

const GD_PATH = new URL('../client/scripts/WorldView.gd', import.meta.url);

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
  return { hello: helloMessage(w), tick: tickMessage(w, 'conformance'), world: w };
}

describe('Godot client / wire protocol conformance', () => {
  it('every key the client reads is a key the protocol actually sends', () => {
    const source = readFileSync(GD_PATH, 'utf8');
    const { hello, tick } = realMessages();
    const emitted = new Set([...keysOf(hello), ...keysOf(tick)]);

    // Literals that are VALUES rather than keys — the client compares against these, it does
    // not index with them. Listed explicitly so a genuine typo cannot hide among them.
    const valueLiterals = new Set([
      'hello',
      'tick',
      'plaza',
      'FILLED',
      'BACKSTOPPED',
      'VACANT',
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
    ]);

    const unknown = [...accessedKeys(source)].filter((k) => !emitted.has(k) && !valueLiterals.has(k));
    expect(unknown).toEqual([]);
  });

  it('reads the fields it actually needs — a silently-empty render would pass a key check alone', () => {
    const source = readFileSync(GD_PATH, 'utf8');
    // The minimum set without which the client draws nothing meaningful.
    for (const required of ['plots', 'buildings', 'hub', 'stations', 'people', 'economicHealth', 'districtTension']) {
      expect(source).toContain(`"${required}"`);
    }
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
    expect(roles.size).toBe(6);
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
    ]) {
      expect(source).toContain(rgb);
    }
  });
});
