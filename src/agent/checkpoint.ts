import {constants,openSync,closeSync,writeFileSync,readFileSync,fsyncSync,renameSync,mkdirSync,lstatSync,realpathSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {canonical,digest,evidenceHash,newTape,replay,type ReplayTape} from './replay.js';
import {createParticipantState,stepParticipantState,type Genesis,type CanonicalAction} from './participantWorld.js';

const FILE='participant.checkpoint.json';
const LOCK='.participant.writer.lock';
const NEXT='.participant.checkpoint.next';
const MAX_BYTES=16*1024*1024;
const MAX_TICKS=10000;
export type WriteStage='before_write'|'after_file_sync'|'after_rename';
export interface TickIntent {tick:number;online:string[];actions:CanonicalAction[]}
export interface FixtureAttempt {
  id:string;
  tick:number;
  epoch:number;
  contextHash:string;
  status:'pending'|'consumed'|'halted';
}
export interface CheckpointRecord {
  version:1|2;
  sequence:number;
  person:string;
  status:'running'|'prepared'|'closed'|'halted';
  reason:null|'clean_shutdown'|'departed'|'kernel_execution_failed';
  tape:ReplayTape;
  pending:TickIntent|null;
  /** v1 has no attempt history; absence must never be interpreted as unused admission. */
  fixtureAttempt?:FixtureAttempt|null;
}
export interface CheckpointOpenOptions {
  recoverStaleLock?:boolean;
  resumeCleanShutdown?:boolean;
  /** Trusted fault-injection seam. Never configurable from game input. */
  fault?:(stage:WriteStage)=>void;
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const safeText=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;

// Decode the existing canonical tagged representation, retaining optional undefined
// config fields. Plain JSON would silently drop them and change genesis evidence.
function decode(text:string):unknown {
  let nodes=0;
  const visit=(v:unknown,depth:number):unknown=>{
    if(++nodes>500000||depth>60)throw Error('checkpoint_shape');
    if(v===null||typeof v==='boolean'||typeof v==='string')return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(!Array.isArray(v))throw Error('checkpoint_shape');
    if(v.length===1&&v[0]==='undefined')return undefined;
    if(v.length===1&&v[0]==='negative-zero')return -0;
    if(v.length!==2||!Array.isArray(v[1]))throw Error('checkpoint_shape');
    if(v[0]==='array')return v[1].map(x=>visit(x,depth+1));
    if(v[0]!=='object')throw Error('checkpoint_shape');
    const keys=new Set<string>();
    const entries=v[1].map((entry:unknown)=>{
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||keys.has(entry[0]))throw Error('checkpoint_shape');
      keys.add(entry[0]);return [entry[0],visit(entry[1],depth+1)];
    });
    return Object.fromEntries(entries);
  };
  let encoded:unknown;
  try{encoded=JSON.parse(text);}catch{throw Error('checkpoint_encoding');}
  const result=visit(encoded,0);
  if(canonical(result)!==text)throw Error('checkpoint_encoding');
  return result;
}

function privateDirectory(directory:string):void {
  const info=lstatSync(directory);
  const normalize=(s:string)=>process.platform==='win32'?s.toLowerCase():s;
  if(!info.isDirectory()||info.isSymbolicLink()||normalize(realpathSync(directory))!==normalize(resolve(directory)))throw Error('checkpoint_directory');
  if(process.platform!=='win32'&&((info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()))throw Error('checkpoint_permissions');
}
function regularFile(path:string):void {
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>MAX_BYTES)throw Error('checkpoint_file');
  if(process.platform!=='win32'&&((info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()))throw Error('checkpoint_permissions');
}
function syncDirectory(directory:string):void {
  // Node cannot fsync a directory on Windows. File fsync + same-directory atomic
  // replacement is process-crash protection, not a full power-loss guarantee there.
  if(process.platform==='win32')return;
  const fd=openSync(directory,constants.O_RDONLY);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function validateIntent(v:unknown,person:string,tick:number):asserts v is TickIntent {
  if(!object(v)||!exact(v,['tick','online','actions'])||v.tick!==tick||!Array.isArray(v.online)||v.online.length>1||
     v.online.some(id=>id!==person)||!Array.isArray(v.actions)||v.actions.length>1)throw Error('checkpoint_intent');
  for(const action of v.actions){
    if(!object(action)||!exact(action,['person','epoch','tick','decision'])||action.person!==person||!integer(action.epoch)||action.tick!==tick||!object(action.decision))throw Error('checkpoint_action');
  }
}
function validateRecord(v:unknown,expectedSource:string):asserts v is CheckpointRecord {
  if(!object(v))throw Error('checkpoint_schema');
  const keys=['version','sequence','person','status','reason','tape','pending'];
  if(v.version===2)keys.push('fixtureAttempt');
  if(!exact(v,keys)||(v.version!==1&&v.version!==2)||!integer(v.sequence)||
     !safeText(v.person)||!['running','prepared','closed','halted'].includes(String(v.status))||!object(v.tape))throw Error('checkpoint_schema');
  const tape=v.tape;
  if(!exact(tape,['genesis','genesisHash','ticks'])||!object(tape.genesis)||!Array.isArray(tape.ticks)||tape.ticks.length>MAX_TICKS)throw Error('checkpoint_schema');
  const g=tape.genesis;
  if(!exact(g,['seed','namespace','observerSecret','config','sourceRevision'])||!Number.isSafeInteger(g.seed)||!safeText(g.namespace,256)||
     !safeText(g.observerSecret,256)||String(g.observerSecret).length<16||g.sourceRevision!==expectedSource||!object(g.config)||
     !safeText(tape.genesisHash,64)||!/^[a-f0-9]{64}$/.test(String(tape.genesisHash)))throw Error('checkpoint_genesis');
  for(const name of ['targetPopulation','rMiller','rBaker','rCourier','rInvestigator','rImportExport']){
    if(!integer(g.config[name])||Number(g.config[name])>10000)throw Error('checkpoint_config');
  }
  for(const [index,record]of tape.ticks.entries()){
    if(!object(record)||!exact(record,['tick','online','actions','stateHash','effectsHash']))throw Error('checkpoint_tick');
    validateIntent({tick:record.tick,online:record.online,actions:record.actions},v.person,index);
    if(!/^[a-f0-9]{64}$/.test(String(record.stateHash))||!/^[a-f0-9]{64}$/.test(String(record.effectsHash)))throw Error('checkpoint_hash');
  }
  if(v.version===2&&v.fixtureAttempt!==null){
    const attempt=v.fixtureAttempt;
    if(!object(attempt)||!exact(attempt,['id','tick','epoch','contextHash','status'])||
       typeof attempt.id!=='string'||!/^[a-f0-9]{32}$/.test(attempt.id)||!integer(attempt.tick)||attempt.tick>tape.ticks.length||
       !integer(attempt.epoch)||typeof attempt.contextHash!=='string'||!/^[a-f0-9]{64}$/.test(attempt.contextHash)||
       !['pending','consumed','halted'].includes(String(attempt.status)))throw Error('checkpoint_fixture');
  }
  if(v.status==='prepared'){
    validateIntent(v.pending,v.person,tape.ticks.length);
    if(v.reason!==null)throw Error('checkpoint_status');
  }else if(v.status==='halted'){
    if(v.reason!=='kernel_execution_failed')throw Error('checkpoint_status');
    if(v.pending!==null)validateIntent(v.pending,v.person,tape.ticks.length);
  }else{
    if(v.pending!==null)throw Error('checkpoint_status');
    if(v.status==='running'&&v.reason!==null)throw Error('checkpoint_status');
    if(v.status==='closed'&&!['clean_shutdown','departed'].includes(String(v.reason)))throw Error('checkpoint_status');
  }
}

function readRecord(directory:string,source:string):{record:CheckpointRecord;bytes:string} {
  privateDirectory(directory);const file=join(directory,FILE);regularFile(file);
  const bytes=readFileSync(file,'utf8');let envelope:unknown;
  try{envelope=JSON.parse(bytes);}catch{throw Error('checkpoint_encoding');}
  if(!object(envelope)||!exact(envelope,['format','checksum','payload'])||!['node-participant-checkpoint-v1','node-participant-checkpoint-v2'].includes(String(envelope.format))||
     typeof envelope.payload!=='string'||typeof envelope.checksum!=='string'||hash(envelope.payload)!==envelope.checksum)throw Error('checkpoint_checksum');
  const record=decode(envelope.payload);validateRecord(record,source);
  if(envelope.format!==`node-participant-checkpoint-v${record.version}`)throw Error('checkpoint_version');
  const state=replay(record.tape,source);
  const person=state.registry.people.get(record.person);
  if(!person||(record.status==='running'||record.status==='prepared')&&person.location===null||
     record.reason==='departed'&&person.location!==null)throw Error('checkpoint_person');
  return {record,bytes};
}

/** Read-only operator/evaluator inspection. Never available through game transport. */
export function inspectParticipantCheckpoint(directory:string,expectedSource:string):CheckpointRecord {
  return structuredClone(readRecord(directory,expectedSource).record);
}

/** Private operator-only persistence. Contains no budget/accounting interface. */
export class CheckpointStore {
  #directory:string;
  #record:CheckpointRecord;
  #bytes:string|null;
  #lock:string;
  #released=false;
  #fault?:CheckpointOpenOptions['fault'];
  private constructor(directory:string,record:CheckpointRecord,bytes:string|null,lock:string,options:CheckpointOpenOptions){
    this.#directory=directory;this.#record=record;this.#bytes=bytes;this.#lock=lock;this.#fault=options.fault;
  }
  static #acquireLock(directory:string,recover:boolean):string {
    const path=join(directory,LOCK);
    if(existsSync(path)&&recover){
      regularFile(path);const bytes=readFileSync(path,'utf8');const old:unknown=JSON.parse(bytes);
      if(!object(old)||!exact(old,['pid','nonce'])||!integer(old.pid)||old.pid===0||!safeText(old.nonce,64))throw Error('checkpoint_lock');
      let dead=false;
      try{process.kill(old.pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
      if(!dead||readFileSync(path,'utf8')!==bytes)throw Error('checkpoint_locked');
      unlinkSync(path);
    }
    const identity=JSON.stringify({pid:process.pid,nonce:randomBytes(16).toString('hex')});
    const fd=openSync(path,'wx',0o600);
    try{writeFileSync(fd,identity);fsyncSync(fd);}finally{closeSync(fd);}
    return identity;
  }
  static create(directory:string,genesis:Genesis,person:string,options:CheckpointOpenOptions={}):CheckpointStore {
    const initial=createParticipantState(genesis);
    if(initial.registry.people.get(person)?.location==null)throw Error('checkpoint_person');
    const record:CheckpointRecord={version:2,sequence:0,person,status:'running',reason:null,tape:newTape(initial),pending:null,fixtureAttempt:null};
    validateRecord(record,genesis.sourceRevision);
    mkdirSync(directory,{mode:0o700});privateDirectory(directory);
    const identity=this.#acquireLock(directory,false);
    const store=new CheckpointStore(resolve(directory),record,null,identity,options);
    try{store.#publish(record);return store;}catch{store.release();throw Error('checkpoint_create_failed');}
  }
  static open(directory:string,expectedSource:string,options:CheckpointOpenOptions={}):CheckpointStore {
    privateDirectory(directory);
    const identity=this.#acquireLock(directory,options.recoverStaleLock===true);
    let store:CheckpointStore|undefined;
    try{
      const loaded=readRecord(directory,expectedSource);
      store=new CheckpointStore(resolve(directory),loaded.record,loaded.bytes,identity,options);
      if(loaded.record.status==='halted')throw Error('checkpoint_halted');
      if(loaded.record.status==='closed'&&(loaded.record.reason!=='clean_shutdown'||options.resumeCleanShutdown!==true))throw Error('checkpoint_closed');
      const orphan=join(directory,NEXT);
      if(existsSync(orphan)){regularFile(orphan);renameSync(orphan,join(directory,`.participant.orphan-${randomBytes(12).toString('hex')}`));syncDirectory(directory);}
      if(loaded.record.status==='prepared')store.#recoverIntent();
      else if(loaded.record.status==='closed')store.#publish({...loaded.record,sequence:loaded.record.sequence+1,status:'running',reason:null});
      return store;
    }catch(error){
      if(store)store.release();else{
        const path=join(directory,LOCK);
        if(readFileSync(path,'utf8')===identity)unlinkSync(path);
      }
      throw error;
    }
  }
  current():CheckpointRecord {return structuredClone(this.#record);}
  #publish(record:CheckpointRecord):void {
    if(this.#released)throw Error('checkpoint_released');
    validateRecord(record,record.tape.genesis.sourceRevision);
    privateDirectory(this.#directory);
    if(readFileSync(join(this.#directory,LOCK),'utf8')!==this.#lock)throw Error('checkpoint_lock_changed');
    const file=join(this.#directory,FILE);
    if(this.#bytes===null){if(existsSync(file))throw Error('checkpoint_already_exists');}
    else{regularFile(file);if(readFileSync(file,'utf8')!==this.#bytes)throw Error('checkpoint_changed');}
    const payload=canonical(record);
    const bytes=JSON.stringify({format:`node-participant-checkpoint-v${record.version}`,checksum:hash(payload),payload});
    if(Buffer.byteLength(bytes)>MAX_BYTES)throw Error('checkpoint_full');
    this.#fault?.('before_write');
    const next=join(this.#directory,NEXT);
    const fd=openSync(next,'wx',0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    this.#fault?.('after_file_sync');renameSync(next,file);this.#fault?.('after_rename');syncDirectory(this.#directory);
    this.#record=structuredClone(record);this.#bytes=bytes;
  }
  /** Durable offline execution fence, not a request counter, budget or billing record. */
  beginFixtureAttempt(tick:number,epoch:number,contextHash:string):string {
    const current=this.#record;
    const prior=current.fixtureAttempt;
    if(current.version!==2||current.status!=='running'||tick!==current.tape.ticks.length||!integer(epoch)||
       !/^[a-f0-9]{64}$/.test(contextHash)||prior&&prior.status!=='consumed'||prior&&prior.tick>=tick)throw Error('checkpoint_fixture_blocked');
    const attempt:FixtureAttempt={id:randomBytes(16).toString('hex'),tick,epoch,contextHash,status:'pending'};
    this.#publish({...current,sequence:current.sequence+1,fixtureAttempt:attempt});
    return attempt.id;
  }
  finishFixtureAttempt(id:string,status:'consumed'|'halted'):void {
    const current=this.#record;
    const attempt=current.fixtureAttempt;
    if(current.version!==2||current.status!=='running'||!attempt||attempt.id!==id||attempt.status!=='pending')throw Error('checkpoint_fixture_changed');
    this.#publish({...current,sequence:current.sequence+1,fixtureAttempt:{...attempt,status}});
  }
  prepare(tape:ReplayTape,intent:TickIntent):void {
    if(this.#record.status!=='running'||digest(tape)!==digest(this.#record.tape))throw Error('checkpoint_state_changed');
    validateIntent(intent,this.#record.person,tape.ticks.length);
    if(tape.ticks.length>=MAX_TICKS)throw Error('checkpoint_full');
    this.#publish({...this.#record,sequence:this.#record.sequence+1,status:'prepared',pending:structuredClone(intent)});
  }
  complete(tape:ReplayTape,departed:boolean):void {
    const current=this.#record;
    if(current.status!=='prepared'||tape.ticks.length!==current.tape.ticks.length+1||digest(tape.genesis)!==digest(current.tape.genesis)||
       tape.genesisHash!==current.tape.genesisHash||digest(tape.ticks.slice(0,-1))!==digest(current.tape.ticks))throw Error('checkpoint_state_changed');
    const last=tape.ticks.at(-1)!;
    if(digest({tick:last.tick,online:last.online,actions:last.actions})!==digest(current.pending))throw Error('checkpoint_intent_changed');
    this.#publish({...current,sequence:current.sequence+1,tape:structuredClone(tape),pending:null,status:departed?'closed':'running',reason:departed?'departed':null});
  }
  #recoverIntent():void {
    const record=this.#record;
    const state=replay(record.tape,record.tape.genesis.sourceRevision);
    const intent=record.pending!;
    let result:ReturnType<typeof stepParticipantState>;
    try{result=stepParticipantState(state,intent.actions,intent.online);}
    catch{this.halt();throw Error('checkpoint_kernel_failed');}
    const tape=structuredClone(record.tape);
    tape.ticks.push({...intent,stateHash:evidenceHash(result.state),effectsHash:digest(result.effects)});
    this.complete(tape,result.state.registry.people.get(record.person)?.location==null);
  }
  halt():void {
    this.#publish({...this.#record,sequence:this.#record.sequence+1,status:'halted',reason:'kernel_execution_failed'});
  }
  cleanShutdown():void {
    if(this.#record.status==='closed')return;
    if(this.#record.status!=='running')throw Error('checkpoint_unfinished');
    this.#publish({...this.#record,sequence:this.#record.sequence+1,status:'closed',reason:'clean_shutdown'});
  }
  release():void {
    if(this.#released)return;
    this.#released=true;
    const path=join(this.#directory,LOCK);
    if(existsSync(path)){regularFile(path);if(readFileSync(path,'utf8')!==this.#lock)throw Error('checkpoint_lock_changed');unlinkSync(path);syncDirectory(this.#directory);}
  }
}
