import { TextDecoder } from 'node:util';
import { sha256, failAccounting as fail } from './accountingStore.js';
import type { AccountingReceipt } from './accountingLedger.js';

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);

export interface RecordedResponse {
  receipt: AccountingReceipt;
  decision: unknown;
  actionable: boolean;
}

/** Pure archive reader for the documented Responses-shaped JSON envelope. No SDK, client, endpoint or credentials.
 * Compatibility with today's provider service is deliberately not inferred from a local archive test.
 * Usage is extracted independently of action text, refusal, tools, truncation and completion status.
 */
export function parseRecordedResponse(bytes: Buffer, requestId: string): RecordedResponse {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 262_144 || !id(requestId)) return fail('recorded_response_bounds');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('recorded_response_encoding'); }
  if (!object(value) || value.object !== 'response' || !id(value.id) || !id(value.model) ||
    !['completed', 'incomplete', 'failed', 'cancelled'].includes(String(value.status))) return fail('recorded_response_envelope');
  let usage: AccountingReceipt['usage'] = null;
  const u = value.usage;
  if (object(u) && integer(u.input_tokens) && integer(u.output_tokens) && integer(u.total_tokens) &&
    BigInt(u.input_tokens) + BigInt(u.output_tokens) === BigInt(u.total_tokens) &&
    (u.input_tokens_details === undefined || object(u.input_tokens_details) && integer(u.input_tokens_details.cached_tokens) && u.input_tokens_details.cached_tokens <= u.input_tokens) &&
    (u.output_tokens_details === undefined || object(u.output_tokens_details) && integer(u.output_tokens_details.reasoning_tokens) && u.output_tokens_details.reasoning_tokens <= u.output_tokens)) {
    usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
  }
  let decision: unknown = null, actionable = false, refused = false;
  if (Array.isArray(value.output)) {
    const messages = value.output.filter(item => object(item) && item.type === 'message');
    // Stateless responses may include content: [] plus opaque encrypted metadata.
    // Neither is policy input; continue rejecting nonempty/plaintext reasoning.
    const unsupported = value.output.some(item => !object(item) || !['message', 'reasoning'].includes(String(item.type)) ||
      item.type === 'reasoning' && (!Array.isArray(item.summary) || item.summary.length !== 0 ||
        Object.hasOwn(item, 'content') && (!Array.isArray(item.content) || item.content.length !== 0)));
    const message = messages[0];
    if (messages.length === 1 && object(message) && message.role === 'assistant' && message.status === 'completed' && Array.isArray(message.content)) {
      refused = message.content.some(part => object(part) && part.type === 'refusal');
      const part = message.content[0];
      if (!unsupported && !refused && message.content.length === 1 && object(part) && part.type === 'output_text' &&
        typeof part.text === 'string' && Buffer.byteLength(part.text) <= 32_768 &&
        (!Object.hasOwn(part, 'annotations') || Array.isArray(part.annotations) && part.annotations.length === 0)) {
        try { decision = JSON.parse(part.text); actionable = value.status === 'completed' && value.error == null && value.incomplete_details == null; } catch { /* Usage is still accounted. */ }
      }
    }
  }
  return { receipt: { receiptId: value.id, requestId, sourceSha256: sha256(bytes), model: value.model,
    status: refused ? 'refused' : value.status === 'cancelled' ? 'failed' : value.status as AccountingReceipt['status'], usage }, decision, actionable };
}
