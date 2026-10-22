/**
 * Haiku connection check (owner request 2026-10-22). Run by the owner on their PC through
 * `scripts/check-anthropic-connection.mjs`, never from a cloud session.
 *
 * 1. Builds the real study-1 tick-0 requests (council arm, all seven actors), translated to the
 *    Anthropic Messages envelope (`toAnthropicRequest`).
 * 2. Counts their input tokens with the FREE `count_tokens` endpoint.
 * 3. Only with `sendOne`: sends ONE real message (the Baker, whose schema exercises the most
 *    keywords), after refusing if its cost ceiling exceeds `maxUsd`. It reports whether the schema
 *    was accepted, the stop reason, usage, cost, latency against the 12,000 ms study deadline, and
 *    whether the decision passes the real validator, and what reasoning came back (status and the
 *    summaries, verbatim) against the 2,048 output-token cap. Enum case mismatches are reported, not repaired.
 * Nothing here is study evidence: the episode is not advanced and no allowance is touched. The
 * single message's cost is reported, at list price, in the check's own report.
 */
import { MultiActorEpisode, multiScenarioById } from './multiActorEpisode.js';
import { toAnthropicRequest, ANTHROPIC_VERSION, type AnthropicRequest } from '../agent/anthropicRequest.js';
import { parseAnthropicResponse, caseMismatches } from '../agent/anthropicResponse.js';
import { validateDecision } from '../agent/protocol.js';
import { sha256 } from '../agent/accountingStore.js';

/** List price for claude-haiku-5-5, prompts up to 100K tokens: USD per million (verified 2026-10-22,
 *  docs/research/model-options-2026-10-21/verify-anthropic.json). */
export const HAIKU_5_5_PRICES = { model: 'claude-haiku-5-5', inputUsdPerM: 0.10, outputUsdPerM: 0.50 } as const;
export const STUDY_DEADLINE_MS = 12_000;

export interface CheckExchange { httpStatus: number | null; bytes: Buffer | null; elapsedMs: number; errorType?: string | null; errorMessage?: string | null }
export type CheckSender = (endpoint: 'count_tokens' | 'messages', body: string, label: string) => Promise<CheckExchange>;
export interface CheckOptions { model?: string; sendOne?: boolean; maxUsd?: number; actorToSend?: string }

const usd = (inTok: number, outTok: number, p = HAIKU_5_5_PRICES) => (inTok * p.inputUsdPerM + outTok * p.outputUsdPerM) / 1e6;

export function connectionCheckRequests(model: string = HAIKU_5_5_PRICES.model): { actorId: string; request: AnthropicRequest }[] {
  const ep = new MultiActorEpisode(multiScenarioById('authority_attribution_council'), 'anthropic-connection-check');
  return ep.prompts({ model }).map((p) => ({ actorId: p.actorId, request: toAnthropicRequest(p.request!, model) }));
}

export async function runAnthropicConnectionCheck(send: CheckSender, options: CheckOptions = {}) {
  const model = options.model ?? HAIKU_5_5_PRICES.model;
  const maxUsd = options.maxUsd ?? 0.01;
  const actorToSend = options.actorToSend ?? 'baker-0';
  const requests = connectionCheckRequests(model);
  const report: Record<string, unknown> = { model, anthropicVersion: ANTHROPIC_VERSION, prices: HAIKU_5_5_PRICES, counted: [] as unknown[], sent: null as unknown };
  const counted = report.counted as { actorId: string; requestSha256: string; bodyBytes: number; httpStatus: number | null; inputTokens: number | null; errorType: string | null; errorMessage: string | null }[];
  for (const { actorId, request } of requests) {
    const x = await send('count_tokens', request.countBody, `count-${actorId}`);
    let inputTokens: number | null = null;
    if (x.httpStatus === 200 && x.bytes) {
      try { const v = JSON.parse(x.bytes.toString('utf8')) as { input_tokens?: unknown }; if (Number.isSafeInteger(v.input_tokens)) inputTokens = v.input_tokens as number; } catch { /* reported as null */ }
    }
    counted.push({ actorId, requestSha256: request.sha256, bodyBytes: Buffer.byteLength(request.body), httpStatus: x.httpStatus, inputTokens, errorType: x.errorType ?? null, errorMessage: x.errorMessage ?? null });
  }
  if (!options.sendOne) { report.sent = { skipped: 'pass --send-one to send one real message' }; return report; }
  const target = requests.find((r) => r.actorId === actorToSend);
  const count = counted.find((c) => c.actorId === actorToSend)?.inputTokens;
  if (!target || count === null || count === undefined) { report.sent = { refused: 'no token count for the actor to send' }; return report; }
  // The free count excludes the output schema. Use the study's full request bound instead
  // of a percentage margin; the PC check showed that 25% underestimated billed input.
  const { maxInputTokens, maxOutputTokens } = target.request;
  const ceilingUsd = usd(maxInputTokens, maxOutputTokens);
  const ceiling = { ceilingUsd, ceilingBasis: 'request_bound', maxInputTokens, maxOutputTokens, maxUsd };
  if (count > maxInputTokens) { report.sent = { refused: 'input_count_above_bound', countedInputTokens: count, ...ceiling }; return report; }
  if (!(ceilingUsd <= maxUsd)) { report.sent = { refused: 'ceiling_above_max_usd', ...ceiling }; return report; }
  const x = await send('messages', target.request.body, `message-${actorToSend}`);
  const sent: Record<string, unknown> = { actorId: actorToSend, requestSha256: target.request.sha256, ...ceiling, httpStatus: x.httpStatus, elapsedMs: x.elapsedMs,
    withinStudyDeadline: x.elapsedMs <= STUDY_DEADLINE_MS, errorType: x.errorType ?? null, errorMessage: x.errorMessage ?? null };
  if (x.httpStatus === 200 && x.bytes) {
    try {
      const r = parseAnthropicResponse(x.bytes, sha256(target.request.sha256 + ':check').slice(0, 64));
      const schema = (JSON.parse(target.request.body) as { output_config: { format: { schema: unknown } } }).output_config.format.schema;
      Object.assign(sent, { schemaAccepted: true, responseModel: r.receipt.model, responseModelMatches: r.receipt.model === model,
        stopReason: r.stopReason, status: r.receipt.status, actionable: r.actionable, usage: r.receipt.usage,
        costUsd: r.receipt.usage ? usd(r.receipt.usage.inputTokens, r.receipt.usage.outputTokens) : null,
        countedVsBilledInput: r.receipt.usage ? { counted: count, billed: r.receipt.usage.inputTokens } : null,
        reasoning: { status: r.reasoning.status, summaryChars: r.reasoning.summaries.map((t) => t.length), redactedBlocks: r.reasoning.redactedBlocks,
          summaries: r.reasoning.summaries }, outputTokensOfCap: r.receipt.usage ? `${r.receipt.usage.outputTokens}/${target.request.maxOutputTokens}` : null,
        decision: r.decision, validatorAccepts: r.actionable && validateDecision(r.decision, target.request.context) !== null,
        caseMismatches: r.actionable ? caseMismatches(r.decision, schema) : [] });
    } catch (e) { sent.parseError = e instanceof Error ? e.message : String(e); }
  } else sent.schemaAccepted = x.httpStatus === 400 ? false : null;
  report.sent = sent;
  return report;
}
