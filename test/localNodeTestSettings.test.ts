import {afterEach,expect,it} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,cleanup} from './fixtures/accountingFixture.js';
import {continuationBudget,continuationPlan} from './fixtures/continuationFixture.js';
import {finishLocalTest,readLocalTestSettings,type LocalTestSettings} from '../scripts/manage-node-tests.js';
const handles:{close:()=>void}[]=[];afterEach(()=>{for(const h of handles.splice(0))h.close();cleanup();});
function settings(){const directory=root(),pendingRun=join(directory,'TEST-ONLY-run');mkdirSync(pendingRun);
  const path=join(directory,'TEST-ONLY-local.json'),v:LocalTestSettings={format:'node-local-test-settings-v1',
    credentialFile:join(directory,'TEST-ONLY-invalid-key'),priorJournal:join(directory,'TEST-ONLY-old-journal'),
    outputParent:directory,godot:'TEST-ONLY-godot',webTemplate:'TEST-ONLY-template',webWorldDirectory:directory,
    postcardRate:'2/1',oracleConfig:'TEST-ONLY-config',historyRegistration:join(directory,'TEST-ONLY-history.json'),pendingRun};
  writeFileSync(path,JSON.stringify(v));return {directory,path,v,pendingRun};}
it('preserves an unstarted prepared review and safely releases its pending pointer without reading credentials',()=>{
  const f=settings(),review=join(f.pendingRun,'review.json');writeFileSync(review,'TEST ONLY unstarted review');
  expect(finishLocalTest(f.path)).toEqual({status:'unstarted_review_preserved'});
  expect(readLocalTestSettings(f.path).pendingRun).toBeNull();expect(readFileSync(review,'utf8')).toContain('unstarted');
  expect(existsSync(f.v.credentialFile)).toBe(false);
});
it('always retains the newest real journal pointer and blocks unfinished allowances rather than reverting to old history',()=>{
  const f=settings(),directory=join(f.pendingRun,'execution','allowance'),plan=continuationPlan(4);mkdirSync(join(f.pendingRun,'execution'));
  const budget=continuationBudget(plan,directory);handles.push(budget);
  const book=(i:number)=>{const requestId='TEST_ONLY_'+i;budget.reserve({id:requestId,episodeId:'TEST_ONLY_episode',actorId:'TEST_ONLY_actor',
    inputSha256:'a'.repeat(64),participant:{tick:i,selfRef:'TEST_ONLY_observer',role:'Baker',roleEpoch:0},model:plan.model,maxInputTokens:100,maxOutputTokens:100});
    budget.recordUsage({requestId,receiptId:'TEST_ONLY_receipt_'+i,sourceSha256:'b'.repeat(64),model:plan.model,inputTokens:20,outputTokens:20});};
  for(let i=0;i<3;i++)book(i);
  const journal=join(directory,'accounting.journal.json'),before=readFileSync(journal);
  expect(finishLocalTest(f.path).status).toBe('latest_history_preserved_not_closed');
  expect(readLocalTestSettings(f.path)).toMatchObject({pendingRun:f.pendingRun,priorJournal:journal});
  expect(readFileSync(journal).equals(before)).toBe(true);
  book(3);expect(finishLocalTest(f.path).status).toBe('latest_history_carried');
  expect(readLocalTestSettings(f.path)).toMatchObject({pendingRun:null,priorJournal:journal});
});
it('carries a terminally closed unused allowance without waiting for its unchanged expiry or rewriting its journal',()=>{
  const f=settings(),directory=join(f.pendingRun,'execution','allowance');mkdirSync(join(f.pendingRun,'execution'));
  const budget=continuationBudget(continuationPlan(4),directory);handles.push(budget);
  const auth=budget.view().authorization!;
  budget.closeAllowance({runId:auth.runId,manifestSha256:auth.manifestSha256,closedAt:new Date().toISOString(),reason:'stopped'});
  const journal=join(directory,'accounting.journal.json'),before=readFileSync(journal);
  expect(finishLocalTest(f.path)).toMatchObject({status:'latest_history_carried',requests:0,heldMicroUsd:'0'});
  expect(readLocalTestSettings(f.path)).toMatchObject({pendingRun:null,priorJournal:journal});
  expect(readFileSync(journal)).toEqual(before);expect(budget.view().authorization!.expiresAt).toBe(auth.expiresAt);
});
