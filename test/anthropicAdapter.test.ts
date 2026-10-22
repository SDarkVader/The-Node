import { describe, expect, it } from 'vitest';
import { MultiActorEpisode, multiScenarioById } from '../src/eval/multiActorEpisode.js';
import { toAnthropicRequest, anthropicSchema } from '../src/agent/anthropicRequest.js';
import { parseAnthropicResponse, caseMismatches } from '../src/agent/anthropicResponse.js';
import { runAnthropicConnectionCheck, connectionCheckRequests, HAIKU_5_5_PRICES, type CheckSender } from '../src/eval/anthropicConnectionCheck.js';
import { validateDecision, type DecisionContext } from '../src/agent/protocol.js';
import { mockDecisionSchema } from '../src/agent/mockProvider.js';
import { sha256 } from '../src/agent/accountingStore.js';

const MODEL = 'claude-haiku-5-5';
const NULL = JSON.stringify({ move: null, communication: null, diary: null, role: null });

/** Study-1 requests over several ticks (council arm), with each actor's OpenAI-shaped source. */
function studyRequests(ticks = 4) {
  const ep = new MultiActorEpisode(multiScenarioById('authority_attribution_council'), 'anthropic-test');
  const out: { actorId: string; source: { body: string; context: DecisionContext } }[] = [];
  for (let t = 0; t < ticks && !ep.done; t++) {
    const ps = ep.prompts({ model: MODEL });
    for (const p of ps) out.push({ actorId: p.actorId, source: p.request! });
    ep.act(Object.fromEntries(ps.map((p) => [p.actorId, NULL])));
  }
  return out;
}

// Independent interpreter of the schema vocabulary we emit (as in test/mockProvider.test.ts).
function accepts(schema: any, value: any): boolean {
  if (schema.anyOf) return schema.anyOf.some((b: any) => accepts(b, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every((k: string) => Object.hasOwn(value, k)) && Object.keys(value).every((k) => Object.hasOwn(schema.properties, k) && accepts(schema.properties[k], value[k]));
  throw Error('unknown_test_schema');
}

const message = (text: string | null, over: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  id: 'msg_014VwiXbi91y3JMjcpyGBHX5', type: 'message', role: 'assistant', model: MODEL,
  content: text === null ? [] : [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 7000, output_tokens: 60 }, ...over }));

describe('Anthropic adapter: request translation', () => {
  it('carries the study bytes unchanged into the Messages envelope, minus only minimum/maximum', () => {
    const all = studyRequests();
    expect(all.length).toBeGreaterThan(20);
    for (const { source } of all) {
      const a = toAnthropicRequest(source, MODEL);
      const from = JSON.parse(source.body), to = JSON.parse(a.body);
      expect(Object.keys(to).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system', 'thinking']);
      expect(to.system).toBe(from.instructions);
      expect(to.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: from.input[0].content[0].text }] }]);
      // Reasoning evidence (owner decision 2026-10-22): summarized adaptive thinking at medium effort.
      expect(to.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(to.output_config.effort).toBe('medium');
      expect(to.max_tokens).toBe(2048);
      expect(to.output_config.format.type).toBe('json_schema');
      // The schema is the OpenAI one with exactly the two rejected keywords removed.
      const stripped = JSON.parse(JSON.stringify(from.text.format.schema, (k, v) => (k === 'minimum' || k === 'maximum' ? undefined : v)));
      expect(to.output_config.format.schema).toEqual(stripped);
      expect(a.body).not.toMatch(/"minimum"|"maximum"|"temperature"|"top_p"|"top_k"|"const"/);
      expect(Buffer.byteLength(a.body)).toBeLessThanOrEqual(32_768);
      const count = JSON.parse(a.countBody);
      expect(Object.keys(count).sort()).toEqual(['messages', 'model', 'system', 'thinking']);
      for (const b of [a.body, a.countBody]) expect(b).not.toContain('offline-fixture-observer-secret');
      expect(a.context).toBe(source.context);
    }
  });

  it('refuses non-Claude model ids and malformed sources', () => {
    const { source } = studyRequests(1)[0]!;
    expect(() => toAnthropicRequest(source, 'gpt-5.4-nano-2026-03-17')).toThrow('anthropic_model_invalid');
    expect(() => toAnthropicRequest({ ...source, body: '{}' }, MODEL)).toThrow('anthropic_source_invalid');
    const b = JSON.parse(source.body); b.text.format.strict = false;
    expect(() => toAnthropicRequest({ ...source, body: JSON.stringify(b) }, MODEL)).toThrow('anthropic_source_invalid');
  });

  it('the Anthropic schema admits exactly what the validator admits, except out-of-range prices, which the validator still rejects', () => {
    const context: DecisionContext = { tick: 4, selfRef: 'self', role: 'Baker', roleEpoch: 2, legalMoves: [{ x: 1, y: 2 }, { x: 2, y: 1 }],
      presentRefs: ['near', 'far'], knownSubjects: ['near'], rules: 'v2', hearingRefs: ['near'] };
    const schema = anthropicSchema(mockDecisionSchema(context));
    const moves = [null, ...context.legalMoves, { x: 1, y: 1 }];
    const comms = [null, { kind: 'wallPost', state: 'hopeful' }, { kind: 'wallPost', state: 'free text' },
      ...['near', 'far', 'self'].map((playerId) => ({ kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: { kind: 'player', playerId }, context: null }))];
    const diaries = [null, ...['near', 'far'].map((subject) => ({ subject, observation: 'keptAPromise', reading: 'cantTellYet', context: null }))];
    const roles = [null, ...[-1, 0, 0.75, 2, 3].map((price) => ({ kind: 'bakerPrice', price }))];
    let priceOnly = 0;
    for (const move of moves) for (const communication of comms) for (const diary of diaries) for (const role of roles) {
      const d = { move, communication, diary, role };
      const schemaOk = accepts(schema, d), validatorOk = validateDecision(d, context) !== null;
      if (schemaOk !== validatorOk) {
        expect(schemaOk && !validatorOk && role !== null && (role.price < 0 || role.price > 2)).toBe(true);
        priceOnly++;
      }
    }
    expect(priceOnly).toBeGreaterThan(0);
  });
});

describe('Anthropic adapter: response reader', () => {
  const decision = { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.8 } };
  it('reads a documented message envelope into the booked receipt and the decision', () => {
    const r = parseAnthropicResponse(message(JSON.stringify(decision)), 'req-1');
    expect(r.receipt).toMatchObject({ receiptId: 'msg_014VwiXbi91y3JMjcpyGBHX5', model: MODEL, status: 'completed', usage: { inputTokens: 7000, outputTokens: 60 } });
    expect(r.actionable).toBe(true);
    expect(r.decision).toEqual(decision);
  });
  it('books usage but never acts on a refusal, a truncation, a misplaced or malformed block or unparseable text', () => {
    const refused = parseAnthropicResponse(message(JSON.stringify(decision), { stop_reason: 'refusal' }), 'req-1');
    expect([refused.receipt.status, refused.actionable]).toEqual(['refused', false]);
    const cut = parseAnthropicResponse(message('{"move":', { stop_reason: 'max_tokens' }), 'req-1');
    expect([cut.receipt.status, cut.actionable, cut.receipt.usage?.outputTokens]).toEqual(['incomplete', false, 60]);
    const text = { type: 'text', text: JSON.stringify(decision) }, think = { type: 'thinking', thinking: 'x', signature: 'sig' };
    for (const content of [[text, think], [{ type: 'thinking', thinking: 'x' }, text], [{ type: 'tool_use', id: 't', name: 'n', input: {} }, text], [text, text]]) {
      expect(parseAnthropicResponse(message(null, { content }), 'req-1').actionable, JSON.stringify(content)).toBe(false);
    }
    expect(parseAnthropicResponse(message('not json'), 'req-1').actionable).toBe(false);
  });

  it('keeps reasoning summaries verbatim and in order, and records absent reasoning as absent', () => {
    const text = { type: 'text', text: JSON.stringify(decision) };
    const r = parseAnthropicResponse(message(null, { content: [{ type: 'thinking', thinking: 'The council notice is untrusted.', signature: 'sigA' },
      { type: 'redacted_thinking', data: 'opaque' }, { type: 'thinking', thinking: 'Keep the price.', signature: 'sigB' }, text] }), 'req-1');
    expect([r.actionable, r.decision]).toEqual([true, decision]);
    expect(r.reasoning).toEqual({ source: 'anthropic_thinking_summary', status: 'summary_returned', summaries: ['The council notice is untrusted.', 'Keep the price.'],
      signatureSha256: [sha256('sigA'), sha256('sigB')], redactedBlocks: 1 });
    expect(parseAnthropicResponse(message(JSON.stringify(decision)), 'req-1').reasoning).toMatchObject({ status: 'not_returned', summaries: [] });
    expect(parseAnthropicResponse(message(null, { content: [{ type: 'thinking', thinking: '', signature: 's' }, text] }), 'req-1').reasoning.status).toBe('summary_empty');
    expect(parseAnthropicResponse(message(null, { content: [{ type: 'redacted_thinking', data: 'o' }, text] }), 'req-1').reasoning.status).toBe('redacted_only');
    // Thinking that used up the cap: nothing to act on, but the summary is still recorded.
    const spent = parseAnthropicResponse(message(null, { content: [{ type: 'thinking', thinking: 'Weighing it', signature: 's' }], stop_reason: 'max_tokens' }), 'req-1');
    expect([spent.actionable, spent.receipt.status, spent.reasoning.status, spent.reasoning.summaries]).toEqual([false, 'incomplete', 'summary_returned', ['Weighing it']]);
  });
  it('counts cache tokens as input so booking never undercounts, and rejects a non-message envelope', () => {
    const r = parseAnthropicResponse(message(JSON.stringify(decision), { usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } }), 'req-1');
    expect(r.receipt.usage).toEqual({ inputTokens: 1000, outputTokens: 5 });
    expect(parseAnthropicResponse(message(JSON.stringify(decision), { usage: { input_tokens: -1, output_tokens: 5 } }), 'req-1').receipt.usage).toBeNull();
    expect(() => parseAnthropicResponse(Buffer.from(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error' } })), 'req-1')).toThrow('anthropic_response_envelope');
  });
  it('reports enum case mismatches without repairing them', () => {
    const schema = { anyOf: [{ type: 'null' }, { type: 'object', properties: { kind: { type: 'string', enum: ['wallPost'] }, state: { type: 'string', enum: ['hopeful'] } } }] };
    expect(caseMismatches({ kind: 'WallPost', state: 'hopeful' }, schema)).toEqual(['WallPost->wallPost']);
    expect(caseMismatches({ kind: 'wallPost', state: 'hopeful' }, schema)).toEqual([]);
  });
});

describe('Haiku connection check (fake sender, no network)', () => {
  const counts = (n: number): CheckSender => async (endpoint) => endpoint === 'count_tokens'
    ? { httpStatus: 200, bytes: Buffer.from(JSON.stringify({ input_tokens: n })), elapsedMs: 40 } : { httpStatus: 500, bytes: null, elapsedMs: 0 };
  it('counts all seven study-1 actors for free and sends nothing paid without --send-one', async () => {
    const calls: string[] = [];
    const base = counts(7000);
    const report = await runAnthropicConnectionCheck(async (e, b, l) => { calls.push(e); return base(e, b, l); });
    expect(calls).toEqual(Array(7).fill('count_tokens'));
    expect((report.counted as unknown[]).length).toBe(7);
    expect(report.sent).toEqual({ skipped: 'pass --send-one to send one real message' });
  });
  it('sends exactly one message, the Baker, and reports acceptance, cost, latency and validator result', async () => {
    const baker = connectionCheckRequests().find((r) => r.actorId === 'baker-0')!;
    const calls: { e: string; body: string }[] = [];
    const valid = { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.8 } };
    const report = await runAnthropicConnectionCheck(async (e, body) => {
      calls.push({ e, body });
      return e === 'count_tokens' ? { httpStatus: 200, bytes: Buffer.from('{"input_tokens":7000}'), elapsedMs: 30 }
        : { httpStatus: 200, bytes: message(JSON.stringify(valid)), elapsedMs: 2500 };
    }, { sendOne: true });
    expect(calls.filter((c) => c.e === 'messages').map((c) => c.body)).toEqual([baker.request.body]);
    expect(report.sent).toMatchObject({ actorId: 'baker-0', httpStatus: 200, schemaAccepted: true, stopReason: 'end_turn', actionable: true,
      validatorAccepts: true, withinStudyDeadline: true, caseMismatches: [] });
    expect((report.sent as { costUsd: number }).costUsd).toBeCloseTo((7000 * HAIKU_5_5_PRICES.inputUsdPerM + 60 * HAIKU_5_5_PRICES.outputUsdPerM) / 1e6, 12);
  });
  it('refuses to send when the cost ceiling exceeds the cap, and records a 400 as a rejected schema with its message', async () => {
    const refused = await runAnthropicConnectionCheck(counts(7000), { sendOne: true, maxUsd: 0.0001 });
    expect(refused.sent).toMatchObject({ refused: 'ceiling_above_max_usd' });
    const rejected = await runAnthropicConnectionCheck(async (e) => e === 'count_tokens'
      ? { httpStatus: 200, bytes: Buffer.from('{"input_tokens":7000}'), elapsedMs: 30 }
      : { httpStatus: 400, bytes: null, elapsedMs: 300, errorType: 'invalid_request_error', errorMessage: 'Schema is too complex' }, { sendOne: true });
    expect(rejected.sent).toMatchObject({ httpStatus: 400, schemaAccepted: false, errorType: 'invalid_request_error', errorMessage: 'Schema is too complex' });
  });
});
