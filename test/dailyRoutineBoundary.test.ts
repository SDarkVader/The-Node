import {describe,it,expect} from 'vitest';
import {createParticipantState,fixtureGenesis} from '../src/agent/participantWorld.js';
import {societyConfig} from '../src/society/runtime.js';
import {observe,observerRef,refHexLength,personBody} from '../src/server/observer.js';
import {buildSocietyContext,assertSerializedSocietyVisibleContext,validateSocietyAction,type SocietyRoutineObservation} from '../src/society/boundary.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {emptySocietyAction} from '../src/society/policy.js';
import {oracleWinProbability} from '../src/engine/oracle.js';

function fixture(role:string|null='miller'){
 const state=createParticipantState(fixtureGenesis(42,{...societyConfig(),diarySubjectOptional:true}));
 const person=[...state.registry.people.values()].find(p=>p.role===role)!,own=personBody(state,person);
 const ref=(id:string)=>observerRef(state.genesis.observerSecret,person.id,id,refHexLength(state.world));
 const buildings=state.world.shard.districts.flatMap(d=>d.buildings),hub=state.world.shard.hubPlot;
 const workplace=buildings.find(b=>b.id===own.workplace),home=workplace??buildings[0]!;
 const bakeries=state.world.bakers.map(b=>{const q=buildings.find(q=>q.id===b.buildingId)!;return {buildingId:q.id,x:q.x,y:q.y,sellerRef:ref(state.registry.locations.get(q.id)!)};});
 const market=state.world.bakers.map(b=>({buildingId:b.buildingId,sellerRef:ref(state.registry.locations.get(b.buildingId)!),price:0.5,available:true}));
 const routine:SocietyRoutineObservation={turn:1,maxTurnsPerDay:128,home:{buildingId:home.id,x:home.x,y:home.y,floor:1},
  sites:{wall:{x:hub.x,y:hub.y},oracle:{x:hub.x,y:hub.y},workplace:workplace?{buildingId:workplace.id,x:workplace.x,y:workplace.y}:null,bakeries},
  tasks:{leftHome:false,work:role===null,wall:false,food:false,diary:false,conversation:role===null,oracle:false},customers:[],awaitingSeller:null,
  can:{wallPost:false,diary:own.x===home.x&&own.y===home.y,work:!!workplace,foodFailure:false,finishDay:false,oracle:false},
  postcardsUsed:false,dailyOracleUsed:false,lotteryUsed:false};
 const options={phase:'act' as const,routine,market,purchaseDue:true};
 const build=()=>buildSocietyContext(state,person.id,options);
 return {state,person,ref,routine,options,build,...build()};
}

describe('sequential daily inhabitant contract',()=>{
 it('passes the fixed worker with own progress and a public turn but no hidden or host fields',()=>{
  const f=fixture(),request=buildSocietyRequest(f.visible);
  expect(f.visible.routine?.turn).toBe(1);expect(f.visible.rules.communication).toContain('per turn');
  expect(f.visible.rules.roles.Baker.duties).toContain('Answer customers');
  expect(f.visible.rules.occupationalChoice).toContain('Role holders remain available until');
  expect(f.visible.rules.diary).toContain('Choose when');
  validateSocietyWire(Buffer.from(request.body),request.sha256);
  expect(request.body).not.toContain(f.state.genesis.observerSecret);
  const other=f.state.world.bakers[0]!;other.wealth=987654;other.personalResourceStock=111111;
  Object.assign(f.state.world,{packageInformation:'PRIVATE_PACKAGE',operatorNotes:'PRIVATE_NOTES'});
  expect(buildSocietyRequest(f.build().visible).body).toBe(request.body);
 });
 it.each(['worldState','seed','inventory','intentions','developmentUpdate'])('rejects nested routine injection %s',key=>{
  const f=fixture(),bad=structuredClone(f.visible) as any;bad.routine.tasks[key]='PROHIBITED';
  expect(()=>assertSerializedSocietyVisibleContext(bad)).toThrow();
 });
 it('keeps waiting legal, rejects premature finish, remote work, remote Wall and remote purchases',()=>{
  const f=fixture();expect(validateSocietyAction(emptySocietyAction(),f.context)).toEqual(emptySocietyAction());
  expect(()=>validateSocietyAction({...emptySocietyAction(),occupation:{kind:'finishDay'}},f.context)).toThrow();
  expect(()=>validateSocietyAction({...emptySocietyAction(),communication:{kind:'wallPost',state:'hopeful'}},f.context)).toThrow();
  expect(()=>validateSocietyAction({...emptySocietyAction(),purchase:{seller:f.options.market[0]!.sellerRef,quantity:1}},f.context)).toThrow();
  f.routine.can.work=false;const remote=f.build();
  expect(()=>validateSocietyAction({...emptySocietyAction(),occupation:{kind:'work'}},remote.context)).toThrow();
 });
 it.each(['baker','miller','courier','investigator','importExport'])('gives %s a workplace work choice and home diary choice',role=>{
  const f=fixture(role);
  expect(validateSocietyAction({...emptySocietyAction(),occupation:{kind:'work'},diary:{subject:null,observation:'stayedGuarded',reading:'cantTellYet',context:null}},f.context)).toMatchObject({occupation:{kind:'work'}});
 });
 it('does not give a roleless person an occupational work choice',()=>{
  const f=fixture(null);
  expect(()=>validateSocietyAction({...emptySocietyAction(),occupation:{kind:'work'}},f.context)).toThrow();
 });
 it('requires the diary capability and blocks a second daily entry without changing its vocabulary',()=>{
  const f=fixture(),entry={subject:null,observation:'deflectedWhenConfronted',reading:'cantTellYet',context:null};
  expect(validateSocietyAction({...emptySocietyAction(),diary:entry},f.context).diary).toEqual(entry);
  f.routine.tasks.diary=true;f.routine.can.diary=false;const after=f.build();
  expect(()=>validateSocietyAction({...emptySocietyAction(),diary:entry},after.context)).toThrow('society_routine_diary');
  expect(after.visible.decisionSchema).toHaveProperty('properties.diary.type','null');
 });
 it('retains the closed diary and proximity grammars on sequential turns',()=>{
  const f=fixture(),entry={subject:null,observation:'stayedGuarded',reading:'cantTellYet',context:null};
  expect(()=>validateSocietyAction({...emptySocietyAction(),diary:{...entry,observation:'free text'}},f.context)).toThrow();
  expect(()=>validateSocietyAction({...emptySocietyAction(),diary:{...entry,notes:'free text'}},f.context)).toThrow();
  const utterance={kind:'proximityUtterance',intent:'ask',tone:'warm',referent:{kind:'room'},context:null};
  expect(validateSocietyAction({...emptySocietyAction(),communication:utterance},f.context).communication).toEqual(utterance);
  expect(()=>validateSocietyAction({...emptySocietyAction(),communication:{...utterance,intent:'free text'}},f.context)).toThrow();
  expect(()=>validateSocietyAction({...emptySocietyAction(),communication:{...utterance,referent:{kind:'player',playerId:f.context.selfRef}}},f.context)).toThrow();
  expect(()=>validateSocietyAction({...emptySocietyAction(),communication:{...utterance,referent:{kind:'player',playerId:'a'.repeat(16)}}},f.context)).toThrow();
 });
 it('cannot forge a capability inconsistent with the actor location or unfinished tasks',()=>{
  const f=fixture();f.routine.can.wallPost=true;expect(()=>f.build()).toThrow('society_routine_capabilities');
  const bad=structuredClone(f.visible) as any;bad.routine.can.finishDay=true;
  expect(()=>assertSerializedSocietyVisibleContext(bad)).toThrow('society_routine_capabilities');
 });
 it('requires a location and unconsumed daily choice for optional Oracle entries',()=>{
  const f=fixture();
  expect(f.visible.oracle.canEnter).toBe(false);
  expect(()=>validateSocietyAction({...emptySocietyAction(),oracle:'enter'},f.context)).toThrow();
  const bad=structuredClone(f.visible) as any;bad.oracle.canEnter=true;
  expect(()=>assertSerializedSocietyVisibleContext(bad)).toThrow();
 });
 it('makes repeated postcard and Oracle selections unavailable after their actual daily use',()=>{
  const f=fixture(),hub=f.state.world.shard.hubPlot;
  const body=f.state.world.millers.find(m=>m.buildingId===f.person.location)!;body.x=hub.x;body.y=hub.y;
  f.routine.can.work=false;f.routine.can.diary=false;f.routine.can.oracle=true;
  const postcards={held:{white:5,green:0,blue:0,purple:0,orange:0},unclaimedUnits:'0',rate:{numerator:1,denominator:1},clockMs:0,lastClaimAtMs:null};
  const dailyOracle={economicHealth:f.state.world.economicHealthWithExperience,winProbability:oracleWinProbability(f.state.world.economicHealthWithExperience),
    rewards:[{id:'small',amount:0.05,probability:0.9},{id:'medium',amount:0.15,probability:0.09},{id:'large',amount:0.3,probability:0.01}],lastResult:null};
  const options={...f.options,postcards,dailyOracle,oracle:{entryCost:0.3,winProbability:oracleWinProbability(f.state.world.economicHealthWithExperience),canEnter:true,canRedeem:false}};
  const before=buildSocietyContext(f.state,f.person.id,options),a={...emptySocietyAction(),postcards:{claim:false,fusion:{tier:'white',stake:5}},dailyOracle:'enter',oracle:'enter'};
  expect(validateSocietyAction(a,before.context)).toMatchObject({dailyOracle:'enter',oracle:'enter'});
  f.routine.postcardsUsed=true;f.routine.dailyOracleUsed=true;f.routine.lotteryUsed=true;
  const after=buildSocietyContext(f.state,f.person.id,options);
  expect(after.visible.legalChoices.postcards).toEqual({canClaim:false,fusion:[]});
  expect(after.visible.dailyOracle?.canEnter).toBe(false);expect(after.visible.oracle.canEnter).toBe(false);
  expect(()=>validateSocietyAction(a,after.context)).toThrow();
  validateSocietyWire(Buffer.from(buildSocietyRequest(after.visible).body),buildSocietyRequest(after.visible).sha256);
 });
 it('exposes customer refs only as own service obligations and prevents finishing with an unanswered seller',()=>{
  const f=fixture();Object.keys(f.routine.tasks).forEach(k=>(f.routine.tasks as any)[k]=true);
  f.routine.can.work=false;f.routine.can.diary=false;f.routine.awaitingSeller=f.options.market[0]!.sellerRef;f.routine.can.finishDay=true;
  expect(()=>f.build()).toThrow('society_routine_capabilities');
 });
});
