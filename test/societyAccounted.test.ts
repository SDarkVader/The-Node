import {validatePerception,PERCEPTION_PROFILE,PERCEPTION_SCHEMA,effectiveRange} from '../src/observatory/perception.js';
import {validateNavigation,NAVIGATION_PROFILE} from '../src/observatory/navigation.js';
import {shortestGridPath} from '../src/engine/navigation.js';
import {readFileSync} from 'node:fs';
import {openSocietySenses} from '../src/society/senses.js';
import {recoverSocietySubmissions} from '../src/society/submissionRecovery.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { root, setup, cleanup } from './fixtures/accountingFixture.js';
import { InitialTestBudget } from '../src/agent/initialTestBudget.js';
import { ExperimentBudget, EXPERIMENT_MODEL } from '../src/agent/experimentBudget.js';
import { PRICED_MODELS } from '../src/agent/modelPricing.js';
import { Society, verifySocietyTape, societyConfig } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { createSocietyPlan, runAccountedSociety, societyPlanHash, type SocietyRunEvent } from '../src/society/accounted.js';
import type { Sender } from '../src/eval/accountedRunner.js';
import { parseSocietyEvidence, stringifySocietyEvidence } from '../src/society/codec.js';
import { emptySocietyAction } from '../src/society/policy.js';

const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
const instruction = 'TEST ONLY SYNTHETIC APPROVAL. No actual provider, financial authority, prior account or credential.';
function fixture(ticks = 3, deadlineMs = 2000, minIntervalMs = 0, natural = false, dual=false, competitive=false, routineOnly=false) {
  const config = { ...societyConfig(), pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 };
  const society = new Society({ seed: 42, sourceRevision: 'a'.repeat(40), config: natural ? societyConfig() : config,...(competitive?{competitiveGrifter:true as const}:{}),...(routineOnly?{routine:{maxTurnsPerDay:64}}:{}),...(dual?{
    routine:{maxTurnsPerDay:64,information:'inhabitant-v1' as const,navigation:'dual-v1' as const},
    postcards:{rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000 as const},
    dailyOracle:JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8'))}:{} ) });
  const plan = createSocietyPlan(society, { id: 'TEST-ONLY-safe-society', ticks, minIntervalMs, deadlineMs });
  const { ledger } = setup(), priorDirectory = join(root(), 'TEST-ONLY-initial-allowance');
  const prior = InitialTestBudget.create(priorDirectory, ledger.exportDocument()), now = Date.now(), day = 86_400_000;
  prior.authorize({ runId: 'TEST-ONLY-expired-prior', authorizedAt: new Date(now - 3 * day).toISOString(), expiresAt: new Date(now - 2 * day).toISOString(),
    expectedHistoryHash: prior.view().historyHash, instruction, scope: 'additional_initial_test_spending_only',
    model: EXPERIMENT_MODEL, maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000,
    prices: { model: EXPERIMENT_MODEL, inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) } });
  prior.close();
  const budget = ExperimentBudget.carryFromInitial(join(root(), 'TEST-ONLY-society-allowance'), priorDirectory); handles.push(budget);
  budget.authorize({ runId: 'TEST-ONLY-safe-society', authorizedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    expectedCarriedFingerprint: budget.carriedFingerprint(), instruction, scope: 'accounted_experiment_spending_only',
    manifestSha256: societyPlanHash(plan), model: plan.model, maxRequests: plan.maxCalls,
    limitMicroUsd: plan.allowance.limitMicroUsd, perRequestMicroUsd: plan.allowance.perRequestMicroUsd, prices: PRICED_MODELS[plan.model]! });
  const events: SocietyRunEvent[] = [], sent: Parameters<Sender>[0][] = [];
  const options = { plan, ownerApproved: true, instruction, expectedCarriedFingerprint: budget.carriedFingerprint(),
    sink: (event: SocietyRunEvent) => events.push(structuredClone(event)) };
  const sender = (fault?: 'transport' | 'unknown' | 'model' | 'tool' | 'action' | 'overrun' | 'deadline'): Sender => async (input, signal) => {
    sent.push(input);
    if (fault === 'transport') throw Error('TEST_ONLY_transport_failure');
    if (fault === 'deadline') return new Promise<Buffer>((_, reject) => signal.addEventListener('abort', () => reject(Error('TEST_ONLY_aborted'))));
    const visible = JSON.parse(JSON.parse(input.body).messages[0].content[0].text);
    const action = autonomousPolicy(visible);
    const content: unknown[] = [{ type: 'thinking', thinking: 'TEST ONLY synthetic response summary.', signature: 'TEST_ONLY_signature_' + input.index }];
    if (fault === 'tool') content.push({ type: 'tool_use', name: 'read_file', id: 'TEST_ONLY_tool', input: { path: '.env' } });
    content.push({ type: 'text', text: JSON.stringify(fault === 'action' ? { ...action, hostOperation: 'exec' } : action) });
    return Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', id: 'msg_TEST_ONLY_society_' + input.index,
      model: fault === 'model' ? 'wrong-model' : plan.model, stop_reason: 'end_turn', content,
      usage: fault === 'unknown' ? null : { input_tokens: 1200, output_tokens: fault === 'overrun' ? JSON.parse(input.body).max_tokens+1 : 80 } }));
  };
  return { society, plan, budget, events, options, sent, sender };
}

describe('accounted society, fake provider and disposable money fixtures only', () => {
  it('accounts for and replays a fourth controlled inhabitant with shared competitive instructions', async () => {
    const f = fixture(1, 2000, 0, false, false, true);
    expect(f.plan.maxCalls).toBe(7);
    const result = await runAccountedSociety(f.society, f.budget, f.sender(), f.options);
    expect(result).toMatchObject({status:'completed',calls:7,ticks:1,heldMicroUsd:'0'});
    const systems=f.sent.map(q=>JSON.parse(q.body).system);
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toContain('influence anyone');
    expect(f.society.exportTape().decisions.some(d=>d.person===f.plan.controlled[3]&&d.controlled)).toBe(true);
    expect(verifySocietyTape(f.society.exportTape()).verified).toBe(true);
  });
  it('recovers a partial competitive routine without fabricating a day or reputation', async () => {
    const f=fixture(1,2000,0,false,false,true,true), controller=new AbortController();
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:controller.signal,sink:event=>{
      f.options.sink(event);
      if(event.kind==='submission')controller.abort();
    }});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',ticks:0});
    const tape=f.society.exportTape();
    expect(tape.transitions).toHaveLength(0);
    expect(recoverSocietySubmissions(f.events,tape.genesis.sourceRevision)).toEqual(tape);
    expect(verifySocietyTape(tape,tape.genesis.sourceRevision,{allowPartial:true}).verified).toBe(true);
  });
  it('completes three deterministic ticks with two model-fixture Bakers, one Miller and autonomous others', async () => {
    const f = fixture();
    const result = await runAccountedSociety(f.society, f.budget, f.sender(), f.options);
    expect(result).toMatchObject({ status: 'completed', calls: 18, ticks: 3, heldMicroUsd: '0' });
    expect(f.sent).toHaveLength(18);
    expect(f.events.filter(e => e.kind === 'request')).toHaveLength(18);
    expect(f.events.filter(e => e.kind === 'response')).toHaveLength(18);
    const tape = f.society.exportTape();
    expect(tape.decisions.filter(d => d.controlled)).toHaveLength(18);
    expect(tape.decisions.some(d => !d.controlled && d.action.occupation?.kind === 'work')).toBe(true);
    expect(verifySocietyTape(tape)).toMatchObject({ verified: true, ticks: 3 });
    const streams = f.budget.view().requests.map(q => [q.request.episodeId, q.request.actorId, q.request.participant.tick]);
    expect(new Set(streams.map(x => JSON.stringify(x))).size).toBe(18);
    expect(new Set(streams.map(x => x[0]))).toEqual(new Set([f.plan.id + ':commit', f.plan.id + ':act']));
    for (const sent of f.sent) {
      const wire = JSON.parse(sent.body), visible = JSON.parse(wire.messages[0].content[0].text);
      expect(wire.messages).toHaveLength(1); expect(wire).not.toHaveProperty('tools');
      expect(visible).not.toHaveProperty('requestId'); expect(visible).not.toHaveProperty('worldHash');
      expect(JSON.stringify(wire.messages)).not.toContain(instruction);
      expect(JSON.stringify(wire.messages)).not.toContain('TEST_ONLY_signature');
      expect(wire.max_tokens).toBe(16384);
    }
    expect(f.budget.view().requests.every(q=>q.request.maxOutputTokens===16384)).toBe(true);
    expect(createSocietyPlan(f.society).deadlineMs).toBe(120000);
    expect(f.plan.allowance.perRequestMicroUsd).toBe(32000);
    const duplicate = fixture();
    const replayed = await runAccountedSociety(duplicate.society, duplicate.budget, duplicate.sender(), duplicate.options);
    expect(replayed.finalHash).toBe(result.finalHash);
    expect(duplicate.society.exportTape()).toEqual(tape);
  });

  it('refuses absent approval, altered plan, instruction or carried provenance before reserving', async () => {
    const f = fixture();
    for (const change of [{ ownerApproved: false }, { instruction: 'unapproved instruction' }, { expectedCarriedFingerprint: 'f'.repeat(64) },
      { plan: { ...f.plan, initialHash: 'f'.repeat(64) } }, { plan: { ...f.plan, ticks: 21, maxCalls: 126 } }]) {
      await expect(runAccountedSociety(f.society, f.budget, f.sender(), { ...f.options, ...change })).rejects.toThrow();
    }
    expect(f.sent).toHaveLength(0); expect(f.budget.view().requests).toHaveLength(0);
  });

  it.each(['transport', 'unknown', 'model', 'deadline'] as const)('stops once and retains the full unknown hold on %s', async fault => {
    const f = fixture(1, fault === 'deadline' ? 10 : 2000);
    const result = await runAccountedSociety(f.society, f.budget, f.sender(fault), f.options);
    expect(result).toMatchObject({ status: 'stopped', calls: 1, finalTick: 0 });
    expect(f.sent).toHaveLength(1); expect(f.budget.view().requests).toHaveLength(1);
    expect(BigInt(result.heldMicroUsd)).toBeGreaterThan(0n); expect(f.society.halted).toBe(true);
    await expect(runAccountedSociety(f.society, f.budget, f.sender(), f.options)).rejects.toThrow();
    expect(f.sent).toHaveLength(1);
  });

  it.each(['tool', 'action', 'overrun'] as const)('books recognizable usage before rejecting %s and halts without world execution', async fault => {
    const f = fixture(1);
    const result = await runAccountedSociety(f.society, f.budget, f.sender(fault), f.options);
    expect(result).toMatchObject({ status: 'stopped', calls: 1, finalTick: 0, heldMicroUsd: '0' });
    expect(BigInt(result.bookedMicroUsd)).toBeGreaterThan(0n);
    expect(f.society.halted).toBe(true); expect(f.society.exportTape().decisions).toHaveLength(0);
    expect(f.events.some(e => e.kind === 'response')).toBe(true);
  });

  it('retains known usage if the operator response sink fails, and spends nothing when the request sink fails', async () => {
    const f = fixture(1);
    const result = await runAccountedSociety(f.society, f.budget, f.sender(), { ...f.options, sink: e => {
      if (e.kind === 'response') throw Error('TEST_ONLY_evidence_failure');
    } });
    expect(result).toMatchObject({ status: 'stopped', calls: 1, finalTick: 0, heldMicroUsd: '0' });
    expect(BigInt(result.bookedMicroUsd)).toBeGreaterThan(0n);
    const second = fixture(1);
    const result2 = await runAccountedSociety(second.society, second.budget, second.sender(), { ...second.options, sink: e => {
      if (e.kind === 'request') throw Error('TEST_ONLY_evidence_failure');
    } });
    expect(result2).toMatchObject({ status: 'stopped', calls: 0, heldMicroUsd: '0' });
    expect(second.budget.view().requests).toHaveLength(0);
  });

  it('snapshots the approved plan and protects it from caller or evidence callback mutation', async () => {
    const f = fixture(1), send = f.sender();
    const result = await runAccountedSociety(f.society, f.budget, async (input, signal) => {
      f.options.plan.ticks = 100; f.options.plan.controlled.length = 0;
      return send(input, signal);
    }, { ...f.options, sink: event => {
      if (event.kind === 'start') {
        const data = event.data as { plan: { ticks: number; controlled: string[] } };
        data.plan.ticks = 100; data.plan.controlled.length = 0;
      }
    } });
    expect(result).toMatchObject({ status: 'completed', finalTick: 1, calls: 6 });
  });

  it('halts and reports a final evidence write failure after booking all known usage', async () => {
    const f = fixture(1);
    const result = await runAccountedSociety(f.society, f.budget, f.sender(), { ...f.options, sink: e => {
      if (e.kind === 'finish') throw Error('TEST_ONLY_finish_failure');
    } });
    expect(result).toMatchObject({ status: 'stopped', stoppedReason: 'TEST_ONLY_finish_failure', calls: 6, heldMicroUsd: '0' });
    expect(f.society.halted).toBe(true);
  });

  it('completes and losslessly reproduces twenty ticks with no more than120 calls and unchanged three-person control', async () => {
    const f=fixture(20),second=fixture(20);
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),f.options);
    const repeated=await runAccountedSociety(second.society,second.budget,second.sender(),second.options);
    expect(result).toMatchObject({status:'completed',calls:120,finalTick:20,heldMicroUsd:'0'});
    expect(repeated.finalHash).toBe(result.finalHash);
    const tape=f.society.exportTape(),roundTrip=parseSocietyEvidence<typeof tape>(stringifySocietyEvidence(tape));
    expect(second.society.exportTape()).toEqual(tape);
    expect(verifySocietyTape(roundTrip)).toMatchObject({verified:true,ticks:20});
    expect(tape.controlled).toEqual(f.plan.controlled);
    for(const kind of ['request','reserved','dispatched','response','decision','outcome'])expect(f.events.filter(e=>e.kind===kind)).toHaveLength(120);
    const outcomes=f.events.filter(e=>e.kind==='outcome').map(e=>e.data as {status:string;requestBooked:boolean});
    expect(outcomes.every(o=>o.status==='submitted'&&o.requestBooked)).toBe(true);
  },30_000);

  it('keeps the same model-controlled people through ordinary twenty-day churn and never manufactures replacement model calls',async()=>{
    const f=fixture(20,2000,0,true),initial=f.society.controlled;
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),f.options);
    expect(result).toMatchObject({status:'completed',finalTick:20,heldMicroUsd:'0'});
    expect(result.calls).toBeLessThanOrEqual(120);
    expect(f.society.controlled).toEqual(initial);
    expect(f.sent.every(s=>initial.includes(s.actorId))).toBe(true);
    expect(verifySocietyTape(f.society.exportTape()).verified).toBe(true);
  },20_000);

  it('cancels before starting without reserving or sending',async()=>{
    const f=fixture(1),abort=new AbortController();abort.abort();
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:abort.signal});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:0,finalTick:0,heldMicroUsd:'0'});
    expect(f.budget.view().requests).toHaveLength(0);expect(f.sent).toHaveLength(0);
  });

  it('cancels pacing without a second reservation or provider attempt',async()=>{
    const f=fixture(1,2000,500),abort=new AbortController();
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:abort.signal,sink:event=>{
      f.options.sink(event);
      if(event.kind==='request'&&(event.data as {index:number}).index===1)setImmediate(()=>abort.abort());
    }});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:1,finalTick:0,heldMicroUsd:'0'});
    expect(f.budget.view().requests).toHaveLength(1);expect(f.sent).toHaveLength(1);
    expect((f.events.filter(e=>e.kind==='outcome').at(-1)!.data as {stage:string}).stage).toBe('prepared');
  });

  it('books a usable same-turn response after synchronous cancellation but executes no action',async()=>{
    const f=fixture(1),abort=new AbortController(),send=f.sender();
    const result=await runAccountedSociety(f.society,f.budget,async(input,signal)=>{
      const response=await send(input,signal);abort.abort();return response;
    },{...f.options,signal:abort.signal});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:1,finalTick:0,heldMicroUsd:'0'});
    expect(BigInt(result.bookedMicroUsd)).toBeGreaterThan(0n);
    expect(f.society.exportTape().decisions).toHaveLength(0);
    expect((f.events.find(e=>e.kind==='outcome')!.data as {status:string}).status).toBe('cancelled');
  });

  it('cancels an in-flight sender that ignores abort and retains its unresolved hold',async()=>{
    const f=fixture(1),abort=new AbortController();
    const result=await runAccountedSociety(f.society,f.budget,async()=>{
      setImmediate(()=>abort.abort());return new Promise<Buffer>(()=>{});
    },{...f.options,signal:abort.signal});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:1,finalTick:0});
    expect(BigInt(result.heldMicroUsd)).toBeGreaterThan(0n);
    expect((f.events.find(e=>e.kind==='outcome')!.data as {requestBooked:boolean}).requestBooked).toBe(false);
  });

  it('checks cancellation again after the validated-decision evidence callback',async()=>{
    const f=fixture(1),abort=new AbortController();
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:abort.signal,sink:event=>{
      f.options.sink(event);if(event.kind==='decision')abort.abort();
    }});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:1,finalTick:0,heldMicroUsd:'0'});
    expect(f.society.exportTape().decisions).toHaveLength(0);
    expect((f.events.find(e=>e.kind==='outcome')!.data as {stage:string}).stage).toBe('validated');
  });

  it('preserves the raw response and full outstanding hold when duplicate receipts cannot be booked',async()=>{
    const f=fixture(1),send=f.sender();
    const result=await runAccountedSociety(f.society,f.budget,async(input,signal)=>{
      const parsed=JSON.parse((await send(input,signal)).toString());parsed.id='msg_TEST_ONLY_society_0';return Buffer.from(JSON.stringify(parsed));
    },f.options);
    expect(result).toMatchObject({status:'stopped',calls:2,finalTick:0});
    expect(BigInt(result.heldMicroUsd)).toBeGreaterThan(0n);
    const response=f.events.filter(e=>e.kind==='response').at(-1)!.data as {rawBase64:string;bookingError:string|null};
    expect(response.rawBase64.length).toBeGreaterThan(0);expect(response.bookingError).not.toBeNull();
    expect((f.events.filter(e=>e.kind==='outcome').at(-1)!.data as {status:string}).status).toBe('booking_failed');
  });

  it('detects a changed pending queue even when the world hash, day and phase are unchanged',async()=>{
    const f=fixture(1),send=f.sender(),before=f.society.hash;
    const result=await runAccountedSociety(f.society,f.budget,async(input,signal)=>{
      const other=f.society.pendingPeople().find(p=>p!==input.actorId)!;
      f.society.submit(other,emptySocietyAction());expect(f.society.hash).toBe(before);
      return send(input,signal);
    },f.options);
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_stale_response',calls:1,heldMicroUsd:'0'});
    const tape=f.society.exportTape();expect(tape.decisions).toHaveLength(1);
    expect(verifySocietyTape(tape,tape.genesis.sourceRevision,{allowPartial:true})).toMatchObject({verified:true,complete:false,ticks:0});
    expect(()=>verifySocietyTape(tape)).toThrow('society_replay_mismatch');
  });

  it('recovers an undelivered raw response in finish evidence without changing its booked usage',async()=>{
    const f=fixture(1),events:SocietyRunEvent[]=[];
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,sink:event=>{
      if(event.kind==='response')throw Error('TEST_ONLY_response_sink_failed');events.push(event);
    }});
    expect(result).toMatchObject({status:'stopped',calls:1,heldMicroUsd:'0'});
    const finish=events.find(e=>e.kind==='finish')!.data as {undeliveredEvents:SocietyRunEvent[]};
    const recovered=finish.undeliveredEvents.find(e=>e.kind==='response')!.data as {rawBase64:string};
    expect(JSON.parse(Buffer.from(recovered.rawBase64,'base64').toString()).usage.input_tokens).toBe(1200);
  });

  it('stops at the final twentieth-day decision boundary without advancing a cancelled day',async()=>{
    const f=fixture(20),abort=new AbortController();
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:abort.signal,sink:event=>{
      f.options.sink(event);
      if(event.kind==='decision'&&(event.data as {index:number}).index===119)abort.abort();
    }});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',calls:120,finalTick:19,heldMicroUsd:'0'});
    const tape=f.society.exportTape();expect(tape.transitions).toHaveLength(19);
    expect(verifySocietyTape(parseSocietyEvidence<typeof tape>(stringifySocietyEvidence(tape)),tape.genesis.sourceRevision,{allowPartial:true}))
      .toMatchObject({verified:true,complete:false,ticks:19});
    expect((f.events.filter(e=>e.kind==='outcome').at(-1)!.data as {status:string}).status).toBe('cancelled');
  },20_000);

  it('rejects evidence-callback pending-state mutation before reserving or dispatching',async()=>{
    const f=fixture(1);
    const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,sink:event=>{
      f.options.sink(event);
      if(event.kind==='request'){
        const person=(event.data as {actorId:string}).actorId;
        f.society.submit(f.society.pendingPeople().find(p=>p!==person)!,emptySocietyAction());
      }
    }});
    expect(result).toMatchObject({status:'stopped',stoppedReason:'society_stale_before_reservation',calls:0,heldMicroUsd:'0'});
    expect(f.sent).toHaveLength(0);expect(f.budget.view().requests).toHaveLength(0);
  });

  it('detaches every operator inspection and tape snapshot from the live world and pending revision',()=>{
    const f=fixture(1),hash=f.society.hash,revision=f.society.revision;
    const person=f.society.pendingPeople()[0]!,before=f.society.view(person).visible,inspection=f.society.inspect(),tape=f.society.exportTape();
    inspection.world.millers[0]!.wealth=123456;inspection.world.diary.clear();inspection.registry.people.clear();
    inspection.genesis.observerSecret='not the real observer secret';tape.controlled.length=0;tape.genesis.config.rBaker=999;
    expect(f.society.view(person).visible).toEqual(before);expect(f.society.hash).toBe(hash);expect(f.society.revision).toBe(revision);
  });
});


describe.skipIf(!process.env.NODE_GODOT_BIN)('production controller with real Godot and fake provider only',()=>{
  it('completes two days with postcards and daily Oracle, one request per decision, exact traces and recovered navigation',async()=>{
    const f=fixture(2,2000,0,false,true),senses=await openSocietySenses();
    let stopped=false;
    try{
      const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,...senses});
      expect(result.status).toBe('completed');expect(result.ticks).toBe(2);expect(f.sent.length).toBe(result.calls);
      const tape=f.society.exportTape(),trips=tape.decisions.filter(d=>d.navigation&&d.navigation.path.length>1);
      expect(trips.length).toBeGreaterThan(0);
      expect(tape.decisions.filter(d=>d.controlled)).toHaveLength(result.calls);
      for(const d of tape.decisions){expect(d.perception).toBeDefined();if(d.action.move)expect(d.navigation).toBeDefined();}
      expect(verifySocietyTape(tape).verified).toBe(true);
      expect(recoverSocietySubmissions(f.events,tape.genesis.sourceRevision)).toEqual(tape);
      const source=new SocietyObservatorySource({id:'dual-controller-test',directory:'unused',kind:'society',mode:'synthetic'},
        {read:()=>({tape,eventsText:f.events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')}),stop:()=>{stopped=true;}});
      expect(source.refresh()).toBe(true);expect(stopped).toBe(false);
      expect(senses.stats()).toMatchObject({refused:0,timedOut:0,unmatched:0});
    }finally{await senses.close();}
  },120000);
});


it('cancels during route computation before executing the already returned model destination',async()=>{
  const f=fixture(1,2000,0,false,true),controller=new AbortController();
  const result=await runAccountedSociety(f.society,f.budget,f.sender(),{...f.options,signal:controller.signal,
    perceive:async r=>{
      const response={type:'perception' as const,schema:PERCEPTION_SCHEMA,profile:PERCEPTION_PROFILE,requestId:r.requestId,agentId:r.agentId,tick:r.tick,worldHash:r.worldHash,perspective:r.perspective,
        engine:{name:'fixture',version:'synthetic'},observation:{effectiveRange:effectiveRange(r.condition),bodies:[],locations:[],environment:{localTensionBand:r.scene.districts.find(d=>d.id===r.scene.observer.districtId)?.tensionBand??null,weather:r.condition.weather.kind}}};
      return validatePerception(r,response,JSON.stringify(response));
    },
    navigate:async r=>{controller.abort();const response={type:'navigation',schema:'node-navigation-response-v1',profile:NAVIGATION_PROFILE,requestId:r.requestId,worldHash:r.worldHash,actorRef:r.actorRef,engine:{name:'fixture',version:'synthetic'},path:shortestGridPath(r.district.plots,r.from,r.to)};return validateNavigation(r,response,JSON.stringify(response));},
  });
  expect(result).toMatchObject({status:'stopped',stoppedReason:'society_cancelled',ticks:0,heldMicroUsd:'0'});
  expect(f.society.exportTape().decisions.every(d=>d.phase==='commit')).toBe(true);
  expect(f.sent.length).toBe(4);
});
