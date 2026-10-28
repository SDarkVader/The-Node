import {describe,it,expect} from 'vitest';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {validateSocietyAction,assertSerializedSocietyVisibleContext} from '../src/society/boundary.js';
import {buildSocietyRequest,societyOutputSchema} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {openSocietySenses} from '../src/society/senses.js';
import {shortestGridPath,assertGridPath} from '../src/engine/navigation.js';
import {validatePerception,PERCEPTION_PROFILE,PERCEPTION_SCHEMA,effectiveRange,type PerceptionRequest} from '../src/observatory/perception.js';
import {validateNavigation,NAVIGATION_PROFILE,type NavigationRequest} from '../src/observatory/navigation.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {dualObservation} from '../src/society/navigation.js';
import {writeDiaryEntry} from '../src/engine/diary.js';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {anthropicSchema} from '../src/agent/anthropicRequest.js';

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
  it('keeps the full-feature provider grammar within documented Anthropic limits while retaining the full legal menu',async()=>{
    const s=new Society({seed:42,sourceRevision:'transport-test',config:societyConfig(),
      routine:{maxTurnsPerDay:64,information:'inhabitant-v1',navigation:'dual-v1'},
      postcards:{rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000},
      dailyOracle:JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8'))});
    let actMenus=0;
    for(let i=0;i<60;i++){
      const person=s.pendingPeople()[0]!,v=await s.prepareView(person,perceive),wire=buildSocietyRequest(v.visible);
      validateSocietyWire(Buffer.from(wire.body),wire.sha256);
      const sent=JSON.parse(wire.body),schema=sent.output_config.format.schema;
      expect(JSON.parse(sent.messages[0].content[0].text)).toEqual(v.visible);
      let unions=0,optional=0;
      const inspect=(q:any):void=>{if(q&&typeof q==='object'){
        if(q.anyOf||Array.isArray(q.type))unions++;
        if(q.anyOf)expect(Object.keys(q)).toEqual(['anyOf']);
        if(q.type==='object'){
          expect(q.additionalProperties).toBe(false);
          optional+=Object.keys(q.properties).filter(k=>!q.required.includes(k)).length;
        }
        for(const k of ['minimum','maximum','minLength','maxLength','maxItems','$ref','$defs'])expect(q).not.toHaveProperty(k);
        Object.values(q).forEach(inspect);
      }};inspect(schema);
      expect(unions).toBeLessThanOrEqual(16);expect(optional).toBe(0);
      if(v.visible.phase==='act'){
        actMenus++;expect(v.visible.legalChoices.moves.length).toBeGreaterThan(1);
        // A small output shape must never turn arbitrary coordinates into permission.
        expect(()=>validateSocietyAction({...nil(),postcards:null,dailyOracle:null,move:{x:99999,y:99999}},v.context)).toThrow();
      }else expect(schema.properties.move).toEqual({type:'null'});
      const action=autonomousPolicy(v.visible);
      await s.prepareTravel(person,action,navigate);s.submit(person,action);
    }
    expect(actMenus).toBeGreaterThan(0);
  });
  it('rejects gaps, shortcuts, repeated steps and unreachable destinations',()=>{
    const grid=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:3,y:0}];
    expect(shortestGridPath(grid,grid[0]!,grid[2]!)).toEqual([grid[1],grid[2]]);
    expect(()=>shortestGridPath(grid,grid[0]!,grid[3]!)).toThrow('navigation_unreachable');
    expect(()=>assertGridPath(grid,grid[0]!,grid[2]!,[grid[2]!])).toThrow();
    expect(()=>assertGridPath(grid,grid[0]!,grid[2]!,[grid[1]!,grid[1]!])).toThrow();
  });
  it('rejects route results after another inhabitant changes the pending turn',async()=>{
    const s=create();await commit(s);
    const [person,other]=s.pendingPeople();
    const view=await s.prepareView(person!,perceive);
    await s.prepareView(other!,perceive);
    const target=view.visible.legalChoices.moves.find(q=>Math.abs(q.x-view.visible.self.x)+Math.abs(q.y-view.visible.self.y)>1)!;
    const turn=s.turn;
    await expect(s.prepareTravel(person!,{...nil(),move:target},async request=>{
      const route=await navigate(request);
      s.submit(other!,nil());
      return route;
    })).rejects.toThrow('society_stale_navigation');
    expect(s.turn).toBe(turn);
    expect(s.decisionEvidence(person!)).not.toHaveProperty('navigation');
    expect(s.pendingPeople()).toContain(person);
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
    const output=societyOutputSchema(v.visible) as any;
    expect(output.type).toBe('object');expect(output.additionalProperties).toBe(false);expect(output.required).toEqual(schema.required);
    expect(output).not.toHaveProperty('anyOf');
    expect(output.properties.move).toEqual({anyOf:[{type:'null'},{type:'object',properties:{x:{type:'integer'},y:{type:'integer'}},required:['x','y'],additionalProperties:false}]});
    expect(JSON.stringify(output)).not.toContain('$ref');expect(JSON.stringify(output)).not.toContain('$defs');
    const providerSubset=(q:any)=>{if(q&&typeof q==='object'){
      if(Array.isArray(q.anyOf))expect(Object.keys(q)).toEqual(['anyOf']);
      Object.values(q).forEach(providerSubset);
    }};providerSubset(output);
    const built=buildSocietyRequest(v.visible);validateSocietyWire(Buffer.from(built.body),built.sha256);
    const legacy=JSON.parse(built.body);legacy.output_config.format.schema=anthropicSchema(v.visible.decisionSchema);
    const bytes=Buffer.from(JSON.stringify(legacy)),sha=createHash('sha256').update(bytes).digest('hex');
    expect(()=>validateSocietyWire(bytes,sha)).toThrow('society_worker_schema');
    expect(()=>validateSocietyWire(bytes,sha,{historical:true})).not.toThrow();
    legacy.output_config.format.schema=societyOutputSchema(v.visible,{legacyUnion:true});
    const union=Buffer.from(JSON.stringify(legacy)),unionSha=createHash('sha256').update(union).digest('hex');
    expect(()=>validateSocietyWire(union,unionSha)).toThrow('society_worker_schema');
    expect(()=>validateSocietyWire(union,unionSha,{historical:true})).not.toThrow();
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
  it('exits the real preview CLI after authenticated stop and preserves the run',async()=>{
    const parent=mkdtempSync(join(tmpdir(),'node-navigation-cli-')),output=join(parent,'run');
    const child=spawn(process.execPath,['--import','tsx','scripts/preview-society.ts','--dual-navigation','--godot',process.env.NODE_GODOT_BIN!,
      '--port','0','--ticks','1','--output',output],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));
    try{
      const ready=await new Promise<any>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('preview_not_ready')),10000);
        child.stdout.on('data',b=>{log+=b.toString();for(const line of log.split('\n')){try{const v=JSON.parse(line);if(v.event==='observatory_ready'){clearTimeout(timer);resolve(v);}}catch{}}});
        child.stderr.on('data',b=>{log+=b.toString();});
      });
      expect(ready.providerCalls).toBe(0);
      const response=await fetch(ready.url+'observatory/v1/runs/deterministic-preview/stop',{method:'POST',headers:{Authorization:'Bearer '+ready.loginToken,'Content-Type':'application/json'},body:'{}'});
      expect(response.status).toBe(200);
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{expect(await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('preview_did_not_exit')),5000);})])).toBe(0);}
      finally{if(timer)clearTimeout(timer);}
      expect(readFileSync(join(output,'society.json'),'utf8').length).toBeGreaterThan(0);
      expect(log).toContain('preview_complete');
    }finally{if(child.exitCode===null)child.kill();await exited;rmSync(parent,{recursive:true,force:true});}
  },20000);
  it('moves a non-adjacent trip in one decision, obtains arrival sight/options, executes work and cold-replays in Observatory',async()=>{
    const senses=await openSocietySenses();
    try{
      const s=create();await commit(s,senses);
      let modelCalls=0;
      const actor=s.pendingPeople().find(p=>{const own=s.inspect().registry.people.get(p)!;return own.role==='miller';})!;
      const v=await s.prepareView(actor,senses.perceive);
      const to=v.visible.dual!.overhead.districts.flatMap(d=>d.locations).find(b=>b.buildingId===v.visible.self.workplace)!;
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
