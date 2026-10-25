/**
 * Agent-specific perception (2026-10-23). Unit tests run everywhere. The Godot tests run the real
 * headless client (client/scenes/PerceptionWorker.tscn) and are skipped unless NODE_GODOT_BIN
 * names a Godot 4.3+ binary, because the CI image has no Godot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createParticipantState, fixtureGenesis, type ParticipantState } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { observe, observerRef, personBody, refHexLength } from '../src/server/observer.js';
import { digest, evidenceHash, replay } from '../src/agent/replay.js';
import {
  DEFAULT_PERCEPTION_CONDITION, PERCEPTION_PROFILE, PERCEPTION_SCHEMA, effectiveRange, isometricReach, perceptionRequest, validatePerception,
  type PerceptionCondition, type PerceptionRecord, type PerceptionRequest, type PerceptionResponse, type Perspective,
} from '../src/observatory/perception.js';
import { launchPerceptionWorker, startPerceptionBridge, type PerceptionBridge, type PerceptionWorkerProcess } from '../src/observatory/perceptionBridge.js';
import { runPerceptionEpisode, type PerceptionAgentInput } from '../src/observatory/perceptionEpisode.js';
import { ContinuationHost } from '../src/eval/continuationHost.js';

const genesis = { ...fixtureGenesis(103, JSON.parse(JSON.stringify({ ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }))), sourceRevision: 'perception-test' };
const ACTORS = [{ actorId: 'baker-0', role: 'Baker', ordinal: 0 }, { actorId: 'grifter-0', role: 'Grifter', ordinal: 0 }];
const fog = (range: number): PerceptionCondition => ({ ...structuredClone(DEFAULT_PERCEPTION_CONDITION), id: `perception-fog-${range}`,
  weather: { kind: 'fog', density: -Math.log(0.05) / range, transmittanceThreshold: 0.05 } });

/** Evaluator-side ground truth: the ordinal-th person holding a role, as ContinuationHost picks. */
function actor(state: ParticipantState, role: string, ordinal = 0) {
  const people = [...state.registry.people.values()].filter(p => p.location !== null).sort((a, b) => a.id.localeCompare(b.id));
  return people.filter(p => personBody(state, p).role === role)[ordinal]!;
}
const engine = { name: 'test', version: 'TEST-ONLY' };
const respond = (req: PerceptionRequest, observation: unknown, over: Record<string, unknown> = {}): PerceptionResponse => ({
  type: 'perception', schema: PERCEPTION_SCHEMA, profile: PERCEPTION_PROFILE, requestId: req.requestId, agentId: req.agentId, tick: req.tick,
  worldHash: req.worldHash, perspective: req.perspective, engine, observation, ...over } as PerceptionResponse);
const check = (req: PerceptionRequest, res: PerceptionResponse) => validatePerception(req, res, JSON.stringify(res));
/** The smallest valid observation: nothing perceived beyond the environment. */
function emptyObservation(req: PerceptionRequest) {
  const local = req.scene.districts.find(d => d.id === req.scene.observer.districtId)?.tensionBand ?? null;
  return req.perspective === 'first_person'
    ? { effectiveRange: effectiveRange(req.condition), bodies: [], locations: [], environment: { localTensionBand: local, weather: req.condition.weather.kind } }
    : { view: { centerDistrictId: req.scene.observer.districtId, span: req.condition.isometric.span }, districts: [], locations: [], activity: [],
      environment: { economicHealthBand: req.scene.environment.economicHealthBand, weather: req.condition.weather.kind } };
}

describe('perception requests carry only what the perspective may report', () => {
  const state = createParticipantState(genesis), baker = actor(state, 'Baker'), hash = evidenceHash(state);
  const build = (p: Perspective, c = DEFAULT_PERCEPTION_CONDITION) => perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, p, c, { episodeId: 'TEST', worldHash: hash });

  it('sends no person id, secret or private economic state, and uses the agent\'s own references', () => {
    const fp = build('first_person'), iso = build('isometric');
    for (const req of [fp, iso]) {
      const text = JSON.stringify(req);
      for (const id of state.registry.people.keys()) expect(text).not.toContain(`"${id}"`);
      expect(text).not.toContain(genesis.observerSecret);
      for (const key of ['wealth', 'stock', 'price', 'diary', 'rumours', 'proximity', 'dealings', 'experience']) expect(text).not.toContain(`"${key}"`);
    }
    // The same pseudonyms the agent's authorized observation already uses for these bodies.
    const known = new Set(observe(state, baker.id, genesis.observerSecret).projection.city.people.map(p => p.ref));
    expect(fp.scene.entities.length).toBeGreaterThan(0);
    for (const e of fp.scene.entities) expect(known.has(e.ref!)).toBe(true);
    // Isometric sends no references or roles at all, so none can come back.
    expect(iso.scene.entities.every(e => e.ref === null && e.role === null)).toBe(true);
    for (const e of fp.scene.entities) expect(JSON.stringify(iso)).not.toContain(e.ref!);
  });

  it('sends only bodies within the perspective\'s reach, and fog shortens first-person reach', () => {
    const fp = build('first_person'), iso = build('isometric'), foggy = build('first_person', fog(1.5));
    const o = fp.scene.observer, present = [...state.registry.people.values()].filter(p => p.location !== null && p.id !== baker.id)
      .map(p => personBody(state, p));
    const within = (r: number, cx: number, cy: number) => present.filter(b => Math.hypot(b.x - cx, b.y - cy) <= r + 1e-9).length;
    expect(fp.scene.entities).toHaveLength(within(6, o.x, o.y));
    expect(effectiveRange(fog(1.5))).toBeCloseTo(1.5, 12);
    expect(foggy.scene.entities).toHaveLength(within(1.5, o.x, o.y));
    expect(foggy.scene.entities.length).toBeLessThan(fp.scene.entities.length);
    const plaza = iso.scene.districts.find(d => d.id === iso.scene.observer.districtId)!;
    expect(iso.scene.entities).toHaveLength(within(isometricReach(DEFAULT_PERCEPTION_CONDITION), plaza.plazaX, plaza.plazaY));
    // A role-holder at its own building is inside it; the hub crowd is in the open.
    expect(fp.scene.observer).toMatchObject({ atBuilding: baker.location, inside: true });
    expect(fp.scene.entities.filter(e => !e.inside).length).toBeGreaterThan(0);
  });
});

describe('the Node validates every perceived item against its own request', () => {
  const state = createParticipantState(genesis), baker = actor(state, 'Baker'), hash = evidenceHash(state);
  const fp = perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, 'first_person', DEFAULT_PERCEPTION_CONDITION, { episodeId: 'TEST', worldHash: hash });
  const iso = perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, 'isometric', DEFAULT_PERCEPTION_CONDITION, { episodeId: 'TEST', worldHash: hash });
  const open = fp.scene.entities.find(e => !e.inside)!, inside = fp.scene.entities.find(e => e.inside)!;
  const body = (e = open) => ({ ref: e.ref, role: e.role, dx: e.x - fp.scene.observer.x, dy: e.y - fp.scene.observer.y,
    distance: Math.hypot(e.x - fp.scene.observer.x, e.y - fp.scene.observer.y) });
  const withBodies = (bodies: unknown[]) => ({ ...emptyObservation(fp), bodies });
  const own = fp.scene.buildings.find(b => b.id === fp.scene.observer.atBuilding)!;
  const ownLocation = { buildingId: own.id, role: own.role, state: own.state, heatBand: own.heatBand, occupied: true, dx: 0, dy: 0, distance: 0 };

  it('accepts a bound observation of items the request holds and records its provenance', () => {
    const res = respond(fp, { ...withBodies([body()]), locations: [ownLocation] });
    const record = check(fp, res);
    expect(record).toMatchObject({ agentId: 'baker-0', tick: 0, worldHash: hash, perspective: 'first_person', requestId: fp.requestId,
      conditionId: DEFAULT_PERCEPTION_CONDITION.id, profile: PERCEPTION_PROFILE });
    expect(record.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(check(iso, respond(iso, emptyObservation(iso))).perspective).toBe('isometric');
  });

  it.each([
    ['another request', { requestId: 'f'.repeat(64) }, 'perception_binding_mismatch'],
    ['another agent', { agentId: 'grifter-0' }, 'perception_binding_mismatch'],
    ['another tick', { tick: 1 }, 'perception_binding_mismatch'],
    ['another world state', { worldHash: '0'.repeat(64) }, 'perception_binding_mismatch'],
    ['another perspective', { perspective: 'isometric' }, 'perception_binding_mismatch'],
    ['another profile', { profile: 'node-perception-godot-v0' }, 'perception_profile_mismatch'],
    ['an extra field', { debug: true }, 'perception_response_fields'],
    ['a worker error', { error: 'boom' }, 'perception_worker_error'],
  ])('refuses %s', (_label, over, code) => {
    expect(() => check(fp, respond(fp, emptyObservation(fp), over))).toThrow(code);
  });

  it.each([
    ['an invented body', () => withBodies([{ ...body(), ref: 'e'.repeat(16) }]), 'perception_unknown_body'],
    ['a moved body', () => withBodies([{ ...body(), dx: body().dx + 1 }]), 'perception_body_altered'],
    ['a relabelled body', () => withBodies([{ ...body(), role: 'baker' }]), 'perception_body_altered'],
    ['a body through walls', () => withBodies([body(inside)]), 'perception_body_inside_building'],
    ['a duplicated body', () => withBodies([body(), body()]), 'perception_duplicate_body'],
    ['a body with an extra field', () => withBodies([{ ...body(), wealth: 3 }]), 'perception_unknown_body'],
    ['an altered location', () => ({ ...emptyObservation(fp), locations: [{ ...ownLocation, state: 'VACANT' }] }), 'perception_location_altered'],
    ['a false occupancy', () => ({ ...emptyObservation(fp), locations: [{ ...ownLocation, occupied: false }] }), 'perception_location_altered'],
    ['a widened range', () => ({ ...emptyObservation(fp), effectiveRange: 7 }), 'perception_range_mismatch'],
    ['another district\'s weather', () => ({ ...emptyObservation(fp), environment: { localTensionBand: 'tense', weather: 'clear' } }), 'perception_environment_mismatch'],
  ])('refuses %s in first person', (_label, observation, code) => {
    expect(() => check(fp, respond(fp, observation()))).toThrow(code);
  });

  it('refuses a body beyond the condition\'s sight even when the request holds it', () => {
    const foggy = { ...fp, condition: fog(1.5) };
    const far = fp.scene.entities.find(e => !e.inside && Math.hypot(e.x - fp.scene.observer.x, e.y - fp.scene.observer.y) > 1.5)!;
    expect(() => check(foggy, respond(foggy, { ...emptyObservation(foggy), bodies: [body(far)] }))).toThrow('perception_body_beyond_range');
  });

  it('keeps isometric observations aggregate and inside the view', () => {
    const openHere = iso.scene.entities.filter(e => !e.inside && e.districtId === iso.scene.observer.districtId).length;
    const ok = { ...emptyObservation(iso), activity: [{ districtId: iso.scene.observer.districtId, bodiesInOpen: openHere }] };
    expect(check(iso, respond(iso, ok)).observation).toEqual(ok);
    expect(() => check(iso, respond(iso, { ...ok, activity: [{ districtId: iso.scene.observer.districtId, bodiesInOpen: openHere + 1 }] })))
      .toThrow('perception_activity_invalid');
    expect(() => check(iso, respond(iso, { ...ok, bodies: [body()] }))).toThrow('perception_isometric_fields');
    expect(() => check(iso, respond(iso, { ...ok, activity: [{ districtId: iso.scene.observer.districtId, bodiesInOpen: 1, refs: [open.ref] }] })))
      .toThrow('perception_activity_invalid');
    // This world has one district, so the request is given a district and a building far outside
    // the view: reporting either would widen the overview.
    const wide = { ...iso, scene: { ...iso.scene,
      districts: [...iso.scene.districts, { id: 'TEST-far', plazaX: 40, plazaY: 40, tensionBand: 'calm' as const }],
      buildings: [...iso.scene.buildings, { id: 'TEST-far-b0', x: 40, y: 41, role: null, isLandmark: false, state: null, heatBand: null }] } };
    expect(40 * Math.SQRT2).toBeGreaterThan(isometricReach(iso.condition));
    expect(() => check(wide, respond(wide, { ...ok, districts: [{ districtId: 'TEST-far', tensionBand: 'calm' }] }))).toThrow('perception_beyond_view');
    expect(() => check(wide, respond(wide, { ...ok, locations: [{ buildingId: 'TEST-far-b0', role: null, state: null, heatBand: null, occupied: false }] })))
      .toThrow('perception_beyond_view');
  });
});

/** TEST-ONLY worker speaking the bridge protocol from Node, for correlation and refusal tests. */
async function fakeWorker(bridge: PerceptionBridge, options: { token?: string; profile?: string } = {}) {
  const ws = new WebSocket(bridge.url, { headers: { authorization: `Bearer ${options.token ?? bridge.token}` } });
  const received: PerceptionRequest[] = [];
  ws.on('message', d => received.push(JSON.parse(d.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'perceptionWorker', profile: options.profile ?? PERCEPTION_PROFILE, engine }));
  return { ws, received, answer: (req: PerceptionRequest, over: Record<string, unknown> = {}) => ws.send(JSON.stringify(respond(req, emptyObservation(req), over))) };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise(r => setTimeout(r, 10)); };

describe('perception bridge', () => {
  const state = createParticipantState(genesis), baker = actor(state, 'Baker'), hash = evidenceHash(state);
  const request = (episodeId: string, p: Perspective = 'first_person') =>
    perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, p, DEFAULT_PERCEPTION_CONDITION, { episodeId, worldHash: hash });

  it('authenticates the worker, admits one at a time and requires the validated profile', async () => {
    const bridge = await startPerceptionBridge({ timeoutMs: 500 });
    try {
      await expect(fakeWorker(bridge, { token: 'wrong' })).rejects.toThrow(/401/);
      const first = await fakeWorker(bridge);
      expect(await bridge.ready()).toEqual(engine);
      await expect(fakeWorker(bridge)).rejects.toThrow(/409/);
      first.ws.close();
      await until(() => first.ws.readyState === WebSocket.CLOSED);
      await new Promise(r => setTimeout(r, 50));
      const wrong = await fakeWorker(bridge, { profile: 'node-perception-godot-v0' });
      await until(() => wrong.ws.readyState === WebSocket.CLOSED);
      expect(wrong.ws.readyState).toBe(WebSocket.CLOSED);
      await expect(bridge.ready(300)).rejects.toThrow('perception_worker_unavailable');
    } finally { await bridge.close(); }
  });

  it('correlates by request: a late or unknown answer is dropped, never delivered to another request', async () => {
    const bridge = await startPerceptionBridge({ timeoutMs: 300 });
    try {
      const w = await fakeWorker(bridge);
      await bridge.ready();
      const first = request('TEST-late');
      const late = bridge.perceive(first);
      await until(() => w.received.length === 1);
      w.answer(first, { requestId: 'a'.repeat(64) });
      await expect(late).rejects.toThrow('perception_timeout');
      const second = request('TEST-next'), next = bridge.perceive(second);
      await until(() => w.received.length === 2);
      w.answer(first); // the timed-out answer arrives after a new request is pending
      w.answer(second, { engine: { name: 'other', version: 'x' } });
      await expect(next).rejects.toThrow('perception_engine_mismatch');
      const third = request('TEST-third'), ok = bridge.perceive(third);
      await until(() => w.received.length === 3);
      w.answer(third);
      expect((await ok).requestId).toBe(third.requestId);
      expect(bridge.stats()).toMatchObject({ requests: 3, delivered: 1, refused: 1, timedOut: 1, unmatched: 2 });
      const lost = bridge.perceive(request('TEST-lost'));
      w.ws.terminate();
      await expect(lost).rejects.toThrow('perception_worker_lost');
    } finally { await bridge.close(); }
  });
});

describe('perception episode', () => {
  it('delivers each agent only its own bound perception, its position, role and legal moves', async () => {
    const inputs: PerceptionAgentInput[] = [];
    const policy = (input: PerceptionAgentInput) => { inputs.push(input); return { move: null, communication: null, diary: null, role: null }; };
    const result = await runPerceptionEpisode({ episodeId: 'TEST-episode', genesis, actors: ACTORS, ticks: 2, condition: DEFAULT_PERCEPTION_CONDITION,
      perspective: (agent, tick) => (agent === 'baker-0' && tick === 0 ? 'first_person' : 'isometric') },
      { 'baker-0': policy, 'grifter-0': policy }, async req => check(req, respond(req, emptyObservation(req))));
    expect(result.ticks).toHaveLength(2);
    expect(result.ticks[1]!.worldHash).toBe(result.ticks[0]!.nextWorldHash);
    expect(evidenceHash(replay(result.tape, genesis.sourceRevision))).toBe(result.finalHash);
    for (const t of result.ticks) {
      expect(t.records.map(r => r.agentId)).toEqual(['baker-0', 'grifter-0']);
      for (const r of t.records) expect(r).toMatchObject({ tick: t.tick, worldHash: t.worldHash });
    }
    expect(inputs.map(i => [i.agentId, i.tick, i.perspective])).toEqual([
      ['baker-0', 0, 'first_person'], ['grifter-0', 0, 'isometric'], ['baker-0', 1, 'isometric'], ['grifter-0', 1, 'isometric']]);
    for (const input of inputs) {
      expect(Object.keys(input).sort()).toEqual(['agentId', 'decisionSchema', 'legalMoves', 'perception', 'perspective', 'requestId', 'rules', 'self', 'tick', 'worldHash']);
      expect(Object.keys(input.self).sort()).toEqual(['role', 'roleEpoch', 'x', 'y']);
      const own = result.ticks[input.tick]!.records.find(r => r.agentId === input.agentId)!;
      expect(input.perception).toEqual(own.observation);
      expect(input.requestId).toBe(own.requestId);
    }
  });
});

describe('Godot client conformance (static)', () => {
  it('the perception scripts read only keys the request builder emits, and declare the validated profile', () => {
    const source = ['Perception.gd', 'PerceptionWorker.gd'].map(f => readFileSync(new URL(`../client/scripts/${f}`, import.meta.url), 'utf8')).join('\n');
    const state = createParticipantState(genesis), baker = actor(state, 'Baker');
    const emitted = new Set<string>();
    const keys = (v: unknown) => { if (Array.isArray(v)) v.forEach(keys); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { emitted.add(k); keys(x); } };
    for (const p of ['first_person', 'isometric'] as const) for (const c of [DEFAULT_PERCEPTION_CONDITION, fog(2)])
      keys(perceptionRequest(state, { agentId: 'a', person: baker.id }, p, c, { episodeId: 'e', worldHash: 'h' }));
    const read = new Set([...source.matchAll(/\[\s*"([^"]+)"\s*\]/g), ...source.matchAll(/\.get\(\s*"([^"]+)"/g)].map(m => m[1]!));
    // Not request keys: Godot's version and ray-hit dictionaries, and the response being built.
    for (const k of ['string', 'hash', 'collider', 'observation']) read.delete(k);
    expect([...read].filter(k => !emitted.has(k))).toEqual([]);
    expect(source).toContain(`const PROFILE := "${PERCEPTION_PROFILE}"`);
  });
});

const GODOT = process.env.NODE_GODOT_BIN;

describe.skipIf(!GODOT)('perception through the real Godot client', () => {
  let bridge: PerceptionBridge, worker: PerceptionWorkerProcess;
  beforeAll(async () => {
    bridge = await startPerceptionBridge({ timeoutMs: 15000 });
    worker = launchPerceptionWorker(GODOT!, bridge);
    await bridge.ready(30000).catch(e => { throw Error(`${e.message}\n${worker.output()}`); });
  });
  afterAll(async () => { await bridge?.close(); await worker?.stop(); });

  const bodyRefs = (r: PerceptionRecord) => ((r.observation as { bodies?: { ref: string }[] }).bodies ?? []).map(b => b.ref);
  /** TEST-ONLY: the same committed state with one body moved, to find a move worth making. */
  const moved = (s: ParticipantState, location: string, x: number, y: number): ParticipantState =>
    ({ ...s, world: { ...s.world, bakers: s.world.bakers.map(b => (b.buildingId === location ? { ...b, x, y } : b)) } });

  it('does not disclose an obscured entity until it becomes observable, then binds it to the right agent, tick and state', async () => {
    const stay = () => ({ move: null, communication: null, diary: null, role: null });
    // Scout the committed day-1 state through the real kernel. The first day houses the roleless
    // off the hub onto fixed plots, and nobody housed is moved again.
    const scout = new ContinuationHost(genesis, ACTORS);
    scout.advance(scout.views(), { 'baker-0': stay(), 'grifter-0': stay() });
    const day1 = replay(scout.tape(), genesis.sourceRevision), hash1 = scout.hash;
    const bakerId = scout.identities().find(a => a.actorId === 'baker-0')!.person, who = { agentId: 'baker-0', person: bakerId };
    const probe = (s: ParticipantState, id: string) => perceptionRequest(s, who, 'first_person', DEFAULT_PERCEPTION_CONDITION, { episodeId: `TEST-probe-${id}`, worldHash: hash1 });
    const here = probe(day1, 'here'), seenHere = new Set(bodyRefs(await bridge.perceive(here)));
    // Bodies in the open and in range that the agent cannot see from where it stands.
    const unseen = here.scene.entities.filter(e => !e.inside && !seenHere.has(e.ref!));
    expect(unseen.length).toBeGreaterThan(0);
    // Evaluator-side search for a target and a legal step that would bring it into view.
    let step: { x: number; y: number } | undefined, target: (typeof unseen)[number] | undefined;
    for (const m of observe(day1, bakerId, genesis.observerSecret).context.legalMoves) {
      const seen = new Set(bodyRefs(await bridge.perceive(probe(moved(day1, day1.registry.people.get(bakerId)!.location!, m.x, m.y), `${m.x},${m.y}`))));
      target = unseen.find(e => seen.has(e.ref!));
      if (target) { step = m; break; }
    }
    expect(step).toBeDefined();
    const hidden = target!.ref!, o = here.scene.observer, t = target!;
    const targetId = [...day1.registry.people.keys()].find(id => observerRef(genesis.observerSecret, bakerId, id, refHexLength(day1.world)) === hidden)!;
    // The occluders are the reason: with the structures near the line of sight taken away (and
    // anyone inside them, since nobody is inside a building that is not there; the Wall goes by
    // placing the hub outside this hypothetical scene), the same eye sees the target.
    const onSight = (x: number, y: number) => (x !== t.x || y !== t.y) &&
      Math.abs((t.x - o.x) * (y - o.y) - (t.y - o.y) * (x - o.x)) / Math.hypot(t.x - o.x, t.y - o.y) < 0.75 &&
      (x - o.x) * (t.x - o.x) + (y - o.y) * (t.y - o.y) > 0 && Math.hypot(x - o.x, y - o.y) < Math.hypot(t.x - o.x, t.y - o.y);
    const between = here.scene.buildings.filter(b => b.id !== o.atBuilding && onSight(b.x, b.y));
    const wallBetween = onSight(here.scene.hub.x, here.scene.hub.y);
    expect(between.length + Number(wallBetween)).toBeGreaterThan(0);
    const open = { ...here, requestId: digest(['TEST-without-occluders']), scene: { ...here.scene,
      hub: wallBetween ? { x: 1000, y: 1000 } : here.scene.hub,
      buildings: here.scene.buildings.filter(b => !between.includes(b)), entities: here.scene.entities.filter(e => !between.some(b => b.id === e.atBuilding)) } };
    expect(bodyRefs(await bridge.perceive(open))).toContain(hidden);

    // The real episode: the agent stays on day 0, cannot see the target on day 1 and steps; on
    // day 2, once the kernel has applied the move, the target is disclosed.
    const inputs: PerceptionAgentInput[] = [];
    const result = await runPerceptionEpisode({ episodeId: 'TEST-obscured', genesis, actors: ACTORS, ticks: 4, condition: DEFAULT_PERCEPTION_CONDITION,
      perspective: (agent, tick) => (agent === 'baker-0' && tick < 3 ? 'first_person' : 'isometric') }, {
      'baker-0': input => { inputs.push(input); return input.tick === 1 ? { ...stay(), move: step } : stay(); },
      'grifter-0': stay,
    }, req => bridge.perceive(req));
    const [, t1, t2, t3] = result.ticks;
    const rec = (tick: typeof t1, agent = 'baker-0') => tick!.records.find(r => r.agentId === agent)!;
    expect(t1!.worldHash).toBe(hash1); // the episode reproduces the scouted state
    expect(bodyRefs(rec(t1))).not.toContain(hidden);
    expect(t1!.verdicts['baker-0']!.code).toBe('admitted');
    expect(t1!.effects).toContainEqual({ person: bakerId, category: 'move' });
    expect(bodyRefs(rec(t2))).toContain(hidden);
    expect(rec(t2)).toMatchObject({ agentId: 'baker-0', tick: 2, worldHash: t1!.nextWorldHash, perspective: 'first_person' });
    expect(inputs.map(i => i.tick)).toEqual([0, 1, 2, 3]);
    expect(inputs[1]!.perception).toEqual(rec(t1).observation);
    expect(inputs[2]!.perception).toEqual(rec(t2).observation);
    expect(inputs[2]!.self).toMatchObject(step!);
    // The target stood still and the agent moved: ground truth from the replayed tape.
    const after = replay(result.tape, genesis.sourceRevision);
    expect(personBody(after, after.registry.people.get(targetId)!)).toMatchObject({ x: t.x, y: t.y });
    expect(personBody(after, after.registry.people.get(bakerId)!)).toMatchObject(step!);
    // The other agent's records are its own.
    for (const tick of result.ticks) expect(rec(tick, 'grifter-0')).toMatchObject({ agentId: 'grifter-0', tick: tick.tick, perspective: 'isometric' });

    // Switching perspective changes the content, not just the camera: from the same place the
    // overview carries counts and locations, and no references at all.
    const iso = rec(t3);
    expect(inputs[3]!.self).toMatchObject(step!);
    expect(JSON.stringify(iso.observation)).not.toContain(hidden);
    for (const e of here.scene.entities) expect(JSON.stringify(iso.observation)).not.toContain(e.ref!);
    const overview = iso.observation as { activity: { bodiesInOpen: number }[]; locations: unknown[] };
    expect(overview.activity.reduce((n, a) => n + a.bodiesInOpen, 0)).toBeGreaterThan(0);
    expect(overview.locations.length).toBeGreaterThan((rec(t2).observation as { locations: unknown[] }).locations.length);
  });

  it('fog limits first-person sight to the declared visibility, from the same position', async () => {
    // The observable case from the test above: day 1, the agent one step out, the target in view.
    const stay = () => ({ move: null, communication: null, diary: null, role: null });
    const scout = new ContinuationHost(genesis, ACTORS);
    scout.advance(scout.views(), { 'baker-0': stay(), 'grifter-0': stay() });
    const day1 = replay(scout.tape(), genesis.sourceRevision), bakerId = scout.identities()[0]!.person;
    const legal = observe(day1, bakerId, genesis.observerSecret).context.legalMoves;
    const look = (s: ParticipantState, c: PerceptionCondition, id: string) => bridge.perceive(perceptionRequest(s, { agentId: 'baker-0', person: bakerId },
      'first_person', c, { episodeId: `TEST-fog-${id}`, worldHash: scout.hash }));
    let at: ParticipantState | undefined, clear: PerceptionRecord | undefined;
    for (const m of legal) {
      const s = moved(day1, day1.registry.people.get(bakerId)!.location!, m.x, m.y), r = await look(s, DEFAULT_PERCEPTION_CONDITION, `${m.x},${m.y}`);
      if ((r.observation as { bodies: { distance: number }[] }).bodies.some(b => b.distance > 2)) { at = s; clear = r; break; }
    }
    expect(clear).toBeDefined();
    const far = (clear!.observation as { bodies: { ref: string; distance: number }[] }).bodies.filter(b => b.distance > 2).map(b => b.ref);
    const foggy = await look(at!, fog(2), 'fog');
    const seen = foggy.observation as { effectiveRange: number; bodies: { ref: string; distance: number }[]; environment: { weather: string } };
    expect(seen.effectiveRange).toBeCloseTo(2, 9);
    for (const ref of far) expect(seen.bodies.map(b => b.ref)).not.toContain(ref);
    for (const b of seen.bodies) expect(b.distance).toBeLessThanOrEqual(2);
    expect(seen.environment.weather).toBe('fog');
    expect(foggy.conditionId).toBe('perception-fog-2');
  });

  it('the Wall at the hub hides what stands behind it, like the buildings the client draws', async () => {
    const state = createParticipantState(genesis), baker = actor(state, 'Baker'), hash = evidenceHash(state);
    const real = perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, 'first_person', DEFAULT_PERCEPTION_CONDITION, { episodeId: 'TEST-wall', worldHash: hash });
    const { hub } = real.scene, e = real.scene.entities[0]!;
    // A hypothetical street with no buildings: the observer two plots south of the hub, a body two north.
    const street = (wallAt: { x: number; y: number }, id: string): PerceptionRequest => ({ ...real, requestId: digest(['TEST-wall', id]), scene: { ...real.scene,
      hub: wallAt, buildings: [], observer: { x: hub.x, y: hub.y - 2, districtId: real.scene.observer.districtId, atBuilding: null, inside: false },
      entities: [{ ...e, x: hub.x, y: hub.y + 2, atBuilding: null, inside: false }] } });
    expect(bodyRefs(await bridge.perceive(street(hub, 'behind')))).toEqual([]);
    expect(bodyRefs(await bridge.perceive(street({ x: hub.x + 50, y: hub.y + 50 }, 'gone')))).toEqual([e.ref]);
  });

  it('derives the same observation from the same request', async () => {
    const state = createParticipantState(genesis), baker = actor(state, 'Baker'), hash = evidenceHash(state);
    for (const p of ['first_person', 'isometric'] as const) {
      const req = perceptionRequest(state, { agentId: 'baker-0', person: baker.id }, p, DEFAULT_PERCEPTION_CONDITION, { episodeId: 'TEST-det-a', worldHash: hash });
      const again = { ...req, requestId: digest(['TEST-det-b', p]) };
      const [a, b] = [await bridge.perceive(req), await bridge.perceive(again)];
      expect(b.observation).toEqual(a.observation);
    }
  });
});
