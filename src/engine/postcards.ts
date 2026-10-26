/** Tiered postcards: DESIGN_ADDENDUM_2026-08-07 §§3–4 and the 2026-10-26 handoff.
 * Explicit caller-supplied milliseconds, never daily ticks, login counters or Date.now().
 * No calibrated rate is selected here. Integer rational credit preserves fractional cards.
 * This independent per-person asset reducer changes no historical world or agent contract.
 */
export const POSTCARD_TIERS = Object.freeze(['white', 'green', 'blue', 'purple', 'orange'] as const);
export type PostcardTier = typeof POSTCARD_TIERS[number];
export const POSTCARD_HOUR_MS = 3_600_000;
export const POSTCARD_BUFFER_HOURS = 16;
export interface PostcardRate { readonly numerator:number; readonly denominator:number }
export interface PostcardState {
  readonly format:'node-postcard-state-v1';
  readonly personId:string;
  /** Canonical positive rational White postcards per hour; required, not a default. */
  readonly rate:PostcardRate;
  readonly createdAtMs:number;
  readonly clockMs:number;
  readonly lastClaimAtMs:number|null;
  readonly held:Readonly<Record<PostcardTier,number>>;
  /** Units of 1/(rate.denominator * POSTCARD_HOUR_MS) White. Decimal integer strings
   * keep exact arithmetic JSON-portable without introducing a fractional-card quantum. */
  readonly unclaimedUnits:string;
  readonly overflowUnits:string;
}
export type PostcardEvent =
  | { readonly kind:'clock'|'claim'; readonly personId:string; readonly atMs:number }
  | { readonly kind:'safeFusion'; readonly personId:string; readonly atMs:number; readonly tier:PostcardTier };
export interface PostcardEffect {
  readonly kind:PostcardEvent['kind']; readonly atMs:number;
  readonly acceptedUnits:string; readonly overflowUnits:string; readonly claimedWhite:number;
  readonly fusion:null|{readonly from:PostcardTier; readonly to:PostcardTier; readonly consumed:5; readonly produced:1};
}
export class PostcardRuleError extends Error {
  constructor(readonly code:string){super(code);this.name='PostcardRuleError';}
}
function fail(code:string):never {throw new PostcardRuleError(code);}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0&&!Object.is(n,-0);
const positive=(n:unknown):n is number=>integer(n)&&n>0;
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return false;
  return own.every(k=>{const d=Object.getOwnPropertyDescriptor(value,k)!;return d.enumerable&&Object.hasOwn(d,'value');});
}
function gcd(a:bigint,b:bigint):bigint {while(b!==0n){const t=b;b=a%b;a=t;}return a;}
function rateIsCanonical(rate:unknown):rate is PostcardRate {
  return exact(rate,['numerator','denominator'])&&positive(rate.numerator)&&positive(rate.denominator)&&
    gcd(BigInt(rate.numerator),BigInt(rate.denominator))===1n;
}
const owner=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const units=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,63})$/.test(value);
export function postcardAccrualDenominator(rate:PostcardRate):bigint {
  if(!rateIsCanonical(rate))fail('postcard_rate');
  return BigInt(rate.denominator)*BigInt(POSTCARD_HOUR_MS);
}
function heldValue(held:PostcardState['held']):bigint {
  let total=0n,weight=1n;
  for(const tier of POSTCARD_TIERS){total+=BigInt(held[tier])*weight;weight*=5n;}
  return total;
}
/** Safe fusion conserves 1,5,25,125,625 White-equivalents. These are not gamble weights. */
export function postcardWhiteEquivalent(state:PostcardState):bigint {
  assertPostcardState(state);return heldValue(state.held);
}
export function assertPostcardState(value:unknown):asserts value is PostcardState {
  if(!exact(value,['format','personId','rate','createdAtMs','clockMs','lastClaimAtMs','held','unclaimedUnits','overflowUnits'])||
    value.format!=='node-postcard-state-v1'||!owner(value.personId))fail('postcard_state_schema');
  if(!rateIsCanonical(value.rate))fail('postcard_rate');
  if(!integer(value.createdAtMs)||!integer(value.clockMs)||value.clockMs<value.createdAtMs||
    value.lastClaimAtMs!==null&&(!integer(value.lastClaimAtMs)||value.lastClaimAtMs<value.createdAtMs||value.lastClaimAtMs>value.clockMs))fail('postcard_clock');
  if(!exact(value.held,POSTCARD_TIERS))fail('postcard_inventory');
  const inventory=value.held;
  if(POSTCARD_TIERS.some(tier=>!integer(inventory[tier])))fail('postcard_inventory');
  if(!units(value.unclaimedUnits)||!units(value.overflowUnits))fail('postcard_credit');
  const pending=BigInt(value.unclaimedUnits),overflow=BigInt(value.overflowUnits);
  const capacity=BigInt(POSTCARD_BUFFER_HOURS)*BigInt(POSTCARD_HOUR_MS)*BigInt(value.rate.numerator);
  if(pending>capacity)fail('postcard_buffer_cap');
  const held=heldValue(value.held as unknown as PostcardState['held']);
  if(value.lastClaimAtMs===null&&held!==0n)fail('postcard_claim_history');
  const issued=(BigInt(value.clockMs)-BigInt(value.createdAtMs))*BigInt(value.rate.numerator);
  if(held*postcardAccrualDenominator(value.rate)+pending+overflow!==issued)fail('postcard_resource_invariant');
}
function freezeState(state:PostcardState):PostcardState {
  return Object.freeze({...state,rate:Object.freeze({...state.rate}),held:Object.freeze({...state.held})});
}
export function createPostcardState(personId:string,rate:PostcardRate,atMs:number):PostcardState {
  if(!owner(personId))fail('postcard_owner');
  if(!exact(rate,['numerator','denominator'])||!positive(rate.numerator)||!positive(rate.denominator))fail('postcard_rate');
  if(!integer(atMs))fail('postcard_clock');
  const divisor=gcd(BigInt(rate.numerator),BigInt(rate.denominator));
  const state:PostcardState={format:'node-postcard-state-v1',personId,
    rate:{numerator:Number(BigInt(rate.numerator)/divisor),denominator:Number(BigInt(rate.denominator)/divisor)},
    createdAtMs:atMs,clockMs:atMs,lastClaimAtMs:null,
    held:{white:0,green:0,blue:0,purple:0,orange:0},unclaimedUnits:'0',overflowUnits:'0'};
  assertPostcardState(state);return freezeState(state);
}
function assertEvent(value:unknown):asserts value is PostcardEvent {
  if(!exact(value,['kind','personId','atMs'])&&!exact(value,['kind','personId','atMs','tier']))fail('postcard_event_schema');
  if(!owner(value.personId))fail('postcard_owner');
  if(!integer(value.atMs))fail('postcard_clock');
  if(value.kind==='clock'||value.kind==='claim'){
    if(!exact(value,['kind','personId','atMs']))fail('postcard_event_schema');
  }else if(value.kind==='safeFusion'){
    if(!exact(value,['kind','personId','atMs','tier'])||!POSTCARD_TIERS.includes(value.tier as PostcardTier)||value.tier==='orange')fail('postcard_recipe');
  }else fail('postcard_event_schema');
}
/** One atomic transaction. Invalid events cannot advance the clock, consume holdings or
 * mutate a prior state. Fresh buffer accrual is not automatically claimed or fused. */
export function applyPostcardEvent(state:PostcardState,event:PostcardEvent):{state:PostcardState;effect:PostcardEffect} {
  assertPostcardState(state);assertEvent(event);
  if(event.personId!==state.personId)fail('postcard_owner');
  if(event.atMs<state.clockMs)fail('postcard_clock_reversal');
  if(event.kind==='safeFusion'&&state.held[event.tier]<5)fail('postcard_insufficient_cards');
  const earned=(BigInt(event.atMs)-BigInt(state.clockMs))*BigInt(state.rate.numerator);
  const capacity=BigInt(POSTCARD_BUFFER_HOURS)*BigInt(POSTCARD_HOUR_MS)*BigInt(state.rate.numerator);
  const previous=BigInt(state.unclaimedUnits),room=capacity-previous;
  const accepted=earned<room?earned:room,lost=earned-accepted;
  let pending=previous+accepted,claimedWhite=0;
  const held={...state.held};let lastClaimAtMs=state.lastClaimAtMs;
  let fusion:PostcardEffect['fusion']=null;
  if(event.kind==='claim'){
    const denominator=postcardAccrualDenominator(state.rate),whole=pending/denominator;
    if(whole>BigInt(Number.MAX_SAFE_INTEGER)-BigInt(held.white))fail('postcard_integer_overflow');
    claimedWhite=Number(whole);held.white+=claimedWhite;pending%=denominator;lastClaimAtMs=event.atMs;
  }else if(event.kind==='safeFusion'){
    const target=POSTCARD_TIERS[POSTCARD_TIERS.indexOf(event.tier)+1]!;
    if(held[target]===Number.MAX_SAFE_INTEGER)fail('postcard_integer_overflow');
    held[event.tier]-=5;held[target]+=1;fusion=Object.freeze({from:event.tier,to:target,consumed:5,produced:1});
  }
  const next:PostcardState={...state,held,clockMs:event.atMs,lastClaimAtMs,
    unclaimedUnits:pending.toString(),overflowUnits:(BigInt(state.overflowUnits)+lost).toString()};
  assertPostcardState(next);
  return {state:freezeState(next),effect:Object.freeze({kind:event.kind,atMs:event.atMs,
    acceptedUnits:accepted.toString(),overflowUnits:lost.toString(),claimedWhite,fusion})};
}
