import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,readFileSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {root,setup,cleanup} from './fixtures/accountingFixture.js';
import {continuationBudget,continuationPlan} from './fixtures/continuationFixture.js';
import {InitialTestBudget} from '../src/agent/initialTestBudget.js';
import {ExperimentBudget,EXPERIMENT_MODEL} from '../src/agent/experimentBudget.js';
import {PRICED_MODELS} from '../src/agent/modelPricing.js';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {createSocietyPlan,validateSocietyPlan,societyPlanHash,runAccountedSociety,type SocietyRunEvent} from '../src/society/accounted.js';
import {buildSocietyResultsReport,writeSocietyRawResults} from '../src/society/report.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {ManualTickGate} from '../src/society/manualTicks.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {prepareSocietyPlaytest,checkSocietyPlaytest,type PlaytestEnvironment} from '../scripts/prepare-society-playtest.js';
import {recoverSocietySubmissions,validateSocietyRecoveryTarget,writeSocietyRecoveryBundle} from '../src/society/submissionRecovery.js';

const handles:{close():void}[]=[];
afterEach(()=>{for(const h of handles.splice(0))h.close();cleanup();});
const source='c'.repeat(40),instruction='TEST ONLY synthetic routine approval; no actual provider or financial authority.';
const cards={rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000 as const};
const routine={maxTurnsPerDay:128};
const config=()=>({...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
const eventsText=(events:SocietyRunEvent[])=>events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')+'\n';
function accountedFixture(ticks=1){
  const society=new Society({seed:42,sourceRevision:source,config:config(),routine,postcards:cards,
    dailyOracle:JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8'))});
  const plan=createSocietyPlan(society,{ticks,minIntervalMs:0});
  const {ledger}=setup(),directory=root(),priorDirectory=join(directory,'TEST-ONLY-expired-prior'),now=Date.now(),day=86400000;
  const prior=InitialTestBudget.create(priorDirectory,ledger.exportDocument());
  prior.authorize({runId:'TEST-ONLY-expired-prior',authorizedAt:new Date(now-3*day).toISOString(),expiresAt:new Date(now-2*day).toISOString(),
    expectedHistoryHash:prior.view().historyHash,instruction,scope:'additional_initial_test_spending_only',model:EXPERIMENT_MODEL,
    maxRequests:5,limitMicroUsd:100000,perRequestMicroUsd:20000,
    prices:{model:EXPERIMENT_MODEL,inputMicroUsdPerMillionTokens:400000,outputMicroUsdPerMillionTokens:2500000,evidenceSha256:'a'.repeat(64)}});prior.close();
  const budget=ExperimentBudget.carryFromInitial(join(directory,'TEST-ONLY-routine-budget'),priorDirectory);handles.push(budget);
  budget.authorize({runId:'TEST-ONLY-routine',authorizedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
    expectedCarriedFingerprint:budget.carriedFingerprint(),instruction,scope:'accounted_experiment_spending_only',manifestSha256:societyPlanHash(plan),
    model:plan.model,maxRequests:plan.maxCalls,limitMicroUsd:plan.allowance.limitMicroUsd,perRequestMicroUsd:plan.allowance.perRequestMicroUsd,prices:PRICED_MODELS[plan.model]!});
  const events:SocietyRunEvent[]=[],sent:{requestId:string;index:number;turn?:number;body:string}[]=[];
  const options={plan,ownerApproved:true,instruction,expectedCarriedFingerprint:budget.carriedFingerprint(),sink:(e:SocietyRunEvent)=>events.push(structuredClone(e))};
  const sender=async(input:any)=>{
    validateSocietyWire(Buffer.from(input.body),input.sha256);sent.push(input);
    const observation=JSON.parse(JSON.parse(input.body).messages[0].content[0].text),action=autonomousPolicy(observation);
    return Buffer.from(JSON.stringify({type:'message',role:'assistant',id:'msg_TEST_ONLY_routine_'+input.index,
      model:plan.model,stop_reason:'end_turn',content:[{type:'thinking',thinking:'TEST ONLY returned summary '+input.index,signature:'TEST_ONLY_'+input.index},
        {type:'text',text:JSON.stringify(action)}],usage:{input_tokens:1200,output_tokens:80}}));
  };
  return {society,plan,budget,events,sent,options,sender,directory};
}

describe('reviewed sequential routine launch and evidence',()=>{
  it('binds v4 routine and bounded call count without changing the existing spending ceilings',()=>{
    const f=accountedFixture(20);
    expect(f.plan).toMatchObject({schema:'node-accounted-society-routine-v4',routine,maxCalls:5000,
      allowance:{maxRequests:5000,limitMicroUsd:1000000,perRequestMicroUsd:20000}});
    validateSocietyPlan(f.plan);
    expect(()=>validateSocietyPlan({...f.plan,routine:{maxTurnsPerDay:2}})).toThrow('society_paid_plan');
    expect(()=>validateSocietyPlan({...f.plan,schema:'node-accounted-society-daily-oracle-v3'})).toThrow('society_paid_plan');
    const old=createSocietyPlan(new Society({seed:42,sourceRevision:source}),{ticks:20});
    expect(old.maxCalls).toBe(120);expect(old).not.toHaveProperty('routine');
  });
  it('runs multiple real action turns under one day permit and exports each exact returned summary separately',async()=>{
    const f=accountedFixture(),gate=new ManualTickGate();
    const running=runAccountedSociety(f.society,f.budget,f.sender,{...f.options,awaitDayPermit:(day,signal)=>gate.wait(day,signal)});
    await new Promise(resolve=>setTimeout(resolve,10));expect(f.sent).toHaveLength(0);expect(f.budget.view().requests).toHaveLength(0);
    gate.advance(1);const summary=await running;gate.close();
    expect(summary.stoppedReason).toBeNull();
    expect(summary).toMatchObject({status:'completed',ticks:1,heldMicroUsd:'0'});
    expect(f.sent.length).toBeGreaterThan(6);expect(new Set(f.sent.map(s=>s.requestId)).size).toBe(f.sent.length);
    expect(f.sent.some(s=>s.turn!==undefined&&s.turn>1)).toBe(true);
    const tape=f.society.exportTape();expect(verifySocietyTape(tape)).toMatchObject({verified:true,ticks:1});
    const report=buildSocietyResultsReport({tape,eventsText:eventsText(f.events),summary});
    expect(report.integrityIssues).toEqual([]);
    expect(report.agents.every(a=>a.records.some(r=>r.turn!==undefined&&r.turn>1))).toBe(true);
    const paths=writeSocietyRawResults(report,join(f.directory,'TEST-ONLY-raw'));
    for(const a of report.agents){const file=join(paths.outputDirectory,'agents',a.filename,'tick-0001.json');
      const contents=readFileSync(file,'utf8');expect(contents).toContain('TEST ONLY returned summary');
      for(const r of a.records){expect(r.request.exactVisibleText).toBe(JSON.stringify(r.authorizedVisible));
        expect(r.reasoning.summaries).toEqual(['TEST ONLY returned summary '+r.requestIndex]);}}
    const sourceView=new SocietyObservatorySource({kind:'society',id:'TEST-ONLY-routine',directory:'',mode:'synthetic'},
      {read:()=>({tape,eventsText:eventsText(f.events)}),stop:()=>{throw Error('unexpected integrity stop');}});
    sourceView.refresh();
    const point=sourceView.list().find(p=>p.type==='turn_committed'&&p.sourceTurn===2)!;expect(point).toBeDefined();
    const snapshot=sourceView.snapshot(point.cursor,'TEST-ONLY-secret',true);if(!('calls'in snapshot))throw Error('missing researcher projection');
    expect(snapshot.sourceTick).toBe(0);expect(snapshot.calls.every(c=>(c as any).turn<=1)).toBe(true);
    expect(snapshot.calls.every(c=>!c.transition||'daily'in c.transition&&c.transition.daily===null)).toBe(true);
    expect(snapshot.calls.every(c=>c.nextTick===null)).toBe(true);
    expect(sourceView.snapshot(null,'TEST-ONLY-secret',true).sourceTick).toBe(1);
    const world=JSON.stringify(sourceView.snapshot(null,'TEST-ONLY-secret',false));
    expect(world).not.toContain('TEST ONLY returned summary');expect(world).not.toContain('society-inhabitant:');
  }); // Uses the suite's existing 60-second budget for a complete multi-turn day and replay.
  it('cancellation preserves a replayable open day and all returned evidence without finishing duties',async()=>{
    const f=accountedFixture(),controller=new AbortController();
    const sender=async(input:any)=>{const response=await f.sender(input);if(input.index===7)controller.abort();return response;};
    const summary=await runAccountedSociety(f.society,f.budget,sender,{...f.options,signal:controller.signal});
    expect(summary).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',ticks:0,heldMicroUsd:'0'});
    const tape=f.society.exportTape();expect(tape.transitions).toEqual([]);
    expect(verifySocietyTape(tape,source,{allowPartial:true})).toMatchObject({verified:true,complete:false});
    const durable=f.events.filter(e=>e.kind!=='finish');
    expect(durable.filter(e=>e.kind==='submission')).toHaveLength(tape.decisions.length);
    expect(tape.decisions.some(d=>!d.controlled)).toBe(true);
    const recovered=recoverSocietySubmissions(durable,source);
    expect(recovered).toEqual(tape);
    expect(recoverSocietySubmissions(f.events,source)).toEqual(tape);
    const afterFinish=[...f.events,f.events.find(e=>e.kind==='submission')!];
    expect(()=>recoverSocietySubmissions(afterFinish,source)).toThrow('society_submission_event_order');
    const conflictingFinish=structuredClone(f.events),finish=conflictingFinish.find(e=>e.kind==='finish')!;
    (finish.data as {tape:unknown}).tape={format:'conflicting-tape'};
    expect(()=>recoverSocietySubmissions(conflictingFinish,source)).toThrow('society_submission_finish_conflict');
    expect(verifySocietyTape(recovered,source,{allowPartial:true})).toMatchObject({verified:true,complete:false});
    expect(()=>recoverSocietySubmissions(durable,'d'.repeat(40))).toThrow('society_submission_source');
    const submissions=durable.filter(e=>e.kind==='submission');
    const corrupted=structuredClone(durable),first=corrupted.find(e=>e.kind==='submission')!;
    (first.data as {afterHash:string}).afterHash='0'.repeat(64);
    expect(()=>recoverSocietySubmissions(corrupted,source)).toThrow('society_submission_transition');
    const truncated=durable.slice(0,durable.lastIndexOf(submissions.at(-1)!));
    const prefix=recoverSocietySubmissions(truncated,source);
    expect(prefix.decisions).toHaveLength(tape.decisions.length-1);
    expect(verifySocietyTape(prefix,source,{allowPartial:true}).verified).toBe(true);
    const original=join(f.directory,'TEST-ONLY-interrupted'),viewing=join(f.directory,'TEST-ONLY-recovered-view');
    mkdirSync(original);const originalEvents=eventsText(durable)+'{torn';
    writeFileSync(join(original,'events.jsonl'),originalEvents);
    const pinnedEvents=Buffer.from(originalEvents);
    expect(()=>validateSocietyRecoveryTarget(original,join(original,'nested-output'))).toThrow('society_recovery_bundle_target');
    const alias=join(f.directory,'TEST-ONLY-input-alias');symlinkSync(original,alias,'junction');
    expect(()=>validateSocietyRecoveryTarget(original,join(alias,'nested-output'))).toThrow('society_recovery_bundle_target');
    const changedOutput=join(f.directory,'TEST-ONLY-changed-view');
    writeFileSync(join(original,'events.jsonl'),originalEvents+'changed');
    expect(()=>writeSocietyRecoveryBundle(original,changedOutput,recovered,pinnedEvents)).toThrow('society_recovery_events_changed');
    expect(existsSync(changedOutput)).toBe(false);
    writeFileSync(join(original,'events.jsonl'),originalEvents);
    mkdirSync(join(original,'calls','00000'),{recursive:true});
    writeFileSync(join(original,'calls','00000','transport.json'),'{"test":true}\n');
    writeSocietyRecoveryBundle(original,viewing,recovered,pinnedEvents);
    expect(readFileSync(join(original,'events.jsonl'),'utf8')).toBe(originalEvents);
    expect(readFileSync(join(viewing,'events.jsonl'),'utf8')).toBe(eventsText(durable));
    expect(readFileSync(join(viewing,'calls','00000','transport.json'),'utf8')).toBe('{"test":true}\n');
    const registration=JSON.parse(readFileSync(join(viewing,'history-registration.json'),'utf8')).runs[0];
    expect(registration).toMatchObject({kind:'society',directory:viewing,mode:'live'});
    const sourceView=new SocietyObservatorySource(registration);
    expect(sourceView.refresh()).toBe(true);
    const snapshot=sourceView.snapshot(null,'TEST-ONLY-observer',true);
    expect(snapshot).toMatchObject({status:'reconstructed',sourceTick:0,verification:'replay_verified'});
    expect(sourceView.list().some(p=>p.type==='recorded_prefix')).toBe(true);
    expect(()=>writeSocietyRecoveryBundle(original,viewing,recovered,pinnedEvents)).toThrow('society_recovery_bundle_target');
    const report=buildSocietyResultsReport({tape,eventsText:eventsText(f.events),summary});
    expect(report.agents.flatMap(a=>a.records).at(-1)?.response.rawBase64).not.toBeNull();
  },30000);
  it('stops before another dispatch when a submission cannot be persisted',async()=>{
    const f=accountedFixture(),durable:SocietyRunEvent[]=[];
    const summary=await runAccountedSociety(f.society,f.budget,f.sender,{...f.options,sink:(e:SocietyRunEvent)=>{
      if(e.kind==='submission')throw Error('TEST_ONLY_submission_sink_failure');
      durable.push(structuredClone(e));
    }});
    expect(summary).toMatchObject({status:'stopped',calls:1,heldMicroUsd:'0'});
    expect(f.sent).toHaveLength(1);
    const prefix=recoverSocietySubmissions(durable.filter(e=>e.kind!=='finish'),source);
    expect(prefix.decisions).toHaveLength(0);
    expect(f.society.exportTape().decisions).toHaveLength(1);
  });
  it('never closes or carries away an unknown provider-usage hold',async()=>{
    const f=accountedFixture(),sender=async(input:any)=>{const raw=JSON.parse((await f.sender(input)).toString('utf8'));delete raw.usage;return Buffer.from(JSON.stringify(raw));};
    const summary=await runAccountedSociety(f.society,f.budget,sender,f.options);
    expect(summary).toMatchObject({status:'stopped',stoppedReason:'society_usage_unknown',ticks:0,calls:1});
    expect(f.budget.view().held).toBeGreaterThan(0n);expect(f.budget.view()).not.toHaveProperty('closure');
    expect(f.events.some(e=>e.kind==='response')).toBe(true);
  });
  it('pins routine config in the human review and rejects removing it before approval',()=>{
    const directory=root(),repositoryRoot=join(directory,'repo');mkdirSync(repositoryRoot);
    const priorDirectory=join(directory,'TEST-ONLY-prior'),budget=continuationBudget(continuationPlan(),priorDirectory);
    for(let i=0;i<4;i++){budget.reserve({id:'TEST_ONLY_'+i,episodeId:'TEST_ONLY',actorId:'TEST_ONLY',inputSha256:'a'.repeat(64),
      participant:{tick:i,selfRef:'TEST_ONLY',role:'Baker',roleEpoch:0},model:'claude-haiku-5-5',maxInputTokens:100,maxOutputTokens:100});
      budget.recordUsage({requestId:'TEST_ONLY_'+i,receiptId:'TEST_ONLY_receipt_'+i,sourceSha256:'b'.repeat(64),model:'claude-haiku-5-5',inputTokens:20,outputTokens:20});}budget.close();
    const credential=join(directory,'TEST-ONLY-key.env');writeFileSync(credential,'NOT A CREDENTIAL');
    const environment:PlaytestEnvironment={repositoryRoot,sourceRevision:source,verifySource:()=>{},prepareBundle:(path,options)=>{
      const society=new Society({seed:options.seed,sourceRevision:source,postcards:options.postcards,routine:options.routine}),tape=society.exportTape();
      const plan=createSocietyPlan(society,{ticks:options.ticks});
      writeFileSync(path,stringifySocietyEvidence({plan,genesis:tape.genesis,postcardConfig:options.postcards,routineConfig:options.routine,planSha256:societyPlanHash(plan)}));}};
    const prepared=prepareSocietyPlaytest({priorJournal:join(priorDirectory,'accounting.journal.json'),credentialFile:credential,
      outputRoot:join(directory,'TEST-ONLY-new'),postcardRate:'2/1',ticks:1,dailyTurns:128},environment);
    expect(prepared).toMatchObject({routine,diarySubjectOptional:true,approved:false,providerCalls:0,allowanceCreated:false,maxCalls:387});
    expect(prepared.instruction).toContain('128 sequential action turns');expect(prepared.instruction).toContain('unfinished day');
    const review=JSON.parse(readFileSync(prepared.review,'utf8'));delete review.routine;writeFileSync(prepared.review,JSON.stringify(review));
    expect(()=>checkSocietyPlaytest(prepared.review,environment)).toThrow('society_playtest_routine_binding');
  });
});
