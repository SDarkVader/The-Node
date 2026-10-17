import { AccountingLedger, type AccountingPrices, type AccountingRequest } from './accountingLedger.js';
import { sha256, failAccounting as fail } from './accountingStore.js';
import { parseRecordedResponse } from './recordedResponse.js';
import { OfflineBroker, type Outcome } from './broker.js';
import { policyInput, type DecisionContext, type Decision } from './protocol.js';
import { mockDecisionSchema } from './mockProvider.js';
import type { OfflineParticipantHost } from './host.js';

export interface PreparedRecordedRequest {
  readonly id: string;
  readonly inputSha256: string;
  /** Application-level policy document, not an HTTP/API request or permission to dispatch. */
  readonly policyJson: string;
  readonly dispatchAllowed: false;
}

/** Durable broker accounting around locally supplied response archives. Contains no transport callback.
 * A successful preparation or operator reconciliation cannot open the protected live gate.
 */
export class AccountedBroker {
  constructor(private ledger: AccountingLedger) {}
  #prepare(context: DecisionContext, prices: AccountingPrices, observation: unknown, now?: string): PreparedRecordedRequest {
    const input = policyInput(context);
    // A host projection already carries self/tick/role/affordances. Do not repeat
    // the entire reference list as a second context beside it in the policy body.
    const policyJson = JSON.stringify({ protocol: 'node-recorded-policy-v1', model: prices.model,
      ...(observation === null ? { input } : { observation }), decisionSchema: mockDecisionSchema(input), maxOutputTokens: 2_048 });
    const size = Buffer.byteLength(policyJson);
    if (size > 32_768) return fail('accounted_request_too_large');
    const inputSha256 = sha256(policyJson);
    const id = sha256(JSON.stringify([this.ledger.view().accountId, input.selfRef, input.tick]));
    const request: AccountingRequest = { id, inputSha256, context: input, prices: structuredClone(prices), maxInputTokens: size + 4_096, maxOutputTokens: 2_048 };
    if (this.ledger.reserve(request, now) !== 'reserved') return fail('accounted_request_duplicate');
    return Object.freeze({ id, inputSha256, policyJson, dispatchAllowed: false });
  }
  prepare(context: DecisionContext, prices: AccountingPrices, now?: string): PreparedRecordedRequest { return this.#prepare(context, prices, null, now); }
  /** Includes the existing authorized strategic projection, without session/observation tokens or raw World. */
  prepareFromHost(host: OfflineParticipantHost, session: string, prices: AccountingPrices, now?: string): PreparedRecordedRequest {
    const observation = host.read(session);
    return this.#prepare(observation.context, prices, observation.projection, now);
  }
  async complete(requestId: string, responseBytes: Buffer, current: () => DecisionContext): Promise<Outcome> {
    const q = this.ledger.view().requests.find(q => q.request.id === requestId);
    if (!q) return fail('accounted_request_missing');
    if (q.decisionClaimed) return { kind: 'rejected', code: 'response_already_consumed' };
    let response: ReturnType<typeof parseRecordedResponse>;
    try { response = parseRecordedResponse(responseBytes, requestId); }
    catch { this.ledger.markUncertain(requestId, 'response_invalid'); return { kind: 'rejected', code: 'response_invalid_reservation_held' }; }
    // Accounting commits before any status/decision/freshness rejection.
    this.ledger.recordReceipt(response.receipt);
    this.ledger.claimDecision(requestId);
    const view = this.ledger.view();
    const accounted = view.requests.find(q => q.request.id === requestId)!;
    if (!response.actionable || accounted.bookedMicroUsd === null || view.overrun || q.uncertain || q.cancelled) {
      this.ledger.recordDecision(requestId, 'provider_rejected', null);
      return { kind: 'rejected', code: accounted.bookedMicroUsd === null ? 'usage_unknown_reservation_held' : view.overrun ? 'usage_exceeded_reservation' : q.uncertain ? 'request_previously_uncertain' : 'provider_response_rejected' };
    }
    const result = await new OfflineBroker().evaluate(q.request.context, async () => ({ status: 'completed', model: response.receipt.model,
      inputTokens: response.receipt.usage!.inputTokens, outputTokens: response.receipt.usage!.outputTokens, decision: response.decision }), current,
      { model: q.request.prices.model, maxInputTokens: q.request.maxInputTokens, maxOutputTokens: q.request.maxOutputTokens, deadlineMs: 12_000 });
    if (this.ledger.view().requests.find(q => q.request.id === requestId)!.cancelled) {
      this.ledger.recordDecision(requestId, 'provider_rejected', null);
      return { kind: 'rejected', code: 'request_cancelled' };
    }
    this.ledger.recordDecision(requestId, result.kind === 'validated_offline' ? 'validated' : result.code === 'stale_context' ? 'stale' : 'invalid',
      result.kind === 'validated_offline' ? sha256(JSON.stringify(result.decision)) : null);
    return result;
  }
  cancel(requestId: string): void { this.ledger.cancelRequest(requestId); }
}

/** Trusted, synchronous host admission. Cost is already durable; rejection never refunds it.
 * The host and kernel retain final authority, quotas, freshness, identity and replay recording.
 */
export function submitAccountedDecision(host: OfflineParticipantHost, session: string, observationId: string, tick: number, decision: Decision): void {
  const frame = (action: string, payload: unknown) => host.submit(session, { type: 'action', tick, observationId, action, payload });
  if (decision.move) frame('move', decision.move);
  if (decision.communication) {
    const { kind, ...payload } = decision.communication;
    if ('context' in payload && payload.context === null) delete (payload as { context?: unknown }).context;
    frame(String(kind), payload);
  }
  if (decision.diary) {
    const { context, ...payload } = decision.diary;
    frame('diaryEntry', context === null ? payload : { ...payload, context });
  }
  if (decision.role) frame('bakerPrice', { price: decision.role.price });
}
