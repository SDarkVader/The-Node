/**
 * Role-holder position decoupled from occupancy (2026-08-19) — HANDOVER "THE DIRECTION"
 * item 2, the blocker the rest of the Godot chain stacks behind.
 *
 * What these lock in is deliberately narrow: position is now a SEPARATE FACT from which
 * slot someone holds, and today it happens to equal their building's plot because nothing
 * moves a role-holder yet. The equality is the current state, not the design — the point of
 * the split is that it can stop being true without the type system fighting it.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, type World } from '../src/world/world.js';

function allRoleSlots(w: World) {
  return [...w.millers, ...w.bakers, ...w.couriers, ...w.journalists, ...w.detectives, ...w.importExporters];
}

function buildingsById(w: World) {
  return new Map(w.shard.districts.flatMap((d) => d.buildings).map((b) => [b.id, b]));
}

describe('role-holder position', () => {
  it('every role slot has a real position at world creation, matching its own building', () => {
    const w = createWorld(11);
    const buildings = buildingsById(w);
    const slots = allRoleSlots(w);
    expect(slots.length).toBeGreaterThan(0);

    for (const s of slots) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      const b = buildings.get(s.buildingId)!;
      expect({ x: s.x, y: s.y }).toEqual({ x: b.x, y: b.y });
    }
  });

  it('position stays real and finite across a long run, through every fill and eviction', () => {
    let w = createWorld(3);
    for (let i = 0; i < 300; i++) {
      w = stepWorld(w);
      for (const s of allRoleSlots(w)) {
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.y)).toBe(true);
      }
    }
  });

  it('a newly-filled slot puts its new occupant AT their workplace, not wherever the last one was', () => {
    // Real churn over a long run refills slots many times; every occupant of a FILLED slot
    // should be standing at that slot's own building, since nothing moves them yet.
    let w = createWorld(7);
    for (let i = 0; i < 400; i++) w = stepWorld(w);

    const buildings = buildingsById(w);
    const filled = allRoleSlots(w).filter((s) => s.slot.state === 'FILLED');
    expect(filled.length).toBeGreaterThan(0);

    for (const s of filled) {
      const b = buildings.get(s.buildingId)!;
      expect({ id: s.buildingId, x: s.x, y: s.y }).toEqual({ id: s.buildingId, x: b.x, y: b.y });
    }
  });

  it('position is stable tick to tick while a slot stays FILLED with the same occupant', () => {
    let w = createWorld(5);
    for (let i = 0; i < 20; i++) w = stepWorld(w);

    const before = new Map(
      allRoleSlots(w)
        .filter((s) => s.slot.state === 'FILLED')
        .map((s) => [s.buildingId, { x: s.x, y: s.y, days: s.daysInRole }]),
    );

    const after = stepWorld(w);
    for (const s of allRoleSlots(after)) {
      if (s.slot.state !== 'FILLED') continue;
      const prev = before.get(s.buildingId);
      if (!prev) continue;
      // daysInRole incrementing means it is the SAME occupant, not a refill — the only
      // case where position is required to be unchanged.
      if (s.daysInRole === prev.days + 1) {
        expect({ x: s.x, y: s.y }).toEqual({ x: prev.x, y: prev.y });
      }
    }
  });

  it('the occupant-position set read from slots is identical to the one read from buildings', () => {
    // This is the actual claim `occupantsOf`'s swap rests on, and the real guard on the whole
    // change: witness counts (sabotage detection), identity resolution and District Weather
    // all consume that set, and all three are calibrated against the building-derived layout.
    // Checked at several points across a long run, not just at creation, because refills and
    // evictions are exactly where the two sources could drift apart.
    let w = createWorld(21);
    for (let i = 0; i < 250; i++) {
      w = stepWorld(w);
      if (i % 50 !== 0) continue;

      const buildings = buildingsById(w);
      const fromSlots: string[] = [];
      const fromBuildings: string[] = [];
      for (const s of allRoleSlots(w)) {
        if (s.slot.state !== 'FILLED') continue;
        const b = buildings.get(s.buildingId)!;
        fromSlots.push(`${s.buildingId}@${s.x},${s.y}`);
        fromBuildings.push(`${s.buildingId}@${b.x},${b.y}`);
      }
      expect(fromSlots.length).toBeGreaterThan(0);
      expect(fromSlots.sort()).toEqual(fromBuildings.sort());
    }
  });
});
