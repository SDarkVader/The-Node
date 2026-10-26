/** Universal daily Oracle, separate from the historical optional paid lottery.
 * No catalogue or payout calibration is activated here. A caller must supply an explicit
 * versioned contract and fund every inhabitant's maximum prize before the day opens.
 * Seed, cursor, funding, participant IDs and receipts are operator state, never a view.
 */
import {oracleWinProbability,ORACLE_HEALTH_FLOOR,ORACLE_HEALTH_REFERENCE} from './oracle.js';
import {mulberry32} from '../sim/rng.js';

export interface OracleDailyReward {
  readonly id:string;
  /** Existing wealth represented in integer millionths; not a new currency. */
  readonly amountMicro:number;
  readonly logWeightAtFloor:number;
  readonly logWeightAtReference:number;
}
export interface OracleDailyConfig {
  readonly format:'node-oracle-daily-config-v1';
  readonly revision:string;
  /** Ordered common -> exceptional, with strictly increasing actual bounded payouts. */
  readonly rewards:readonly OracleDailyReward[];
}
export interface OracleDailyRules {
  readonly enabled:boolean;
  readonly costMicro:0;
  readonly winProbability:number;
  readonly qualityVersion:'log-weight-health-square-v1';
  readonly rewards:readonly {readonly id:string;readonly amountMicro:number;readonly probability:number}[];
}
export interface OracleDailyOrigin {
  readonly day:number;
  readonly health:number;
  readonly personIds:readonly string[];
  readonly seed:number;
  readonly treasuryMicro:number;
  readonly config:OracleDailyConfig|null;
}
export interface OracleDailyAction {readonly id:string;readonly personId:string;readonly kind:'enter'|'decline'}
export interface OracleDailyEffect {
  readonly day:number;
  readonly personId:string;
  readonly kind:'enter'|'decline';
  readonly won:boolean;
  readonly prizeId:string|null;
  readonly payoutMicro:number;
  readonly winProbability:number;
  readonly availableDeltaMicro:number;
  readonly reservedDeltaMicro:number;
  readonly treasuryDeltaMicro:number;
  readonly wealthDeltaMicro:number;
  readonly draw:null|{readonly index:number;readonly count:1|2;readonly winRoll:number;readonly prizeRoll:number|null};
}
export interface OracleDailyReceipt {readonly action:OracleDailyAction;readonly effect:OracleDailyEffect}
export interface OracleDailyDay {
  readonly format:'node-oracle-daily-day-v1';
  readonly origin:OracleDailyOrigin;
  readonly availableMicro:number;
  readonly reservedMicro:number;
  readonly paidMicro:number;
  readonly drawCount:number;
  readonly closed:boolean;
  readonly receipts:readonly OracleDailyReceipt[];
}
export class OracleDailyRuleError extends Error {
  constructor(readonly code:string){super(code);this.name='OracleDailyRuleError';}
}
const trusted=new WeakSet<object>();
function fail(code:string):never {throw new OracleDailyRuleError(code);}
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&!Object.is(v,-0);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&!Object.is(v,-0);
const identity=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
  if(v===null||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
  const own=Reflect.ownKeys(v);
  return own.length===keys.length&&own.every(k=>typeof k==='string'&&keys.includes(k)&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)!,'value')&&Object.getOwnPropertyDescriptor(v,k)!.enumerable);
}
function plainArray(v:unknown):v is unknown[]{
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1)return false;
  for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return false;}
  return true;
}
function sameData(actual:unknown,expected:unknown):boolean{
  if(Object.is(actual,expected))return true;
  if(expected===null||typeof expected!=='object')return false;
  if(Array.isArray(expected))return plainArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>sameData(actual[i],v));
  const keys=Object.keys(expected);
  return exact(actual,keys)&&keys.every(k=>sameData(actual[k],(expected as Record<string,unknown>)[k]));
}
function health(value:unknown):asserts value is number{
  if(!finite(value)||value<0||value>1)fail('oracle_daily_health');
}
export function assertOracleDailyConfig(value:unknown):asserts value is OracleDailyConfig{
  if(!exact(value,['format','revision','rewards'])||value.format!=='node-oracle-daily-config-v1'||!identity(value.revision)||
    !plainArray(value.rewards)||value.rewards.length<2)fail('oracle_daily_config');
  const ids=new Set<string>();let previous:OracleDailyReward|undefined;
  for(const raw of value.rewards){
    if(!exact(raw,['id','amountMicro','logWeightAtFloor','logWeightAtReference'])||!identity(raw.id)||ids.has(raw.id)||
      !integer(raw.amountMicro)||raw.amountMicro===0||!finite(raw.logWeightAtFloor)||!finite(raw.logWeightAtReference))fail('oracle_daily_reward');
    ids.add(raw.id);
    const reward=raw as unknown as OracleDailyReward,slope=reward.logWeightAtReference-reward.logWeightAtFloor;
    if(!Number.isFinite(slope))fail('oracle_daily_reward_weight');
    if(previous&&(reward.amountMicro<=previous.amountMicro||reward.logWeightAtFloor>=previous.logWeightAtFloor||
      reward.logWeightAtReference>=previous.logWeightAtReference||
      slope<previous.logWeightAtReference-previous.logWeightAtFloor))fail('oracle_daily_reward_order');
    previous=reward;
  }
  // Stable softmax must retain positive probability even for the rarest configured entry.
  for(const endpoint of ['logWeightAtFloor','logWeightAtReference'] as const){
    const entries=value.rewards as unknown as OracleDailyReward[],max=entries[0]![endpoint];
    if(entries.some(r=>!Number.isFinite(r[endpoint]-max)||Math.exp(r[endpoint]-max)===0))fail('oracle_daily_probability_underflow');
  }
}
/** A monotone likelihood-ratio family: log weights interpolate with h^2. Pairwise
 * slopes cannot decrease with quality, so improved health cannot worsen prize quality.
 * This is a versioned configurable mathematical family, not an activated calibration. */
export function oracleDailyRules(config:OracleDailyConfig|null,economicHealthWithExperience:number):OracleDailyRules{
  health(economicHealthWithExperience);
  if(config===null)return Object.freeze({enabled:false,costMicro:0,winProbability:oracleWinProbability(economicHealthWithExperience),
    qualityVersion:'log-weight-health-square-v1',rewards:Object.freeze([])});
  assertOracleDailyConfig(config);
  const h=Math.max(0,Math.min(1,(economicHealthWithExperience-ORACLE_HEALTH_FLOOR)/(ORACLE_HEALTH_REFERENCE-ORACLE_HEALTH_FLOOR))),u=h*h;
  const logs=config.rewards.map(r=>(1-u)*r.logWeightAtFloor+u*r.logWeightAtReference),max=logs[0]!;
  const weights=logs.map(log=>Math.exp(log-max)),sum=weights.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(sum)||sum<=0||weights.some(w=>!Number.isFinite(w)||w<=0))fail('oracle_daily_probability');
  return Object.freeze({enabled:true,costMicro:0,winProbability:oracleWinProbability(economicHealthWithExperience),
    qualityVersion:'log-weight-health-square-v1',rewards:Object.freeze(config.rewards.map((r,i)=>
      Object.freeze({id:r.id,amountMicro:r.amountMicro,probability:weights[i]!/sum})))});
}
function freezeConfig(config:OracleDailyConfig|null):OracleDailyConfig|null{
  return config===null?null:Object.freeze({...config,rewards:Object.freeze(config.rewards.map(r=>Object.freeze({...r})))});
}
function freezeDay(state:OracleDailyDay):OracleDailyDay{
  const next=Object.freeze({...state,origin:Object.freeze({...state.origin,personIds:Object.freeze([...state.origin.personIds]),config:freezeConfig(state.origin.config)}),
    receipts:Object.freeze(state.receipts.map(r=>Object.freeze({action:Object.freeze({...r.action}),effect:Object.freeze({...r.effect,
      draw:r.effect.draw===null?null:Object.freeze({...r.effect.draw})})})))});
  trusted.add(next);return next;
}
function assertOrigin(value:unknown):asserts value is OracleDailyOrigin{
  if(!exact(value,['day','health','personIds','seed','treasuryMicro','config'])||!integer(value.day)||!integer(value.seed)||value.seed>0xffffffff||
    !integer(value.treasuryMicro)||!plainArray(value.personIds))fail('oracle_daily_origin');
  health(value.health);if(value.config!==null)assertOracleDailyConfig(value.config);
  if(value.personIds.some(id=>!identity(id))||new Set(value.personIds).size!==value.personIds.length)fail('oracle_daily_participants');
}
function reserveFor(origin:OracleDailyOrigin):number{return origin.config?.rewards.at(-1)?.amountMicro??0;}
function mass(state:OracleDailyDay):void{
  if(!integer(state.availableMicro)||!integer(state.reservedMicro)||!integer(state.paidMicro)||
    BigInt(state.availableMicro)+BigInt(state.reservedMicro)+BigInt(state.paidMicro)!==BigInt(state.origin.treasuryMicro))fail('oracle_daily_conservation');
}
/** The actual treasury must back every person's maximum daily prize, including those
 * with zero wealth. Refuse an unfunded day before assigning any draw or charging anyone. */
export function createOracleDailyDay(origin:OracleDailyOrigin):OracleDailyDay{
  assertOrigin(origin);
  const reserved=BigInt(reserveFor(origin))*BigInt(origin.personIds.length);
  if(reserved>BigInt(origin.treasuryMicro))fail('oracle_daily_unfunded');
  const state:OracleDailyDay={format:'node-oracle-daily-day-v1',origin,availableMicro:origin.treasuryMicro-Number(reserved),
    reservedMicro:Number(reserved),paidMicro:0,drawCount:0,closed:false,receipts:[]};
  mass(state);return freezeDay(state);
}
function assertAction(action:unknown):asserts action is OracleDailyAction{
  if(!exact(action,['id','personId','kind'])||!identity(action.id)||!identity(action.personId)||
    action.kind!=='enter'&&action.kind!=='decline')fail('oracle_daily_action');
}
function rawDraw(seed:number,index:number):number{return mulberry32((seed+Math.imul(index,0x6d2b79f5))>>>0)();}
function execute(state:OracleDailyDay,action:OracleDailyAction):{state:OracleDailyDay;effect:OracleDailyEffect;duplicate:false}{
  assertAction(action);
  if(state.closed)fail('oracle_daily_closed');
  if(!state.origin.personIds.includes(action.personId))fail('oracle_daily_unknown_person');
  if(state.receipts.some(r=>r.action.personId===action.personId))fail('oracle_daily_already_decided');
  const rules=oracleDailyRules(state.origin.config,state.origin.health);
  if(!rules.enabled)fail('oracle_daily_unconfigured');
  let won=false,prizeId:string|null=null,payoutMicro=0,draw:OracleDailyEffect['draw']=null,drawCount=state.drawCount;
  if(action.kind==='enter'){
    if(drawCount>Number.MAX_SAFE_INTEGER-2)fail('oracle_daily_rng_exhausted');
    const index=drawCount,winRoll=rawDraw(state.origin.seed,drawCount++);let prizeRoll:number|null=null;
    if(!finite(winRoll)||winRoll<0||winRoll>=1)fail('oracle_daily_rng');
    won=winRoll<rules.winProbability;
    if(won){
      prizeRoll=rawDraw(state.origin.seed,drawCount++);
      if(!finite(prizeRoll)||prizeRoll<0||prizeRoll>=1)fail('oracle_daily_rng');
      let cumulative=0,selected=rules.rewards.at(-1)!;
      for(const prize of rules.rewards){cumulative+=prize.probability;if(prizeRoll<cumulative){selected=prize;break;}}
      prizeId=selected.id;payoutMicro=selected.amountMicro;
    }
    draw=Object.freeze({index,count:won?2:1,winRoll,prizeRoll});
  }
  const reserve=reserveFor(state.origin);
  const effect:OracleDailyEffect=Object.freeze({day:state.origin.day,personId:action.personId,kind:action.kind,won,prizeId,payoutMicro,
    winProbability:rules.winProbability,availableDeltaMicro:reserve-payoutMicro,reservedDeltaMicro:-reserve,
    treasuryDeltaMicro:payoutMicro===0?0:-payoutMicro,wealthDeltaMicro:payoutMicro,draw});
  const next:OracleDailyDay={...state,availableMicro:state.availableMicro+reserve-payoutMicro,reservedMicro:state.reservedMicro-reserve,
    paidMicro:state.paidMicro+payoutMicro,drawCount,receipts:[...state.receipts,{action,effect}]};
  mass(next);return {state:freezeDay(next),effect,duplicate:false};
}
/** Reopen JSON state only after checking every receipt and the complete funding ledger. */
export function assertOracleDailyDay(value:unknown):asserts value is OracleDailyDay{
  if(value!==null&&typeof value==='object'&&trusted.has(value))return;
  if(!exact(value,['format','origin','availableMicro','reservedMicro','paidMicro','drawCount','closed','receipts'])||
    value.format!=='node-oracle-daily-day-v1'||!integer(value.drawCount)||typeof value.closed!=='boolean'||!plainArray(value.receipts))fail('oracle_daily_state');
  assertOrigin(value.origin);let replay=createOracleDailyDay(value.origin);const ids=new Set<string>();
  for(const receipt of value.receipts){
    if(!exact(receipt,['action','effect']))fail('oracle_daily_receipt');assertAction(receipt.action);
    if(ids.has(receipt.action.id))fail('oracle_daily_duplicate_id');ids.add(receipt.action.id);
    const result=execute(replay,receipt.action);
    if(!sameData(receipt.effect,result.effect))fail('oracle_daily_receipt_mismatch');replay=result.state;
  }
  if(value.closed)replay=closeOracleDailyDay(replay);
  if(!sameData(value,replay))fail('oracle_daily_state_mismatch');mass(value as unknown as OracleDailyDay);
}
export function sealOracleDailyDay(value:unknown):OracleDailyDay{assertOracleDailyDay(value);return freezeDay(value);}
export function applyOracleDailyAction(state:OracleDailyDay,action:OracleDailyAction):{state:OracleDailyDay;effect:OracleDailyEffect;duplicate:boolean}{
  assertOracleDailyDay(state);assertAction(action);
  const previous=state.receipts.find(r=>r.action.id===action.id);
  if(previous){if(!sameData(action,previous.action))fail('oracle_daily_transaction_conflict');return {state,effect:previous.effect,duplicate:true};}
  return execute(state,action);
}
/** Expiry settles actual unused reserves, without RNG, owner charge or a forced entry. */
export function closeOracleDailyDay(state:OracleDailyDay):OracleDailyDay{
  assertOracleDailyDay(state);if(state.closed)return state;
  const next=freezeDay({...state,closed:true,availableMicro:state.availableMicro+state.reservedMicro,reservedMicro:0});
  mass(next);return next;
}
