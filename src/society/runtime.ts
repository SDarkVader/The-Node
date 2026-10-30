/** A separate, opt-in society contract over the existing deterministic participant kernel.
 * Policies receive only boundary.visible. No provider, credential, shell or tool dispatcher
 * is imported here. Submitted JSON is data, never evaluated JavaScript.
 */
import {perceptionRequest,assertPerceptionRecord,DEFAULT_PERCEPTION_CONDITION,type PerceptionRecord,type FirstPersonObservation,type PerceptionRequest} from '../observatory/perception.js';
import {navigationRequest,assertNavigationRecord,type NavigationRequest,type NavigationRecord} from '../observatory/navigation.js';
import {observe} from '../server/observer.js';
import {applyParticipantMove} from '../agent/participantWorld.js';
import { createParticipantState, stepParticipantState, stepParticipantTurn, fixtureGenesis, type Genesis, type ParticipantState } from '../agent/participantWorld.js';
import { digest, evidenceHash } from '../agent/replay.js';
import { roleArrays } from '../engine/inhabitants.js';
import { personBody, observerRef, refHexLength } from '../server/observer.js';
import { hashUnit } from '../engine/dealings.js';
import { societyPurchaseDue, type SocietyEconomyPlan } from '../engine/societyEconomy.js';
import { oracleWinProbability, ORACLE_ENTRY_COST } from '../engine/oracle.js';
import { emptyOracleOpportunityState, expireOracleOpportunity, oracleOpportunityEscrow, resolveSocietyOracleEntry,
  type OracleOpportunityState, type SocietyOracleEntryResult } from '../engine/oracleOpportunities.js';
import { accountsTotal, totalHoldings, totalIssued } from '../engine/settlement.js';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { SelfState } from '../comms/grammar.js';
import { giniCoefficient, topShare } from '../engine/wealth.js';
import { buildSocietyContext, validateSocietyAction, parseSocietyResponse, SocietySecurityError,
  type SocietyAction } from './boundary.js';
import {SocietyPostcardBook,type SocietyPostcardConfig,type SocietyPostcardTransition} from './postcards.js';
import type {PostcardAccount} from '../engine/postcardAccount.js';
import {SocietyDailyOracleBook,type SocietyDailyOracleConfig,type SocietyDailyOracleTransition} from './dailyOracle.js';
import {SocietyRoutineBook,validateSocietyRoutineConfig,type SocietyRoutineConfig} from './routine.js';
import {societyCivicEvents,societyCivicScores} from './civicStanding.js';
import type {CivicReputationEvent} from '../engine/civicReputation.js';
import {resolveRoleClaims,type RoleClaim,type RoleClaimOutcome} from './roleClaims.js';
import {stepReputationBackstops,evictBackstoppedOccupant,type ReputationIntervention,type BackstopIncumbent,type BackstopOutcome} from './reputationBackstop.js';

export type Phase = 'commit' | 'act';
export type SocietyView = ReturnType<typeof buildSocietyContext>['visible'];
export interface SocietyOptions { seed: number; sourceRevision: string; config?: WorldConfig; observerSecret?: string;
  postcards?:SocietyPostcardConfig;dailyOracle?:SocietyDailyOracleConfig;routine?:SocietyRoutineConfig;
  competitiveGrifter?:true }
export interface SocietyDecisionRecord {
  day: number; phase: Phase; person: string; controlled: boolean;
  visible: SocietyView; legalChoices: unknown; action: SocietyAction;
  turn?:number;
  perception?:PerceptionRecord;navigation?:NavigationRecord;
  transition?:{beforeHash:string;afterHash:string;beforeTick:number;afterTick:number;effects:{person:string;category:string}[]};
}
export interface SocietyTransition {
  day: number; beforeHash: string; afterHash: string; effects: {person:string;category:string}[];
  economy: unknown; oracle: {person:string;result:SocietyOracleEntryResult}[];
  accounting: {kernelResidual:number;oracleResidual:number;residual:number;escrow:number};
  conditions: {district:string;tension:number;state:string}[];
  postcards?:SocietyPostcardTransition[];
  dailyOracle?:SocietyDailyOracleTransition & {paidLotteryCapOverflow:number};
  routine?:{turns:number;residents:ReturnType<SocietyRoutineBook['summary']>};
  civicEvents?:CivicReputationEvent[];
  roleClaims?:RoleClaimOutcome[];
  reputationBackstops?:BackstopOutcome;
}
export interface SocietyTurnTransition {day:number;turn:number;beforeHash:string;afterHash:string;effects:{person:string;category:string}[]}
export interface SocietyTape {
  format: 'node-society-offline-v1'|'node-society-postcards-v2'|'node-society-daily-oracle-v3'|'node-society-routine-v4'; genesis: Genesis; controlled: string[];
  genesisHash: string; decisions: SocietyDecisionRecord[]; transitions: SocietyTransition[];
  postcardConfig?:SocietyPostcardConfig; postcardAccounts?:[string,PostcardAccount][];
  dailyOracleConfig?:SocietyDailyOracleConfig;dailyOracleState?:ReturnType<SocietyDailyOracleBook['snapshot']>;
  routineConfig?:SocietyRoutineConfig;routineState?:ReturnType<SocietyRoutineBook['snapshot']>;turnTransitions?:SocietyTurnTransition[];
  competitiveGrifter?:true;
}
const publicRole = {baker:'Baker',miller:'Miller',courier:'Courier',investigator:'Investigator',importExport:'ImportExport'} as const;

/** Small initial society, not a replacement for the calibrated default world. All five
 * implemented jobs and roleless residents remain real occupants. Kernel churn/backstops,
 * supply equations, purchase cycle and geography retain their normal rules. */
export function societyConfig(): WorldConfig {
  return {...structuredClone(DEFAULT_WORLD_CONFIG), rMiller:1, rBaker:2, rCourier:1,
    rInvestigator:1, rImportExport:1, targetPopulation:14, recognition:'v2', settlement:'funded'};
}
function holdingTotal(state: ParticipantState): number {
  return totalHoldings([...roleArrays(state.world).map(([,slots])=>slots),state.world.grifters]);
}

export class Society {
  #state: ParticipantState;
  #phase: Phase = 'commit';
  #halted = false;
  // Transport lease counter, deliberately outside historical world hashes and tapes.
  #revision = 0;
  #perceptions=new Map<string,PerceptionRecord>();
  #navigation=new Map<string,NavigationRecord>();
  #pending = new Map<string,SocietyAction>();
  #prices = new Map<string,number>();
  #quantities = new Map<string,number>();
  #oracle = new Map<string,OracleOpportunityState>();
  #wall: {author:string;state:SelfState;day:number}[] = [];
  #tape: SocietyTape;
  #postcards?:SocietyPostcardBook;
  #dailyOracle?:SocietyDailyOracleBook;
  #routine?:SocietyRoutineBook;
  #turnTransitions:SocietyTurnTransition[]=[];
  #routineEvidenceBytes=0;
  #routineEvidenceNodes=0;
  #civicEvents?:CivicReputationEvent[];
  #roleClaims?:RoleClaim[];
  #reputationBackstops?:ReputationIntervention[];
  constructor(options: SocietyOptions) {
    const genesis = fixtureGenesis(options.seed, options.config ?? societyConfig());
    if(options.routine!==undefined){validateSocietyRoutineConfig(options.routine);genesis.config={...genesis.config,diarySubjectOptional:true,purchaseCycleDays:1};}
    genesis.namespace = 'society-inhabitant'; genesis.sourceRevision = options.sourceRevision;
    if (options.observerSecret) genesis.observerSecret = options.observerSecret;
    if (genesis.config.recognition !== 'v2' || genesis.config.settlement === 'legacy') throw Error('society_requires_recognition_v2_funded_settlement');
    this.#state = createParticipantState(genesis);
    const controlled = [...this.#state.registry.people.values()].filter(p=>p.role==='baker'||p.role==='miller').map(p=>p.id);
    if (controlled.length !== 3 || genesis.config.rBaker !== 2 || genesis.config.rMiller !== 1) throw Error('society_initial_two_bakers_one_miller_required');
    if(options.competitiveGrifter===true){
      this.#civicEvents=[];
      this.#roleClaims=[];
      this.#reputationBackstops=[];
      const candidate=[...this.#state.registry.people.values()].find(p=>p.role===null&&p.location!==null);
      if(!candidate)throw Error('society_competitive_grifter_required');
      controlled.push(candidate.id);
    } else if(options.competitiveGrifter!==undefined) throw Error('society_competitive_grifter_config');
    if(options.postcards)this.#postcards=new SocietyPostcardBook(options.postcards,genesis.seed,this.#activePeople());
    if(options.dailyOracle)this.#dailyOracle=new SocietyDailyOracleBook(options.dailyOracle,genesis.seed);
    if(options.routine!==undefined)this.#routine=new SocietyRoutineBook(options.routine,this.#state);
    this.#resetCommitments();
    this.#tape = {format:this.#routine?'node-society-routine-v4':this.#dailyOracle?'node-society-daily-oracle-v3':this.#postcards?'node-society-postcards-v2':'node-society-offline-v1',genesis:structuredClone(genesis),controlled,
      genesisHash:this.hash,decisions:[],transitions:[],...(options.competitiveGrifter?{competitiveGrifter:true as const}:{}),...(this.#postcards?{postcardConfig:structuredClone(this.#postcards.config)}:{}),
      ...(this.#dailyOracle?{dailyOracleConfig:structuredClone(this.#dailyOracle.config)}:{}),...(this.#routine?{routineConfig:structuredClone(this.#routine.config)}:{})};
  }
  get tick() { return this.#state.world.tick; }
  get phase() { return this.#phase; }
  get halted() { return this.#halted; }
  get revision() { return this.#revision; }
  get turn(){return this.#routine?(this.#phase==='commit'?0:this.#routine.turn):undefined;}
  get stoppedReason(){return this.#routine?.limitReached?'society_daily_turn_limit':this.#halted?'society_halted':null;}
  /** External transport/accounting failures revoke further execution, without a retry. */
  halt(): void { if (!this.#halted) { this.#halted=true; this.#revision++; } }
  get hash() { const original=[evidenceHash(this.#state),[...this.#oracle],this.#phase,[...this.#prices],[...this.#quantities],this.#wall];
    const cards=this.#postcards?[...original,this.#postcards.config,this.#postcards.exportAccounts()]:original;
    const daily=this.#dailyOracle?[...cards,this.#dailyOracle.config,this.#dailyOracle.snapshot()]:cards;
    const sequence=this.#routine?[...daily,this.#routine.snapshot(),[...this.#pending]]:daily;
    return digest(this.#civicEvents?[...sequence,this.#civicEvents,this.#roleClaims,this.#reputationBackstops]:sequence); }
  get controlled() { return [...this.#tape.controlled]; }
  /** Researcher-only read. This must never be passed to a policy or provider. */
  inspect(): ParticipantState { return {...this.#state,world:structuredClone({...this.#state.world,rng:undefined}),registry:structuredClone(this.#state.registry),genesis:structuredClone(this.#state.genesis)} as unknown as ParticipantState; }
  exportTape(): SocietyTape { return {...structuredClone(this.#tape),...(this.#postcards?{postcardAccounts:this.#postcards.exportAccounts()}:{}),
    ...(this.#dailyOracle?{dailyOracleState:this.#dailyOracle.snapshot()}:{}),...(this.#routine?{routineState:this.#routine.snapshot(),turnTransitions:structuredClone(this.#turnTransitions)}:{})}; }
  #activePeople():string[] {return [...this.#state.registry.people.values()].filter(p=>p.location!==null).map(p=>p.id);}
  #beginAct():void {this.#postcards?.beginAct(this.#activePeople(),this.tick+1);}
  pendingPeople(): string[] {
    if (this.#halted) throw Error('society_halted');
    return [...this.#state.registry.people.values()].filter(p=>p.location!==null &&
      (this.#phase==='act'||p.role==='baker'||p.role==='miller')&&!this.#pending.has(p.id)&&
      (this.#phase!=='act'||!this.#routine?.closed(p.id))).map(p=>p.id);
  }
  #resetCommitments() {
    this.#prices = new Map(this.#state.world.bakers.filter(x=>x.slot.state==='FILLED').map(x=>[x.buildingId,x.value]));
    this.#quantities = new Map(this.#state.world.millers.filter(x=>x.slot.state==='FILLED').map(x=>[x.buildingId,x.value]));
  }
  #ref(observer:string,person:string) { return observerRef(this.#state.genesis.observerSecret,observer,person,refHexLength(this.#state.world)); }
  get dualNavigation(){return this.#routine?.config.navigation==='dual-v1';}
  #perceptionRequest(person:string){
    return perceptionRequest(this.#state,{agentId:this.#ref(person,person),person},'first_person',DEFAULT_PERCEPTION_CONDITION,
      {episodeId:'society-dual-v1',worldHash:this.hash});
  }
  async prepareView(person:string,perceive?:(r:PerceptionRequest)=>Promise<PerceptionRecord>){
    if(!this.dualNavigation)return this.view(person);
    if(this.#halted||!this.pendingPeople().includes(person))throw Error('society_no_current_observation');
    const cached=this.#perceptions.get(person);
    if(cached?.worldHash===this.hash)return this.view(person);
    if(!perceive)throw Error('society_perception_required');
    const hash=this.hash,revision=this.revision,request=this.#perceptionRequest(person),record=await perceive(request);
    if(this.#halted||hash!==this.hash||revision!==this.revision)throw Error('society_stale_perception');
    this.bindEvidence(person,{perception:record});return this.view(person);
  }
  #navigationRequest(person:string,to:{x:number;y:number}){
    const own=personBody(this.#state,this.#state.registry.people.get(person)!);
    const district=this.#state.world.shard.districts.find(d=>d.plots.some(q=>q.x===own.x&&q.y===own.y));
    if(!district)throw Error('society_navigation_district');
    return navigationRequest(this.hash,this.#ref(person,person),own,to,district);
  }
  async prepareTravel(person:string,value:unknown,navigate?:(r:NavigationRequest)=>Promise<NavigationRecord>){
    if(!this.dualNavigation)return;
    const action=typeof value==='string'?parseSocietyResponse(value,this.view(person).context):validateSocietyAction(value,this.view(person).context);
    if(!action.move)return;
    if(!navigate)throw Error('society_navigation_required');
    const hash=this.hash,revision=this.revision,record=await navigate(this.#navigationRequest(person,action.move));
    if(this.#halted||hash!==this.hash||revision!==this.revision)throw Error('society_stale_navigation');
    this.bindEvidence(person,{navigation:record},action);
  }
  /** Trusted replay/operator evidence only. Never an action available to an inhabitant. */
  bindEvidence(person:string,evidence:{perception?:PerceptionRecord;navigation?:NavigationRecord},action?:SocietyAction){
    if(!this.dualNavigation){if(evidence.perception||evidence.navigation)throw Error('society_unexpected_senses');return;}
    if(evidence.perception)this.#perceptions.set(person,assertPerceptionRecord(this.#perceptionRequest(person),evidence.perception));
    if(evidence.navigation){if(!action?.move)throw Error('society_navigation_action');
      this.#navigation.set(person,assertNavigationRecord(this.#navigationRequest(person,action.move),evidence.navigation));}
  }
  decisionEvidence(person:string){return structuredClone({...(this.#perceptions.has(person)?{perception:this.#perceptions.get(person)!}:{}),
    ...(this.#navigation.has(person)?{navigation:this.#navigation.get(person)!}:{})});}
  view(person: string) {
    if (this.#halted || !this.pendingPeople().includes(person)) throw Error('society_no_current_observation');
    const perception=this.#perceptions.get(person);
    if(this.dualNavigation&&perception?.worldHash!==this.hash)throw Error('society_perception_required');
    const w = this.#state.world, own = personBody(this.#state,this.#state.registry.people.get(person)!);
    const oracle = this.#oracle.get(person) ?? emptyOracleOpportunityState(), day=w.tick+1;
    const voucher=oracle.voucher, liveVoucher=!!voucher&&day>=voucher.availableDay&&day<=voucher.expiresAfterDay;
    const market=w.bakers.filter(b=>b.slot.state==='FILLED').map(b=>({
      sellerRef:this.#ref(person,this.#state.registry.locations.get(b.buildingId)!),buildingId:b.buildingId,
      price:this.#prices.get(b.buildingId)??b.value,available:true,
    }));
    return buildSocietyContext(this.#state,person,{
      ...(this.#tape.competitiveGrifter?{objective:'competitive-society-v1' as const}:{}),
      ...(this.#civicEvents?{civicStanding:(()=>{const people=[...this.#state.registry.people.values()].filter(p=>p.location!==null);
        const scores=societyCivicScores(this.#civicEvents!,people.map(p=>p.id));
        return {own:scores.get(person)!,others:people.filter(p=>p.id!==person).map(p=>({ref:this.#ref(person,p.id),...scores.get(p.id)!})),
          assistance:(this.#reputationBackstops??[]).filter(item=>{const p=this.#state.registry.people.get(item.person);
            return p?.location===item.businessId&&p.role===item.role&&p.roleEpoch===item.roleEpoch;})
            .map(item=>({businessId:item.businessId,startedDay:item.startedDay,daysRemaining:item.startedDay+3-this.tick}))};})()}:{}),
      ...(this.dualNavigation?{firstPerson:perception!.observation as FirstPersonObservation}:{}),
      phase:this.#phase,market,purchaseDue:societyPurchaseDue(w.seed,day,person,w.config.purchaseCycleDays),
      ...(this.#routine?.config.information?{information:{contract:this.#routine.config.information,lastLottery:(()=>{
        const previous=this.#tape.transitions.at(-1),result=previous?.oracle.find(r=>r.person===person)?.result;
        return result?{day:previous!.day,status:result.status,won:result.won,prize:result.prize,prizeAmount:result.prizeAmount,fundedBy:result.fundedBy}:null;
      })()}}:{}),
      ...(this.#routine?{routine:this.#routine.observation(this.#state,person,this.#phase,this.#tape.competitiveGrifter===true)}:{}),
      ...(this.#postcards?{postcards:this.#postcards.observation(person)}:{}),
      ...(this.#dailyOracle?{dailyOracle:this.#dailyOracle.observation(person,day,w.economicHealthWithExperience,this.#activePeople())}:{}),
      ownCommitment:this.#phase!=='act'?null:own.role==='Baker'
        ?{kind:'bakerPrice',price:this.#prices.get(own.workplace!)??Number(own.price)}:own.role==='Miller'
          ?{kind:'millerQuantity',quantity:this.#quantities.get(own.workplace!)??0.5}:null,
      oracle:{entryCost:ORACLE_ENTRY_COST,winProbability:oracleWinProbability(w.economicHealthWithExperience),
        canEnter:oracle.lastEnteredDay!==day&&own.wealth>=ORACLE_ENTRY_COST,canRedeem:oracle.lastEnteredDay!==day&&liveVoucher,
        voucherExpiresOnDay:liveVoucher?voucher!.expiresAfterDay:null},
      opportunities:liveVoucher?[{kind:'oracleEntryVoucher',expiresOnDay:voucher!.expiresAfterDay}]:[],
      // Inhabitant posts reach listeners through the kernel's existing rumour propagation
      // and degradation. A global raw feed here would bypass the hearing boundary.
    });
  }
  /** All callers, including deterministic residents and supervised text input, share this
   * validator. Any malformed/unauthorised proposal permanently halts this run before a tick. */
  submit(person:string, value:unknown): void {
    if (this.#halted) throw Error('society_halted');
    try {
      if (!this.pendingPeople().includes(person)) throw new SocietySecurityError('stale_or_duplicate_submission');
      const view=this.view(person), action=typeof value==='string'?parseSocietyResponse(value,view.context):validateSocietyAction(value,view.context);
      if(this.dualNavigation&&action.move){const route=this.#navigation.get(person);if(!route)throw Error('society_navigation_required');assertNavigationRecord(this.#navigationRequest(person,action.move),route);}
      const beforeHash=this.#routine?this.hash:'',beforeTick=this.tick,turn=this.turn;
      const record:SocietyDecisionRecord={day:this.tick+1,phase:this.#phase,person,controlled:this.controlled.includes(person),
        ...(this.dualNavigation?this.decisionEvidence(person):{}),visible:structuredClone(view.visible),legalChoices:structuredClone({menu:view.visible.legalChoices,schema:view.visible.decisionSchema}),action:structuredClone(action),...(turn!==undefined?{turn}:{})};
      if(this.#routine){
        // Stop before admission, leaving enough space for the current round/day book and
        // exact transitions. A storage ceiling never fabricates completion or loses the
        // already admitted prefix. Counters are deterministic functions of recorded data.
        const bytes=Buffer.byteLength(JSON.stringify(record))+4096;
        let nodes=0;const count=(v:unknown):void=>{nodes++;if(v&&typeof v==='object')for(const child of Object.values(v))count(child);};count(record);nodes+=128;
        if(this.#routineEvidenceBytes+bytes>224*1024*1024||this.#routineEvidenceNodes+nodes>18_000_000)
          throw new SocietySecurityError('society_evidence_capacity');
        this.#routineEvidenceBytes+=bytes;this.#routineEvidenceNodes+=nodes;
      }
      this.#postcards?.submit(person,this.tick+1,action.postcards);
      this.#revision++;
      this.#pending.set(person,action);
      if(action.occupation?.kind==='claimRole'){
        if(!this.#roleClaims)throw Error('society_claim_mode');
        this.#roleClaims.push({person,roleEpoch:view.context.roleEpoch,buildingId:action.occupation.buildingId});
      }
      this.#perceptions.delete(person);
      this.#tape.decisions.push(record);
      const turnCount=this.#turnTransitions.length;
      if (this.pendingPeople().length===0) this.#finishPhase();
      if(this.#routine)record.transition={beforeHash,afterHash:this.hash,beforeTick,afterTick:this.tick,effects:this.#turnTransitions.length>turnCount?structuredClone(this.#turnTransitions.at(-1)!.effects):[]};
    } catch (error) { this.halt(); throw error; }
  }
  #finishPhase() {
    if (this.#phase==='commit') {
      for (const [person,a] of this.#pending) {
        const p=this.#state.registry.people.get(person)!;
        if (a.occupation?.kind==='bakerPrice') this.#prices.set(p.location!,a.occupation.price);
        if (a.occupation?.kind==='millerQuantity') this.#quantities.set(p.location!,a.occupation.quantity);
      }
      this.#pending.clear(); this.#phase='act'; this.#beginAct(); return;
    }
    if(this.#routine){
      const beforeHash=this.hash,day=this.tick+1,turn=this.#routine.turn,previous=this.#state;
      const actions=[...this.#pending].map(([person,a])=>({person,epoch:previous.registry.people.get(person)!.roleEpoch,tick:this.tick,
        decision:{move:this.dualNavigation?null:a.move,communication:a.communication,diary:a.diary,role:null}}));
      const result=stepParticipantTurn(previous,actions,turn);this.#state=result.state;
      if(this.dualNavigation){
        for(const [person,action] of this.#pending){if(!action.move)continue;
          const route=this.#navigation.get(person);if(!route)throw Error('society_navigation_required');
          const p=this.#state.registry.people.get(person)!;
          for(const step of route.path){
            const legal=observe(this.#state,person,this.#state.genesis.observerSecret).context.legalMoves;
            if(!legal.some(q=>q.x===step.x&&q.y===step.y))throw Error('society_navigation_illegal_step');
            this.#state.world=applyParticipantMove(this.#state.world,p.role,p.location!,step);
            result.effects.push({person,category:'move'});
          }
        }
        this.#navigation.clear();
      }
      this.#routine.acceptTurn(previous,this.#state,this.#pending,result,this.#tape.competitiveGrifter===true);this.#pending.clear();
      this.#turnTransitions.push({day,turn,beforeHash,afterHash:this.hash,effects:structuredClone(result.effects)});
      if(!this.#routine.allClosed){if(this.#routine.limitReached)this.halt();return;}
      this.#pending=this.#routine.dailyActions();
    }
    const beforeHash=this.hash, day=this.tick+1, oldHealth=this.#state.world.economicHealthWithExperience;
    const escrowBefore=oracleOpportunityEscrow([...this.#oracle.values()]);
    let daily:SocietyDailyOracleTransition|undefined,dailyReceived=0,dailyOverflow=0,paidLotteryCapOverflow=0;
    if(this.#dailyOracle){
      const people=this.#activePeople().map(person=>{const p=this.#state.registry.people.get(person)!,own=personBody(this.#state,p),cap=this.#state.world.config.wealthCap;
        return {person,wealth:own.wealth,...(cap!==undefined&&cap>0&&(p.role==='baker'||p.role==='miller')?{cap}:{})};});
      daily=this.#dailyOracle.settle(day,oldHealth,people,new Map([...this.#pending].map(([p,a])=>[p,a.dailyOracle??null])));
      for(const payout of daily.payouts){const p=this.#state.registry.people.get(payout.person)!,own=personBody(this.#state,p);
        const received=payout.receivedMicro/1_000_000,overflow=payout.capOverflowMicro/1_000_000;
        this.#setHoldings(p.location!,p.role,own.wealth+received);this.#state.world.settlement.districtPool+=overflow;
        dailyReceived+=received;dailyOverflow+=overflow;
      }
    }
    const choices=new Map<string,string|null>(),working=new Set<string>();
    const actions=[...this.#pending].map(([person,a])=>{
      const p=this.#state.registry.people.get(person)!;
      let seller:string|null=null;
      if (a.purchase&&'seller' in a.purchase) {
        const sellerRef=a.purchase.seller;
        const match=[...this.#state.registry.people.values()].find(x=>x.location!==null&&this.#ref(person,x.id)===sellerRef);
        if (!match||match.role!=='baker') throw Error('society_seller_binding');
        seller=match.location;
      }
      choices.set(person,seller);
      if (a.occupation?.kind==='work'&&p.role!==null&&(this.#tape.competitiveGrifter&&this.#routine||['courier','investigator','importExport'].includes(p.role))) working.add(p.location!);
      return {person,epoch:p.roleEpoch,tick:this.tick,decision:{move:a.move,communication:a.communication,diary:a.diary,role:null}};
    });
    const activeAssistance=this.#reputationBackstops?.filter(item=>{const p=this.#state.registry.people.get(item.person);
      return p?.location===item.businessId&&p.role===item.role&&p.roleEpoch===item.roleEpoch;}).map(item=>item.businessId)??[];
    const plan:SocietyEconomyPlan={bakerPrices:this.#prices,millerQuantities:this.#quantities,breadChoices:choices,working,
      ...(this.#tape.competitiveGrifter&&this.#routine?{attendanceRequired:true,assisted:new Set(activeAssistance)}:{})};
    if(this.#routine)this.#state.world={...this.#state.world,pendingWallPosts:this.#routine.posts()};
    const routineSummary=this.#routine?{turns:this.#routine.turn-1,residents:this.#routine.summary()}:undefined;
    const routineEffects=this.#routine?.effects()??[];
    // Claims were admitted before this day's mechanical vacancy processing.
    // Apply them in submission order so an automatic fill cannot overtake them.
    const occupantsBeforeClaims=new Map(this.#state.registry.locations);
    const claimResult=this.#roleClaims?resolveRoleClaims(this.#state,this.#roleClaims,day):undefined;
    const invalidatedOrders=new Set<string>();
    if(claimResult){
      this.#state=claimResult.state;this.#roleClaims=[];
      // The role epoch changes, but other admitted daily actions belong to the
      // same persistent person and were authorized in the previous view.
      for(const action of actions)if(claimResult.outcomes.some(q=>q.person===action.person&&q.status==='claimed'))
        action.epoch=this.#state.registry.people.get(action.person)!.roleEpoch;
      // A departing roleholder's old commitment and work were made for their
      // former workplace, never for its replacement. Orders against a departed
      // seller are recorded as unavailable instead of being silently reassigned.
      const bakers=new Set(this.#state.world.bakers.filter(s=>s.slot.state==='FILLED').map(s=>s.buildingId));
      const millers=new Set(this.#state.world.millers.filter(s=>s.slot.state==='FILLED').map(s=>s.buildingId));
      const occupied=new Set(roleArrays(this.#state.world).flatMap(([,slots])=>slots.filter(s=>s.slot.state==='FILLED').map(s=>s.buildingId)));
      const sameOccupant=(site:string)=>occupantsBeforeClaims.get(site)===this.#state.registry.locations.get(site);
      plan.bakerPrices=new Map([...plan.bakerPrices].filter(([site])=>bakers.has(site)&&sameOccupant(site)));
      plan.millerQuantities=new Map([...plan.millerQuantities].filter(([site])=>millers.has(site)&&sameOccupant(site)));
      plan.working=new Set([...working].filter(site=>occupied.has(site)&&sameOccupant(site)));
      plan.assisted=new Set([...activeAssistance].filter(site=>occupied.has(site)&&sameOccupant(site)));
      for(const [person,site] of choices){
        if(site!==null&&(!bakers.has(site)||!sameOccupant(site)||this.#state.registry.locations.get(site)===person)){
          choices.set(person,null);invalidatedOrders.add(person);
        }
      }
    }
    const beforeOccupants=new Map([...this.#state.registry.people.values()].filter(p=>p.role!==null&&p.location!==null)
      .map(p=>[p.id,{role:p.role,location:p.location,roleEpoch:p.roleEpoch}]));
    const beforeCivic=this.#civicEvents?societyCivicScores(this.#civicEvents,[...beforeOccupants.keys()]):undefined;
    const result=stepParticipantState(this.#state,actions,[...this.#state.registry.locations.values()],plan,this.#routine?.social());
    this.#state=result.state;
    if(this.#routine&&this.#state.world.societyEconomy){
      const failed=new Set([...this.#routine.noBakery(),...invalidatedOrders]);
      for(const receipt of this.#state.world.societyEconomy.receipts)if(failed.has(receipt.customer)&&receipt.bakerSite===null&&receipt.paid===0)receipt.outcome='unavailable';
    }
    const kernelResidual=this.#state.world.lastSettlement.residual;
    const oracleBefore=holdingTotal(this.#state)+accountsTotal(this.#state.world.settlement)+escrowBefore;
    const oracleResults:SocietyTransition['oracle']=[];
    // Expiry applies even when an inhabitant abstains or departs. Nothing waits for a login.
    for (const [person,state] of this.#oracle) {
      const expired=expireOracleOpportunity(state,person,day,this.#state.world.settlement.oraclePool);
      this.#oracle.set(person,expired.state); this.#state.world.settlement={...this.#state.world.settlement,oraclePool:expired.oraclePool};
    }
    for (const [person,a] of this.#pending) {
      const p=this.#state.registry.people.get(person);
      if (!p||p.location===null||!a.oracle) continue;
      const own=personBody(this.#state,p); let draw=0;
      const entry=resolveSocietyOracleEntry({actorId:person,day,mode:a.oracle,economicHealthWithExperience:oldHealth,
        wealth:own.wealth,oraclePool:this.#state.world.settlement.oraclePool,isGrifter:p.role===null,
        ...(p.role===null?{}:{personalResourceStock:own.stock}),state:this.#oracle.get(person)??emptyOracleOpportunityState(),
        rand:()=>hashUnit(this.#state.genesis.seed,day,'society-oracle',person,draw++)});
      this.#oracle.set(person,entry.state);
      this.#state.world.settlement={...this.#state.world.settlement,oraclePool:entry.oraclePool};
      const cap=this.#state.world.config.wealthCap;
      if(this.#dailyOracle&&cap!==undefined&&cap>0&&(p.role==='baker'||p.role==='miller')&&entry.wealth>cap){
        const overflow=entry.wealth-cap;entry.wealth=cap;this.#state.world.settlement.districtPool+=overflow;paidLotteryCapOverflow+=overflow;
      }
      this.#setHoldings(p.location,p.role,entry.wealth,entry.personalResourceStock);
      oracleResults.push({person,result:entry});
    }
    const escrowAfter=oracleOpportunityEscrow([...this.#oracle.values()]);
    const oracleAfter=holdingTotal(this.#state)+accountsTotal(this.#state.world.settlement)+escrowAfter;
    const oracleResidual=oracleAfter-oracleBefore;
    const ledger=this.#state.world.lastSettlement;
    const afterHoldings=holdingTotal(this.#state), afterAccounts=accountsTotal(this.#state.world.settlement)+escrowAfter+(daily?.treasuryAfterMicro??0)/1_000_000;
    const beforeHoldings=ledger.holdingsBefore-dailyReceived,beforeAccounts=ledger.accountsBefore-dailyOverflow+escrowBefore+(daily?.treasuryBeforeMicro??0)/1_000_000;
    const residual=(daily?(afterHoldings+afterAccounts-beforeHoldings-beforeAccounts):
      (afterHoldings+afterAccounts-ledger.holdingsBefore-ledger.accountsBefore-escrowBefore))
      -(totalIssued(ledger.issued)-ledger.emigrantHoldings.reduce((s,x)=>s+x,0));
    if (Math.abs(oracleResidual)>1e-8||Math.abs(residual)>1e-7) throw Error('society_accounting_violation');
    this.#state.world.lastSettlement={...ledger,holdingsBefore:beforeHoldings,holdingsAfter:afterHoldings,accountsBefore:beforeAccounts,accountsAfter:afterAccounts,residual};
    const holdings=[...roleArrays(this.#state.world).flatMap(([,slots])=>slots.filter(s=>s.slot.state==='FILLED').map(s=>s.wealth)),...this.#state.world.grifters.map(g=>g.wealth)];
    this.#state.world.wealthGini=giniCoefficient(holdings);this.#state.world.wealthTop10Share=topShare(holdings,0.1);
    const missedWork=routineSummary?.residents.filter(r=>{
      const prior=beforeOccupants.get(r.person), now=this.#state.registry.people.get(r.person);
      const newlyClaimed=claimResult?.outcomes.some(q=>q.person===r.person&&q.status==='claimed');
      return !newlyClaimed&&r.closed&&!r.tasks.work&&!!prior&&!!now&&now.role===prior.role&&now.location===prior.location&&now.roleEpoch===prior.roleEpoch;
    }).map(r=>r.person)??[];
    const civicEvents=this.#civicEvents?societyCivicEvents(day,this.#state.world.lastDealings??[],this.#state.world.societyEconomy?.receipts??[],new Set(this.#state.registry.people.keys()),missedWork):undefined;
    if(civicEvents)this.#civicEvents!.push(...civicEvents);
    let reputationBackstops:BackstopOutcome|undefined;
    if(this.#reputationBackstops&&this.#routine&&this.#civicEvents&&beforeCivic){
      const afterCivic=societyCivicScores(this.#civicEvents,[...beforeOccupants.keys()]);
      const incumbents:BackstopIncumbent[]=[];
      for(const [person,prior] of beforeOccupants){
        const current=this.#state.registry.people.get(person);
        if(!prior.role||!prior.location||!current||current.role!==prior.role||current.location!==prior.location||current.roleEpoch!==prior.roleEpoch)continue;
        incumbents.push({person,role:prior.role,roleEpoch:prior.roleEpoch,businessId:prior.location,
          standingBefore:beforeCivic.get(person)!.standing,standingAfter:afterCivic.get(person)!.standing});
      }
      reputationBackstops=stepReputationBackstops(this.#reputationBackstops,incumbents,day);
      this.#reputationBackstops=reputationBackstops.active;
      for(const expired of reputationBackstops.expired)this.#state=evictBackstoppedOccupant(this.#state,expired,day);
    }
    this.#wall=this.#routine?this.#routine.posts().map(p=>({author:p.authorId,state:p.state,day})):[...this.#pending].flatMap(([author,a])=>a.communication?.kind==='wallPost'?[{author,state:a.communication.state as SelfState,day}]:[]);
    this.#postcards?.register(this.#activePeople(),this.tick);
    this.#pending.clear();this.#phase='commit';this.#resetCommitments();
    this.#routine?.beginDay(this.#state);
    // An empty competitive cohort still lets mechanical backstops/roleless inhabitants act.
    if (this.pendingPeople().length===0) {this.#phase='act';this.#beginAct();}
    this.#tape.transitions.push({day,beforeHash,afterHash:this.hash,effects:this.#routine?routineEffects:result.effects,
      economy:structuredClone(this.#state.world.societyEconomy),oracle:oracleResults,
      accounting:{kernelResidual,oracleResidual,residual,escrow:escrowAfter},
      conditions:this.#state.world.shard.districts.map(d=>({district:d.id,tension:d.weatherHistory.at(-1)?.tension??0,state:this.#state.world.districtHealth[d.id]!.state})),
      ...(this.#postcards?{postcards:this.#postcards.drain()}:{}),...(routineSummary?{routine:routineSummary}:{}),...(civicEvents?{civicEvents}:{}),...(claimResult?{roleClaims:claimResult.outcomes}:{}),...(reputationBackstops?{reputationBackstops}:{})});
    if(daily)this.#tape.transitions.at(-1)!.dailyOracle={...daily,paidLotteryCapOverflow};
  }
  #setHoldings(location:string,role:keyof typeof publicRole|null,wealth:number,stock?:number) {
    const w=this.#state.world;
    if(role===null){w.grifters=w.grifters.map(g=>g.id===location?{...g,wealth}:g);return;}
    const key=role==='baker'?'bakers':role==='miller'?'millers':role==='courier'?'couriers':role==='investigator'?'investigators':'importExporters';
    // Indexing a union of the economic/support arrays requires preserving each concrete type.
    if(key==='bakers')w.bakers=w.bakers.map(s=>s.buildingId===location?{...s,wealth,...(stock===undefined?{}:{personalResourceStock:stock})}:s);
    else if(key==='millers')w.millers=w.millers.map(s=>s.buildingId===location?{...s,wealth,...(stock===undefined?{}:{personalResourceStock:stock})}:s);
    else w[key]=w[key].map(s=>s.buildingId===location?{...s,wealth,...(stock===undefined?{}:{personalResourceStock:stock})}:s);
  }
}

/** Independent reconstruction uses recorded JSON decisions, never reruns a policy. It also
 * verifies each exact visible context, so hidden observation drift cannot pass as replay. */
export function verifySocietyTape(tape:SocietyTape, expectedSourceRevision=tape.genesis.sourceRevision, options:{allowPartial?:boolean}={}) {
  if(tape.competitiveGrifter!==undefined&&tape.competitiveGrifter!==true)throw Error('society_tape_source');
  if(!['node-society-offline-v1','node-society-postcards-v2','node-society-daily-oracle-v3','node-society-routine-v4'].includes(tape.format)||tape.genesis.sourceRevision!==expectedSourceRevision||
    (tape.format==='node-society-routine-v4')!==!!tape.routineConfig||
    (!tape.routineConfig&&((tape.format==='node-society-daily-oracle-v3')!==!!tape.dailyOracleConfig||
    (tape.format==='node-society-postcards-v2')!==(!tape.dailyOracleConfig&&!!tape.postcardConfig))))throw Error('society_tape_source');
  const society=new Society({seed:tape.genesis.seed,sourceRevision:expectedSourceRevision,config:tape.genesis.config,observerSecret:tape.genesis.observerSecret,
    ...(tape.postcardConfig?{postcards:tape.postcardConfig}:{}),...(tape.dailyOracleConfig?{dailyOracle:tape.dailyOracleConfig}:{}),...(tape.routineConfig?{routine:tape.routineConfig}:{}),...(tape.competitiveGrifter?{competitiveGrifter:true as const}:{})});
  if(society.hash!==tape.genesisHash||digest(society.controlled)!==digest(tape.controlled))throw Error('society_genesis_mismatch');
  for(const record of tape.decisions){
    society.bindEvidence(record.person,record,record.action);
    if(society.tick+1!==record.day||society.phase!==record.phase||digest(society.view(record.person).visible)!==digest(record.visible))throw Error('society_visible_context_mismatch');
    society.submit(record.person,record.action);
  }
  const replay=society.exportTape();
  const complete = replay.decisions.length===0 || replay.decisions.at(-1)!.day===society.tick;
  if((!options.allowPartial&&(!complete||society.phase!=='commit'))||digest(replay)!==digest(tape))throw Error('society_replay_mismatch');
  return {verified:true,ticks:society.tick,decisions:tape.decisions.length,finalHash:society.hash,
    ...(options.allowPartial?{complete}:{})};
}
