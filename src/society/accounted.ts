/** Accounted society controller. A sender is injected only after separately verified owner
 * approval. This module never creates/carries/resets an allowance or opens a provider client. */
import { sha256 } from '../agent/accountingStore.js';
import { usageCost } from '../agent/accountingLedger.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { PRICED_MODELS } from '../agent/modelPricing.js';
import type { ExperimentBudget } from '../agent/experimentBudget.js';
import type { Sender } from '../eval/accountedRunner.js';
import { digest } from '../agent/replay.js';
import { SocietySecurityError, validateSocietyAction } from './boundary.js';
import { buildSocietyRequest } from './request.js';
import { autonomousPolicy } from './policy.js';
import type { Society } from './runtime.js';

export interface SocietyRunPlan {
  schema: 'node-accounted-society-v1'; id: string; model: 'claude-haiku-5-5';
  ticks: number; maxCalls: number; deadlineMs: number; minIntervalMs: number;
  initialHash: string; sourceRevision: string; controlled: string[];
  allowance: { maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number };
}
export const societyPlanHash = (p: SocietyRunPlan) => sha256(JSON.stringify(p));
export function createSocietyPlan(society: Society, options: { id?: string; ticks?: number; deadlineMs?: number;
  minIntervalMs?: number; limitMicroUsd?: number; perRequestMicroUsd?: number } = {}): SocietyRunPlan {
  const ticks = options.ticks ?? 3;
  const plan: SocietyRunPlan = { schema: 'node-accounted-society-v1', id: options.id ?? 'supervised-three-inhabitant-society',
    model: 'claude-haiku-5-5', ticks, maxCalls: ticks * 6, deadlineMs: options.deadlineMs ?? 20_000,
    minIntervalMs: options.minIntervalMs ?? 1000, initialHash: society.hash,
    sourceRevision: society.inspect().genesis.sourceRevision, controlled: society.controlled,
    allowance: { maxRequests: ticks * 6, limitMicroUsd: options.limitMicroUsd ?? 1_000_000,
      perRequestMicroUsd: options.perRequestMicroUsd ?? 20_000 } };
  validateSocietyPlan(plan); return structuredClone(plan);
}
export function validateSocietyPlan(p: SocietyRunPlan): void {
  if (p?.schema !== 'node-accounted-society-v1' || typeof p.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(p.id) ||
    p.model !== 'claude-haiku-5-5' || !Number.isSafeInteger(p.ticks) || p.ticks < 1 || p.ticks > 20 || p.maxCalls !== 6 * p.ticks ||
    !Number.isSafeInteger(p.deadlineMs) || p.deadlineMs < 1 || p.deadlineMs > 20_000 ||
    !Number.isSafeInteger(p.minIntervalMs) || p.minIntervalMs < 0 || p.minIntervalMs > 60_000 ||
    !/^[a-f0-9]{64}$/.test(p.initialHash) || typeof p.sourceRevision !== 'string' || !p.sourceRevision ||
    !Array.isArray(p.controlled) || p.controlled.length !== 3 || new Set(p.controlled).size !== 3 ||
    !p.controlled.every(v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v)) ||
    p.allowance?.maxRequests !== p.maxCalls || !Number.isSafeInteger(p.allowance.limitMicroUsd) || p.allowance.limitMicroUsd < 1 || p.allowance.limitMicroUsd > 1_000_000 ||
    !Number.isSafeInteger(p.allowance.perRequestMicroUsd) || p.allowance.perRequestMicroUsd < 1 || p.allowance.perRequestMicroUsd > p.allowance.limitMicroUsd)
    throw new SocietySecurityError('society_paid_plan');
}

/** All events are operator-private evidence, never an inhabitant message. A synchronous sink
 * must persist the exact request before dispatch and response before admitted world action. */
export interface SocietyCallBinding { requestId:string; index:number; episodeId:string; actorId:string; tick:number; phase:'commit'|'act' }
export type SocietyCallStage = 'prepared'|'reserved'|'dispatched'|'received'|'validated'|'submitted';
export type SocietyCallStatus = 'submitted'|'cancelled'|'transport_failed'|'usage_unknown'|'model_mismatch'|'response_rejected'|'illegal_action'|
  'booking_failed'|'stale_response'|'usage_overrun'|'budget_stopped'|'execution_failed'|'evidence_failed';
export interface SocietyCallOutcome extends SocietyCallBinding {
  status:SocietyCallStatus; reason:string|null; stage:SocietyCallStage; requestBooked:boolean|null;
  beforeHash:string; afterHash:string; beforeTick:number; afterTick:number;
}
export interface SocietyRunEvent { kind: 'start' | 'request' | 'reserved' | 'dispatched' | 'response' | 'decision' | 'outcome' | 'finish'; data: unknown }
export interface AccountedSocietyOptions {
  plan: SocietyRunPlan; ownerApproved: boolean; instruction: string; expectedCarriedFingerprint: string;
  sink: (event: SocietyRunEvent) => void; signal?: AbortSignal;
}
export interface AccountedSocietySummary {
  status: 'completed' | 'stopped'; stoppedReason: string | null; calls: number; ticks: number;
  startTick: number; finalTick: number; planSha256: string; runId: string;
  bookedMicroUsd: string; heldMicroUsd: string; budgetHistoryHash: string; finalHash: string;
}
const running = new WeakSet<Society>();
const message = (error: unknown, fallback: string) => error instanceof Error && /^[A-Za-z0-9_:.-]{1,128}$/.test(error.message) ? error.message : fallback;

/** Pacing cancellation does not wait out the remaining interval or reserve another call. */
function pacedWait(ms:number,signal?:AbortSignal):Promise<void> {
  return new Promise(resolve=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const done=()=>{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    if(signal?.aborted){resolve();return;}
    signal?.addEventListener('abort',done,{once:true});timer=setTimeout(done,ms);
  });
}

export async function runAccountedSociety(society: Society, budget: ExperimentBudget, send: Sender,
  options: AccountedSocietyOptions): Promise<AccountedSocietySummary> {
  // Snapshot the reviewed plan before any sender/evidence callback can mutate caller data.
  const plan = structuredClone(options.plan); validateSocietyPlan(plan);
  if (options.ownerApproved !== true || typeof options.instruction !== 'string' || !options.instruction.trim() ||
    options.instruction.length > 8192 || typeof options.sink !== 'function') throw new SocietySecurityError('society_owner_approval_required');
  const start = budget.view(), auth = start.authorization;
  if (society.halted || society.tick !== 0 || society.phase !== 'commit' || society.exportTape().decisions.length || running.has(society) ||
    society.hash !== plan.initialHash || society.inspect().genesis.sourceRevision !== plan.sourceRevision || digest(society.controlled) !== digest(plan.controlled))
    throw new SocietySecurityError('society_paid_initial_state');
  if (!auth || !start.canReserve || start.requests.length || !/^[a-f0-9]{64}$/.test(options.expectedCarriedFingerprint) ||
    budget.carriedFingerprint() !== options.expectedCarriedFingerprint || auth.expectedCarriedFingerprint !== options.expectedCarriedFingerprint ||
    auth.instruction !== options.instruction || auth.manifestSha256 !== societyPlanHash(plan) || auth.model !== plan.model ||
    auth.maxRequests !== plan.maxCalls || auth.limitMicroUsd !== plan.allowance.limitMicroUsd || auth.perRequestMicroUsd !== plan.allowance.perRequestMicroUsd ||
    digest(auth.prices) !== digest(PRICED_MODELS[plan.model])) throw new SocietySecurityError('society_paid_allowance');
  const undeliveredEvents:SocietyRunEvent[]=[],results:SocietyCallOutcome[]=[];
  const emit=(event:SocietyRunEvent)=>{
    const detached=structuredClone(event);
    try{options.sink(detached);}catch(error){undeliveredEvents.push(structuredClone(event));throw error;}
  };
  running.add(society);
  let calls=0,stoppedReason:string|null=null,lastDispatch=-Infinity;
  let active:{binding:SocietyCallBinding;stage:SocietyCallStage;beforeHash:string;beforeTick:number;finished:boolean}|null=null;
  const halt=(reason:string)=>{stoppedReason??=reason;society.halt();};
  const outcome=(status:SocietyCallStatus,reason:string|null)=>{
    if(!active||active.finished)return;
    let requestBooked:boolean|null=null;
    try{const request=budget.view().requests.find(q=>q.request.id===active!.binding.requestId);requestBooked=request?request.bookedMicroUsd!==null:false;}catch{/* Explicitly unknown, never invent a balance. */}
    const result:SocietyCallOutcome={...active.binding,status,reason,stage:active.stage,requestBooked,
      beforeHash:active.beforeHash,afterHash:society.hash,beforeTick:active.beforeTick,afterTick:society.tick};
    active.finished=true;results.push(result);emit({kind:'outcome',data:result});
  };
  const stop=(status:SocietyCallStatus,reason:string)=>{halt(reason);outcome(status,reason);};
  try{
    emit({kind:'start',data:{plan,planSha256:societyPlanHash(plan),runId:auth.runId,
      budgetHistoryHash:start.historyHash,carriedFingerprint:options.expectedCarriedFingerprint}});
    while(society.tick<plan.ticks&&!stoppedReason){
      if(options.signal?.aborted){halt('society_cancelled');break;}
      const people=society.pendingPeople();
      if(!people.length){halt('society_no_pending_people');break;}
      for(const person of people){
        active=null;
        if(options.signal?.aborted){halt('society_cancelled');break;}
        const revision=society.revision,view=society.view(person);
        if(!plan.controlled.includes(person)){
          const action=autonomousPolicy(view.visible);
          if(options.signal?.aborted){halt('society_cancelled');break;}
          society.submit(person,action);continue;
        }
        if(calls>=plan.maxCalls){halt('society_call_limit');break;}
        const wire=buildSocietyRequest(view.visible,plan.model),current=budget.view();
        const ceiling=usageCost(wire.maxInputTokens,wire.maxOutputTokens,auth.prices);
        if(!current.canReserve||ceiling>auth.perRequestMicroUsd||BigInt(ceiling)>current.remainingMicroUsd!){halt('society_budget_stopped');break;}
        const phase:'commit'|'act'=society.phase,tick:number=society.tick,episodeId=`${plan.id}:${phase}`;
        const requestId=sha256(JSON.stringify([auth.runId,episodeId,person,tick,wire.sha256]));
        const binding:SocietyCallBinding={requestId,index:calls,episodeId,actorId:person,tick,phase};
        active={binding,stage:'prepared',beforeHash:society.hash,beforeTick:tick,finished:false};
        const currentLease=()=>!society.halted&&society.revision===revision&&society.tick===tick&&society.phase===phase&&society.pendingPeople().includes(person);
        const sent={...binding,body:wire.body,sha256:wire.sha256,provider:'anthropic' as const};
        emit({kind:'request',data:{...sent,maxInputTokens:wire.maxInputTokens,maxOutputTokens:wire.maxOutputTokens}});
        const wait=lastDispatch+plan.minIntervalMs-performance.now();
        if(wait>0)await pacedWait(wait,options.signal);
        if(options.signal?.aborted){stop('cancelled','society_cancelled');break;}
        if(!currentLease()){stop('stale_response','society_stale_before_reservation');break;}
        const participant={tick,selfRef:view.context.selfRef,role:view.context.role,roleEpoch:view.context.roleEpoch};
        if(budget.reserve({id:requestId,episodeId,actorId:person,inputSha256:wire.sha256,participant,
          model:plan.model,maxInputTokens:wire.maxInputTokens,maxOutputTokens:wire.maxOutputTokens})!=='reserved')throw new SocietySecurityError('society_request_consumed');
        active.stage='reserved';emit({kind:'reserved',data:{...binding,participant,ceilingMicroUsd:ceiling}});
        if(options.signal?.aborted){stop('cancelled','society_cancelled');break;}
        if(!currentLease()){stop('stale_response','society_stale_before_dispatch');break;}
        emit({kind:'dispatched',data:{...binding,runtimeRevision:revision}});
        if(options.signal?.aborted){stop('cancelled','society_cancelled');break;}
        if(!currentLease()){stop('stale_response','society_stale_before_dispatch');break;}
        active.stage='dispatched';calls++;lastDispatch=performance.now();
        const abort=new AbortController(),cancelled=()=>abort.abort();
        options.signal?.addEventListener('abort',cancelled,{once:true});
        let timer:ReturnType<typeof setTimeout>|undefined,cancelTurn:ReturnType<typeof setImmediate>|undefined,bytes:Buffer;
        const begun=performance.now();
        // Install cancellation before invoking the trusted sender. A same-turn usable
        // response wins over the deferred cancellation, so its known usage can be booked.
        const cancellation=new Promise<never>((_,reject)=>{
          abort.signal.addEventListener('abort',()=>{cancelTurn=setImmediate(()=>reject(new Error('society_cancelled')));},{once:true});
        });
        try{
          const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('society_provider_deadline'));},plan.deadlineMs);});
          bytes=await Promise.race([send(sent,abort.signal),deadline,cancellation]);
        }catch(error){
          const reason=options.signal?.aborted?'society_cancelled':message(error,'society_transport_failed');
          stop(options.signal?.aborted?'cancelled':'transport_failed',reason);break;
        }finally{
          if(timer)clearTimeout(timer);if(cancelTurn)clearImmediate(cancelTurn);options.signal?.removeEventListener('abort',cancelled);
        }
        active.stage='received';const elapsedMs=performance.now()-begun;
        let parsed:ReturnType<typeof parseAnthropicResponse>;
        try{parsed=parseAnthropicResponse(bytes,requestId);}catch{
          emit({kind:'response',data:{...binding,rawBase64:Buffer.isBuffer(bytes)?bytes.toString('base64'):null,status:'usage_unknown',elapsedMs}});
          stop('usage_unknown','society_usage_unknown');break;
        }
        const usage=parsed.receipt.usage;let bookingError:string|null=null;
        // Receipt first, even if the action is illegal or cancellation has arrived. If a
        // conflicting receipt cannot be booked, preserve the raw response and full hold.
        if(usage)try{budget.recordUsage({requestId,receiptId:parsed.receipt.receiptId,sourceSha256:parsed.receipt.sourceSha256,
          model:parsed.receipt.model,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens});}
        catch(error){bookingError=message(error,'society_booking_failed');}
        emit({kind:'response',data:{...binding,rawBase64:bytes.toString('base64'),parsed,elapsedMs,bookingError}});
        if(bookingError){stop('booking_failed',bookingError);break;}
        if(!usage){stop('usage_unknown','society_usage_unknown');break;}
        if(options.signal?.aborted){stop('cancelled','society_cancelled');break;}
        if(!currentLease()){stop('stale_response','society_stale_response');break;}
        if(parsed.receipt.model!==plan.model){stop('model_mismatch','society_response_model');break;}
        if(elapsedMs>plan.deadlineMs){stop('transport_failed','society_provider_deadline');break;}
        if(budget.view().overrun){stop('usage_overrun','society_usage_overrun');break;}
        if(!parsed.actionable||parsed.receipt.status!=='completed'){stop('response_rejected','society_response_not_actionable');break;}
        let action:ReturnType<typeof validateSocietyAction>;
        try{action=validateSocietyAction(parsed.decision,view.context);}catch(error){stop('illegal_action',message(error,'society_action_illegal'));break;}
        active.stage='validated';emit({kind:'decision',data:{...binding,person,status:'validated',action}});
        if(options.signal?.aborted){stop('cancelled','society_cancelled');break;}
        if(!currentLease()){stop('stale_response','society_stale_response');break;}
        society.submit(person,action);active.stage='submitted';outcome('submitted',null);
      }
    }
  }catch(error){
    const reason=message(error,'society_execution_failed');halt(reason);
    try{outcome(undeliveredEvents.length?'evidence_failed':'execution_failed',reason);}catch{/* finish carries undelivered evidence as well. */}
  }finally{running.delete(society);}
  let end:ReturnType<ExperimentBudget['view']>;
  try{end=budget.view();}catch(error){
    halt('society_budget_read_failed');
    emit({kind:'finish',data:{summary:null,tape:society.exportTape(),results,undeliveredEvents,error:message(error,'society_budget_read_failed')}});
    throw error;
  }
  const summary:AccountedSocietySummary={status:stoppedReason?'stopped':'completed',stoppedReason,calls,ticks:society.tick,startTick:0,finalTick:society.tick,
    planSha256:societyPlanHash(plan),runId:auth.runId,bookedMicroUsd:end.booked.toString(),heldMicroUsd:end.held.toString(),budgetHistoryHash:end.historyHash,finalHash:society.hash};
  try{emit({kind:'finish',data:{summary,tape:society.exportTape(),results,undeliveredEvents}});}
  catch(error){society.halt();summary.status='stopped';summary.stoppedReason=message(error,'society_evidence_finish_failed');}
  return summary;
}
