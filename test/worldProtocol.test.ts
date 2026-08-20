/**
 * Wire-format tests (2026-08-19). The interesting assertions here are the NEGATIVE ones:
 * this module's job is deciding what a client may not know, and a leak is silent by nature —
 * nothing crashes when private state ends up on the wire, it just quietly stops being private.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/world/world.js';
import {
  helloMessage,
  tickMessage,
  personHandle,
  identityResolvedMessages,
  roleByBuildingId,
} from '../src/server/worldProtocol.js';

function stepN(seed: number, n: number) {
  let w = createWorld(seed);
  for (let i = 0; i < n; i++) w = stepWorld(w);
  return w;
}

describe('helloMessage — static geometry', () => {
  it('carries every building and plot, with real bounds around them', () => {
    const w = createWorld(1);
    const hello = helloMessage(w);
    const realBuildings = w.shard.districts.flatMap((d) => d.buildings).length;
    const realPlots = w.shard.districts.flatMap((d) => d.plots).length;

    expect(hello.buildings.length).toBe(realBuildings);
    expect(hello.plots.length).toBe(realPlots);
    for (const b of hello.buildings) {
      expect(b.x).toBeGreaterThanOrEqual(hello.bounds.minX);
      expect(b.x).toBeLessThanOrEqual(hello.bounds.maxX);
    }
  });

  it('labels role buildings by role and leaves purely-residential ones null', () => {
    const w = createWorld(1);
    const hello = helloMessage(w);
    const roles = roleByBuildingId(w);
    expect(roles.size).toBeGreaterThan(0);
    // Real, shipped fact: not every building carries a role slot.
    expect(hello.buildings.some((b) => b.role === null)).toBe(true);
    for (const b of hello.buildings) expect(b.role).toBe(roles.get(b.id) ?? null);
  });

  it('carries the landmark flag — real generated geometry that nothing used to read', () => {
    const w = createWorld(1);
    const hello = helloMessage(w);
    const landmarks = hello.buildings.filter((b) => b.isLandmark);
    // LANDMARKS_PER_DISTRICT is 3, one district shipped.
    expect(landmarks.length).toBe(3);
    expect(hello.buildings.every((b) => typeof b.isLandmark === 'boolean')).toBe(true);
  });

  it('is stable across ticks — geometry is not re-sent because it does not change', () => {
    const w0 = createWorld(4);
    const w1 = stepN(4, 50);
    expect(JSON.stringify(helloMessage(w1))).toBe(JSON.stringify(helloMessage(w0)));
  });
});

describe('tickMessage — what a client may know', () => {
  it('streams a station for every role slot, and a person only for FILLED ones', () => {
    const w = stepN(7, 120);
    const msg = tickMessage(w, 'secret-a');
    const allSlots = [...w.millers, ...w.bakers, ...w.couriers, ...w.journalists, ...w.detectives, ...w.importExporters];
    const filled = allSlots.filter((s) => s.slot.state === 'FILLED').length;

    expect(msg.stations.length).toBe(allSlots.length);
    // A BACKSTOPPED slot must NOT produce a body: the backstop is mechanical, not a person
    // (constraint 3), and rendering it as one would invent an agent the design does not have.
    expect(msg.people.length).toBe(filled + w.grifters.length);
  });

  it('never leaks private economic state — the assertion this whole module exists for', () => {
    const w = stepN(9, 200);
    const wire = JSON.stringify(tickMessage(w, 'secret-a'));

    // Real values pulled from the live world, then searched for in the serialized payload.
    // Checking the actual numbers rather than key names catches a leak that renames a field.
    const filledMiller = w.millers.find((m) => m.slot.state === 'FILLED' && m.wealth > 0);
    expect(filledMiller).toBeDefined();
    expect(wire).not.toContain(String(filledMiller!.wealth));
    expect(wire).not.toContain(String(w.wealthGini));

    for (const key of ['wealth', 'gini', 'experience', 'diary', 'personalResourceStock', 'campaign', 'saboteur']) {
      expect(wire.toLowerCase()).not.toContain(key.toLowerCase());
    }
  });

  it('never leaks a real player id — bodies are pseudonymous on the wire', () => {
    const w = stepN(5, 80);
    const wire = JSON.stringify(tickMessage(w, 'secret-a'));
    // buildingId doubles as a role-holder's player id; grifter ids are their own.
    for (const g of w.grifters) expect(wire).not.toContain(`"${g.id}"`);
    const filledMiller = w.millers.find((m) => m.slot.state === 'FILLED')!;
    expect(JSON.parse(wire).people.some((p: { handle: string }) => p.handle === filledMiller.buildingId)).toBe(false);
  });

  it('gives two connections DIFFERENT handles for the same person, so they cannot correlate', () => {
    const w = stepN(5, 80);
    const a = tickMessage(w, 'secret-a');
    const b = tickMessage(w, 'secret-b');
    const handlesA = new Set(a.people.map((p) => p.handle));
    const overlap = b.people.filter((p) => handlesA.has(p.handle));
    expect(overlap.length).toBe(0);
  });

  it('keeps a handle stable across ticks for one connection, so a client can animate a body', () => {
    let w = stepN(3, 60);
    const before = tickMessage(w, 'conn-1');
    w = stepWorld(w);
    const after = tickMessage(w, 'conn-1');
    // Role-holders churn, but a slot that stayed FILLED must keep its handle.
    const stable = before.people.filter((p) => after.people.some((q) => q.handle === p.handle));
    expect(stable.length).toBeGreaterThan(0);
  });

  it('carries ambient mood — the signals the whole visual doctrine is built on', () => {
    const w = stepN(2, 100);
    const msg = tickMessage(w, 'secret-a');
    expect(msg.economicHealth).toBe(w.economicHealth);
    expect(msg.districtTension.length).toBe(w.shard.districts.length);
    for (const t of msg.districtTension) expect(Number.isFinite(t.tension)).toBe(true);
    expect(msg.stations.every((s) => Number.isFinite(s.heat))).toBe(true);
  });

  it('is pure — building a message never mutates the world', () => {
    const w = stepN(6, 40);
    const snapshot = JSON.stringify({ h: w.economicHealth, g: w.wealthGini, t: w.tick });
    tickMessage(w, 'secret-a');
    helloMessage(w);
    expect(JSON.stringify({ h: w.economicHealth, g: w.wealthGini, t: w.tick })).toBe(snapshot);
  });
});

describe('personHandle', () => {
  it('is deterministic per (connection, person) and differs across both axes', () => {
    expect(personHandle('c1', 'alice')).toBe(personHandle('c1', 'alice'));
    expect(personHandle('c1', 'alice')).not.toBe(personHandle('c2', 'alice'));
    expect(personHandle('c1', 'alice')).not.toBe(personHandle('c1', 'bob'));
  });

  it('does not embed the real id it was derived from', () => {
    expect(personHandle('c1', 'core-0-b7')).not.toContain('core-0-b7');
  });
});

describe('identityResolvedMessages', () => {
  it('resolves to the same handle the tick stream is already using for that body', () => {
    const w = stepN(8, 100);
    const filled = w.millers.find((m) => m.slot.state === 'FILLED')!;
    const [msg] = identityResolvedMessages('conn-x', [filled.buildingId]);
    const tick = tickMessage(w, 'conn-x');

    expect(msg).toBeDefined();
    expect(tick.people.some((p) => p.handle === msg!.handle)).toBe(true);
    expect(msg!.playerId).toBe(filled.buildingId);
    expect(msg!.face).toBeDefined();
  });

  it('sends nothing when an observer has resolved nobody — silence is the default', () => {
    expect(identityResolvedMessages('conn-x', [])).toEqual([]);
  });
});
