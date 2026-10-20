import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = process.env.PARTICIPANT_BUILD;
const baseline = process.env.PARTICIPANT_BASELINE;
if (!root || !baseline) throw Error('Set PARTICIPANT_BUILD and PARTICIPANT_BASELINE');
const load = (file,base=root) => import(pathToFileURL(path.join(base,file)).href);
const {createParticipantState,fixtureGenesis,stepParticipantState} = await load('agent/participantWorld.js');
const {createWorld,stepWorld,DEFAULT_WORLD_CONFIG} = await load('world/world.js');
const oldKernel = await load('world/world.js',baseline);
const {createInhabitants,transitionPerson,assertPopulation} = await load('engine/inhabitants.js');
const {observe,observerRef,personBody} = await load('server/observer.js');
const {OfflineParticipantHost} = await load('agent/host.js');
const {canonical,digest,evidenceHash,newTape,replay} = await load('agent/replay.js');
const {recordEncounter} = await load('engine/identity.js');
const {writeDiaryEntry} = await load('engine/diary.js');
const {stepMultiRoleConscriptionDay} = await load('sim/multiRoleConscription.js');
const {parseGameAction} = await load('server/actionVocabulary.js');
const idle = () => ({move:null,communication:null,diary:null,role:null});
const quiet = {...DEFAULT_WORLD_CONFIG,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0};
const state = (seed=32) => createParticipantState(fixtureGenesis(seed,quiet));
const baker = s => [...s.registry.people.values()].find(p => p.role === 'baker');
const action = (s,p,d) => ({person:p.id,epoch:p.roleEpoch,tick:s.world.tick,decision:d});
const token = 'offline-controller-fixture-token';
const makeHost = (seed=32,config=quiet) => {
  const g = fixtureGenesis(seed,config); const p = baker(createParticipantState(g));
  const host = new OfflineParticipantHost(g,p.id,token); const session=host.authenticate(token);
  return {host,session,person:p.id};
};
const frame = (observation,action,payload) => ({type:'action',tick:observation.context.tick,observationId:observation.observationId,action,payload});

test('surviving three payload decoders preserve valid values and reject unknown action',()=>{
  assert.deepEqual(parseGameAction('wallPost',{state:'hopeful'}),{kind:'wallPost',state:'hopeful'});
  assert.ok(parseGameAction('diaryEntry',{subject:'other',observation:'keptAPromise',reading:'cantTellYet'}));
  assert.ok(parseGameAction('proximityUtterance',{intent:'ask',tone:'warm',referent:{kind:'room'}}));
  assert.equal(parseGameAction('bakerPrice',{price:1}),null);
});

for (const seed of [1,2,5,13,32,77]) test(`legacy seeded parity: original vs patched kernel ${seed}`,()=>{
  let old=oldKernel.createWorld(seed); let patched=createWorld(seed);
  for(let i=0;i<100;i++) {
    assert.equal(digest({world:patched}),digest({world:old}),`day ${i}`);
    old=oldKernel.stepWorld(old); patched=stepWorld(patched);
  }
  assert.equal(old.rng(),patched.rng(),'economic RNG draw parity');
});

for (const seed of [1,2,5,13,32,77]) test(`real participant transitions conserve exact identities ${seed}`,()=>{
  let s=createParticipantState(fixtureGenesis(seed));
  let reference=createWorld(seed);
  for(let i=0;i<180;i++) {
    s=stepParticipantState(s,[],[]).state; reference=stepWorld(reference); assertPopulation(s.world,s.registry);
    // Presence keys intentionally become person IDs. Every other no-action kernel field
    // must remain identical to the legacy trajectory, including market/weather/migration.
    const {presence: participantPresence,...participantWorld}=s.world;
    const {presence: legacyPresence,...legacyWorld}=reference;
    assert.equal(digest({world:participantWorld}),digest({world:legacyWorld}),`participant parity ${i}`);
  }
  assert.equal(s.world.rng(),reference.rng());
  for(const p of s.registry.people.values()) assert.ok(p.roleEpoch>=0);
});

test('pure registry preserves person across draft/eviction, retires departure, never reuses identity',()=>{
  const r={namespace:'test',nextId:0,people:new Map(),locations:new Map()};
  const first=transitionPerson(r,{from:null,to:'grifter-0',role:null});
  const drafted=transitionPerson(r,{from:'grifter-0',to:'bakery-0',role:'baker'});
  assert.equal(first.id,drafted.id); assert.equal(drafted.roleEpoch,1);
  const evicted=transitionPerson(r,{from:'bakery-0',to:'grifter-1',role:null});
  assert.equal(evicted.id,first.id); assert.equal(evicted.roleEpoch,2);
  transitionPerson(r,{from:'grifter-1',to:null,role:null});
  const replacement=transitionPerson(r,{from:null,to:'bakery-0',role:'baker'});
  assert.notEqual(replacement.id,first.id); assert.equal(r.people.get(first.id).location,null);
  assert.throws(()=>transitionPerson(r,{from:null,to:'bakery-0',role:'baker'}),/occupied/);
});

test('exact indexed events distinguish multiple same-role churns without extra RNG',()=>{
  const params={N:10,R:2,pDaily:1,beta:0,tPain:1,vBoost:1,tFlag:1,tHard:5};
  const groups=[{roleId:'baker',slots:[{state:'FILLED',vacantSince:null},{state:'FILLED',vacantSince:null}],params}];
  const events=[];let draws=0;
  const result=stepMultiRoleConscriptionDay(groups,0,0,5,()=>{draws++;return 0;},undefined,e=>events.push(e));
  assert.deepEqual(events.map(e=>e.slotIndex),[0,1]);assert.equal(draws,2);
  assert.deepEqual(result.events,[{type:'churn',roleId:'baker'},{type:'churn',roleId:'baker'}]);
});

test('cross-role conscription identifies exact source slot',()=>{
  const params={N:10,R:1,pDaily:0,beta:0,tPain:1,vBoost:1,tFlag:1,tHard:0};
  const groups=[{roleId:'baker',slots:[{state:'BACKSTOPPED',vacantSince:0}],params},
    {roleId:'miller',slots:[{state:'FILLED',vacantSince:null},{state:'FILLED',vacantSince:null}],params}];
  const events=[];
  stepMultiRoleConscriptionDay(groups,0,10,0,()=>0.99,undefined,e=>events.push(e));
  assert.equal(events[0].event.type,'conscriptionFromOtherRole');assert.equal(events[0].slotIndex,0);assert.equal(events[0].fromSlotIndex,1);
});

test('observer is detached, RNG-neutral, excludes seed/raw IDs and hides other wealth',()=>{
  const s=state();const independent=state();const p=baker(s);const other=[...s.registry.people.values()].find(x=>x.id!==p.id && x.role==='baker');
  const before=evidenceHash(s);const a=observe(s,p.id,s.genesis.observerSecret);
  const repeated=observe(s,p.id,s.genesis.observerSecret);
  assert.deepEqual(a,repeated);assert.equal(evidenceHash(s),before);
  assert.equal(s.world.rng(),independent.world.rng());
  assert.equal(a.context.role,'Baker');assert.equal(JSON.stringify(a).includes(s.genesis.namespace+':'),false);
  assert.equal(JSON.stringify(a).includes('observerSecret'),false);assert.equal(Object.hasOwn(a.projection.geometry,'seed'),false);
  s.world.bakers.find(x=>x.buildingId===other.location).wealth+=99999;
  assert.deepEqual(observe(s,p.id,s.genesis.observerSecret),a);
  a.context.legalMoves.push({x:9999,y:9999});assert.deepEqual(observe(s,p.id,s.genesis.observerSecret),repeated);
  assert.notEqual(observerRef(s.genesis.observerSecret,p.id,other.id),observerRef(s.genesis.observerSecret,other.id,p.id));
});

test('memory ages once per day, expires after two days, and preserves previous snapshots',()=>{
  const s=state();const p=baker(s);const other=[...s.registry.people.values()].find(x=>x.id!==p.id && x.role==='baker');
  for(let i=0;i<5;i++) s.world.identityLedger=recordEncounter(s.world.identityLedger,p.id,other.id);
  writeDiaryEntry(s.world.diary,p.id,other.id,'keptAPromise','cantTellYet',0,new Set([other.id]));
  const before=evidenceHash(s);const one=stepParticipantState(s,[],[]).state;
  assert.equal(evidenceHash(s),before);assert.notEqual(one.world.diary,s.world.diary);
  assert.equal(one.world.diary.get(p.id)[0].lastTouchedOnDay,1);
  const first=evidenceHash(one);observe(one,p.id,one.genesis.observerSecret);observe(one,p.id,one.genesis.observerSecret);
  assert.equal(evidenceHash(one),first);
  const two=stepParticipantState(one,[],[]).state;
  assert.equal(two.world.diary.get(p.id).length,0);
});

test('kernel own-price affects actual price/profit/completion after normal reaction',()=>{
  const s=state();const p=baker(s);const reference=state();
  const result=stepParticipantState(s,[action(s,p,{...idle(),role:{kind:'bakerPrice',price:0}})],[]);
  const normal=stepParticipantState(reference,[],[]).state;
  const changed=result.state.world.bakers.find(b=>b.buildingId===p.location);
  const auto=normal.world.bakers.find(b=>b.buildingId===p.location);
  assert.equal(changed.value,0);assert.notEqual(auto.value,0);assert.notEqual(changed.wealth,auto.wealth);
  assert.ok(Object.hasOwn(result.state.world.completionStats,p.location));
  assert.ok(result.effects.some(e=>e.person===p.id&&e.category==='bakerPrice'));
});

test('legal same-district movement changes actual coordinates without mutating previous position',()=>{
  const s=state();const p=baker(s);const initial=personBody(s,p);const context=observe(s,p.id,s.genesis.observerSecret).context;
  assert.ok(context.legalMoves.length);const move=context.legalMoves[0];
  const next=stepParticipantState(s,[action(s,p,{...idle(),move})],[]).state;
  assert.deepEqual({x:personBody(next,next.registry.people.get(p.id)).x,y:personBody(next,next.registry.people.get(p.id)).y},move);
  assert.deepEqual(personBody(s,p),initial);
  assert.throws(()=>stepParticipantState(state(),[action(state(),baker(state()),{...idle(),move:{x:9000,y:9000}})],[]),/invalid_decision/);
});

test('churn rejects old own-price authority without granting it to another occupant',()=>{
  const s=createParticipantState(fixtureGenesis(4,{...quiet,pMonthly:1}));const p=baker(s);
  const result=stepParticipantState(s,[action(s,p,{...idle(),role:{kind:'bakerPrice',price:1.75}})],[]);
  const after=result.state.registry.people.get(p.id);
  assert.equal(after.role,null);assert.ok(after.roleEpoch>p.roleEpoch);
  assert.equal(result.effects.some(e=>e.category==='bakerPrice'),false);
  assert.throws(()=>stepParticipantState(result.state,[{...action(result.state,after,idle()),epoch:p.roleEpoch}],[]),/invalid_action_tape/);
});

test('diary writes translate observer refs and are admitted by real kernel knowledge',()=>{
  const s=state();const p=baker(s);const subject=[...s.registry.people.values()].find(x=>x.id!==p.id&&x.role==='baker');
  for(let i=0;i<5;i++)s.world.identityLedger=recordEncounter(s.world.identityLedger,p.id,subject.id);
  const ref=observerRef(s.genesis.observerSecret,p.id,subject.id);
  const d={...idle(),diary:{subject:ref,observation:'keptAPromise',reading:'cantTellYet',context:null}};
  const result=stepParticipantState(s,[action(s,p,d)],[]);
  assert.ok(result.state.world.lastDiaryWrites.includes(p.id));
  assert.equal(result.state.world.diary.get(p.id)[0].value.subject,subject.id);
  assert.equal(s.world.diary.size,0);
});

test('auth rejects wrong/query identity, prevents second controller and invalidates disconnect/shutdown',()=>{
  const {host,session}=makeHost();
  assert.throws(()=>host.authenticate('bad'),/authentication_failed/);
  assert.throws(()=>host.authenticate(token),/lease_taken/);
  assert.throws(()=>host.read('?player=building-1'),/invalid_session/);
  host.disconnect(session);assert.throws(()=>host.read(session),/invalid_session/);
  const next=host.authenticate(token);assert.notEqual(next,session);
  host.close();assert.throws(()=>host.read(next),/invalid_session/);assert.throws(()=>host.authenticate(token),/authentication_failed/);
});

test('frame admission checks tick, token, exact fields, category quotas and payload kind',()=>{
  const {host,session}=makeHost();const o=host.read(session);
  assert.throws(()=>host.submit(session,{...frame(o,'bakerPrice',{price:1}),author:'victim'}),/invalid_frame/);
  assert.throws(()=>host.submit(session,{...frame(o,'bakerPrice',{price:1}),tick:999}),/stale_observation/);
  assert.throws(()=>host.submit(session,{...frame(o,'bakerPrice',{price:1}),observationId:'wrong'}),/stale_observation/);
  assert.throws(()=>host.submit(session,frame(o,'wallPost',{kind:'proximityUtterance'})),/invalid_payload/);
  host.submit(session,frame(o,'bakerPrice',{price:1}));
  assert.throws(()=>host.submit(session,frame(o,'bakerPrice',{price:2})),/category_quota/);
  host.submit(session,frame(o,'wallPost',{state:'hopeful'}));
  assert.throws(()=>host.submit(session,frame(o,'proximityUtterance',{intent:'ask',tone:'warm',referent:{kind:'room'}})),/category_quota/);
  host.advance();assert.throws(()=>host.submit(session,frame(o,'bakerPrice',{price:1})),/stale_observation/);
});

test('three successive ticks admit real prices; replay matches complete state each tick',()=>{
  const {host,session}=makeHost();
  for(const price of [0.25,0.75,1.25]) {
    const o=host.read(session);host.submit(session,frame(o,'bakerPrice',{price}));
    assert.ok(host.advance().some(e=>e.category==='bakerPrice'));
    assert.equal(host.read(session).projection.self.price,price);
  }
  host.disconnect(session);host.advance();
  const tape=host.exportTape();assert.equal(tape.ticks.length,4);assert.deepEqual(tape.ticks[3].online,[]);
  assert.equal(evidenceHash(replay(tape,tape.genesis.sourceRevision)),host.evidence());
  assert.throws(()=>replay(tape,'wrong-version'),/source_revision/);
  const altered=structuredClone(tape);altered.ticks[1].actions[0].decision.role.price=1.95;
  assert.throws(()=>replay(altered,tape.genesis.sourceRevision),/replay_divergence:1/);
  const reordered=structuredClone(tape);reordered.ticks.reverse();assert.throws(()=>replay(reordered,tape.genesis.sourceRevision),/replay_order/);
  const omitted=structuredClone(tape);omitted.ticks[0].actions=[];assert.throws(()=>replay(omitted,tape.genesis.sourceRevision),/replay_divergence:0/);
});

test('offline broker joins authoritative context without tokens and rejects late fixture result',async()=>{
  const {host,session}=makeHost();
  const result=await host.evaluateFixture(session,async input=>{
    assert.equal(Object.hasOwn(input,'observationId'),false);assert.equal(input.role,'Baker');
    return {status:'completed',model:'offline-fixture',inputTokens:10,outputTokens:10,decision:{...idle(),role:{kind:'bakerPrice',price:0.5}}};
  });
  assert.equal(result.kind,'validated_offline');assert.ok(host.advance().some(e=>e.category==='bakerPrice'));
  let finish;const pending=host.evaluateFixture(session,()=>new Promise(r=>{finish=r;}));host.advance();
  finish({status:'completed',model:'offline-fixture',inputTokens:10,outputTokens:10,decision:{...idle(),role:{kind:'bakerPrice',price:2}}});
  assert.equal((await pending).kind,'rejected');
  assert.deepEqual(host.advance(),[]);
});

test('in-flight fixture cannot cross controller disconnect and reauthentication',async()=>{
  const {host,session}=makeHost();
  let finish;
  const pending=host.evaluateFixture(session,()=>new Promise(resolve=>{finish=resolve;}));
  host.disconnect(session);
  const replacement=host.authenticate(token);
  assert.notEqual(replacement,session);
  finish({status:'completed',model:'offline-fixture',inputTokens:10,outputTokens:10,decision:{...idle(),role:{kind:'bakerPrice',price:1.5}}});
  const outcome = await pending.then(value=>value,error=>error);
  assert.ok(outcome instanceof Error ? /invalid_session/.test(outcome.message) : outcome.kind === 'rejected');
  assert.deepEqual(host.advance(),[]);
  assert.equal(host.read(replacement).context.tick,1);
});

test('in-flight fixture cannot queue after controller disconnect without replacement',async()=>{
  const {host,session}=makeHost();
  let finish;
  const pending=host.evaluateFixture(session,()=>new Promise(resolve=>{finish=resolve;}));
  host.disconnect(session);
  finish({status:'completed',model:'offline-fixture',inputTokens:10,outputTokens:10,decision:{...idle(),role:{kind:'bakerPrice',price:1.5}}});
  const outcome = await pending.then(value=>value,error=>error);
  assert.ok(outcome instanceof Error ? /invalid_session/.test(outcome.message) : outcome.kind === 'rejected');
  assert.deepEqual(host.advance(),[]);
});

test('complete evidence distinguishes private state, ordered collections and queue contents',()=>{
  const s=state();const before=evidenceHash(s);s.world.diary.set('private-owner',[]);assert.notEqual(evidenceHash(s),before);
  assert.notEqual(canonical(new Map([['a',1],['b',2]])),canonical(new Map([['b',2],['a',1]])));
  assert.notEqual(canonical(new Set(['a','b'])),canonical(new Set(['b','a'])));
  assert.notEqual(canonical({q:[]}),canonical({q:[{private:'action'}]}));
  assert.throws(()=>canonical({other:()=>0}),/unserializable_function/);
});

test('Grifter can move but cannot submit role or communication authority',()=>{
  const s=state();const p=[...s.registry.people.values()].find(x=>x.location!==null&&x.role===null);
  const o=observe(s,p.id,s.genesis.observerSecret);
  assert.equal(o.context.role,'Grifter');
  assert.throws(()=>stepParticipantState(s,[action(s,p,{...idle(),role:{kind:'bakerPrice',price:1}})],[]),/invalid_decision/);
  assert.throws(()=>stepParticipantState(s,[action(s,p,{...idle(),communication:{kind:'wallPost',state:'hopeful'}})],[]),/invalid_decision/);
  if(o.context.legalMoves.length)assert.ok(stepParticipantState(s,[action(s,p,{...idle(),move:o.context.legalMoves[0]})],[]).effects.some(e=>e.category==='move'));
});

test('real kernel proximity produces listener-specific authorized hearing',()=>{
  const s=state();const p=baker(s);const listener=[...s.registry.people.values()].find(x=>x.id!==p.id&&x.role==='baker');
  const source=s.world.bakers.find(x=>x.buildingId===p.location);
  // A genesis test arrangement: actual two bodies share a real plot, not a runtime teleport.
  s.world.bakers=s.world.bakers.map(b=>b.buildingId===listener.location?{...b,x:source.x,y:source.y}:b);
  const targetRef=observerRef(s.genesis.observerSecret,p.id,listener.id);
  const result=stepParticipantState(s,[action(s,p,{...idle(),communication:{kind:'proximityUtterance',intent:'ask',tone:'warm',referent:{kind:'player',playerId:targetRef},context:null}})],[]);
  assert.ok(result.state.world.lastProximityConversations.some(e=>e.listenerId===listener.id));
  const view=observe(result.state,listener.id,s.genesis.observerSecret).projection.proximity;
  assert.ok(view.length);assert.equal(JSON.stringify(view).includes(p.id),false);
  const outsider=[...s.registry.people.values()].find(x=>x.id!==p.id&&x.id!==listener.id&&x.role===null);
  assert.deepEqual(observe(result.state,outsider.id,s.genesis.observerSecret).projection.proximity,[]);
});

test('departure ends the bound controller and replay includes identity churn',()=>{
  const {host,session}=makeHost(10,{...quiet,pMonthly:1,migrationK:1,migrationTheta:0,opportunityWeight:0});
  let departed=false;
  for(let i=0;i<100&&!departed;i++){
    host.advance();try{host.read(session);}catch{departed=true;}
  }
  assert.ok(departed);assert.throws(()=>host.read(session),/invalid_session/);
  assert.throws(()=>host.authenticate(token),/authentication_failed/);
  const tape=host.exportTape();assert.equal(evidenceHash(replay(tape,tape.genesis.sourceRevision)),host.evidence());
});

test('registry replacement never inherits old recognition or diary owner keys',()=>{
  const s=state();const p=baker(s);const oldId=p.id;const subject=[...s.registry.people.values()].find(x=>x.id!==p.id&&x.role==='baker');
  for(let i=0;i<5;i++)s.world.identityLedger=recordEncounter(s.world.identityLedger,oldId,subject.id);
  writeDiaryEntry(s.world.diary,oldId,subject.id,'keptAPromise','cantTellYet',0,new Set([subject.id]));
  transitionPerson(s.registry,{from:p.location,to:null,role:null});
  const replacement=transitionPerson(s.registry,{from:null,to:p.location,role:'baker'});
  const view=observe(s,replacement.id,s.genesis.observerSecret);
  assert.deepEqual(view.projection.diary,[]);assert.deepEqual(view.projection.recognition,[]);
  assert.throws(()=>observe(s,oldId,s.genesis.observerSecret),/departed/);
});

test('real sabotage eviction preserves the exact person as a roleless inhabitant',()=>{
  const s=state();const p=baker(s);
  s.world.sabotageCampaigns=[{id:'fixture-campaign',targetBuildingId:p.location,saboteurId:null,stepsRequired:1,stepsCompleted:0,startedDay:-1,nextStepDay:0,investigatedBy:null}];
  s.world.rng=()=>0.999999999;
  const next=stepParticipantState(s,[],[]).state;
  assert.ok(next.world.lastSabotageCampaignEvents.some(e=>e.type==='succeeded'));
  const after=next.registry.people.get(p.id);assert.equal(after.role,null);assert.ok(after.roleEpoch>p.roleEpoch);
  assert.ok(next.world.grifters.some(g=>g.id===after.location));assertPopulation(next.world,next.registry);
});

test('district consolidation preserves evicted people instead of replacing their identities',()=>{
  const s=state();const p=baker(s);
  const d=s.world.shard.districts.find(d=>d.buildings.some(b=>b.id===p.location));
  s.world.districtHealth[d.id]={state:'CONSOLIDATING',consolidatingSince:-14,emaFilledFraction:0,daysBelowTippingPoint:21};
  const next=stepParticipantState(s,[],[]).state;
  assert.equal(next.world.districtHealth[d.id].state,'MERGED');assert.equal(next.registry.people.get(p.id).role,null);
  assertPopulation(next.world,next.registry);
});

test('overdue grifter draft binds exact source person to the actual open workplace',()=>{
  const s=state();const previous=baker(s);const g=s.world.grifters[0];const drafted=s.registry.locations.get(g.id);
  // Explicit fixture vacancy/departure before this tick; all other source state is real.
  s.world.bakers=s.world.bakers.map(b=>b.buildingId===previous.location?{...b,slot:{state:'VACANT',vacantSince:0}}:b);
  transitionPerson(s.registry,{from:previous.location,to:null,role:null});s.world.population--;
  s.world.grifters=s.world.grifters.map(x=>x.id===g.id?{...x,consolidationDeadline:0}:x);
  const next=stepParticipantState(s,[],[]).state;
  assert.equal(next.registry.people.get(drafted).location,previous.location);
  assert.equal(next.registry.people.get(drafted).role,'baker');assert.equal(next.registry.people.get(previous.id).location,null);
  assertPopulation(next.world,next.registry);
});
