import {describe,it,expect} from 'vitest';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {validateSocietyAction,assertSerializedSocietyVisibleContext} from '../src/society/boundary.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {openSocietySenses} from '../src/society/senses.js';
import {shortestGridPath,assertGridPath} from '../src/engine/navigation.js';
import {validatePerception,PERCEPTION_PROFILE,PERCEPTION_SCHEMA,effectiveRange,type PerceptionRequest} from '../src/observatory/perception.js';
import {validateNavigation,NAVIGATION_PROFILE,type NavigationRequest} from '../src/observatory/navigation.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {dualObservation} from '../src/society/navigation.js';
import {writeDiaryEntry} from '../src/engine/diary.js';

const create=()=>new Society({seed:42,sourceRevision:'navigation-test',config:{...societyConfig(),commsProximityRange:1},routine:{maxTurnsPerDay:64,information:'inhabitant-v1',navigation:'dual-v1'}});
const nil=()=>({move:null,communication:null,diary:null,occupation:null,purchase:null,oracle:null});
const perceive=async(r:PerceptionRequest)=>{
  const response={type:'perception' as const,schema:PERCEPTION_SCHEMA,profile:PERCEPTION_PROFILE,requestId:r.requestId,agentId:r.agentId,tick:r.tick,worldHash:r.worldHash,perspective:r.perspective,
    engine:{name:'fixture',version:'synthetic'},observation:{effectiveRange:effectiveRange(r.condition),bodies:[],locations:[],environment:{localTensionBand:r.scene.districts.find(d=>d.id===r.scene.observer.districtId)?.tensionBand??null,weather:r.condition.weather.kind}}};
  return validatePerception(r,response,JSON.stringify(response));
};
const navigate=async(r:NavigationRequest)=>{const response={type:'navigation',schema:'node-navigation-response-v1',profile:NAVIGATION_PROFILE,requestId:r.requestId,worldHash:r.worldHash,actorRef:r.actorRef,engine:{name:'fixture',version:'synthetic'},path:shortestGridPath(r.district.plots,r.from,r.to)};return validateNavigation(r,response,JSON.stringify(response));};
async function commit(s:Society,senses={perceive,navigate}){for(const p of s.pendingPeople()){const v=await s.prepareView(p,senses.perceive);s.submit(p,autonomousPolicy(v.visible));}}

describe('destination navigation boundary',()=>{
  it('rejects gaps, shortcuts, repeated steps and unreachable destinations',()=>{
    const grid=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:3,y:0}];
    expect(shortestGridPath(grid,grid[0]!,grid[2]!)).toEqual([grid[1],grid[2]]);
    expect(()=>shortestGridPath(grid,grid[0]!,grid[3]!)).toThrow('navigation_unreachable');
    expect(()=>assertGridPath(grid,grid[0]!,grid[2]!,[grid[2]!])).toThrow();
    expect(()=>assertGridPath(grid,grid[0]!,grid[2]!,[grid[1]!,grid[1]!])).toThrow();
  });
  it('provides one cached overhead per decision, no private map fields, no remote permissions, and fails stale results',async()=>{
    const s=create(),p=s.pendingPeople()[0]!;let count=0;
    expect(()=>s.view(p)).toThrow('society_perception_required');
    const v=await s.prepareView(p,async r=>{count++;return perceive(r);});
    expect((await s.prepareView(p,perceive)).visible).toEqual(v.visible);expect(count).toBe(1);
    const wire=buildSocietyRequest(v.visible);validateSocietyWire(Buffer.from(wire.body),wire.sha256);
    expect(v.visible.dual!.overhead.districts.length).toBeGreaterThan(0);
    const poisoned=structuredClone(v.visible);(poisoned.dual!.overhead.inhabitants[0] as any).wealth=100;
    expect(()=>assertSerializedSocietyVisibleContext(poisoned)).toThrow();
    const q=s.pendingPeople()[1]!;
    await expect(s.prepareView(q,async r=>{s.submit(p,nil());return perceive(r);})).rejects.toThrow('society_stale_perception');
  });
  it('rejects a map-only remote addressee, combined travel and work, missing routes and perspective switching',async()=>{
    const s=create();await commit(s);const p=s.pendingPeople()[0]!,v=await s.prepareView(p,perceive);
    const target=v.visible.legalChoices.moves.find(q=>Math.abs(q.x-v.visible.self.x)+Math.abs(q.y-v.visible.self.y)>1)!;
    expect(target).toBeDefined();
    const schema=v.visible.decisionSchema as any;
    const inspect=(q:any)=>{if(q&&typeof q==='object'){
      if(q.type==='object')expect(q.additionalProperties).toBe(false);
      if(q.enum)expect(q.enum.every((x:unknown)=>x===null||['number','string','boolean'].includes(typeof x))).toBe(true);
      Object.values(q).forEach(inspect);
    }};inspect(schema);
    const pairs=schema.$defs.move.anyOf.filter((q:any)=>q.type==='object').flatMap((q:any)=>
      q.properties.x.enum.flatMap((x:number)=>q.properties.y.enum.map((y:number)=>`${x},${y}`)));
    expect(new Set(pairs)).toEqual(new Set(v.visible.legalChoices.moves.map(q=>`${q.x},${q.y}`)));
    expect(()=>validateSocietyAction({...nil(),move:target,occupation:{kind:'work'}},v.context)).toThrow('society_travel_only');
    expect(()=>validateSocietyAction({...nil(),perspective:'isometric'},v.context)).toThrow();
    const remote=v.visible.dual!.overhead.inhabitants.find(q=>q.ref!==v.visible.self.ref&&!v.visible.hearing.includes(q.ref));
    expect(remote).toBeDefined();
    expect(()=>validateSocietyAction({...nil(),communication:{kind:'proximityUtterance',intent:'inform',tone:'warm',referent:{kind:'player',playerId:remote!.ref},context:null}},v.context)).toThrow();
    expect(()=>s.submit(p,{...nil(),move:target})).toThrow('society_navigation_required');
  });
  it('does not project another resident’s private assets or diary into overhead knowledge',async()=>{
    const s=create(),person=s.pendingPeople()[0]!,v=await s.prepareView(person,perceive),state=s.inspect();
    const before=dualObservation(state,person,v.visible.dual!.firstPerson);
    const other=[...state.registry.people.values()].find(p=>p.id!==person&&p.role==='baker')!;
    state.world.bakers.find(b=>b.buildingId===other.location)!.wealth+=100;
    writeDiaryEntry(state.world.diary,other.id,null,'stayedGuarded','cantTellYet',0,new Set(),undefined,true);
    (state.world as any).privateDiaryCanary='OTHER_PRIVATE_CANARY';
    expect(dualObservation(state,person,v.visible.dual!.firstPerson)).toEqual(before);
    const text=JSON.stringify(before);
    expect(text).not.toContain(state.genesis.observerSecret);expect(text).not.toContain('OTHER_PRIVATE_CANARY');
    for(const p of state.registry.people.keys())expect(text).not.toContain(JSON.stringify(p));
  });
});

describe.skipIf(!process.env.NODE_GODOT_BIN)('actual Godot destination → arrival → interaction',()=>{
  it('moves a non-adjacent trip in one decision, obtains arrival sight/options, executes work and cold-replays in Observatory',async()=>{
    const senses=await openSocietySenses();
    try{
      const s=create();await commit(s,senses);
      let modelCalls=0;
      const actor=s.pendingPeople().find(p=>{const own=s.inspect().registry.people.get(p)!;return own.role==='miller';})!;
      const v=await s.prepareView(actor,senses.perceive),to=v.visible.routine!.sites.workplace!;
      expect(Math.abs(to.x-v.visible.self.x)+Math.abs(to.y-v.visible.self.y)).toBeGreaterThan(1);
      expect(v.visible.routine!.can.work).toBe(false);
      const wire=buildSocietyRequest(v.visible);validateSocietyWire(Buffer.from(wire.body),wire.sha256);
      // The browser can refresh while a request is pending. Production journals are
      // evidence-codec envelopes, not plain JSON event objects.
      let stopped=false;
      const pending=new SocietyObservatorySource({id:'pending-native-trip',directory:'unused',kind:'society',mode:'synthetic'},
        {read:()=>({tape:s.exportTape(),eventsText:JSON.stringify(JSON.parse(stringifySocietyEvidence({kind:'request',data:{requestId:'pending-trip',index:0,
          actorId:actor,person:actor,tick:s.tick,phase:s.phase,turn:s.turn,...s.decisionEvidence(actor),body:wire.body,sha256:wire.sha256}})))}),stop:()=>{stopped=true;}});
      expect(pending.refresh()).toBe(true);expect(stopped).toBe(false);
      modelCalls++;const action=validateSocietyAction({...nil(),move:{x:to.x,y:to.y}},v.context);
      await s.prepareTravel(actor,action,senses.navigate);
      const route=s.decisionEvidence(actor).navigation!;expect(route.path.length).toBeGreaterThan(1);
      const before=senses.stats();s.submit(actor,action);
      for(const p of s.pendingPeople()){await s.prepareView(p,senses.perceive);s.submit(p,nil());}
      expect(modelCalls).toBe(1);expect(s.turn).toBe(2);
      const arrived=await s.prepareView(actor,senses.perceive);
      expect(arrived.visible.self).toMatchObject({x:to.x,y:to.y});expect(arrived.visible.routine!.can.work).toBe(true);
      expect(arrived.visible.dual!.firstPerson).toEqual(s.decisionEvidence(actor).perception!.observation);
      expect(arrived.visible.dual!.firstPerson.locations.some(l=>l.buildingId===to.buildingId)).toBe(true);
      modelCalls++;s.submit(actor,{...nil(),occupation:{kind:'work'}});
      for(const p of s.pendingPeople()){await s.prepareView(p,senses.perceive);s.submit(p,nil());}
      const next=await s.prepareView(actor,senses.perceive);expect(next.visible.routine!.tasks.work).toBe(true);expect(next.visible.routine!.can.work).toBe(false);
      expect(modelCalls).toBe(2);expect(before.refused).toBe(0);
      const tape=s.exportTape();expect(verifySocietyTape(tape,undefined,{allowPartial:true}).verified).toBe(true);
      const source=new SocietyObservatorySource({id:'navigation-proof',directory:'unused',kind:'society',mode:'synthetic'},
        {read:()=>({tape,eventsText:''}),stop:()=>{throw Error('unexpected_observatory_stop');}});
      expect(source.refresh()).toBe(true);
      console.log(JSON.stringify({actor,from:{x:v.visible.self.x,y:v.visible.self.y},destination:to,path:route.path,modelCalls,
        firstPerson:arrived.visible.dual!.firstPerson,arrivalCanWork:arrived.visible.routine!.can.work,workRecorded:next.visible.routine!.tasks.work,worker:senses.stats(),replay:true}));
    }finally{await senses.close();}
  },30000);
});
