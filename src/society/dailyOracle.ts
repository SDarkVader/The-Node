/** Explicitly funded trial Oracle. Only observation() leaves the operator state. */
import {digest} from '../agent/replay.js';
import {assertOracleDailyConfig,createOracleDailyDay,applyOracleDailyAction,closeOracleDailyDay,oracleDailyRules,
  type OracleDailyConfig,type OracleDailyDay} from '../engine/oracleDaily.js';
export interface SocietyDailyOracleConfig {
  format:'node-society-daily-oracle-config-v1';funding:'declaredTrialEndowment';treasuryMicro:number;catalogue:OracleDailyConfig;
}
export interface SocietyDailyOraclePayout {
  person:string;entered:boolean;won:boolean;prizeId:string|null;grossMicro:number;receivedMicro:number;capOverflowMicro:number;
}
export interface SocietyDailyOracleTransition {
  day:number;treasuryBeforeMicro:number;treasuryAfterMicro:number;draw:OracleDailyDay;payouts:SocietyDailyOraclePayout[];
}
export function validateSocietyDailyOracleConfig(value:unknown):asserts value is SocietyDailyOracleConfig {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('society_daily_oracle_config');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=['format','funding','treasuryMicro','catalogue'];
  if(Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!descriptors[k]?.enumerable||!Object.hasOwn(descriptors[k]!,'value')))
    throw Error('society_daily_oracle_config');
  const v=value as SocietyDailyOracleConfig;
  if(v.format!=='node-society-daily-oracle-config-v1'||v.funding!=='declaredTrialEndowment'||
    !Number.isSafeInteger(v.treasuryMicro)||v.treasuryMicro<0||Object.is(v.treasuryMicro,-0))throw Error('society_daily_oracle_config');
  assertOracleDailyConfig(v.catalogue);
}
export class SocietyDailyOracleBook {
  readonly config:SocietyDailyOracleConfig;
  #treasury:number;#seed:number;#days:SocietyDailyOracleTransition[]=[];
  constructor(config:SocietyDailyOracleConfig,seed:number){
    validateSocietyDailyOracleConfig(config);
    this.config=Object.freeze({...config,catalogue:Object.freeze({...config.catalogue,rewards:Object.freeze(config.catalogue.rewards.map(r=>Object.freeze({...r})))})});
    this.#treasury=config.treasuryMicro;this.#seed=seed;
  }
  get treasuryMicro():number{return this.#treasury;}
  #open(day:number,health:number,people:readonly string[]):OracleDailyDay {
    if(day!==this.#days.length+1)throw Error('society_daily_oracle_day');
    return createOracleDailyDay({day,health,personIds:people,seed:parseInt(digest(['daily-oracle',this.#seed,day]).slice(0,8),16),
      treasuryMicro:this.#treasury,config:this.config.catalogue});
  }
  /** Full-roster funding checked without RNG or mutation before publishing any menu. */
  observation(person:string,day:number,health:number,people:readonly string[]){
    const state=this.#open(day,health,people);if(!people.includes(person))throw Error('society_daily_oracle_person');
    const rules=oracleDailyRules(state.origin.config,health),last=this.#days.at(-1);
    const result=last?.payouts.find(p=>p.person===person);
    return {economicHealth:health,winProbability:rules.winProbability,
      rewards:rules.rewards.map(r=>({id:r.id,amount:r.amountMicro/1_000_000,probability:r.probability})),
      lastResult:result?{day:last!.day,entered:result.entered,won:result.won,prizeId:result.prizeId,
        grossAward:result.grossMicro/1_000_000,received:result.receivedMicro/1_000_000,capOverflow:result.capOverflowMicro/1_000_000}:null};
  }
  /** Canonical roster order removes submission-order influence. All eligibility and
   * maximum prizes are reserved before the first draw; null declines without a draw. */
  settle(day:number,health:number,people:readonly {person:string;wealth:number;cap?:number}[],choices:ReadonlyMap<string,'enter'|null>):SocietyDailyOracleTransition {
    let state=this.#open(day,health,people.map(p=>p.person));const payouts:SocietyDailyOraclePayout[]=[];
    for(const person of people){
      if(!Number.isFinite(person.wealth)||person.wealth<0||person.cap!==undefined&&(!Number.isFinite(person.cap)||person.cap<=0))throw Error('society_daily_oracle_balance');
      if(!choices.has(person.person))throw Error('society_daily_oracle_missing_choice');
      const choice=choices.get(person.person);if(choice!==null&&choice!=='enter')throw Error('society_daily_oracle_choice');
      const result=applyOracleDailyAction(state,{id:digest(['daily-oracle',day,person.person]),personId:person.person,kind:choice==='enter'?'enter':'decline'});
      state=result.state;const gross=result.effect.payoutMicro;
      const room=person.cap===undefined?gross:Math.max(0,Math.floor(Math.max(0,person.cap-person.wealth)*1_000_000));
      const received=Math.min(gross,room);
      payouts.push({person:person.person,entered:choice==='enter',won:result.effect.won,prizeId:result.effect.prizeId,
        grossMicro:gross,receivedMicro:received,capOverflowMicro:gross-received});
    }
    state=closeOracleDailyDay(state);
    const transition={day,treasuryBeforeMicro:this.#treasury,treasuryAfterMicro:state.availableMicro,draw:state,payouts};
    const paid=BigInt(this.config.treasuryMicro)-BigInt(state.availableMicro);
    const total=[...this.#days,transition].flatMap(d=>d.payouts).reduce((n,p)=>n+BigInt(p.grossMicro),0n);
    if(paid!==total)throw Error('society_daily_oracle_conservation');
    this.#treasury=state.availableMicro;this.#days.push(transition);return structuredClone(transition);
  }
  snapshot(){return structuredClone({funding:{kind:this.config.funding,issuedMicro:this.config.treasuryMicro},treasuryMicro:this.#treasury,days:this.#days});}
}
