import { describe, expect, it } from 'vitest';
import {
  emptyIdentityLedger,
  recordEncounter,
  encounterCount,
  resolvedSubjects,
  generateFace,
  IDENTITY_RESOLUTION_THRESHOLD,
  FACE_SHAPE_COUNT,
  HAIR_STYLE_COUNT,
  MARK_COUNT_MAX,
} from '../src/engine/identity.js';
import { isKnown } from '../src/engine/player.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import type { WallPost } from '../src/comms/grammar.js';

/**
 * Regression tests for the Silhouette Shield's trigger condition (2026-08-11, Design
 * Addendum item 1) — verified in isolation before trusting it wired into `world.ts`, per
 * CLAUDE.md constraint 1.
 */

describe('recordEncounter / encounterCount', () => {
  it('starts at 0 for any pair', () => {
    expect(encounterCount(emptyIdentityLedger(), 'wren', 'sable')).toBe(0);
  });

  it('increments only the observer->subject direction', () => {
    let ledger = emptyIdentityLedger();
    ledger = recordEncounter(ledger, 'wren', 'sable');
    expect(encounterCount(ledger, 'wren', 'sable')).toBe(1);
    expect(encounterCount(ledger, 'sable', 'wren')).toBe(0);
  });

  it('accumulates across repeated encounters', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < 3; i++) ledger = recordEncounter(ledger, 'wren', 'sable');
    expect(encounterCount(ledger, 'wren', 'sable')).toBe(3);
  });

  it('is a no-op for a self-encounter', () => {
    const ledger = recordEncounter(emptyIdentityLedger(), 'wren', 'wren');
    expect(encounterCount(ledger, 'wren', 'wren')).toBe(0);
  });

  it('does not mutate the ledger passed in', () => {
    const before = emptyIdentityLedger();
    recordEncounter(before, 'wren', 'sable');
    expect(encounterCount(before, 'wren', 'sable')).toBe(0);
  });

  it('tracks multiple subjects per observer independently', () => {
    let ledger = emptyIdentityLedger();
    ledger = recordEncounter(ledger, 'wren', 'sable');
    ledger = recordEncounter(ledger, 'wren', 'idris');
    ledger = recordEncounter(ledger, 'wren', 'idris');
    expect(encounterCount(ledger, 'wren', 'sable')).toBe(1);
    expect(encounterCount(ledger, 'wren', 'idris')).toBe(2);
  });
});

describe('resolvedSubjects — the real trigger condition', () => {
  it('is empty below the threshold', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD - 1; i++) ledger = recordEncounter(ledger, 'wren', 'sable');
    expect(resolvedSubjects(ledger, 'wren').has('sable')).toBe(false);
  });

  it('resolves exactly at the threshold, never a day earlier or a day late', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD; i++) ledger = recordEncounter(ledger, 'wren', 'sable');
    expect(resolvedSubjects(ledger, 'wren').has('sable')).toBe(true);
  });

  it('never a timer or manual toggle — an observer with zero real encounters resolves nobody, however many days pass', () => {
    const ledger = emptyIdentityLedger();
    expect(resolvedSubjects(ledger, 'wren').size).toBe(0);
  });

  it('is per-pair and asymmetric-capable: A resolving B does not imply B has resolved A', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD; i++) ledger = recordEncounter(ledger, 'wren', 'sable');
    expect(resolvedSubjects(ledger, 'wren').has('sable')).toBe(true);
    expect(resolvedSubjects(ledger, 'sable').has('wren')).toBe(false);
  });

  it('composes directly with isKnown() — the derived set is exactly what isKnown expects', () => {
    let ledger = emptyIdentityLedger();
    for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD; i++) ledger = recordEncounter(ledger, 'wren', 'sable');
    const wrenKnows = resolvedSubjects(ledger, 'wren');
    expect(isKnown('sable', wrenKnows)).toBe('known');
    expect(isKnown('idris', wrenKnows)).toBe('unknown');
  });
});

describe('generateFace — deterministic procedural identity', () => {
  it('is a pure function of the id: the same id always produces the same face', () => {
    expect(generateFace('wren')).toEqual(generateFace('wren'));
  });

  it('different ids produce different faces (no collapse to one default face)', () => {
    const a = generateFace('wren');
    const b = generateFace('sable');
    expect(a).not.toEqual(b);
  });

  it('every field stays within its documented range across a spread of ids', () => {
    for (const id of ['wren', 'sable', 'idris', 'a', 'zzzzzzzzzzzz', 'player-000123']) {
      const face = generateFace(id);
      expect(face.hue).toBeGreaterThanOrEqual(0);
      expect(face.hue).toBeLessThan(360);
      expect(face.skinTone).toBeGreaterThanOrEqual(0);
      expect(face.skinTone).toBeLessThan(1);
      expect(face.faceShape).toBeGreaterThanOrEqual(0);
      expect(face.faceShape).toBeLessThan(FACE_SHAPE_COUNT);
      expect(face.hairStyle).toBeGreaterThanOrEqual(0);
      expect(face.hairStyle).toBeLessThan(HAIR_STYLE_COUNT);
      expect(face.markCount).toBeGreaterThanOrEqual(0);
      expect(face.markCount).toBeLessThan(MARK_COUNT_MAX);
    }
  });
});

describe('integration — the ledger is actually wired into stepWorld via real rumour events', () => {
  it('starts empty at world creation', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    expect(world.identityLedger.size).toBe(0);
  });

  it('grows only from real heard-from events, never spontaneously', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 5; i++) world = stepWorld(world); // no posts queued — nothing to hear
    expect(world.identityLedger.size).toBe(0);
  });

  it('repeated real rumour-hearing eventually resolves the hearer toward the source, asymmetrically', () => {
    let world = createWorld(7, DEFAULT_WORLD_CONFIG);
    const author = world.millers[0]!.buildingId; // occupant ids are buildingIds in this model — see world.ts's occupantsOf
    let anyResolved = false;
    for (let day = 0; day < 60 && !anyResolved; day++) {
      const post: WallPost = { id: `w-${day}`, authorId: author, state: 'hopeful', day };
      world = { ...world, pendingWallPosts: [post] };
      world = stepWorld(world);
      for (const [observer] of world.identityLedger) {
        if (encounterCount(world.identityLedger, observer, author) >= IDENTITY_RESOLUTION_THRESHOLD) {
          anyResolved = true;
          // Asymmetry check: the author's own ledger (what the author has resolved about
          // this observer) is untouched by the observer hearing FROM them.
          expect(encounterCount(world.identityLedger, author, observer)).toBe(0);
          break;
        }
      }
    }
    expect(anyResolved).toBe(true);
  });
});
