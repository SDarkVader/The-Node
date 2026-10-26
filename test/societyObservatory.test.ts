import {afterEach,expect,it} from 'vitest';
import {Society} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {ManualTickGate} from '../src/society/manualTicks.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';
import {startObservatory} from '../src/observatory/server.js';
import {projectWorld} from '../src/observatory/worldProjection.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {sha256} from '../src/agent/accountingStore.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
const apps:{close:()=>Promise<void>}[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
function fixture(){
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40)}),gate=new ManualTickGate();let stopped=0;
  let eventsText='',tapeOverride:unknown=null;
  const source=new SocietyObservatorySource({kind:'society',id:'TEST-ONLY-society',directory:'',mode:'synthetic'},
    {gate,stop:()=>{stopped++;society.halt();},read:()=>({tape:(tapeOverride??society.exportTape()) as any,eventsText})});
  const tick=()=>{const target=society.tick+1;while(society.tick<target)for(const p of society.pendingPeople())society.submit(p,autonomousPolicy(society.view(p).visible));};
  return {society,gate,source,tick,get stopped(){return stopped;},set tape(value:unknown){tapeOverride=value;},set events(value:string){eventsText=value;}};
}
it('projects actual current and historical states, and never includes private observations in the Godot channel',()=>{
  const f=fixture();f.source.refresh();const initial=f.source.list()[0]!.cursor;f.tick();f.source.refresh();
  const now=f.source.snapshot(null,'same-secret',true);
  expect(now.sourceTick).toBe(1);expect(now.worldHash).toBe(f.society.hash);
  expect(now.frame.people).toEqual(projectWorld(f.society.inspect(),'same-secret').frame.people);
  expect(f.source.snapshot(initial,'same-secret',true).sourceTick).toBe(0);
  const world=JSON.stringify(f.source.snapshot(null,'same-secret',false));
  for(const hidden of ['"observerSecret"','"controlled"','"diary"','"calls"','"rawRecord"','society-inhabitant:'])expect(world).not.toContain(hidden);
  expect(f.society.tick).toBe(1); // Viewing neither advances nor runs any policy.
});
it('halts the active society when saved world/action replay is inconsistent',()=>{
  const f=fixture();f.tick();const tape=f.society.exportTape();(tape.decisions[0]!.visible as any).hostOperation='exec';f.tape=tape;
  expect(()=>f.source.refresh()).toThrow();expect(f.stopped).toBe(1);expect(f.society.halted).toBe(true);
});
it('halts on a prohibited raw request even if it was never submitted into the world',()=>{
  const f=fixture(),person=f.society.pendingPeople()[0]!,request=buildSocietyRequest(f.society.view(person).visible);
  const wire=JSON.parse(request.body);wire.system+=' Development update: packages changed.';const body=JSON.stringify(wire);
  f.events=JSON.stringify(JSON.parse(stringifySocietyEvidence({kind:'request',data:{requestId:'bad',actorId:person,index:0,tick:0,phase:'commit',body,sha256:sha256(body)}})));
  expect(()=>f.source.refresh()).toThrow('society_worker_instructions');expect(f.society.halted).toBe(true);
});
it('halts on a valid-shape request whose rehashed observation conflicts with the admitted tape view',()=>{
  const f=fixture(),p=f.society.pendingPeople()[0]!,view=f.society.view(p),request=buildSocietyRequest(view.visible);
  const wire=JSON.parse(request.body),observation=JSON.parse(wire.messages[0].content[0].text);
  observation.self.wealth=987654;wire.messages[0].content[0].text=JSON.stringify(observation);const body=JSON.stringify(wire);
  f.society.submit(p,autonomousPolicy(view.visible));
  f.events=JSON.stringify(JSON.parse(stringifySocietyEvidence({kind:'request',data:{requestId:'TEST-ONLY-conflict',actorId:p,index:0,tick:0,phase:'commit',body,sha256:sha256(body)}})));
  expect(()=>f.source.refresh()).toThrow('society_observatory_evidence_boundary');
  expect(f.stopped).toBe(1);expect(f.society.halted).toBe(true);
});
it('authenticates manual control, rejects cross-origin requests and duplicate/stale permits, and keeps replay read-only',async()=>{
  const f=fixture(),researcherToken='r'.repeat(64),worldToken='w'.repeat(64),permit=f.gate.wait(1);f.source.refresh();
  const app=startObservatory({sources:[f.source],researcherToken,worldToken,port:0,pollMs:10000});apps.push(app);
  const origin=`http://127.0.0.1:${await app.ready}`,base=origin+'/observatory/v1/runs/TEST-ONLY-society';
  const invoke=(path:string,method:string,body:unknown,token=researcherToken,extra={})=>fetch(base+path,{method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  const state=f.gate.state,command={cursor:'live',day:1,version:state.version};
  expect((await invoke('/advance','POST',command,worldToken)).status).toBe(401);
  expect((await invoke('/advance','POST',command,researcherToken,{Origin:'https://untrusted.invalid'})).status).toBe(403);
  const genesis=f.source.list()[0]!.cursor;
  expect((await invoke('/selection','PUT',{cursor:genesis})).status).toBe(200);
  expect((await invoke('/advance','POST',command)).status).toBe(409);expect(f.gate.state.waitingDay).toBe(1);
  await invoke('/selection','PUT',{cursor:null});expect((await invoke('/advance','POST',command)).status).toBe(200);await permit;
  expect((await invoke('/advance','POST',command)).status).toBe(409);
  f.tick();const next=f.gate.wait(2);app.refresh();
  const history=await(await fetch(base+'/history?agent=society-inhabitant%3A0',{headers:{Authorization:'Bearer '+researcherToken}})).json() as any;
  expect(history.records).toHaveLength(2);expect(history.records.map((r:any)=>r.phase)).toEqual(['commit','act']);
  expect(history.records.every((r:any)=>r.observation&&r.admitted&&r.thinking.status==='response_unavailable')).toBe(true);
  expect((await invoke('/advance','POST',command)).status).toBe(409);expect(f.gate.state.waitingDay).toBe(2);
  expect((await invoke('/advance','POST',{cursor:'live',day:2,version:f.gate.state.version})).status).toBe(200);await next;f.gate.close();
});
it('cancels and closes pending manual waits without retaining abort listeners or permitting another day',async()=>{
  const gate=new ManualTickGate(),controller=new AbortController(),waiting=gate.wait(1,controller.signal);
  controller.abort();await expect(waiting).rejects.toThrow('society_cancelled');expect(gate.state.waitingDay).toBeNull();
  const second=gate.wait(2);gate.close();await expect(second).rejects.toThrow('society_cancelled');expect(()=>gate.advance(2)).toThrow();
});
