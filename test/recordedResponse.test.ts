import { afterEach, describe, expect, it } from 'vitest';
import { parseRecordedResponse } from '../src/agent/recordedResponse.js';
import { response, cleanup } from './fixtures/accountingFixture.js';
afterEach(cleanup);
const parse = (overrides: Record<string, unknown> = {}) => parseRecordedResponse(response(overrides), 'test-request');

describe('recorded Responses-shaped envelopes without a provider call', () => {
  it('extracts bounded action and separate usage including reasoning tokens without a cached discount', () => {
    expect(parse()).toMatchObject({ actionable: true, decision: { move: null, role: null }, receipt: {
      receiptId: 'resp_test', requestId: 'test-request', model: 'archived-test-model', status: 'completed', usage: { inputTokens: 10, outputTokens: 10 } } });
  });
  it.each(['incomplete', 'failed', 'cancelled'])('retains usage while rejecting %s actions', status => {
    expect(parse({ status })).toMatchObject({ actionable: false, receipt: { usage: { inputTokens: 10, outputTokens: 10 } } });
  });
  it('retains usage when output text is malformed JSON', () => {
    const value = JSON.parse(response().toString()); value.output[0].content[0].text = 'not JSON';
    const parsed = parseRecordedResponse(Buffer.from(JSON.stringify(value)), 'test-request');
    expect(parsed.actionable).toBe(false); expect(parsed.receipt.usage?.outputTokens).toBe(10);
  });
  it('records refusal separately without interpreting refusal text as a decision', () => {
    expect(parse({ output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: 'private refusal text' }] }] }))
      .toMatchObject({ actionable: false, decision: null, receipt: { status: 'refused', usage: { inputTokens: 10, outputTokens: 10 } } });
  });
  it.each([
    { input_tokens: -1, output_tokens: 10, total_tokens: 9 },
    { input_tokens: 10, output_tokens: 10, total_tokens: 19 },
    { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 11 } },
    { input_tokens: 10, output_tokens: 10, total_tokens: 20, output_tokens_details: { reasoning_tokens: 11 } },
    { input_tokens: 0.5, output_tokens: 10, total_tokens: 10.5 }, null,
  ])('keeps unknown/invalid usage unknown: %j', usage => { expect(parse({ usage }).receipt.usage).toBeNull(); });
  it.each([
    { output: [] }, { output: [{ type: 'function_call', name: 'do_anything' }] },
    { output: [{ type: 'reasoning', summary: [{ text: 'hidden reasoning' }] }] },
    { error: { code: 'provider_error', message: 'not logged' } }, { incomplete_details: { reason: 'max_output_tokens' } },
  ])('rejects unusable output but retains accounting %j', overrides => {
    expect(parse(overrides)).toMatchObject({ actionable: false, receipt: { usage: { inputTokens: 10, outputTokens: 10 } } });
  });
  it('accepts empty reasoning metadata but never returns provider metadata or reasoning text to policy', () => {
    const value = JSON.parse(response().toString()); value.output.unshift({ type: 'reasoning', id: 'reasoning_id', summary: [] }); value.metadata = { secret: 'not copied' };
    const parsed = parseRecordedResponse(Buffer.from(JSON.stringify(value)), 'test-request');
    expect(parsed.actionable).toBe(true); expect(JSON.stringify(parsed)).not.toContain('not copied'); expect(JSON.stringify(parsed)).not.toContain('reasoning_id');
  });
  it('rejects multiple messages, annotated or multiple text fragments while preserving known usage', () => {
    for (const mutate of [(v: any) => v.output.push(v.output[0]), (v: any) => v.output[0].content.push(v.output[0].content[0]),
      (v: any) => v.output[0].content[0].annotations.push({ type: 'url_citation' })]) {
      const v = JSON.parse(response().toString()); mutate(v); const p = parseRecordedResponse(Buffer.from(JSON.stringify(v)), 'test-request');
      expect(p.actionable).toBe(false); expect(p.receipt.usage?.inputTokens).toBe(10);
    }
  });
  it('rejects corrupt UTF-8, malformed JSON, oversize bytes, unknown status and wrong object', () => {
    for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), Buffer.alloc(262_145), response({ status: 'mystery' }), response({ object: 'completion' })])
      expect(() => parseRecordedResponse(bytes, 'test-request')).toThrow();
  });
});
