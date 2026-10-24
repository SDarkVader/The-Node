import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { continuationBudget, continuationGenesis, continuationPlan, simulatedContinuationProvider } from './fixtures/continuationFixture.js';
import { runContinuation } from '../src/eval/continuationRunner.js';
import { ContinuationLedger, readContinuationLedger, recoverContinuation, type ContinuationEvent } from '../src/eval/continuationLedger.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { PRICED_MODELS } from '../src/agent/modelPricing.js';
import { digest } from '../src/agent/replay.js';
import { applyObservationPatch } from '../src/eval/continuationConversation.js';
import { DEFAULT_PERCEPTION_CONDITION, PERCEPTION_PROFILE, PERCEPTION_SCHEMA, effectiveRange, validatePerception } from '../src/observatory/perception.js';
import type { PerceptionAuditWorker } from '../src/observatory/perceptionAudit.js';
import { perceptionPlanHash, runPerceptionContinuation, verifyPerceptionContinuation, type PerceptionContinuationPlan } from '../src/observatory/perceptionContinuation.js';
import type { Sender } from '../src/eval/accountedRunner.js';

const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
const A = 'a'.repeat(40), B = 'b'.repeat(40);
async function fixture(ticks = 2) {
  const dir = root(), legacy = continuationPlan(), priorPath = join(dir, 'prior');
  const prior = continuationBudget(legacy, priorPath); handles.push(prior);
  const source = new ContinuationLedger(join(dir, 'parent')); handles.push(source);
  await runContinuation(legacy, continuationGenesis(A), prior, simulatedContinuationProvider().send, source, { sourceRevision: A, mode: 'offline_simulated_provider' });
  source.close(); prior.close();
  const parent = readContinuationLedger(source.path);
  const plan: PerceptionContinuationPlan = { schema: 'node-accounted-perception-continuation-v1', id: 'TEST-ONLY-perception-transition', model: 'claude-haiku-5-5', ticks,
    maxCalls: 2 * ticks, condition: structuredClone(DEFAULT_PERCEPTION_CONDITION), perspective: 'first_person', memory: 'retain_exact_own_legacy_then_perception', maxRequestBytes: 95000,
    deadlineMs: 2000, minIntervalMs: 0, allowance: { maxRequests: 2 * ticks, limitMicroUsd: 1000000, perRequestMicroUsd: 30000, windowHours: 24 } };
  const budget = ExperimentBudget.carryFromExperiment(join(dir, 'new-allowance'), priorPath); handles.push(budget);
  budget.authorize({ runId: 'TEST-ONLY-perception', authorizedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
    expectedCarriedFingerprint: budget.carriedFingerprint(), instruction: 'OFFLINE TEST ONLY, NO NETWORK AUTHORIZATION', scope: 'accounted_experiment_spending_only',
    manifestSha256: perceptionPlanHash(plan), model: plan.model, maxRequests: plan.allowance.maxRequests, limitMicroUsd: plan.allowance.limitMicroUsd,
    perRequestMicroUsd: plan.allowance.perRequestMicroUsd, prices: PRICED_MODELS[plan.model]! });
  const ledger = new ContinuationLedger(join(dir, 'perception')); handles.push(ledger);
  const worker = (workerId: string): PerceptionAuditWorker => ({ workerId, perceive: async req => {
    const response = { type: 'perception', schema: PERCEPTION_SCHEMA, profile: PERCEPTION_PROFILE, requestId: req.requestId, agentId: req.agentId, tick: req.tick,
      worldHash: req.worldHash, perspective: req.perspective, engine: { name: 'TEST-ONLY-worker', version: 'fixture' }, observation: {
        effectiveRange: effectiveRange(req.condition), bodies: [], locations: [], environment: { localTensionBand: req.scene.districts.find(d => d.id === req.scene.observer.districtId)?.tensionBand ?? null, weather: req.condition.weather.kind } } };
    return validatePerception(req, response as Parameters<typeof validatePerception>[1], JSON.stringify(response));
  } });
  const workers: [PerceptionAuditWorker, PerceptionAuditWorker] = [worker('TEST-primary'), worker('TEST-independent')];
  const sent: Parameters<Sender>[0][] = [];
  const sender = (fault?: string): Sender => async (input) => {
    sent.push(input); if (fault === 'transport') throw Error('TEST-ONLY-failure');
    let packet: any = null;
    for (const m of JSON.parse(input.body).messages) if (m.role === 'user') {
      const t = JSON.parse(m.content[0].text); if (t.perceptionPacket) packet = t.perceptionPacket;
      else if (t.perceptionPatch) packet = applyObservationPatch(packet, t.perceptionPatch);
    }
    const move = packet.input.legalMoves[0] ?? null;
    return Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', id: `TEST-ONLY-new-${input.index}`, model: fault === 'wrong_model' ? 'wrong' : plan.model,
      stop_reason: 'end_turn', usage: fault === 'unknown_usage' ? {} : { input_tokens: fault === 'overrun' ? 100001 : 100, output_tokens: 80 },
      content: [{ type: 'thinking', thinking: 'TEST ONLY returned reasoning about this environmental packet.', signature: 'TEST-ONLY-preserve-this-signature' },
        { type: 'text', text: JSON.stringify({ move, communication: null, diary: null, role: null }) }] }));
  };
  return { parent, plan, budget, ledger, workers, sender, sent };
}
function rehash(events: ContinuationEvent[]) {
  let previous = '0'.repeat(64); return events.map((e, i) => { const x = { ...e, seq: i, previous, hash: digest([i, previous, e.kind, e.data]) }; previous = x.hash; return x; });
}
describe('accounted live perception transition, offline simulated provider only', () => {
  it('continues the same identities/world with audited environmental packets and exact own signed memory; replays independently', async () => {
    const f = await fixture(); const original = JSON.stringify(f.parent);
    const summary = await runPerceptionContinuation(f.plan, f.parent, f.budget, f.sender(), f.ledger, f.workers, B, { mode: 'offline_simulated_provider' });
    f.ledger.close(); const events = readContinuationLedger(f.ledger.path);
    expect(summary).toMatchObject({ status: 'completed', calls: 4, startTick: 2, finalTick: 4, completedTicks: 2, heldMicroUsd: '0' });
    expect(verifyPerceptionContinuation(events)).toMatchObject({ verified: true, summary });
    expect(JSON.stringify(f.parent)).toBe(original);
    const old = new Map(recoverContinuation(f.parent, A).recovery.histories);
    for (const input of f.sent.slice(0, 2)) {
      const body = JSON.parse(input.body); expect(body.messages.slice(0, -1)).toEqual(old.get(input.actorId)!.messages);
      expect(body.system).toBe(old.get(input.actorId)!.system);
      const current = JSON.parse(body.messages.at(-1).content[0].text);
      expect(current.conditionTransition.from).toBe('authorized_global_observer');
      expect(current.perceptionPacket.input.rules.districtWeather.meaning).toContain('aggregate emotional tension');
      expect(current.perceptionPacket.input).not.toHaveProperty('city');
      expect(current.perceptionPacket.input.decisionSchema).toEqual(current.perceptionPacket.decisionSchema);
    }
    const later = JSON.parse(f.sent[2]!.body);
    expect(JSON.parse(later.messages.at(-1).content[0].text)).toHaveProperty('perceptionPatch');
    expect(later.messages.at(-2).content[0].signature).toBe('TEST-ONLY-preserve-this-signature');
    expect(f.budget.view().requests).toHaveLength(4);
    expect(events.filter(e => e.kind === 'perception_request').every(e => e.data.audit.status === 'agreement')).toBe(true);
    const transitions = events.filter(e => e.kind === 'perception_transition');
    expect(transitions.some(e => e.data.tapeTick.actions.some((a: any) => a.decision.move !== null))).toBe(true);
  });
  it('detects rehashed forged environment, wire, action and history evidence', async () => {
    const f = await fixture(1); await runPerceptionContinuation(f.plan, f.parent, f.budget, f.sender(), f.ledger, f.workers, B, { mode: 'offline_simulated_provider' }); f.ledger.close();
    const original = readContinuationLedger(f.ledger.path);
    for (const kind of ['perception_request', 'perception_validation', 'perception_stop']) {
      const e = structuredClone(original), target = e.find(x => x.kind === kind)!;
      if (kind === 'perception_request') target.data.perceptionRequest.scene.observer.x++;
      if (kind === 'perception_validation') target.data.admitted = null;
      if (kind === 'perception_stop') target.data.histories[0][1].messages.pop();
      expect(() => verifyPerceptionContinuation(rehash(e))).toThrow();
    }
  });
  it.each(['transport', 'wrong_model', 'unknown_usage', 'overrun'])('stops without retries or world advancement on %s and retains accounting evidence', async fault => {
    const f = await fixture(); const summary = await runPerceptionContinuation(f.plan, f.parent, f.budget, f.sender(fault), f.ledger, f.workers, B, { mode: 'offline_simulated_provider' }); f.ledger.close();
    expect(summary.calls).toBe(1); expect(summary.completedTicks).toBe(0); expect(f.sent).toHaveLength(1);
    expect(f.budget.view().canReserve).toBe(false);
    expect(verifyPerceptionContinuation(readContinuationLedger(f.ledger.path)).verified).toBe(true);
    if (fault !== 'overrun') expect(BigInt(summary.heldMicroUsd)).toBeGreaterThan(0n);
    else expect(f.budget.view().overrun).toBe(true);
  });
  it('refuses a changed plan before any reservation or model invocation', async () => {
    const f = await fixture(); f.plan.condition.firstPerson.maxRange = 5;
    await expect(runPerceptionContinuation(f.plan, f.parent, f.budget, f.sender(), f.ledger, f.workers, B)).rejects.toThrow('allowance');
    expect(f.budget.view().requests).toHaveLength(0); expect(f.sent).toHaveLength(0);
  });
});
