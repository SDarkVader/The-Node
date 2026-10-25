import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { continuationBudget, continuationGenesis, continuationPlan, simulatedContinuationProvider } from './fixtures/continuationFixture.js';
import { ContinuationLedger, readContinuationLedger, recoverContinuation } from '../src/eval/continuationLedger.js';
import { runContinuation, validateContinuationPlan, type ContinuationPlan } from '../src/eval/continuationRunner.js';
import { ContinuationConversations, conversationObservations, unpackContinuationObservation } from '../src/eval/continuationConversation.js';
import { ContinuationHost } from '../src/eval/continuationHost.js';
import { PER_TURN_DELIBERATION_V1, DELIBERATION_SYSTEM, DELIBERATION_TURN } from '../src/eval/continuationReasoning.js';
import { auditContinuationReasoning } from '../src/eval/reasoningAudit.js';
import { usageCost } from '../src/agent/accountingLedger.js';
import { PRICED_MODELS } from '../src/agent/modelPricing.js';
import { digest } from '../src/agent/replay.js';
const REV='a'.repeat(40),handles:{close():void}[]=[];
afterEach(()=>{for(const h of handles.splice(0))h.close();cleanup();});
const freshPlan=()=>JSON.parse(readFileSync(new URL('../experiments/two-baker-reasoning-20-ticks.json',import.meta.url),'utf8')) as ContinuationPlan;
async function run(profile: boolean, asymmetric=false, parent?: ReturnType<typeof readContinuationLedger>, existingBudget?: ReturnType<typeof continuationBudget>,stopAtTick?:number){
  const plan={...freshPlan(),minIntervalMs:0,deadlineMs:2000};if(!profile)delete plan.reasoningProfile;
  const budget=existingBudget??continuationBudget(plan);handles.push(budget);
  const ledger=new ContinuationLedger(join(root(),'trace'));handles.push(ledger);
  const provider=simulatedContinuationProvider();
  const summary=await runContinuation(plan,continuationGenesis(REV),budget,async(input,signal)=>{
    const bytes=await provider.send(input,signal);
    if(!asymmetric||input.actorId!=='baker-1'||input.tick%2===0)return bytes;
    const value=JSON.parse(bytes.toString());value.content=value.content.filter((b:any)=>b.type!=='thinking');return Buffer.from(JSON.stringify(value));
  },ledger,{sourceRevision:REV,mode:'offline_simulated_provider',parent,stopAtTick});
  ledger.close();return{plan,budget,provider,summary,events:readContinuationLedger(ledger.path)};
}
it('prepares exactly a fresh twenty-tick/two-Baker configuration within the unchanged output and booking caps',()=>{
  const p=freshPlan();validateContinuationPlan(p);
  expect(p).toMatchObject({maxTicks:20,maxCalls:40,reasoningProfile:PER_TURN_DELIBERATION_V1,minIntervalMs:4000});
  expect(p.actors).toEqual([{actorId:'baker-0',role:'Baker',ordinal:0},{actorId:'baker-1',role:'Baker',ordinal:1}]);
  const ceiling=usageCost(p.maxRequestBytes!+4096,2048,PRICED_MODELS[p.model]!);
  expect(ceiling).toBeLessThanOrEqual(p.allowance.perRequestMicroUsd);expect(ceiling*40).toBeLessThanOrEqual(p.allowance.limitMicroUsd);
  expect(()=>validateContinuationPlan({...p,reasoningProfile:'unknown' as any})).toThrow('reasoning_profile');
});
it('gives both Bakers identical native reasoning controls and explicit instructions on all forty fresh decisions',async()=>{
  const r=await run(true);expect(r.summary).toMatchObject({status:'completed',calls:40,ticks:20,heldMicroUsd:'0'});
  const audit=auditContinuationReasoning(r.events);expect(audit.ticks.every(t=>t.uniformReasoningConditions)).toBe(true);
  expect(audit.actors.map(a=>a.requests)).toEqual([20,20]);expect(audit.actors.every(a=>a.explicitInstructionOnEveryRequest)).toBe(true);
  expect(audit.requests.every(q=>q.controls.maxOutputTokens===2048&&q.controls.effort==='high')).toBe(true);
  const systems=new Set<string>();
  for(const actor of ['baker-0','baker-1']){
    const requests=r.provider.requests.filter(q=>q.actorId===actor);
    for(let i=0;i<requests.length;i++){
      const wire=JSON.parse(requests[i]!.body);systems.add(wire.system);
      expect(wire.thinking).toEqual({type:'adaptive',display:'summarized'});expect(wire.thinking).not.toHaveProperty('budget_tokens');
      expect(wire.system).toContain(DELIBERATION_SYSTEM);
      expect(JSON.parse(wire.messages.at(-1).content[0].text).reasoningInstruction).toBe(DELIBERATION_TURN);
      expect(conversationObservations(wire.messages).map(unpackContinuationObservation).at(-1)!.tick).toBe(i);
      if(i){const old=JSON.parse(requests[i-1]!.body);expect(wire.messages.slice(0,old.messages.length)).toEqual(old.messages);}
    }
  }
  expect(systems.size).toBe(1);
});
it('reports genuinely absent blocks without fabrication or retries even when settings are identical',async()=>{
  const r=await run(true,true),audit=auditContinuationReasoning(r.events);
  expect(audit.actors.map(a=>a.summaryReturned)).toEqual([20,10]);expect(audit.actors.map(a=>a.notReturned)).toEqual([0,10]);
  expect(audit.ticks.every(t=>t.uniformReasoningConditions)).toBe(true);expect(r.provider.requests).toHaveLength(40);
  const text=JSON.stringify(audit);expect(text).not.toContain('TEST ONLY: reconsider');expect(text).not.toContain('TEST-ONLY-signature');
  expect(audit.rawPrivateTextIncluded).toBe(false);
});
it('preserves legacy prompt/effort and refuses to rewrite old signed systems as the new condition',()=>{
  const host=new ContinuationHost(continuationGenesis(REV),continuationPlan().actors),views=host.views();
  const old=new ContinuationConversations(95000),q=old.prepare(views[0]!.actorId,views[0]!.observation,'claude-haiku-5-5');
  const wire=JSON.parse(q.body);expect(wire.output_config.effort).toBe('medium');expect(wire.system).not.toContain(DELIBERATION_SYSTEM);
  const response=Buffer.from(JSON.stringify({type:'message',role:'assistant',id:'msg_test_legacy',model:'claude-haiku-5-5',stop_reason:'end_turn',
    content:[{type:'thinking',thinking:'TEST ONLY preserved',signature:'TEST-ONLY-signed'},{type:'text',text:JSON.stringify({move:null,communication:null,diary:null,role:null})}],usage:{input_tokens:1,output_tokens:1}}));
  old.accept(views[0]!.actorId,q,response,'test-legacy');
  const upgraded=ContinuationConversations.restoreVerified(old.export(),95000,PER_TURN_DELIBERATION_V1);
  host.advance(views,Object.fromEntries(views.map(v=>[v.actorId,{move:null,communication:null,diary:null,role:null}])));
  expect(()=>upgraded.prepare(views[0]!.actorId,host.views()[0]!.observation,'claude-haiku-5-5')).toThrow('system_changed');
});
it('resumes the same declared condition exactly and rejects a changed profile in a rehashed child ledger',async()=>{
  const first=await run(true,false,undefined,undefined,1),next=await run(true,false,first.events,first.budget);
  expect(next.summary).toMatchObject({status:'completed',ticks:20,calls:40});
  const recovered=recoverContinuation(next.events,REV);expect(recovered.recovery.plan.reasoningProfile).toBe(PER_TURN_DELIBERATION_V1);
  const edited=structuredClone(next.events);delete edited[0]!.data.plan.reasoningProfile;
  let previous='0'.repeat(64);for(const e of edited){e.previous=previous;e.hash=digest([e.seq,e.previous,e.kind,e.data]);previous=e.hash;}
  expect(()=>recoverContinuation(edited,REV)).toThrow('parent_contract');
});
