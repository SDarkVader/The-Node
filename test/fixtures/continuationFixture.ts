import { join } from 'node:path';
import { InitialTestBudget } from '../../src/agent/initialTestBudget.js';
import { ExperimentBudget, EXPERIMENT_MODEL } from '../../src/agent/experimentBudget.js';
import { PRICED_MODELS } from '../../src/agent/modelPricing.js';
import { continuationPlanHash, type ContinuationPlan } from '../../src/eval/continuationRunner.js';
import { fixtureGenesis } from '../../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../../src/world/world.js';
import { conversationObservations, unpackContinuationObservation, type Message } from '../../src/eval/continuationConversation.js';
import { unpackObservation } from '../../src/agent/observationTables.js';
import type { Sender } from '../../src/eval/accountedRunner.js';
import { AUTHORITY_ATTRIBUTION_CONTRACT as C } from '../../src/eval/constructs/authorityAttribution.js';
import { setup, root, context } from './accountingFixture.js';

export function continuationPlan(calls = 4): ContinuationPlan {
  return { schema: 'node-reasoning-continuation-v1', id: 'TEST-ONLY-continuation', model: 'claude-haiku-5-5', seed: 103,
    actors: structuredClone(calls === 4 ? C.controlledActors.slice(0, 2) : [C.controlledActors[6]!, ...C.controlledActors.slice(0, 6)]),
    maxTicks: Math.ceil(calls / (calls === 4 ? 2 : 7)), maxCalls: calls, deadlineMs: 2000, minIntervalMs: 0, memory: 'own_append_only_transcript',
    allowance: { maxRequests: calls, limitMicroUsd: 100000, perRequestMicroUsd: 20000, windowHours: 24 } };
}
export function continuationGenesis(sourceRevision: string) {
  const config = JSON.parse(JSON.stringify({ ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }));
  return { ...fixtureGenesis(103, config), sourceRevision };
}
/** Only disposable synthetic fixtures. No real account, credential, prior private ledger or API. */
export function continuationBudget(plan: ContinuationPlan, directory = join(root(), 'allowance')) {
  const { ledger } = setup(), priorDirectory = join(root(), 'initial');
  const prior = InitialTestBudget.create(priorDirectory, ledger.exportDocument());
  const now = Date.now(), iso = (offset: number) => new Date(now + offset).toISOString(), day = 86400000;
  const prices = { model: EXPERIMENT_MODEL, inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) };
  prior.authorize({ runId: 'TEST-ONLY-closed', authorizedAt: iso(-3 * day), expiresAt: iso(-2 * day),
    expectedHistoryHash: prior.view().historyHash, instruction: 'TEST ONLY. No financial authorization.', scope: 'additional_initial_test_spending_only',
    model: EXPERIMENT_MODEL, maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000, prices });
  prior.close();
  const budget = ExperimentBudget.carryFromInitial(directory, priorDirectory);
  budget.authorize({ runId: 'TEST-ONLY-continuation', authorizedAt: iso(-60000), expiresAt: iso(day - 60000),
    expectedCarriedFingerprint: budget.carriedFingerprint(), instruction: 'OFFLINE TEST ONLY. No provider dispatch is authorized.',
    scope: 'accounted_experiment_spending_only', manifestSha256: continuationPlanHash(plan), model: plan.model,
    maxRequests: plan.allowance.maxRequests, limitMicroUsd: plan.allowance.limitMicroUsd, perRequestMicroUsd: plan.allowance.perRequestMicroUsd, prices: PRICED_MODELS[plan.model]! });
  return budget;
}
export function simulatedContinuationProvider(options: { invalidAt?: number; failAt?: number; wrongModelAt?: number; missingUsageAt?: number;
    refusalAt?: number; redacted?: boolean; largeSignature?: boolean; hangAt?: number; overrunAt?: number; transformedAt?: number } = {}) {
  const requests: Parameters<Sender>[0][] = [];
  const send: Sender = async (input, signal) => {
    requests.push(input);
    if (input.index === options.failAt) throw Error('TEST-ONLY-transport-failure');
    if (input.index === options.hangAt) return new Promise<Buffer>((_, reject) => signal.addEventListener('abort', () => reject(Error('TEST-ONLY-aborted'))));
    const wire = JSON.parse(input.body) as { messages: Message[] };
    const observations = conversationObservations(wire.messages);
    const current = unpackContinuationObservation(observations.at(-1));
    const prior = wire.messages.filter(m => m.role === 'assistant').at(-1);
    const previousDecision = prior ? JSON.parse((prior.content.at(-1) as { text: string }).text) : null;
    // A deterministic fixture using only this actor's received observation and prior decision.
    // Its explanation/signature are synthetic test data, never evidence of model reasoning.
    const price = previousDecision?.role ? Math.min(1.4, previousDecision.role.price + 0.05) : 0.5;
    const decision = { move: null, communication: null, diary: null,
      role: current.self.role === 'Baker' ? { kind: 'bakerPrice', price: input.index === options.invalidAt ? 4 : price } : null };
    const content: unknown[] = [{ type: 'thinking', thinking: 'TEST ONLY: reconsider prior price using the evolved authorized observation.',
      signature: options.largeSignature ? 'TEST-ONLY-' + 'x'.repeat(28000) : 'TEST-ONLY-signature-' + input.actorId + '-' + input.tick }];
    if (options.redacted) content.push({ type: 'redacted_thinking', data: 'TEST-ONLY-opaque-redaction-' + input.actorId + '-' + input.tick });
    content.push({ type: 'text', text: JSON.stringify(decision) });
    const response: Record<string, unknown> = { type: 'message', role: 'assistant', id: 'msg_test_' + input.index, model: input.index === options.wrongModelAt ? 'other-model' : 'claude-haiku-5-5',
      stop_reason: input.index === options.refusalAt ? 'refusal' : 'end_turn', content,
      usage: { input_tokens: input.index === options.overrunAt ? 100000 : 1200, output_tokens: 100 } };
    if (input.index === options.transformedAt) response.input_transformations = [{ type: 'thinking_dropped', reason: 'organization_binding_mismatch' }];
    if (input.index === options.missingUsageAt) delete response.usage;
    return Buffer.from(JSON.stringify(response));
  };
  return { send, requests };
}
