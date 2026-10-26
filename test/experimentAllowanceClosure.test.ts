import {afterEach,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ExperimentBudget,type ExperimentClosure} from '../src/agent/experimentBudget.js';
import {continuationBudget,continuationPlan} from './fixtures/continuationFixture.js';
import {root,cleanup} from './fixtures/accountingFixture.js';

const handles:ExperimentBudget[]=[];
afterEach(()=>{for(const h of handles.splice(0))h.close();cleanup();});
function fixture(){const directory=join(root(),'TEST-ONLY-allowance'),budget=continuationBudget(continuationPlan(),directory);handles.push(budget);
 const view=budget.view(),auth=view.authorization!;
 const closure:ExperimentClosure={runId:auth.runId,manifestSha256:auth.manifestSha256,closedAt:new Date().toISOString(),reason:'completed'};
 const request={id:'TEST_ONLY_request',episodeId:'TEST_ONLY_episode',actorId:'TEST_ONLY_actor',inputSha256:'a'.repeat(64),
   participant:{tick:0,selfRef:'TEST_ONLY_person',role:'Baker',roleEpoch:0},model:auth.model,maxInputTokens:100,maxOutputTokens:100};
 const receipt={requestId:request.id,receiptId:'TEST_ONLY_receipt',sourceSha256:'b'.repeat(64),model:auth.model,inputTokens:20,outputTokens:20};
 const document=()=>JSON.parse(JSON.parse(readFileSync(join(directory,'accounting.journal.json'),'utf8')).payload);
 return {directory,budget,closure,request,receipt,auth,document};}

describe('append-only unused allowance closure',()=>{
 it('appends a terminal fact, preserves all earlier accounting and survives reopening and immediate carry',()=>{
   const f=fixture();f.budget.reserve(f.request);f.budget.recordUsage(f.receipt);
   const before=f.document(),view=f.budget.view();f.closure.closedAt=new Date().toISOString();
   expect(f.budget.closeAllowance(f.closure)).toBe('closed');
   expect(f.document()).toEqual({...before,events:[...before.events,{kind:'closure',value:f.closure}]});
   const closed=f.budget.view();expect(closed).toMatchObject({canReserve:false,stopReason:'closed',closure:f.closure});
   expect(closed.authorization).toEqual(view.authorization);expect(closed.booked).toBe(view.booked);expect(closed.held).toBe(0n);
   expect(closed.requests).toEqual(view.requests);expect(closed.historyHash).not.toBe(view.historyHash);
   expect(f.budget.closeAllowance(f.closure)).toBe('duplicate');
   expect(()=>f.budget.closeAllowance({...f.closure,reason:'stopped'})).toThrow('experiment_budget_closure_conflict');
   expect(()=>f.budget.reserve({...f.request,id:'TEST_ONLY_after_close'})).toThrow('experiment_budget_closed');
   f.budget.close();const reopened=ExperimentBudget.open(f.directory);handles.push(reopened);
   expect(reopened.view().historyHash).toBe(closed.historyHash);reopened.close();
   const next=ExperimentBudget.carryFromExperiment(join(root(),'TEST-ONLY-next'),f.directory);handles.push(next);
   const at=new Date(Math.max(Date.now(),Date.parse(f.closure.closedAt))).toISOString();
   next.authorize({...f.auth,runId:'TEST-ONLY-next',expectedCarriedFingerprint:closed.historyHash,
     authorizedAt:at,expiresAt:new Date(Date.parse(at)+3600000).toISOString()});
   expect(next.view().canReserve).toBe(true);expect(next.view().carried.closedAt).toBe(f.closure.closedAt);
   expect(next.carriedFingerprint()).toBe(closed.historyHash);
 });
 it('can revoke an authorized run before any call without manufacturing requests or billing',()=>{
   const f=fixture(),before=f.document();
   expect(f.budget.closeAllowance({...f.closure,reason:'stopped'})).toBe('closed');
   expect(f.budget.view()).toMatchObject({requests:[],booked:0n,held:0n,canReserve:false});
   expect(f.document().events).toHaveLength(before.events.length+1);
 });
 it.each(['run','manifest','time','extra']as const)('rejects an invalid %s closure atomically',field=>{
   const f=fixture(),before=f.document(),value:any={...f.closure};
   if(field==='run')value.runId='TEST-ONLY-other';if(field==='manifest')value.manifestSha256='d'.repeat(64);
   if(field==='time')value.closedAt=new Date(Date.parse(f.auth.authorizedAt)-1).toISOString();if(field==='extra')value.refund=1;
   expect(()=>f.budget.closeAllowance(value)).toThrow('experiment_budget_closure');expect(f.document()).toEqual(before);
 });
 it('keeps unknown usage held and rejects closure rather than releasing or booking it',()=>{
   const f=fixture();f.budget.reserve(f.request);const before=f.document();
   expect(()=>f.budget.closeAllowance(f.closure)).toThrow('experiment_budget_closure');
   expect(f.document()).toEqual(before);expect(f.budget.view().held).toBeGreaterThan(0n);expect(f.budget.view()).not.toHaveProperty('closure');
 });
 it('rejects closure after a usage overrun and preserves the booked fault',()=>{
   const f=fixture();f.budget.reserve(f.request);f.budget.recordUsage({...f.receipt,inputTokens:10000});
   const before=f.document();expect(f.budget.view().overrun).toBe(true);
   expect(()=>f.budget.closeAllowance(f.closure)).toThrow('experiment_budget_closure');expect(f.document()).toEqual(before);
 });
 it('rejects events appended after closure and forged carried closure summaries',()=>{
   const f=fixture();f.budget.closeAllowance(f.closure);const raw=f.document();
   expect(()=>ExperimentBudget.inspect({...raw,events:[...raw.events,{kind:'reservation',value:f.request,at:new Date().toISOString()}]})).toThrow('experiment_budget_closed');
   f.budget.close();const nextDirectory=join(root(),'TEST-ONLY-forgery'),next=ExperimentBudget.carryFromExperiment(nextDirectory,f.directory);handles.push(next);
   const carried=JSON.parse(JSON.parse(readFileSync(join(nextDirectory,'accounting.journal.json'),'utf8')).payload);
   carried.carried.summary.closedAt=new Date(Date.parse(f.closure.closedAt)+1).toISOString();
   expect(()=>ExperimentBudget.inspect(carried)).toThrow('experiment_carried_summary');
 });
});
