/**
 * Anthropic Messages adapter, response side: a pure reader of an archived Messages response, into
 * the same `RecordedResponse` the accounted runner books (receipt first, decision second). No
 * client, endpoint or credential.
 *
 * Envelope per the Anthropic docs (batch-processing results, structured outputs, read 2026-10-22):
 * `{id:'msg_…', type:'message', role:'assistant', model, content:[{type:'text', text}],
 *   stop_reason, stop_sequence, usage:{input_tokens, output_tokens, cache_*_input_tokens?}}`.
 * - Usage is extracted independently of content. Cache read/creation tokens, if any, are added to
 *   input tokens, so booking never undercounts.
 * - Only `end_turn` with exactly one text block, last, is actionable; before it may come only
 *   well-formed `thinking` / `redacted_thinking` blocks. `refusal` is booked as refused;
 *   `max_tokens` and any other stop reason are incomplete. A tool or other block is not actionable.
 * - Reasoning evidence is read whether or not the response is actionable: each thinking block's
 *   text verbatim, in order (a provider-written summary, never the raw chain of thought), the
 *   sha256 of its opaque signature, and how many blocks were redacted. Absent reasoning is
 *   recorded as absent (`not_returned`), never filled in.
 * - Enum capitalisation is not normalised. Anthropic documents that enum values may come back in
 *   another case, and the validator then rejects the decision. That is recorded, not repaired.
 */
import { TextDecoder } from 'node:util';
import { sha256, failAccounting as fail } from './accountingStore.js';
import type { AccountingReceipt } from './accountingLedger.js';
import type { RecordedResponse } from './recordedResponse.js';

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);

/** What came back about the model's reasoning. `summary_empty`: thinking blocks with empty text
 *  (display omitted); `redacted_only`: only redacted blocks; `not_returned`: the model did not think. */
export type ReasoningStatus = 'summary_returned' | 'summary_empty' | 'redacted_only' | 'not_returned';
export interface ReasoningEvidence {
  source: 'anthropic_thinking_summary';
  status: ReasoningStatus;
  summaries: string[];
  signatureSha256: string[];
  redactedBlocks: number;
}
export interface AnthropicRecorded extends RecordedResponse { stopReason: string | null; reasoning: ReasoningEvidence }

const isThinking = (b: unknown): b is { type: 'thinking'; thinking: string; signature: string } =>
  object(b) && b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string';
const isRedacted = (b: unknown) => object(b) && b.type === 'redacted_thinking' && typeof b.data === 'string';

function readReasoning(content: unknown[]): ReasoningEvidence {
  const thinking = content.filter(isThinking), redactedBlocks = content.filter(isRedacted).length;
  const summaries = thinking.map((b) => b.thinking);
  const status: ReasoningStatus = summaries.some((t) => t.length > 0) ? 'summary_returned' : thinking.length ? 'summary_empty'
    : redactedBlocks ? 'redacted_only' : 'not_returned';
  return { source: 'anthropic_thinking_summary', status, summaries, signatureSha256: thinking.map((b) => sha256(b.signature)), redactedBlocks };
}

export function parseAnthropicResponse(bytes: Buffer, requestId: string): AnthropicRecorded {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 262_144 || !id(requestId)) return fail('anthropic_response_bounds');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('anthropic_response_encoding'); }
  if (!object(value) || value.type !== 'message' || value.role !== 'assistant' || !id(value.id) || !id(value.model)) return fail('anthropic_response_envelope');
  let usage: AccountingReceipt['usage'] = null;
  const u = value.usage;
  const extra = (k: string) => (object(u) && u[k] !== undefined && u[k] !== null ? u[k] : 0);
  if (object(u) && integer(u.input_tokens) && integer(u.output_tokens) && integer(extra('cache_creation_input_tokens')) && integer(extra('cache_read_input_tokens'))) {
    usage = { inputTokens: u.input_tokens + (extra('cache_creation_input_tokens') as number) + (extra('cache_read_input_tokens') as number), outputTokens: u.output_tokens };
  }
  const stopReason = typeof value.stop_reason === 'string' ? value.stop_reason : null;
  let decision: unknown = null, actionable = false;
  const content: unknown[] = Array.isArray(value.content) ? value.content : [];
  const part = content.at(-1);
  if (stopReason === 'end_turn' && content.slice(0, -1).every((b) => isThinking(b) || isRedacted(b)) &&
    object(part) && part.type === 'text' && typeof part.text === 'string' && Buffer.byteLength(part.text) <= 32_768) {
    try { decision = JSON.parse(part.text); actionable = true; } catch { /* Usage is still booked. */ }
  }
  const status: AccountingReceipt['status'] = stopReason === 'refusal' ? 'refused' : stopReason === 'end_turn' ? 'completed' : 'incomplete';
  return { receipt: { receiptId: value.id, requestId, sourceSha256: sha256(bytes), model: value.model, status, usage }, decision, actionable, stopReason,
    reasoning: readReasoning(content) };
}

/** Where a decision differs from an enum value only by case (reported by the connection check). */
export function caseMismatches(decision: unknown, schema: unknown): string[] {
  const values = new Set<string>();
  const collect = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(collect); return; }
    if (!object(n)) return;
    if (Array.isArray(n.enum)) for (const v of n.enum) if (typeof v === 'string') values.add(v);
    Object.values(n).forEach(collect);
  };
  collect(schema);
  const lower = new Map([...values].map((v) => [v.toLowerCase(), v]));
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string' && !values.has(n) && lower.has(n.toLowerCase())) found.push(`${n}->${lower.get(n.toLowerCase())}`);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (object(n)) Object.values(n).forEach(walk);
  };
  walk(decision);
  return found;
}
