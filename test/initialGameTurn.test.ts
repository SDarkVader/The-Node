import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { InitialTestBudget } from '../src/agent/initialTestBudget.js';
import { runInitialGameTurn } from '../src/agent/initialGameTurn.js';
import { submitAccountedDecision } from '../src/agent/accountedBroker.js';
import { OfflineParticipantHost } from '../src/agent/host.js';
import { fixtureGenesis, createParticipantState } from '../src/agent/participantWorld.js';
import { setup, root, cleanup, response } from './fixtures/accountingFixture.js';

const budgets: InitialTestBudget[] = [], hosts: OfflineParticipantHost[] = [];
afterEach(() => { hosts.splice(0).forEach(h => h.close()); budgets.splice(0).forEach(b => b.close()); cleanup(); });
function fixture() {
  const { ledger } = setup(), budget = InitialTestBudget.create(join(root(), 'budget'), ledger.exportDocument()); budgets.push(budget);
  const now = new Date(); budget.authorize({ runId: 'TEST-ONLY-game-turn', authorizedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    expectedHistoryHash: budget.view().historyHash, instruction: 'TEST ONLY: disposable offline game-turn integration; not a paid authorization.', scope: 'additional_initial_test_spending_only',
    model: 'gpt-5.4-nano-2026-03-17', maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000,
    prices: { model: 'gpt-5.4-nano-2026-03-17', inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) } });
  const genesis = fixtureGenesis(32), person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!;
  const h = new OfflineParticipantHost(genesis, person.id, 'TEST-only-controller-token'); hosts.push(h); const session = h.authenticate('TEST-only-controller-token');
  const host = { read: async () => h.read(session), submitDecision: async (o: ReturnType<typeof h.read>, d: any) => { submitAccountedDecision(h, session, o.observationId, o.context.tick, d); },
    advance: async () => h.advance(), exportTape: async () => h.exportTape(), evidence: async () => h.evidence() };
  const bytes = (decision: unknown = { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } }, overrides = {}) => {
    const value = JSON.parse(response({ model: 'gpt-5.4-nano-2026-03-17', ...overrides }).toString());
    value.output.unshift({ type: 'reasoning', summary: [], content: [], encrypted_content: 'opaque-fixture-only' });
    value.output[1].content[0].text = JSON.stringify(decision); return Buffer.from(JSON.stringify(value));
  };
  return { budget, host, h, session, bytes };
}
describe('one explicitly budgeted game turn', () => {
  it('reserves final wire before dispatch, books usage before admission, applies a real effect and replays complete state', async () => {
    const f = fixture(); let calls = 0;
    const result = await runInitialGameTurn(f.budget, { ...f.host, submitDecision: async (o, d) => {
      expect(f.budget.view().requests[0]!.bookedMicroUsd).toBe(29n); return f.host.submitDecision(o, d);
    } }, async request => {
      calls++; const q = f.budget.view().requests[0]!; expect(q.request.inputSha256).toBe(request.sha256); expect(q.bookedMicroUsd).toBeNull();
      expect(q.ceilingMicroUsd).toBeLessThanOrEqual(20000); return f.bytes();
    });
    expect(calls).toBe(1); expect(result).toMatchObject({ status: 'applied', replayVerified: true, tickBefore: 0, tickAfter: 1, admittedActionCount: 1 });
    if (result.status !== 'applied') throw Error('offline turn failed');
    expect(result.effects.some(x => x.category === 'bakerPrice')).toBe(true); expect(result.after.price).toBe(0.75); expect(result.completeStateHash).toBe(result.replayHash);
  });
  it('retains cost on invalid decisions, never advances, and never dispatches the same tick twice', async () => {
    const f = fixture(); let calls = 0; const sender = async () => { calls++; return f.bytes({ move: { x: 999, y: 999 }, communication: null, diary: null, role: null }); };
    expect(await runInitialGameTurn(f.budget, f.host, sender)).toMatchObject({ status: 'rejected', code: 'invalid_decision' });
    expect(f.budget.view().booked).toBe(29n); expect(f.h.read(f.session).context.tick).toBe(0);
    expect((await runInitialGameTurn(f.budget, f.host, sender)).status).toBe('rejected'); expect(calls).toBe(1);
  });
  it('accounts usage before rejecting a stale world context', async () => {
    const f = fixture(); const result = await runInitialGameTurn(f.budget, f.host, async () => { f.h.advance(); return f.bytes(); });
    expect(result).toMatchObject({ status: 'rejected', code: 'stale_context' }); expect(f.budget.view().booked).toBe(29n); expect(f.h.exportTape().ticks[0]!.actions).toEqual([]);
  });
  it('does not reserve or dispatch for an already-cancelled request', async () => {
    const f = fixture(), c = new AbortController(); c.abort(); let calls = 0;
    expect((await runInitialGameTurn(f.budget, f.host, async () => { calls++; return f.bytes(); }, { signal: c.signal })).status).toBe('rejected');
    expect(calls).toBe(0); expect(f.budget.view().requests).toHaveLength(0);
  });
  it('retains a full hold after transport failure and blocks overlapping or replacement dispatch', async () => {
    const f = fixture(); let calls = 0;
    const sender = async () => { calls++; throw Error('fixture transport failure'); };
    expect((await runInitialGameTurn(f.budget, f.host, sender)).status).toBe('rejected');
    expect(f.budget.view().held).toBeGreaterThan(0n); expect((await runInitialGameTurn(f.budget, f.host, sender)).status).toBe('rejected'); expect(calls).toBe(1);
  });
  it('accounts an incomplete reply without admitting its action', async () => {
    const f = fixture(); expect(await runInitialGameTurn(f.budget, f.host, async () => f.bytes(undefined, { status: 'incomplete' }))).toMatchObject({ status: 'rejected', code: 'response_not_actionable' });
    expect(f.budget.view().booked).toBe(29n); expect(f.h.exportTape().ticks).toHaveLength(0);
  });
  it('retains a wrong-model hold and refuses its action', async () => {
    const f = fixture(); expect((await runInitialGameTurn(f.budget, f.host, async () => f.bytes(undefined, { model: 'unexpected' }))).status).toBe('rejected');
    expect(f.budget.view().held).toBeGreaterThan(0n); expect(f.h.exportTape().ticks).toHaveLength(0);
  });
  it('rejects a response after a synchronous stall even when timer delivery was delayed', async () => {
    const f = fixture(); const result = await runInitialGameTurn(f.budget, f.host, async () => {
      const until = performance.now() + 70; while (performance.now() < until) {} return f.bytes();
    }, { deadlineMs: 50 });
    expect(result).toMatchObject({ status: 'rejected', code: 'deadline_or_cancelled_after_accounting' }); expect(f.budget.view().booked).toBe(29n); expect(f.h.exportTape().ticks).toHaveLength(0);
  });
  it('reports a post-commit replay failure honestly instead of pretending no action happened', async () => {
    const f = fixture(); const result = await runInitialGameTurn(f.budget, { ...f.host, evidence: async () => 'incorrect-fixture-hash' }, async () => f.bytes());
    expect(result).toMatchObject({ status: 'applied_replay_failed' }); expect(f.h.exportTape().ticks).toHaveLength(1); expect(f.budget.view().booked).toBe(29n);
  });
});
