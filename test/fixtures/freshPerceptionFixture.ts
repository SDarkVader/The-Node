// Explicitly synthetic financial/provider/worker fixtures; never an actual account or credential.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './accountingFixture.js';
import { continuationBudget, continuationGenesis, continuationPlan, simulatedContinuationProvider } from './continuationFixture.js';
import { runContinuation } from '../../src/eval/continuationRunner.js';
import { applyObservationPatch } from '../../src/eval/continuationConversation.js';
import { ContinuationLedger } from '../../src/eval/continuationLedger.js';
import { ExperimentBudget } from '../../src/agent/experimentBudget.js';
import { PRICED_MODELS } from '../../src/agent/modelPricing.js';
import { freshPerceptionGenesis, freshPerceptionPlanHash, type FreshPerceptionPlan } from '../../src/observatory/freshPerception.js';
import { PERCEPTION_SCHEMA, PERCEPTION_PROFILE, effectiveRange, validatePerception } from '../../src/observatory/perception.js';
import type { PerceptionAuditWorker } from '../../src/observatory/perceptionAudit.js';
import type { Sender } from '../../src/eval/accountedRunner.js';

export async function freshPerceptionFixture(ticks = 2, directory = root(), sourceRevision = 'a'.repeat(40)) {
  const declared = JSON.parse(readFileSync(new URL('../../experiments/two-baker-first-person-reasoning-20-ticks.json', import.meta.url), 'utf8')) as FreshPerceptionPlan;
  const plan: FreshPerceptionPlan = { ...declared, id: 'TEST-ONLY-fresh-first-person', ticks, maxCalls: ticks * 2,
    minIntervalMs: 0, deadlineMs: 2000, allowance: { ...declared.allowance, maxRequests: ticks * 2 } };
  const priorPath = join(directory, 'TEST-ONLY-prior-allowance'), prior = continuationBudget(continuationPlan(), priorPath);
  const priorLedger = new ContinuationLedger(join(directory, 'TEST-ONLY-prior-trace'));
  try { await runContinuation(continuationPlan(), continuationGenesis(sourceRevision), prior,
    simulatedContinuationProvider().send, priorLedger, { sourceRevision, mode: 'offline_simulated_provider' }); }
  finally { priorLedger.close(); prior.close(); }
  const budget = ExperimentBudget.carryFromExperiment(join(directory, 'TEST-ONLY-fresh-allowance'), priorPath);
  const now = Date.now();
  budget.authorize({ runId: 'TEST-ONLY-fresh-first-person', authorizedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    expectedCarriedFingerprint: budget.carriedFingerprint(), instruction: 'OFFLINE SYNTHETIC FIXTURE ONLY. No financial or provider authorization.',
    scope: 'accounted_experiment_spending_only', manifestSha256: freshPerceptionPlanHash(plan), model: plan.model,
    maxRequests: plan.maxCalls, limitMicroUsd: plan.allowance.limitMicroUsd, perRequestMicroUsd: plan.allowance.perRequestMicroUsd, prices: PRICED_MODELS[plan.model]! });
  const ledger = new ContinuationLedger(join(directory, 'trace'));
  const worker = (workerId: string): PerceptionAuditWorker => ({ workerId, perceive: async req => {
    const response = { type: 'perception' as const, schema: PERCEPTION_SCHEMA, profile: PERCEPTION_PROFILE, requestId: req.requestId,
      agentId: req.agentId, tick: req.tick, worldHash: req.worldHash, perspective: req.perspective,
      engine: { name: 'TEST-ONLY-worker', version: 'fixture' }, observation: { effectiveRange: effectiveRange(req.condition), bodies: [], locations: [],
        environment: { localTensionBand: req.scene.districts.find(d => d.id === req.scene.observer.districtId)?.tensionBand ?? null, weather: req.condition.weather.kind } } };
    return validatePerception(req, response as Parameters<typeof validatePerception>[1], JSON.stringify(response));
  } });
  const workers: [PerceptionAuditWorker, PerceptionAuditWorker] = [worker('TEST-ONLY-primary'), worker('TEST-ONLY-independent')];
  const sent: Parameters<Sender>[0][] = [];
  const sender = (fault?: 'transport' | 'unknown_usage' | 'wrong_model'): Sender => async input => {
    sent.push(input); if (fault === 'transport') throw Error('TEST_ONLY_transport');
    let packet: any;
    for (const m of JSON.parse(input.body).messages) if (m.role === 'user') {
      const turn = JSON.parse(m.content[0].text);
      if (turn.perceptionPacket) packet = turn.perceptionPacket;
      else if (turn.perceptionPatch) packet = applyObservationPatch(packet, turn.perceptionPatch);
    }
    const summaries = input.actorId === 'baker-0' || input.tick % 2 === 0;
    const content: unknown[] = summaries ? [{ type: 'thinking', thinking: 'TEST ONLY synthetic returned first-person deliberation.', signature: 'TEST_ONLY_signature_' + input.actorId + '_' + input.tick }] : [];
    content.push({ type: 'text', text: JSON.stringify({ move: packet.input.legalMoves[0] ?? null, communication: null, diary: null,
      role: packet.input.self.role === 'Baker' ? { kind: 'bakerPrice', price: 0.9 } : null }) });
    return Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', id: 'msg_TEST_ONLY_fresh_' + input.index,
      model: fault === 'wrong_model' ? 'wrong-model' : plan.model, stop_reason: 'end_turn',
      usage: fault === 'unknown_usage' ? {} : { input_tokens: 1200, output_tokens: 100 }, content }));
  };
  return { plan, budget, ledger, workers, sender, sent,
    genesis: freshPerceptionGenesis(plan, sourceRevision, 'TEST_ONLY_FRESH_OBSERVER_SECRET_not_a_credential'), sourceRevision,
    options: { expectedCarriedFingerprint: budget.carriedFingerprint(), mode: 'offline_simulated_provider' as const,
      countTokens: async () => Buffer.from('{"input_tokens":1200}') } };
}
