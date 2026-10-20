import { afterEach, describe, expect, it } from 'vitest';
import { buildResponsesRequest, isResponsesRequest } from '../src/agent/responsesRequest.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { participant, cleanupResponses } from './fixtures/responsesFixture.js';
afterEach(cleanupResponses);

describe('final OpenAI Responses wire request', () => {
  it('builds the actual strict schema body with fixed bounds and no tools, state linkage or truncation', () => {
    const p = participant(), r = p.request, b = JSON.parse(r.body);
    expect(b).toMatchObject({ model: 'archived-test-model', text: { format: { type: 'json_schema', name: 'node_inhabitant_v1', strict: true } },
      reasoning: { effort: 'low' }, store: false, stream: false, background: false, service_tier: 'default', tools: [], tool_choice: 'none', truncation: 'disabled', max_output_tokens: 2048 });
    expect(Object.keys(b).sort()).toEqual(['model', 'instructions', 'input', 'text', 'reasoning', 'service_tier', 'store', 'stream', 'background', 'tools', 'tool_choice', 'truncation', 'max_output_tokens'].sort());
    expect(b.text.format.schema.required).toEqual(['move', 'communication', 'diary', 'role']);
    expect(r.sha256).toBe(sha256(r.body)); expect(r.maxInputTokens).toBe(Buffer.byteLength(r.body) + 4096);
    expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(32_768);
  });
  it('includes the entire authorized projection and leaves the next world evidence unchanged', () => {
    const p = participant(), before = p.host.evidence(), projected = JSON.parse(JSON.parse(p.request.body).input[0].content[0].text);
    expect(projected).toEqual(p.observation.projection); expect(p.host.evidence()).toBe(before);
    for (const secret of [p.session, p.observation.observationId, p.genesis.observerSecret, 'wire-fixture-controller-token']) expect(p.request.body).not.toContain(secret);
  });
  it('whitelists nested producer fields so future evaluator/secret properties are never serialized', () => {
    const p = participant(), o = structuredClone(p.observation) as any;
    o.apiKey = 'excluded-secret'; o.context.apiKey = 'excluded-secret'; o.projection.World = 'excluded-secret';
    o.projection.self.apiKey = 'excluded-secret'; o.projection.city.people[0].assets = 'excluded-secret';
    o.projection.geometry.districts[0].seed = 'excluded-secret'; o.projection.geometry.districts[0].plots[0].campaign = 'excluded-secret';
    const r = buildResponsesRequest(o, 'archived-test-model'); expect(r.body).not.toContain('excluded-secret'); expect(r.body).toBe(p.request.body);
  });
  it('pins the request and context, rejects serialized lookalikes and detaches from the original observation', () => {
    const p = participant(), r = p.request;
    expect(isResponsesRequest(r)).toBe(true); expect(isResponsesRequest({ ...r })).toBe(false);
    expect(() => { (r.context as any).tick = 99; }).toThrow(); expect(() => { (r as any).body = '{}'; }).toThrow();
    p.observation.context.tick = 99; p.observation.projection.self.wealth = 999; expect(r.context.tick).toBe(0); expect(r.body).not.toContain('"wealth":999');
  });
  it.each(['', 'bad\r\nHeader:value', 'https://arbitrary-host', 'x'.repeat(129)])('rejects invalid model %j', model => {
    expect(() => buildResponsesRequest(participant().observation, model)).toThrow('responses_model_invalid');
  });
  it('rejects substituted observation authority and oversized body without pruning information', () => {
    const p = participant(), mismatch = structuredClone(p.observation); mismatch.projection.self.ref = 'different';
    expect(() => buildResponsesRequest(mismatch, 'archived-test-model')).toThrow('responses_observation_mismatch');
    const large = structuredClone(p.observation); large.projection.diary = Array.from({ length: 500 }, () => ({ subject: 's'.repeat(64), observation: 'keptAPromise', reading: 'cantTellYet', context: null })) as any;
    expect(() => buildResponsesRequest(large, 'archived-test-model')).toThrow('responses_request_too_large');
  });
});
