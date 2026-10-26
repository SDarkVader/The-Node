/** Versioned postcard snapshots and deterministic event replay. This layer has no clock,
 * filesystem, policy, RNG, provider or world-tick dependency: all time is recorded data. */
import { createHash } from 'node:crypto';
import { assertPostcardState, createPostcardState, applyPostcardEvent, type PostcardState } from './postcards.js';

export type PostcardReplayEvent = Parameters<typeof applyPostcardEvent>[1];
export type PostcardReplayRate = Parameters<typeof createPostcardState>[1];
export type PostcardReplayEffect = ReturnType<typeof applyPostcardEvent>['effect'];
export interface PostcardTapeRecord {
  index:number; event:PostcardReplayEvent; beforeHash:string; afterHash:string; effect:PostcardReplayEffect;
}
export interface PostcardTape {
  format:'node-postcard-tape-v1';
  genesis:{personId:string;rate:PostcardReplayRate;createdAtMs:number};
  genesisHash:string; records:PostcardTapeRecord[]; finalHash:string;
}
/** Artifact parsing capacities, not game rates, inventory caps or transaction limits. */
export const POSTCARD_EVIDENCE_MAX_DEPTH=32;
export const POSTCARD_EVIDENCE_MAX_NODES=1_000_000;
export const POSTCARD_TAPE_MAX_RECORDS=100_000;
const fail=(code:string):never=>{throw Error(code);};
const hash=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** JSON data only, with lexicographically ordered object keys. Refuse properties that JSON
 * would silently drop or invoke, so equal checksums cannot conceal extra runtime values. */
function canonical(value:unknown):string {
  const active=new Set<object>();let nodes=0;
  const encode=(item:unknown,depth:number):string=>{
    if(++nodes>POSTCARD_EVIDENCE_MAX_NODES||depth>POSTCARD_EVIDENCE_MAX_DEPTH)return fail('postcard_evidence_bounds');
    if(item===null||typeof item==='string'||typeof item==='boolean')return JSON.stringify(item);
    if(typeof item==='number'){
      if(!Number.isFinite(item))return fail('postcard_evidence_number');
      return JSON.stringify(item);
    }
    if(typeof item!=='object'||active.has(item))return fail('postcard_evidence_value');
    active.add(item);let result:string;
    if(Array.isArray(item)){
      if(Object.getPrototypeOf(item)!==Array.prototype)return fail('postcard_evidence_array');
      if(item.length>POSTCARD_EVIDENCE_MAX_NODES)return fail('postcard_evidence_bounds');
      const keys=Reflect.ownKeys(item);
      if(keys.length!==item.length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!/^\d+$/.test(key))))return fail('postcard_evidence_array');
      result='['+Array.from({length:item.length},(_,index)=>{
        const descriptor=Object.getOwnPropertyDescriptor(item,String(index));
        if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_evidence_array');
        return encode(descriptor.value,depth+1);
      }).join(',')+']';
    }else{
      const proto=Object.getPrototypeOf(item);
      if(proto!==Object.prototype&&proto!==null)return fail('postcard_evidence_object');
      const keys=Reflect.ownKeys(item);
      if(keys.some(key=>typeof key!=='string'))return fail('postcard_evidence_object');
      result='{'+(keys as string[]).sort().map(key=>{
        const descriptor=Object.getOwnPropertyDescriptor(item,key)!;
        if(!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_evidence_object');
        return JSON.stringify(key)+':'+encode(descriptor.value,depth+1);
      }).join(',')+'}';
    }
    active.delete(item);return result;
  };
  return encode(value,0);
}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('postcard_evidence_shape');
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))return fail('postcard_evidence_shape');
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_evidence_shape');
  }
}
export function postcardStateHash(state:PostcardState):string {
  assertPostcardState(state);return hash(state);
}
/** Snapshot integers and rational credit remain ordinary JSON numbers/decimal strings. */
export function serializePostcardState(state:PostcardState):string {
  assertPostcardState(state);
  return canonical({format:'node-postcard-snapshot-v1',sha256:postcardStateHash(state),state})+'\n';
}
export function parsePostcardState(text:string):PostcardState {
  if(typeof text!=='string'||Buffer.byteLength(text)>65_536)return fail('postcard_snapshot_bounds');
  let snapshot:unknown;try{snapshot=JSON.parse(text);}catch{return fail('postcard_snapshot_json');}
  exact(snapshot,['format','sha256','state']);
  if(snapshot.format!=='node-postcard-snapshot-v1'||!isHash(snapshot.sha256))return fail('postcard_snapshot_format');
  assertPostcardState(snapshot.state);
  const state=snapshot.state as PostcardState;
  if(postcardStateHash(state)!==snapshot.sha256)return fail('postcard_snapshot_checksum');
  return Object.freeze({...state,rate:Object.freeze({...state.rate}),held:Object.freeze({...state.held})});
}

/** Build evidence from actual reducer results, never from claimed or expected transitions. */
export function createPostcardTape(personId:string,rate:PostcardReplayRate,atMs:number,
  events:readonly PostcardReplayEvent[]):PostcardTape {
  if(!Array.isArray(events)||events.length>POSTCARD_TAPE_MAX_RECORDS)return fail('postcard_tape_bounds');
  canonical(events);
  let state=createPostcardState(personId,rate,atMs);
  const genesis={personId:state.personId,rate:structuredClone(state.rate),createdAtMs:state.createdAtMs};
  const genesisHash=postcardStateHash(state),records:PostcardTapeRecord[]=[];
  for(const event of events){
    const beforeHash=postcardStateHash(state),result=applyPostcardEvent(state,event);
    // Canonicalization checks that evidence loses no runtime values before detaching it.
    canonical(event);canonical(result.effect);
    records.push({index:records.length,event:structuredClone(event),beforeHash,
      afterHash:postcardStateHash(result.state),effect:structuredClone(result.effect)});
    state=result.state;
  }
  return {format:'node-postcard-tape-v1',genesis,genesisHash,records,finalHash:postcardStateHash(state)};
}
/** Reconstruct every receipt from the recorded events; exact effect and state hashes must
 * match. Saved JSON can be reopened in a different process without a wall clock or RNG. */
export function verifyPostcardTape(value:unknown):{verified:true;events:number;finalHash:string;state:PostcardState} {
  exact(value,['format','genesis','genesisHash','records','finalHash']);
  if(value.format!=='node-postcard-tape-v1'||!isHash(value.genesisHash)||!isHash(value.finalHash)||!Array.isArray(value.records))return fail('postcard_tape_format');
  if(value.records.length>POSTCARD_TAPE_MAX_RECORDS)return fail('postcard_tape_bounds');
  canonical(value);
  exact(value.genesis,['personId','rate','createdAtMs']);
  const genesis=value.genesis;
  let state=createPostcardState(genesis.personId as string,genesis.rate as PostcardReplayRate,genesis.createdAtMs as number);
  if(canonical({personId:state.personId,rate:state.rate,createdAtMs:state.createdAtMs})!==canonical(genesis)||
    postcardStateHash(state)!==value.genesisHash)return fail('postcard_tape_genesis');
  for(const [index,raw]of value.records.entries()){
    exact(raw,['index','event','beforeHash','afterHash','effect']);
    if(raw.index!==index||!isHash(raw.beforeHash)||!isHash(raw.afterHash)||raw.beforeHash!==postcardStateHash(state))return fail('postcard_tape_order');
    const result=applyPostcardEvent(state,raw.event as PostcardReplayEvent);
    if(raw.afterHash!==postcardStateHash(result.state)||canonical(raw.effect)!==canonical(result.effect))return fail('postcard_tape_transition');
    state=result.state;
  }
  const finalHash=postcardStateHash(state);
  if(finalHash!==value.finalHash)return fail('postcard_tape_final');
  return {verified:true,events:value.records.length,finalHash,state};
}
