import {afterAll,afterEach,beforeAll,describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,linkSync,symlinkSync,unlinkSync,existsSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createDurableHost,openDurableHost} from '../src/agent/durableHost.js';
import {CheckpointStore,inspectParticipantCheckpoint,type WriteStage} from '../src/agent/checkpoint.js';
import {fixtureGenesis,createParticipantState} from '../src/agent/participantWorld.js';
import {DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import type {OfflineParticipantHost} from '../src/agent/host.js';
import {startParticipantSocket} from '../src/server/participantSocket.js';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {digest,evidenceHash,replay} from '../src/agent/replay.js';

const root=mkdtempSync(join(tmpdir(),'node-participant-checkpoint-'));
const build=join(root,'compiled');
const token='checkpoint-fixture-controller-token';
const genesis=fixtureGenesis(32,{...DEFAULT_WORLD_CONFIG,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
const person=[...createParticipantState(genesis).registry.people.values()].find(p=>p.role==='baker')!.id;
const hosts:OfflineParticipantHost[]=[];
const servers:Awaited<ReturnType<typeof startParticipantSocket>>[]=[];
const clients:WebSocket[]=[];
let counter=0;
const directory=()=>join(root,`case-${counter++}`);
const track=(h:OfflineParticipantHost)=>{hosts.push(h);return h;};
const submit=(h:OfflineParticipantHost,s:string,price=0.75)=>{
  const o=h.read(s);const frame={type:'action',tick:o.context.tick,observationId:o.observationId,action:'bakerPrice',payload:{price}};
  h.submit(s,frame);return frame;
};
const inspect=(dir:string)=>inspectParticipantCheckpoint(dir,genesis.sourceRevision);
async function waitFor<T>(read:()=>T|undefined):Promise<T>{
  const end=Date.now()+2000;
  while(Date.now()<end){const result=read();if(result!==undefined)return result;await new Promise(r=>setTimeout(r,5));}
  throw Error('test_timeout');
}
beforeAll(()=>{
  execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',
    '--strict','--noUncheckedIndexedAccess','--skipLibCheck','--types','node','--typeRoots',resolve('node_modules/@types'),'--outDir',build,resolve('src/agent/durableHost.ts')]);
  writeFileSync(join(build,'package.json'),'{"type":"module"}');
});
afterEach(async()=>{
  for(const ws of clients.splice(0))ws.terminate();
  await Promise.all(servers.splice(0).map(s=>s.close().catch(()=>{})));
  for(const h of hosts.splice(0)){try{h.close();}catch{/* Failure tests intentionally stop storage. */}}
});
afterAll(()=>rmSync(root,{recursive:true,force:true}));

describe('durable participant checkpoint and crash recovery',()=>{
  it('round-trips undefined config and complete action-bearing evidence without resetting state',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));const session=h.authenticate(token);
    submit(h,session);h.advance();const hash=h.evidence();const tape=h.exportTape();h.close();
    expect(inspect(dir).status).toBe('closed');expect(inspect(dir).reason).toBe('clean_shutdown');
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token)).toThrow('checkpoint_closed');
    const resumed=track(openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true}));
    const current=resumed.authenticate(token);expect(resumed.evidence()).toBe(hash);expect(resumed.exportTape()).toEqual(tape);
    expect(resumed.read(current).projection.self.price).toBe(0.75);expect(resumed.read(current).context.tick).toBe(1);
    expect(Object.hasOwn(resumed.exportTape().genesis.config,'wealthCap')).toBe(true);
    expect(evidenceHash(replay(resumed.exportTape(),genesis.sourceRevision))).toBe(hash);
  });
  it('does not resurrect an in-flight fixture after clean shutdown and checkpoint reopening',async()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));const session=h.authenticate(token);
    let finish!: (value:{status:'completed';model:string;inputTokens:number;outputTokens:number;decision:{move:null;communication:null;diary:null;role:{kind:'bakerPrice';price:number}}})=>void;
    const pending=h.evaluateFixture(session,()=>new Promise(resolve=>{finish=resolve;}));
    h.close();
    const reopened=track(openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true}));
    const replacement=reopened.authenticate(token);
    finish({status:'completed',model:'offline-fixture',inputTokens:10,outputTokens:10,decision:{move:null,communication:null,diary:null,role:{kind:'bakerPrice',price:1.25}}});
    const outcome=await pending.then(value=>value,error=>error);
    expect(outcome instanceof Error || outcome.kind==='rejected').toBe(true);
    expect(reopened.exportTape().ticks).toHaveLength(0);
    expect(reopened.read(replacement).context.tick).toBe(0);
    reopened.advance();
    expect(reopened.exportTape().ticks[0]!.actions).toEqual([]);
    expect(reopened.read(replacement).context.tick).toBe(1);
    expect(evidenceHash(replay(reopened.exportTape(),genesis.sourceRevision))).toBe(reopened.evidence());
  });
  it('does not persist controller/session/observation tokens or resurrect queued proposals',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));const s=h.authenticate(token);const frame=submit(h,s);
    h.close();const bytes=readFileSync(join(dir,'participant.checkpoint.json'),'utf8');
    expect(bytes).not.toContain(token);expect(bytes).not.toContain(s);expect(bytes).not.toContain(frame.observationId);
    const resumed=track(openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true}));const next=resumed.authenticate(token);
    expect(()=>resumed.read(s)).toThrow('invalid_session');expect(()=>resumed.submit(next,frame)).toThrow('stale_observation');
    resumed.advance();expect(resumed.exportTape().ticks[0]!.actions).toEqual([]);
  });
  it('rejects missing, corrupt or wrong-revision records without creating replacement history',()=>{
    const absent=directory();mkdirSync(absent,{mode:0o700});expect(()=>openDurableHost(absent,genesis.sourceRevision,token)).toThrow();
    expect(existsSync(join(absent,'participant.checkpoint.json'))).toBe(false);
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));h.close();const file=join(dir,'participant.checkpoint.json');
    const original=readFileSync(file,'utf8');
    expect(()=>openDurableHost(dir,'wrong-source',token,{resumeCleanShutdown:true})).toThrow();expect(readFileSync(file,'utf8')).toBe(original);
    writeFileSync(file,original.slice(0,80),{mode:0o600});const corrupt=readFileSync(file,'utf8');
    writeFileSync(join(dir,'.participant.checkpoint.next'),original,{mode:0o600});
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_encoding');
    expect(readFileSync(file,'utf8')).toBe(corrupt);expect(readFileSync(join(dir,'.participant.checkpoint.next'),'utf8')).toBe(original);
    expect(()=>createDurableHost(dir,genesis,person,token)).toThrow();
  });
  it('detects payload corruption even when the outer JSON remains valid',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));h.close();const file=join(dir,'participant.checkpoint.json');
    const envelope=JSON.parse(readFileSync(file,'utf8'));const prior=envelope.payload;
    envelope.payload=envelope.payload.replace(genesis.sourceRevision,'tampered-reconstruction');expect(envelope.payload).not.toBe(prior);
    writeFileSync(file,JSON.stringify(envelope),{mode:0o600});
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_checksum');
  });
  it('allows only one writer and never reclaims a live writer even with stale-lock recovery enabled',()=>{
    const dir=directory();track(createDurableHost(dir,genesis,person,token));
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token)).toThrow();
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token,{recoverStaleLock:true})).toThrow('checkpoint_locked');
  });
  it('ignores and preserves a partial uncommitted temporary write instead of adopting it',()=>{
    const dir=directory();const child=spawnSync(process.execPath,[resolve('test/fixtures/checkpointCrash.mjs'),build,dir,'after_file_sync','2'],{encoding:'utf8',timeout:10000});
    expect(child.status).toBe(73);writeFileSync(join(dir,'.participant.checkpoint.next'),'{partial',{mode:0o600});
    const h=track(openDurableHost(dir,genesis.sourceRevision,token,{recoverStaleLock:true}));
    expect(h.exportTape().ticks).toHaveLength(0);
    const orphan=readdirSync(dir).find(name=>name.startsWith('.participant.orphan-'))!;
    expect(readFileSync(join(dir,orphan),'utf8')).toBe('{partial');
  });
  it('rejects an oversized checkpoint before parsing or replacing its contents',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));h.close();
    const file=join(dir,'participant.checkpoint.json');truncateSync(file,16*1024*1024+1);
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_file');
  });
  it('rejects hard-linked checkpoint files and linked directories',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));h.close();
    const extra=directory();linkSync(join(dir,'participant.checkpoint.json'),extra);
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_file');unlinkSync(extra);
    const alias=directory();symlinkSync(dir,alias,process.platform==='win32'?'junction':'dir');
    expect(()=>openDurableHost(alias,genesis.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_directory');unlinkSync(alias);
  });
  for(const stage of ['before_write','after_file_sync','after_rename'] as WriteStage[]){
    for(const writeNumber of [2,3]){
      it(`process crash at ${stage}, write ${writeNumber}: recovers only the authoritative intent once`,()=>{
        const dir=directory();const child=spawnSync(process.execPath,[resolve('test/fixtures/checkpointCrash.mjs'),build,dir,stage,String(writeNumber)],{encoding:'utf8',timeout:10000});
        expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(73);
        expect(()=>openDurableHost(dir,genesis.sourceRevision,token)).toThrow(); // Stale lock is never silently removed.
        const recovered=track(openDurableHost(dir,genesis.sourceRevision,token,{recoverStaleLock:true}));const session=recovered.authenticate(token);
        const committed=writeNumber===3||stage==='after_rename';
        expect(recovered.read(session).context.tick).toBe(committed?1:0);
        expect(recovered.exportTape().ticks).toHaveLength(committed?1:0);
        if(committed)expect(recovered.read(session).projection.self.price).toBe(0.75);
        const hash=recovered.evidence();recovered.close();
        const again=track(openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true}));
        expect(again.evidence()).toBe(hash);expect(again.exportTape().ticks).toHaveLength(committed?1:0);
        if(stage==='after_file_sync')expect(readdirSync(dir).some(name=>name.startsWith('.participant.orphan-'))).toBe(true);
      });
    }
  }
  it('denies duplicate submissions after restart and retains the committed price exactly once',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));const session=h.authenticate(token);
    const frame=submit(h,session);expect(()=>h.submit(session,frame)).toThrow('category_quota');h.advance();h.close();
    const next=track(openDurableHost(dir,genesis.sourceRevision,token,{resumeCleanShutdown:true}));const s=next.authenticate(token);
    expect(()=>next.submit(s,frame)).toThrow('stale_observation');expect(next.exportTape().ticks).toHaveLength(1);
  });
  it('fails closed on interrupted clean shutdown and does not claim the close was durable',()=>{
    const dir=directory();let writes=0;
    const h=track(createDurableHost(dir,genesis,person,token,{fault:stage=>{if(stage==='before_write'&&++writes===2)throw Error('fixture-storage-failure');}}));
    expect(()=>h.close()).toThrow('checkpoint_close_failed');expect(inspect(dir).status).toBe('running');
    const resumed=track(openDurableHost(dir,genesis.sourceRevision,token));expect(resumed.exportTape().ticks).toHaveLength(0);
  });
  it('halts and retains evidence for a prepared kernel failure rather than looping on it',()=>{
    const dir=directory();const store=CheckpointStore.create(dir,genesis,person);
    const tape=store.current().tape;
    store.prepare(tape,{tick:0,online:[person],actions:[{person,epoch:999,tick:0,decision:{move:null,communication:null,diary:null,role:null}}]});store.release();
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token)).toThrow('checkpoint_kernel_failed');
    expect(inspect(dir).status).toBe('halted');expect(inspect(dir).pending).not.toBeNull();
    expect(()=>openDurableHost(dir,genesis.sourceRevision,token)).toThrow('checkpoint_halted');
  });
  it('detects an unexpected on-disk change while owning the writer lock',()=>{
    const dir=directory();const h=track(createDurableHost(dir,genesis,person,token));const session=h.authenticate(token);submit(h,session);
    const file=join(dir,'participant.checkpoint.json');writeFileSync(file,readFileSync(file,'utf8')+'\n');
    expect(()=>h.advance()).toThrow('checkpoint_write_failed');expect(()=>h.read(session)).toThrow('invalid_session');
  });
  it('never sends a positive socket admission or observation when durable completion fails',async()=>{
    const dir=directory();let writes=0;
    const h=track(createDurableHost(dir,genesis,person,token,{fault:stage=>{if(stage==='before_write'&&++writes===3)throw Error('fixture-storage-failure');}}));
    const server=await startParticipantSocket({host:h});servers.push(server);const ws=new WebSocket(server.url);clients.push(ws);
    const messages:Record<string,any>[]=[];let closed=false;ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));ws.on('error',()=>{});ws.on('close',()=>{closed=true;});
    await once(ws,'open');ws.send(JSON.stringify({type:'authenticate',token}));
    const o=await waitFor(()=>messages.find(m=>m.type==='observation'));
    ws.send(JSON.stringify({type:'action',tick:o.context.tick,observationId:o.observationId,action:'bakerPrice',payload:{price:0.75}}));
    await waitFor(()=>messages.find(m=>m.type==='queued'));
    expect(()=>server.advance()).toThrow('kernel_execution_failed');await waitFor(()=>closed?true:undefined);
    expect(messages.filter(m=>m.type==='admission'&&m.accepted)).toEqual([]);
    expect(messages.filter(m=>m.type==='observation')).toHaveLength(1);
    const recovered=track(openDurableHost(dir,genesis.sourceRevision,token));const session=recovered.authenticate(token);
    expect(recovered.read(session).context.tick).toBe(1);expect(recovered.read(session).projection.self.price).toBe(0.75);
    expect(digest(recovered.exportTape())).toBe(digest(inspect(dir).tape));
  });
  it('closes every socket even when recording the clean shutdown fails',async()=>{
    const dir=directory();let writes=0;
    const h=track(createDurableHost(dir,genesis,person,token,{fault:stage=>{if(stage==='before_write'&&++writes===2)throw Error('fixture-storage-failure');}}));
    const server=await startParticipantSocket({host:h});servers.push(server);const ws=new WebSocket(server.url);clients.push(ws);
    let closed=false;ws.on('error',()=>{});ws.on('close',()=>{closed=true;});await once(ws,'open');
    await expect(server.close()).rejects.toThrow('checkpoint_close_failed');await waitFor(()=>closed?true:undefined);
    expect(inspect(dir).status).toBe('running');expect(()=>h.authenticate(token)).toThrow('authentication_failed');
    expect(()=>server.advance()).toThrow('transport_closed');
  });
  it('does not resume a departed person under a replacement identity',()=>{
    const g=fixtureGenesis(10,{...DEFAULT_WORLD_CONFIG,pMonthly:1,arrivalPDaily:0,migrationK:1,migrationTheta:0,opportunityWeight:0,saboteurCount:0});
    const p=[...createParticipantState(g).registry.people.values()].find(p=>p.role==='baker')!.id;
    const dir=directory();const h=track(createDurableHost(dir,g,p,token));let session=h.authenticate(token);let departed=false;
    for(let i=0;i<100&&!departed;i++){
      h.advance();try{h.read(session);}catch{departed=true;}
    }
    expect(departed).toBe(true);expect(inspect(dir).reason).toBe('departed');
    expect(()=>openDurableHost(dir,g.sourceRevision,token,{resumeCleanShutdown:true})).toThrow('checkpoint_closed');
  });
});
