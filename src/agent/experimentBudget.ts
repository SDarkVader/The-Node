import { AccountingStore, sha256, failAccounting as fail, type AccountingStoreOptions } from './accountingStore.js';
import { usageCost, type AccountingPrices } from './accountingLedger.js';
import { InitialTestBudget } from './initialTestBudget.js';
import { authorizedPrices, PRICED_MODELS } from './modelPricing.js';

/**
 * Accounted experiment allowance (2026-10-20; docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md).
 *
 * The owner authorised a capped batch runner, a first study allowance of USD 5 and the already
 * priced `gpt-5.4-nano-2026-03-17`. This generalises InitialTestBudget's rules from one Baker to
 * the declared actors of a study manifest, and changes nothing else:
 *
 * - the complete prior allowance document is carried unchanged; nothing is reset or forgiven,
 *   and the prior allowance must already be expired or have exhausted its request count;
 * - prices are the carried authorisation's conservative rates and rate evidence, never new claims.
 *   A different model (owner decision D11, 2026-10-22: study 1 on claude-haiku-5-5) may only use
 *   its reviewed, evidence-backed entry in `modelPricing.ts`, never operator-supplied rates;
 * - a reservation is durable before dispatch; one request may be outstanding at a time;
 * - each (episode, actor) has one participant reference and strictly increasing ticks;
 * - a reservation records the participant identity (tick, observer reference, role, epoch) and
 *   the sha256 of the exact request bytes; the bytes themselves are kept per call by the runner,
 *   so the journal stays small enough to carry forward through chained allowances;
 * - unknown usage and wrong-model receipts keep the full hold and block all further admission;
 * - known usage is booked even above its ceiling, and an overrun halts future spending;
 * - nothing is ever refunded, including zero-token or unused responses;
 * - an unknown outcome (no usable receipt) can be released only by an explicit operator
 *   settlement that books it at its FULL reserved ceiling, never less and never zero.
 *
 * InitialTestBudget and every other existing accounting file are unchanged.
 */

export const EXPERIMENT_MODEL = 'gpt-5.4-nano-2026-03-17' as const;
/** Models an allowance may authorise: the carried 18 Oct model, or one with a reviewed price entry. */
export const isExperimentModel = (model: unknown): model is string =>
  model === EXPERIMENT_MODEL || (typeof model === 'string' && Object.hasOwn(PRICED_MODELS, model));
const MAX_LIMIT_MICRO_USD = 25_000_000; // hard ceiling per allowance; larger studies chain allowances
const MAX_REQUESTS = 5_000;
const MAX_WINDOW_MS = 7 * 86_400_000;

const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
// Identical to InitialTestBudget's canonical form, so its historyHash can be checked here.
const canonical = (v: unknown) => JSON.stringify(v, (_key, item: unknown) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const exact = (v: object, keys: string[]) => same(Object.keys(v).sort(), [...keys].sort());
const fingerprint = (d: unknown) => sha256(canonical(d));

export interface CarriedSummary { bookedMicroUsd: string; heldMicroUsd: string; requests: number; overrun: boolean; expiresAt: string | null; prices: AccountingPrices | null;closedAt?:string }
export interface CarriedAllowance { kind: 'node-initial-test-budget-v1' | 'node-experiment-budget-v1'; document: unknown; fingerprint: string; summary: CarriedSummary }
export interface ExperimentAuthorization {
  runId: string; authorizedAt: string; expiresAt: string; expectedCarriedFingerprint: string; instruction: string;
  scope: 'accounted_experiment_spending_only'; manifestSha256: string; model: string;
  maxRequests: number; limitMicroUsd: number; perRequestMicroUsd: number; prices: AccountingPrices;
}
export interface ReservedParticipant { tick: number; selfRef: string; role: string; roleEpoch: number }
export interface ExperimentReservation { id: string; episodeId: string; actorId: string; inputSha256: string; participant: ReservedParticipant; model: string; maxInputTokens: number; maxOutputTokens: number }
const participant = (p: unknown): p is ReservedParticipant => object(p) && exact(p, ['tick', 'selfRef', 'role', 'roleEpoch']) && integer(p.tick) &&
  typeof p.selfRef === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(p.selfRef) && typeof p.role === 'string' && /^[A-Za-z]{1,32}$/.test(p.role) && integer(p.roleEpoch);
export interface ExperimentUsageReceipt { requestId: string; receiptId: string; sourceSha256: string; model: string; inputTokens: number; outputTokens: number }
/** Operator disposition of an unknown outcome: the full ceiling is booked as a liability. */
export interface ExperimentSettlement { requestId: string; operator: string; note: string; settledAt: string; basis: 'book_full_reserved_ceiling' }
/** Terminal revocation of unused capacity. The manifest binds the reviewed source and plan.
 * This records no request, receipt, refund, balance change or replacement authorization. */
export interface ExperimentClosure {runId:string;manifestSha256:string;closedAt:string;reason:'completed'|'stopped'}
type Event = { kind: 'authorization'; value: ExperimentAuthorization }
  | { kind: 'settlement'; value: ExperimentSettlement }
  | { kind: 'reservation'; value: ExperimentReservation; at: string }
  | { kind: 'usage'; value: ExperimentUsageReceipt }
  | { kind: 'closure'; value: ExperimentClosure };
interface Document { kind: 'node-experiment-budget-v1'; carried: CarriedAllowance; events: Event[] }
interface RequestState { request: ExperimentReservation; ceilingMicroUsd: number; receipt: ExperimentUsageReceipt | null; bookedMicroUsd: bigint | null; settlement: ExperimentSettlement | null; reservedAt: string }

function checkPrices(p: unknown, model: string): p is AccountingPrices {
  return object(p) && exact(p, ['model', 'inputMicroUsdPerMillionTokens', 'outputMicroUsdPerMillionTokens', 'evidenceSha256']) && p.model === model &&
    integer(p.inputMicroUsdPerMillionTokens) && p.inputMicroUsdPerMillionTokens > 0 && integer(p.outputMicroUsdPerMillionTokens) && p.outputMicroUsdPerMillionTokens > 0 && hash(p.evidenceSha256);
}
function checkCarried(c: unknown): asserts c is CarriedAllowance {
  if (!object(c) || !exact(c, ['kind', 'document', 'fingerprint', 'summary']) || !['node-initial-test-budget-v1', 'node-experiment-budget-v1'].includes(c.kind) ||
    !hash(c.fingerprint) || fingerprint(c.document) !== c.fingerprint) return fail('experiment_carried_invalid');
  const s = c.summary;
  if (!object(s) || !exact(s, ['bookedMicroUsd', 'heldMicroUsd', 'requests', 'overrun', 'expiresAt', 'prices',...(Object.hasOwn(s,'closedAt')?['closedAt']:[])]) ||
    Object.hasOwn(s,'closedAt')&&(c.kind!=='node-experiment-budget-v1'||!iso(s.closedAt)) || !/^\d+$/.test(s.bookedMicroUsd) || !/^\d+$/.test(s.heldMicroUsd) ||
    !integer(s.requests) || typeof s.overrun !== 'boolean' || !(s.expiresAt === null || iso(s.expiresAt)) || !(s.prices === null || checkPrices(s.prices, s.prices.model))) return fail('experiment_carried_invalid');
  // A carried experiment allowance is re-validated in full; an initial allowance was validated by InitialTestBudget when carried.
  if (c.kind === 'node-experiment-budget-v1') {
    const inner = replay(c.document as Document);
    if (!same(summarize(inner), s)) return fail('experiment_carried_summary');
  }
}
function summarize(s: ReturnType<typeof replay>): CarriedSummary {
  return { bookedMicroUsd: s.booked.toString(), heldMicroUsd: s.held.toString(), requests: s.requests.length, overrun: s.overrun,
    expiresAt: s.authorization?.expiresAt ?? null, prices: s.authorization?.prices ?? null,...(s.closure?{closedAt:s.closure.closedAt}:{}) };
}

function replay(d: Document) {
  if (!object(d) || !exact(d, ['kind', 'carried', 'events']) || d.kind !== 'node-experiment-budget-v1' || !Array.isArray(d.events) || d.events.length > 3 * MAX_REQUESTS + 2) return fail('experiment_budget_schema');
  checkCarried(d.carried);
  const requests = new Map<string, RequestState>(), receipts = new Set<string>(), streams = new Map<string, { selfRef: string; tick: number }>();
  let authorization: ExperimentAuthorization | null = null, overrun = false;
  let closure:ExperimentClosure|undefined;
  const totals = () => ({ booked: [...requests.values()].reduce((n, q) => n + (q.bookedMicroUsd ?? 0n), 0n), held: [...requests.values()].reduce((n, q) => n + (q.bookedMicroUsd === null ? BigInt(q.ceilingMicroUsd) : 0n), 0n) });
  for (const event of d.events) {
    if (!object(event)) return fail('experiment_budget_event');
    if(closure)return fail('experiment_budget_closed');
    if (event.kind === 'authorization') {
      const a = event.value, carried = d.carried.summary;
      if (!exact(event, ['kind', 'value']) || !object(a) || authorization || !exact(a, ['runId', 'authorizedAt', 'expiresAt', 'expectedCarriedFingerprint', 'instruction', 'scope', 'manifestSha256', 'model', 'maxRequests', 'limitMicroUsd', 'perRequestMicroUsd', 'prices']) ||
        !id(a.runId) || !iso(a.authorizedAt) || !iso(a.expiresAt) || a.expiresAt <= a.authorizedAt || Date.parse(a.expiresAt) - Date.parse(a.authorizedAt) > MAX_WINDOW_MS ||
        a.expectedCarriedFingerprint !== d.carried.fingerprint || typeof a.instruction !== 'string' || !a.instruction.trim() || a.instruction.length > 8192 ||
        a.scope !== 'accounted_experiment_spending_only' || !hash(a.manifestSha256) || !isExperimentModel(a.model) ||
        !integer(a.maxRequests) || a.maxRequests < 1 || a.maxRequests > MAX_REQUESTS ||
        !integer(a.limitMicroUsd) || a.limitMicroUsd < 1 || a.limitMicroUsd > MAX_LIMIT_MICRO_USD ||
        !integer(a.perRequestMicroUsd) || a.perRequestMicroUsd < 1 || a.perRequestMicroUsd > a.limitMicroUsd ||
        // The prior allowance must be closed before new spending opens. Its rate evidence is reused
        // unchanged for the same model; a different model may only use its reviewed price entry.
        carried.expiresAt === null || (a.authorizedAt < carried.expiresAt && !countClosed(d.carried, a.authorizedAt)) || carried.prices === null ||
        !checkPrices(a.prices, a.model) || !same(a.prices, authorizedPrices(a.model, carried.prices))) return fail('experiment_budget_authorization');
      authorization = a;
    } else if (event.kind === 'reservation') {
      const q = event.value, a = authorization;
      if (!exact(event, ['kind', 'value', 'at']) || !object(q) || !exact(q, ['id', 'episodeId', 'actorId', 'inputSha256', 'participant', 'model', 'maxInputTokens', 'maxOutputTokens']) || !a || !iso(event.at) ||
        event.at < a.authorizedAt || event.at >= a.expiresAt || !id(q.id) || requests.has(q.id) || !id(q.episodeId) || !id(q.actorId) || !hash(q.inputSha256) || q.model !== a.model ||
        !integer(q.maxInputTokens) || q.maxInputTokens < 1 || q.maxInputTokens > (q.model === 'claude-haiku-5-5' ? 100000 : 36864) ||
        !integer(q.maxOutputTokens) || q.maxOutputTokens < 1 || q.maxOutputTokens > (q.model === 'claude-haiku-5-5' ? 16384 : 2048) ||
        !participant(q.participant) || overrun || requests.size >= a.maxRequests || [...requests.values()].some(x => x.bookedMicroUsd === null)) return fail('experiment_budget_admission');
      const key = JSON.stringify([q.episodeId, q.actorId]), stream = streams.get(key);
      if (stream && (stream.selfRef !== q.participant.selfRef || stream.tick >= q.participant.tick)) return fail('experiment_budget_stream');
      const ceiling = usageCost(q.maxInputTokens, q.maxOutputTokens, a.prices), t = totals();
      if (ceiling > a.perRequestMicroUsd || t.booked + t.held + BigInt(ceiling) > BigInt(a.limitMicroUsd)) return fail('experiment_budget_cost_limit');
      streams.set(key, { selfRef: q.participant.selfRef, tick: q.participant.tick });
      requests.set(q.id, { request: structuredClone(q), ceilingMicroUsd: ceiling, receipt: null, bookedMicroUsd: null, settlement: null, reservedAt: event.at });
    } else if (event.kind === 'usage') {
      const r = event.value, q = requests.get(r?.requestId);
      if (!exact(event, ['kind', 'value']) || !object(r) || !exact(r, ['requestId', 'receiptId', 'sourceSha256', 'model', 'inputTokens', 'outputTokens']) || !q || q.receipt || q.settlement ||
        !id(r.receiptId) || receipts.has(r.receiptId) || !hash(r.sourceSha256) || !id(r.model) || !integer(r.inputTokens) || !integer(r.outputTokens)) return fail('experiment_budget_receipt');
      q.receipt = structuredClone(r); receipts.add(r.receiptId);
      if (r.model === authorization!.model) {
        const p = authorization!.prices;
        q.bookedMicroUsd = (BigInt(r.inputTokens) * BigInt(p.inputMicroUsdPerMillionTokens) + 999999n) / 1000000n + (BigInt(r.outputTokens) * BigInt(p.outputMicroUsdPerMillionTokens) + 999999n) / 1000000n;
        overrun ||= q.bookedMicroUsd > BigInt(q.ceilingMicroUsd) || r.inputTokens > q.request.maxInputTokens || r.outputTokens > q.request.maxOutputTokens;
      }
    } else if (event.kind === 'settlement') {
      // Only a request with NO receipt can be settled: a wrong-model or overrun receipt is known
      // evidence of a fault and keeps the allowance blocked.
      const v = event.value, q = requests.get(v?.requestId);
      if (!exact(event, ['kind', 'value']) || !object(v) || !exact(v, ['requestId', 'operator', 'note', 'settledAt', 'basis']) || !q || q.receipt || q.settlement ||
        q.bookedMicroUsd !== null || typeof v.operator !== 'string' || !v.operator.trim() || v.operator.length > 128 || typeof v.note !== 'string' || !v.note.trim() ||
        v.note.length > 2048 || !iso(v.settledAt) || v.settledAt < q.reservedAt || v.basis !== 'book_full_reserved_ceiling') return fail('experiment_budget_settlement');
      q.settlement = structuredClone(v); q.bookedMicroUsd = BigInt(q.ceilingMicroUsd);
    } else if(event.kind==='closure'){
      const v=event.value,a=authorization,t=totals();
      if(!exact(event,['kind','value'])||!object(v)||!exact(v,['runId','manifestSha256','closedAt','reason'])||!a||
        v.runId!==a.runId||v.manifestSha256!==a.manifestSha256||!iso(v.closedAt)||v.closedAt<a.authorizedAt||
        !['completed','stopped'].includes(v.reason)||overrun||t.held!==0n||[...requests.values()].some(q=>q.bookedMicroUsd===null||q.reservedAt>v.closedAt))
        return fail('experiment_budget_closure');
      closure=structuredClone(v);
    } else return fail('experiment_budget_event');
  }
  return { requests: [...requests.values()], authorization, overrun, ...totals(),...(closure?{closure}:{}) };
}
function validate(v: unknown): Document { replay(v as Document); return structuredClone(v) as Document; }

/** checkCarried has already replayed this document. A count-exhausted grant cannot admit
 * another request. Require known receipts, zero holds and no overrun; do not alter its expiry. */
function countClosed(c: CarriedAllowance, authorizedAt: string): boolean {
  if (c.kind !== 'node-experiment-budget-v1' || c.summary.heldMicroUsd !== '0' || c.summary.overrun) return false;
  const d = c.document as Document, a = d.events.find(e => e.kind === 'authorization')?.value;
  const reservations = d.events.filter(e => e.kind === 'reservation');
  const usage = d.events.filter(e => e.kind === 'usage');
  const closure=d.events.find(e=>e.kind==='closure')?.value;
  return !!a && authorizedAt >= a.authorizedAt && d.events.every(e => e.kind !== 'reservation' || e.at <= authorizedAt) &&
    (closure?closure.closedAt<=authorizedAt:reservations.length >= a.maxRequests&&usage.length === reservations.length);
}

export class ExperimentBudget {
  private constructor(private store: AccountingStore<Document>) {}

  /** Carry a closed InitialTestBudget forward. It is opened (and so fully validated) by its own class first. */
  static carryFromInitial(directory: string, initialDirectory: string, options: AccountingStoreOptions = {}) {
    const prior = InitialTestBudget.open(initialDirectory);
    let view;
    try { view = prior.view(); } finally { prior.close(); }
    const raw = AccountingStore.open<unknown>(initialDirectory, (v) => v);
    let document: unknown;
    try { document = raw.current(); } finally { raw.close(); }
    if (fingerprint(document) !== view.historyHash) return fail('experiment_carried_changed');
    if (view.requests.some(q => q.bookedMicroUsd === null)) return fail('experiment_carried_outstanding_hold');
    const summary: CarriedSummary = { bookedMicroUsd: view.booked.toString(), heldMicroUsd: view.held.toString(), requests: view.requests.length,
      overrun: view.overrun, expiresAt: view.authorization?.expiresAt ?? null, prices: view.authorization?.prices ?? null };
    return ExperimentBudget.#create(directory, { kind: 'node-initial-test-budget-v1', document, fingerprint: view.historyHash, summary }, options);
  }
  /** Chain from a closed experiment allowance (how a later, larger study is funded). */
  static carryFromExperiment(directory: string, priorDirectory: string, options: AccountingStoreOptions = {}) {
    const prior = ExperimentBudget.open(priorDirectory);
    let document: Document;
    try { document = prior.store.current(); } finally { prior.close(); }
    const s = summarize(replay(document));
    if (s.heldMicroUsd !== '0') return fail('experiment_carried_outstanding_hold');
    return ExperimentBudget.#create(directory, { kind: 'node-experiment-budget-v1', document, fingerprint: fingerprint(document), summary: s }, options);
  }
  static #create(directory: string, carried: CarriedAllowance, options: AccountingStoreOptions) {
    return new ExperimentBudget(AccountingStore.create(directory, { kind: 'node-experiment-budget-v1', carried, events: [] }, validate, options));
  }
  static open(directory: string, options: AccountingStoreOptions = {}) { return new ExperimentBudget(AccountingStore.open(directory, validate, options)); }

  /** Pure validation/projection for observers. Never opens a store, acquires a lock or writes. */
  static inspect(document: unknown, now = new Date().toISOString()) {
    return experimentView(validate(document), now);
  }

  #append(event: Event) { const d = this.store.current(); d.events.push(structuredClone(event)); this.store.commit(d); }
  carriedFingerprint(): string { return this.store.current().carried.fingerprint; }
  carriedPrices(): AccountingPrices | null { return structuredClone(this.store.current().carried.summary.prices); }
  authorize(value: ExperimentAuthorization) {
    const prior = this.store.current().events.find(e => e.kind === 'authorization');
    if (prior) { if (!same(prior, { kind: 'authorization', value })) return fail('experiment_budget_authorization_conflict'); return; }
    this.#append({ kind: 'authorization', value });
  }
  reserve(value: ExperimentReservation, at = new Date().toISOString()): 'reserved' | 'duplicate' {
    const view=this.view(at);if(view.closure)return fail('experiment_budget_closed');
    const prior = view.requests.find(q => q.request.id === value.id);
    if (prior) { if (!same(prior.request, value)) return fail('experiment_budget_reservation_conflict'); return 'duplicate'; }
    this.#append({ kind: 'reservation', value, at }); return 'reserved';
  }
  recordUsage(value: ExperimentUsageReceipt): 'recorded' | 'duplicate' {
    const prior = this.view().requests.find(q => q.request.id === value.requestId)?.receipt;
    if (prior) { if (!same(prior, value)) return fail('experiment_budget_receipt_conflict'); return 'duplicate'; }
    this.#append({ kind: 'usage', value }); return 'recorded';
  }
  /** Explicit operator action after a failed call: book its full ceiling so admission can continue. */
  settleUnknown(value: ExperimentSettlement): 'settled' | 'duplicate' {
    const prior = this.view().requests.find(q => q.request.id === value.requestId)?.settlement;
    if (prior) { if (!same(prior, value)) return fail('experiment_budget_settlement_conflict'); return 'duplicate'; }
    this.#append({ kind: 'settlement', value }); return 'settled';
  }
  view(now = new Date().toISOString()) {
    return experimentView(this.store.current(), now);
  }
  /** Revoke only unused capacity after a terminal run. Unknown usage remains held and blocks
   * closure. Exact retries are no-ops; changing a recorded terminal fact is forbidden. */
  closeAllowance(value:ExperimentClosure):'closed'|'duplicate'{
    const prior=this.view().closure;
    if(prior){if(!same(prior,value))return fail('experiment_budget_closure_conflict');return 'duplicate';}
    this.#append({kind:'closure',value});return 'closed';
  }
  close() { this.store.close(); }
}

function experimentView(d: Document, now: string) {
  if (!iso(now)) return fail('experiment_budget_time');
  const s = replay(d), a = s.authorization;
  const outstanding = s.requests.some(q => q.bookedMicroUsd === null);
  const remaining = a ? BigInt(a.limitMicroUsd) - s.booked - s.held : null;
  const stop = !a ? 'not_authorized' : s.closure?'closed':now < a.authorizedAt ? 'not_yet_open' : now >= a.expiresAt ? 'expired' : s.overrun ? 'overrun'
    : outstanding ? 'outstanding_hold' : s.requests.length >= a.maxRequests ? 'request_limit' : remaining! <= 0n ? 'cost_limit' : null;
  return { ...s, historyHash: fingerprint(d), carried: structuredClone(d.carried.summary), remainingMicroUsd: remaining,
    historicalBillingReconciled: false as const, budgetScope: 'new_experiment_spending_only' as const, canReserve: stop === null, stopReason: stop };
}
