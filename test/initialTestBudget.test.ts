import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InitialTestBudget, inspectDiagnostic, type DiagnosticEvidence, type InitialTestAuthorization, type TestReservation } from '../src/agent/initialTestBudget.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { setup, root, cleanup, context, response } from './fixtures/accountingFixture.js';

const budgets: InitialTestBudget[] = [];
const tracked = (b: InitialTestBudget) => { budgets.push(b); return b; };
afterEach(() => { for (const b of budgets.splice(0)) { try { b.close(); } catch {} } cleanup(); });
const at = '2026-10-18T00:00:00.000Z';
function fixture(options: Parameters<typeof InitialTestBudget.create>[2] = {}) {
  const { ledger } = setup(), historical = ledger.exportDocument(), directory = join(root(), 'test-budget');
  return { historical, directory, budget: tracked(InitialTestBudget.create(directory, historical, options)) };
}
function authorize(b: InitialTestBudget): InitialTestAuthorization {
  const a: InitialTestAuthorization = { runId: 'TEST-ONLY-budget', authorizedAt: at, expiresAt: '2026-10-19T00:00:00.000Z', expectedHistoryHash: b.view().historyHash,
    instruction: 'TEST ONLY. Exercise a forward budget in a disposable fixture, not a real financial authorization.', scope: 'additional_initial_test_spending_only',
    model: 'gpt-5.4-nano-2026-03-17', maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000,
    prices: { model: 'gpt-5.4-nano-2026-03-17', inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) } };
  b.authorize(a); return a;
}
const request = (tick = 0): TestReservation => ({ id: `request-${tick}`, inputSha256: 'b'.repeat(64), context: { ...context(), tick }, model: 'gpt-5.4-nano-2026-03-17', maxInputTokens: 36864, maxOutputTokens: 2048 });
const receipt = (tick = 0, inputTokens = 12000, outputTokens = 200) => ({ requestId: `request-${tick}`, receiptId: `resp_${tick}`, sourceSha256: 'c'.repeat(64), model: 'gpt-5.4-nano-2026-03-17', inputTokens, outputTokens });
function metadata(id = 'resp_imported'): DiagnosticEvidence {
  return { kind: 'generation', provenance: 'saved_artifact', response: null, report: JSON.stringify({ checkedAtUtc: '2026-10-18T00:00:00.000Z',
    attemptedRequests: 1, httpStatus: 200, responseId: id, modelReturned: 'gpt-4.1-nano-2025-04-14', inputTokens: 12, outputTokens: 2, cachedInputTokens: 0, estimatedCostUsd: 0.000002,
    pricing: { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 0.4 } }) };
}

describe('diagnostic evidence import without billing reconstruction', () => {
  it('imports once across restart, retains the original history and conflicts on changed duplicates', () => {
    const { budget, directory, historical } = fixture(), e = metadata();
    expect(budget.importDiagnostic(e)).toBe('imported'); const before = readFileSync(join(directory, 'accounting.journal.json'), 'utf8');
    expect(budget.importDiagnostic(structuredClone(e))).toBe('duplicate'); expect(readFileSync(join(directory, 'accounting.journal.json'), 'utf8')).toBe(before);
    const view = budget.view(); expect(view.carriedAdmissionCount).toBe(10); expect(view.historical.historicalActorHoldMicroUsd).toBe(19114);
    expect(view.historical.actualBilledMicroUsd).toBeNull(); expect(view.historical.historicalDiagnosticHoldMicroUsd).toBeNull();
    expect(JSON.stringify(historical)).toContain('documentary_reconstruction'); expect(view.authorization).toBeNull(); expect(view.canReserve).toBe(false);
    budget.close(); const reopened = tracked(InitialTestBudget.open(directory)); expect(reopened.view().historyHash).toBe(view.historyHash);
    expect(reopened.importDiagnostic(e)).toBe('duplicate');
    const r = JSON.parse(e.report); r.inputTokens = 13; r.estimatedCostUsd = 0.0000021;
    expect(() => reopened.importDiagnostic({ ...e, report: JSON.stringify(r) })).toThrow('conflict');
  });
  it('retains successful non-generating controls and unknown failed attempts separately', () => {
    const { budget } = fixture();
    for (const [n, status] of [200, null].entries()) {
      const e: DiagnosticEvidence = { kind: 'models-list', provenance: n ? 'tool_output_transcription' : 'saved_artifact', response: null,
        report: JSON.stringify({ checkedAtUtc: `2026-10-18T00:00:0${n}.000Z`, method: 'GET', endpoint: 'https://api.openai.com/v1/models', generationAttempted: false, httpStatus: status }) };
      budget.importDiagnostic(e);
    }
    expect(budget.view().carriedAdmissionCount).toBe(11); expect(budget.view().diagnostics.map(d => d.estimatedNanoUsd)).toEqual(['0', null]);
    expect(budget.view().historical.historicalDiagnosticHoldMicroUsd).toBeNull();
  });
  it('verifies archived receipt bytes and usage independently of action success', () => {
    const raw = response(), parsed = JSON.parse(raw.toString());
    const e = metadata(); e.response = raw.toString();
    e.report = JSON.stringify({ finishedAtUtc: at, attemptedRequests: 1, network: { httpStatus: 200 },
      receipt: { receiptId: parsed.id, model: parsed.model, sourceSha256: sha256(raw), usage: { inputTokens: 10, outputTokens: 10 } },
      estimatedCostUsd: 0.000005, pricing: { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 0.4 } });
    expect(inspectDiagnostic(e)).toMatchObject({ usage: { inputTokens: 10, outputTokens: 10 }, estimatedNanoUsd: '5000' });
    e.response += ' '; expect(() => inspectDiagnostic(e)).toThrow('receipt');
  });
  it('rejects stale, unsupported and fabricated usage records without changing accounting', () => {
    const { budget } = fixture(), hash = budget.view().historyHash;
    for (const update of [{ inputTokens: -1 }, { cachedInputTokens: 13 }, { estimatedCostUsd: 0 }, { checkedAtUtc: '2026-10-16T00:00:00.000Z' }, { responseId: null }]) {
      const e = metadata(); e.report = JSON.stringify({ ...JSON.parse(e.report), ...update });
      expect(() => budget.importDiagnostic(e)).toThrow(); expect(budget.view().historyHash).toBe(hash);
    }
  });
});

describe('bounded additional initial-test spending', () => {
  it('grants five additional requests without charging, forgiving or altering historical billing', () => {
    const { budget } = fixture(); budget.importDiagnostic(metadata()); authorize(budget);
    const v = budget.view(at); expect(v.remainingMicroUsd).toBe(100000n); expect(v.carriedAdmissionCount).toBe(10);
    expect(v.historical.historicalActorHoldMicroUsd).toBe(19114); expect(v.historical.authorization).toBeNull(); expect(v.historicalBillingReconciled).toBe(false);
    expect(v.budgetScope).toBe('new_test_spending_only'); expect(v.canReserve).toBe(true);
  });
  it('cannot authorize without a matching history or silently widen/reset a grant', () => {
    const { budget } = fixture(); const a = authorize(budget), before = budget.view().historyHash;
    budget.authorize(structuredClone(a)); expect(budget.view().historyHash).toBe(before);
    expect(() => budget.authorize({ ...a, runId: 'another' })).toThrow('conflict');
    const fresh = fixture().budget;
    expect(() => fresh.authorize({ ...a, expectedHistoryHash: '0'.repeat(64) })).toThrow('authorization');
    expect(() => fresh.authorize({ ...a, expectedHistoryHash: fresh.view().historyHash, maxRequests: 6 as 5 })).toThrow('authorization');
  });
  it('consumes five requests even at zero usage, rejects a sixth and survives reopen', () => {
    const { budget, directory } = fixture(); authorize(budget);
    for (let i = 0; i < 5; i++) { expect(budget.reserve(request(i), at)).toBe('reserved'); budget.recordUsage(receipt(i, 0, 0)); }
    expect(budget.view(at).remainingMicroUsd).toBe(100000n); expect(budget.view(at).canReserve).toBe(false);
    expect(() => budget.reserve(request(5), at)).toThrow('admission'); budget.close();
    const reopened = tracked(InitialTestBudget.open(directory)); expect(reopened.view(at).requests).toHaveLength(5); expect(() => reopened.reserve(request(5), at)).toThrow('admission');
  });
  it('persists a full unresolved hold and blocks overlapping requests after restart', () => {
    const { budget, directory } = fixture(); authorize(budget); budget.reserve(request(), at); const before = budget.view(at);
    expect(before.held).toBe(19866n); expect(before.canReserve).toBe(false); budget.close(); const reopened = tracked(InitialTestBudget.open(directory));
    expect(reopened.view(at).held).toBe(before.held); expect(() => reopened.reserve(request(1), at)).toThrow('admission');
    expect(reopened.reserve(request(), at)).toBe('duplicate'); expect(() => reopened.reserve({ ...request(), inputSha256: 'd'.repeat(64) }, at)).toThrow('conflict');
  });
  it('books known usage idempotently and retains a wrong-model response as unresolved', () => {
    const { budget } = fixture(); authorize(budget); budget.reserve(request(), at);
    expect(budget.recordUsage(receipt())).toBe('recorded'); const before = budget.view(at).historyHash;
    expect(budget.recordUsage(receipt())).toBe('duplicate'); expect(budget.view(at).historyHash).toBe(before);
    expect(() => budget.recordUsage(receipt(0, 0, 0))).toThrow('conflict');
    budget.reserve(request(1), at); budget.recordUsage({ ...receipt(1), model: 'unexpected-model' });
    expect(budget.view(at).requests[1]!.bookedMicroUsd).toBeNull(); expect(budget.view(at).canReserve).toBe(false);
  });
  it('retains honest cost overruns and blocks future spending instead of clamping/refunding', () => {
    const { budget, directory } = fixture(); authorize(budget); budget.reserve(request(), at); budget.recordUsage(receipt(0, 500000, 0));
    expect(budget.view(at)).toMatchObject({ overrun: true, booked: 200000n, remainingMicroUsd: -100000n, canReserve: false });
    budget.close(); expect(tracked(InitialTestBudget.open(directory)).view(at).overrun).toBe(true);
  });
  it('rejects expired grants, different actors/models, reused ticks and imported provider receipts', () => {
    const { budget } = fixture(); budget.importDiagnostic(metadata('resp_0')); authorize(budget);
    expect(() => budget.reserve(request(), '2026-10-19T00:00:00.000Z')).toThrow('admission');
    expect(() => budget.reserve({ ...request(), model: 'different' }, at)).toThrow('admission');
    budget.reserve(request(), at); expect(() => budget.recordUsage(receipt())).toThrow('receipt');
    budget.recordUsage({ ...receipt(), receiptId: 'resp_new' });
    expect(() => budget.reserve({ ...request(1), context: { ...request(1).context, selfRef: 'another' } }, at)).toThrow('admission');
    expect(() => budget.reserve({ ...request(1), context: context() }, at)).toThrow('admission');
  });
  it('closes new diagnostic imports after authorization while retaining exact duplicate idempotency', () => {
    const { budget } = fixture(), e = metadata(); budget.importDiagnostic(e); authorize(budget);
    expect(budget.importDiagnostic(e)).toBe('duplicate'); expect(() => budget.importDiagnostic(metadata('another'))).toThrow('import_closed');
  });
  it.each(['before_write', 'after_file_sync', 'after_rename'] as const)('recovers one whole import or no import after %s failure', stage => {
    let armed = false;
    const { budget, directory } = fixture({ fault: s => { if (armed && s === stage) throw Error('TEST-only mechanical interruption'); } });
    armed = true; expect(() => budget.importDiagnostic(metadata())).toThrow('write_failed'); budget.close();
    const reopened = tracked(InitialTestBudget.open(directory));
    expect(reopened.view().diagnostics.length).toBe(stage === 'after_rename' ? 1 : 0);
    reopened.importDiagnostic(metadata()); expect(reopened.view().diagnostics).toHaveLength(1); expect(reopened.view().carriedAdmissionCount).toBe(10);
  });
  it('never initializes missing state on open or replaces an existing budget directory', () => {
    const { budget, directory, historical } = fixture(); budget.close();
    expect(() => InitialTestBudget.open(join(root(), 'missing'))).toThrow(); expect(() => InitialTestBudget.create(directory, historical)).toThrow();
  });
});
