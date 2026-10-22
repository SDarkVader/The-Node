import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { buildMockProviderRequest, createMockProviderFixture, mockDecisionSchema } from '../src/agent/mockProvider.js';
import { OfflineBroker, assertLiveAdmission, RECOVERY_HOLD } from '../src/agent/broker.js';
import { validateDecision, type DecisionContext } from '../src/agent/protocol.js';
import { OfflineParticipantHost } from '../src/agent/host.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { replay, evidenceHash } from '../src/agent/replay.js';

const idle = () => ({ move: null, communication: null, diary: null, role: null });
const context = (): DecisionContext => ({
  tick: 4, selfRef: 'self', role: 'Baker', roleEpoch: 2,
  legalMoves: [{ x: 1, y: 2 }, { x: 2, y: 1 }], presentRefs: ['present', 'self'], knownSubjects: ['known', 'self'],
});
const completion = (decision: unknown = idle()) => ({
  status: 'completed', model: 'offline-fixture', usage: { inputTokens: 100, outputTokens: 40 }, decision,
});
const response = (value: unknown = completion(), status = 200) => ({ status, body: Readable.from([JSON.stringify(value)]) });
const signal = () => new AbortController().signal;

// Independent interpreter of the small contract-schema vocabulary, not production validation.
function accepts(schema: any, value: any): boolean {
  if (schema.anyOf) return schema.anyOf.some((branch: any) => accepts(branch, value));
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every((key: string) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && accepts(schema.properties[key], value[key]));
  throw Error('unknown_test_schema');
}

describe('offline provider contract and dynamic affordances', () => {
  it('projects only the unchanged core context and freezes a detached request', () => {
    const input = Object.assign(context(), { controllerToken: 'private-controller', observationId: 'private-observation', world: { seed: 17 } });
    const request = buildMockProviderRequest(input);
    expect(Object.keys(request.input).sort()).toEqual(Object.keys(context()).sort());
    expect(JSON.stringify(request)).not.toMatch(/private-controller|private-observation|"world"|"seed"/);
    expect(Object.isFrozen(request.input.legalMoves[0])).toBe(true);
    input.legalMoves[0]!.x = 999;
    expect(request.input.legalMoves[0]!.x).toBe(1);
  });

  it('matches the core validator over legitimate and adversarial action combinations', () => {
    const input = context();
    const schema = mockDecisionSchema(input);
    const moves = [null, ...input.legalMoves, { x: 1, y: 1 }, { x: 1, y: 2, hidden: true }];
    const communications = [null, { kind: 'wallPost', state: 'hopeful' }, { kind: 'wallPost', state: 'free text' },
      ...['present', 'absent', 'self'].map(playerId => ({ kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: { kind: 'player', playerId }, context: null })),
      { kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: { kind: 'room' }, context: 'myPrice' }];
    const diaries = [null, ...['known', 'absent', 'self'].map(subject => ({ subject, observation: 'keptAPromise', reading: 'cantTellYet', context: null }))];
    const roles = [null, ...[-1, 0, 0.75, 2, 3].map(price => ({ kind: 'bakerPrice', price }))];
    for (const roleName of ['Baker', 'Driver', 'Grifter']) {
      input.role = roleName;
      const currentSchema = roleName === 'Baker' ? schema : mockDecisionSchema(input);
      for (const move of moves) for (const communication of communications) for (const diary of diaries) for (const role of roles) {
        const decision = { move, communication, diary, role };
        expect(accepts(currentSchema, decision)).toBe(validateDecision(decision, input) !== null);
      }
    }
    expect(accepts(schema, { ...idle(), extra: 'author' })).toBe(false);
    expect(accepts(schema, { move: null, communication: null, role: null })).toBe(false);
  });

  it('never emits const: every fixed value is a one-value typed enum (OpenAI and Google document no const)', async () => {
    const { MultiActorEpisode, multiScenarioById } = await import('../src/eval/multiActorEpisode.js');
    const fixedValues: unknown[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      expect(Object.hasOwn(o, 'const')).toBe(false);
      if (Array.isArray(o.enum) && o.enum.length === 1) { expect(o.type).toBe(typeof o.enum[0]); fixedValues.push(o.enum[0]); }
      Object.values(o).forEach(walk);
    };
    walk(mockDecisionSchema(context()));
    expect(fixedValues).toEqual(expect.arrayContaining(['room', 'player', 'wallPost', 'proximityUtterance', 'bakerPrice', 1, 2]));
    // The bytes a live model would receive, on the study-1 baseline (v2): no const anywhere.
    const ep = new MultiActorEpisode(multiScenarioById('authority_attribution_council'), 'no-const');
    for (const p of ep.prompts({ model: 'gpt-5.4-nano-2026-03-17' })) {
      const body = JSON.parse(p.request!.body) as { text: { format: { schema: unknown } } };
      expect(JSON.stringify(body.text.format.schema)).not.toContain('"const"');
      walk(body.text.format.schema);
    }
  });

  it('handles empty and duplicate affordances without empty enums or ambiguous coordinate branches', () => {
    const input = context(); input.legalMoves = [...input.legalMoves, { x: 1, y: 2 }]; input.presentRefs = []; input.knownSubjects = [];
    const schema = mockDecisionSchema(input);
    expect(accepts(schema, { ...idle(), move: { x: 1, y: 2 } })).toBe(true);
    expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    input.legalMoves = [];
    expect(accepts(mockDecisionSchema(input), idle())).toBe(true);
    expect(accepts(mockDecisionSchema(input), { ...idle(), move: { x: 1, y: 2 } })).toBe(false);
  });

  it('rebuilds exact paired coordinates, role authority and reference lists for each observation', () => {
    const first = buildMockProviderRequest(context());
    const next = context(); next.tick++; next.role = 'Grifter'; next.legalMoves = [{ x: 7, y: 8 }]; next.presentRefs = ['new-present'];
    const second = buildMockProviderRequest(next);
    expect(accepts(first.decisionSchema, { ...idle(), move: { x: 1, y: 2 }, role: { kind: 'bakerPrice', price: 1 } })).toBe(true);
    expect(accepts(second.decisionSchema, { ...idle(), move: { x: 1, y: 2 } })).toBe(false);
    expect(accepts(second.decisionSchema, { ...idle(), role: { kind: 'bakerPrice', price: 1 } })).toBe(false);
    expect(JSON.stringify(second.decisionSchema)).not.toContain('"present"');
  });

  it('bounds the entire serialized request before calling the transport', async () => {
    let calls = 0;
    const fixture = createMockProviderFixture(() => { calls++; return response(); });
    const input = context(); input.knownSubjects = ['x'.repeat(32_768)];
    await expect(fixture(input, signal())).rejects.toThrow('mock_request_invalid');
    expect(calls).toBe(0);
  });

  it('returns a core-compatible response from bounded split UTF-8 chunks', async () => {
    const bytes = Buffer.from(JSON.stringify(completion({ ...idle(), role: { kind: 'bakerPrice', price: 0.75 } })));
    const fixture = createMockProviderFixture(() => ({ status: 200, body: Readable.from([bytes.subarray(0, 9), bytes.subarray(9)]) }));
    const core = new OfflineBroker();
    expect(await core.evaluate(context(), fixture, context)).toMatchObject({ kind: 'validated_offline', decision: { role: { price: 0.75 } } });
  });
});

describe('mock completion containment', () => {
  it.each([401, 403, 429, 500])('rejects status %i, destroys its body and never exposes its text', async status => {
    const result = response({ message: 'private-provider-error-contents' }, status);
    const fixture = createMockProviderFixture(() => result);
    await expect(fixture(context(), signal())).rejects.toThrow(/^mock_response_rejected$/);
    expect(result.body.destroyed).toBe(true);
  });

  it.each([
    ['missing usage', { status: 'completed', model: 'offline-fixture', decision: idle() }, 'mock_completion_invalid'],
    ['wrong model', { ...completion(), model: 'another-model' }, 'mock_completion_invalid'],
    ['incomplete', { ...completion(), status: 'incomplete' }, 'mock_completion_invalid'],
    ['refusal', { ...completion(), status: 'refused' }, 'mock_completion_invalid'],
    ['extra envelope', { ...completion(), reasoning: 'private text' }, 'mock_completion_invalid'],
    ['negative usage', { ...completion(), usage: { inputTokens: -1, outputTokens: 2 } }, 'mock_usage_invalid'],
    ['excessive output', { ...completion(), usage: { inputTokens: 1, outputTokens: 2049 } }, 'mock_usage_invalid'],
    ['excessive input', { ...completion(), usage: { inputTokens: 36_865, outputTokens: 2 } }, 'mock_usage_invalid'],
    ['fractional usage', { ...completion(), usage: { inputTokens: 1.5, outputTokens: 2 } }, 'mock_usage_invalid'],
    ['extra usage', { ...completion(), usage: { inputTokens: 1, outputTokens: 2, cached: 1 } }, 'mock_completion_invalid'],
    ['illegal price', completion({ ...idle(), role: { kind: 'bakerPrice', price: 3 } }), 'mock_decision_invalid'],
    ['foreign reference', completion({ ...idle(), diary: { subject: 'absent', observation: 'keptAPromise', reading: 'cantTellYet', context: null } }), 'mock_decision_invalid'],
  ])('rejects %s without a permissive fallback', async (_name, value, code) => {
    const fixture = createMockProviderFixture(() => response(value));
    await expect(fixture(context(), signal())).rejects.toThrow(code as string);
  });

  it('rejects malformed and oversized streamed JSON', async () => {
    const malformed = createMockProviderFixture(() => ({ status: 200, body: Readable.from(['{invalid']) }));
    await expect(malformed(context(), signal())).rejects.toThrow('mock_response_rejected');
    const oversized = createMockProviderFixture(() => response(), { maxResponseBytes: 32 });
    await expect(oversized(context(), signal())).rejects.toThrow('mock_response_rejected');
  });

  it('times out a stalled body and releases the fixture for a later direct test', async () => {
    const body = new Readable({ read() {} }); let calls = 0;
    const fixture = createMockProviderFixture(() => ++calls === 1 ? { status: 200, body } : response(), { deadlineMs: 10 });
    await expect(fixture(context(), signal())).rejects.toThrow('mock_response_timeout');
    expect(body.destroyed).toBe(true);
    expect((await fixture(context(), signal())).status).toBe('completed');
  });

  it('rejects early stream closure and asynchronous destroy errors safely', async () => {
    const body = new Readable({ read() { this.destroy(); } });
    await expect(createMockProviderFixture(() => ({ status: 200, body }))(context(), signal())).rejects.toThrow('mock_response_rejected');
    const failing = new Readable({ read() {}, destroy(_error, callback) { setImmediate(() => callback(Error('private destruction detail'))); } });
    await expect(createMockProviderFixture(() => ({ status: 401, body: failing }))(context(), signal())).rejects.toThrow(/^mock_response_rejected$/);
    await new Promise(resolve => setImmediate(resolve));
  });

  it('honors cancellation before dispatch and during a stream', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    const fixture = createMockProviderFixture(() => { calls++; return response(); });
    await expect(fixture(context(), controller.signal)).rejects.toThrow('mock_provider_aborted'); expect(calls).toBe(0);
    const body = new Readable({ read() {} }); const active = new AbortController();
    const pending = createMockProviderFixture(() => ({ status: 200, body }))(context(), active.signal);
    active.abort(); await expect(pending).rejects.toThrow('mock_provider_aborted'); expect(body.destroyed).toBe(true);
  });

  it('rejects overlapping use of a shared mock fixture', async () => {
    const body = new Readable({ read() {} }); const controller = new AbortController();
    const fixture = createMockProviderFixture(() => ({ status: 200, body }));
    const pending = fixture(context(), controller.signal);
    await expect(fixture(context(), signal())).rejects.toThrow('mock_provider_busy');
    controller.abort(); await expect(pending).rejects.toThrow('mock_provider_aborted');
  });

  it('sanitizes transport exceptions and closes invalid response bodies', async () => {
    await expect(createMockProviderFixture(() => { throw Error('private credential detail'); })(context(), signal())).rejects.toThrow(/^mock_transport_failed$/);
    const invalid = { ...response(), headers: 'not part of the mock contract' };
    await expect(createMockProviderFixture(() => invalid)(context(), signal())).rejects.toThrow('mock_transport_invalid');
    expect(invalid.body.destroyed).toBe(true);
  });

  it('refuses widened limits and preserves the unchanged live gate and historical reminder', () => {
    expect(() => createMockProviderFixture(() => response(), { maxResponseBytes: 262_145 })).toThrow('mock_limits_invalid');
    expect(() => createMockProviderFixture(() => response(), { deadlineMs: 12_001 })).toThrow('mock_limits_invalid');
    expect(() => assertLiveAdmission()).toThrow('recovery_accounting_unresolved');
    expect(RECOVERY_HOLD.originalReservationMicroUsd).toBe(19_114);
    expect(RECOVERY_HOLD.accountingReconciled).toBe(false);
  });
});

describe('real participant host with the offline mock adapter', () => {
  function setup() {
    const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
    const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!;
    const host = new OfflineParticipantHost(genesis, person.id, 'offline-mock-controller-fixture');
    const session = host.authenticate('offline-mock-controller-fixture');
    return { host, session, genesis };
  }

  it('admits actual own-price effects and verifies complete replay across two ticks', async () => {
    const { host, session, genesis } = setup();
    try {
      let calls = 0;
      const fixture = createMockProviderFixture(request => {
        calls++; expect(JSON.stringify(request)).not.toMatch(/offline-mock-controller-fixture|observerSecret|observationId/);
        return response(completion({ ...idle(), role: { kind: 'bakerPrice', price: calls === 1 ? 0.75 : 0.8 } }));
      });
      for (let index = 0; index < 2; index++) {
        expect((await host.evaluateFixture(session, fixture)).kind).toBe('validated_offline');
        expect(host.advance().some(effect => effect.category === 'bakerPrice')).toBe(true);
      }
      const tape = host.exportTape();
      expect(tape.ticks).toHaveLength(2);
      const rebuilt = replay(tape, genesis.sourceRevision);
      expect(evidenceHash(rebuilt)).toBe(host.evidence());
      const bound = rebuilt.registry.people.get(tape.ticks[0]!.actions[0]!.person)!;
      expect(rebuilt.world.bakers.find(baker => baker.buildingId === bound.location)!.value).toBe(0.8);
      expect(calls).toBe(2);
    } finally { host.close(); }
  });

  it('rejects a response after tick advancement without retargeting its action', async () => {
    const { host, session } = setup();
    const body = new Readable({ read() {} });
    try {
      const pending = host.evaluateFixture(session, createMockProviderFixture(() => ({ status: 200, body })));
      host.advance();
      body.push(JSON.stringify(completion({ ...idle(), role: { kind: 'bakerPrice', price: 0.75 } }))); body.push(null);
      expect(await pending).toEqual({ kind: 'rejected', code: 'stale_context' });
      host.advance();
      expect(host.exportTape().ticks.every(tick => tick.actions.length === 0)).toBe(true);
    } finally { host.close(); }
  });

  it('does not retry a rejected mock completion for the same person and tick', async () => {
    const { host, session } = setup(); let calls = 0;
    const fixture = createMockProviderFixture(() => { calls++; return response({}, 401); });
    try {
      expect(await host.evaluateFixture(session, fixture)).toEqual({ kind: 'rejected', code: 'fixture_failure' });
      expect(await host.evaluateFixture(session, fixture)).toEqual({ kind: 'rejected', code: 'fixture_halted' });
      host.advance(); expect(host.exportTape().ticks[0]!.actions).toHaveLength(0); expect(calls).toBe(1);
    } finally { host.close(); }
  });
});
