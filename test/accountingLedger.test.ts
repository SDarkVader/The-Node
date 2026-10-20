import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, linkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { AccountingLedger, usageCost } from '../src/agent/accountingLedger.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { RECOVERY_HOLD, assertLiveAdmission } from '../src/agent/broker.js';
import { setup, sources, sourceRevision, root, track, rates, approval, authorize, request, cleanup } from './fixtures/accountingFixture.js';

afterEach(cleanup);
const raw = (directory: string) => readFileSync(join(directory, 'accounting.journal.json'), 'utf8');
const receipt = () => ({ receiptId: 'resp_one', requestId: 'test-request', sourceSha256: 'b'.repeat(64), model: 'archived-test-model', status: 'completed' as const,
  usage: { inputTokens: 10, outputTokens: 10 } });
function rewrite(directory: string, change: (d: any) => void) {
  const envelope = JSON.parse(raw(directory)); const d = JSON.parse(envelope.payload); change(d);
  envelope.payload = JSON.stringify(d); envelope.sha256 = sha256(envelope.payload); writeFileSync(join(directory, 'accounting.journal.json'), JSON.stringify(envelope), { mode: 0o600 });
}

describe('documentary reconstruction of the real interrupted account', () => {
  it('carries the full historical hold, combined admissions and unbounded diagnostics without inventing billing', () => {
    const { ledger } = setup(); const view = ledger.view();
    expect(view).toMatchObject({ originalLedgerRecovered: false, eventIdentityGap: true, recordedCombinedAdmissions: 9,
      originalActorIncluded: true, admissionsCharged: 9, historicalActorHoldMicroUsd: 19_114, historicalActorBookedMicroUsd: 0,
      historicalDiagnosticHoldMicroUsd: null, actualBilledMicroUsd: null, bookedMicroUsd: 0n, heldMicroUsd: 19_114n, remainingMicroUsd: null });
    expect(view.blockers).toContain('historical_diagnostic_liability_unbounded');
    expect(RECOVERY_HOLD.originalReservationMicroUsd).toBe(19_114); expect(RECOVERY_HOLD.accountingReconciled).toBe(false);
    expect(() => assertLiveAdmission()).toThrow('recovery_accounting_unresolved');
  });
  it('preserves exact documentary bytes and hashes and accepts LF/CRLF copies', () => {
    const { ledger } = setup(); const document = ledger.exportDocument() as any;
    expect(document.origin.sources).toEqual(sources().map(e => ({ ...e, sha256: sha256(e.bytes) })));
    const other = track(AccountingLedger.reconstruct(join(root(), 'lf'), sources().map(e => ({ ...e, bytes: e.bytes.replace(/\r\n/g, '\n') })), sourceRevision));
    expect(other.view().admissionsCharged).toBe(9);
  });
  it('rejects altered, missing and duplicated recovery evidence before creating a journal', () => {
    const s = sources(); s[0]!.bytes += 'altered';
    expect(() => AccountingLedger.reconstruct(join(root(), 'bad'), s, sourceRevision)).toThrow('accounting_origin_mismatch');
    expect(() => AccountingLedger.reconstruct(join(root(), 'missing'), sources().slice(1), sourceRevision)).toThrow('accounting_schema');
    expect(() => AccountingLedger.reconstruct(join(root(), 'dup'), [sources()[0]!, sources()[0]!, sources()[2]!], sourceRevision)).toThrow('accounting_origin_mismatch');
  });
  it('cannot replenish allowance by creating another directory, reopening or importing evidence twice', () => {
    for (let i = 0; i < 2; i++) {
      const { ledger, directory } = setup(); const p = rates(ledger); const hash = ledger.view().journalHash;
      rates(ledger); expect(ledger.view().journalHash).toBe(hash);
      expect(() => ledger.reserve(request(p))).toThrow('accounting_blocked'); ledger.close();
      const reopened = track(AccountingLedger.open(directory)); expect(reopened.view().admissionsCharged).toBe(9);
      expect(() => reopened.reserve(request(p))).toThrow('accounting_blocked');
    }
  });
  it('never initializes missing/corrupt state or overwrites an existing directory', () => {
    expect(() => AccountingLedger.open(join(root(), 'missing'))).toThrow();
    const { ledger, directory } = setup(); ledger.close();
    expect(() => AccountingLedger.reconstruct(directory, sources(), sourceRevision)).toThrow();
    unlinkSync(join(directory, 'accounting.journal.json'));
    expect(() => AccountingLedger.open(directory)).toThrow();
  });
});

describe('explicit operator reconciliation mechanics, disposable fixtures only', () => {
  it('books the actor at the full reserved ceiling, keeps unknown actual billing, diagnostics and counts', () => {
    const { ledger, directory } = setup(); const p = rates(ledger), decision = approval(ledger, p.evidenceSha256);
    ledger.reconcile(decision); const committed = raw(directory); ledger.reconcile(structuredClone(decision)); expect(raw(directory)).toBe(committed);
    expect(ledger.view()).toMatchObject({ historicalActorHoldMicroUsd: 0, historicalActorBookedMicroUsd: 19_114,
      historicalDiagnosticHoldMicroUsd: 100, bookedMicroUsd: 19_114n, heldMicroUsd: 100n, admissionsCharged: 9, actualBilledMicroUsd: null });
    expect(() => ledger.reconcile({ ...decision, reason: 'different' })).toThrow('accounting_reconciliation_conflict');
    ledger.close(); expect(track(AccountingLedger.open(directory)).view().bookedMicroUsd).toBe(19_114n);
    expect(() => assertLiveAdmission()).toThrow();
  });
  it('keeps admission blocked when an operator leaves diagnostic liability unbounded', () => {
    const { ledger } = setup(); const p = authorize(ledger, { diagnosticHoldMicroUsd: null });
    expect(() => ledger.reserve(request(p))).toThrow('historical_diagnostic_liability_unbounded');
    expect(ledger.view().remainingMicroUsd).toBeNull();
  });
  it.each([
    { acknowledgeMissingOriginalLedger: false }, { acknowledgeUnknownActualBilling: false }, { acknowledgeNineIncludesActor: false },
    { actorDisposition: 'forgive' }, { diagnosticHoldMicroUsd: -1 }, { cumulativeLimitMicroUsd: 5_000_001 },
    { perRequestLimitMicroUsd: 250_001 }, { trialLimitMicroUsd: 250_001 }, { maxAdmissions: 11 }, { maxAdmissions: 8 }, { evidenceSha256: [] },
    { authorizationExpiresAt: '2020-01-01T00:00:00.000Z' }, { expectedJournalHash: 'a'.repeat(64) },
  ])('rejects unsupported or incomplete operator decision %j', override => {
    const { ledger } = setup(); const p = rates(ledger); const before = ledger.view().journalHash;
    expect(() => ledger.reconcile(approval(ledger, p.evidenceSha256, override as never))).toThrow('accounting_reconciliation');
    expect(ledger.view().journalHash).toBe(before);
  });
  it('archives evidence after a decision without invalidating prior journal hashes', () => {
    const { ledger, directory } = setup(); authorize(ledger);
    ledger.archiveEvidence('later artifact', 'Later evidence is appended, not spliced into an earlier decision.');
    ledger.close(); expect(track(AccountingLedger.open(directory)).view().admissionsCharged).toBe(9);
  });
  it('rejects expired or not-yet-effective authorization without consuming a request', () => {
    const { ledger } = setup(); const p = authorize(ledger);
    expect(() => ledger.reserve(request(p), '2099-01-01T00:00:00.000Z')).toThrow('operator_authorization_expired');
    expect(() => ledger.reserve(request(p), '2026-01-01T00:00:00.000Z')).toThrow('accounting_time');
    expect(ledger.view().admissionsCharged).toBe(9);
  });
});

describe('durable cumulative account invariants', () => {
  it('reserves before use, keeps count after zero usage, and never grants a fresh ten-request allowance', () => {
    const { ledger, directory } = setup(); const p = authorize(ledger); const r = request(p);
    expect(ledger.reserve(r)).toBe('reserved'); expect(ledger.reserve(r)).toBe('duplicate');
    expect(ledger.view()).toMatchObject({ admissionsCharged: 10, heldMicroUsd: 400n });
    ledger.recordReceipt({ ...receipt(), usage: { inputTokens: 0, outputTokens: 0 } });
    expect(ledger.view()).toMatchObject({ admissionsCharged: 10, heldMicroUsd: 100n, bookedMicroUsd: 19_114n });
    expect(() => ledger.reserve({ ...r, id: 'another', context: { ...r.context, tick: 1 } })).toThrow('request_limit');
    ledger.close(); expect(track(AccountingLedger.open(directory)).view().admissionsCharged).toBe(10);
  });
  it('holds unknown costs through restart and accepts a later exact receipt without refunding a count', () => {
    const { ledger, directory } = setup(); ledger.reserve(request(authorize(ledger))); ledger.markUncertain('test-request', 'transport_failure'); ledger.close();
    const reopened = track(AccountingLedger.open(directory)); expect(reopened.view().requests[0]).toMatchObject({ uncertain: true, bookedMicroUsd: null });
    reopened.recordReceipt(receipt()); expect(reopened.view()).toMatchObject({ bookedMicroUsd: 19_144n, heldMicroUsd: 100n, admissionsCharged: 10 });
  });
  it('makes exact receipts idempotent and conflicting receipts immutable', () => {
    const { ledger, directory } = setup(); ledger.reserve(request(authorize(ledger))); ledger.recordReceipt(receipt()); const before = raw(directory);
    expect(ledger.recordReceipt(receipt())).toBe('duplicate'); expect(raw(directory)).toBe(before);
    expect(() => ledger.recordReceipt({ ...receipt(), usage: { inputTokens: 0, outputTokens: 0 } })).toThrow('accounting_receipt_conflict');
  });
  it('records genuine overruns without clamping costs or erasing the historical booked liability', () => {
    const { ledger, directory } = setup(); ledger.reserve(request(authorize(ledger)));
    ledger.recordReceipt({ ...receipt(), usage: { inputTokens: 5_000_000, outputTokens: 0 } });
    expect(ledger.view()).toMatchObject({ overrun: true, bookedMicroUsd: 5_019_114n, remainingMicroUsd: -4_769_214n });
    ledger.close(); expect(track(AccountingLedger.open(directory)).view().blockers).toContain('usage_exceeded_reservation');
  });
  it('does not price an unexpected model at the requested model rates', () => {
    const { ledger } = setup(); ledger.reserve(request(authorize(ledger))); ledger.recordReceipt({ ...receipt(), model: 'different-model' });
    expect(ledger.view().requests[0]).toMatchObject({ bookedMicroUsd: null, uncertain: true }); expect(ledger.view().heldMicroUsd).toBe(400n);
  });
  it('persists a known per-receipt valuation beyond safe Number precision without losing the overrun', () => {
    const { ledger, directory } = setup(); const p = authorize(ledger); p.outputMicroUsdPerMillionTokens = 100_000_000;
    ledger.reserve({ ...request(p), maxInputTokens: 1, maxOutputTokens: 1 });
    ledger.recordReceipt({ ...receipt(), usage: { inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER } });
    const expected = BigInt(Number.MAX_SAFE_INTEGER) * 100n + 19_114n;
    expect(ledger.view()).toMatchObject({ bookedMicroUsd: expected, overrun: true }); ledger.close();
    expect(track(AccountingLedger.open(directory)).view().bookedMicroUsd).toBe(expected);
  });
  it('checks cumulative/per-request caps before reservation', () => {
    for (const limits of [{ perRequestLimitMicroUsd: 299 }, { cumulativeLimitMicroUsd: 19_513 }, { trialLimitMicroUsd: 19_513 }, { maxAdmissions: 9 }]) {
      const { ledger, directory } = setup(); const p = authorize(ledger, limits); const before = raw(directory);
      expect(() => ledger.reserve(request(p))).toThrow(); expect(raw(directory)).toBe(before);
    }
  });
  it('detaches returned state and rejects a conflicting duplicate request', () => {
    const { ledger } = setup(); const r = request(authorize(ledger)); ledger.reserve(r);
    const view = ledger.view(); view.requests[0]!.request.context.tick = 999; view.authorization!.maxAdmissions = 100;
    expect(ledger.view().requests[0]!.request.context.tick).toBe(0);
    expect(() => ledger.reserve({ ...r, inputSha256: 'c'.repeat(64) })).toThrow('accounting_reservation_conflict');
  });
  it('can close an unknown request only by explicit full-ceiling operator disposition, without refund or invented billing', () => {
    const { ledger, directory } = setup(); const r = request(authorize(ledger)); ledger.reserve(r); ledger.markUncertain(r.id, 'transport_failure');
    const d = { decisionId: 'TEST-ONLY-request-disposition', requestId: r.id, operator: 'TEST ONLY', reason: 'Disposable full-ceiling closure exercise',
      decidedAt: '2026-10-17T23:00:00.000Z', expectedJournalHash: ledger.view().journalHash, evidenceSha256: [r.prices.evidenceSha256],
      acknowledgeUnknownActualBilling: true as const, disposition: 'book_full_reserved_ceiling' as const };
    ledger.closeUncertainRequest(d); ledger.closeUncertainRequest(d);
    expect(ledger.view()).toMatchObject({ admissionsCharged: 10, bookedMicroUsd: 19_414n, heldMicroUsd: 100n, actualBilledMicroUsd: null });
    expect(ledger.view().requests[0]).toMatchObject({ cancelled: true, uncertain: true, bookedMicroUsd: 300n });
    expect(() => ledger.closeUncertainRequest({ ...d, reason: 'changed' })).toThrow('accounting_disposition_conflict');
    // Later proof of lower usage is retained, but never silently reverses an explicit conservative booking.
    ledger.recordReceipt(receipt()); expect(ledger.view().bookedMicroUsd).toBe(19_414n);
    ledger.close(); expect(track(AccountingLedger.open(directory)).view().admissionsCharged).toBe(10);
  });
  it('does not let an operator disposition erase a known usage valuation', () => {
    const { ledger } = setup(); const r = request(authorize(ledger)); ledger.reserve(r); ledger.recordReceipt(receipt());
    expect(() => ledger.closeUncertainRequest({ decisionId: 'bad', requestId: r.id, operator: 'TEST', reason: 'TEST', decidedAt: '2026-10-17T23:00:00.000Z',
      expectedJournalHash: ledger.view().journalHash, evidenceSha256: [r.prices.evidenceSha256], acknowledgeUnknownActualBilling: true, disposition: 'book_full_reserved_ceiling' })).toThrow('accounting_request_disposition');
    expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('rounds integer category costs upward and rejects unsafe arithmetic', () => {
    const { ledger } = setup(); const p = rates(ledger); p.inputMicroUsdPerMillionTokens = 1; p.outputMicroUsdPerMillionTokens = 1;
    expect(usageCost(1, 1, p)).toBe(2); expect(usageCost(0, 0, p)).toBe(0);
    expect(() => usageCost(-1, 1, p)).toThrow('accounting_usage_invalid');
    expect(() => usageCost(Number.MAX_SAFE_INTEGER, 1, { ...p, inputMicroUsdPerMillionTokens: Number.MAX_SAFE_INTEGER })).toThrow('accounting_cost_overflow');
  });
});

describe('account journal integrity and process ownership', () => {
  it('excludes competing writers and refuses to reap a living owner', () => {
    const { directory } = setup(); expect(() => AccountingLedger.open(directory)).toThrow();
    expect(() => AccountingLedger.open(directory, { recoverStaleLock: true })).toThrow('accounting_locked');
  });
  it('detects changed authoritative bytes even before a read-only admission check', () => {
    const { ledger, directory } = setup(); writeFileSync(join(directory, 'accounting.journal.json'), '{}');
    expect(() => ledger.view()).toThrow('accounting_unavailable');
  });
  it('rejects forged semantic history even when its checksum is recomputed', () => {
    const { ledger, directory } = setup(); ledger.close();
    rewrite(directory, d => { d.events.push({ kind: 'reservation', request: request({ model: 'x', inputMicroUsdPerMillionTokens: 1, outputMicroUsdPerMillionTokens: 1, evidenceSha256: 'a'.repeat(64) }), admittedAt: '2026-10-17T12:00:00.000Z' }); });
    expect(() => AccountingLedger.open(directory)).toThrow();
  });
  it('rejects a copied synthetic fixture journal', () => {
    const { ledger, directory } = setup(); ledger.close();
    writeFileSync(join(directory, 'accounting.journal.json'), JSON.stringify({ format: 'node-synthetic-spend-fixture-v1', payload: '{}', sha256: sha256('{}') }));
    expect(() => AccountingLedger.open(directory)).toThrow('accounting_checksum');
  });
  it('refuses hardlinked journals and junction directories', () => {
    const { ledger, directory } = setup(); ledger.close(); linkSync(join(directory, 'accounting.journal.json'), join(root(), 'copy'));
    expect(() => AccountingLedger.open(directory)).toThrow('accounting_unsafe_path');
    const alias = join(root(), 'alias'); symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => AccountingLedger.open(alias)).toThrow('accounting_unsafe_path');
  });
  it.each(['before_write', 'after_file_sync', 'after_rename'] as const)('publishes no success when a reservation write fails at %s', stage => {
    let armed = false; const { ledger, directory } = setup({ fault: where => { if (armed && where === stage) throw Error('mechanical disk fault'); } });
    const p = authorize(ledger); armed = true; expect(() => ledger.reserve(request(p))).toThrow('accounting_write_failed'); ledger.close();
    const reopened = track(AccountingLedger.open(directory));
    expect(reopened.view().admissionsCharged).toBe(stage === 'after_rename' ? 10 : 9);
    expect(reopened.view().bookedMicroUsd).toBe(19_114n);
  });
});
