import { Readable } from 'node:stream';
import { SELF_STATES } from '../comms/grammar.js';
import { INTENTS, TONES, CONTEXT_TAGS as SPEECH_CONTEXTS } from '../comms/proximityConversation.js';
import { OBSERVATIONS, READINGS, CONTEXT_TAGS as DIARY_CONTEXTS } from '../engine/diary.js';
import { policyInput, validateDecision, type DecisionContext } from './protocol.js';
import { readBoundedJson, BodyError } from './httpBody.js';
import type { FixtureResponse } from './broker.js';

type Schema = Record<string, unknown>;
const nullSchema = () => ({ type: 'null' });
const objectSchema = (properties: Record<string, Schema>): Schema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const strings = (values: readonly string[]): Schema => ({ type: 'string', enum: [...new Set(values)] });
const nullable = (...alternatives: Schema[]): Schema => alternatives.length
  ? { anyOf: [nullSchema(), ...alternatives] } : nullSchema();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** Contract schema for in-memory fixtures. Not an assertion of provider API compatibility. */
export function mockDecisionSchema(context: DecisionContext): Schema {
  const input = policyInput(context);
  const present = input.presentRefs.filter(ref => ref !== input.selfRef);
  const known = input.knownSubjects.filter(ref => ref !== input.selfRef);
  const referents = [objectSchema({ kind: { const: 'room', type: 'string' } })];
  if (present.length) referents.push(objectSchema({
    kind: { const: 'player', type: 'string' }, playerId: strings(present),
  }));
  // Recognition-v2 contexts let Grifters speak and write (owner decision 2026-10-20), matching the validator.
  const silentGrifter = input.role === 'Grifter' && input.rules !== 'v2';
  const communication = silentGrifter ? nullSchema() : nullable(
    objectSchema({ kind: { const: 'wallPost', type: 'string' }, state: strings(SELF_STATES) }),
    objectSchema({
      kind: { const: 'proximityUtterance', type: 'string' },
      intent: strings(INTENTS), tone: strings(TONES), referent: { anyOf: referents },
      context: nullable(strings(SPEECH_CONTEXTS)),
    }),
  );
  return freezeTree(objectSchema({
    move: nullable(...input.legalMoves.map(point => objectSchema({
      x: { type: 'number', const: point.x }, y: { type: 'number', const: point.y },
    }))),
    communication,
    diary: silentGrifter || !known.length ? nullSchema() : nullable(objectSchema({
      subject: strings(known), observation: strings(OBSERVATIONS), reading: strings(READINGS),
      context: nullable(strings(DIARY_CONTEXTS)),
    })),
    role: input.role !== 'Baker' ? nullSchema() : nullable(objectSchema({
      kind: { const: 'bakerPrice', type: 'string' }, price: { type: 'number', minimum: 0, maximum: 2 },
    })),
  }));
}

export interface MockProviderRequest {
  readonly protocol: 'node-offline-provider-v1';
  readonly model: 'offline-fixture';
  readonly input: DecisionContext;
  readonly decisionSchema: Schema;
  readonly maxInputTokens: 36_864;
  readonly maxOutputTokens: 2_048;
}

export class MockProviderError extends Error {
  constructor(code: string) { super(code); this.name = 'MockProviderError'; }
}

export function buildMockProviderRequest(context: DecisionContext): MockProviderRequest {
  let request: MockProviderRequest;
  try {
    const input = policyInput(context);
    request = {
      protocol: 'node-offline-provider-v1', model: 'offline-fixture', input,
      decisionSchema: mockDecisionSchema(input), maxInputTokens: 36_864, maxOutputTokens: 2_048,
    };
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 32_768) throw Error();
  } catch { throw new MockProviderError('mock_request_invalid'); }
  return freezeTree(request);
}

/** A trusted synchronous in-memory factory, not an HTTP client or credential boundary. */
export interface MockProviderResponse { status: number; body: Readable }
export type MockProviderTransport = (request: MockProviderRequest, signal: AbortSignal) => MockProviderResponse;

function closeBody(value: unknown): void {
  if (object(value) && value.body instanceof Readable) {
    value.body.on('error', () => {});
    value.body.destroy();
  }
}

/** Adapts bounded mock completions to the unchanged OfflineBroker fixture interface. */
export function createMockProviderFixture(
  transport: MockProviderTransport,
  limits: { maxResponseBytes?: number; deadlineMs?: number } = {},
): (context: DecisionContext, signal: AbortSignal) => Promise<FixtureResponse> {
  const maxResponseBytes = limits.maxResponseBytes ?? 262_144;
  const deadlineMs = limits.deadlineMs ?? 12_000;
  if (typeof transport !== 'function' || Object.keys(limits).some(key => !['maxResponseBytes', 'deadlineMs'].includes(key)) ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 262_144 ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 12_000) {
    throw new MockProviderError('mock_limits_invalid');
  }
  let busy = false;
  return async (context, signal) => {
    if (signal.aborted) throw new MockProviderError('mock_provider_aborted');
    if (busy) throw new MockProviderError('mock_provider_busy');
    busy = true;
    let response: unknown;
    let abort: (() => void) | undefined;
    try {
      const request = buildMockProviderRequest(context);
      try { response = transport(request, signal); }
      catch { throw new MockProviderError('mock_transport_failed'); }
      if (!object(response) || !exact(response, ['status', 'body']) || !(response.body instanceof Readable)) {
        throw new MockProviderError('mock_transport_invalid');
      }
      const body = response.body;
      // The shared reader installs its error handler before any destruction path.
      const reading = readBoundedJson(body, response.status as number, maxResponseBytes, deadlineMs);
      abort = () => { body.destroy(new Error('mock_provider_aborted')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      let completion: unknown;
      try { completion = await reading; }
      catch (error) {
        if (signal.aborted) throw new MockProviderError('mock_provider_aborted');
        throw new MockProviderError(error instanceof BodyError && error.message === 'body_timeout'
          ? 'mock_response_timeout' : 'mock_response_rejected');
      }
      if (signal.aborted) throw new MockProviderError('mock_provider_aborted');
      if (!object(completion) || !exact(completion, ['status', 'model', 'usage', 'decision']) ||
          completion.status !== 'completed' || completion.model !== request.model ||
          !object(completion.usage) || !exact(completion.usage, ['inputTokens', 'outputTokens'])) {
        throw new MockProviderError('mock_completion_invalid');
      }
      const { inputTokens, outputTokens } = completion.usage;
      if (!Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0 || (inputTokens as number) > request.maxInputTokens ||
          !Number.isSafeInteger(outputTokens) || (outputTokens as number) < 0 || (outputTokens as number) > request.maxOutputTokens) {
        throw new MockProviderError('mock_usage_invalid');
      }
      const decision = validateDecision(completion.decision, request.input);
      if (!decision) throw new MockProviderError('mock_decision_invalid');
      return { status: 'completed', model: request.model, inputTokens: inputTokens as number,
        outputTokens: outputTokens as number, decision };
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      closeBody(response);
      busy = false;
    }
  };
}
