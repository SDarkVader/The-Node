import {afterEach,describe,expect,it} from 'vitest';
import {join,resolve} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {root,setup,cleanup} from './fixtures/accountingFixture.js';
import {InitialTestBudget} from '../src/agent/initialTestBudget.js';
import {ExperimentBudget,EXPERIMENT_MODEL} from '../src/agent/experimentBudget.js';
import {PRICED_MODELS} from '../src/agent/modelPricing.js';
import {sha256} from '../src/agent/accountingStore.js';
import {digest} from '../src/agent/replay.js';
import {Society,societyConfig,verifySocietyTape,type SocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {createSocietyPlan,runAccountedSociety,societyPlanHash,validateSocietyPlan,type SocietyRunEvent} from '../src/society/accounted.js';
import {buildSocietyRequest,SOCIETY_INHABITANT_INSTRUCTIONS,SOCIETY_POSTCARD_INHABITANT_INSTRUCTIONS} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {parseSocietyEvidence,stringifySocietyEvidence} from '../src/society/codec.js';
import {buildSocietyResultsReport,writeSocietyRawResults,type SocietyCallReport} from '../src/society/report.js';
import type {Sender} from '../src/eval/accountedRunner.js';
import type {SocietyDailyOracleConfig} from '../src/society/dailyOracle.js';
import {ManualTickGate} from '../src/society/manualTicks.js';

const handles:{close():void}[]=[];
afterEach(()=>{for(const h of handles.splice(0))h.close();cleanup();});
const instruction='TEST ONLY SYNTHETIC POSTCARD APPROVAL. No actual provider, financial authority, credential or prior private account.';
const source='a'.repeat(40);
const postcardConfig={rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86_400_000 as const};
function fixture(ticks=3,dailyOracle?:SocietyDailyOracleConfig){
  const society=new Society({seed:42,sourceRevision:source,postcards:structuredClone(postcardConfig),
    ...(dailyOracle?{dailyOracle}:{}),
    config:{...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0}});
  const plan=createSocietyPlan(society,{id:'TEST-ONLY-accounted-postcards',ticks,minIntervalMs:0,deadlineMs:2000});
  const {ledger}=setup(),priorDirectory=join(root(),'TEST-ONLY-expired-prior');
  const prior=InitialTestBudget.create(priorDirectory,ledger.exportDocument()),now=Date.now(),day=86_400_000;
  prior.authorize({runId:'TEST-ONLY-expired-prior',authorizedAt:new Date(now-3*day).toISOString(),expiresAt:new Date(now-2*day).toISOString(),
    expectedHistoryHash:prior.view().historyHash,instruction,scope:'additional_initial_test_spending_only',model:EXPERIMENT_MODEL,
    maxRequests:5,limitMicroUsd:100000,perRequestMicroUsd:20000,
    prices:{model:EXPERIMENT_MODEL,inputMicroUsdPerMillionTokens:400000,outputMicroUsdPerMillionTokens:2500000,evidenceSha256:'a'.repeat(64)}});
  prior.close();
  const budget=ExperimentBudget.carryFromInitial(join(root(),'TEST-ONLY-postcard-budget'),priorDirectory);handles.push(budget);
  budget.authorize({runId:plan.id,authorizedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
    expectedCarriedFingerprint:budget.carriedFingerprint(),instruction,scope:'accounted_experiment_spending_only',manifestSha256:societyPlanHash(plan),
    model:plan.model,maxRequests:plan.maxCalls,limitMicroUsd:plan.allowance.limitMicroUsd,
    perRequestMicroUsd:plan.allowance.perRequestMicroUsd,prices:PRICED_MODELS[plan.model]!});
  const events:SocietyRunEvent[]=[],sent:Parameters<Sender>[0][]=[];
  const options={plan,ownerApproved:true,instruction,expectedCarriedFingerprint:budget.carriedFingerprint(),
    sink:(event:SocietyRunEvent)=>events.push(structuredClone(event))};
  const sender=(invalidAt?:number):Sender=>async input=>{
    validateSocietyWire(Buffer.from(input.body),input.sha256);sent.push(input);
    const view=JSON.parse(JSON.parse(input.body).messages[0].content[0].text),action=autonomousPolicy(view);
    if(input.index===invalidAt)action.postcards={claim:false,fusion:{tier:'orange',stake:1}};
    return Buffer.from(JSON.stringify({type:'message',role:'assistant',id:'msg_TEST_ONLY_postcard_'+input.index,
      model:plan.model,stop_reason:'end_turn',content:[
        {type:'thinking',thinking:'TEST ONLY synthetic returned postcard summary '+input.index+'.',signature:'TEST_ONLY_postcard_signature_'+input.index},
        {type:'text',text:JSON.stringify(action)}],usage:{input_tokens:1200,output_tokens:80}}));
  };
  return {society,plan,budget,events,sent,options,sender};
}
const eventText=(events:SocietyRunEvent[])=>events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')+'\n';
function coldVerify(path:string,allowPartial=false){
  const script=[
    "import {readFileSync} from 'node:fs';",
    "import {parseSocietyEvidence} from './src/society/codec.ts';",
    "import {verifySocietyTape} from './src/society/runtime.ts';",
    'const {path,allowPartial}=JSON.parse(readFileSync(0,\'utf8\'));',
    "const tape=parseSocietyEvidence(readFileSync(path,'utf8'));",
    'process.stdout.write(JSON.stringify({format:tape.format,...verifySocietyTape(tape,tape.genesis.sourceRevision,{allowPartial})}));',
  ].join('\n');
  return JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type','module','--eval',script],
    {cwd:resolve('.'),input:JSON.stringify({path,allowPartial}),encoding:'utf8',windowsHide:true}));
}

describe('production postcard accounted path with disposable synthetic approvals only',()=>{
  it('waits without requests or reservations and advances exactly one approved day per manual permit',async()=>{
    const f=fixture(2),gate=new ManualTickGate(),controller=new AbortController();
    const running=runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:controller.signal,
      awaitDayPermit:(day,signal)=>gate.wait(day,signal)});
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(gate.state.waitingDay).toBe(1);expect(f.sent).toHaveLength(0);expect(f.budget.view().requests).toHaveLength(0);
    gate.advance(1);expect(()=>gate.advance(1)).toThrow('society_tick_not_waiting');
    for(let i=0;i<100&&gate.state.waitingDay!==2;i++)await new Promise(resolve=>setTimeout(resolve,5));
    expect(f.society.tick).toBe(1);expect(f.sent).toHaveLength(6);expect(gate.state.waitingDay).toBe(2);
    expect(()=>gate.advance(1)).toThrow('society_tick_not_waiting');
    gate.advance(2);const result=await running;gate.close();
    expect(result).toMatchObject({status:'completed',ticks:2,calls:12});
  });
  it('cancels while awaiting a manual permit with no paid call or held reservation',async()=>{
    const f=fixture(2),gate=new ManualTickGate(),controller=new AbortController();
    const running=runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:controller.signal,
      awaitDayPermit:(day,signal)=>gate.wait(day,signal)});
    controller.abort();const result=await running;gate.close();
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',ticks:0,calls:0,heldMicroUsd:'0'});
    expect(f.sent).toHaveLength(0);expect(f.society.halted).toBe(true);
  });
  it('runs the actual daily Oracle eight-field worker/accounting/raw-export path for eighteen synthetic responses',async()=>{
    const dailyOracle=JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8')) as SocietyDailyOracleConfig;
    const f=fixture(3,dailyOracle),result=await runAccountedSociety(f.society,f.budget,f.sender(),f.options);
    expect(f.plan.schema).toBe('node-accounted-society-daily-oracle-v3');expect(f.plan.dailyOracle).toEqual(dailyOracle);
    expect(result).toMatchObject({status:'completed',calls:18,ticks:3,heldMicroUsd:'0'});
    const tape=f.society.exportTape();expect(verifySocietyTape(tape).verified).toBe(true);
    expect(tape.dailyOracleState!.treasuryMicro).toBeLessThan(dailyOracle.treasuryMicro);
    for(const sent of f.sent){const wire=JSON.parse(sent.body),view=JSON.parse(wire.messages[0].content[0].text);
      expect(wire.output_config.format.schema.required).toHaveLength(8);expect(view.dailyOracle.entryCost).toBe(0);
      expect(view).not.toHaveProperty('dailyOracleState');expect(view.dailyOracle).not.toHaveProperty('treasuryMicro');}
    const report=buildSocietyResultsReport({eventsText:eventText(f.events),tape,summary:result});
    expect(report.counts.integrityIssues).toBe(0);
    expect(report.agents.every(a=>a.records.every(r=>(r.submittedAction as any).dailyOracle!==undefined))).toBe(true);
    writeSocietyRawResults(report,join(root(),'TEST-ONLY-daily-oracle-raw'));
  });
  it('uses real seven-field requests, final egress validation, accounting and cold replay for three ticks/eighteen fixture calls',async()=>{
    const f=fixture(),result=await runAccountedSociety(f.society,f.budget,f.sender(),f.options);
    expect(f.plan.schema).toBe('node-accounted-society-postcards-v2');expect(f.plan.postcards).toEqual(postcardConfig);
    expect(result).toMatchObject({status:'completed',calls:18,ticks:3,heldMicroUsd:'0'});
    expect(f.sent).toHaveLength(18);expect(BigInt(result.bookedMicroUsd)).toBeGreaterThan(0n);
    for(const sent of f.sent){
      const wire=JSON.parse(sent.body),view=JSON.parse(wire.messages[0].content[0].text);
      expect(wire.system).toBe(SOCIETY_POSTCARD_INHABITANT_INSTRUCTIONS);expect(wire).not.toHaveProperty('tools');
      expect(wire.output_config.format.schema.required).toEqual(['move','communication','diary','occupation','purchase','oracle','postcards']);
      expect(view.postcards).toBeDefined();expect(view).not.toHaveProperty('sourceRevision');expect(view).not.toHaveProperty('worldHash');
      for(const key of ['seed','drawCount','rngVersion','transactions','origin','issuedWhite','burnedWhite','requestId','agentId'])
        expect(JSON.stringify(wire.messages)).not.toContain('"'+key+'"');
      expect(JSON.stringify(wire.messages)).not.toContain(instruction);
    }
    const tape=f.society.exportTape();expect(tape.format).toBe('node-society-postcards-v2');
    expect(tape.decisions.filter(d=>d.controlled)).toHaveLength(18);
    expect(tape.decisions.every(d=>Object.keys(d.action).length===7)).toBe(true);
    expect(tape.decisions.some(d=>!d.controlled&&d.action.postcards?.claim)).toBe(true);
    expect(tape.transitions.some(t=>t.postcards?.some(p=>p.event.kind==='claim'))).toBe(true);
    expect(tape.transitions.some(t=>t.postcards?.some(p=>p.event.kind==='safeFusion'))).toBe(true);
    expect(tape.postcardAccounts!.some(([,a])=>a.held.green>0)).toBe(true);
    const path=join(root(),'actual-v2-tape.json');writeFileSync(path,stringifySocietyEvidence(tape));
    expect(coldVerify(path)).toMatchObject({format:'node-society-postcards-v2',verified:true,ticks:3,finalHash:result.finalHash});
    expect(parseSocietyEvidence<SocietyTape>(readFileSync(path,'utf8'))).toEqual(tape);
  },20_000);
  it('raw-exports each controlled identity in chronological order with exact contexts, returned summaries, seven-field actions and card transitions',async()=>{
    const f=fixture(),summary=await runAccountedSociety(f.society,f.budget,f.sender(),f.options),tape=f.society.exportTape();
    expect(summary.status).toBe('completed');
    const report=buildSocietyResultsReport({eventsText:eventText(f.events),tape,summary});
    expect(report.counts).toEqual({recordedCalls:18,responsesAvailable:18,tapeAdmissions:18,dailyTransitions:3,integrityIssues:0});
    const paths=writeSocietyRawResults(report,join(root(),'raw-only'));expect(paths.agents).toHaveLength(3);
    expect(existsSync(join(paths.outputDirectory,'report.md'))).toBe(false);
    for(const [i,path]of paths.agents.entries()){
      const records=readFileSync(path.jsonl,'utf8').trim().split('\n').map(line=>parseSocietyEvidence<SocietyCallReport>(line));
      expect(records).toEqual(report.agents[i]!.records);expect(records).toHaveLength(6);
      expect(records.map(r=>[r.day,r.phase])).toEqual([[1,'commit'],[1,'act'],[2,'commit'],[2,'act'],[3,'commit'],[3,'act']]);
      for(const r of records){
        expect(r.request.exactVisibleText).toBe(JSON.stringify(r.authorizedVisible));
        expect((r.authorizedVisible as any).postcards).toBeDefined();
        expect(Object.keys(r.submittedAction as object)).toHaveLength(7);
        expect(r.reasoning.summaries).toEqual(['TEST ONLY synthetic returned postcard summary '+r.requestIndex+'.']);
        expect(r.worldTransition!.postcards!.some(p=>p.person===r.person)).toBe(true);
      }
    }
  },20_000);
  it('books known usage, preserves invalid response and stops after the first rejected postcard action with replayable partial evidence',async()=>{
    const f=fixture(),summary=await runAccountedSociety(f.society,f.budget,f.sender(9),f.options);
    expect(summary).toMatchObject({status:'stopped',calls:10,finalTick:1,heldMicroUsd:'0'});
    expect(f.society.halted).toBe(true);expect(f.sent).toHaveLength(10);expect(f.budget.view().requests).toHaveLength(10);
    expect(BigInt(summary.bookedMicroUsd)).toBeGreaterThan(0n);
    const response=f.events.filter(e=>e.kind==='response').at(-1)!.data as any;
    const raw=JSON.parse(Buffer.from(response.rawBase64,'base64').toString());
    expect(raw.usage).toEqual({input_tokens:1200,output_tokens:80});
    expect(JSON.parse(raw.content.find((c:any)=>c.type==='text').text).postcards.fusion.tier).toBe('orange');
    const outcome=f.events.filter(e=>e.kind==='outcome').at(-1)!.data as any;
    expect(outcome).toMatchObject({status:'illegal_action',requestBooked:true,beforeTick:1,afterTick:1});
    expect(outcome.beforeHash).toBe(outcome.afterHash);expect(summary.finalHash).toBe(outcome.beforeHash);
    // Fourteen residents act plus three occupational commits on day one, followed
    // by three admitted commits before the first rejected day-two act response.
    const tape=f.society.exportTape();expect(tape.decisions).toHaveLength(20);
    expect(tape.decisions.filter(d=>d.day===2&&d.phase==='act')).toHaveLength(0);
    const path=join(root(),'partial-v2-tape.json');writeFileSync(path,stringifySocietyEvidence(tape));
    expect(coldVerify(path,true)).toMatchObject({verified:true,ticks:1,complete:false,finalHash:summary.finalHash});
    expect(()=>verifySocietyTape(tape)).toThrow('society_replay_mismatch');
    const report=buildSocietyResultsReport({eventsText:eventText(f.events),tape,summary});
    const rejected=report.agents.flatMap(a=>a.records).find(r=>r.requestIndex===9)!;
    expect(rejected.admission).toBe('not_recorded');expect(rejected.submittedAction).toBeNull();
    expect(rejected.response.rawBase64).toBe(response.rawBase64);expect(rejected.worldTransition).toBeNull();
    await expect(runAccountedSociety(f.society,f.budget,f.sender(),f.options)).rejects.toThrow();expect(f.sent).toHaveLength(10);
  },20_000);
  it('pins the postcard feature/config in plan and refuses mismatch before reservation or sender invocation',async()=>{
    const f=fixture(),legacy=new Society({seed:42,sourceRevision:source});
    const legacyPlan=createSocietyPlan(legacy);expect(legacyPlan.schema).toBe('node-accounted-society-v1');expect(legacyPlan).not.toHaveProperty('postcards');
    const altered=structuredClone(f.plan);altered.postcards!.rate={numerator:3,denominator:1};
    expect(societyPlanHash(altered)).not.toBe(societyPlanHash(f.plan));
    await expect(runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,plan:altered})).rejects.toThrow('society_paid_postcard_config');
    const stripped=structuredClone(f.plan);delete stripped.postcards;stripped.schema='node-accounted-society-v1';
    await expect(runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,plan:stripped})).rejects.toThrow('society_paid_postcard_config');
    expect(()=>validateSocietyPlan({...f.plan,postcards:undefined})).toThrow();
    expect(()=>validateSocietyPlan({...f.plan,schema:'node-accounted-society-v1'})).toThrow();
    await expect(runAccountedSociety(legacy,f.budget,f.sender(),f.options)).rejects.toThrow();
    expect(f.sent).toHaveLength(0);expect(f.budget.view().requests).toHaveLength(0);
    expect(f.society.exportTape().postcardConfig).toEqual(postcardConfig);
  });
  it('rejects forbidden metadata, altered schema and legacy instructions at the final worker boundary using only pure validation',()=>{
    const society=new Society({seed:42,sourceRevision:source,postcards:postcardConfig}),person=society.pendingPeople()[0]!;
    const view=society.view(person).visible,wire=buildSocietyRequest(view);expect(()=>validateSocietyWire(Buffer.from(wire.body),wire.sha256)).not.toThrow();
    const mutate=(edit:(q:any)=>void)=>{const q=JSON.parse(wire.body);edit(q);const bytes=Buffer.from(JSON.stringify(q));expect(()=>validateSocietyWire(bytes,sha256(bytes))).toThrow();};
    mutate(q=>{q.system=SOCIETY_INHABITANT_INSTRUCTIONS;});
    mutate(q=>{q.tools=[{name:'read_file'}];});
    mutate(q=>{q.output_config.format.schema.required.pop();});
    mutate(q=>{q.output_config.format.schema.properties.postcards={type:'object',additionalProperties:true};});
    for(const key of ['seed','drawCount','origin','transactions','issuedWhite','burnedWhite','worldHash','sourceRevision'])
      mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.postcards[key]='PRIVATE_OPERATOR_STATE';q.messages[0].content[0].text=JSON.stringify(v);});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.postcards.rules+=' Development update';q.messages[0].content[0].text=JSON.stringify(v);});
    expect(()=>validateSocietyWire(Buffer.from(wire.body),'0'.repeat(64))).toThrow('society_worker_request_binding');
    expect(digest(view)).toBe(digest(society.view(person).visible));
  });
});
