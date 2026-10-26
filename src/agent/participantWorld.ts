import { createHash } from 'node:crypto';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig, type World } from '../world/world.js';
import { createInhabitants, transitionPerson, assertPopulation, roleArrays, type Inhabitants, type ParticipantHooks } from '../engine/inhabitants.js';
import { readDiary, writeDiaryEntry, type Observation, type Reading, type ContextTag } from '../engine/diary.js';
import { resolvedBy, type Interaction } from '../engine/recognition.js';
import { composeUtterance, degradeForListener, type Intent, type Tone, type Referent, type ContextTag as SpeechContext } from '../comms/proximityConversation.js';
import { stepClarity, applyDistortion } from '../comms/decay.js';
import { proximityCloseness } from '../engine/space.js';
import { hashUnit } from '../engine/dealings.js';
import type { SelfState, WallPost } from '../comms/grammar.js';
import { mulberry32 } from '../sim/rng.js';
import { parseGameAction, queueGameAction } from '../server/actionVocabulary.js';
import { observe, observerRef, refHexLength } from '../server/observer.js';
import { validateDecision, type Decision } from './protocol.js';
import type { SocietyEconomyPlan } from '../engine/societyEconomy.js';

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

/** Where the body at `location` stands, if anyone does. */
function bodyAt(world: World, location: string): {x:number;y:number} | undefined {
  const g = world.grifters.find(x => x.id === location); if (g) return {x:g.x,y:g.y};
  for (const [, slots] of roleArrays(world)) { const slot = slots.find(x => x.buildingId === location); if (slot) return {x:slot.x,y:slot.y}; }
  return undefined;
}
/** Moves `person`'s body (a Grifter or a role slot) to `move`, detaching the affected array. */
export function applyParticipantMove(world: World, role: string | null, location: string, move: {x:number;y:number}): World {
  if (role === null) return {...world,grifters:world.grifters.map(g => g.id === location ? {...g,x:move.x,y:move.y} : g)};
  for (const [, slots] of roleArrays(world)) {
    const slot = slots.find(x => x.buildingId === location);
    if (slot) {
      // Detach the affected array/slot rather than mutating a previous snapshot.
      const key = role === 'importExport' ? 'importExporters' : role === 'investigator' ? 'investigators' : role === 'courier' ? 'couriers' : role === 'baker' ? 'bakers' : 'millers';
      world = {...world,[key]:world[key].map(x => x.buildingId === location ? {...x,x:move.x,y:move.y} : x)};
    }
  }
  return world;
}

/** Real kernel execution; callers must hold sole ownership of the mutable RNG lineage. */
export function stepParticipantState(previous: ParticipantState, actions: readonly CanonicalAction[], online: readonly string[], economy?: SocietyEconomyPlan, resolvedSocial?: ParticipantHooks['resolvedSocial']): TickResult {
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
  // Recognition v2: everyone speaks and is heard from where they stood when observed, so a move
  // takes effect after the day's speech (owner decision 2026-10-21, "show who can hear").
  const v2 = previous.world.config.recognition === 'v2';
  const deferredMoves: {a: CanonicalAction; location: string; from: {x:number;y:number}}[] = [];
  for (const a of candidates.values()) {
    const p = registry.people.get(a.person)!;
    const d = a.decision;
    if (d.move) {
      if (v2) deferredMoves.push({a,location:p.location!,from:bodyAt(world,p.location!)!});
      else {
        world = applyParticipantMove(world,p.role,p.location!,d.move);
        effects.push({person:a.person,category:'move'});
      }
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
      if (category === 'diary') { kind = 'diaryEntry'; if(value.subject !== null)value.subject = translateRef(value.subject); }
      else {
        kind = value.kind as string; delete value.kind;
        if (kind === 'proximityUtterance') {
          const r = value.referent as {kind:string;playerId?:string};
          if (r.kind === 'player') r.playerId = translateRef(r.playerId);
        }
      }
      const parsed = parseGameAction(kind,value,world.config.diarySubjectOptional && v2 ? {diarySubjectOptional:true} : undefined);
      if (!parsed) throw Error('wire_translation_failed');
      world = queueGameAction(world,a.person,parsed);
    }
  }
  let next = stepWorld(world, {
    ...(resolvedSocial ? {resolvedSocial} : {}),
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
  }, economy);
  // A deferred move applies only to the same body, still in the same role episode and place;
  // if the day moved or replaced them (a transition, a refill), the move has no effect.
  for (const {a,location,from} of deferredMoves) {
    const p = registry.people.get(a.person);
    const at = bodyAt(next,location);
    if (!p || p.location !== location || p.roleEpoch !== a.epoch || !at || at.x !== from.x || at.y !== from.y) continue;
    next = applyParticipantMove(next,p.role,location,a.decision.move!);
    effects.push({person:a.person,category:'move'});
  }
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

export interface ParticipantTurnResult extends TickResult {
  social: NonNullable<ParticipantHooks['resolvedSocial']>;
  posts: WallPost[];
  /** Intended direct addresses that actually reached the addressee. No speech transcript. */
  addresses: {speaker:string;listener:string}[];
}
/** One bounded social/movement turn. No world day, economy, arrival, recognition or memory
 * ageing advances here. The existing lexical composer and listener-degradation rules apply
 * at starting positions; all admitted moves resolve after every utterance. */
export function stepParticipantTurn(previous:ParticipantState,actions:readonly CanonicalAction[],turn:number):ParticipantTurnResult {
  if(previous.world.config.recognition!=='v2'||!Number.isSafeInteger(turn)||turn<1)throw Error('invalid_participant_turn');
  const state:ParticipantState={...previous,registry:structuredClone(previous.registry),world:{...previous.world,
    diary:structuredClone(previous.world.diary),lastRumourEvents:[],lastProximityConversations:[],lastDiaryWrites:[],lastDiaryRejections:[],lastProximityRejections:[]}};
  const world=state.world,day=world.tick,range=world.config.commsProximityRange;
  const effects:TickResult['effects']=[],interactions:Interaction[]=[],posts:WallPost[]=[],addresses:ParticipantTurnResult['addresses']=[];
  const seed=createHash('sha256').update(JSON.stringify([previous.genesis.seed,previous.genesis.namespace,day,turn,'social-turn'])).digest().readUInt32LE();
  const rng=mulberry32(seed),seen=new Set<string>();
  const occupants=[...state.registry.people.values()].filter(p=>p.location!==null).map(p=>({person:p.id,...bodyAt(world,p.location!)!}));
  const pos=new Map(occupants.map(p=>[p.person,p]));
  const neighbors=(person:string)=>occupants.filter(q=>q.person!==person&&proximityCloseness(Math.abs(q.x-pos.get(person)!.x)+Math.abs(q.y-pos.get(person)!.y),range)!==null);
  const districtOf=(person:string)=>{const q=pos.get(person)!;return world.shard.districts.find(d=>d.plots.some(p=>p.x===q.x&&p.y===q.y))?.id;};
  const translate=(observer:string,ref:unknown)=>{
    const p=[...state.registry.people.values()].find(p=>p.location!==null&&observerRef(previous.genesis.observerSecret,observer,p.id,refHexLength(world))===ref);
    if(!p)throw Error('unknown_observer_reference');return p.id;
  };
  const distortionNeighbors:Record<SelfState,SelfState[]>={isolated:['distrustful','overwhelmed'],manipulated:['exploited','suspicious'],
    distrustful:['suspicious','isolated'],exploited:['manipulated','overwhelmed'],suspicious:['distrustful','manipulated'],
    uneasy:['suspicious','overwhelmed'],overwhelmed:['uneasy','isolated'],hopeful:['secure','grateful'],secure:['hopeful','grateful'],grateful:['hopeful','secure']};
  for(const raw of actions){
    const a=structuredClone(raw),person=state.registry.people.get(a.person);
    if(a.tick!==world.tick||!person||person.location===null||person.roleEpoch!==a.epoch||seen.has(a.person))throw Error('invalid_action_tape');
    const d=validateDecision(a.decision,observe(previous,a.person,previous.genesis.observerSecret).context);
    if(!d)throw Error('invalid_decision_tape');seen.add(a.person);
    const c=d.communication;
    if(c?.kind==='wallPost'){
      const post:WallPost={id:`turn-${day}-${turn}-${posts.length}`,authorId:a.person,state:c.state as SelfState,day};posts.push(post);
      for(const neighbor of neighbors(a.person)){
        const p=pos.get(a.person)!,weight=proximityCloseness(Math.abs(p.x-neighbor.x)+Math.abs(p.y-neighbor.y),range)!;
        const clarity=stepClarity(1,weight,{baseSuccessChance:0.6,decayPerStep:0.3,clarityFloor:0.15},rng);
        if(!clarity.passed)continue;
        const distorted=applyDistortion(post.state,{distortionRate:0.25,neighbors:distortionNeighbors},rng);
        world.lastRumourEvents.push({heardBy:neighbor.person,heardFrom:a.person,state:distorted.value,distorted:distorted.distorted,clarity:clarity.nextClarity});
      }
      for(const grifter of [...state.registry.people.values()].filter(p=>p.role===null&&p.location!==null)){
        if(grifter.id===a.person||districtOf(grifter.id)!==districtOf(a.person)||world.lastRumourEvents.some(e=>e.heardBy===grifter.id&&e.heardFrom===a.person))continue;
        if(hashUnit(world.seed,day,'grifter-wall',post.id,grifter.id)<0.6)world.lastRumourEvents.push({heardBy:grifter.id,heardFrom:a.person,state:post.state,distorted:false,clarity:0.7});
      }
      effects.push({person:a.person,category:'wallPost'});
      if(world.lastRumourEvents.some(e=>e.heardFrom===a.person))effects.push({person:a.person,category:'wallHeard'});
    }else if(c?.kind==='proximityUtterance'){
      const nearby=neighbors(a.person),present=new Set(nearby.map(p=>p.person)),r=c.referent as {kind:'room'|'player';playerId?:string};
      const referent:Referent=r.kind==='room'?{kind:'room'}:{kind:'player',playerId:translate(a.person,r.playerId)};
      const utterance=composeUtterance(a.person,c.intent as Intent,c.tone as Tone,referent,day,present,c.context===null?undefined:c.context as SpeechContext);
      for(const listener of nearby){
        const speaker=pos.get(a.person)!;
        const heard=degradeForListener(utterance,Math.abs(speaker.x-listener.x)+Math.abs(speaker.y-listener.y),range,[...present],rng);
        if(!heard)continue;
        world.lastProximityConversations.push({listenerId:listener.person,heard});
        const direct=referent.kind==='player'&&referent.playerId===listener.person;
        interactions.push({observer:listener.person,subject:a.person,kind:direct?'address':'overheard'});
        if(direct)addresses.push({speaker:a.person,listener:listener.person});
      }
      if(world.lastProximityConversations.some(e=>e.heard.speakerId===a.person))effects.push({person:a.person,category:'proximityHeard'});
    }
    if(d.diary){
      const e=d.diary,subject=e.subject===null?null:translate(a.person,e.subject);
      writeDiaryEntry(world.diary,a.person,subject,e.observation as Observation,e.reading as Reading,day,
        resolvedBy(world.recognitionV2!.recognition.ledger,a.person),e.context===null?undefined:e.context as ContextTag,world.config.diarySubjectOptional===true);
      world.lastDiaryWrites.push(a.person);effects.push({person:a.person,category:'diary'});
    }
  }
  for(const a of actions)if(a.decision.move){
    const person=state.registry.people.get(a.person)!;
    state.world=applyParticipantMove(state.world,person.role,person.location!,a.decision.move);
    effects.push({person:a.person,category:'move'});
  }
  return {state,effects,posts,addresses,social:{rumours:structuredClone(world.lastRumourEvents),conversations:structuredClone(world.lastProximityConversations),interactions,diaryWrites:[...world.lastDiaryWrites]}};
}
