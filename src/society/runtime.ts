/** A separate, opt-in society contract over the existing deterministic participant kernel.
 * Policies receive only boundary.visible. No provider, credential, shell or tool dispatcher
 * is imported here. Submitted JSON is data, never evaluated JavaScript.
 */
import { createParticipantState, stepParticipantState, fixtureGenesis, type Genesis, type ParticipantState } from '../agent/participantWorld.js';
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

export type Phase = 'commit' | 'act';
export type SocietyView = ReturnType<typeof buildSocietyContext>['visible'];
export interface SocietyOptions { seed: number; sourceRevision: string; config?: WorldConfig; observerSecret?: string;
  postcards?:SocietyPostcardConfig;dailyOracle?:SocietyDailyOracleConfig }
export interface SocietyDecisionRecord {
  day: number; phase: Phase; person: string; controlled: boolean;
  visible: SocietyView; legalChoices: unknown; action: SocietyAction;
}
export interface SocietyTransition {
  day: number; beforeHash: string; afterHash: string; effects: {person:string;category:string}[];
  economy: unknown; oracle: {person:string;result:SocietyOracleEntryResult}[];
  accounting: {kernelResidual:number;oracleResidual:number;residual:number;escrow:number};
  conditions: {district:string;tension:number;state:string}[];
  postcards?:SocietyPostcardTransition[];
  dailyOracle?:SocietyDailyOracleTransition & {paidLotteryCapOverflow:number};
}
export interface SocietyTape {
  format: 'node-society-offline-v1'|'node-society-postcards-v2'|'node-society-daily-oracle-v3'; genesis: Genesis; controlled: string[];
  genesisHash: string; decisions: SocietyDecisionRecord[]; transitions: SocietyTransition[];
  postcardConfig?:SocietyPostcardConfig; postcardAccounts?:[string,PostcardAccount][];
  dailyOracleConfig?:SocietyDailyOracleConfig;dailyOracleState?:ReturnType<SocietyDailyOracleBook['snapshot']>;
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
  #pending = new Map<string,SocietyAction>();
  #prices = new Map<string,number>();
  #quantities = new Map<string,number>();
  #oracle = new Map<string,OracleOpportunityState>();
  #wall: {author:string;state:SelfState;day:number}[] = [];
  #tape: SocietyTape;
  #postcards?:SocietyPostcardBook;
  #dailyOracle?:SocietyDailyOracleBook;
  constructor(options: SocietyOptions) {
    const genesis = fixtureGenesis(options.seed, options.config ?? societyConfig());
    genesis.namespace = 'society-inhabitant'; genesis.sourceRevision = options.sourceRevision;
    if (options.observerSecret) genesis.observerSecret = options.observerSecret;
    if (genesis.config.recognition !== 'v2' || genesis.config.settlement === 'legacy') throw Error('society_requires_recognition_v2_funded_settlement');
    this.#state = createParticipantState(genesis);
    const controlled = [...this.#state.registry.people.values()].filter(p=>p.role==='baker'||p.role==='miller').map(p=>p.id);
    if (controlled.length !== 3 || genesis.config.rBaker !== 2 || genesis.config.rMiller !== 1) throw Error('society_initial_two_bakers_one_miller_required');
    if(options.postcards)this.#postcards=new SocietyPostcardBook(options.postcards,genesis.seed,this.#activePeople());
    if(options.dailyOracle)this.#dailyOracle=new SocietyDailyOracleBook(options.dailyOracle,genesis.seed);
    this.#resetCommitments();
    this.#tape = {format:this.#dailyOracle?'node-society-daily-oracle-v3':this.#postcards?'node-society-postcards-v2':'node-society-offline-v1',genesis:structuredClone(genesis),controlled,
      genesisHash:this.hash,decisions:[],transitions:[],...(this.#postcards?{postcardConfig:structuredClone(this.#postcards.config)}:{}),
      ...(this.#dailyOracle?{dailyOracleConfig:structuredClone(this.#dailyOracle.config)}:{})};
  }
  get tick() { return this.#state.world.tick; }
  get phase() { return this.#phase; }
  get halted() { return this.#halted; }
  get revision() { return this.#revision; }
  /** External transport/accounting failures revoke further execution, without a retry. */
  halt(): void { if (!this.#halted) { this.#halted=true; this.#revision++; } }
  get hash() { const original=[evidenceHash(this.#state),[...this.#oracle],this.#phase,[...this.#prices],[...this.#quantities],this.#wall];
    const cards=this.#postcards?[...original,this.#postcards.config,this.#postcards.exportAccounts()]:original;
    return digest(this.#dailyOracle?[...cards,this.#dailyOracle.config,this.#dailyOracle.snapshot()]:cards); }
  get controlled() { return [...this.#tape.controlled]; }
  /** Researcher-only read. This must never be passed to a policy or provider. */
  inspect(): ParticipantState { return {...this.#state,world:structuredClone({...this.#state.world,rng:undefined}),registry:structuredClone(this.#state.registry),genesis:structuredClone(this.#state.genesis)} as unknown as ParticipantState; }
  exportTape(): SocietyTape { return {...structuredClone(this.#tape),...(this.#postcards?{postcardAccounts:this.#postcards.exportAccounts()}:{}),
    ...(this.#dailyOracle?{dailyOracleState:this.#dailyOracle.snapshot()}:{})}; }
  #activePeople():string[] {return [...this.#state.registry.people.values()].filter(p=>p.location!==null).map(p=>p.id);}
  #beginAct():void {this.#postcards?.beginAct(this.#activePeople(),this.tick+1);}
  pendingPeople(): string[] {
    if (this.#halted) throw Error('society_halted');
    return [...this.#state.registry.people.values()].filter(p=>p.location!==null &&
      (this.#phase==='act'||p.role==='baker'||p.role==='miller')&&!this.#pending.has(p.id)).map(p=>p.id);
  }
  #resetCommitments() {
    this.#prices = new Map(this.#state.world.bakers.filter(x=>x.slot.state==='FILLED').map(x=>[x.buildingId,x.value]));
    this.#quantities = new Map(this.#state.world.millers.filter(x=>x.slot.state==='FILLED').map(x=>[x.buildingId,x.value]));
  }
  #ref(observer:string,person:string) { return observerRef(this.#state.genesis.observerSecret,observer,person,refHexLength(this.#state.world)); }
  view(person: string) {
    if (this.#halted || !this.pendingPeople().includes(person)) throw Error('society_no_current_observation');
    const w = this.#state.world, own = personBody(this.#state,this.#state.registry.people.get(person)!);
    const oracle = this.#oracle.get(person) ?? emptyOracleOpportunityState(), day=w.tick+1;
    const voucher=oracle.voucher, liveVoucher=!!voucher&&day>=voucher.availableDay&&day<=voucher.expiresAfterDay;
    const market=w.bakers.filter(b=>b.slot.state==='FILLED').map(b=>({
      sellerRef:this.#ref(person,this.#state.registry.locations.get(b.buildingId)!),buildingId:b.buildingId,
      price:this.#prices.get(b.buildingId)??b.value,available:true,
    }));
    return buildSocietyContext(this.#state,person,{
      phase:this.#phase,market,purchaseDue:societyPurchaseDue(w.seed,day,person,w.config.purchaseCycleDays),
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
      this.#postcards?.submit(person,this.tick+1,action.postcards);
      this.#revision++;
      this.#pending.set(person,action);
      this.#tape.decisions.push({day:this.tick+1,phase:this.#phase,person,controlled:this.controlled.includes(person),
        visible:structuredClone(view.visible),legalChoices:structuredClone({menu:view.visible.legalChoices,schema:view.visible.decisionSchema}),action:structuredClone(action)});
      if (this.pendingPeople().length===0) this.#finishPhase();
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
      if (a.purchase) {
        const match=[...this.#state.registry.people.values()].find(x=>x.location!==null&&this.#ref(person,x.id)===a.purchase!.seller);
        if (!match||match.role!=='baker') throw Error('society_seller_binding');
        seller=match.location;
      }
      choices.set(person,seller);
      if (a.occupation?.kind==='work') working.add(p.location!);
      return {person,epoch:p.roleEpoch,tick:this.tick,decision:{move:a.move,communication:a.communication,diary:a.diary,role:null}};
    });
    const plan:SocietyEconomyPlan={bakerPrices:this.#prices,millerQuantities:this.#quantities,breadChoices:choices,working};
    const result=stepParticipantState(this.#state,actions,[...this.#state.registry.locations.values()],plan);
    this.#state=result.state;
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
    this.#wall=[...this.#pending].flatMap(([author,a])=>a.communication?.kind==='wallPost'?[{author,state:a.communication.state as SelfState,day}]:[]);
    this.#postcards?.register(this.#activePeople(),this.tick);
    this.#pending.clear();this.#phase='commit';this.#resetCommitments();
    // An empty competitive cohort still lets mechanical backstops/roleless inhabitants act.
    if (this.pendingPeople().length===0) {this.#phase='act';this.#beginAct();}
    this.#tape.transitions.push({day,beforeHash,afterHash:this.hash,effects:result.effects,
      economy:structuredClone(this.#state.world.societyEconomy),oracle:oracleResults,
      accounting:{kernelResidual,oracleResidual,residual,escrow:escrowAfter},
      conditions:this.#state.world.shard.districts.map(d=>({district:d.id,tension:d.weatherHistory.at(-1)?.tension??0,state:this.#state.world.districtHealth[d.id]!.state})),
      ...(this.#postcards?{postcards:this.#postcards.drain()}:{})});
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
  if(!['node-society-offline-v1','node-society-postcards-v2','node-society-daily-oracle-v3'].includes(tape.format)||tape.genesis.sourceRevision!==expectedSourceRevision||
    (tape.format==='node-society-daily-oracle-v3')!==!!tape.dailyOracleConfig||
    (tape.format==='node-society-postcards-v2')!==(!tape.dailyOracleConfig&&!!tape.postcardConfig))throw Error('society_tape_source');
  const society=new Society({seed:tape.genesis.seed,sourceRevision:expectedSourceRevision,config:tape.genesis.config,observerSecret:tape.genesis.observerSecret,
    ...(tape.postcardConfig?{postcards:tape.postcardConfig}:{}),...(tape.dailyOracleConfig?{dailyOracle:tape.dailyOracleConfig}:{})});
  if(society.hash!==tape.genesisHash||digest(society.controlled)!==digest(tape.controlled))throw Error('society_genesis_mismatch');
  for(const record of tape.decisions){
    if(society.tick+1!==record.day||society.phase!==record.phase||digest(society.view(record.person).visible)!==digest(record.visible))throw Error('society_visible_context_mismatch');
    society.submit(record.person,record.action);
  }
  const replay=society.exportTape();
  const complete = replay.decisions.length===0 || replay.decisions.at(-1)!.day===society.tick;
  if((!options.allowPartial&&(!complete||society.phase!=='commit'))||digest(replay)!==digest(tape))throw Error('society_replay_mismatch');
  return {verified:true,ticks:society.tick,decisions:tape.decisions.length,finalHash:society.hash,
    ...(options.allowPartial?{complete}:{})};
}
