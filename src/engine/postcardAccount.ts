/** Version 2 of the personal postcard account: Aug7 §4b same-tier shortcuts.
 * Version 1 state/replay remain unchanged. Upgrading is explicit and transfers no assets.
 * Seed and receipt journal are operator state, not an inhabitant observation or action.
 */
import {mulberry32} from '../sim/rng.js';
import {POSTCARD_TIERS,POSTCARD_HOUR_MS,POSTCARD_BUFFER_HOURS,createPostcardState,
  assertPostcardState,postcardAccrualDenominator,PostcardRuleError,
  type PostcardState,type PostcardRate,type PostcardTier} from './postcards.js';

export const POSTCARD_RNG_VERSION='mulberry32-rejection5-v1' as const;
export type PostcardTransaction =
  | {readonly kind:'clock'|'claim';readonly id:string;readonly personId:string;readonly atMs:number}
  | {readonly kind:'safeFusion';readonly id:string;readonly personId:string;readonly atMs:number;readonly tier:PostcardTier}
  | {readonly kind:'shortcutFusion';readonly id:string;readonly personId:string;readonly atMs:number;readonly tier:PostcardTier;readonly stake:number};
export interface PostcardAccountEffect {
  readonly kind:PostcardTransaction['kind'];readonly atMs:number;
  readonly acceptedUnits:string;readonly overflowUnits:string;readonly claimedWhite:number;
  /** Named White-equivalent issuance on a successful underfilled recipe, or burn on loss. */
  readonly issuedWhite:string;readonly burnedWhite:string;
  readonly fusion:null|{readonly from:PostcardTier;readonly to:PostcardTier;readonly consumed:number;
    readonly produced:0|1;readonly success:boolean;readonly probabilityNumerator:number;readonly probabilityDenominator:5;
    readonly draw:null|{readonly index:number;readonly count:number;readonly bucket:number}};
}
export interface PostcardTransactionReceipt {readonly event:PostcardTransaction;readonly effect:PostcardAccountEffect}
export interface PostcardAccount extends Omit<PostcardState,'format'> {
  readonly format:'node-postcard-state-v2';readonly origin:PostcardState;
  readonly rngVersion:typeof POSTCARD_RNG_VERSION;readonly seed:number;readonly drawCount:number;
  readonly issuedWhite:string;readonly burnedWhite:string;
  readonly transactions:readonly PostcardTransactionReceipt[];
}
export interface PostcardTransactionResult {state:PostcardAccount;effect:PostcardAccountEffect;duplicate:boolean}
const trusted=new WeakSet<object>();
function fail(code:string):never {throw new PostcardRuleError(code);}
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&!Object.is(v,-0);
const uint32=(v:unknown):v is number=>integer(v)&&v<=0xffffffff;
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const credit=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,63})$/.test(v);
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown> {
  if(v===null||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
  const own=Reflect.ownKeys(v);
  return own.length===keys.length&&own.every(k=>typeof k==='string'&&keys.includes(k)&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)!,'value')&&Object.getOwnPropertyDescriptor(v,k)!.enumerable);
}
function plainArray(v:unknown):v is unknown[] {
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)return false;
  if(Reflect.ownKeys(v).length!==v.length+1)return false;
  for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return false;}
  return true;
}
/** Compare unknown data only against a shallow, engine-created expected shape. No getter,
 * custom iterator, serialization callback or arbitrary-depth input is evaluated. */
function sameData(actual:unknown,expected:unknown):boolean {
  if(Object.is(actual,expected))return true;
  if(expected===null||typeof expected!=='object')return false;
  const keys=Object.keys(expected);
  if(!exact(actual,keys))return false;
  return keys.every(k=>sameData(actual[k],(expected as Record<string,unknown>)[k]));
}
function whiteValue(held:PostcardState['held']):bigint {
  let total=0n,weight=1n;for(const tier of POSTCARD_TIERS){total+=BigInt(held[tier])*weight;weight*=5n;}return total;
}
function mass(account:PostcardAccount):void {
  const d=postcardAccrualDenominator(account.rate),gross=(BigInt(account.clockMs)-BigInt(account.createdAtMs))*BigInt(account.rate.numerator);
  if((whiteValue(account.held)+BigInt(account.burnedWhite))*d+BigInt(account.unclaimedUnits)+BigInt(account.overflowUnits)
    !==gross+BigInt(account.issuedWhite)*d)fail('postcard_account_conservation');
}
export function postcardShortcutProbability(stake:number):Readonly<{numerator:number;denominator:5}> {
  if(!integer(stake)||stake<1||stake>5)fail('postcard_shortcut_stake');
  return Object.freeze({numerator:stake,denominator:5});
}
/** Accepted uint32 values have exactly equal mass in the five buckets. Reject the one
 * excess value instead of introducing a modulo bias into the specified k/5 probability. */
export function postcardShortcutBucket(word:number):number|null {
  if(!uint32(word))fail('postcard_rng_word');return word===0xffffffff?null:word%5;
}
/** Physical raw draw index, zero-based. Matches the existing Mulberry32 stream without
 * replaying every earlier word or modifying the world's independent RNG closure. */
export function postcardRawWord(seed:number,index:number):number {
  if(!uint32(seed)||!integer(index))fail('postcard_rng_state');
  const offset=(seed+Math.imul(index,0x6d2b79f5))>>>0;
  return Math.floor(mulberry32(offset)()*0x1_0000_0000);
}
function assertTransaction(v:unknown):asserts v is PostcardTransaction {
  if(!exact(v,['kind','id','personId','atMs'])&&!exact(v,['kind','id','personId','atMs','tier'])&&
    !exact(v,['kind','id','personId','atMs','tier','stake']))fail('postcard_transaction_schema');
  if(!identifier(v.id)||!identifier(v.personId))fail('postcard_transaction_identity');
  if(!integer(v.atMs))fail('postcard_clock');
  if(v.kind==='clock'||v.kind==='claim'){
    if(!exact(v,['kind','id','personId','atMs']))fail('postcard_transaction_schema');
  }else if(v.kind==='safeFusion'||v.kind==='shortcutFusion'){
    const keys=v.kind==='safeFusion'?['kind','id','personId','atMs','tier']:['kind','id','personId','atMs','tier','stake'];
    if(!exact(v,keys)||!POSTCARD_TIERS.includes(v.tier as PostcardTier)||v.tier==='orange')fail('postcard_recipe');
    if(v.kind==='shortcutFusion'){
      if(v.tier==='white')fail('postcard_white_shortcut_forbidden');
      postcardShortcutProbability(v.stake as number);
    }
  }else fail('postcard_transaction_schema');
}
function frozenOrigin(origin:PostcardState):PostcardState {
  return Object.freeze({...origin,rate:Object.freeze({...origin.rate}),held:Object.freeze({...origin.held})});
}
function freezeEffect(effect:PostcardAccountEffect):PostcardAccountEffect {
  return Object.freeze({...effect,fusion:effect.fusion===null?null:Object.freeze({...effect.fusion,
    draw:effect.fusion.draw===null?null:Object.freeze({...effect.fusion.draw})})});
}
function freezeAccount(state:PostcardAccount):PostcardAccount {
  const next=Object.freeze({...state,rate:Object.freeze({...state.rate}),held:Object.freeze({...state.held}),
    origin:frozenOrigin(state.origin),transactions:Object.freeze(state.transactions.map(r=>Object.freeze({
      event:Object.freeze({...r.event}),effect:freezeEffect(r.effect)})))});
  trusted.add(next);return next;
}
function initial(origin:PostcardState,seed:number):PostcardAccount {
  assertPostcardState(origin);if(!uint32(seed))fail('postcard_rng_seed');
  const state:PostcardAccount={...origin,format:'node-postcard-state-v2',origin:frozenOrigin(origin),
    rngVersion:POSTCARD_RNG_VERSION,seed,drawCount:0,issuedWhite:'0',burnedWhite:'0',transactions:[]};
  mass(state);return freezeAccount(state);
}
export function upgradePostcardState(origin:PostcardState,seed:number):PostcardAccount {return initial(origin,seed);}
export function createPostcardAccount(personId:string,rate:PostcardRate,atMs:number,seed:number):PostcardAccount {
  return initial(createPostcardState(personId,rate,atMs),seed);
}
/** Internal transition over an already-validated account. Only the append stage commits
 * the local draw counter, complete stake consumption and issuance/burn as one result. */
function execute(state:PostcardAccount,event:PostcardTransaction):PostcardTransactionResult {
  assertTransaction(event);
  if(event.personId!==state.personId)fail('postcard_owner');
  if(event.atMs<state.clockMs)fail('postcard_clock_reversal');
  const held={...state.held};let stake=0;
  if(event.kind==='safeFusion'||event.kind==='shortcutFusion'){
    stake=event.kind==='safeFusion'?5:event.stake;
    if(held[event.tier]<stake)fail('postcard_insufficient_cards');
    const target=POSTCARD_TIERS[POSTCARD_TIERS.indexOf(event.tier)+1]!;
    // Refuse possible overflow before drawing; a losing roll cannot legalize a bad request.
    if(held[target]===Number.MAX_SAFE_INTEGER)fail('postcard_integer_overflow');
  }
  const earned=(BigInt(event.atMs)-BigInt(state.clockMs))*BigInt(state.rate.numerator);
  const capacity=BigInt(POSTCARD_BUFFER_HOURS)*BigInt(POSTCARD_HOUR_MS)*BigInt(state.rate.numerator);
  const room=capacity-BigInt(state.unclaimedUnits),accepted=earned<room?earned:room,lost=earned-accepted;
  let pending=BigInt(state.unclaimedUnits)+accepted,claimedWhite=0,lastClaimAtMs=state.lastClaimAtMs;
  let drawCount=state.drawCount,issued=0n,burned=0n,fusion:PostcardAccountEffect['fusion']=null;
  if(event.kind==='claim'){
    const d=postcardAccrualDenominator(state.rate),whole=pending/d;
    if(whole>BigInt(Number.MAX_SAFE_INTEGER)-BigInt(held.white))fail('postcard_integer_overflow');
    claimedWhite=Number(whole);held.white+=claimedWhite;pending%=d;lastClaimAtMs=event.atMs;
  }else if(event.kind==='safeFusion'||event.kind==='shortcutFusion'){
    const tierIndex=POSTCARD_TIERS.indexOf(event.tier),target=POSTCARD_TIERS[tierIndex+1]!;
    let draw:NonNullable<PostcardAccountEffect['fusion']>['draw']=null,success=true;
    if(stake<5){
      const start=drawCount;let bucket:number|null;
      do{
        if(drawCount===Number.MAX_SAFE_INTEGER)fail('postcard_rng_exhausted');
        bucket=postcardShortcutBucket(postcardRawWord(state.seed,drawCount));drawCount++;
      }while(bucket===null);
      success=bucket<stake;draw=Object.freeze({index:start,count:drawCount-start,bucket});
    }
    const weight=5n**BigInt(tierIndex);
    held[event.tier]-=stake;
    if(success){held[target]++;issued=BigInt(5-stake)*weight;}else burned=BigInt(stake)*weight;
    fusion=Object.freeze({from:event.tier,to:target,consumed:stake,produced:success?1:0,success,
      probabilityNumerator:stake,probabilityDenominator:5,draw});
  }
  const effect=freezeEffect({kind:event.kind,atMs:event.atMs,acceptedUnits:accepted.toString(),overflowUnits:lost.toString(),
    claimedWhite,issuedWhite:issued.toString(),burnedWhite:burned.toString(),fusion});
  const next:PostcardAccount={...state,held,clockMs:event.atMs,lastClaimAtMs,unclaimedUnits:pending.toString(),
    overflowUnits:(BigInt(state.overflowUnits)+lost).toString(),drawCount,
    issuedWhite:(BigInt(state.issuedWhite)+issued).toString(),burnedWhite:(BigInt(state.burnedWhite)+burned).toString(),
    transactions:[...state.transactions,{event:Object.freeze({...event}),effect}]};
  mass(next);return {state:freezeAccount(next),effect,duplicate:false};
}
/** Serialized state is verified by replaying its unique receipt journal from the explicit
 * v1 origin and seed, not merely accepting arithmetically convenient mint/burn counters. */
export function assertPostcardAccount(value:unknown):asserts value is PostcardAccount {
  if(value!==null&&typeof value==='object'&&trusted.has(value))return;
  const keys=['format','personId','rate','createdAtMs','clockMs','lastClaimAtMs','held','unclaimedUnits','overflowUnits',
    'origin','rngVersion','seed','drawCount','issuedWhite','burnedWhite','transactions'];
  if(!exact(value,keys)||value.format!=='node-postcard-state-v2'||value.rngVersion!==POSTCARD_RNG_VERSION)fail('postcard_account_schema');
  assertPostcardState(value.origin);
  if(!uint32(value.seed)||!integer(value.drawCount))fail('postcard_rng_state');
  if(!credit(value.issuedWhite)||!credit(value.burnedWhite)||!credit(value.unclaimedUnits)||!credit(value.overflowUnits))fail('postcard_credit');
  if(!integer(value.createdAtMs)||!integer(value.clockMs)||value.lastClaimAtMs!==null&&!integer(value.lastClaimAtMs))fail('postcard_clock');
  if(!exact(value.held,POSTCARD_TIERS))fail('postcard_inventory');
  const inventory=value.held;if(POSTCARD_TIERS.some(t=>!integer(inventory[t])))fail('postcard_inventory');
  if(!plainArray(value.transactions))fail('postcard_receipts');
  let replay=initial(value.origin,value.seed);const ids=new Set<string>();
  for(const receipt of value.transactions){
    if(!exact(receipt,['event','effect']))fail('postcard_receipt_schema');
    assertTransaction(receipt.event);
    if(ids.has(receipt.event.id))fail('postcard_duplicate_receipt');ids.add(receipt.event.id);
    const result=execute(replay,receipt.event);
    if(!sameData(receipt.effect,result.effect))fail('postcard_receipt_effect');
    replay=result.state;
  }
  for(const key of keys.filter(k=>k!=='transactions')){
    if(!sameData(value[key],(replay as unknown as Record<string,unknown>)[key]))fail('postcard_account_replay_mismatch');
  }
  mass(value as unknown as PostcardAccount);
}
/** Lock a parsed, fully validated account for safe reuse without replaying its history on
 * every transaction. This certifies immutable structure, not external provenance. */
export function sealPostcardAccount(value:unknown):PostcardAccount {
  assertPostcardAccount(value);return freezeAccount(value);
}
export function postcardAccountWhiteEquivalent(state:PostcardAccount):bigint {
  assertPostcardAccount(state);return whiteValue(state.held);
}
export function applyPostcardTransaction(state:PostcardAccount,event:PostcardTransaction):PostcardTransactionResult {
  assertPostcardAccount(state);assertTransaction(event);
  if(event.personId!==state.personId)fail('postcard_owner');
  const previous=state.transactions.find(r=>r.event.id===event.id);
  if(previous){
    if(!sameData(event,previous.event))fail('postcard_transaction_conflict');
    return {state,effect:previous.effect,duplicate:true};
  }
  return execute(state,event);
}
