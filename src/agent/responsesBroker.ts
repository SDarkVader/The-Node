import { performance } from 'node:perf_hooks';
import { AccountingLedger, type AccountingPrices } from './accountingLedger.js';
import { AccountedBroker } from './accountedBroker.js';
import { sha256, failAccounting as fail } from './accountingStore.js';
import { assertLiveAdmission, type Outcome } from './broker.js';
import type { DecisionContext } from './protocol.js';
import { isResponsesRequest, type ResponsesRequest } from './responsesRequest.js';
import { sendLiveResponses, sendLoopbackResponsesFixture, validateLoopbackResponsesRoute, type ManagedResponsesRoute, type LoopbackResponsesRoute } from './responsesTransport.js';

/** Joins final wire bytes, durable account reservation, transport and the unchanged validator. No automatic financial approval. */
export class ResponsesBroker {
  constructor(private ledger: AccountingLedger) {}
  #reserve(request: ResponsesRequest, prices: AccountingPrices): string {
    if (!isResponsesRequest(request) || prices.model !== request.model) return fail('responses_request_untrusted');
    const id = sha256(JSON.stringify([this.ledger.view().accountId, request.context.selfRef, request.context.tick]));
    if (this.ledger.reserve({ id, inputSha256: request.sha256, context: request.context, prices: structuredClone(prices),
      maxInputTokens: request.maxInputTokens, maxOutputTokens: request.maxOutputTokens }) !== 'reserved') return fail('responses_request_duplicate');
    return id;
  }
  async #evaluate(request: ResponsesRequest, prices: AccountingPrices, signal: AbortSignal, deadlineMs: number,
    send: (remainingMs: number) => Promise<Buffer>, current: () => DecisionContext | Promise<DecisionContext>): Promise<Outcome> {
    if (signal.aborted) return fail('responses_aborted');
    const started = performance.now(), id = this.#reserve(request, prices);
    let cancellationFailed = false;
    const cancelled = () => { try { this.ledger.cancelRequest(id); } catch { cancellationFailed = true; } };
    const deadlineTimer = setTimeout(cancelled, Math.max(1, deadlineMs - (performance.now() - started)));
    signal.addEventListener('abort', cancelled, { once: true });
    try {
      if (signal.aborted) cancelled();
      const remaining = Math.floor(deadlineMs - (performance.now() - started));
      let bytes: Buffer;
      try {
        if (remaining < 1 || signal.aborted) throw Error('not dispatched');
        bytes = await send(remaining);
      } catch {
        if (cancellationFailed) return fail('accounting_write_failed');
        this.ledger.markUncertain(id, 'transport_failure');
        return { kind: 'rejected', code: 'provider_transport_failed_reservation_held' };
      }
      if (signal.aborted || performance.now() - started >= deadlineMs) cancelled();
      if (cancellationFailed) return fail('accounting_write_failed');
      const outcome = await new AccountedBroker(this.ledger).complete(id, bytes, async () => {
        const latest = await current();
        // A synchronous callback/fs operation can defer timer delivery. Check the
        // monotonic clock directly before allowing validation to publish anything.
        if (signal.aborted || performance.now() - started >= deadlineMs) cancelled();
        if (cancellationFailed) return fail('accounting_write_failed');
        return latest;
      });
      // Persistence itself may finish after the deadline. A recorded validated
      // proposal is not proof of publication/admission; never return it late.
      if (outcome.kind === 'validated_offline' && (signal.aborted || performance.now() - started >= deadlineMs)) {
        return { kind: 'rejected', code: 'response_deadline_after_accounting' };
      }
      return outcome;
    } finally { clearTimeout(deadlineTimer); signal.removeEventListener('abort', cancelled); }
  }
  /** Never dispatches in the current revision: protected gate precedes even reservation and key access. */
  async evaluateLive(request: ResponsesRequest, prices: AccountingPrices, getApiKey: () => string, route: ManagedResponsesRoute,
    signal: AbortSignal, current: () => DecisionContext | Promise<DecisionContext>): Promise<Outcome> {
    assertLiveAdmission();
    return this.#evaluate(request, prices, signal, 12_000, remainingMs => sendLiveResponses(request, getApiKey, route, signal, remainingMs), current);
  }
  /** Explicit mechanical fixture: exact loopback endpoint and fixed invented bearer only. */
  async evaluateLoopbackFixture(request: ResponsesRequest, prices: AccountingPrices, url: string,
    current: () => DecisionContext | Promise<DecisionContext>, route: LoopbackResponsesRoute = {}, signal: AbortSignal = new AbortController().signal): Promise<Outcome> {
    const deadline = route.deadlineMs ?? 12_000;
    validateLoopbackResponsesRoute(url, route);
    if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 12_000) return fail('responses_deadline_invalid');
    return this.#evaluate(request, prices, signal, deadline, remainingMs => sendLoopbackResponsesFixture(request, url, { ...route, deadlineMs: remainingMs }, signal), current);
  }
}
