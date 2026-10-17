import { AccountingStore, failAccounting as fail, sha256, type AccountingStoreOptions } from './accountingStore.js';
import { policyInput, type DecisionContext } from './protocol.js';

export const RECOVERED_ACCOUNT = 'node-interrupted-experiment-2026-10-16';
const HISTORICAL_HOLD = 19_114;
const HISTORICAL_ADMISSIONS = 9; // Includes the one actor attempt. Never 1 + 9.
const PINS: Record<string, string> = {
  'EXPERIMENT_FIRST_PASS_RESULTS.md': '2927ce73beb571dcfccb41cfc94b5df831a18750386430eb189f04672e5c7b8a',
  'CREDENTIAL_BINDING_SUPPORT_REPORT.md': 'd2bc9c429ce2ac38bc4da7f2feffb099c43a4f50c1960571de5ea0ee05ffaeab',
  'EXPERIMENT_EVALS_AND_SAFEGUARDS.md': 'ca3078ce4d4f816de2e0646f1dc32f4f7840462561f45d924169f1824d8e41aa',
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const fingerprint = (value: unknown) => sha256(JSON.stringify(value, (_key, item: unknown) =>
  object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));

export interface AccountingEvidence { name: string; bytes: string; sha256: string }
export interface AccountingPrices {
  model: string;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  evidenceSha256: string;
}
export interface OperatorReconciliation {
  decisionId: string;
  operator: string;
  reason: string;
  decidedAt: string;
  expectedJournalHash: string;
  evidenceSha256: string[];
  acknowledgeMissingOriginalLedger: true;
  acknowledgeUnknownActualBilling: true;
  acknowledgeNineIncludesActor: true;
  actorDisposition: 'book_full_reserved_ceiling';
  /** Null retains an unbounded liability. A number is an explicit operator risk decision, not a recovered invoice. */
  diagnosticHoldMicroUsd: number | null;
  cumulativeLimitMicroUsd: number;
  trialLimitMicroUsd: number;
  perRequestLimitMicroUsd: number;
  maxAdmissions: number;
  authorizationExpiresAt: string;
}
export interface AccountingRequest {
  id: string;
  inputSha256: string;
  context: DecisionContext;
  prices: AccountingPrices;
  maxInputTokens: number;
  maxOutputTokens: number;
}
export interface AccountingReceipt {
  receiptId: string;
  requestId: string;
  sourceSha256: string;
  model: string;
  status: 'completed' | 'incomplete' | 'failed' | 'refused';
  usage: { inputTokens: number; outputTokens: number } | null;
}
export interface RequestDisposition {
  decisionId: string;
  requestId: string;
  operator: string;
  reason: string;
  decidedAt: string;
  expectedJournalHash: string;
  evidenceSha256: string[];
  acknowledgeUnknownActualBilling: true;
  disposition: 'book_full_reserved_ceiling';
}
type Event = { kind: 'evidence'; value: AccountingEvidence }
  | { kind: 'operator_reconciliation'; value: OperatorReconciliation }
  | { kind: 'reservation'; request: AccountingRequest; admittedAt: string }
  | { kind: 'receipt'; value: AccountingReceipt }
  | { kind: 'uncertain'; requestId: string; reason: 'transport_failure' | 'response_invalid' | 'cancelled' }
  | { kind: 'cancelled'; requestId: string }
  | { kind: 'request_disposition'; value: RequestDisposition }
  | { kind: 'decision_claim'; requestId: string }
  | { kind: 'decision'; requestId: string; result: 'validated' | 'invalid' | 'stale' | 'provider_rejected'; decisionSha256: string | null };
interface Document {
  accountId: typeof RECOVERED_ACCOUNT;
  origin: { kind: 'documentary_reconstruction'; sourceRevision: string; sources: AccountingEvidence[] };
  events: Event[];
}
export interface AccountedRequest {
  request: AccountingRequest;
  ceilingMicroUsd: number;
  receipt: AccountingReceipt | null;
  bookedMicroUsd: bigint | null;
  uncertain: boolean;
  cancelled: boolean;
  operatorDisposition: RequestDisposition | null;
  decisionClaimed: boolean;
  decision: Extract<Event, { kind: 'decision' }> | null;
}
export interface AccountingView {
  accountId: typeof RECOVERED_ACCOUNT;
  journalHash: string;
  origin: 'documentary_reconstruction';
  originalLedgerRecovered: false;
  eventIdentityGap: true;
  recordedCombinedAdmissions: 9;
  originalActorIncluded: true;
  admissionsCharged: number;
  historicalActorHoldMicroUsd: number;
  historicalActorBookedMicroUsd: number;
  historicalDiagnosticHoldMicroUsd: number | null;
  actualBilledMicroUsd: null;
  bookedMicroUsd: bigint;
  heldMicroUsd: bigint;
  remainingMicroUsd: bigint | null;
  authorization: OperatorReconciliation | null;
  requests: AccountedRequest[];
  overrun: boolean;
  blockers: string[];
}

function evidence(value: unknown): asserts value is AccountingEvidence {
  if (!object(value) || !exact(value, ['name', 'bytes', 'sha256']) || !text(value.name, 128) ||
    typeof value.bytes !== 'string' || Buffer.byteLength(value.bytes) > 131_072 || !hash(value.sha256) || sha256(value.bytes) !== value.sha256) fail('accounting_evidence_invalid');
}
function prices(value: unknown): asserts value is AccountingPrices {
  if (!object(value) || !exact(value, ['model', 'inputMicroUsdPerMillionTokens', 'outputMicroUsdPerMillionTokens', 'evidenceSha256']) ||
    !identifier(value.model) || !integer(value.inputMicroUsdPerMillionTokens) || value.inputMicroUsdPerMillionTokens < 1 ||
    !integer(value.outputMicroUsdPerMillionTokens) || value.outputMicroUsdPerMillionTokens < 1 || !hash(value.evidenceSha256)) fail('accounting_prices_invalid');
}
/** Conservative usage valuation, not a claim about an invoice. No cached-input discount. */
function usageValuation(input: number, output: number, rates: AccountingPrices): bigint {
  prices(rates);
  if (!integer(input) || !integer(output)) return fail('accounting_usage_invalid');
  return (BigInt(input) * BigInt(rates.inputMicroUsdPerMillionTokens) + 999_999n) / 1_000_000n +
    (BigInt(output) * BigInt(rates.outputMicroUsdPerMillionTokens) + 999_999n) / 1_000_000n;
}
export function usageCost(input: number, output: number, rates: AccountingPrices): number {
  const cost = usageValuation(input, output, rates);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) return fail('accounting_cost_overflow');
  return Number(cost);
}
function validate(value: unknown): Document {
  if (!object(value) || !exact(value, ['accountId', 'origin', 'events']) || value.accountId !== RECOVERED_ACCOUNT ||
    !object(value.origin) || !exact(value.origin, ['kind', 'sourceRevision', 'sources']) || value.origin.kind !== 'documentary_reconstruction' ||
    typeof value.origin.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(value.origin.sourceRevision) ||
    !Array.isArray(value.origin.sources) || value.origin.sources.length !== 3 ||
    !Array.isArray(value.events) || value.events.length > 30_000) return fail('accounting_schema');
  const sources = new Map<string, AccountingEvidence>();
  for (const entry of value.origin.sources) {
    evidence(entry);
    if (sources.has(entry.name) || !Object.hasOwn(PINS, entry.name) || sha256(entry.bytes.replace(/\r\n/g, '\n')) !== PINS[entry.name]) return fail('accounting_origin_mismatch');
    sources.set(entry.name, entry);
  }
  const refs = new Set<string>([...sources.values()].map(e => e.sha256));
  let authorization: OperatorReconciliation | null = null;
  const decisions = new Set<string>(); const receipts = new Set<string>();
  const requests = new Map<string, AccountedRequest>();
  let overrun = false;
  const prefix: Document = { accountId: RECOVERED_ACCOUNT, origin: value.origin as unknown as Document['origin'], events: [] };
  for (const event of value.events) {
    if (!object(event)) return fail('accounting_event');
    if (event.kind === 'evidence') {
      if (!exact(event, ['kind', 'value'])) return fail('accounting_evidence_invalid');
      evidence(event.value);
      if (refs.has(event.value.sha256) || refs.size >= 131) return fail('accounting_evidence_duplicate');
      refs.add(event.value.sha256);
    } else if (event.kind === 'operator_reconciliation') {
      if (!exact(event, ['kind', 'value']) || !object(event.value)) return fail('accounting_reconciliation');
      const r = event.value;
      if (!exact(r, ['decisionId', 'operator', 'reason', 'decidedAt', 'expectedJournalHash', 'evidenceSha256',
        'acknowledgeMissingOriginalLedger', 'acknowledgeUnknownActualBilling', 'acknowledgeNineIncludesActor', 'actorDisposition',
        'diagnosticHoldMicroUsd', 'cumulativeLimitMicroUsd', 'trialLimitMicroUsd', 'perRequestLimitMicroUsd', 'maxAdmissions', 'authorizationExpiresAt']) ||
        !identifier(r.decisionId) || decisions.has(r.decisionId) || !text(r.operator, 128) || !text(r.reason, 4096) || !iso(r.decidedAt) ||
        r.expectedJournalHash !== fingerprint(prefix) || !Array.isArray(r.evidenceSha256) || r.evidenceSha256.length < 1 ||
        new Set(r.evidenceSha256).size !== r.evidenceSha256.length || !r.evidenceSha256.every(ref => hash(ref) && refs.has(ref)) ||
        r.acknowledgeMissingOriginalLedger !== true || r.acknowledgeUnknownActualBilling !== true || r.acknowledgeNineIncludesActor !== true ||
        r.actorDisposition !== 'book_full_reserved_ceiling' || !(r.diagnosticHoldMicroUsd === null || integer(r.diagnosticHoldMicroUsd)) ||
        !integer(r.cumulativeLimitMicroUsd) || r.cumulativeLimitMicroUsd < 1 || r.cumulativeLimitMicroUsd > 5_000_000 ||
        !integer(r.trialLimitMicroUsd) || r.trialLimitMicroUsd < 1 || r.trialLimitMicroUsd > 250_000 ||
        !integer(r.perRequestLimitMicroUsd) || r.perRequestLimitMicroUsd < 1 || r.perRequestLimitMicroUsd > 250_000 ||
        !integer(r.maxAdmissions) || r.maxAdmissions < HISTORICAL_ADMISSIONS || r.maxAdmissions > 10 || !iso(r.authorizationExpiresAt) ||
        r.authorizationExpiresAt <= r.decidedAt || authorization !== null) return fail('accounting_reconciliation');
      decisions.add(r.decisionId); authorization = r as unknown as OperatorReconciliation;
    } else if (event.kind === 'reservation') {
      if (!exact(event, ['kind', 'request', 'admittedAt']) || !iso(event.admittedAt) || !object(event.request) ||
        !exact(event.request, ['id', 'inputSha256', 'context', 'prices', 'maxInputTokens', 'maxOutputTokens'])) return fail('accounting_reservation');
      const r = event.request as unknown as AccountingRequest; prices(r.prices);
      if (!identifier(r.id) || !hash(r.inputSha256) || requests.has(r.id) || !refs.has(r.prices.evidenceSha256) ||
        !integer(r.maxInputTokens) || r.maxInputTokens < 1 || r.maxInputTokens > 36_864 || !integer(r.maxOutputTokens) || r.maxOutputTokens < 1 || r.maxOutputTokens > 2_048 ||
        fingerprint(policyInput(r.context)) !== fingerprint(r.context)) return fail('accounting_reservation');
      const ceiling = usageCost(r.maxInputTokens, r.maxOutputTokens, r.prices);
      const booked = BigInt(HISTORICAL_HOLD) + [...requests.values()].reduce((sum, q) => sum + BigInt(q.bookedMicroUsd ?? q.ceilingMicroUsd), 0n);
      if (!authorization || event.admittedAt < authorization.decidedAt || event.admittedAt >= authorization.authorizationExpiresAt ||
        authorization.diagnosticHoldMicroUsd === null || overrun ||
        [...requests.values()].some(q => q.request.context.selfRef === r.context.selfRef && q.request.context.tick === r.context.tick) ||
        [...requests.values()].some(q => q.bookedMicroUsd === null) || requests.size + HISTORICAL_ADMISSIONS >= authorization.maxAdmissions ||
        ceiling < 1 || ceiling > authorization.perRequestLimitMicroUsd ||
        booked + BigInt(authorization.diagnosticHoldMicroUsd) + BigInt(ceiling) > BigInt(Math.min(authorization.cumulativeLimitMicroUsd, authorization.trialLimitMicroUsd))) return fail('accounting_admission_blocked');
      requests.set(r.id, { request: structuredClone(r), ceilingMicroUsd: ceiling, receipt: null, bookedMicroUsd: null, uncertain: false, cancelled: false, operatorDisposition: null, decisionClaimed: false, decision: null });
    } else if (event.kind === 'receipt') {
      if (!exact(event, ['kind', 'value']) || !object(event.value) || !exact(event.value, ['receiptId', 'requestId', 'sourceSha256', 'model', 'status', 'usage'])) return fail('accounting_receipt');
      const r = event.value as unknown as AccountingReceipt, q = requests.get(r.requestId);
      if (!q || q.receipt || !identifier(r.receiptId) || receipts.has(r.receiptId) || !hash(r.sourceSha256) || !identifier(r.model) ||
        !['completed', 'incomplete', 'failed', 'refused'].includes(r.status) || !(r.usage === null || object(r.usage) &&
          exact(r.usage, ['inputTokens', 'outputTokens']) && integer(r.usage.inputTokens) && integer(r.usage.outputTokens))) return fail('accounting_receipt');
      receipts.add(r.receiptId); q.receipt = structuredClone(r);
      if (r.usage !== null && r.model === q.request.prices.model) {
        const valuation = usageValuation(r.usage.inputTokens, r.usage.outputTokens, q.request.prices);
        q.bookedMicroUsd = q.operatorDisposition && BigInt(q.ceilingMicroUsd) > valuation ? BigInt(q.ceilingMicroUsd) : valuation;
        if (q.bookedMicroUsd > BigInt(q.ceilingMicroUsd) || r.usage.inputTokens > q.request.maxInputTokens || r.usage.outputTokens > q.request.maxOutputTokens) overrun = true;
      } else q.uncertain = true;
    } else if (event.kind === 'uncertain') {
      const q = requests.get(event.requestId as string);
      if (!exact(event, ['kind', 'requestId', 'reason']) || !q || q.receipt || q.uncertain ||
        !['transport_failure', 'response_invalid', 'cancelled'].includes(String(event.reason))) return fail('accounting_uncertain');
      q.uncertain = true;
    } else if (event.kind === 'request_disposition') {
      if (!exact(event, ['kind', 'value']) || !object(event.value)) return fail('accounting_request_disposition');
      const d = event.value, q = requests.get(d.requestId as string);
      if (!exact(d, ['decisionId', 'requestId', 'operator', 'reason', 'decidedAt', 'expectedJournalHash', 'evidenceSha256', 'acknowledgeUnknownActualBilling', 'disposition']) ||
        !q || q.bookedMicroUsd !== null || q.operatorDisposition || !identifier(d.decisionId) || decisions.has(d.decisionId) || !text(d.operator, 128) || !text(d.reason, 4096) || !iso(d.decidedAt) ||
        d.expectedJournalHash !== fingerprint(prefix) || d.acknowledgeUnknownActualBilling !== true || d.disposition !== 'book_full_reserved_ceiling' ||
        !Array.isArray(d.evidenceSha256) || d.evidenceSha256.length < 1 || new Set(d.evidenceSha256).size !== d.evidenceSha256.length ||
        !d.evidenceSha256.every(ref => hash(ref) && refs.has(ref))) return fail('accounting_request_disposition');
      decisions.add(d.decisionId); q.operatorDisposition = d as unknown as RequestDisposition;
      q.bookedMicroUsd = BigInt(q.ceilingMicroUsd); q.cancelled = true; q.uncertain = true;
    } else if (event.kind === 'cancelled') {
      const q = requests.get(event.requestId as string);
      if (!exact(event, ['kind', 'requestId']) || !q || q.cancelled || q.decision) return fail('accounting_cancellation');
      q.cancelled = true; if (q.bookedMicroUsd === null) q.uncertain = true;
    } else if (event.kind === 'decision_claim') {
      const q = requests.get(event.requestId as string);
      if (!exact(event, ['kind', 'requestId']) || !q?.receipt || q.decisionClaimed) return fail('accounting_decision_claim');
      q.decisionClaimed = true;
    } else if (event.kind === 'decision') {
      const q = requests.get(event.requestId as string);
      if (!exact(event, ['kind', 'requestId', 'result', 'decisionSha256']) || !q?.receipt || !q.decisionClaimed || q.decision ||
        !['validated', 'invalid', 'stale', 'provider_rejected'].includes(String(event.result)) ||
        !(event.decisionSha256 === null || hash(event.decisionSha256)) ||
        event.result === 'validated' && (q.bookedMicroUsd === null || q.cancelled || q.receipt.status !== 'completed' || overrun || !hash(event.decisionSha256))) return fail('accounting_decision');
      q.decision = event as unknown as Extract<Event, { kind: 'decision' }>;
    } else return fail('accounting_event');
    prefix.events.push(event as unknown as Event);
  }
  return structuredClone(value) as unknown as Document;
}
function derive(document: Document, now: string): AccountingView {
  // Validation replays all invariants; projection below contains no mutable trusted totals.
  validate(document);
  let authorization: OperatorReconciliation | null = null;
  const requests = new Map<string, AccountedRequest>(); let overrun = false;
  for (const event of document.events) {
    if (event.kind === 'operator_reconciliation') authorization = event.value;
    if (event.kind === 'reservation') requests.set(event.request.id, { request: event.request,
      ceilingMicroUsd: usageCost(event.request.maxInputTokens, event.request.maxOutputTokens, event.request.prices),
      receipt: null, bookedMicroUsd: null, uncertain: false, cancelled: false, operatorDisposition: null, decisionClaimed: false, decision: null });
    if (event.kind === 'receipt') {
      const q = requests.get(event.value.requestId)!; q.receipt = event.value;
      if (event.value.usage && event.value.model === q.request.prices.model) {
        const valuation = usageValuation(event.value.usage.inputTokens, event.value.usage.outputTokens, q.request.prices);
        q.bookedMicroUsd = q.operatorDisposition && BigInt(q.ceilingMicroUsd) > valuation ? BigInt(q.ceilingMicroUsd) : valuation;
        overrun ||= q.bookedMicroUsd > BigInt(q.ceilingMicroUsd) || event.value.usage.inputTokens > q.request.maxInputTokens || event.value.usage.outputTokens > q.request.maxOutputTokens;
      } else q.uncertain = true;
    }
    if (event.kind === 'uncertain') requests.get(event.requestId)!.uncertain = true;
    if (event.kind === 'cancelled') { const q = requests.get(event.requestId)!; q.cancelled = true; if (q.bookedMicroUsd === null) q.uncertain = true; }
    if (event.kind === 'request_disposition') {
      const q = requests.get(event.value.requestId)!; q.operatorDisposition = event.value;
      q.bookedMicroUsd = BigInt(q.ceilingMicroUsd); q.cancelled = true; q.uncertain = true;
    }
    if (event.kind === 'decision_claim') requests.get(event.requestId)!.decisionClaimed = true;
    if (event.kind === 'decision') requests.get(event.requestId)!.decision = event;
  }
  const actorHold = authorization ? 0 : HISTORICAL_HOLD, actorBooked = authorization ? HISTORICAL_HOLD : 0;
  const diagnosticHold = authorization?.diagnosticHoldMicroUsd ?? null;
  const booked = BigInt(actorBooked) + [...requests.values()].reduce((sum, q) => sum + BigInt(q.bookedMicroUsd ?? 0), 0n);
  const held = BigInt(actorHold) + BigInt(diagnosticHold ?? 0) + [...requests.values()].reduce((sum, q) => sum + BigInt(q.bookedMicroUsd === null ? q.ceilingMicroUsd : 0), 0n);
  const blockers: string[] = [];
  if (!authorization) blockers.push('operator_reconciliation_required');
  if (diagnosticHold === null) blockers.push('historical_diagnostic_liability_unbounded');
  if (authorization && now >= authorization.authorizationExpiresAt) blockers.push('operator_authorization_expired');
  if (overrun) blockers.push('usage_exceeded_reservation');
  if ([...requests.values()].some(q => q.bookedMicroUsd === null)) blockers.push('request_unresolved');
  if (authorization && HISTORICAL_ADMISSIONS + requests.size >= authorization.maxAdmissions) blockers.push('request_limit');
  const remaining = authorization && diagnosticHold !== null ? BigInt(Math.min(authorization.cumulativeLimitMicroUsd, authorization.trialLimitMicroUsd)) - booked - held : null;
  if (remaining !== null && remaining <= 0n) blockers.push('cost_limit');
  return { accountId: RECOVERED_ACCOUNT, journalHash: fingerprint(document), origin: 'documentary_reconstruction',
    originalLedgerRecovered: false, eventIdentityGap: true, recordedCombinedAdmissions: 9, originalActorIncluded: true,
    admissionsCharged: HISTORICAL_ADMISSIONS + requests.size, historicalActorHoldMicroUsd: actorHold, historicalActorBookedMicroUsd: actorBooked,
    historicalDiagnosticHoldMicroUsd: diagnosticHold, actualBilledMicroUsd: null, bookedMicroUsd: booked, heldMicroUsd: held,
    remainingMicroUsd: remaining, authorization: structuredClone(authorization), requests: structuredClone([...requests.values()]), overrun, blockers };
}

/** Reconstructs this interrupted account from pinned documentary evidence; never starts at zero. */
export class AccountingLedger {
  private constructor(private store: AccountingStore<Document>) {}
  static reconstruct(directory: string, sources: { name: string; bytes: string }[], sourceRevision: string, options: AccountingStoreOptions = {}): AccountingLedger {
    const document: Document = { accountId: RECOVERED_ACCOUNT,
      origin: { kind: 'documentary_reconstruction', sourceRevision, sources: sources.map(e => ({ ...e, sha256: sha256(e.bytes) })) }, events: [] };
    return new AccountingLedger(AccountingStore.create(directory, document, validate, options));
  }
  static open(directory: string, options: AccountingStoreOptions = {}): AccountingLedger { return new AccountingLedger(AccountingStore.open(directory, validate, options)); }
  view(now = new Date().toISOString()): AccountingView {
    if (!iso(now)) return fail('accounting_time');
    return derive(this.store.current(), now);
  }
  exportDocument(): unknown { return this.store.current(); }
  archiveEvidence(name: string, bytes: string): string {
    const entry = { name, bytes, sha256: sha256(bytes) }; evidence(entry);
    const document = this.store.current();
    if ([...document.origin.sources, ...document.events.flatMap(e => e.kind === 'evidence' ? [e.value] : [])].some(e => e.sha256 === entry.sha256)) return entry.sha256;
    this.#append({ kind: 'evidence', value: entry }); return entry.sha256;
  }
  #append(event: Event): void { const d = this.store.current(); d.events.push(structuredClone(event)); this.store.commit(d); }
  /** Trusted operator interface. This function is never called by the broker or provider parser. */
  reconcile(decision: OperatorReconciliation): void {
    const document = this.store.current();
    const prior = document.events.find(e => e.kind === 'operator_reconciliation');
    if (prior) { if (fingerprint(prior) === fingerprint({ kind: 'operator_reconciliation', value: decision })) return; return fail('accounting_reconciliation_conflict'); }
    this.#append({ kind: 'operator_reconciliation', value: decision });
  }
  reserve(request: AccountingRequest, now = new Date().toISOString()): 'reserved' | 'duplicate' {
    const view = this.view(now); const prior = view.requests.find(q => q.request.id === request.id);
    if (prior) { if (fingerprint(prior.request) !== fingerprint(request)) return fail('accounting_reservation_conflict'); return 'duplicate'; }
    if (view.blockers.length) return fail(`accounting_blocked:${view.blockers.join(',')}`);
    if (view.authorization && now < view.authorization.decidedAt) return fail('accounting_time');
    this.#append({ kind: 'reservation', request, admittedAt: now }); return 'reserved';
  }
  recordReceipt(receipt: AccountingReceipt): 'recorded' | 'duplicate' {
    const prior = this.view().requests.find(q => q.request.id === receipt.requestId)?.receipt;
    if (prior) { if (fingerprint(prior) !== fingerprint(receipt)) return fail('accounting_receipt_conflict'); return 'duplicate'; }
    this.#append({ kind: 'receipt', value: receipt }); return 'recorded';
  }
  markUncertain(requestId: string, reason: Extract<Event, { kind: 'uncertain' }>['reason']): void {
    const q = this.view().requests.find(q => q.request.id === requestId);
    if (!q) return fail('accounting_request_missing');
    if (q.bookedMicroUsd !== null || q.receipt || q.uncertain) return;
    this.#append({ kind: 'uncertain', requestId, reason });
  }
  recordDecision(requestId: string, result: Extract<Event, { kind: 'decision' }>['result'], decisionSha256: string | null): void {
    this.#append({ kind: 'decision', requestId, result, decisionSha256 });
  }
  claimDecision(requestId: string): void { this.#append({ kind: 'decision_claim', requestId }); }
  cancelRequest(requestId: string): void {
    const q = this.view().requests.find(q => q.request.id === requestId);
    if (!q) return fail('accounting_request_missing');
    if (!q.cancelled && !q.decision) this.#append({ kind: 'cancelled', requestId });
  }
  /** Explicit operator-only conservative closure. No invoice claim, count refund or late action permission. */
  closeUncertainRequest(decision: RequestDisposition): void {
    const prior = this.view().requests.find(q => q.request.id === decision.requestId)?.operatorDisposition;
    if (prior) { if (fingerprint(prior) === fingerprint(decision)) return; return fail('accounting_disposition_conflict'); }
    this.#append({ kind: 'request_disposition', value: decision });
  }
  close(): void { this.store.close(); }
}
