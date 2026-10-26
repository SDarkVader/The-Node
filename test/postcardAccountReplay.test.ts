import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as random from '../src/sim/rng.js';
import { createPostcardState, applyPostcardEvent, type PostcardState } from '../src/engine/postcards.js';
import { serializePostcardState, parsePostcardState, createPostcardTape, verifyPostcardTape } from '../src/engine/postcardReplay.js';
import { applyPostcardTransaction, upgradePostcardState, type PostcardTransaction } from '../src/engine/postcardAccount.js';
import { postcardAccountHash, serializePostcardAccount, parsePostcardAccount, createPostcardAccountTape,
  verifyPostcardAccountTape, POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES, POSTCARD_ACCOUNT_TAPE_MAX_RECORDS } from '../src/engine/postcardAccountReplay.js';

const HOUR=3_600_000,personId='TEST-ONLY-postcard-replay-v2';
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const claim=(id:string,atMs:number):PostcardTransaction=>({kind:'claim',id,personId,atMs});
const clock=(id:string,atMs:number):PostcardTransaction=>({kind:'clock',id,personId,atMs});
/** Real v1 hourly collection and safe recipes produce five each of the four source
 * tiers. The v2 replay anchor does not fabricate inventory or backdate a new account. */
function fundedOrigin():PostcardState {
  let state=createPostcardState(personId,{numerator:780,denominator:1},0);
  state=applyPostcardEvent(state,{kind:'claim',personId,atMs:HOUR}).state;
  for(const [tier,count]of [['white',155],['green',30],['blue',5]] as const)
    for(let index=0;index<count;index++)state=applyPostcardEvent(state,{kind:'safeFusion',personId,atMs:HOUR,tier}).state;
  return state;
}
const origin=fundedOrigin();
afterEach(()=>vi.restoreAllMocks());
function events():PostcardTransaction[] {
  return [
    {kind:'shortcutFusion',id:'green-shortcut',personId,atMs:HOUR,tier:'green',stake:1},
    {kind:'shortcutFusion',id:'blue-shortcut',personId,atMs:HOUR,tier:'blue',stake:2},
    clock('later-clock',HOUR+1),
    {kind:'shortcutFusion',id:'green-shortcut',personId,atMs:HOUR,tier:'green',stake:1},
    {kind:'shortcutFusion',id:'purple-shortcut',personId,atMs:HOUR+1,tier:'purple',stake:3},
    claim('later-claim',HOUR+2),
  ];
}
function rehashSnapshot(snapshot:any):string {
  const canonical=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):
    Array.isArray(value)?'['+value.map(canonical).join(',')+']':
      '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  snapshot.sha256=createHash('sha256').update(canonical(snapshot.state)).digest('hex');
  return JSON.stringify(snapshot);
}

describe('version-two postcard account snapshots and transaction tapes',()=>{
  it('anchors an explicit unchanged v1 wallet and detaches mutable genesis, events and receipts',()=>{
    const mutableOrigin:any=clone(origin),input=events(),tape=createPostcardAccountTape(mutableOrigin,1,input);
    const bytes=JSON.stringify(tape);
    mutableOrigin.held.green=0;(input[0] as any).stake=4;input.length=0;
    expect(JSON.stringify(tape)).toBe(bytes);
    expect(tape.genesis.origin).toEqual(origin);expect(tape.genesis.seed).toBe(1);
    expect(verifyPostcardAccountTape(clone(tape)).state.origin).toEqual(origin);
  });

  it('replays duplicate IDs as no-op state transitions after the recorded clock advances',()=>{
    const tape=createPostcardAccountTape(origin,1,events()),result=verifyPostcardAccountTape(clone(tape));
    expect(result).toMatchObject({verified:true,events:6,finalHash:tape.finalHash});
    expect(tape.records.map(record=>record.duplicate)).toEqual([false,false,false,true,false,false]);
    const first=tape.records[0]!,duplicate=tape.records[3]!;
    expect(duplicate.effect).toEqual(first.effect);
    expect(duplicate.beforeHash).toBe(duplicate.afterHash);
    expect(duplicate.beforeHash).toBe(tape.records[2]!.afterHash);
    expect(result.state.transactions).toHaveLength(5);
    expect(result.state.drawCount).toBe(3);
  });

  it('reopens an exact prefix snapshot, preserves fractions and resumes the same seeded stream',()=>{
    const input=events(),prefix=createPostcardAccountTape(origin,1,input.slice(0,3));
    const saved=verifyPostcardAccountTape(prefix).state,snapshot=serializePostcardAccount(saved);
    let resumed=parsePostcardAccount(snapshot);
    expect(resumed.unclaimedUnits).toBe('780');
    for(const event of input.slice(3))resumed=applyPostcardTransaction(resumed,event).state;
    const uninterrupted=verifyPostcardAccountTape(createPostcardAccountTape(origin,1,input)).state;
    expect(resumed).toEqual(uninterrupted);
    expect(postcardAccountHash(resumed)).toBe(postcardAccountHash(uninterrupted));
    expect(serializePostcardAccount(parsePostcardAccount(snapshot))).toBe(snapshot);
    const parsed=parsePostcardAccount(snapshot);
    expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.origin)).toBe(true);
    expect(Object.isFrozen(parsed.transactions)).toBe(true);
    expect(Object.isFrozen(parsed.transactions[0]!.event)).toBe(true);
    expect(Object.isFrozen(parsed.transactions[0]!.effect.fusion!.draw)).toBe(true);
  });

  it('seals a parsed journal so rejecting a new action or retrying a receipt draws no historical randomness',()=>{
    const input=events(),state=verifyPostcardAccountTape(createPostcardAccountTape(origin,1,input)).state;
    const parsed=parsePostcardAccount(serializePostcardAccount(state)),before=serializePostcardAccount(parsed);
    const draw=vi.spyOn(random,'mulberry32').mockImplementation(()=>{throw Error('No new draw is authorized');});
    expect(()=>applyPostcardTransaction(parsed,{kind:'shortcutFusion',id:'new-invalid',personId,
      atMs:parsed.clockMs,tier:'orange',stake:1})).toThrow();
    const duplicate=applyPostcardTransaction(parsed,input[0]!);
    expect(duplicate.state).toBe(parsed);expect(duplicate.duplicate).toBe(true);
    expect(serializePostcardAccount(parsed)).toBe(before);expect(draw).not.toHaveBeenCalled();
  });

  it('reopens saved state and replays the tape in an independent Node process',()=>{
    const input=events(),prefix=createPostcardAccountTape(origin,1,input.slice(0,3));
    const snapshot=serializePostcardAccount(verifyPostcardAccountTape(prefix).state);
    const tape=createPostcardAccountTape(origin,1,input);
    const script=[
      "import {readFileSync} from 'node:fs';",
      "import {parsePostcardAccount,postcardAccountHash,verifyPostcardAccountTape} from './src/engine/postcardAccountReplay.ts';",
      "import {applyPostcardTransaction} from './src/engine/postcardAccount.ts';",
      "const {snapshot,events,tape}=JSON.parse(readFileSync(0,'utf8'));",
      'let state=parsePostcardAccount(snapshot);for(const event of events)state=applyPostcardTransaction(state,event).state;',
      'const checked=verifyPostcardAccountTape(tape);process.stdout.write(JSON.stringify({hash:postcardAccountHash(state),checked:checked.finalHash,drawCount:state.drawCount}));',
    ].join('\n');
    const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type','module','--eval',script],
      {cwd:resolve('.'),input:JSON.stringify({snapshot,events:input.slice(3),tape}),encoding:'utf8',windowsHide:true}));
    expect(result).toEqual({hash:tape.finalHash,checked:tape.finalHash,drawCount:3});
  });

  it('preserves the raw cursor across rejection, snapshot reopening and a subsequent transaction',()=>{
    // Synthetic raw-word boundary coverage through the existing PRNG import only.
    // The production transaction schema has no supplied roll or RNG callback.
    const seed=17,step=0x6d2b79f5;
    const words=new Map([[seed,0xffffffff],[(seed+step)>>>0,0],[(seed+Math.imul(2,step))>>>0,1]]);
    vi.spyOn(random,'mulberry32').mockImplementation(offset=>()=>{
      const word=words.get(offset);
      if(word===undefined)throw Error('Unexpected synthetic RNG index');
      return word/0x1_0000_0000;
    });
    const first:PostcardTransaction={kind:'shortcutFusion',id:'reject-then-zero',personId,atMs:HOUR,tier:'green',stake:1};
    const second:PostcardTransaction={kind:'shortcutFusion',id:'resume-at-two',personId,atMs:HOUR,tier:'green',stake:2};
    const prefix=verifyPostcardAccountTape(createPostcardAccountTape(origin,seed,[first])).state;
    expect(prefix.drawCount).toBe(2);
    expect(prefix.transactions[0]!.effect.fusion!.draw).toEqual({index:0,count:2,bucket:0});
    const saved=parsePostcardAccount(serializePostcardAccount(prefix));
    const resumed=applyPostcardTransaction(saved,second).state;
    const full=verifyPostcardAccountTape(createPostcardAccountTape(origin,seed,[first,second]));
    expect(resumed.drawCount).toBe(3);
    expect(resumed.transactions[1]!.effect.fusion!.draw).toEqual({index:2,count:1,bucket:1});
    expect(resumed).toEqual(full.state);
  });

  it('keeps zero-event upgrades and the independent v1 formats usable',()=>{
    const v1Snapshot=serializePostcardState(origin),upgraded=upgradePostcardState(parsePostcardState(v1Snapshot),0xffffffff);
    const tape=createPostcardAccountTape(origin,0xffffffff,[]),checked=verifyPostcardAccountTape(clone(tape));
    expect(checked).toEqual({verified:true,events:0,finalHash:tape.genesisHash,state:upgraded});
    expect(checked.state.clockMs).toBe(HOUR);expect(checked.state.drawCount).toBe(0);
    expect(serializePostcardState(parsePostcardState(v1Snapshot))).toBe(v1Snapshot);
    const v1Tape=createPostcardTape(personId,{numerator:2,denominator:1},0,[{kind:'claim',personId,atMs:HOUR}]);
    expect(verifyPostcardTape(clone(v1Tape)).state.held.white).toBe(2);
    expect(()=>parsePostcardAccount(v1Snapshot)).toThrow();
    expect(()=>parsePostcardState(serializePostcardAccount(upgraded))).toThrow();
  });

  it('uses canonical key order for equal data and refuses silent JSON normalization',()=>{
    const tape=createPostcardAccountTape(origin,1,events()),state=verifyPostcardAccountTape(tape).state;
    const reverse=(value:any):any=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(reverse):
      Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])]));
    expect(postcardAccountHash(reverse(state))).toBe(postcardAccountHash(state));
    const negative:any=clone(tape);negative.records[0].index=-0;
    expect(()=>verifyPostcardAccountTape(negative)).toThrow('postcard_account_evidence_number');
    const unknown:any=clone(tape);unknown.records[0].effect.extra=undefined;
    expect(()=>verifyPostcardAccountTape(unknown)).toThrow('postcard_account_evidence_value');
    const extraSymbol:any=clone(tape);extraSymbol.records[0].effect[Symbol('hidden')]='secret';
    expect(()=>verifyPostcardAccountTape(extraSymbol)).toThrow('postcard_account_evidence_object');
    const nonEnumerable:any=clone(tape);Object.defineProperty(nonEnumerable.records[0].effect,'hidden',{value:'secret'});
    expect(()=>verifyPostcardAccountTape(nonEnumerable)).toThrow('postcard_account_evidence_object');
  });

  it('checks snapshot shape, checksum and journal consistency even when an attacker recomputes the unkeyed hash',()=>{
    const state=verifyPostcardAccountTape(createPostcardAccountTape(origin,1,events())).state;
    const snapshot=JSON.parse(serializePostcardAccount(state));
    for(const change of [
      (s:any)=>{s.sha256='0'.repeat(64);},(s:any)=>{s.format='node-postcard-snapshot-v1';},
      (s:any)=>{s.extra='hidden';},(s:any)=>{s.state.held.orange++;},
    ]){const changed=clone(snapshot);change(changed);expect(()=>parsePostcardAccount(JSON.stringify(changed))).toThrow();}
    for(const change of [
      (s:any)=>{s.state.drawCount++;},(s:any)=>{s.state.issuedWhite=String(BigInt(s.state.issuedWhite)+1n);},
      (s:any)=>{s.state.burnedWhite=String(BigInt(s.state.burnedWhite)+1n);},
      (s:any)=>{s.state.transactions[0].effect.fusion.draw.bucket=(s.state.transactions[0].effect.fusion.draw.bucket+1)%5;},
      (s:any)=>{s.state.transactions[0].effect.claimedWhite=123;},
      (s:any)=>{s.state.transactions[0].event.stake=4;},
      (s:any)=>{s.state.transactions[1].event.id=s.state.transactions[0].event.id;},
      (s:any)=>{s.state.transactions.reverse();},
    ]){const changed=clone(snapshot);change(changed);expect(()=>parsePostcardAccount(rehashSnapshot(changed))).toThrow();}
    expect(()=>parsePostcardAccount('{')).toThrow('postcard_account_snapshot_json');
    expect(()=>parsePostcardAccount('x'.repeat(POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES+1))).toThrow('postcard_account_snapshot_bounds');
    expect(serializePostcardAccount(state)).toBe(serializePostcardAccount(parsePostcardAccount(serializePostcardAccount(state))));
  });

  it('binds seed-dependent receipts while keeping the unkeyed hash authentication boundary explicit',()=>{
    const first=events()[0]!,recorded=applyPostcardTransaction(upgradePostcardState(origin,1),first).state;
    const bucket=recorded.transactions[0]!.effect.fusion!.draw!.bucket;
    const differentSeed=Array.from({length:100},(_,index)=>index).find(seed=>
      applyPostcardTransaction(upgradePostcardState(origin,seed),first).effect.fusion!.draw!.bucket!==bucket);
    expect(differentSeed).toBeDefined();
    const changed=JSON.parse(serializePostcardAccount(recorded));changed.state.seed=differentSeed;
    expect(()=>parsePostcardAccount(rehashSnapshot(changed))).toThrow();
    // A self-consistent empty-history genesis with a different seed is a different
    // valid account. Authentic ownership and the approved seed need an outer authority.
    const empty=JSON.parse(serializePostcardAccount(upgradePostcardState(origin,1)));
    const originalHash=empty.sha256;empty.state.seed=differentSeed;
    const alternative=parsePostcardAccount(rehashSnapshot(empty));
    expect(alternative.seed).toBe(differentSeed);
    expect(postcardAccountHash(alternative)).not.toBe(originalHash);
  });

  it.each(['genesis','seed','before','after','effect','order','final','action','time','owner','extra','duplicate','id','drop'] as const)
    ('rejects tape tampering at %s without changing the original',part=>{
      const tape=createPostcardAccountTape(origin,1,events()),before=JSON.stringify(tape),changed:any=clone(tape);
      if(part==='genesis')changed.genesis.origin.rate.numerator++;
      if(part==='seed')changed.genesis.seed++;
      if(part==='before')changed.records[0].beforeHash='0'.repeat(64);
      if(part==='after')changed.records[0].afterHash='0'.repeat(64);
      if(part==='effect')changed.records[0].effect.issuedWhite='999';
      if(part==='order')changed.records[0].index=1;
      if(part==='final')changed.finalHash='0'.repeat(64);
      if(part==='action')changed.records[0].event.tier='white';
      if(part==='time')changed.records[4].event.atMs=HOUR-1;
      if(part==='owner')changed.records[0].event.personId='TEST-other-person';
      if(part==='extra')changed.records[0].extra='not-in-contract';
      if(part==='duplicate')changed.records[3].duplicate=false;
      if(part==='id')changed.records[3].event.id='same-payload-new-id';
      if(part==='drop')changed.records.splice(1,1);
      expect(()=>verifyPostcardAccountTape(changed)).toThrow();
      expect(JSON.stringify(tape)).toBe(before);
    });

  it('rejects malformed or conflicting transactions instead of publishing an alleged receipt',()=>{
    const input=events();
    expect(()=>createPostcardAccountTape(origin,1,[input[0]!,{...input[0]!,atMs:HOUR+1}])).toThrow();
    expect(()=>createPostcardAccountTape(origin,1,[{kind:'shortcutFusion',id:'invalid-white',personId,atMs:HOUR,tier:'white',stake:1}])).toThrow();
    expect(()=>createPostcardAccountTape(origin,-1,[])).toThrow();
    expect(()=>createPostcardAccountTape(origin,1,[{...input[0]!,roll:0} as never])).toThrow();
  });

  it('bounds evidence and rejects holes, inherited arrays and executable properties without invoking getters',()=>{
    const tape=createPostcardAccountTape(origin,1,events());let getterCalled=false;
    const top={...tape};Object.defineProperty(top,'records',{enumerable:true,get:()=>{getterCalled=true;return tape.records;}});
    expect(()=>verifyPostcardAccountTape(top)).toThrow('postcard_account_evidence_shape');
    const nested:any=clone(tape);Object.defineProperty(nested.records[0].effect,'claimedWhite',{enumerable:true,get:()=>{getterCalled=true;return 0;}});
    expect(()=>verifyPostcardAccountTape(nested)).toThrow('postcard_account_evidence_object');
    const inherited=events();Object.setPrototypeOf(inherited,{[Symbol.iterator]:()=>{getterCalled=true;return [][Symbol.iterator]();}});
    expect(()=>createPostcardAccountTape(origin,1,inherited)).toThrow('postcard_account_evidence_array');
    const sparse=new Array(2);sparse[1]=events()[0];
    expect(()=>createPostcardAccountTape(origin,1,sparse)).toThrow('postcard_account_evidence_array');
    const tooMany={...tape,records:new Array(POSTCARD_ACCOUNT_TAPE_MAX_RECORDS+1)};
    expect(()=>verifyPostcardAccountTape(tooMany)).toThrow('postcard_account_tape_bounds');
    expect(()=>createPostcardAccountTape(origin,1,tooMany.records)).toThrow('postcard_account_tape_bounds');
    const deep:any=clone(tape);let value:unknown=0;
    for(let index=0;index<40;index++)value={next:value};
    deep.records[0].effect.extra=value;
    expect(()=>verifyPostcardAccountTape(deep)).toThrow('postcard_account_evidence_bounds');
    const large:any=clone(tape);large.records[0].effect.extra='x'.repeat(POSTCARD_ACCOUNT_EVIDENCE_MAX_BYTES+1);
    expect(()=>verifyPostcardAccountTape(large)).toThrow('postcard_account_evidence_bounds');
    expect(getterCalled).toBe(false);
  });
});
