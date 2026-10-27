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
import WebSocket from 'ws';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,statSync,utimesSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
const apps:{close:()=>Promise<void>}[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
it('checks actual saved bytes before reusing verification, including same-size timestamp-restored edits',()=>{
  const directory=mkdtempSync(join(tmpdir(),'node-observatory-byte-cache-'));
  try{
    const society=new Society({seed:42,sourceRevision:'cache-test'}),path=join(directory,'society.json');
    writeFileSync(path,stringifySocietyEvidence(society.exportTape()));writeFileSync(join(directory,'events.jsonl'),'');
    const source=new SocietyObservatorySource({kind:'society',id:'cache-test',directory,mode:'synthetic'});
    expect(source.refresh()).toBe(true);expect(source.refresh()).toBe(true);
    const before=readFileSync(path,'utf8'),stat=statSync(path),changed=before.replace('"seed": 42','"seed": 43');
    expect(changed).not.toBe(before);expect(changed.length).toBe(before.length);
    writeFileSync(path,changed);utimesSync(path,stat.atime,stat.mtime);
    expect(()=>source.refresh()).toThrow();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it('uses the trusted live revision only until an actual controller change',()=>{
  const society=new Society({seed:42,sourceRevision:'cache-test'});let version='one',reads=0;
  const source=new SocietyObservatorySource({kind:'society',id:'live-cache-test',directory:'',mode:'synthetic'},
    {version:()=>version,read:()=>{reads++;return {tape:society.exportTape(),eventsText:''};},stop:()=>society.halt()});
  source.refresh();source.refresh();expect(reads).toBe(1);
  const person=society.pendingPeople()[0]!;society.submit(person,autonomousPolicy(society.view(person).visible));version='two';
  source.refresh();expect(reads).toBe(2);
});
it('shuts down with an unfinished browser request instead of retaining the launcher lock',async()=>{
  const f=fixture(),app=startObservatory({sources:[f.source],researcherToken:'r'.repeat(64),worldToken:'w'.repeat(64),port:0,pollMs:60000});
  const port=await app.ready;
  const request=httpRequest({host:'127.0.0.1',port,path:'/session',method:'POST',headers:{'Content-Type':'application/json','Content-Length':'4096'}});
  request.on('error',()=>{});request.write('{"token":"');await once(request,'socket');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('shutdown_retained_connection')),2000);})]);}
  finally{if(timer)clearTimeout(timer);request.destroy();}
});
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
it.each([true,false])('halts on a rehashed false observation whether already admitted or still pending (%s)',admitted=>{
  const f=fixture(),p=f.society.pendingPeople()[0]!,view=f.society.view(p),request=buildSocietyRequest(view.visible);
  const wire=JSON.parse(request.body),observation=JSON.parse(wire.messages[0].content[0].text);
  observation.self.wealth=987654;wire.messages[0].content[0].text=JSON.stringify(observation);const body=JSON.stringify(wire);
  if(admitted)f.society.submit(p,autonomousPolicy(view.visible));
  f.events=JSON.stringify(JSON.parse(stringifySocietyEvidence({kind:'request',data:{requestId:'TEST-ONLY-conflict',actorId:p,index:0,tick:0,phase:'commit',body,sha256:sha256(body)}})));
  expect(()=>f.source.refresh()).toThrow(admitted?'society_observatory_evidence_boundary':'society_observatory_unbound_observation');
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
  expect(history.records.every((r:any)=>r.observation&&r.admitted&&r.thinking.status==='not_a_model'&&r.thinking.source==='deterministic_policy')).toBe(true);
  expect((await invoke('/advance','POST',command)).status).toBe(409);expect(f.gate.state.waitingDay).toBe(2);
  expect((await invoke('/advance','POST',{cursor:'live',day:2,version:f.gate.state.version})).status).toBe(200);await next;f.gate.close();
});
it('cancels and closes pending manual waits without retaining abort listeners or permitting another day',async()=>{
  const gate=new ManualTickGate(),controller=new AbortController(),waiting=gate.wait(1,controller.signal);
  controller.abort();await expect(waiting).rejects.toThrow('society_cancelled');expect(gate.state.waitingDay).toBeNull();
  const second=gate.wait(2);gate.close();await expect(second).rejects.toThrow('society_cancelled');expect(()=>gate.advance(2)).toThrow();
});

it('keeps a v4 partial day and historical turn synchronized across researcher and Godot projections',async()=>{
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),routine:{maxTurnsPerDay:128}});
  const source=new SocietyObservatorySource({kind:'society',id:'sync-test',directory:'',mode:'synthetic'},
    {stop:()=>society.halt(),read:()=>({tape:society.exportTape(),eventsText:''})});
  source.refresh();
  const R='r'.repeat(64),W='w'.repeat(64),app=startObservatory({sources:[source],researcherToken:R,worldToken:W,port:0,pollMs:60000});apps.push(app);
  const port=await app.ready,base=`http://127.0.0.1:${port}/observatory/v1/runs/sync-test`,headers={Authorization:'Bearer '+R,'Content-Type':'application/json'};
  const ws=new WebSocket(base.replace('http:','ws:')+'/world',{headers:{Authorization:'Bearer '+W}}),frames:any[]=[];
  ws.on('message',b=>frames.push(JSON.parse(b.toString())));await once(ws,'open');
  while(society.phase==='commit')for(const p of society.pendingPeople())society.submit(p,autonomousPolicy(society.view(p).visible));
  for(let turn=0;turn<2;turn++)for(const p of society.pendingPeople())society.submit(p,autonomousPolicy(society.view(p).visible));
  app.refresh();await new Promise(r=>setTimeout(r,30));
  const latest=await(await fetch(base+'/snapshot',{headers})).json() as any;
  const coordinates=(people:any[])=>people.map(p=>[p.x,p.y,p.role]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  expect(latest.sourceTick).toBe(0);expect(latest.worldHash).toBe(society.hash);
  expect(frames.at(-1).worldHash).toBe(latest.worldHash);
  expect(coordinates(frames.at(-1).people)).toEqual(coordinates(latest.frame.people));
  const tape=society.exportTape();
  const expected=tape.turnTransitions!.flatMap(t=>t.effects).filter(e=>e.category==='move').length;
  expect(expected).toBeGreaterThan(0);
  expect(latest.calls.flatMap((c:any)=>c.effects).filter((e:string)=>e==='move')).toHaveLength(expected);
  const earlier=source.list().find(p=>p.type==='turn_committed'&&p.sourceTurn===2)!;
  expect(earlier).toBeTruthy();
  expect((await fetch(base+'/selection',{method:'PUT',headers,body:JSON.stringify({cursor:earlier.cursor})})).status).toBe(200);
  await new Promise(r=>setTimeout(r,30));
  const replay=await(await fetch(base+'/snapshot',{headers})).json() as any;
  expect(replay.cursor).toBe(earlier.cursor);expect(frames.at(-1).cursor).toBe(replay.cursor);
  expect(frames.at(-1).worldHash).toBe(replay.worldHash);
  expect(coordinates(frames.at(-1).people)).toEqual(coordinates(replay.frame.people));
  expect(replay.worldHash).not.toBe(latest.worldHash);
  ws.close();await once(ws,'close');
});
