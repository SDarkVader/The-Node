import { createHash } from 'node:crypto';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig, type World } from '../world/world.js';
import { createInhabitants, transitionPerson, assertPopulation, roleArrays, type Inhabitants } from '../engine/inhabitants.js';
import { readDiary } from '../engine/diary.js';
import { mulberry32 } from '../sim/rng.js';
import { parseGameAction, queueGameAction } from '../server/actionVocabulary.js';
import { observe, observerRef, refHexLength } from '../server/observer.js';
import { validateDecision, type Decision } from './protocol.js';

export interface Genesis { seed: number; namespace: string; observerSecret: string; config: WorldConfig; sourceRevision: string }
export interface CanonicalAction { person: string; epoch: number; tick: number; decision: Decision }
export interface ParticipantState { world: World; registry: Inhabitants; genesis: Genesis }
export interface TickResult { state: ParticipantState; effects: {person:string;category:string}[] }
export function createParticipantState(g: Genesis): ParticipantState {
  if (!Number.isSafeInteger(g.seed) || !g.sourceRevision || g.observerSecret.length < 16) throw Error('invalid_genesis');
  const genesis = structuredClone(g);
  const world = createWorld(g.seed, genesis.config);
  const registry = createInhabitants(world, g.namespace);
  assertPopulation(world, registry);
  return {world,registry,genesis};
}
export function fixtureGenesis(seed: number, config = DEFAULT_WORLD_CONFIG): Genesis {
  return {seed,config:structuredClone(config),namespace:'offline-person',observerSecret:'offline-fixture-observer-secret',sourceRevision:'participant-reconstruction-v1'};
}

/** Real kernel execution; callers must hold sole ownership of the mutable RNG lineage. */
export function stepParticipantState(previous: ParticipantState, actions: readonly CanonicalAction[], online: readonly string[]): TickResult {
  const registry = structuredClone(previous.registry);
  let world: World = {...previous.world,diary:structuredClone(previous.world.diary),currentlyOnline:new Set(online)};
  const state: ParticipantState = {world,registry,genesis:previous.genesis};
  const effects: TickResult['effects'] = [];
  const candidates = new Map<string, CanonicalAction>();
  const live = (a: CanonicalAction) => {
    const p = registry.people.get(a.person);
    return p && p.location !== null && p.roleEpoch === a.epoch;
  };
  for (const id of online) if (registry.people.get(id)?.location == null) throw Error('invalid_online_person');
  for (const raw of actions) {
    const a = structuredClone(raw);
    if (a.tick !== world.tick || !live(a) || candidates.has(a.person)) throw Error('invalid_action_tape');
    const context = observe(state, a.person, previous.genesis.observerSecret).context;
    const decision = validateDecision(a.decision, context);
    if (!decision) throw Error('invalid_decision_tape');
    a.decision = decision; candidates.set(a.person,a);
  }
  for (const a of candidates.values()) {
    const p = registry.people.get(a.person)!;
    const d = a.decision;
    if (d.move) {
      const move = d.move;
      if (p.role === null) world = {...world,grifters:world.grifters.map(g => g.id === p.location ? {...g,...move} : g)};
      else {
        for (const [, slots] of roleArrays(world)) {
          const slot = slots.find(x => x.buildingId === p.location);
          if (slot) {
            // Detach the affected array/slot rather than mutating a previous snapshot.
            const key = p.role === 'importExport' ? 'importExporters' : p.role === 'investigator' ? 'investigators' : p.role === 'courier' ? 'couriers' : p.role === 'baker' ? 'bakers' : 'millers';
            world = {...world,[key]:world[key].map(x => x.buildingId === p.location ? {...x,...move} : x)};
          }
        }
      }
      effects.push({person:a.person,category:'move'});
    }
    const translateRef = (ref: unknown) => {
      const found = [...registry.people.values()].find(p => p.location !== null && observerRef(previous.genesis.observerSecret,a.person,p.id,refHexLength(previous.world)) === ref);
      if (!found) throw Error('unknown_observer_reference');
      return found.id;
    };
    for (const [category, payload] of [['communication',d.communication],['diary',d.diary]] as const) {
      if (payload === null) continue;
      const value = structuredClone(payload);
      if (value.context === null) delete value.context;
      let kind: string;
      if (category === 'diary') { kind = 'diaryEntry'; value.subject = translateRef(value.subject); }
      else {
        kind = value.kind as string; delete value.kind;
        if (kind === 'proximityUtterance') {
          const r = value.referent as {kind:string;playerId?:string};
          if (r.kind === 'player') r.playerId = translateRef(r.playerId);
        }
      }
      const parsed = parseGameAction(kind,value);
      if (!parsed) throw Error('wire_translation_failed');
      world = queueGameAction(world,a.person,parsed);
    }
  }
  const next = stepWorld(world, {
    transition: e => { transitionPerson(registry,e); },
    identityFor: location => {
      const id = registry.locations.get(location); if (!id) throw Error('missing_slot_identity'); return id;
    },
    locationFor: id => registry.people.get(id)?.location ?? null,
    allowAction: (category, person) => {
      const a = candidates.get(person); if (!a) return false;
      // Recognition v2: speech and diary belong to the person, so they survive a same-day role
      // change and are open to Grifters (owner decision 2026-10-20); only presence is required.
      // Role actions (a Baker price) keep the live-episode check in `bakerPrice` below.
      if (world.config.recognition === 'v2') return registry.people.get(person)?.location != null;
      return !!live(a) && registry.people.get(person)!.role !== null;
    },
    bakerPrice: building => {
      const person = registry.locations.get(building); const a = person && candidates.get(person);
      if (!a || !live(a) || registry.people.get(a.person)?.role !== 'baker' || !a.decision.role) return undefined;
      effects.push({person:a.person,category:'bakerPrice'}); return a.decision.role.price;
    },
  });
  // Only report proven kernel effects; a submitted communication may have no listener.
  for (const a of candidates.values()) {
    if (next.lastDiaryWrites.includes(a.person)) effects.push({person:a.person,category:'diary'});
    if (next.lastRumourEvents.some(e => e.heardFrom === a.person)) effects.push({person:a.person,category:'wallHeard'});
    if (next.lastProximityConversations.some(e => e.heard.speakerId === a.person)) effects.push({person:a.person,category:'proximityHeard'});
  }
  // Memory aging occurs once at the kernel boundary, never when an observer reads.
  for (const owner of next.diary.keys()) {
    const seed = createHash('sha256').update(JSON.stringify([previous.genesis.seed,previous.genesis.namespace,owner,next.tick])).digest().readUInt32LE();
    readDiary(next.diary,owner,next.tick,mulberry32(seed));
  }
  const result = {world:next,registry,genesis:previous.genesis};
  assertPopulation(next,registry);
  return {state:result,effects};
}
