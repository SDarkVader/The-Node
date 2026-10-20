import { InitialTestBudget } from './initialTestBudget.js';
import { buildResponsesRequest, type ResponsesRequest } from './responsesRequest.js';
import { parseRecordedResponse } from './recordedResponse.js';
import { OfflineBroker } from './broker.js';
import { sha256 } from './accountingStore.js';
import { evidenceHash, replay } from './replay.js';
import type { IsolatedParticipantHost } from './isolatedHost.js';

type Host = Pick<IsolatedParticipantHost, 'read' | 'submitDecision' | 'advance' | 'exportTape' | 'evidence'>;
type Sender = (request: ResponsesRequest, signal: AbortSignal) => Promise<Buffer>;
export interface GameTurnOptions { signal?: AbortSignal; deadlineMs?: number }

/** Explicit forward-budget experiment, not an opening of the protected production live entrypoint.
 * Sender is trusted transport code. The policy gets only buildResponsesRequest's authorized projection.
 */
export async function runInitialGameTurn(budget: InitialTestBudget, host: Host, send: Sender, options: GameTurnOptions = {}) {
  const deadline = options.deadlineMs ?? 12000;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 12000) throw Error('game_turn_deadline');
  const abort = new AbortController(), external = options.signal;
  const cancel = () => abort.abort(); external?.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let applied = false, reserved = false, requestId: string | null = null;
  try {
    if (external?.aborted) return { status: 'rejected' as const, code: 'cancelled_before_reservation' };
    const observation = await host.read(), view = budget.view();
    if (!view.canReserve || !view.authorization) return { status: 'rejected' as const, code: 'test_budget_not_ready' };
    const request = buildResponsesRequest(observation, view.authorization.model);
    requestId = sha256(JSON.stringify([view.authorization.runId, request.context.selfRef, request.context.tick]));
    if (external?.aborted) return { status: 'rejected' as const, code: 'cancelled_before_reservation' };
    const started = performance.now();
    if (budget.reserve({ id: requestId, inputSha256: request.sha256, context: request.context, model: request.model,
      maxInputTokens: request.maxInputTokens, maxOutputTokens: request.maxOutputTokens }) !== 'reserved') return { status: 'rejected' as const, code: 'request_already_consumed' };
    reserved = true;
    const expired = () => abort.signal.aborted || performance.now() - started >= deadline;
    const remaining = deadline - (performance.now() - started);
    if (remaining <= 0 || external?.aborted) return { status: 'rejected' as const, code: 'deadline_before_dispatch', requestId };
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error('game_turn_deadline')); }, remaining); });
    let bytes: Buffer;
    try { bytes = await Promise.race([send(request, abort.signal), timeout]); }
    catch { return { status: 'rejected' as const, code: 'transport_failed_reservation_retained', requestId }; }
    const recorded = parseRecordedResponse(bytes, requestId), u = recorded.receipt.usage;
    if (!u) return { status: 'rejected' as const, code: 'usage_unknown_reservation_retained', requestId };
    // Book receipt before rejecting a stale/invalid/late action. Never retry or refund a consumed request.
    if (budget.recordUsage({ requestId, receiptId: recorded.receipt.receiptId, sourceSha256: recorded.receipt.sourceSha256,
      model: recorded.receipt.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens }) !== 'recorded') return { status: 'rejected' as const, code: 'receipt_already_consumed', requestId };
    if (expired() || external?.aborted) return { status: 'rejected' as const, code: 'deadline_or_cancelled_after_accounting', requestId };
    if (!recorded.actionable || budget.view().overrun) return { status: 'rejected' as const, code: 'response_not_actionable', requestId };
    const current = await host.read();
    if (expired()) return { status: 'rejected' as const, code: 'deadline_before_validation', requestId };
    const validated = await new OfflineBroker().evaluate(request.context, async () => ({ status: 'completed', model: recorded.receipt.model,
      inputTokens: u.inputTokens, outputTokens: u.outputTokens, decision: recorded.decision }), () => current.context,
      { model: request.model, maxInputTokens: request.maxInputTokens, maxOutputTokens: request.maxOutputTokens, deadlineMs: Math.max(1, Math.floor(deadline - (performance.now() - started))) });
    if (validated.kind !== 'validated_offline') return { status: 'rejected' as const, code: validated.code, requestId };
    if (expired()) return { status: 'rejected' as const, code: 'deadline_before_submission', requestId };
    await host.submitDecision(observation, validated.decision);
    if (expired()) return { status: 'rejected' as const, code: 'deadline_before_tick_commit', requestId };
    const effects = await host.advance(); applied = true;
    clearTimeout(timer); timer = undefined;
    const tape = await host.exportTape(), completeStateHash = await host.evidence();
    const replayHash = evidenceHash(replay(tape, tape.genesis.sourceRevision));
    if (replayHash !== completeStateHash) return { status: 'applied_replay_failed' as const, code: 'complete_state_mismatch', requestId };
    const after = await host.read();
    return { status: 'applied' as const, requestId, model: request.model, decision: validated.decision, usage: u,
      effects, before: observation.projection.self, after: after.projection.self, tickBefore: observation.context.tick, tickAfter: after.context.tick,
      replayVerified: true, completeStateHash, replayHash, admittedActionCount: tape.ticks.at(-1)?.actions.length ?? 0 };
  } catch {
    return { status: applied ? 'applied_replay_failed' as const : 'rejected' as const,
      code: applied ? 'post_commit_evidence_failed' : reserved ? 'turn_failed_reservation_and_receipt_retained' : 'preflight_failed_no_dispatch', requestId };
  } finally { if (timer) clearTimeout(timer); abort.abort(); external?.removeEventListener('abort', cancel); }
}
