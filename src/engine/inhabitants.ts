import type { World, RoleType } from '../world/world.js';

export interface Inhabitant { id: string; location: string | null; role: RoleType | null; roleEpoch: number }
export interface Inhabitants { namespace: string; nextId: number; people: Map<string, Inhabitant>; locations: Map<string, string> }
export interface PersonTransition { from: string | null; to: string | null; role: RoleType | null }
export interface ParticipantHooks {
  transition: (event: PersonTransition) => void;
  identityFor: (location: string) => string;
  locationFor: (person: string) => string | null;
  allowAction: (category: 'communication' | 'diary', person: string) => boolean;
  bakerPrice: (buildingId: string) => number | undefined;
  /** Already resolved sequential turns, opt-in only. Recognition still steps once per day. */
  resolvedSocial?: {
    rumours: import('../world/world.js').RumourEventLite[];
    conversations: import('../world/world.js').ProximityConversationHeardEvent[];
    interactions: import('./recognition.js').Interaction[];
    diaryWrites: string[];
  };
}
export const roleArrays = (w: World) => [
  ['miller', w.millers], ['baker', w.bakers], ['courier', w.couriers],
  ['investigator', w.investigators], ['importExport', w.importExporters],
] as const;

export function transitionPerson(r: Inhabitants, e: PersonTransition): Inhabitant {
  if (e.from === null && e.to === null) throw Error('invalid_transition');
  if (e.to !== null && r.locations.has(e.to)) throw Error('occupied_destination');
  let p: Inhabitant;
  if (e.from === null) {
    p = { id: `${r.namespace}:${r.nextId++}`, location: null, role: null, roleEpoch: -1 };
  } else {
    const id = r.locations.get(e.from);
    if (!id) throw Error('missing_person');
    const existing = r.people.get(id);
    if (!existing || existing.location !== e.from) throw Error('invalid_registry');
    p = { ...existing };
    r.locations.delete(e.from);
  }
  p.location = e.to; p.role = e.to === null ? null : e.role; p.roleEpoch++;
  r.people.set(p.id, p);
  if (e.to !== null) r.locations.set(e.to, p.id);
  return p;
}

export function createInhabitants(w: World, namespace: string): Inhabitants {
  if (!namespace || namespace.includes('\0')) throw Error('invalid_namespace');
  const r: Inhabitants = {namespace, nextId: 0, people: new Map(), locations: new Map()};
  for (const [role, slots] of roleArrays(w)) for (const s of slots) {
    if (s.slot.state === 'FILLED') transitionPerson(r, {from: null, to: s.buildingId, role});
  }
  for (const g of w.grifters) transitionPerson(r, {from: null, to: g.id, role: null});
  return r;
}

export function assertPopulation(w: World, r: Inhabitants): void {
  const expected = new Map<string, RoleType | null>();
  for (const [role, slots] of roleArrays(w)) for (const s of slots) if (s.slot.state === 'FILLED') expected.set(s.buildingId, role);
  for (const g of w.grifters) expected.set(g.id, null);
  if (expected.size !== r.locations.size || expected.size !== w.population) throw Error('population_mismatch');
  for (const [location, role] of expected) {
    const id = r.locations.get(location); const p = id && r.people.get(id);
    if (!p || p.location !== location || p.role !== role) throw Error('identity_mismatch');
  }
}
