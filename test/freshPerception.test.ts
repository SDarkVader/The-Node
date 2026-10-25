import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from './fixtures/accountingFixture.js';
import { freshPerceptionFixture } from './fixtures/freshPerceptionFixture.js';
import { readContinuationLedger } from '../src/eval/continuationLedger.js';
import { runFreshPerception, verifyFreshPerception, recoverFreshPerception } from '../src/observatory/freshPerception.js';
import { DELIBERATION_TURN } from '../src/eval/continuationReasoning.js';
import { digest } from '../src/agent/replay.js';
import { readFileSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { ObservatorySource,points } from '../src/observatory/source.js';
import { evaluateContinuationDiary } from '../src/observatory/diaryEvaluation.js';
import { readEvaluations } from '../src/observatory/evaluations.js';
import { inspectFreshFunding } from '../src/observatory/freshReadiness.js';
import { spawnSync } from 'node:child_process';
const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
async function fixture(ticks = 2) { const f = await freshPerceptionFixture(ticks); handles.push(f.budget, f.ledger); return f; }
describe('fresh first-person reasoning condition, synthetic provider only', () => {
  it('refuses missing authorization mode and the obsolete observer argument shape before setup',()=>{
    for(const args of [[],['runtime','allowance','out','key','--owner-approved-fresh-20-ticks']]){
      const result=spawnSync(process.execPath,['scripts/run-fresh-reasoning-test.mjs',...args],{encoding:'utf8'});
      expect(result.status).toBe(1);expect(result.stderr).toContain('fresh_first_person_explicit_mode_required');
    }
  });
  it('executes twenty actual ticks with zero inherited model turns and uniform controls on all forty calls', async () => {
    const f = await fixture(20);
    const result = await runFreshPerception(f.plan, f.genesis, f.budget, f.sender(), f.ledger, f.workers, f.sourceRevision, f.options);
    f.ledger.close(); const events = readContinuationLedger(f.ledger.path), verified = verifyFreshPerception(events);
    expect(result).toMatchObject({ status: 'completed', calls: 40, startTick: 0, finalTick: 20, heldMicroUsd: '0' });
    expect(verified).toMatchObject({ verified: true, complete: true, summary: result });
    expect(events[0]!.kind).toBe('perception_fresh_start'); expect(events[0]!.data).not.toHaveProperty('parent');
    const systems = new Set<string>();
    for (const sent of f.sent) {
      const q = JSON.parse(sent.body), turn = JSON.parse(q.messages.at(-1).content[0].text); systems.add(q.system);
      expect(q).toMatchObject({ model: f.plan.model, max_tokens: 2048, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' } });
      expect(q.thinking).not.toHaveProperty('budget_tokens'); expect(turn.reasoningInstruction).toBe(DELIBERATION_TURN);
      expect(turn).not.toHaveProperty('observation'); expect(turn).not.toHaveProperty('conditionTransition');
      expect(q.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(sent.tick);
      if (sent.tick === 0) {
        expect(q.messages).toHaveLength(1); expect(turn.experimentStart.priorModelTurns).toBe(0);
        expect(turn.perceptionPacket.input).not.toHaveProperty('city');
        expect(turn.perceptionPacket.input.rules.visibility.perspective).toBe('first_person');
      }
    }
    expect(systems.size).toBe(1); expect(f.sent).toHaveLength(40);
    const receipts = events.filter(e => e.kind === 'perception_receipt');
    expect(receipts.filter(e => e.data.actorId === 'baker-0' && e.data.parsed.reasoning.status === 'summary_returned')).toHaveLength(20);
    expect(receipts.filter(e => e.data.actorId === 'baker-1' && e.data.parsed.reasoning.status === 'not_returned')).toHaveLength(10);
    expect(events.filter(e => e.kind === 'perception_transition').some(e => e.data.tapeTick.actions.some((a: any) => a.decision.move))).toBe(true);
    for (const kind of ['perception_fresh_start', 'perception_request', 'perception_response', 'perception_transition']) {
      const index = events.findIndex(e => e.kind === kind);
      expect(recoverFreshPerception(events.slice(0, index + 1), true).verified).toBe(true);
    }
  });
  it.each(['transport', 'unknown_usage', 'wrong_model'] as const)('preserves holds and stops without advancing or retrying on %s', async fault => {
    const f = await fixture();
    const result = await runFreshPerception(f.plan, f.genesis, f.budget, f.sender(fault), f.ledger, f.workers, f.sourceRevision, f.options);
    f.ledger.close(); expect(result.calls).toBe(1); expect(result.finalTick).toBe(0); expect(f.sent).toHaveLength(1);
    expect(BigInt(result.heldMicroUsd)).toBeGreaterThan(0n);
    expect(verifyFreshPerception(readContinuationLedger(f.ledger.path)).verified).toBe(true);
  });
  it('rejects a changed reasoning profile before reserving and rejects rehashed fabricated memory', async () => {
    const f = await fixture(1);
    await expect(runFreshPerception({ ...f.plan, reasoningProfile: 'other' as any }, f.genesis, f.budget, f.sender(), f.ledger, f.workers, f.sourceRevision, f.options)).rejects.toThrow();
    expect(f.budget.view().requests).toHaveLength(0);
    await runFreshPerception(f.plan, f.genesis, f.budget, f.sender(), f.ledger, f.workers, f.sourceRevision, f.options); f.ledger.close();
    const events = readContinuationLedger(f.ledger.path); events[0]!.data.parent = { fabricated: true };
    let previous = '0'.repeat(64);
    for (const [i,e] of events.entries()) { e.previous = previous; e.hash = digest([i,previous,e.kind,e.data]); previous = e.hash; }
    expect(() => verifyFreshPerception(events)).toThrow('fresh_perception_start');
  });
  it('synchronizes researcher/public worlds, attributes applicability separately and binds only the latest journal', async () => {
    const f=await fixture(1);await runFreshPerception(f.plan,f.genesis,f.budget,f.sender(),f.ledger,f.workers,f.sourceRevision,f.options);f.ledger.close();
    const directory=dirname(dirname(f.ledger.path)),journal=join(directory,'TEST-ONLY-fresh-allowance','accounting.journal.json');
    const events=readContinuationLedger(f.ledger.path),source=new ObservatorySource({id:'test-first-person',ledger:f.ledger.path,sourceRevision:f.sourceRevision,journal});source.refresh();
    const privateView=source.snapshot(null,'TEST-ONLY-view-secret',true),publicView=source.snapshot(null,'TEST-ONLY-view-secret',false);
    expect(privateView.worldHash).toBe(publicView.worldHash);expect(privateView.sourceTick).toBe(1);expect(publicView).not.toHaveProperty('calls');
    expect(JSON.stringify(privateView)).not.toContain('TEST_ONLY_signature');
    expect(privateView).toMatchObject({telemetry:{callAttemptCount:2,executedDecisionCount:2},accounting:{status:'matches_latest_ledger'}});
    const evaluation=evaluateContinuationDiary(events,'test-first-person');expect(evaluation.records.every(r=>r.status==='not_applicable'&&r.value===null)).toBe(true);
    const output=join(directory,'diary-evaluation.json');writeFileSync(output,JSON.stringify(evaluation.records));
    expect(readEvaluations(output,'test-first-person',points(events),source.latestCursor!)).toHaveLength(2);
    expect(inspectFreshFunding(readFileSync(journal),events).status).toBe('verified_closed_prior_can_be_carried_after_approval');
    const stale=readFileSync(join(directory,'TEST-ONLY-prior-allowance','accounting.journal.json'));
    expect(inspectFreshFunding(stale,events).status).toBe('journal_ledger_mismatch');
  });
});
