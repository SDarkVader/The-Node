import { AccountingStore, sha256, failAccounting as fail, type AccountingStoreOptions } from './accountingStore.js';
import { inspectAccountingDocument, usageCost, type AccountingPrices } from './accountingLedger.js';
import { parseRecordedResponse } from './recordedResponse.js';
import { policyInput, type DecisionContext } from './protocol.js';

const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const canonical = (v: unknown) => JSON.stringify(v, (_key, item: unknown) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const exact = (v: object, keys: string[]) => same(Object.keys(v).sort(), keys.sort());

/** Archived inputs are evidence, never executable instructions or proof of an invoice. */
export interface DiagnosticEvidence { kind: 'generation' | 'models-list'; report: string; response: string | null; provenance: 'saved_artifact' | 'tool_output_transcription' }
export interface DiagnosticSummary { id: string; kind: DiagnosticEvidence['kind']; at: string; model: string | null; usage: { inputTokens: number; outputTokens: number } | null; estimatedNanoUsd: string | null; httpStatus: number | null; evidenceSha256: string }
export function inspectDiagnostic(e: DiagnosticEvidence): DiagnosticSummary {
  if (!object(e) || !exact(e, ['kind', 'report', 'response', 'provenance']) || !['generation', 'models-list'].includes(e.kind) ||
    !['saved_artifact', 'tool_output_transcription'].includes(e.provenance) || typeof e.report !== 'string' ||
    !(e.response === null || typeof e.response === 'string') || Buffer.byteLength(JSON.stringify(e)) > 131_072) return fail('test_diagnostic_evidence');
  let r: any; try { r = JSON.parse(e.report); } catch { return fail('test_diagnostic_report'); }
  if (!object(r)) return fail('test_diagnostic_report');
  const at = new Date(r.checkedAtUtc ?? r.finishedAtUtc ?? '').toISOString();
  // These are additional events after the documentary history, not invented identities for its nine admissions.
  if (at < '2026-10-18T00:00:00.000Z') return fail('test_diagnostic_history_overlap');
  const evidenceSha256 = sha256(JSON.stringify(e));
  if (e.kind === 'models-list') {
    if (r.method !== 'GET' || r.endpoint !== 'https://api.openai.com/v1/models' || r.generationAttempted !== false ||
      !(r.httpStatus === null || integer(r.httpStatus) && r.httpStatus >= 100 && r.httpStatus <= 599) || e.response !== null) return fail('test_diagnostic_control');
    return { id: `control:${sha256(JSON.stringify([r.method, r.endpoint, at]))}`, kind: e.kind, at, model: null, usage: null,
      // Zero is a non-generating control valuation, not an invoice. Failed/unknown controls remain unknown.
      estimatedNanoUsd: r.httpStatus >= 200 && r.httpStatus < 300 ? '0' : null, httpStatus: r.httpStatus, evidenceSha256 };
  }
  if (r.attemptedRequests !== 1 || (r.network?.httpStatus ?? r.httpStatus) !== 200 || !object(r.pricing)) return fail('test_diagnostic_generation');
  let receiptId: string, model: string, input: number, output: number, cached: number;
  if (e.response !== null) {
    const parsed = parseRecordedResponse(Buffer.from(e.response), 'external-diagnostic');
    if (!parsed.receipt.usage || !object(r.receipt) || parsed.receipt.receiptId !== r.receipt.receiptId ||
      parsed.receipt.sourceSha256 !== r.receipt.sourceSha256 || parsed.receipt.model !== r.receipt.model ||
      !same(parsed.receipt.usage, r.receipt.usage)) return fail('test_diagnostic_receipt');
    const body = JSON.parse(e.response); receiptId = parsed.receipt.receiptId; model = parsed.receipt.model;
    input = parsed.receipt.usage.inputTokens; output = parsed.receipt.usage.outputTokens; cached = body.usage.input_tokens_details?.cached_tokens ?? 0;
  } else {
    receiptId = r.responseId; model = r.modelReturned; input = r.inputTokens; output = r.outputTokens; cached = r.cachedInputTokens;
  }
  if (!id(receiptId) || !id(model) || !integer(input) || !integer(output) || !integer(cached) || cached > input) return fail('test_diagnostic_usage');
  const rates = [r.pricing.inputUsdPerMillion, r.pricing.cachedInputUsdPerMillion, r.pricing.outputUsdPerMillion];
  if (rates.some(x => typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || !Number.isSafeInteger(x * 1000))) return fail('test_diagnostic_prices');
  const nano = BigInt(input - cached) * BigInt(Math.round(rates[0] * 1000)) + BigInt(cached) * BigInt(Math.round(rates[1] * 1000)) + BigInt(output) * BigInt(Math.round(rates[2] * 1000));
  if (typeof r.estimatedCostUsd !== 'number' || Math.abs(Number(nano) / 1e9 - r.estimatedCostUsd) > 1e-12) return fail('test_diagnostic_estimate');
  return { id: receiptId, kind: e.kind, at, model, usage: { inputTokens: input, outputTokens: output }, estimatedNanoUsd: nano.toString(), httpStatus: 200, evidenceSha256 };
}

export interface InitialTestAuthorization {
  runId: string; authorizedAt: string; expiresAt: string; expectedHistoryHash: string; instruction: string;
  scope: 'additional_initial_test_spending_only'; model: 'gpt-5.4-nano-2026-03-17';
  maxRequests: 5; limitMicroUsd: 100000; perRequestMicroUsd: 20000;
  prices: AccountingPrices;
}
export interface TestReservation { id: string; inputSha256: string; context: DecisionContext; model: string; maxInputTokens: number; maxOutputTokens: number }
export interface TestUsageReceipt { requestId: string; receiptId: string; sourceSha256: string; model: string; inputTokens: number; outputTokens: number }
type Event = { kind: 'diagnostic'; evidence: DiagnosticEvidence }
  | { kind: 'authorization'; value: InitialTestAuthorization }
  | { kind: 'reservation'; value: TestReservation; at: string }
  | { kind: 'usage'; value: TestUsageReceipt };
interface Document { kind: 'node-initial-test-budget-v1'; historicalDocument: unknown; events: Event[] }
const fingerprint = (d: Document) => sha256(canonical(d));
interface RequestState { request: TestReservation; ceilingMicroUsd: number; receipt: TestUsageReceipt | null; bookedMicroUsd: bigint | null }
function replay(d: Document) {
  if (!object(d) || !exact(d, ['kind', 'historicalDocument', 'events']) || d.kind !== 'node-initial-test-budget-v1' || !Array.isArray(d.events) || d.events.length > 1000) return fail('test_budget_schema');
  const historical = inspectAccountingDocument(d.historicalDocument);
  if (historical.authorization !== null || historical.requests.length !== 0) return fail('test_budget_historical_state');
  const prefix: Document = { kind: d.kind, historicalDocument: d.historicalDocument, events: [] };
  const diagnostics = new Map<string, DiagnosticSummary>(), requests = new Map<string, RequestState>(), receipts = new Set<string>();
  let authorization: InitialTestAuthorization | null = null, overrun = false;
  const totals = () => ({ booked: [...requests.values()].reduce((n, q) => n + (q.bookedMicroUsd ?? 0n), 0n), held: [...requests.values()].reduce((n, q) => n + (q.bookedMicroUsd === null ? BigInt(q.ceilingMicroUsd) : 0n), 0n) });
  for (const event of d.events) {
    if (!object(event)) return fail('test_budget_event');
    if (event.kind === 'diagnostic') {
      if (!exact(event, ['kind', 'evidence']) || authorization) return fail('test_budget_import_closed');
      const summary = inspectDiagnostic(event.evidence);
      if (diagnostics.has(summary.id)) return fail('test_diagnostic_duplicate');
      diagnostics.set(summary.id, summary); receipts.add(summary.id);
    } else if (event.kind === 'authorization') {
      const a = event.value;
      if (!exact(event, ['kind', 'value']) || !object(a) || !exact(a, ['runId', 'authorizedAt', 'expiresAt', 'expectedHistoryHash', 'instruction', 'scope', 'model', 'maxRequests', 'limitMicroUsd', 'perRequestMicroUsd', 'prices']) || authorization ||
        !id(a.runId) || !iso(a.authorizedAt) || !iso(a.expiresAt) || a.expiresAt <= a.authorizedAt || Date.parse(a.expiresAt) - Date.parse(a.authorizedAt) > 86400000 ||
        a.expectedHistoryHash !== fingerprint(prefix) || typeof a.instruction !== 'string' || !a.instruction.trim() || a.instruction.length > 8192 ||
        a.scope !== 'additional_initial_test_spending_only' || a.model !== 'gpt-5.4-nano-2026-03-17' || a.maxRequests !== 5 || a.limitMicroUsd !== 100000 || a.perRequestMicroUsd !== 20000 ||
        !object(a.prices) || !exact(a.prices, ['model', 'inputMicroUsdPerMillionTokens', 'outputMicroUsdPerMillionTokens', 'evidenceSha256']) || a.prices.model !== a.model ||
        a.prices.inputMicroUsdPerMillionTokens !== 400000 || a.prices.outputMicroUsdPerMillionTokens !== 2500000 || !hash(a.prices.evidenceSha256) ||
        [...diagnostics.values()].some(x => x.at > a.authorizedAt)) return fail('test_budget_authorization');
      authorization = a;
    } else if (event.kind === 'reservation') {
      const q = event.value, a = authorization;
      if (!exact(event, ['kind', 'value', 'at']) || !object(q) || !exact(q, ['id', 'inputSha256', 'context', 'model', 'maxInputTokens', 'maxOutputTokens']) || !a || !iso(event.at) ||
        event.at < a.authorizedAt || event.at >= a.expiresAt || !id(q.id) || requests.has(q.id) || diagnostics.has(q.id) || !hash(q.inputSha256) || q.model !== a.model ||
        !integer(q.maxInputTokens) || q.maxInputTokens < 1 || q.maxInputTokens > 36864 || !integer(q.maxOutputTokens) || q.maxOutputTokens < 1 || q.maxOutputTokens > 2048 ||
        !same(policyInput(q.context), q.context) || q.context.role !== 'Baker' || overrun || requests.size >= a.maxRequests || [...requests.values()].some(x => x.bookedMicroUsd === null || x.request.context.selfRef !== q.context.selfRef || x.request.context.tick >= q.context.tick)) return fail('test_budget_admission');
      const ceiling = usageCost(q.maxInputTokens, q.maxOutputTokens, a.prices), t = totals();
      if (ceiling > a.perRequestMicroUsd || t.booked + t.held + BigInt(ceiling) > BigInt(a.limitMicroUsd)) return fail('test_budget_cost_limit');
      requests.set(q.id, { request: structuredClone(q), ceilingMicroUsd: ceiling, receipt: null, bookedMicroUsd: null });
    } else if (event.kind === 'usage') {
      const r = event.value, q = requests.get(r?.requestId);
      if (!exact(event, ['kind', 'value']) || !object(r) || !exact(r, ['requestId', 'receiptId', 'sourceSha256', 'model', 'inputTokens', 'outputTokens']) || !q || q.receipt ||
        !id(r.receiptId) || receipts.has(r.receiptId) || !hash(r.sourceSha256) || !id(r.model) || !integer(r.inputTokens) || !integer(r.outputTokens)) return fail('test_budget_receipt');
      q.receipt = structuredClone(r); receipts.add(r.receiptId);
      if (r.model === authorization!.model) {
        q.bookedMicroUsd = (BigInt(r.inputTokens) * 400000n + 999999n) / 1000000n + (BigInt(r.outputTokens) * 2500000n + 999999n) / 1000000n;
        overrun ||= q.bookedMicroUsd > BigInt(q.ceilingMicroUsd) || r.inputTokens > q.request.maxInputTokens || r.outputTokens > q.request.maxOutputTokens;
      }
    } else return fail('test_budget_event');
    prefix.events.push(event);
  }
  return { historical, diagnostics: [...diagnostics.values()], requests: [...requests.values()], authorization, overrun, ...totals() };
}
function validate(v: unknown): Document { replay(v as Document); return structuredClone(v) as Document; }

/** Forward test spending only. Historical unknown billing is retained, never forgiven or converted into a new charge. */
export class InitialTestBudget {
  private constructor(private store: AccountingStore<Document>) {}
  static create(directory: string, historicalDocument: unknown, options: AccountingStoreOptions = {}) {
    return new InitialTestBudget(AccountingStore.create(directory, { kind: 'node-initial-test-budget-v1', historicalDocument, events: [] }, validate, options));
  }
  static open(directory: string, options: AccountingStoreOptions = {}) { return new InitialTestBudget(AccountingStore.open(directory, validate, options)); }
  #append(event: Event) { const d = this.store.current(); d.events.push(structuredClone(event)); this.store.commit(d); }
  importDiagnostic(evidence: DiagnosticEvidence): 'imported' | 'duplicate' {
    const s = inspectDiagnostic(evidence), d = this.store.current();
    const prior = d.events.find(e => e.kind === 'diagnostic' && inspectDiagnostic(e.evidence).id === s.id);
    if (prior) { if (!same(prior, { kind: 'diagnostic', evidence })) return fail('test_diagnostic_conflict'); return 'duplicate'; }
    this.#append({ kind: 'diagnostic', evidence }); return 'imported';
  }
  authorize(value: InitialTestAuthorization) {
    const prior = this.store.current().events.find(e => e.kind === 'authorization');
    if (prior) { if (!same(prior, { kind: 'authorization', value })) return fail('test_budget_authorization_conflict'); return; }
    this.#append({ kind: 'authorization', value });
  }
  reserve(value: TestReservation, at = new Date().toISOString()): 'reserved' | 'duplicate' {
    const prior = this.view().requests.find(q => q.request.id === value.id);
    if (prior) { if (!same(prior.request, value)) return fail('test_budget_reservation_conflict'); return 'duplicate'; }
    this.#append({ kind: 'reservation', value, at }); return 'reserved';
  }
  recordUsage(value: TestUsageReceipt): 'recorded' | 'duplicate' {
    const prior = this.view().requests.find(q => q.request.id === value.requestId)?.receipt;
    if (prior) { if (!same(prior, value)) return fail('test_budget_receipt_conflict'); return 'duplicate'; }
    this.#append({ kind: 'usage', value }); return 'recorded';
  }
  view(now = new Date().toISOString()) {
    if (!iso(now)) return fail('test_budget_time');
    const d = this.store.current(), s = replay(d), a = s.authorization;
    return { ...s, historyHash: fingerprint(d), remainingMicroUsd: a ? BigInt(a.limitMicroUsd) - s.booked - s.held : null,
      historicalBillingReconciled: false as const, budgetScope: 'new_test_spending_only' as const,
      carriedAdmissionCount: s.historical.admissionsCharged + s.diagnostics.length,
      totalRecordedAdmissions: s.historical.admissionsCharged + s.diagnostics.length + s.requests.length,
      canReserve: !!a && now >= a.authorizedAt && now < a.expiresAt && !s.overrun && s.requests.length < a.maxRequests && !s.requests.some(q => q.bookedMicroUsd === null) && s.booked + s.held < BigInt(a.limitMicroUsd) };
  }
  close() { this.store.close(); }
}
