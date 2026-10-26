/** Version-two postcard snapshots and exact seeded transaction replay. These operator
 * artifacts check internal consistency; their unkeyed hashes do not authenticate origin.
 * Version-one formats and their source files remain independent and unchanged. */
import { createHash } from 'node:crypto';
import { type PostcardState } from './postcards.js';
import { assertPostcardAccount, sealPostcardAccount, upgradePostcardState, applyPostcardTransaction,
  type PostcardAccount, type PostcardTransaction, type PostcardAccountEffect } from './postcardAccount.js';

export interface PostcardAccountTapeRecord {
  index:number;
  event:PostcardTransaction;
  beforeHash:string;
  afterHash:string;
  effect:PostcardAccountEffect;
  duplicate:boolean;
}
export interface PostcardAccountTape {
  format:'node-postcard-tape-v2';
  genesis:{origin:PostcardState;seed:number};
  genesisHash:string;
  records:PostcardAccountTapeRecord[];
  finalHash:string;
}
/** Artifact capacities, not account inventory, lifetime or transaction game rules. */
export const POSTCARD_ACCOUNT_EVIDENCE_MAX_DEPTH=32;
export const POSTCARD_ACCOUNT_EVIDENCE_MAX_NODES=1_000_000;
export const POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES=16*1024*1024;
export const POSTCARD_ACCOUNT_TAPE_MAX_RECORDS=100_000;
const fail=(code:string):never=>{throw Error(code);};
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Reject values JSON would invoke, omit or silently normalize. Object key order has
 * no semantic meaning; arrays must be ordinary dense arrays of enumerable data. */
function canonical(value:unknown):string {
  const active=new Set<object>();let nodes=0,bytes=0;
  const charge=(text:string):string=>{
    bytes+=Buffer.byteLength(text);
    if(bytes>POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES)return fail('postcard_account_evidence_bounds');
    return text;
  };
  const string=(item:string):string=>{
    if(Buffer.byteLength(item)>POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES)return fail('postcard_account_evidence_bounds');
    return charge(JSON.stringify(item));
  };
  const encode=(item:unknown,depth:number):string=>{
    if(++nodes>POSTCARD_ACCOUNT_EVIDENCE_MAX_NODES||depth>POSTCARD_ACCOUNT_EVIDENCE_MAX_DEPTH)
      return fail('postcard_account_evidence_bounds');
    if(item===null||typeof item==='boolean')return charge(JSON.stringify(item));
    if(typeof item==='string')return string(item);
    if(typeof item==='number'){
      if(!Number.isFinite(item)||Object.is(item,-0))return fail('postcard_account_evidence_number');
      return charge(JSON.stringify(item));
    }
    if(typeof item!=='object'||active.has(item))return fail('postcard_account_evidence_value');
    active.add(item);let result:string;
    if(Array.isArray(item)){
      if(Object.getPrototypeOf(item)!==Array.prototype)return fail('postcard_account_evidence_array');
      if(item.length>POSTCARD_ACCOUNT_EVIDENCE_MAX_NODES)return fail('postcard_account_evidence_bounds');
      const keys=Reflect.ownKeys(item);
      if(keys.length!==item.length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!/^\d+$/.test(key))))
        return fail('postcard_account_evidence_array');
      charge('[]'+','.repeat(Math.max(0,item.length-1)));
      result='['+Array.from({length:item.length},(_,index)=>{
        const descriptor=Object.getOwnPropertyDescriptor(item,String(index));
        if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_account_evidence_array');
        return encode(descriptor.value,depth+1);
      }).join(',')+']';
    }else{
      const proto=Object.getPrototypeOf(item);
      if(proto!==Object.prototype&&proto!==null)return fail('postcard_account_evidence_object');
      const keys=Reflect.ownKeys(item);
      if(keys.some(key=>typeof key!=='string'))return fail('postcard_account_evidence_object');
      charge('{}'+','.repeat(Math.max(0,keys.length-1))+':'.repeat(keys.length));
      result='{'+(keys as string[]).sort().map(key=>{
        const descriptor=Object.getOwnPropertyDescriptor(item,key)!;
        if(!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_account_evidence_object');
        return string(key)+':'+encode(descriptor.value,depth+1);
      }).join(',')+'}';
    }
    active.delete(item);return result;
  };
  return encode(value,0);
}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('postcard_account_evidence_shape');
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))
    return fail('postcard_account_evidence_shape');
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail('postcard_account_evidence_shape');
  }
}
export function postcardAccountHash(state:PostcardAccount):string {
  const encoded=canonical(state);assertPostcardAccount(state);
  return createHash('sha256').update(encoded).digest('hex');
}
/** All state, including the idempotency journal and raw RNG cursor, survives JSON. */
export function serializePostcardAccount(state:PostcardAccount):string {
  const snapshot=canonical({format:'node-postcard-snapshot-v2',sha256:postcardAccountHash(state),state})+'\n';
  if(Buffer.byteLength(snapshot)>POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES)return fail('postcard_account_snapshot_bounds');
  return snapshot;
}
export function parsePostcardAccount(text:string):PostcardAccount {
  if(typeof text!=='string'||Buffer.byteLength(text)>POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES)
    return fail('postcard_account_snapshot_bounds');
  let snapshot:unknown;
  try{snapshot=JSON.parse(text);}catch{return fail('postcard_account_snapshot_json');}
  exact(snapshot,['format','sha256','state']);
  if(snapshot.format!=='node-postcard-snapshot-v2'||!isHash(snapshot.sha256))return fail('postcard_account_snapshot_format');
  canonical(snapshot);
  const state=sealPostcardAccount(snapshot.state);
  if(postcardAccountHash(state)!==snapshot.sha256)return fail('postcard_account_snapshot_checksum');
  return state;
}
/** Genesis is the explicit v1 upgrade anchor, including already-held cards and clock. */
export function createPostcardAccountTape(origin:PostcardState,seed:number,
  events:readonly PostcardTransaction[]):PostcardAccountTape {
  if(!Array.isArray(events)||events.length>POSTCARD_ACCOUNT_TAPE_MAX_RECORDS)return fail('postcard_account_tape_bounds');
  canonical({origin,seed,events});
  let state=upgradePostcardState(origin,seed);
  const genesis={origin:structuredClone(state.origin),seed:state.seed};
  const genesisHash=postcardAccountHash(state),records:PostcardAccountTapeRecord[]=[];
  let currentHash=genesisHash;
  for(const event of events){
    const beforeHash=currentHash,result=applyPostcardTransaction(state,event);
    canonical(event);canonical(result.effect);
    currentHash=postcardAccountHash(result.state);
    records.push({index:records.length,event:structuredClone(event),beforeHash,
      afterHash:currentHash,effect:structuredClone(result.effect),duplicate:result.duplicate});
    state=result.state;
  }
  const tape:PostcardAccountTape={format:'node-postcard-tape-v2',genesis,genesisHash,records,finalHash:currentHash};
  canonical(tape);return tape;
}
/** Duplicate event records replay as unchanged state with the original effect. Their
 * original time may precede the current cursor; no new receipt, accrual or draw occurs. */
export function verifyPostcardAccountTape(value:unknown):{verified:true;events:number;finalHash:string;state:PostcardAccount} {
  exact(value,['format','genesis','genesisHash','records','finalHash']);
  if(value.format!=='node-postcard-tape-v2'||!isHash(value.genesisHash)||!isHash(value.finalHash)||!Array.isArray(value.records))
    return fail('postcard_account_tape_format');
  if(value.records.length>POSTCARD_ACCOUNT_TAPE_MAX_RECORDS)return fail('postcard_account_tape_bounds');
  canonical(value);exact(value.genesis,['origin','seed']);
  const genesis=value.genesis;
  let state=upgradePostcardState(genesis.origin as PostcardState,genesis.seed as number);
  let currentHash=postcardAccountHash(state);
  if(canonical({origin:state.origin,seed:state.seed})!==canonical(genesis)||currentHash!==value.genesisHash)
    return fail('postcard_account_tape_genesis');
  for(const [index,raw]of value.records.entries()){
    exact(raw,['index','event','beforeHash','afterHash','effect','duplicate']);
    if(raw.index!==index||!isHash(raw.beforeHash)||!isHash(raw.afterHash)||raw.beforeHash!==currentHash)
      return fail('postcard_account_tape_order');
    const result=applyPostcardTransaction(state,raw.event as PostcardTransaction);
    currentHash=postcardAccountHash(result.state);
    if(raw.afterHash!==currentHash||raw.duplicate!==result.duplicate||canonical(raw.effect)!==canonical(result.effect))
      return fail('postcard_account_tape_transition');
    state=result.state;
  }
  const finalHash=currentHash;
  if(finalHash!==value.finalHash)return fail('postcard_account_tape_final');
  return {verified:true,events:value.records.length,finalHash,state};
}
