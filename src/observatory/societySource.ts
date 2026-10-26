/** Researcher adapter for the actual Society tape. Replay never runs a policy or sender. */
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {Society,verifySocietyTape,type SocietyTape} from '../society/runtime.js';
import {buildSocietyResultsReport,readSocietyResults,type SocietyReportInput} from '../society/report.js';
import {parseSocietyEvidence} from '../society/codec.js';
import {digest} from '../agent/replay.js';
import {projectWorld} from './worldProjection.js';
import type {ManualTickGate} from '../society/manualTicks.js';
import {validateSocietyWire} from '../../scripts/society-request-worker.js';
import {personBody} from '../server/observer.js';

export interface SocietyRegistration {id:string;directory:string;mode:'live'|'synthetic';kind:'society'}
export interface SocietyObservationInput extends SocietyReportInput {tape:SocietyTape;status?:string;accounting?:unknown}
interface Active {
  read:()=>SocietyObservationInput;
  gate?:ManualTickGate;
  stop:()=>void;
}
type State=ReturnType<Society['inspect']>;
interface Frame {cursor:string;sourceTick:number;worldHash:string;type:string;state:State;throughDay:number;throughDecisions:number;sourceTurn?:number;latest?:boolean}
export class SocietyObservatorySource {
  #frames:Frame[]=[];#input!:SocietyObservationInput;#fingerprint='';
  #report!:ReturnType<typeof buildSocietyResultsReport>;
  #control:ManualTickGate['state']|null=null;
  constructor(readonly registration:SocietyRegistration,readonly active?:Active){
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(registration.id))throw Error('society_observatory_registration');
  }
  refresh(){
    try{
      let input:SocietyObservationInput;
      if(this.active)input=this.active.read();
      else{
        const file=join(this.registration.directory,'society.json'),stat=lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error('society_observatory_tape_bounds');
        const eventsFile=join(this.registration.directory,'events.jsonl'),eventStat=lstatSync(eventsFile);
        if(!eventStat.isFile()||eventStat.isSymbolicLink()||eventStat.size>128*1024*1024)throw Error('society_observatory_events_bounds');
        const tape=parseSocietyEvidence<SocietyTape>(readFileSync(file,'utf8'));
        const report=readSocietyResults(this.registration.directory);
        input={tape,eventsText:readFileSync(eventsFile,'utf8'),summary:report.summary,
          errors:report.recordedErrors,runStart:report.runStart,finalization:report.finalization,status:'recorded'};
      }
      const control=this.active?.gate?.state??null,fingerprint=digest([input,control]);
      if(fingerprint===this.#fingerprint)return true;
      verifySocietyTape(input.tape,input.tape.genesis.sourceRevision,{allowPartial:true});
      const tape=input.tape,s=new Society({seed:tape.genesis.seed,sourceRevision:tape.genesis.sourceRevision,
        config:tape.genesis.config,observerSecret:tape.genesis.observerSecret,
        ...(tape.postcardConfig?{postcards:tape.postcardConfig}:{}),...(tape.dailyOracleConfig?{dailyOracle:tape.dailyOracleConfig}:{}),...(tape.routineConfig?{routine:tape.routineConfig}:{})});
      const frames:Frame[]=[];
      let throughDecisions=0;
      const frame=(type:string,throughDay:number,suffix='',latest=false)=>frames.push({cursor:`day-${s.tick}-${s.hash}${suffix}`,
        sourceTick:s.tick,worldHash:s.hash,type,state:s.inspect(),throughDay,throughDecisions,...(tape.routineConfig?{sourceTurn:s.turn}:{}),...(latest?{latest:true}:{})});
      frame('genesis',0);
      for(const decision of tape.decisions){const before=s.tick,beforeTurn=s.turn,beforePhase=s.phase;s.submit(decision.person,decision.action);throughDecisions++;
        if(s.tick!==before)frame('day_committed',s.tick);
        else if(tape.routineConfig&&(s.turn!==beforeTurn||s.phase!==beforePhase))frame('turn_committed',decision.day,`-turn-${s.turn}`);}
      if(this.active||tape.decisions.at(-1)?.day!==s.tick&&tape.decisions.length)
        frame(control?.waitingDay?'awaiting_manual_tick':'recorded_prefix',s.tick+1,'-latest',true);
      if(this.active)frames.at(-1)!.cursor='live';
      const report=buildSocietyResultsReport(input);
      // A shape-valid request is still unauthorised if its claimed observation differs
      // from the replayed view. Missing archives/summaries are honest partial evidence;
      // contradictory evidence cannot be labelled replay_verified or keep a live run going.
      if(report.integrityIssues.some(i=>i.code==='event_unreadable'||i.code.endsWith('_conflict')||
        ['tape_shape','request_digest_mismatch','request_archive_mismatch','response_archive_mismatch','admitted_action_mismatch'].includes(i.code)))
        throw Error('society_observatory_evidence_boundary');
      for(const r of [...report.agents.flatMap(a=>a.records),...report.unassignedRecords])
        if(r.request.body!==null){
          validateSocietyWire(Buffer.from(r.request.body),r.request.recordedSha256??r.request.actualSha256!);
          if(this.active&&r.admission!=='recorded_in_tape'&&r.visible!==null){
            if(!r.person||!s.pendingPeople().includes(r.person)||digest(s.view(r.person).visible)!==digest(r.visible))
              throw Error('society_observatory_unbound_observation');
          }
        }
      this.#input=structuredClone(input);this.#report=report;this.#control=control;
      this.#frames=frames;this.#fingerprint=fingerprint;return true;
    }catch(error){this.active?.stop();throw error;}
  }
  get latestCursor(){return this.#frames.at(-1)?.cursor??null;}
  get revision(){return this.#fingerprint;}
  has(cursor:string){return this.#frames.some(f=>f.cursor===cursor);}
  list(){return this.#frames.map((f,seq)=>({cursor:f.cursor,sourceTick:f.sourceTick,type:f.type,seq,eventHash:f.worldHash,segmentId:this.#input.tape.genesisHash,...(f.sourceTurn===undefined?{}:{sourceTurn:f.sourceTurn})}));}
  point(cursor:string|null=null){const p=cursor===null?this.#frames.at(-1):this.#frames.find(f=>f.cursor===cursor);if(!p)throw Error('observatory_cursor_unknown');return p;}
  configuration(){const start=this.#input.eventsText.split(/\r?\n/).filter(Boolean).map(line=>parseSocietyEvidence<any>(line)).find(e=>e.kind==='start');return start?.data.plan??null;}
  advance(cursor:unknown,expectedDay:unknown,version:unknown){
    if(typeof cursor!=='string'||cursor!==this.latestCursor||!this.active?.gate)throw Error('society_observatory_read_only');
    const state=this.active.gate.state,day=state.waitingDay;
    if(day===null||day!==expectedDay||state.version!==version)throw Error('society_tick_not_waiting');this.active.gate.advance(day);this.refresh();
    return {accepted:true,day};
  }
  stop(){if(!this.active)throw Error('society_observatory_read_only');this.active.stop();return {stopped:true};}
  snapshot(cursor:string|null,secret:string,researcher:boolean){
    const p=this.point(cursor),input=this.#input,tape=input.tape,projected=projectWorld(p.state,secret);
    const meta={schema:'node-observatory-society-v1',experimentId:this.registration.id,segmentId:tape.genesisHash,
      sourceRunId:this.registration.id,sourceRevision:tape.genesis.sourceRevision,genesisSourceRevision:tape.genesis.sourceRevision,
      cursor:p.cursor,eventHash:p.worldHash,sourceTick:p.sourceTick,worldHash:p.worldHash,segmentRoot:null,
      mode:this.registration.mode,status:input.status??'recorded',verification:'replay_verified',following:cursor===null,
      synthetic:this.registration.mode!=='live',providerReasoning:this.registration.mode==='live'?'provider_returned':'synthetic_test_only',
      ...(p.sourceTurn===undefined?{}:{sourceTurn:p.sourceTurn})};
    const result={...meta,hello:{...projected.hello,...meta,type:'hello'},frame:{...projected.frame,...meta,type:'tick'}};
    if(!researcher)return result;
    const prefix=tape.decisions.slice(0,p.throughDecisions);
    const records=this.#report.agents.flatMap(a=>a.records).filter(r=>r.day!==null&&r.day<=p.throughDay&&
      (!tape.routineConfig||p.latest||prefix.some(d=>d.person===r.person&&d.day===r.day&&d.phase===r.phase&&(d.visible as any).routine?.turn===r.turn)));
    const modelCalls=records.map(r=>{
      const parsed=r.response.parsed as any,usage=parsed?.receipt?.usage;
      const transition=r.worldTransition&&r.worldTransition.day<=p.sourceTick?r.worldTransition:null;
      const recordedTransition=r.turn===undefined?transition:{submission:r.decisionTransition??null,turn:r.turnTransition??null,daily:transition};
      return {requestId:r.requestId??`tape-${r.person}-${r.day}-${r.phase}${r.turn===undefined?'':`-${r.turn}`}`,actorId:r.person!,tick:r.day!,phase:r.phase,...(r.turn===undefined?{}:{turn:r.turn}),
        observation:r.visible??r.authorizedVisible,legalChoices:r.legalChoices,reasoning:r.reasoning,
        latencyMs:(r.events.find(e=>e.kind==='response')?.data as any)?.elapsedMs??null,
        proposal:r.proposedAction,admitted:r.submittedAction??r.validatedAction,executed:r.admission==='recorded_in_tape',
        nextTick:transition?.day??null,effects:[],usage:usage?{...usage,bookedMicroUsd:null}:null,heldMicroUsd:0,
        transition:recordedTransition,rawRecord:transition===r.worldTransition?r:{...r,worldTransition:null,transitionStatus:'not_recorded'}};
    });
    const autonomous=(tape.routineConfig?prefix:tape.decisions).filter(d=>!d.controlled&&d.day<=p.throughDay).map(d=>({
      requestId:`policy-${d.person}-${d.day}-${d.phase}${(d.visible as any).routine?`-${(d.visible as any).routine.turn}`:''}`,actorId:d.person,tick:d.day,phase:d.phase,...((d.visible as any).routine?{turn:(d.visible as any).routine.turn}:{}),observation:d.visible,
      legalChoices:d.legalChoices,reasoning:{source:'deterministic_policy',status:'not_a_model',summaries:[]},
      latencyMs:null,proposal:d.action,admitted:d.action,executed:true,nextTick:tape.transitions.some(t=>t.day===d.day&&t.day<=p.sourceTick)?d.day:null,
      effects:[],usage:null,heldMicroUsd:0,transition:d.turn===undefined?tape.transitions.find(t=>t.day===d.day&&t.day<=p.sourceTick)??null:
        {submission:d.transition??null,turn:tape.turnTransitions?.find(t=>t.day===d.day&&t.turn===d.turn)??null,daily:tape.transitions.find(t=>t.day===d.day&&t.day<=p.sourceTick)??null},rawRecord:d}));
    const calls=[...modelCalls,...autonomous].sort((a,b)=>a.tick-b.tick||(a.phase==='commit'?0:1)-(b.phase==='commit'?0:1)||((a as any).turn??0)-((b as any).turn??0));
    const control=this.#control;
    return {...result,evidenceRevision:this.#fingerprint,phase:'execution',calls,timeline:this.list().slice(0,this.#frames.indexOf(p)+1),
      control:{manual:!!this.active?.gate,waitingDay:control?.waitingDay??null,version:control?.version??null,
        canStop:cursor===null&&!!this.active&&!control?.closed&&input.status!=='completed'&&input.status!=='stopped',
        canAdvance:cursor===null&&p.cursor===this.latestCursor&&control?.waitingDay!==null&&control?.waitingDay!==undefined&&!control.closed,
        replayOnly:!this.active},
      society:{controlled:tape.controlled,people:[...p.state.registry.people.values()].filter(q=>q.location!==null).map(q=>{
        const body=personBody(p.state,q);return {person:q.id,role:q.role,location:q.location,x:body.x,y:body.y,wealth:body.wealth};}),
        conditions:tape.transitions.find(t=>t.day===p.sourceTick)?.conditions??[],
        transition:tape.transitions.find(t=>t.day===p.sourceTick)??null,recordedErrors:this.#report.recordedErrors,integrityIssues:this.#report.integrityIssues},
      telemetry:{callAttemptCount:records.filter(r=>r.request.body!==null).length,executedDecisionCount:calls.filter(c=>c.executed).length,
        completedTickCount:p.sourceTick,inputTokens:calls.reduce((n,c)=>n+(c.usage?.inputTokens??0),0),
        bookedMicroUsd:null,heldMicroUsd:null,basis:'receipt_totals_not_recomputed_use_accounting_snapshot',qualityEvaluation:'not_evaluated'},
      accounting:input.accounting??{status:'not_registered',bookedMicroUsd:null,heldMicroUsd:null}};
  }
}
