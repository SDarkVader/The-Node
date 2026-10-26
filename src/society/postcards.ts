/** Trusted personal postcard integration. This book and its RNG/receipts are operator
 * state; only observation() is projected into an inhabitant's allowlisted context. */
import {digest} from '../agent/replay.js';
import {POSTCARD_HOUR_MS,createPostcardState,type PostcardRate} from '../engine/postcards.js';
import {createPostcardAccount,applyPostcardTransaction,type PostcardAccount,type PostcardTransaction,
  type PostcardAccountEffect} from '../engine/postcardAccount.js';
import {postcardAccountHash} from '../engine/postcardAccountReplay.js';
import type {SocietyAction,SocietyPostcardObservation} from './boundary.js';

export interface SocietyPostcardConfig {
  rate:PostcardRate; startAtMs:number; dayDurationMs:86_400_000;
}
export interface SocietyPostcardTransition {
  person:string; event:PostcardTransaction|{kind:'create';atMs:number};
  effect:PostcardAccountEffect|null; beforeHash:string|null; afterHash:string;
}
export function validateSocietyPostcardConfig(value:unknown):asserts value is SocietyPostcardConfig {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('society_postcard_config');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).length!==3||!['rate','startAtMs','dayDurationMs'].every(k=>
    descriptors[k]&&Object.hasOwn(descriptors[k],'value')&&descriptors[k]!.enumerable))throw Error('society_postcard_config');
  const v=value as SocietyPostcardConfig;
  if(v.dayDurationMs!==24*POSTCARD_HOUR_MS)throw Error('society_postcard_day_duration');
  createPostcardState('postcard-config-validation',v.rate,v.startAtMs);
}
export class SocietyPostcardBook {
  readonly config:SocietyPostcardConfig;
  #accounts=new Map<string,PostcardAccount>();
  #events:SocietyPostcardTransition[]=[];
  #seed:number;
  constructor(config:SocietyPostcardConfig,seed:number,initialPeople:readonly string[]) {
    validateSocietyPostcardConfig(config);
    this.config=Object.freeze({...config,rate:Object.freeze({...config.rate})});this.#seed=seed;
    this.register(initialPeople,0);this.#events=[];
  }
  #time(day:number):number {
    const time=this.config.startAtMs+day*this.config.dayDurationMs;
    if(!Number.isSafeInteger(day)||day<0||!Number.isSafeInteger(time)||time<0)throw Error('society_postcard_clock');
    return time;
  }
  /** A distinct arrival starts at arrival time. Existing people retain their accounts
   * across workplace changes, vacancies and role epochs. Departed holdings are retained. */
  register(people:readonly string[],day:number):void {
    const atMs=this.#time(day),next=new Map(this.#accounts),events:SocietyPostcardTransition[]=[];
    for(const person of people)if(!next.has(person)){
      const seed=parseInt(digest(['society-postcards',this.#seed,person]).slice(0,8),16);
      const state=createPostcardAccount(person,this.config.rate,atMs,seed);next.set(person,state);
      events.push({person,event:{kind:'create',atMs},effect:null,beforeHash:null,afterHash:postcardAccountHash(state)});
    }
    this.#accounts=next;this.#events.push(...events);
  }
  /** Daily decisions occur at the end of an explicitly configured 24-hour interval.
   * Advancing the clock is not a claim/login; excess unclaimed credit is still lost. */
  beginAct(people:readonly string[],day:number):void {
    const atMs=this.#time(day),next=new Map(this.#accounts),events:SocietyPostcardTransition[]=[];
    for(const person of people){
      const state=next.get(person);if(!state)throw Error('society_postcard_person');
      const event:PostcardTransaction={kind:'clock',id:`day:${day}:clock`,personId:person,atMs};
      const result=applyPostcardTransaction(state,event);next.set(person,result.state);
      events.push({person,event,effect:result.effect,beforeHash:postcardAccountHash(state),afterHash:postcardAccountHash(result.state)});
    }
    this.#accounts=next;this.#events.push(...events);
  }
  observation(person:string):SocietyPostcardObservation {
    const state=this.#accounts.get(person);if(!state)throw Error('society_postcard_person');
    return {held:{...state.held},rate:{...state.rate},unclaimedUnits:state.unclaimedUnits,
      clockMs:state.clockMs,lastClaimAtMs:state.lastClaimAtMs};
  }
  submit(person:string,day:number,choice:SocietyAction['postcards']):void {
    if(!choice)return;
    let state=this.#accounts.get(person);if(!state)throw Error('society_postcard_person');
    const atMs=this.#time(day),events:SocietyPostcardTransition[]=[];
    const apply=(event:PostcardTransaction)=>{
      const beforeHash=postcardAccountHash(state!),result=applyPostcardTransaction(state!,event);
      state=result.state;events.push({person,event,effect:result.effect,beforeHash,afterHash:postcardAccountHash(state)});
    };
    if(choice.claim)apply({kind:'claim',id:`day:${day}:claim`,personId:person,atMs});
    if(choice.fusion){const {tier,stake}=choice.fusion;
      apply(stake===5?{kind:'safeFusion',id:`day:${day}:fusion`,personId:person,atMs,tier}:
        {kind:'shortcutFusion',id:`day:${day}:fusion`,personId:person,atMs,tier,stake});}
    this.#accounts.set(person,state);this.#events.push(...events);
  }
  exportAccounts():[string,PostcardAccount][] {return structuredClone([...this.#accounts]);}
  drain():SocietyPostcardTransition[] {const events=this.#events;this.#events=[];return structuredClone(events);}
}
