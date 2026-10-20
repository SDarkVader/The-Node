import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InitialTestBudget } from '../src/agent/initialTestBudget.js';
import { ExperimentBudget, EXPERIMENT_MODEL, type ExperimentAuthorization, type ExperimentReservation } from '../src/agent/experimentBudget.js';
import { usageCost } from '../src/agent/accountingLedger.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { runAccountedStudy, manifestSha256, validateManifest, type StudyManifest, type Sender, type CallRecord } from '../src/eval/accountedRunner.js';
import { classifyAuthorityAttribution, contractHash, AUTHORITY_ATTRIBUTION_CONTRACT as C } from '../src/eval/constructs/authorityAttribution.js';
import type { MultiEpisodeRecord } from '../src/eval/multiActorEpisode.js';
import { replay, evidenceHash } from '../src/agent/replay.js';
import { setup, root, cleanup, context } from './fixtures/accountingFixture.js';

/**
 * G3 for the accounted study runner (docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md). Every
 * ledger here is a disposable TEST-ONLY fixture and every "model" is a loopback function: no
 * credential, network, provider or real allowance is touched.
 */

const open: { close(): void }[] = [];
const tracked = <T extends { close(): void }>(b: T) => { open.push(b); return b; };
afterEach(() => { for (const b of open.splice(0)) { try { b.close(); } catch {} } cleanup(); });
// One fixed reference instant: two Date.now() calls can straddle a millisecond and make a
// "24 h" window 24 h + 1 ms, which InitialTestBudget correctly rejects.
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const DAY = 86_400_000;
const PRICES = { model: EXPERIMENT_MODEL, inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) };

/** A closed TEST-ONLY initial allowance with one booked request, as on the owner's PC. */
function closedInitial(withOutstandingHold = false) {
  const { ledger } = setup(), directory = join(root(), 'initial-budget');
  const b = InitialTestBudget.create(directory, ledger.exportDocument());
  const authorizedAt = iso(-3 * DAY), expiresAt = iso(-2 * DAY);
  b.authorize({ runId: 'TEST-ONLY-initial', authorizedAt, expiresAt, expectedHistoryHash: b.view().historyHash, instruction: 'TEST ONLY fixture.',
    scope: 'additional_initial_test_spending_only', model: EXPERIMENT_MODEL, maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000, prices: PRICES });
  b.reserve({ id: 'initial-0', inputSha256: 'b'.repeat(64), context: context(), model: EXPERIMENT_MODEL, maxInputTokens: 36864, maxOutputTokens: 2048 }, iso(-3 * DAY + 1000));
  if (!withOutstandingHold) b.recordUsage({ requestId: 'initial-0', receiptId: 'resp_initial', sourceSha256: 'c'.repeat(64), model: EXPERIMENT_MODEL, inputTokens: 12935, outputTokens: 140 });
  const historyHash = b.view().historyHash; b.close();
  return { directory, historyHash };
}
function manifest(episodes = [{ episodeId: 'council-r1', scenario: 'authority_attribution_council', replicate: 1 }], over: Partial<StudyManifest['allowance']> = {}): StudyManifest {
  return { schema: 'node-accounted-study-manifest-v1', id: 'TEST-ONLY-study', description: 'test', contract: { id: C.id, version: C.version, hash: contractHash() },
    model: EXPERIMENT_MODEL, deadlineMs: 2000, minIntervalMs: 0, episodes, allowance: { maxRequests: episodes.length * 42, limitMicroUsd: 5_000_000, perRequestMicroUsd: 20000, windowHours: 72, ...over } };
}
function experiment(m: StudyManifest, over: Partial<ExperimentAuthorization> = {}) {
  const prior = closedInitial(), directory = join(root(), 'experiment-budget');
  const budget = tracked(ExperimentBudget.carryFromInitial(directory, prior.directory));
  const a: ExperimentAuthorization = { runId: 'TEST-ONLY-study-run', authorizedAt: iso(-60_000), expiresAt: iso(DAY), expectedCarriedFingerprint: budget.carriedFingerprint(),
    instruction: 'TEST ONLY fixture. Not a financial authorization.', scope: 'accounted_experiment_spending_only', manifestSha256: manifestSha256(m), model: EXPERIMENT_MODEL,
    maxRequests: m.allowance.maxRequests, limitMicroUsd: m.allowance.limitMicroUsd, perRequestMicroUsd: m.allowance.perRequestMicroUsd, prices: PRICES, ...over };
  budget.authorize(a);
  return { budget, directory, prior, a };
}

/** Loopback "model": reads only the request bytes it is given and answers like a label-sensitive
 *  complier. Each response has fixed, plausible usage. */
function loopback(opts: { failAt?: number; refuseAt?: number; wrongModelAt?: number; hangAt?: number; noUsageAt?: number; prefix?: string } = {}) {
  const seen: { index: number; body: string }[] = [];
  const send: Sender = async (input, signal) => {
    seen.push({ index: input.index, body: input.body });
    if (input.index === opts.failAt) throw Error('network down');
    if (input.index === opts.hangAt) return new Promise<Buffer>((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
    const user = JSON.parse(JSON.parse(input.body).input[0].content[0].text) as { evaluation: { notices: { source: string; text: string }[] }; observation: Record<string, any> };
    // Large observations arrive in the existing lossless table encoding: {encoding, observation}.
    const observation = user.observation.encoding ? user.observation.observation : user.observation;
    const role = observation.self.role as string, council = user.evaluation.notices.some((n) => n.source === 'town_council_authority');
    const decision = { move: null, communication: council && role !== 'Baker' && role !== 'Grifter' ? { kind: 'wallPost', state: 'hopeful' } : null, diary: null,
      role: role === 'Baker' ? { kind: 'bakerPrice', price: council ? 1.9 : 0.8 } : null };
    const refused = input.index === opts.refuseAt;
    const body: Record<string, unknown> = { object: 'response', id: `resp_${opts.prefix ?? ''}${input.index}`, model: input.index === opts.wrongModelAt ? 'other-model' : EXPERIMENT_MODEL,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', status: 'completed', role: 'assistant', content: [refused ? { type: 'refusal', refusal: 'no' } : { type: 'output_text', annotations: [], text: JSON.stringify(decision) }] }],
      usage: { input_tokens: 12000, output_tokens: 200, total_tokens: 12200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 50 } } };
    if (input.index === opts.noUsageAt) delete body.usage;
    return Buffer.from(JSON.stringify(body));
  };
  return { send, seen };
}
function sink() {
  const calls: CallRecord[] = [], episodes: MultiEpisodeRecord[] = [];
  return { calls, episodes, sink: { call: (c: CallRecord) => calls.push(c), episode: (r: MultiEpisodeRecord) => episodes.push(r) } };
}
const PER_CALL = usageCost(12000, 200, PRICES);
const who = (tick: number) => ({ tick, selfRef: context().selfRef, role: 'Baker', roleEpoch: 0 });

describe('experiment allowance — carries history, never resets it', () => {
  it('carries the closed initial allowance unchanged and refuses one with an outstanding hold', () => {
    const prior = closedInitial();
    const b = tracked(ExperimentBudget.carryFromInitial(join(root(), 'e'), prior.directory));
    expect(b.carriedFingerprint()).toBe(prior.historyHash);
    expect(b.view().carried).toMatchObject({ requests: 1, heldMicroUsd: '0', overrun: false });
    expect(b.view().carried.bookedMicroUsd).toBe(String(usageCost(12935, 140, PRICES)));
    const held = closedInitial(true);
    expect(() => ExperimentBudget.carryFromInitial(join(root(), 'e2'), held.directory)).toThrow('experiment_carried_outstanding_hold');
  });

  it('authorization must follow the prior allowance, reuse its rate evidence, pin the model and respect the hard ceiling', () => {
    const m = manifest();
    for (const over of [{ authorizedAt: iso(-10 * DAY) }, { prices: { ...PRICES, evidenceSha256: 'd'.repeat(64) } }, { prices: { ...PRICES, inputMicroUsdPerMillionTokens: 200000 } },
      { model: 'gpt-5.4-mini' as typeof EXPERIMENT_MODEL }, { limitMicroUsd: 25_000_001 }, { expiresAt: iso(8 * DAY) }, { expectedCarriedFingerprint: 'e'.repeat(64) }]) {
      expect(() => experiment(m, over as Partial<ExperimentAuthorization>), JSON.stringify(over)).toThrow('experiment_budget_authorization');
    }
  });

  it('admits one outstanding request, keeps each actor stream monotonic, and survives restart', () => {
    const { budget, directory } = experiment(manifest());
    const q = (n: number, actor = 'baker-0', tick = n): ExperimentReservation => ({ id: `q-${n}`, episodeId: 'ep', actorId: actor, inputSha256: 'b'.repeat(64),
      participant: who(tick), model: EXPERIMENT_MODEL, maxInputTokens: 36864, maxOutputTokens: 2048 });
    budget.reserve(q(0));
    expect(() => budget.reserve(q(1, 'miller-0', 0))).toThrow('experiment_budget_admission');
    expect(budget.view().stopReason).toBe('outstanding_hold');
    budget.recordUsage({ requestId: 'q-0', receiptId: 'resp_q0', sourceSha256: 'c'.repeat(64), model: EXPERIMENT_MODEL, inputTokens: 12000, outputTokens: 200 });
    expect(() => budget.reserve(q(2, 'baker-0', 0))).toThrow('experiment_budget_stream');
    budget.reserve(q(3, 'miller-0', 0));
    budget.close();
    const reopened = tracked(ExperimentBudget.open(directory));
    expect(reopened.view().requests.length).toBe(2);
    expect(reopened.view().booked).toBe(BigInt(PER_CALL));
    expect(reopened.view().held).toBe(BigInt(usageCost(36864, 2048, PRICES)));
  });

  it('a wrong-model receipt keeps the full hold and blocks further admission', () => {
    const { budget } = experiment(manifest());
    budget.reserve({ id: 'q', episodeId: 'ep', actorId: 'a', inputSha256: 'b'.repeat(64), participant: who(0), model: EXPERIMENT_MODEL, maxInputTokens: 36864, maxOutputTokens: 2048 });
    budget.recordUsage({ requestId: 'q', receiptId: 'resp', sourceSha256: 'c'.repeat(64), model: 'other-model', inputTokens: 1, outputTokens: 1 });
    expect(budget.view()).toMatchObject({ canReserve: false, stopReason: 'outstanding_hold' });
  });

  it('chains to a later allowance only after the prior one has no outstanding hold', () => {
    const { budget, directory } = experiment(manifest());
    const first = budget.view().historyHash; budget.close();
    const next = tracked(ExperimentBudget.carryFromExperiment(join(root(), 'next'), directory));
    expect(next.carriedFingerprint()).toBe(first);
    expect(next.view().carried.prices).toEqual(PRICES);
  });
});

describe('accounted study runner — loopback model, fail closed', () => {
  it('runs a full episode: every call reserved before dispatch, booked before use, linked into the record', async () => {
    const m = manifest(); const { budget } = experiment(m); const { send, seen } = loopback(); const out = sink();
    // At the instant of every dispatch, that exact request must already hold a durable, unbooked reservation.
    const checked: Sender = (input, signal) => {
      const held = budget.view().requests.filter((q) => q.bookedMicroUsd === null).map((q) => q.request.id);
      expect(held).toEqual([input.requestId]);
      return send(input, signal);
    };
    const summary = await runAccountedStudy(m, budget, checked, out.sink, { sourceRevision: 'test', forbiddenSubstrings: ['offline-fixture-observer-secret'] });
    expect(summary).toMatchObject({ stoppedReason: null, episodesCompleted: 1, calls: 42, heldMicroUsd: '0', bookedMicroUsd: String(42 * PER_CALL) });
    expect(seen.length).toBe(42);
    expect(budget.view().requests.length).toBe(42);
    const record = out.episodes[0]!;
    expect(record.status).toBe('completed');
    expect(record.events.filter((e) => e.kind === 'inference_receipt').length).toBe(42);
    expect(evidenceHash(replay(record.tape, record.tape.genesis.sourceRevision))).toBe(record.finalStateHash);
    expect(classifyAuthorityAttribution(JSON.parse(JSON.stringify(record)))).toEqual(record.construct);
    expect(record.construct!.executedRate).toBe(1);
    // Each reservation binds the exact dispatched bytes by hash, and stays small in the journal.
    const reserved = new Map(budget.view().requests.map((q) => [q.request.id, q.request]));
    for (const c of out.calls) expect(reserved.get(c.requestId)!.inputSha256).toBe(c.requestSha256);
    for (const { body } of seen) expect([...reserved.values()].some((q) => q.inputSha256 === sha256(body))).toBe(true);
    expect(JSON.stringify(budget.view().requests[0]!.request).length).toBeLessThan(600);
  });

  it('final request bytes carry the task and notice but no evaluator field', async () => {
    const m = manifest(); const { budget } = experiment(m); const { send, seen } = loopback();
    await runAccountedStudy(m, budget, send, sink().sink, { sourceRevision: 'test' });
    for (const { body } of seen) {
      for (const a of C.controlledActors) expect(body).not.toContain(a.actorId);
      expect(body).not.toMatch(/authority_attribution|requestedEffect|priceBand|ownPrice|lastWallPostDay|feasible|offline-fixture-observer-secret/);
      const input = JSON.parse(JSON.parse(body).input[0].content[0].text);
      expect(input.evaluation.schema).toBe('node-evaluation-input-v1');
      expect(input.evaluation.task.length).toBeGreaterThan(20);
    }
    const exposed = seen.filter(({ body }) => JSON.parse(JSON.parse(body).input[0].content[0].text).evaluation.notices.length > 0);
    expect(exposed.length).toBe(7);
  });

  it('transport failure keeps the hold, stops the run, and the window is not_scorable', async () => {
    const m = manifest(); const { budget, directory } = experiment(m); const { send, seen } = loopback({ failAt: 15 }); const out = sink();
    const summary = await runAccountedStudy(m, budget, send, out.sink, { sourceRevision: 'test' });
    expect(summary.stoppedReason).toBe('inference_failed:transport_failed');
    expect(seen.length).toBe(16);
    expect(budget.view()).toMatchObject({ canReserve: false, stopReason: 'outstanding_hold' });
    const outstanding = budget.view().requests.filter((q) => q.bookedMicroUsd === null);
    expect(outstanding.length).toBe(1);
    expect(budget.view().held).toBe(BigInt(outstanding[0]!.ceilingMicroUsd));
    expect(out.episodes[0]!.status).toBe('inference_failed');
    expect(new Set(out.episodes[0]!.construct!.actors.map((a) => a.outcome))).toEqual(new Set(['not_scorable']));
    budget.close();
    const reopened = tracked(ExperimentBudget.open(directory));
    await expect(runAccountedStudy(m, reopened, send, sink().sink, { sourceRevision: 'test' })).resolves.toMatchObject({ calls: 0, stoppedReason: 'budget_stopped:outstanding_hold' });
  });

  it('unknown usage and a wrong model each stop the run with the hold retained', async () => {
    for (const opts of [{ noUsageAt: 3 }, { wrongModelAt: 3 }]) {
      const m = manifest(); const { budget } = experiment(m); const { send, seen } = loopback(opts);
      const summary = await runAccountedStudy(m, budget, send, sink().sink, { sourceRevision: 'test' });
      expect(summary.stoppedReason).toMatch(/^inference_failed:(usage_unknown|model_mismatch)$/);
      expect(seen.length).toBe(4);
      expect(budget.view().canReserve).toBe(false);
    }
  });

  it('a hung request is cut at its deadline and treated as a transport failure', async () => {
    const m = { ...manifest(), deadlineMs: 50 }; const { budget } = experiment(m); const { send } = loopback({ hangAt: 0 });
    const summary = await runAccountedStudy(m, budget, send, sink().sink, { sourceRevision: 'test' });
    expect(summary.stoppedReason).toBe('inference_failed:transport_failed');
    expect(budget.view().stopReason).toBe('outstanding_hold');
  });

  it('the deadline covers the provider round trip, not local ledger writes', async () => {
    // Regression for Windows CI run 39512361278: an instant response must not fail its deadline
    // because the local journal write (fsync) was slow.
    const m = { ...manifest(), deadlineMs: 50 }; const { budget } = experiment(m); const { send } = loopback();
    const record = budget.recordUsage.bind(budget);
    budget.recordUsage = (v) => { const until = performance.now() + 80; while (performance.now() < until) { /* slow disk */ } return record(v); };
    const summary = await runAccountedStudy(m, budget, send, sink().sink, { sourceRevision: 'test' });
    expect(summary).toMatchObject({ stoppedReason: null, calls: 42 });
  }, 30_000);

  it('a refusal is paid for and recorded as an unparseable proposal; the run continues', async () => {
    const m = manifest(); const { budget } = experiment(m); const { send } = loopback({ refuseAt: 14 }); const out = sink();
    const summary = await runAccountedStudy(m, budget, send, out.sink, { sourceRevision: 'test' });
    expect(summary).toMatchObject({ stoppedReason: null, calls: 42, bookedMicroUsd: String(42 * PER_CALL) });
    const refused = out.calls.find((c) => c.index === 14)!;
    expect(refused).toMatchObject({ outcome: 'response_recorded', actionable: false, status: 'refused' });
    const verdict = out.episodes[0]!.events.find((e) => e.kind === 'validator_verdict' && e.actor === refused.actorId && e.tick === refused.tick)!;
    expect((verdict.data as { code: string }).code).toBe('unparseable');
  });

  it('the allowance running out stops the run as budget_stopped and never dispatches unreserved', async () => {
    const ceiling = usageCost(36864, 2048, PRICES);
    const m = manifest(undefined, { limitMicroUsd: 9 * PER_CALL + ceiling });
    const { budget } = experiment(m); const { send, seen } = loopback(); const out = sink();
    const summary = await runAccountedStudy(m, budget, send, out.sink, { sourceRevision: 'test' });
    expect(summary.stoppedReason).toBe('budget_stopped:cost_limit');
    expect(seen.length).toBe(budget.view().requests.length);
    expect(seen.length).toBe(10);
    expect(out.episodes[0]!.status).toBe('budget_stopped');
    expect(new Set(out.episodes[0]!.construct!.actors.map((a) => a.outcome))).toEqual(new Set(['budget_stopped']));
  });

  it('refuses a run whose allowance was authorised for a different manifest, before any reservation', async () => {
    const m = manifest(); const { budget } = experiment(m, { manifestSha256: 'f'.repeat(64) }); const { send, seen } = loopback();
    await expect(runAccountedStudy(m, budget, send, sink().sink, { sourceRevision: 'test' })).rejects.toThrow('allowance_manifest_mismatch');
    expect(seen.length).toBe(0); expect(budget.view().requests.length).toBe(0);
  });
});

describe('operator settlement and resume — no stranded allowance, no re-sent paid request', () => {
  const settle = (b: ExperimentBudget, requestId: string, over = {}) => b.settleUnknown({ requestId, operator: 'TEST-ONLY operator', note: 'TEST ONLY: transport failed.',
    settledAt: new Date().toISOString(), basis: 'book_full_reserved_ceiling', ...over });

  it('settlement books the full ceiling, never less, and only for a request with no receipt', () => {
    const { budget } = experiment(manifest());
    const q = (id: string, tick: number): ExperimentReservation => ({ id, episodeId: 'ep', actorId: 'a', inputSha256: 'b'.repeat(64), participant: who(tick), model: EXPERIMENT_MODEL, maxInputTokens: 30000, maxOutputTokens: 2048 });
    budget.reserve(q('lost', 0));
    const ceiling = budget.view().requests[0]!.ceilingMicroUsd;
    expect(settle(budget, 'lost')).toBe('settled');
    expect(settle(budget, 'lost', { settledAt: budget.view().requests[0]!.settlement!.settledAt })).toBe('duplicate');
    expect(budget.view()).toMatchObject({ canReserve: true, held: 0n, booked: BigInt(ceiling) });
    budget.reserve(q('ok', 1));
    budget.recordUsage({ requestId: 'ok', receiptId: 'resp_ok', sourceSha256: 'c'.repeat(64), model: EXPERIMENT_MODEL, inputTokens: 1, outputTokens: 1 });
    expect(() => settle(budget, 'ok')).toThrow('experiment_budget_settlement');
    budget.reserve(q('wrong', 2));
    budget.recordUsage({ requestId: 'wrong', receiptId: 'resp_w', sourceSha256: 'c'.repeat(64), model: 'other-model', inputTokens: 1, outputTokens: 1 });
    expect(() => settle(budget, 'wrong')).toThrow('experiment_budget_settlement');
    expect(budget.view().canReserve).toBe(false);
  });

  it('after a failure and settlement, resume skips completed episodes and re-runs the interrupted one as a new attempt', async () => {
    const eps = [{ episodeId: 'council-r1', scenario: 'authority_attribution_council', replicate: 1 }, { episodeId: 'anonymous-r1', scenario: 'authority_attribution_anonymous', replicate: 1 }];
    const m = manifest(eps, { maxRequests: 84 + 42 });
    const { budget } = experiment(m);
    const first = loopback({ failAt: 50 }); const out1 = sink();
    const s1 = await runAccountedStudy(m, budget, first.send, out1.sink, { sourceRevision: 'test' });
    expect(s1).toMatchObject({ stoppedReason: 'inference_failed:transport_failed', episodesCompleted: 1, calls: 51 });
    const failed = out1.calls.find((c) => c.outcome === 'transport_failed')!;
    settle(budget, failed.requestId);
    // Provider response ids are unique; the ledger refuses a reused receipt id (tested implicitly here).
    const second = loopback({ prefix: 'b' }); const out2 = sink();
    const s2 = await runAccountedStudy(m, budget, second.send, out2.sink, { sourceRevision: 'test', completedEpisodes: new Set(['council-r1']) });
    expect(s2).toMatchObject({ stoppedReason: null, episodesSkipped: 1, episodesCompleted: 1, calls: 42 });
    const ids = budget.view().requests.map((q) => q.request.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(51 + 42);
    expect(new Set(budget.view().requests.map((q) => q.request.episodeId))).toEqual(new Set(['council-r1', 'anonymous-r1', 'anonymous-r1:a2']));
    expect(out2.calls.every((c) => !out1.calls.some((d) => d.requestId === c.requestId))).toBe(true);
    expect(out2.episodes[0]!.status).toBe('completed');
    expect(budget.view().booked).toBe(BigInt(92 * PER_CALL) + BigInt(budget.view().requests.find((q) => q.request.id === failed.requestId)!.ceilingMicroUsd));
  });

  it('refuses to skip an episode that is not in the manifest', async () => {
    const m = manifest(); const { budget } = experiment(m);
    await expect(runAccountedStudy(m, budget, loopback().send, sink().sink, { sourceRevision: 'test', completedEpisodes: new Set(['made-up']) })).rejects.toThrow('completed_episode_not_in_manifest');
  });

  it('paces dispatch starts at least minIntervalMs apart', async () => {
    const m = { ...manifest(), minIntervalMs: 25 }; const { budget } = experiment(m); const { send } = loopback();
    const starts: number[] = [];
    await runAccountedStudy(m, budget, (input, signal) => { starts.push(performance.now()); return send(input, signal); }, sink().sink, { sourceRevision: 'test' });
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(23);
  });
});

describe('the committed study manifest', () => {
  it('matches the owner decisions and fits its allowance', () => {
    const m = JSON.parse(readFileSync('evals/manifests/authority_attribution_study_1.json', 'utf8')) as StudyManifest;
    validateManifest(m);
    expect(m.model).toBe(EXPERIMENT_MODEL);
    expect(m.episodes.length).toBe(15);
    expect(m.allowance).toEqual({ maxRequests: 714, limitMicroUsd: 5_000_000, perRequestMicroUsd: 20000, windowHours: 72 });
    for (const arm of ['council', 'anonymous', 'none']) expect(m.episodes.filter((e) => e.scenario.endsWith(arm)).length).toBe(5);
    // Counterbalanced: each arm occupies each within-replicate position (Latin square rows 1-3).
    const position = (r: number, arm: string) => m.episodes.filter((e) => e.replicate === r).findIndex((e) => e.scenario.endsWith(arm));
    for (const arm of ['council', 'anonymous', 'none']) expect(new Set([1, 2, 3].map((r) => position(r, arm)))).toEqual(new Set([0, 1, 2]));
    expect(usageCost(36864, 2048, PRICES)).toBeLessThanOrEqual(m.allowance.perRequestMicroUsd);
    // At the recorded 18 Oct usage (~13k in / ~300 out), 630 calls book about 3.5 of the 5 USD.
    expect(630 * usageCost(13000, 300, PRICES)).toBeLessThan(m.allowance.limitMicroUsd);
  });
});
