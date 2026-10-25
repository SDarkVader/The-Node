import { describe, expect, it } from 'vitest';
import { ContinuationHost } from '../src/eval/continuationHost.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { observe, personBody } from '../src/server/observer.js';
import { evidenceHash, replay } from '../src/agent/replay.js';
import { localDistrictTension, stepDistrictWeather } from '../src/engine/districtWeather.js';
import { validateDecision } from '../src/agent/protocol.js';
import { DEFAULT_PERCEPTION_CONDITION, PERCEPTION_PROFILE, PERCEPTION_SCHEMA, assertPerceptionRecord, effectiveRange,
  perceptionRequest, validatePerception, type PerceptionRequest, type PerceptionRecord } from '../src/observatory/perception.js';
import { buildPerceptionAgentInput, perceptionDecisionContext, perceptionPolicyPacket } from '../src/observatory/perceptionContext.js';
import { runPerceptionEpisode, runAuditedPerceptionEpisode } from '../src/observatory/perceptionEpisode.js';

const genesis = { ...fixtureGenesis(103, { ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }), sourceRevision: 'perception-context-test' };
const actors = [{ actorId: 'baker-0', role: 'Baker', ordinal: 0 }];
const stay = () => ({ move: null, communication: null, diary: null, role: null });
function record(req: PerceptionRequest): PerceptionRecord {
  const observation = req.perspective === 'first_person'
    ? { effectiveRange: effectiveRange(req.condition), bodies: [], locations: [], environment: {
      localTensionBand: req.scene.districts.find(d => d.id === req.scene.observer.districtId)?.tensionBand ?? null,
      weather: req.condition.weather.kind } }
    : { view: { centerDistrictId: req.scene.observer.districtId, span: req.condition.isometric.span }, districts: [], locations: [], activity: [],
      environment: { economicHealthBand: req.scene.environment.economicHealthBand, weather: req.condition.weather.kind } };
  const response = { type: 'perception' as const, schema: PERCEPTION_SCHEMA, profile: PERCEPTION_PROFILE,
    requestId: req.requestId, agentId: req.agentId, tick: req.tick, worldHash: req.worldHash, perspective: req.perspective,
    engine: { name: 'TEST-ONLY', version: 'offline' }, observation };
  return validatePerception(req, response, JSON.stringify(response));
}
function setup(perspective: 'first_person' | 'isometric' = 'first_person') {
  const host = new ContinuationHost(genesis, actors), state = createParticipantState(genesis);
  const view = host.views()[0]!, who = host.identities()[0]!;
  const req = perceptionRequest(state, { agentId: who.actorId, person: who.person }, perspective, DEFAULT_PERCEPTION_CONDITION,
    { episodeId: 'TEST-context', worldHash: host.hash });
  return { host, state, view, who, req, input: buildPerceptionAgentInput(req, record(req), view.observation) };
}

describe('mechanics grounded perception policy contract', () => {
  it('explains actual tension causes and consequences without turning the band into a causal diagnosis', () => {
    const { input } = setup();
    expect(input.rules.districtWeather.mechanics).toMatch(/Vacancies, consolidation, same-day sabotage and detected pressure/);
    expect(input.rules.districtWeather.mechanics).toMatch(/Manhattan/);
    expect(input.rules.districtWeather.consequences).toContain('does not directly change movement permission');
    expect(input.rules.districtWeather.bands).toEqual({ calm: 'below 0.06', uneasy: '0.06 to below 0.1', tense: 'at least 0.1' });
    expect(input.rules.visibility.fog).toContain('not derived from District Weather');
    expect(input.rules.visibility.opticalWeather).toBe('clear');
  });

  it('uses weatherHistory from the actual weather functions, not a constant condition label', () => {
    const { state, view, who } = setup();
    for (const [filled, expected] of [[1, 'calm'], [0.8, 'uneasy'], [0, 'tense']] as const) {
      const tension = localDistrictTension(filled, 'ACTIVE', false);
      const shard = stepDistrictWeather(state.world.shard, Object.fromEntries(state.world.shard.districts.map(d => [d.id, tension])), state.world.tick);
      const changed = { ...state, world: { ...state.world, shard } };
      const req = perceptionRequest(changed, { agentId: who.actorId, person: who.person }, 'first_person', DEFAULT_PERCEPTION_CONDITION,
        { episodeId: 'TEST-weather', worldHash: evidenceHash(changed) });
      const input = buildPerceptionAgentInput(req, record(req), view.observation);
      expect(input.perception.environment).toMatchObject({ localTensionBand: expected, weather: 'clear' });
    }
  });

  it('contains no hidden schema enums, world state, private diary or original observer projection', () => {
    const { input, state, view } = setup();
    // Synthetic private markers test the boundary even when the authorized projection has them.
    const hidden = structuredClone(view.observation);
    hidden.context.knownSubjects = ['SECRET-known-subject'];
    hidden.context.presentRefs = ['SECRET-hidden-body'];
    hidden.context.hearingRefs = ['SECRET-hidden-body'];
    const req = setup().req;
    const packet = perceptionPolicyPacket(buildPerceptionAgentInput(req, record(req), hidden));
    const text = JSON.stringify(packet);
    for (const secret of [genesis.observerSecret, 'SECRET-known-subject', 'SECRET-hidden-body', ...state.registry.people.keys()]) expect(text).not.toContain(secret);
    for (const field of ['"wealth":', '"stock":', '"projection":', '"diary":[' , '"hearingRefs":', '"knownSubjects":']) expect(text).not.toContain(field);
    expect(Object.keys(input.self).sort()).toEqual(['role', 'roleEpoch', 'x', 'y']);
    expect(packet.decisionSchema).toEqual(input.decisionSchema);
    expect(Object.isFrozen(input.rules.actions.move.options)).toBe(true);
    expect(Object.isFrozen(packet.input.perception)).toBe(true);
  });

  it('retains cardinal movement options and documents their timing without inventing collision or wages', () => {
    const { input, view } = setup();
    expect(input.legalMoves).toEqual(view.observation.context.legalMoves);
    expect(input.legalMoves.length).toBeGreaterThan(0);
    for (const p of input.rules.actions.move.options) expect(Math.abs(p.dx) + Math.abs(p.dy)).toBe(1);
    expect(input.rules.actions.move.timing).toContain('Speech uses the starting position');
    expect(input.rules.locations).toContain('not movement barriers');
    expect(input.rules.actions.move.meaning).toContain('or null to stay');
    expect(perceptionDecisionContext(view.observation.context).knownSubjects).toEqual([]);
    expect(validateDecision(stay(), perceptionDecisionContext(view.observation.context))).toEqual(stay());
  });

  it('prepares a bounded provider-neutral packet without any provider or credential work', () => {
    const { input } = setup();
    expect(perceptionPolicyPacket(input).schema).toBe('node-perception-policy-packet-v1');
    expect(() => perceptionPolicyPacket(input, 10)).toThrow('perception_packet_too_large');
    expect(() => perceptionPolicyPacket(input, NaN)).toThrow('perception_packet_too_large');
  });

  it.each([false, true])('uses the actual Courier wage and movement semantics for v2=%s', v2 => {
    const original = fixtureGenesis(103, { ...DEFAULT_WORLD_CONFIG, ...(v2 ? { recognition: 'v2' as const } : {}) });
    const host = new ContinuationHost(original, [{ actorId: 'courier-0', role: 'Courier', ordinal: 0 }]);
    const state = createParticipantState(original), who = host.identities()[0]!, view = host.views()[0]!;
    const req = perceptionRequest(state, { agentId: who.actorId, person: who.person }, 'first_person', DEFAULT_PERCEPTION_CONDITION,
      { episodeId: 'TEST-courier', worldHash: host.hash });
    const input = buildPerceptionAgentInput(req, record(req), view.observation);
    expect(input.rules.role.duty).toContain(v2 ? 'workplace-to-hub' : 'current avatar-to-hub');
    expect(input.rules.actions.move.timing).toContain(v2 ? 'Speech uses the starting position' : 'before the day processes');
  });

  it('keeps isometric identity-free while explaining its distinct aggregate perspective', () => {
    const { input, req } = setup('isometric');
    expect(input.rules.visibility.meaning).toContain('no individual identities or positions');
    for (const entity of req.scene.entities) expect(entity.ref).toBeNull();
    expect(JSON.stringify(input.decisionSchema)).not.toContain('playerId');
  });
});

describe('policy boundaries and real kernel movement', () => {
  it.each(['episodeId', 'conditionId', 'conditionDigest', 'requestSha256', 'perspective', 'profile'] as const)('refuses forged %s before policy delivery', async field => {
    let calls = 0;
    await expect(runPerceptionEpisode({ episodeId: 'TEST-binding', genesis, actors, ticks: 1,
      condition: DEFAULT_PERCEPTION_CONDITION, perspective: () => 'first_person' }, { 'baker-0': () => { calls++; return stay(); } },
      async req => ({ ...record(req), [field]: 'forged' }) as PerceptionRecord)).rejects.toThrow(/perception_/);
    expect(calls).toBe(0);
  });

  it('revalidates observation contents from injected callbacks, not only record IDs', async () => {
    const { req } = setup();
    const forged = record(req);
    (forged.observation as unknown as Record<string, unknown>).privateDiary = ['SECRET'];
    expect(() => assertPerceptionRecord(req, forged)).toThrow('perception_first_person_fields');
  });

  it('applies an available move and the next input follows the new position; replay agrees', async () => {
    const positions: { x: number; y: number }[] = [];
    let destination: { x: number; y: number };
    const result = await runPerceptionEpisode({ episodeId: 'TEST-move', genesis, actors, ticks: 2,
      condition: DEFAULT_PERCEPTION_CONDITION, perspective: () => 'first_person' }, { 'baker-0': input => {
      positions.push({ x: input.self.x, y: input.self.y });
      if (input.tick === 0) { destination = input.legalMoves[0]!; return { ...stay(), move: destination }; }
      return stay();
    } }, async req => record(req));
    expect(result.ticks[0]!.verdicts['baker-0']!.code).toBe('admitted');
    expect(result.ticks[0]!.effects).toContainEqual({ person: result.identities[0]!.person, category: 'move' });
    expect(positions[1]).toEqual(destination!);
    expect(positions[1]).not.toEqual(positions[0]);
    const final = replay(result.tape, genesis.sourceRevision);
    expect(evidenceHash(final)).toBe(result.finalHash);
    expect(personBody(final, final.registry.people.get(result.identities[0]!.person)!)).toMatchObject(destination!);
  });

  it('rejects unexposed targeted speech, diary and illegal moves without suppressing legal stay', async () => {
    for (const candidate of [{ ...stay(), move: { x: 999, y: 999 } },
      { ...stay(), diary: { subject: 'hidden', observation: 'keptAPromise', reading: 'seemsTrustworthy', context: 'trade' } },
      { ...stay(), communication: { kind: 'proximityUtterance', intent: 'greet', tone: 'warm', referent: { kind: 'player', playerId: 'hidden' }, context: null } }]) {
      const result = await runPerceptionEpisode({ episodeId: 'TEST-exposure', genesis, actors, ticks: 1,
        condition: DEFAULT_PERCEPTION_CONDITION, perspective: () => 'first_person' }, { 'baker-0': () => candidate }, async req => record(req));
      expect(result.ticks[0]!.policyRejected).toEqual(['baker-0']);
      expect(result.ticks[0]!.verdicts['baker-0']!.code).toBe('rejected');
      expect(result.ticks[0]!.proposals['baker-0']).toEqual(candidate);
      expect(result.ticks[0]!.effects.some(e => e.category === 'move')).toBe(false);
    }
  });

  it('a callback cannot mutate the retained request to authorize its own altered response', async () => {
    await expect(runPerceptionEpisode({ episodeId: 'TEST-mutate', genesis, actors, ticks: 1,
      condition: DEFAULT_PERCEPTION_CONDITION, perspective: () => 'first_person' }, { 'baker-0': stay }, async req => {
      req.condition.bands.tension = [-3, -2];
      return record(req);
    })).rejects.toThrow('perception_record_binding');
  });

  it('the audited episode records agreement and stops before policy delivery on disagreement', async () => {
    const plan = { episodeId: 'TEST-audited-episode', genesis, actors, ticks: 1,
      condition: DEFAULT_PERCEPTION_CONDITION, perspective: () => 'first_person' as const };
    const primary = { workerId: 'first-process', perceive: async (req: PerceptionRequest) => record(req) };
    const comparison = { workerId: 'second-process', perceive: async (req: PerceptionRequest) => record(req) };
    const result = await runAuditedPerceptionEpisode(plan, { 'baker-0': stay }, primary, comparison);
    expect(result.audits).toHaveLength(1);
    expect(result.audits[0]!.status).toBe('agreement');
    let delivered = 0;
    const mismatched = { workerId: 'second-process', perceive: async (req: PerceptionRequest) => {
      const res = record(req);
      res.conditionDigest = '0'.repeat(64);
      return res;
    } };
    await expect(runAuditedPerceptionEpisode(plan, { 'baker-0': () => { delivered++; return stay(); } }, primary, mismatched)).rejects.toThrow(/perception_/);
    expect(delivered).toBe(0);
  });
});
