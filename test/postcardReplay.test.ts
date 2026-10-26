import { describe,expect,it } from 'vitest';
import { createPostcardState,applyPostcardEvent,postcardWhiteEquivalent,type PostcardEvent } from '../src/engine/postcards.js';
import { createPostcardTape,verifyPostcardTape,serializePostcardState,parsePostcardState,postcardStateHash,
  POSTCARD_TAPE_MAX_RECORDS } from '../src/engine/postcardReplay.js';

const HOUR=3_600_000,personId='TEST-ONLY-postcard-person';
const rate={numerator:2,denominator:1};
const claim=(atMs:number):PostcardEvent=>({kind:'claim',personId,atMs});
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

describe('postcard saved state and exact event replay',()=>{
  it('reopens fractional credit and resumes to exactly the uninterrupted state',()=>{
    const fractionalRate={numerator:1,denominator:3},start=12345;
    const prefix=createPostcardTape(personId,fractionalRate,start,[claim(start+HOUR*1.5)]);
    const checkedPrefix=verifyPostcardTape(clone(prefix)),snapshot=serializePostcardState(checkedPrefix.state);
    const saved=parsePostcardState(snapshot);
    expect(saved.held.white).toBe(0);expect(BigInt(saved.unclaimedUnits)).toBe(5_400_000n);
    expect(saved.lastClaimAtMs).toBe(start+HOUR*1.5);
    const resumed=applyPostcardEvent(saved,claim(start+3*HOUR)).state;
    const uninterrupted=verifyPostcardTape(createPostcardTape(personId,fractionalRate,start,[claim(start+HOUR*1.5),claim(start+3*HOUR)])).state;
    expect(resumed).toEqual(uninterrupted);expect(resumed.held.white).toBe(1);
    expect(postcardStateHash(resumed)).toBe(postcardStateHash(uninterrupted));
    expect(serializePostcardState(parsePostcardState(snapshot))).toBe(snapshot);
    expect(Object.isFrozen(saved)).toBe(true);expect(Object.isFrozen(saved.held)).toBe(true);
  });

  it('replays a complete safe ladder to one Orange while conserving all 625 White equivalents',()=>{
    const events:PostcardEvent[]=[];
    for(let hour=12;hour<=312;hour+=12)events.push(claim(hour*HOUR));
    const last=312.5*HOUR;events.push(claim(last));
    for(const [tier,count]of [['white',125],['green',25],['blue',5],['purple',1]] as const)
      for(let n=0;n<count;n++)events.push({kind:'safeFusion',personId,atMs:last,tier});
    const tape=createPostcardTape(personId,rate,0,events),result=verifyPostcardTape(clone(tape));
    expect(result).toMatchObject({verified:true,events:183,finalHash:tape.finalHash});
    expect(result.state.held).toEqual({white:0,green:0,blue:0,purple:0,orange:1});
    expect(result.state.unclaimedUnits).toBe('0');expect(result.state.overflowUnits).toBe('0');
    expect(postcardWhiteEquivalent(result.state)).toBe(625n);
    expect(tape.records.filter(r=>r.event.kind==='safeFusion')).toHaveLength(156);
    expect(tape.records.filter(r=>r.event.kind==='safeFusion').every(r=>r.effect.fusion?.consumed===5&&r.effect.fusion.produced===1)).toBe(true);
  });

  it('distinguishes explicit twelve-hour collection from one daily twenty-four-hour claim',()=>{
    const twiceDaily=verifyPostcardTape(createPostcardTape(personId,rate,0,[claim(12*HOUR),claim(24*HOUR)]));
    const onceDaily=verifyPostcardTape(createPostcardTape(personId,rate,0,[claim(24*HOUR)]));
    expect(twiceDaily.state.held.white).toBe(48);expect(twiceDaily.state.overflowUnits).toBe('0');
    expect(onceDaily.state.held.white).toBe(32);expect(BigInt(onceDaily.state.overflowUnits)).toBe(8n*BigInt(HOUR)*2n);
    expect(twiceDaily.finalHash).not.toBe(onceDaily.finalHash);
    const repeated=applyPostcardEvent(parsePostcardState(serializePostcardState(onceDaily.state)),claim(24*HOUR));
    expect(repeated.effect.claimedWhite).toBe(0);expect(repeated.state.held.white).toBe(32);
  });

  it('binds a detached normalized owner/rate/genesis and detaches every event and effect',()=>{
    const mutableRate={numerator:4,denominator:2},event=claim(3*HOUR),events=[event];
    const tape=createPostcardTape(personId,mutableRate,0,events),before=JSON.stringify(tape);
    mutableRate.numerator=50;(event as {atMs:number}).atMs=4*HOUR;events.length=0;
    expect(JSON.stringify(tape)).toBe(before);expect(tape.genesis.rate).toEqual(rate);
    expect(verifyPostcardTape(tape).state.held.white).toBe(6);
    const first=verifyPostcardTape(tape),second=verifyPostcardTape(tape);
    expect(first.state).not.toBe(second.state);expect(first.state.held).not.toBe(second.state.held);
    expect(postcardStateHash(first.state)).toBe(postcardStateHash(second.state));
  });

  it('accepts a zero-event saved genesis without reading a clock or drawing randomness',()=>{
    const tape=createPostcardTape(personId,{numerator:1,denominator:7},99,[]),result=verifyPostcardTape(clone(tape));
    expect(result).toEqual({verified:true,events:0,finalHash:tape.genesisHash,state:createPostcardState(personId,{numerator:1,denominator:7},99)});
    expect(result.state.clockMs).toBe(99);expect(result.state.lastClaimAtMs).toBeNull();
  });

  it('checks the snapshot format, exact shape, resource invariant and checksum on reopening',()=>{
    const state=verifyPostcardTape(createPostcardTape(personId,rate,0,[claim(HOUR)])).state;
    const snapshot=JSON.parse(serializePostcardState(state));
    for(const mutate of [
      (s:any)=>{s.sha256='0'.repeat(64);},(s:any)=>{s.format='invented';},
      (s:any)=>{s.extra='hidden';},(s:any)=>{s.state.held.white++;},
      (s:any)=>{s.state.unclaimedUnits='-1';},(s:any)=>{s.state.rate.denominator=0;},
    ]){const changed=clone(snapshot);mutate(changed);expect(()=>parsePostcardState(JSON.stringify(changed))).toThrow();}
    expect(()=>parsePostcardState('{')).toThrow('postcard_snapshot_json');
    expect(()=>parsePostcardState('x'.repeat(65_537))).toThrow('postcard_snapshot_bounds');
    expect(parsePostcardState(serializePostcardState(state))).toEqual(state);
  });

  it.each(['genesis','before','after','effect','order','final','action','time','owner','extra'] as const)('rejects tape tampering at %s without modifying the original',part=>{
    const tape=createPostcardTape(personId,rate,0,[claim(3*HOUR),{kind:'safeFusion',personId,atMs:3*HOUR,tier:'white'},claim(4*HOUR)]);
    const before=JSON.stringify(tape),changed:any=clone(tape);
    if(part==='genesis')changed.genesis.rate.numerator=3;
    if(part==='before')changed.records[0].beforeHash='0'.repeat(64);
    if(part==='after')changed.records[0].afterHash='0'.repeat(64);
    if(part==='effect')changed.records[0].effect.claimedWhite=999;
    if(part==='order')changed.records[0].index=1;
    if(part==='final')changed.finalHash='0'.repeat(64);
    if(part==='action')changed.records[1].event.tier='orange';
    if(part==='time')changed.records[2].event.atMs=HOUR;
    if(part==='owner')changed.records[1].event.personId='TEST-ONLY-other-person';
    if(part==='extra')changed.records[0].extra='not-in-the-contract';
    expect(()=>verifyPostcardTape(changed)).toThrow();
    expect(JSON.stringify(tape)).toBe(before);expect(verifyPostcardTape(tape).verified).toBe(true);
  });

  it('rejects unknown runtime values and accessor-shaped evidence without invoking getters',()=>{
    const tape=createPostcardTape(personId,rate,0,[claim(HOUR)]);
    let getterCalled=false;
    const top={...tape};Object.defineProperty(top,'records',{enumerable:true,get:()=>{getterCalled=true;return tape.records;}});
    expect(()=>verifyPostcardTape(top)).toThrow('postcard_evidence_shape');
    const nested:any=clone(tape);Object.defineProperty(nested.records[0].effect,'claimedWhite',{enumerable:true,get:()=>{getterCalled=true;return 2;}});
    expect(()=>verifyPostcardTape(nested)).toThrow('postcard_evidence_object');
    const unknown:any=clone(tape);unknown.records[0].effect.secret=undefined;
    expect(()=>verifyPostcardTape(unknown)).toThrow('postcard_evidence_value');
    const inherited=[claim(HOUR)];Object.setPrototypeOf(inherited,{[Symbol.iterator]:()=>{getterCalled=true;return [claim(HOUR)][Symbol.iterator]();}});
    expect(()=>createPostcardTape(personId,rate,0,inherited)).toThrow('postcard_evidence_array');
    expect(getterCalled).toBe(false);
  });

  it('refuses an invalid transaction while creating a tape instead of emitting a false receipt',()=>{
    const event:PostcardEvent={kind:'safeFusion',personId,atMs:HOUR,tier:'white'};
    expect(()=>createPostcardTape(personId,rate,0,[event])).toThrow('postcard_insufficient_cards');
    expect(event).toEqual({kind:'safeFusion',personId,atMs:HOUR,tier:'white'});
  });

  it('refuses negative-zero snapshot values instead of normalizing them silently',()=>{
    const state=createPostcardState(personId,rate,0),snapshot=serializePostcardState(state);
    expect(()=>parsePostcardState(snapshot.replace('"clockMs":0','"clockMs":-0'))).toThrow('postcard_clock');
    expect(()=>parsePostcardState(snapshot.replace('"createdAtMs":0','"createdAtMs":-0'))).toThrow('postcard_clock');
    expect(()=>serializePostcardState({...state,held:{...state.held,white:-0}})).toThrow('postcard_inventory');
  });

  it('bounds hostile nested and oversized operator evidence before replay or stack exhaustion',()=>{
    const tape=createPostcardTape(personId,rate,0,[claim(HOUR)]);
    const deep:any=clone(tape);let nested:unknown=0;
    for(let level=0;level<40;level++)nested={next:nested};
    deep.records[0].effect.extra=nested;
    expect(()=>verifyPostcardTape(deep)).toThrow('postcard_evidence_bounds');
    const tooMany:any={...tape,records:new Array(POSTCARD_TAPE_MAX_RECORDS+1)};
    expect(()=>verifyPostcardTape(tooMany)).toThrow('postcard_tape_bounds');
    expect(()=>createPostcardTape(personId,rate,0,tooMany.records)).toThrow('postcard_tape_bounds');
    const tooLarge:any=clone(tape);tooLarge.records[0].effect.extra=new Array(1000).fill(new Array(1000).fill(0));
    expect(()=>verifyPostcardTape(tooLarge)).toThrow('postcard_evidence_bounds');
    expect(verifyPostcardTape(tape).state.held.white).toBe(2);
  });
});
