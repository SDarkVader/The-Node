import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { evidenceHash } from '../src/agent/replay.js';
import { personBody } from '../src/server/observer.js';
import {
  DEFAULT_PERCEPTION_CONDITION, PERCEPTION_PROFILE, PERCEPTION_SCHEMA, effectiveRange,
  perceptionRequest, validatePerception,
  type FirstPersonObservation, type PerceptionRecord, type PerceptionRequest, type PerceptionResponse,
} from '../src/observatory/perception.js';
import { auditPerception, PerceptionAuditMismatch, type PerceptionAuditWorker } from '../src/observatory/perceptionAudit.js';
import {
  launchPerceptionWorker, startPerceptionBridge,
  type PerceptionBridge, type PerceptionWorkerProcess,
} from '../src/observatory/perceptionBridge.js';

const genesis = { ...fixtureGenesis(103, JSON.parse(JSON.stringify({ ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }))),
  sourceRevision: 'TEST-ONLY-perception-independent-audit' };
const state = createParticipantState(genesis);
const baker = [...state.registry.people.values()].find(person => person.location !== null && personBody(state, person).role === 'Baker')!;
const request = (perspective: PerceptionRequest['perspective'] = 'first_person') => perceptionRequest(state,
  { agentId: 'baker-0', person: baker.id }, perspective, DEFAULT_PERCEPTION_CONDITION,
  { episodeId: 'TEST-ONLY-audit', worldHash: evidenceHash(state) });

function empty(req: PerceptionRequest) {
  return req.perspective === 'first_person'
    ? { effectiveRange: effectiveRange(req.condition), bodies: [], locations: [],
      environment: { localTensionBand: req.scene.districts.find(d => d.id === req.scene.observer.districtId)?.tensionBand ?? null,
        weather: req.condition.weather.kind } }
    : { view: { centerDistrictId: req.scene.observer.districtId, span: req.condition.isometric.span },
      districts: [], locations: [], activity: [],
      environment: { economicHealthBand: req.scene.environment.economicHealthBand, weather: req.condition.weather.kind } };
}

function record(req: PerceptionRequest, observation: unknown = empty(req), version = 'TEST-ONLY-primary'): PerceptionRecord {
  const response = { type: 'perception', schema: PERCEPTION_SCHEMA, profile: PERCEPTION_PROFILE,
    requestId: req.requestId, agentId: req.agentId, tick: req.tick, worldHash: req.worldHash,
    perspective: req.perspective, engine: { name: 'test-fixture', version }, observation } as PerceptionResponse;
  return validatePerception(req, response, JSON.stringify(response));
}

const worker = (workerId: string, produce: (req: PerceptionRequest) => PerceptionRecord = record): PerceptionAuditWorker =>
  ({ workerId, perceive: async req => produce(req) });

describe('independent-worker perception audit', () => {
  it.each(['first_person', 'isometric'] as const)('records agreement, request and both engine/response hashes for %s', async perspective => {
    const req = request(perspective);
    const { record: delivered, audit } = await auditPerception(req, worker('process-1'),
      worker('process-2', input => record(input, empty(input), 'TEST-ONLY-independent')));
    expect(audit).toMatchObject({ schema: 'node-perception-independent-audit-v1', status: 'agreement',
      requestId: req.requestId, agentId: req.agentId, tick: req.tick, worldHash: req.worldHash,
      perspective, requestSha256: delivered.requestSha256 });
    expect(audit.workers.map(result => result.workerId)).toEqual(['process-1', 'process-2']);
    expect(audit.workers[0]!.engine.version).toBe('TEST-ONLY-primary');
    expect(audit.workers[1]!.engine.version).toBe('TEST-ONLY-independent');
    expect(audit.workers[0]!.observationSha256).toBe(audit.workers[1]!.observationSha256);
    expect(audit.workers[0]!.responseSha256).not.toBe(audit.workers[1]!.responseSha256);
  });

  it('refuses a primary omission which ordinary subset validation accepts', async () => {
    // TEST ONLY: place one known scene body in contact, where this profile must see it.
    // This synthetic request never changes the actual world, policy or experiment evidence.
    const req = request();
    const body = req.scene.entities.find(entity => !entity.inside)!;
    body.x = req.scene.observer.x; body.y = req.scene.observer.y;
    body.inside = false; body.atBuilding = null;
    const omitted = record(req);
    const complete = record(req, { ...empty(req), bodies: [{ ref: body.ref, role: body.role, dx: 0, dy: 0, distance: 0 }] });
    expect((omitted.observation as FirstPersonObservation).bodies).toEqual([]);
    expect((complete.observation as FirstPersonObservation).bodies).toHaveLength(1);
    const result = auditPerception(req, worker('process-1', () => omitted), worker('process-2', () => complete));
    await expect(result).rejects.toBeInstanceOf(PerceptionAuditMismatch);
    await expect(result).rejects.toMatchObject({ message: 'perception_audit_divergence',
      audit: { status: 'divergence', requestId: req.requestId, workers: [{ workerId: 'process-1' }, { workerId: 'process-2' }] } });
  });

  it('does not claim shared errors are detected when both workers omit the same item', async () => {
    const { audit } = await auditPerception(request(), worker('process-1'), worker('process-2'));
    expect(audit.status).toBe('agreement');
  });

  it('gives each worker its own immutable request and detaches retained worker results', async () => {
    const req = request(), initialX = req.scene.observer.x;
    const received: PerceptionRequest[] = [], produced: PerceptionRecord[] = [];
    const make = (id: string) => worker(id, input => {
      received.push(input);
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(input.scene.observer)).toBe(true);
      expect(() => { input.scene.observer.x += 20; }).toThrow();
      const value = record(input); produced.push(value); return value;
    });
    const pending = auditPerception(req, make('process-1'), make('process-2'));
    req.scene.observer.x += 100;
    const result = await pending;
    expect(received[0]).not.toBe(received[1]);
    expect(received[0]!.scene).not.toBe(received[1]!.scene);
    expect(received.map(input => input.scene.observer.x)).toEqual([initialX, initialX]);
    produced[0]!.engine.version = 'mutated-after-completion';
    (produced[0]!.observation as FirstPersonObservation).environment.weather = 'fog';
    expect(result.record.engine.version).toBe('TEST-ONLY-primary');
    expect((result.record.observation as FirstPersonObservation).environment.weather).toBe('clear');
    expect(result.audit.workers[0]!.engine.version).toBe('TEST-ONLY-primary');
  });

  it('refuses duplicated worker identities or the exact same callback before dispatch', async () => {
    let called = 0;
    const a = worker('same', req => { called++; return record(req); });
    await expect(auditPerception(request(), a, worker('same'))).rejects.toThrow('perception_audit_workers_not_independent');
    await expect(auditPerception(request(), a, { workerId: 'different', perceive: a.perceive }))
      .rejects.toThrow('perception_audit_workers_not_independent');
    expect(called).toBe(0);
  });

  it.each([
    ['request', { requestId: '0'.repeat(64) }], ['agent', { agentId: 'other-agent' }],
    ['tick', { tick: 100 }], ['world', { worldHash: '0'.repeat(64) }],
    ['episode', { episodeId: 'other-episode' }], ['perspective', { perspective: 'isometric' }],
    ['schema', { schema: 'unknown-record-schema' }], ['profile', { profile: 'other-profile' }],
    ['condition identity', { conditionId: 'other-condition' }], ['condition digest', { conditionDigest: '0'.repeat(64) }],
    ['request bytes', { requestSha256: '0'.repeat(64) }], ['engine', { engine: null }],
  ])('refuses invalid %s binding even when both workers return the same forgery', async (_name, over) => {
    const forge = (req: PerceptionRequest) => ({ ...record(req), ...over }) as PerceptionRecord;
    await expect(auditPerception(request(), worker('process-1', forge), worker('process-2', forge)))
      .rejects.toThrow(/perception_/);
  });

  it('revalidates observation fields instead of trusting a valid-looking record envelope', async () => {
    const forge = (req: PerceptionRequest) => ({ ...record(req), observation: { ...empty(req), evaluatorState: 'forbidden' } }) as unknown as PerceptionRecord;
    await expect(auditPerception(request(), worker('process-1', forge), worker('process-2', forge)))
      .rejects.toThrow(/perception_/);
  });
});

const GODOT = process.env.NODE_GODOT_BIN;
describe.skipIf(!GODOT)('audit through two separately launched real Godot workers', () => {
  const bridges: PerceptionBridge[] = [], processes: PerceptionWorkerProcess[] = [];
  beforeAll(async () => {
    for (let index = 0; index < 2; index++) {
      const bridge = await startPerceptionBridge({ timeoutMs: 15000 });
      bridges.push(bridge);
      const process = launchPerceptionWorker(GODOT!, bridge); processes.push(process);
      await bridge.ready(30000).catch(error => { throw Error(`${error.message}\n${process.output()}`); });
    }
  }, 70000);
  afterAll(async () => {
    await Promise.all(bridges.map(bridge => bridge.close()));
    await Promise.all(processes.map(process => process.stop()));
  });
  it.each(['first_person', 'isometric'] as const)('re-derives identical %s observations with both independent workers', async perspective => {
    const req = request(perspective);
    const { record: delivered, audit } = await auditPerception(req,
      { workerId: 'real-godot-process-1', perceive: input => bridges[0]!.perceive(input) },
      { workerId: 'real-godot-process-2', perceive: input => bridges[1]!.perceive(input) });
    expect(audit.status).toBe('agreement');
    expect(audit.workers.map(worker => worker.engine.name)).toEqual(['godot', 'godot']);
    expect(audit.workers[0]!.observationSha256).toBe(audit.workers[1]!.observationSha256);
    expect(delivered.requestId).toBe(req.requestId);
    expect(bridges.map(bridge => bridge.stats().delivered)).toEqual(perspective === 'first_person' ? [1, 1] : [2, 2]);
  });
});
