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

const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
const instruction = 'TEST ONLY SYNTHETIC APPROVAL. No actual provider, financial authority, prior account or credential.';
function fixture(ticks = 3, deadlineMs = 2000) {
  const config = { ...societyConfig(), pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 };
  const society = new Society({ seed: 42, sourceRevision: 'a'.repeat(40), config });
  const plan = createSocietyPlan(society, { id: 'TEST-ONLY-safe-society', ticks, minIntervalMs: 0, deadlineMs });
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
      usage: fault === 'unknown' ? null : { input_tokens: 1200, output_tokens: fault === 'overrun' ? 3000 : 80 } }));
  };
  return { society, plan, budget, events, options, sent, sender };
}

describe('accounted society, fake provider and disposable money fixtures only', () => {
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
    }
    const duplicate = fixture();
    const replayed = await runAccountedSociety(duplicate.society, duplicate.budget, duplicate.sender(), duplicate.options);
    expect(replayed.finalHash).toBe(result.finalHash);
    expect(duplicate.society.exportTape()).toEqual(tape);
  });

  it('refuses absent approval, altered plan, instruction or carried provenance before reserving', async () => {
    const f = fixture();
    for (const change of [{ ownerApproved: false }, { instruction: 'unapproved instruction' }, { expectedCarriedFingerprint: 'f'.repeat(64) },
      { plan: { ...f.plan, initialHash: 'f'.repeat(64) } }, { plan: { ...f.plan, ticks: 4, maxCalls: 24 } }]) {
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
});
