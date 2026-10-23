import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, rmdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { continuationPlan, continuationGenesis, continuationBudget, simulatedContinuationProvider } from './fixtures/continuationFixture.js';
import { root, cleanup } from './fixtures/accountingFixture.js';
import { ContinuationHost } from '../src/eval/continuationHost.js';
import { ContinuationConversations, conversationObservations, unpackContinuationObservation, observationPatch, applyObservationPatch } from '../src/eval/continuationConversation.js';
import { ContinuationLedger, readContinuationLedger, verifyContinuation, continuationInspectSamples, type ContinuationEvent } from '../src/eval/continuationLedger.js';
import { runContinuation, type ContinuationPlan } from '../src/eval/continuationRunner.js';
import { digest } from '../src/agent/replay.js';

import { INTENTS, TONES } from '../src/comms/proximityConversation.js';
import { OBSERVATIONS, READINGS } from '../src/engine/diary.js';

const REVISION = 'a'.repeat(40), open: { close(): void }[] = [];
afterEach(() => { for (const b of open.splice(0)) b.close(); cleanup(); });
const track = <T extends { close(): void }>(x: T): T => { open.push(x); return x; };
async function run(options: Parameters<typeof simulatedContinuationProvider>[0] = {}, plan = continuationPlan(), signal?: AbortSignal) {
  const budget = track(continuationBudget(plan)), ledger = track(new ContinuationLedger(join(root(), 'trace')));
  const provider = simulatedContinuationProvider(options);
  const send: typeof provider.send = (input, abort) => {
    const held = budget.view().requests.filter(q => q.bookedMicroUsd === null);
    expect(held.map(q => q.request.id)).toEqual([input.requestId]);
    expect(held[0]!.request.inputSha256).toBe(input.sha256);
    return provider.send(input, abort);
  };
  const summary = await runContinuation(plan, continuationGenesis(REVISION), budget, send, ledger,
    { sourceRevision: REVISION, mode: 'offline_simulated_provider', signal });
  ledger.close();
  const events = readContinuationLedger(ledger.path);
  return { summary, events, path: ledger.path, provider, budget, verification: verifyContinuation(events, REVISION) };
}
function rechain(events: ContinuationEvent[]) {
  let previous = '0'.repeat(64);
  for (const e of events) { e.previous = previous; e.hash = digest([e.seq, previous, e.kind, e.data]); previous = e.hash; }
  return events;
}

describe('stateful continuation — simulated provider, real Node host', () => {
  it('changes the real world twice, retains exact own reasoning/signatures and joins actual consequences', async () => {
    const r = await run({ redacted: true });
    expect(r.summary).toMatchObject({ status: 'completed', calls: 4, ticks: 2, heldMicroUsd: '0' });
    expect(r.verification).toMatchObject({ verified: true, complete: true, transitions: 2, metrics: 'not_validated' });
    const transitions = r.events.filter(e => e.kind === 'transition');
    expect(transitions[0]!.data.afterHash).toBe(transitions[1]!.data.beforeHash);
    expect(transitions[0]!.data.beforeHash).not.toBe(transitions[0]!.data.afterHash);
    for (const actor of ['baker-0', 'baker-1']) {
      const calls = r.provider.requests.filter(q => q.actorId === actor);
      const first = JSON.parse(calls[0]!.body), second = JSON.parse(calls[1]!.body);
      const response = r.events.find(e => e.kind === 'response' && e.data.requestId === calls[0]!.requestId)!.data;
      const returned = JSON.parse(Buffer.from(response.raw, 'base64').toString());
      expect(second.system).toBe(first.system);
      expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
      expect(second.messages[1]).toEqual({ role: 'assistant', content: returned.content });
      expect(JSON.stringify(second.messages)).not.toContain('signature-' + (actor === 'baker-0' ? 'baker-1' : 'baker-0'));
      const observations = conversationObservations(second.messages).map(unpackContinuationObservation);
      expect(observations.map(o => o.tick)).toEqual([0, 1]);
      expect(observations[1]!.self.price).toBe(0.5);
      expect(Number(observations[1]!.self.wealth)).toBeGreaterThan(0);
      const after = transitions[1]!.data.after.find((v: any) => v.actorId === actor).observation.projection;
      expect(after.self.price).toBe(0.55);
      expect(Number(after.self.wealth)).toBeGreaterThan(Number(observations[1]!.self.wealth));
    }
    expect(transitions.flatMap(e => e.data.effects).filter(e => e.category === 'bakerPrice')).toHaveLength(4);
    const rows = continuationInspectSamples(r.events, REVISION);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.metadata.kernelEffects).toHaveLength(1);
    expect(rows[0]!.metadata.explicitExplanation).toBeNull();
    expect(rows[0]!.metadata.inferredCausality).toEqual([]);
  });

  it.each([10, 20, 50])('runs %i configured calls across the seven actors with genuine tick transitions', async count => {
    const r = await run({ redacted: true }, continuationPlan(count));
    expect(r.summary).toMatchObject({ status: 'completed', calls: count, ticks: Math.ceil(count / 7), heldMicroUsd: '0' });
    expect(new Set(r.provider.requests.map(q => q.actorId)).size).toBe(7);
    expect(r.verification.transitions).toBe(Math.ceil(count / 7));
    const final = r.events.filter(e => e.kind === 'transition').at(-1)!;
    expect(final.data.scheduledActors).toHaveLength(count % 7 || 7);
    expect(final.data.tapeTick.actions).toHaveLength(count % 7 || 7);
    for (const q of r.provider.requests) expect(Buffer.byteLength(q.body)).toBeLessThanOrEqual(32768);
  });

  it('verifies evidence and exports an Inspect dataset in a fresh process with no previous in-memory state', async () => {
    const r = await run(), out = join(root(), 'inspect.jsonl');
    const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'test/cli/verify-continuation.ts', r.path, REVISION, out],
      { cwd: resolve('.'), windowsHide: true, encoding: 'utf8' }));
    expect(result).toMatchObject({ verified: true, complete: true, calls: 4, transitions: 2, finalStateHash: r.summary.finalStateHash });
    expect(readFileSync(out, 'utf8').trim().split('\n')).toHaveLength(4);
  });

  it.each([
    [{ invalidAt: 1 }, 'decision_rejected', 2, false],
    [{ failAt: 1 }, 'inference_failed:transport_failed', 2, true],
    [{ missingUsageAt: 0 }, 'inference_failed:usage_unknown', 1, true],
    [{ wrongModelAt: 0 }, 'inference_failed:model_mismatch', 1, true],
    [{ refusalAt: 0 }, 'inference_failed:non_actionable', 1, false],
    [{ overrunAt: 0 }, 'budget_stopped:overrun', 1, false],
    [{ transformedAt: 0 }, 'inference_failed:reasoning_transformed', 1, false],
  ] as const)('preserves evidence and stops without applying a partial tick: %j', async (options, status, calls, held) => {
    const r = await run(options);
    expect(r.summary).toMatchObject({ status, calls, ticks: 0 });
    expect(BigInt(r.summary.heldMicroUsd) > 0n).toBe(held);
    expect(r.events.filter(e => e.kind === 'transition')).toHaveLength(0);
    expect(r.verification.complete).toBe(true);
    expect(r.events.some(e => e.kind === 'response')).toBe(true);
  });

  it('holds an ambiguous timeout and never retries it or advances the simulation', async () => {
    const plan = continuationPlan(); plan.deadlineMs = 5;
    const r = await run({ hangAt: 0 }, plan);
    expect(r.summary.status).toBe('inference_failed:transport_failed');
    expect(r.provider.requests).toHaveLength(1);
    expect(r.summary.ticks).toBe(0);
    expect(BigInt(r.summary.heldMicroUsd)).toBeGreaterThan(0n);
  });

  it('keeps the full signed history when it exceeds the bound and stops BEFORE a new reservation', async () => {
    const r = await run({ largeSignature: true });
    expect(r.summary).toMatchObject({ status: 'continuation_request_bound', calls: 2, ticks: 1, heldMicroUsd: '0' });
    const stop = r.events.at(-1)!.data;
    expect(JSON.stringify(stop.histories)).toContain('x'.repeat(28000));
    expect(r.budget.view().requests).toHaveLength(2);
  });

  it('rejects a new run with an already-used allowance and sends no additional calls', async () => {
    const r = await run(), ledger = track(new ContinuationLedger(join(root(), 'next')));
    const provider = simulatedContinuationProvider();
    await expect(runContinuation(continuationPlan(), continuationGenesis(REVISION), r.budget, provider.send, ledger,
      { sourceRevision: REVISION, mode: 'offline_simulated_provider' })).rejects.toThrow('separate_unused_allowance');
    expect(provider.requests).toHaveLength(0);
  });

  it('stops at the spending ceiling without contacting the simulated provider', async () => {
    const plan = continuationPlan(); plan.allowance.limitMicroUsd = 1; plan.allowance.perRequestMicroUsd = 1;
    const r = await run({}, plan);
    expect(r.summary).toMatchObject({ status: 'budget_stopped:request_ceiling', calls: 0, ticks: 0 });
  });

  it('cancels before dispatch without creating reservations', async () => {
    const abort = new AbortController(); abort.abort();
    const r = await run({}, continuationPlan(), abort.signal);
    expect(r.summary).toMatchObject({ status: 'cancelled', calls: 0, ticks: 0 });
    expect(r.budget.view().requests).toHaveLength(0);
  });

  it('detects edited signatures, forged observations and falsified transitions even with a rebuilt hash chain', async () => {
    const r = await run();
    const edits: ((events: ContinuationEvent[]) => void)[] = [
      es => { es.find(e => e.kind === 'request')!.data.observation.projection.self.wealth = 10000; },
      es => { const q = es.filter(e => e.kind === 'request')[2]!; const b = JSON.parse(q.data.body); b.messages[1].content[0].signature = 'tampered'; q.data.body = JSON.stringify(b); },
      es => { es.find(e => e.kind === 'transition')!.data.after[0].observation.projection.self.wealth = 10000; },
      es => { es.find(e => e.kind === 'receipt')!.data.reasoning.summaries = ['invented']; },
      es => { es.find(e => e.kind === 'transition')!.data.tapeTick.actions = []; },
    ];
    for (const edit of edits) {
      const changed = structuredClone(r.events); edit(changed);
      expect(() => verifyContinuation(rechain(changed), REVISION)).toThrow();
    }
    expect(() => verifyContinuation(r.events, 'b'.repeat(40))).toThrow('source_mismatch');
    expect(verifyContinuation(r.events.slice(0, -1), REVISION).complete).toBe(false);
    const changed = structuredClone(r.events); changed[1]!.data.tick = 88;
    expect(() => verifyContinuation(changed, REVISION)).toThrow('chain');
  });

  it('refuses stale leases and unselected actors through the real host', () => {
    const host = new ContinuationHost(continuationGenesis(REVISION), continuationPlan().actors), views = host.views();
    const proposals = Object.fromEntries(views.map(v => [v.actorId, { move: null, communication: null, diary: null, role: null }]));
    host.advance(views, proposals);
    expect(() => host.advance(views, proposals)).toThrow('stale_observation');
    expect(() => host.advance(host.views(), { impostor: proposals['baker-0'] })).toThrow('actor_coverage');
  });

  it('keeps omitted summaries and redacted blocks exactly, and filters evaluator canaries', () => {
    const host = new ContinuationHost(continuationGenesis(REVISION), continuationPlan().actors), histories = new ContinuationConversations(), view = host.views()[0]!;
    (view.observation.projection as any).privateCanary = 'DO-NOT-LEAK-PRIVATE';
    const request = histories.prepare(view.actorId, view.observation, 'claude-haiku-5-5');
    expect(request.body).not.toContain('DO-NOT-LEAK-PRIVATE');
    const bytes = Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', id: 'msg_empty', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 'EXACT-OPAQUE' }, { type: 'redacted_thinking', data: 'EXACT-REDACTED' },
        { type: 'text', text: '{"move":null,"communication":null,"diary":null,"role":null}' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    histories.accept(view.actorId, request, bytes, 'q');
    host.advance(host.views(), Object.fromEntries(host.views().map(v => [v.actorId, { move: null, communication: null, diary: null, role: null }])));
    const next = histories.prepare(view.actorId, host.views()[0]!.observation, 'claude-haiku-5-5');
    expect(JSON.parse(next.body).messages[1].content).toEqual(JSON.parse(bytes.toString()).content);
  });

  it('losslessly reconstructs changed, inserted and removed observation data', () => {
    const before = { people: [['a', 1, 2], ['b', 3, 4]], diary: ['old'], nested: { removed: 1 } };
    const after = { people: [['c', 8, 9], ['b', 5, 4]], diary: [], nested: { added: 2 } };
    expect(applyObservationPatch(before, observationPatch(before, after))).toEqual(after);
    expect(before.diary).toEqual(['old']);
    expect(() => applyObservationPatch({}, [{ path: ['__proto__', 'bad'], value: 1 }])).toThrow('unsafe_patch');
  });

  it('retains earlier thinking and diary exposure while the real kernel expires the current diary', () => {
    const host = new ContinuationHost(continuationGenesis(REVISION), continuationPlan().actors);
    const actor = 'baker-0';
    // Actual repeated conversations earn recognition; no ledger or world state is injected.
    for (let tick = 0; tick < 40; tick++) {
      const views = host.views(), me = views.find(v => v.actorId === actor)!;
      if (me.observation.context.knownSubjects.length) break;
      const proposals = Object.fromEntries(views.map(v => [v.actorId, { move: null, communication: {
        kind: 'proximityUtterance', intent: INTENTS[0], tone: TONES[0],
        referent: { kind: 'player', playerId: v.observation.context.hearingRefs![0] }, context: null }, diary: null, role: null }]));
      host.advance(views, proposals);
    }
    let views = host.views(), me = views.find(v => v.actorId === actor)!;
    expect(me.observation.context.knownSubjects.length).toBeGreaterThan(0);
    const proposals = Object.fromEntries(views.map(v => [v.actorId, { move: null, communication: null, diary: v.actorId === actor ? {
      subject: me.observation.context.knownSubjects[0], observation: OBSERVATIONS[0], reading: READINGS[0], context: null } : null, role: null }]));
    host.advance(views, proposals);
    const histories = new ContinuationConversations(), received = [];
    for (let i = 0; i < 3; i++) {
      views = host.views(); me = views.find(v => v.actorId === actor)!;
      const request = histories.prepare(actor, me.observation, 'claude-haiku-5-5');
      received.push(request);
      const bytes = Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', id: 'msg_diary_' + i, model: 'claude-haiku-5-5', stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: 'TEST ONLY: prior diary interpretation is revisable.', signature: 'TEST-ONLY-diary-' + i },
          { type: 'text', text: '{"move":null,"communication":null,"diary":null,"role":null}' }], usage: { input_tokens: 1, output_tokens: 1 } }));
      histories.accept(actor, request, bytes, 'diary-' + i);
      host.advance(views, Object.fromEntries(views.map(v => [v.actorId, { move: null, communication: null, diary: null, role: null }])));
    }
    const old = conversationObservations(JSON.parse(received[0]!.body).messages).map(unpackContinuationObservation);
    const newest = conversationObservations(JSON.parse(received[2]!.body).messages).map(unpackContinuationObservation);
    expect(old[0]!.diary).toHaveLength(1);
    expect(newest[0]!.diary).toEqual(old[0]!.diary);
    expect(newest.at(-1)!.diary).toHaveLength(0);
    expect(JSON.parse(received[2]!.body).messages[1].content[0].signature).toBe('TEST-ONLY-diary-0');
  });

  it('refuses paid entry without approval and rejects private artifacts inside dot-prefixed checkout folders', () => {
    for (const script of ['scripts/run-continuation.mjs', 'scripts/prepare-continuation-budget.mjs']) {
      expect(() => execFileSync(process.execPath, [script], { windowsHide: true, stdio: 'pipe' })).toThrow();
    }
    const parent = mkdtempSync(join(resolve('.'), '..continuation-boundary-'));
    try {
      expect(() => execFileSync(process.execPath, ['scripts/run-continuation.mjs', 'MISSING-RUNTIME', 'MISSING-ALLOWANCE',
        join(parent, 'new-private-artifacts'), 'UNREAD-CREDENTIAL', 'UNREAD-PLAN', '--dispatch-authorized-pilot'],
        { windowsHide: true, stdio: 'pipe' })).toThrow('private_artifacts_must_be_outside_checkout');
    } finally { rmdirSync(parent); } // empty directory created by this test only
  });

  it('will not overwrite a prior trace or accept a torn append', async () => {
    const r = await run();
    expect(() => new ContinuationLedger(resolve(r.path, '..'))).toThrow();
    const broken = join(root(), 'broken.jsonl'); writeFileSync(broken, readFileSync(r.path, 'utf8').slice(0, -1));
    expect(() => readContinuationLedger(broken)).toThrow('torn_tail');
  });
});
