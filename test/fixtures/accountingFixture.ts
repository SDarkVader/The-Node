import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountingLedger, type OperatorReconciliation, type AccountingPrices, type AccountingRequest } from '../../src/agent/accountingLedger.js';
import type { AccountingStoreOptions } from '../../src/agent/accountingStore.js';
import type { DecisionContext } from '../../src/agent/protocol.js';

const roots: string[] = [], ledgers: AccountingLedger[] = [];
export const sourceRevision = '6f090f0c688a7b17e3bef52b5136d6c5be41c477';
export const sources = () => ['EXPERIMENT_FIRST_PASS_RESULTS.md', 'CREDENTIAL_BINDING_SUPPORT_REPORT.md', 'EXPERIMENT_EVALS_AND_SAFEGUARDS.md']
  .map(name => ({ name, bytes: readFileSync(new URL(`../../docs/recovery/${name}`, import.meta.url), 'utf8') }));
export const context = (): DecisionContext => ({ tick: 0, selfRef: 'accounting-test-person', role: 'Baker', roleEpoch: 0, legalMoves: [], presentRefs: [], knownSubjects: [] });
export const root = () => { const r = mkdtempSync(join(tmpdir(), 'node-recovery-ledger-')); roots.push(r); return r; };
export const track = (ledger: AccountingLedger) => { ledgers.push(ledger); return ledger; };
export function setup(options: AccountingStoreOptions = {}) {
  const directory = join(root(), 'journal');
  const ledger = track(AccountingLedger.reconstruct(directory, sources(), sourceRevision, options));
  return { directory, ledger };
}
export function rates(ledger: AccountingLedger): AccountingPrices {
  return { model: 'archived-test-model', inputMicroUsdPerMillionTokens: 1_000_000, outputMicroUsdPerMillionTokens: 2_000_000,
    evidenceSha256: ledger.archiveEvidence('TEST-ONLY-rates-and-risk-decision', 'Invented test rates and operator decision. Not real prices, invoices, risk approval or paid authority.') };
}
export function approval(ledger: AccountingLedger, evidenceSha256: string, overrides: Partial<OperatorReconciliation> = {}): OperatorReconciliation {
  return { decisionId: 'TEST-ONLY-operator-decision', operator: 'TEST-ONLY-NO-HUMAN-DECISION', reason: 'Exercise reconciliation mechanics in a disposable fixture. No actual financial decision.',
    decidedAt: '2026-10-17T00:00:00.000Z', expectedJournalHash: ledger.view().journalHash, evidenceSha256: [evidenceSha256],
    acknowledgeMissingOriginalLedger: true, acknowledgeUnknownActualBilling: true, acknowledgeNineIncludesActor: true,
    actorDisposition: 'book_full_reserved_ceiling', diagnosticHoldMicroUsd: 100, cumulativeLimitMicroUsd: 5_000_000, trialLimitMicroUsd: 250_000,
    perRequestLimitMicroUsd: 250_000, maxAdmissions: 10, authorizationExpiresAt: '2099-01-01T00:00:00.000Z', ...overrides };
}
export function authorize(ledger: AccountingLedger, overrides: Partial<OperatorReconciliation> = {}) {
  const prices = rates(ledger); ledger.reconcile(approval(ledger, prices.evidenceSha256, overrides)); return prices;
}
export const request = (prices: AccountingPrices): AccountingRequest => ({ id: 'test-request', inputSha256: 'a'.repeat(64), context: context(), prices, maxInputTokens: 100, maxOutputTokens: 100 });
export const response = (overrides: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  object: 'response', id: 'resp_test', model: 'archived-test-model', status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [],
    text: JSON.stringify({ move: null, communication: null, diary: null, role: null }) }] }],
  usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } }, ...overrides,
}));
export function cleanup() {
  for (const ledger of ledgers.splice(0)) { try { ledger.close(); } catch {} }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}
