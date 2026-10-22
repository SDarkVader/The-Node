/**
 * Anthropic Messages adapter, request side (2026-10-22; owner: "Haiku connection check with
 * adapter if necessary"). No SDK, client, endpoint or credential here: this only builds bytes.
 *
 * It translates the FINAL Responses-shaped request (`buildEvaluationRequest` /
 * `buildResponsesRequest`) instead of rebuilding one, so the instructions, observation, notices
 * and decision schema are exactly the bytes the accounted study would send to OpenAI. Only the
 * envelope changes, per the Anthropic docs read on 2026-10-21/22
 * (docs/research/model-options-2026-10-21/verify-anthropic.json):
 * - `system` = instructions; one user `text` block = the observation text;
 * - `output_config.format = {type:'json_schema', schema}` (structured outputs, GA);
 * - `output_config.effort = 'low'` with `thinking: {type:'disabled'}` (Haiku 5.5: thinking off at
 *   high effort or below), mirroring the OpenAI request's low reasoning;
 * - no temperature/top_p/top_k and no assistant prefill (both return 400 on Haiku 5.5);
 * - `minimum`/`maximum` removed from the schema: Anthropic rejects them with 400. The validator
 *   still enforces price ∈ [0, 2] (`validateDecision`), so the bound is checked, not lost.
 * `countBody` is the same input for the free `/v1/messages/count_tokens` endpoint. That endpoint is
 * documented to accept the message inputs; `output_config` is left out because its acceptance
 * there is not documented, so the count excludes any schema overhead.
 */
import { sha256, failAccounting as fail } from './accountingStore.js';
import type { DecisionContext } from './protocol.js';

export const ANTHROPIC_VERSION = '2023-06-01' as const;
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages' as const;
export const ANTHROPIC_COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens' as const;
const MAX_BODY_BYTES = 32_768;

type Schema = Record<string, unknown>;
export interface AnthropicRequest {
  readonly model: string;
  readonly context: DecisionContext;
  readonly body: string;
  readonly sha256: string;
  readonly countBody: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: 2048;
}
/** Any final Responses-shaped request (evaluation or plain). */
export interface ResponsesShapedRequest { readonly context: DecisionContext; readonly body: string }

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The decision schema with the keywords Anthropic rejects removed (number minimum/maximum). */
export function anthropicSchema(schema: unknown): Schema {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!object(node)) return node;
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'minimum' && k !== 'maximum').map(([k, v]) => [k, strip(v)]));
  };
  if (!object(schema)) return fail('anthropic_schema_invalid');
  return strip(schema) as Schema;
}

export function toAnthropicRequest(request: ResponsesShapedRequest, model: string): AnthropicRequest {
  if (typeof model !== 'string' || !/^claude-[a-z0-9-]{1,100}$/.test(model)) return fail('anthropic_model_invalid');
  let source: unknown;
  try { source = JSON.parse(request.body); } catch { return fail('anthropic_source_invalid'); }
  if (!object(source) || typeof source.instructions !== 'string' || !Array.isArray(source.input) || source.input.length !== 1) return fail('anthropic_source_invalid');
  const message = source.input[0];
  const part = object(message) && Array.isArray(message.content) && message.content.length === 1 ? message.content[0] : undefined;
  const format = object(source.text) && object(source.text.format) ? source.text.format : undefined;
  if (!object(message) || message.role !== 'user' || !object(part) || part.type !== 'input_text' || typeof part.text !== 'string' ||
    !format || format.type !== 'json_schema' || format.strict !== true || !object(format.schema)) return fail('anthropic_source_invalid');
  const input = { system: source.instructions, messages: [{ role: 'user', content: [{ type: 'text', text: part.text }] }], thinking: { type: 'disabled' } };
  const body = JSON.stringify({ model, max_tokens: 2_048, ...input,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: anthropicSchema(format.schema) } } });
  const countBody = JSON.stringify({ model, ...input });
  const size = Buffer.byteLength(body, 'utf8');
  if (size > MAX_BODY_BYTES) return fail('anthropic_request_too_large');
  return Object.freeze({ model, context: request.context, body, sha256: sha256(body), countBody, maxInputTokens: size + 4_096, maxOutputTokens: 2_048 as const });
}
