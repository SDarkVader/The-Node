import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import WebSocket from 'ws';
import { continuationBudget, continuationGenesis, continuationPlan, simulatedContinuationProvider } from './fixtures/continuationFixture.js';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { runContinuation } from '../src/eval/continuationRunner.js';
import { ContinuationLedger, readContinuationLedger, type ContinuationEvent } from '../src/eval/continuationLedger.js';
import { ObservatorySource, points } from '../src/observatory/source.js';
import { projectWorld } from '../src/observatory/worldProjection.js';
import { createParticipantState } from '../src/agent/participantWorld.js';
import { readEvaluations, type EvaluationRecord } from '../src/observatory/evaluations.js';
import { startObservatory } from '../src/observatory/server.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { evaluateContinuationDiary } from '../src/observatory/diaryEvaluation.js';
const REV = 'a'.repeat(40), R = 'researcher-'.repeat(5), W = 'world-only-'.repeat(5);
const handles: { close(): unknown }[] = [];
afterEach(async () => { for (const h of handles.splice(0).reverse()) await h.close(); cleanup(); });
async function fixture(options: { calls?: number; fail?: boolean; checkpoint?: number; exerciseMechanics?: boolean } = {}) {
  const directory = root(), plan = continuationPlan(options.calls ?? 4), budgetDirectory = join(directory, 'allowance');
  if (options.exerciseMechanics) { plan.maxRequestBytes = 95000; plan.allowance.perRequestMicroUsd = 30000; plan.allowance.limitMicroUsd = 1000000; }
  const budget = continuationBudget(plan, budgetDirectory); handles.push(budget);
  const ledger = new ContinuationLedger(join(directory, 'trace')); handles.push(ledger);
  const provider = simulatedContinuationProvider({ redacted: true, exerciseMechanics: options.exerciseMechanics, ...(options.fail ? { failAt: 0 } : {}) });
  const summary = await runContinuation(plan, continuationGenesis(REV), budget, provider.send, ledger,
    { sourceRevision: REV, mode: 'offline_simulated_provider', stopAtTick: options.checkpoint });
  ledger.close();
  const source = new ObservatorySource({ id: 'test', ledger: ledger.path, sourceRevision: REV, journal: join(budgetDirectory, 'accounting.journal.json') });
  source.refresh();
  return { source, ledger, budget, budgetDirectory, provider, plan, directory, summary, events: readContinuationLedger(ledger.path) };
}
it('projects the verified shared world, exact returned summaries, actual effects and journal without acquiring its writer lock', async () => {
  const f = await fixture(), before = sha256(readFileSync(join(f.budgetDirectory, 'accounting.journal.json')));
  const s = f.source.snapshot(null, 'browser', true);
  expect(s).toMatchObject({ sourceTick: 2, worldHash: f.summary.finalStateHash, providerReasoning: 'synthetic_test_only', segmentRoot: f.events.at(-1)!.hash });
  if (!('calls' in s)) throw Error('researcher_snapshot');
  expect(s.calls).toHaveLength(4);
  expect(s.calls.every(c => c.executed && c.admitted !== null)).toBe(true);
  expect(s.calls[0]!.reasoning.summaries).toEqual(['TEST ONLY: reconsider prior price using the evolved authorized observation.']);
  expect(s.telemetry).toMatchObject({ bookedMicroUsd: '1360', heldMicroUsd: '0', completedTickCount: 2, qualityEvaluation: 'not_evaluated' });
  expect(s.accounting).toMatchObject({ status: 'matches_latest_ledger', bookedMicroUsd: '1360', heldMicroUsd: '0', historicalBillingReconciled: false });
  expect(sha256(readFileSync(join(f.budgetDirectory, 'accounting.journal.json')))).toBe(before);
  expect(f.budget.view().requests).toHaveLength(4); // writer is still open
  expect(JSON.stringify(s)).not.toContain('TEST-ONLY-signature');
  expect(JSON.stringify(s)).not.toContain('opaque-redaction');
  const publicView = JSON.stringify(f.source.snapshot(null, 'godot', false));
  for (const field of ['diary', 'wealth', 'observerSecret', 'raw', 'offline-person', 'reasoning', 'signature', f.directory]) expect(publicView).not.toContain(field);
  expect(f.provider.requests).toHaveLength(4);
});
it('handles a complete-line live prefix, pending reasoning and response without advancing the committed world', async () => {
  const f = await fixture(), path = join(f.directory, 'tail.jsonl');
  const text = (events: ContinuationEvent[]) => events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(path, text(f.events.slice(0,2)) + JSON.stringify(f.events[2]!).slice(0,60));
  const source = new ObservatorySource({ id: 'prefix', ledger: path, sourceRevision: REV }); source.refresh();
  const s = source.snapshot(null,'x',true);
  expect(s.sourceTick).toBe(0); expect(s.segmentRoot).toBeNull();
  if (!('calls' in s)) throw Error();
  expect(s.calls[0]!.reasoning.status).toBe('pending'); expect(s.calls[0]!.executed).toBe(false);
  const stableCursor = source.latestCursor;
  writeFileSync(path, text(f.events)); source.refresh();
  expect(source.has(stableCursor!)).toBe(true);
  expect(source.snapshot(stableCursor,'x',false).sourceTick).toBe(0);
  expect(source.snapshot(null,'x',false).sourceTick).toBe(2);
  expect(source.latestCursor).toBe(points(f.events).at(-1)!.cursor);
});
it('refuses rewritten/truncated/tampered evidence and does not repair the source', async () => {
  for (const type of ['rewrite','truncate','append'] as const) {
    const f = await fixture(), original = readFileSync(f.ledger.path,'utf8');
    if (type === 'rewrite') writeFileSync(f.ledger.path, original.replace('TEST ONLY:', 'FALSE ONLY:'));
    if (type === 'truncate') writeFileSync(f.ledger.path, original.slice(0,50));
    if (type === 'append') appendFileSync(f.ledger.path, JSON.stringify({seq:f.events.length,previous:'bad',kind:'request',data:{},hash:'bad'})+'\n');
    expect(() => f.source.refresh()).toThrow();
    const retained = readFileSync(f.ledger.path);
    expect(() => f.source.refresh()).toThrow('source_diverged');
    expect(readFileSync(f.ledger.path)).toEqual(retained);
  }
});
it('deduplicates embedded parents and preserves stable cursors on verified resume', async () => {
  const f = await fixture({checkpoint:1});
  const second = new ContinuationLedger(join(f.directory,'second')); handles.push(second);
  const provider = simulatedContinuationProvider();
  await runContinuation(f.plan,continuationGenesis(REV),f.budget,provider.send,second,{sourceRevision:REV,mode:'offline_simulated_provider',parent:f.events});
  second.close();
  const s = new ObservatorySource({id:'chain',ledger:second.path,sourceRevision:REV});s.refresh();
  expect(s.has(points(f.events)[1]!.cursor)).toBe(true);
  const data = s.snapshot(null,'x',true);
  if (!('calls' in data)) throw Error();
  expect(data.calls).toHaveLength(4);expect(new Set(data.calls.map(c=>c.requestId)).size).toBe(4);
  expect(data.telemetry).toMatchObject({bookedMicroUsd:'1360',completedTickCount:2});
});
it('shows held liabilities and absent reasoning after transport failure, with no invented decision', async () => {
  const f=await fixture({fail:true}), data=f.source.snapshot(null,'x',true);
  if(!('calls' in data)) throw Error();
  expect(data.sourceTick).toBe(0);expect(data.calls[0]!.reasoning.status).toBe('transport_failed');
  expect(data.calls[0]!.proposal).toBeNull();expect(Number(data.telemetry.heldMicroUsd)).toBeGreaterThan(0);
  expect(data.accounting).toMatchObject({stopReason:'outstanding_hold'});
});
it('keeps person pseudonyms stable across body/role changes and distinct across connections',()=>{
  const state=createParticipantState(continuationGenesis(REV));
  const first=[...state.registry.people.values()][0]!, second=[...state.registry.people.values()].at(-1)!;
  const before=projectWorld(state,'connection-one').frame;
  const a={...first,location:second.location,role:second.role,roleEpoch:first.roleEpoch+1};
  const b={...second,location:first.location,role:first.role,roleEpoch:second.roleEpoch+1};
  state.registry.people.set(a.id,a);state.registry.people.set(b.id,b);
  const after=projectWorld(state,'connection-one').frame,other=projectWorld(state,'connection-two').frame;
  expect(after.people[0]!.handle).toBe(before.people[0]!.handle);expect(after.people[0]!.role).not.toBe(before.people[0]!.role);
  expect(other.people[0]!.handle).not.toBe(after.people[0]!.handle);
});
function evaluation(f: Awaited<ReturnType<typeof fixture>>): EvaluationRecord {
  const p=points(f.events).at(-1)!;
  return {schema:'node-observatory-evaluation-v1',phase:'evaluation',evaluationId:'test-score',experimentId:'test',
    inputLedgerRoot:p.event.hash,inputEventHash:p.event.hash,evaluatedThroughCursor:p.cursor,evaluatedThroughTick:2,
    producer:{kind:'declared_metric',name:'TEST ONLY execution share',version:'1'},metricId:'execution_share',metricVersion:'1',
    definition:'Executed decisions divided by recorded requests; execution measure, not reasoning quality.',status:'scored',value:1,
    numerator:4,denominator:4,scope:{startTick:0,endTick:2},evidence:[{segmentId:p.segmentId,seq:p.event.seq,eventHash:p.event.hash}],createdAt:new Date().toISOString()};
}
it('imports separately attributed results only at their evidence cursor; rejects fabricated anchors/applicability', async()=>{
  const f=await fixture(),path=join(f.directory,'evaluations.json'),r=evaluation(f);
  writeFileSync(path,JSON.stringify([r]));
  expect(readEvaluations(path,'test',points(f.events),f.source.latestCursor!)).toHaveLength(1);
  expect(readEvaluations(path,'test',points(f.events),points(f.events)[1]!.cursor)).toHaveLength(0);
  for(const patch of [{inputEventHash:'b'.repeat(64)},{status:'not_applicable',value:0},{evaluatedThroughTick:3},{scope:{startTick:0,endTick:3}}]){
    writeFileSync(path,JSON.stringify([{...r,...patch}]));expect(()=>readEvaluations(path,'test',points(f.events),f.source.latestCursor!)).toThrow();
  }
});
it('validates a read-only journal document with the same rules as the active writer',async()=>{
  const f=await fixture(),envelope=JSON.parse(readFileSync(join(f.budgetDirectory,'accounting.journal.json'),'utf8'));
  const document=JSON.parse(envelope.payload),v=ExperimentBudget.inspect(document);
  expect(v.historyHash).toBe(f.budget.view().historyHash);
  document.events.at(-1).value.inputTokens=0;
  expect(ExperimentBudget.inspect(document).historyHash).not.toBe(v.historyHash);
  expect(()=>ExperimentBudget.inspect({})).toThrow();
});
it('authenticates research/world channels; synchronizes shared selection and never dispatches on view/reconnect',async()=>{
  const f=await fixture(),app=startObservatory({sources:[f.source],researcherToken:R,worldToken:W,port:0,pollMs:60000});handles.push(app);
  const port=await app.ready,url=`http://127.0.0.1:${port}`;
  expect((await fetch(url+'/observatory/v1/runs')).status).toBe(401);
  expect((await fetch(url+'/observatory/v1/runs',{headers:{Authorization:'Bearer '+W}})).status).toBe(401);
  const login=await fetch(url+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:R})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  expect(cookie).toContain('node_observatory=');expect(cookie).not.toContain(R);
  expect((await fetch(url+'/observatory/v1/runs',{headers:{Cookie:cookie}})).status).toBe(200);
  const headers={Authorization:'Bearer '+R,'Content-Type':'application/json'};
  const current=await(await fetch(url+'/observatory/v1/runs/test/snapshot',{headers})).json() as any;
  expect(current.calls).toHaveLength(2);expect(current.calls.every((c:any)=>c.tick===1)).toBe(true);
  expect(current.telemetry.callAttemptCount).toBe(4);
  const full=await(await fetch(url+'/observatory/v1/runs/test/history',{headers})).json() as any;
  expect(full.records).toHaveLength(4);
  expect(full.records.every((r:any)=>r.thinking.summaries[0]==='TEST ONLY: reconsider prior price using the evolved authorized observation.')).toBe(true);
  const actor=encodeURIComponent(current.calls[0].actorId);
  const individual=await(await fetch(url+'/observatory/v1/runs/test/history?agent='+actor,{headers})).json() as any;
  expect(individual.records).toHaveLength(2);expect(individual.records.map((r:any)=>r.day)).toEqual([0,1]);
  expect(individual.records.every((r:any)=>r.observation&&r.admitted&&r.executed)).toBe(true);
  expect((await fetch(url+'/observatory/v1/runs/test/history',{headers:{Authorization:'Bearer '+W}})).status).toBe(401);
  expect((await fetch(url+'/observatory/v1/configuration/validate',{method:'POST',headers,body:JSON.stringify({plan:f.plan})})).status).toBe(200);
  const ws=new WebSocket(`ws://127.0.0.1:${port}/observatory/v1/runs/test/world`,{headers:{Authorization:'Bearer '+W}});
  const frames: any[]=[];ws.on('message',bytes=>frames.push(JSON.parse(bytes.toString())));
  await once(ws,'open');await new Promise(r=>setTimeout(r,20));
  expect(frames.at(-1).worldHash).toBe(f.summary.finalStateHash);
  const cursor=points(f.events)[1]!.cursor;
  const select=await fetch(url+'/observatory/v1/runs/test/selection',{method:'PUT',headers,body:JSON.stringify({cursor})});expect(select.status).toBe(200);
  await new Promise(r=>setTimeout(r,20));
  const historical=await (await fetch(url+'/observatory/v1/runs/test/snapshot',{headers})).json() as any;
  expect(historical.sourceTick).toBe(0);expect(frames.at(-1).worldHash).toBe(historical.worldHash);expect(frames.at(-1).cursor).toBe(cursor);
  const prefix=await(await fetch(url+'/observatory/v1/runs/test/history',{headers})).json() as any;
  expect(prefix.records.length).toBeLessThan(4);expect(prefix.records.every((r:any)=>r.thinking.summaries.length===0)).toBe(true);
  expect((await fetch(url+'/observatory/v1/runs/test/events?after=bad',{headers})).status).toBe(409);
  expect((await fetch(url+'/observatory/v1/runs/test/selection',{method:'PUT',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify({cursor:null})})).status).toBe(403);
  ws.send('{}');await once(ws,'close');
  expect(f.provider.requests).toHaveLength(4);expect(f.budget.view().requests).toHaveLength(4);
});
it('fails closed when a live source changes underneath connected clients',async()=>{
  const f=await fixture(),app=startObservatory({sources:[f.source],researcherToken:R,worldToken:W,port:0,pollMs:60000});handles.push(app);
  const port=await app.ready;
  writeFileSync(f.ledger.path,'{}\n');app.refresh();
  expect((await fetch(`http://127.0.0.1:${port}/observatory/v1/runs/test/snapshot`,{headers:{Authorization:'Bearer '+R}})).status).toBe(409);
});
it('exercises seven-role society actions and evaluates A01 separately through its original classifier',async()=>{
  const f=await fixture({calls:84,exerciseMechanics:true});
  expect(f.summary.status).toBe('completed');expect(f.summary.ticks).toBe(12);
  const effects=f.events.filter(e=>e.kind==='transition').flatMap(e=>e.data.effects).map(e=>e.category);
  for(const category of ['move','proximityHeard','diary','bakerPrice'])expect(effects).toContain(category);
  const evaluation=evaluateContinuationDiary(f.events,'test');
  expect(evaluation.result.actors).toHaveLength(7);
  expect(evaluation.result.grounding.written).toBeGreaterThan(0);
  expect(evaluation.records.every(r=>r.phase==='evaluation'&&r.contractHash===evaluation.result.contract.hash)).toBe(true);
  const path=join(f.directory,'a01.json');writeFileSync(path,JSON.stringify(evaluation.records));
  expect(readEvaluations(path,'test',points(f.events),f.source.latestCursor!)).toHaveLength(7);
  expect(f.provider.requests).toHaveLength(84);
});
it('resumes SSE from stable evidence cursors and keeps browser/Godot mode changes synchronized',async()=>{
  const f=await fixture(),app=startObservatory({sources:[f.source],researcherToken:R,worldToken:W,port:0,pollMs:60000});handles.push(app);
  const port=await app.ready,url=`http://127.0.0.1:${port}/observatory/v1/runs/test`;
  const controller=new AbortController(),headers={Authorization:'Bearer '+R,'Content-Type':'application/json'};
  const last=points(f.events).at(-2)!;
  const response=await fetch(url+'/events',{headers:{...headers,'Last-Event-ID':last.cursor},signal:controller.signal});
  const reader=response.body!.getReader(),chunk=new TextDecoder().decode((await reader.read()).value);controller.abort();
  expect(chunk).toContain('event: execution');expect(chunk).toContain('event: snapshot');
  expect(chunk).toContain(f.source.latestCursor);expect(chunk).not.toContain('id: '+last.cursor+'\n');
  const ws=new WebSocket(url.replace('http:','ws:')+'/world',{headers:{Authorization:'Bearer '+W}}),frames:any[]=[];
  ws.on('message',b=>frames.push(JSON.parse(b.toString())));await once(ws,'open');await new Promise(r=>setTimeout(r,20));
  await fetch(url+'/selection',{method:'PUT',headers,body:JSON.stringify({cursor:f.source.latestCursor})});await new Promise(r=>setTimeout(r,20));
  expect(frames.at(-1).following).toBe(false);
  await fetch(url+'/selection',{method:'PUT',headers,body:JSON.stringify({cursor:null})});await new Promise(r=>setTimeout(r,20));expect(frames.at(-1).following).toBe(true);
  ws.close();await once(ws,'close');expect(f.provider.requests).toHaveLength(4);
});
it('tails an executing runner while a provider request is pending, then publishes only its committed transition',async()=>{
  const directory=root(),ledgerPath=join(directory,'trace','continuation.ledger.jsonl');
  const source=new ObservatorySource({id:'live-test',ledger:ledgerPath,sourceRevision:REV});
  const app=startObservatory({sources:[source],researcherToken:R,worldToken:W,port:0,pollMs:60000});handles.push(app);await app.ready;
  expect(source.latestCursor).toBeNull();
  const plan={...continuationPlan(),maxTicks:1,maxCalls:2,allowance:{...continuationPlan().allowance,maxRequests:2}};
  const budget=continuationBudget(plan,join(directory,'allowance'));handles.push(budget);
  const ledger=new ContinuationLedger(join(directory,'trace'));handles.push(ledger);
  const provider=simulatedContinuationProvider();let release!:()=>void,attempts=0;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const running=runContinuation(plan,continuationGenesis(REV),budget,async(input,signal)=>{
    attempts++;if(attempts===1)await waiting;return provider.send(input,signal);
  },ledger,{sourceRevision:REV,mode:'offline_simulated_provider'});
  app.refresh();const pending=source.snapshot(null,'x',true);
  expect(pending.sourceTick).toBe(0);if(!('calls'in pending))throw Error();expect(pending.calls[0]!.reasoning.status).toBe('pending');
  for(let i=0;i<3;i++){source.snapshot(null,'viewer-'+i,false);app.refresh();}expect(attempts).toBe(1);
  release();const summary=await running;ledger.close();app.refresh();
  expect(summary.status).toBe('completed');expect(source.snapshot(null,'x',false)).toMatchObject({sourceTick:1,worldHash:summary.finalStateHash});expect(attempts).toBe(2);
});
