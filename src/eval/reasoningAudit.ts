/** Read-only audit of ACTUAL archived request bytes and returned content blocks.
 * No provider dispatch, budget writer, explanation inference or raw private text export. */
import { sha256 } from '../agent/accountingStore.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { recoverContinuation, type ContinuationEvent } from './continuationLedger.js';
import { DELIBERATION_SYSTEM, DELIBERATION_TURN } from './continuationReasoning.js';
import type { StartEvidence } from './continuationRunner.js';

function chain(events: readonly ContinuationEvent[]): { events: readonly ContinuationEvent[]; start: StartEvidence }[] {
  const start = events[0]!.data as StartEvidence;
  return [...(start.parent ? chain(start.parent.events) : []), { events, start }];
}
export function auditContinuationReasoning(events: readonly ContinuationEvent[]) {
  const verified = recoverContinuation(events, events[0]?.data.sourceRevision);
  const segments = chain(events), seen = new Set<string>();
  const rows = segments.flatMap(segment => segment.events.filter(e => e.kind === 'request').map(event => {
    const d = event.data;
    if (seen.has(d.requestId)) throw Error('reasoning_audit_duplicate_request'); seen.add(d.requestId);
    const wire = JSON.parse(d.body), user = wire.messages.at(-1), turn = JSON.parse(user.content[0].text);
    const currentRoleRule = wire.messages.filter((m: any) => m.role === 'user').map((m: any) => JSON.parse(m.content[0].text).roleRule).filter(Boolean).at(-1);
    const controls = { model: wire.model, thinking: wire.thinking ?? null, effort: wire.output_config?.effort ?? null, maxOutputTokens: wire.max_tokens };
    const systemSha256 = sha256(wire.system);
    const condition = { ...controls, systemSha256, turnInstructionSha256: turn.reasoningInstruction ? sha256(turn.reasoningInstruction) : null };
    const response = segment.events.find(e => e.kind === 'response' && e.data.requestId === d.requestId)?.data;
    let parsed, raw;
    try { if (response) { const bytes = Buffer.from(response.raw, 'base64'); raw = JSON.parse(bytes.toString('utf8')); parsed = parseAnthropicResponse(bytes, d.requestId); } } catch { /* explicit below */ }
    const prior = wire.messages.slice(0, -1).filter((m: any) => m.role === 'assistant');
    return { actorId: d.actorId as string, sourceTick: d.tick as number, requestId: d.requestId as string,
      sourceRevision: segment.start.sourceRevision, reasoningProfile: segment.start.plan.reasoningProfile ?? 'legacy_adaptive_medium',
      controls, systemSha256, roleRuleSha256: currentRoleRule ? sha256(currentRoleRule) : null, conditionSha256: sha256(JSON.stringify(condition)),
      explicitEveryTurnInstruction: wire.system.includes(DELIBERATION_SYSTEM) && turn.reasoningInstruction === DELIBERATION_TURN,
      bodyBytes: Buffer.byteLength(d.body), priorAssistantTurns: prior.length,
      priorThinkingBlocks: prior.reduce((n: number, m: any) => n + m.content.filter((b: any) => b.type === 'thinking').length, 0),
      observationPatchOperations: turn.observationPatch?.length ?? null,
      response: response ? { parsed: !!parsed, status: parsed?.reasoning.status ?? 'unparseable',
        thinkingBlocks: parsed?.reasoning.summaries.length ?? null, nonemptySummaries: parsed?.reasoning.summaries.filter(s => s.length > 0).length ?? null,
        redactedBlocks: parsed?.reasoning.redactedBlocks ?? null, stopReason: parsed?.stopReason ?? null,
        inputTokens: parsed?.receipt.usage?.inputTokens ?? null, outputTokens: parsed?.receipt.usage?.outputTokens ?? null,
        elapsedMs: response.latencyMs, inputTransformations: Array.isArray(raw?.input_transformations) ? raw.input_transformations.length : 0 } : null };
  }));
  const actors = [...new Set(rows.map(r => r.actorId))].map(actorId => {
    const mine = rows.filter(r => r.actorId === actorId), received = mine.filter(r => r.response?.parsed);
    return { actorId, requests: mine.length, parsedResponses: received.length,
      summaryReturned: received.filter(r => r.response!.status === 'summary_returned').length,
      thinkingPresentResponses: received.filter(r => (r.response!.thinkingBlocks ?? 0) > 0).length,
      thinkingBlocksReturned: received.reduce((n,r) => n + (r.response!.thinkingBlocks ?? 0),0),
      summaryEmpty: received.filter(r => r.response!.status === 'summary_empty').length,
      redactedOnly: received.filter(r => r.response!.status === 'redacted_only').length,
      notReturned: received.filter(r => r.response!.status === 'not_returned').length,
      truncated: received.filter(r => r.response!.stopReason === 'max_tokens').length,
      systemHashes: [...new Set(mine.map(r => r.systemSha256))], conditionHashes: [...new Set(mine.map(r => r.conditionSha256))],
      explicitInstructionOnEveryRequest: mine.every(r => r.explicitEveryTurnInstruction) };
  });
  const ticks = [...new Set(rows.map(r => r.sourceTick))].sort((a,b) => a-b).map(sourceTick => {
    const at = rows.filter(r => r.sourceTick === sourceTick);
    return { sourceTick, actors: at.map(r => r.actorId), uniformReasoningConditions: new Set(at.map(r => r.conditionSha256)).size === 1 };
  });
  return { schema: 'node-continuation-reasoning-audit-v1', sourceRevision: verified.sourceRevision,
    verified: verified.verified, complete: verified.complete, ledgerRoot: verified.ledgerRoot, finalTick: verified.summary?.ticks ?? null,
    mode: verified.mode, segments: segments.length, actors, ticks, requests: rows,
    interpretation: 'Equal controls are not identical observations or histories. Adaptive thinking has no per-request emission guarantee, and a missing block alone does not identify the model-internal cause.',
    providerCalls: 0, rawPrivateTextIncluded: false };
}
