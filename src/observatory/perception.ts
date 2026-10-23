/**
 * Agent-specific perception (2026-10-23, owner request): what one agent can perceive of the
 * authoritative Node world from its current perspective, derived by the Godot client.
 *
 * The Node stays authoritative. For one agent at one committed tick it builds a perception
 * REQUEST from the ParticipantState: public geometry, public station state, district weather
 * as bands, and the bodies present. First-person requests carry bodies under that observer's
 * own opaque references, the ones its authorized observation already uses; isometric requests
 * carry no references at all. No identity, wealth, diary, conversation, reasoning, real person
 * id or observer secret goes into any request, and bodies beyond the perspective's reach are not
 * sent. Godot (client/scripts/Perception.gd) derives what is perceivable with physics raycasts,
 * camera frustums and its fog model, and returns an OBSERVATION. The Node VALIDATES that
 * observation against the request it sent: Godot may select and measure, never invent, alter or
 * widen. Only a validated observation reaches the agent, bound to its agent id, tick,
 * perspective, request and world hash.
 *
 * Two perspectives, each with its own information limits, so switching changes the content:
 *   - first_person: individual bodies and locations within the visibility range, inside a
 *     camera frustum and on a clear line of sight; the local district's weather band.
 *   - isometric: an orthographic view of the agent's district. District weather bands,
 *     locations in view, counts of bodies in the open per district and the shard-wide health
 *     band. No references, individual positions or conversations.
 *
 * Occupancy follows IsoView: a role-holder standing at a building is INSIDE it. The walls hide
 * the body from first-person sight; the building shows as occupied, as IsoView's lit station
 * and roof sign do.
 *
 * WEATHER. The Node world has no physical weather: District Weather is an emotional-tension
 * signal (engine/districtWeather.ts), perceived here as a band. Optical visibility (clear or
 * fog) is a declared perception CONDITION, recorded with every observation and applied through
 * Godot's exponential fog model. It is not a world mechanic and is not derived from world state.
 */
import { createHash } from 'node:crypto';
import type { ParticipantState } from '../agent/participantWorld.js';
import { digest } from '../agent/replay.js';
import { observerRef, personBody, refHexLength } from '../server/observer.js';
import { helloMessage, tickMessage, type WireRole } from '../server/worldProtocol.js';

export const PERCEPTION_REQUEST_SCHEMA = 'node-perception-request-v1' as const;
export const PERCEPTION_SCHEMA = 'node-perception-observation-v1' as const;
export const PERCEPTION_RECORD_SCHEMA = 'node-perception-record-v1' as const;
/** Must equal Perception.gd's PROFILE: the derivation rules this contract was validated against. */
export const PERCEPTION_PROFILE = 'node-perception-godot-v1' as const;
export type Perspective = 'isometric' | 'first_person';
export const PERSPECTIVES: readonly Perspective[] = ['isometric', 'first_person'];
export type TensionBand = 'calm' | 'uneasy' | 'tense';
export type HeatBand = 'quiet' | 'busy' | 'hot';
export type HealthBand = 'strained' | 'steady' | 'thriving';
/** Height of the tallest structure the client draws (a landmark at full jitter is 2.23; the
 *  Wall is 1.9). */
const MAX_FEATURE_HEIGHT = 2.5;

export interface PerceptionCondition {
  schema: 'node-perception-condition-v1';
  id: string;
  /** maxRange in world units (one plot = 1). Four cameras face N/E/S/W; fov is per camera and
   *  slightly over 90 degrees so the ring has no seams. */
  firstPerson: { maxRange: number; fovDegrees: number };
  isometric: { span: number; yawDegrees: number; pitchDegrees: number };
  weather: { kind: 'clear' } | { kind: 'fog'; density: number; transmittanceThreshold: number };
  /** Band edges. Tension anchors are the clients' measured p05/median/p95 scale (WorldView.gd). */
  bands: { tension: [number, number]; heat: [number, number]; health: [number, number] };
}

export const DEFAULT_PERCEPTION_CONDITION: PerceptionCondition = Object.freeze({
  schema: 'node-perception-condition-v1', id: 'perception-default-clear-v1',
  firstPerson: { maxRange: 6, fovDegrees: 92 },
  isometric: { span: 9, yawDegrees: 45, pitchDegrees: 35.264 },
  weather: { kind: 'clear' },
  bands: { tension: [0.06, 0.10], heat: [0.15, 0.35], health: [0.5, 0.8] },
}) as PerceptionCondition;

/** Sight under the condition's weather: exponential fog transmits exp(-density·d), which falls
 *  to the threshold at d = -ln(threshold)/density. */
export function effectiveRange(c: PerceptionCondition): number {
  const r = c.firstPerson.maxRange;
  return c.weather.kind === 'fog' ? Math.min(r, -Math.log(c.weather.transmittanceThreshold) / c.weather.density) : r;
}

/** Furthest ground distance from the view centre an orthographic view of `span` can show, for a
 *  feature up to MAX_FEATURE_HEIGHT tall: the footprint is span wide and span/sin(pitch) deep. */
export function isometricReach(c: PerceptionCondition): number {
  const p = c.isometric.pitchDegrees * Math.PI / 180, half = c.isometric.span / 2;
  return Math.hypot(half, (half + MAX_FEATURE_HEIGHT * Math.cos(p)) / Math.sin(p));
}

export function validateCondition(c: PerceptionCondition): PerceptionCondition {
  const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const pair = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'number' && Number.isFinite(x)) && p[0]! < p[1]!;
  const w = c?.weather as Record<string, unknown> | undefined;
  const ok = c?.schema === 'node-perception-condition-v1' && typeof c.id === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(c.id) &&
    pos(c.firstPerson?.maxRange) && c.firstPerson.maxRange <= 32 && pos(c.firstPerson.fovDegrees) && c.firstPerson.fovDegrees >= 90 && c.firstPerson.fovDegrees < 120 &&
    pos(c.isometric?.span) && c.isometric.span <= 64 && Number.isFinite(c.isometric.yawDegrees) &&
    pos(c.isometric.pitchDegrees) && c.isometric.pitchDegrees < 90 &&
    (w?.kind === 'clear' || w?.kind === 'fog' && pos(w.density) && pos(w.transmittanceThreshold) && (w.transmittanceThreshold as number) < 1) &&
    pair(c.bands?.tension) && pair(c.bands.heat) && pair(c.bands.health);
  if (!ok) throw Error('perception_condition_invalid');
  return c;
}

const band3 = <T extends string>(v: number, [a, b]: [number, number], names: [T, T, T]): T => (v < a ? names[0] : v < b ? names[1] : names[2]);
const WIRE_ROLE: Record<string, WireRole | null> = { Baker: 'baker', Miller: 'miller', Courier: 'courier', Investigator: 'investigator', ImportExport: 'importExport', Grifter: null };

export interface SceneBuilding { id: string; x: number; y: number; role: WireRole | null; isLandmark: boolean; state: string | null; heatBand: HeatBand | null }
/** `ref` and `role` are null in isometric requests: that view reports neither. */
export interface SceneEntity { ref: string | null; x: number; y: number; role: WireRole | null; districtId: string | null; atBuilding: string | null; inside: boolean }
export interface PerceptionRequest {
  type: 'perceptionRequest';
  schema: typeof PERCEPTION_REQUEST_SCHEMA;
  requestId: string; episodeId: string; agentId: string; tick: number; worldHash: string;
  perspective: Perspective;
  condition: PerceptionCondition;
  scene: {
    /** The Wall stands here; it occludes and is never reported. */
    hub: { x: number; y: number };
    buildings: SceneBuilding[];
    districts: { id: string; plazaX: number; plazaY: number; tensionBand: TensionBand }[];
    observer: { x: number; y: number; districtId: string | null; atBuilding: string | null; inside: boolean };
    entities: SceneEntity[];
    environment: { economicHealthBand: HealthBand };
  };
}

type Location = { buildingId: string; role: WireRole | null; state: string | null; heatBand: HeatBand | null; occupied: boolean };
export interface FirstPersonObservation {
  effectiveRange: number;
  bodies: { ref: string; role: WireRole | null; dx: number; dy: number; distance: number }[];
  locations: (Location & { dx: number; dy: number; distance: number })[];
  environment: { localTensionBand: TensionBand | null; weather: PerceptionCondition['weather']['kind'] };
}
export interface IsometricObservation {
  view: { centerDistrictId: string | null; span: number };
  districts: { districtId: string; tensionBand: TensionBand }[];
  locations: Location[];
  activity: { districtId: string | null; bodiesInOpen: number }[];
  environment: { economicHealthBand: HealthBand; weather: PerceptionCondition['weather']['kind'] };
}
export interface PerceptionResponse {
  type: 'perception'; schema: typeof PERCEPTION_SCHEMA; profile: string;
  requestId: string; agentId: string; tick: number; worldHash: string; perspective: Perspective;
  engine: { name: string; version: string };
  observation: FirstPersonObservation | IsometricObservation;
  error?: string;
}
/** What the Node delivers to the agent, and records. */
export interface PerceptionRecord {
  schema: typeof PERCEPTION_RECORD_SCHEMA;
  requestId: string; episodeId: string; agentId: string; tick: number; worldHash: string; perspective: Perspective;
  conditionId: string; conditionDigest: string; profile: string; engine: { name: string; version: string };
  requestSha256: string; responseSha256: string;
  observation: FirstPersonObservation | IsometricObservation;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The perception request for one agent at the committed state `state`, whose evidence hash is
 *  `worldHash`. `observer.person` is the agent's real person id and never leaves the Node. */
export function perceptionRequest(state: ParticipantState, observer: { agentId: string; person: string }, perspective: Perspective,
    condition: PerceptionCondition, meta: { episodeId: string; worldHash: string }): PerceptionRequest {
  if (!PERSPECTIVES.includes(perspective)) throw Error('perception_perspective_unknown');
  validateCondition(condition);
  const world = state.world, hello = helloMessage(world);
  // tickMessage supplies the public station and weather values; its handles are discarded.
  const tick = tickMessage(world, 'perception-public-values');
  const station = new Map(tick.stations.map(s => [s.buildingId, s]));
  const tension = new Map(tick.districtTension.map(d => [d.districtId, d.tension]));
  const key = (x: number, y: number) => `${x},${y}`;
  const districtOf = new Map<string, string>();
  for (const d of world.shard.districts) for (const p of d.plots) districtOf.set(key(p.x, p.y), d.id);
  const buildingAt = new Map(hello.buildings.map(b => [key(b.x, b.y), b.id]));
  const self = state.registry.people.get(observer.person);
  if (!self || self.location === null) throw Error('perception_observer_absent');
  const own = personBody(state, self);
  const place = (x: number, y: number, role: WireRole | null) => {
    const atBuilding = buildingAt.get(key(x, y)) ?? null;
    return { districtId: districtOf.get(key(x, y)) ?? null, atBuilding, inside: role !== null && atBuilding !== null };
  };
  const districts = hello.districts.map(d => ({ id: d.id, plazaX: d.plazaX, plazaY: d.plazaY,
    tensionBand: band3(tension.get(d.id) ?? 0, condition.bands.tension, ['calm', 'uneasy', 'tense']) }));
  const observerPlace = { x: own.x, y: own.y, ...place(own.x, own.y, WIRE_ROLE[own.role] ?? null) };
  // Only bodies the perspective could possibly report are sent: Godot never holds the rest.
  const fp = perspective === 'first_person';
  const centre = districts.find(d => d.id === observerPlace.districtId);
  const [cx, cy, reach] = fp ? [own.x, own.y, effectiveRange(condition)] : [centre?.plazaX ?? own.x, centre?.plazaY ?? own.y, isometricReach(condition)];
  const entities: SceneEntity[] = [...state.registry.people.values()]
    .filter(p => p.location !== null && p.id !== observer.person)
    .map(p => {
      const b = personBody(state, p), role = WIRE_ROLE[b.role] ?? null;
      return { ref: fp ? observerRef(state.genesis.observerSecret, observer.person, p.id, refHexLength(world)) : null,
        x: b.x, y: b.y, role: fp ? role : null, ...place(b.x, b.y, role) };
    })
    .filter(e => Math.hypot(e.x - cx, e.y - cy) <= reach + 1e-9)
    // The order carries no registry information.
    .sort((a, b) => fp ? a.ref!.localeCompare(b.ref!) : (a.districtId ?? '').localeCompare(b.districtId ?? '') || a.x - b.x || a.y - b.y || Number(a.inside) - Number(b.inside));
  const buildings: SceneBuilding[] = hello.buildings.map(b => {
    const s = station.get(b.id);
    return { id: b.id, x: b.x, y: b.y, role: b.role, isLandmark: b.isLandmark, state: s?.state ?? null,
      heatBand: s ? band3<HeatBand>(s.heat, condition.bands.heat, ['quiet', 'busy', 'hot']) : null };
  });
  const requestId = digest([meta.episodeId, observer.agentId, world.tick, meta.worldHash, perspective, condition.id]);
  return {
    type: 'perceptionRequest', schema: PERCEPTION_REQUEST_SCHEMA, requestId, episodeId: meta.episodeId, agentId: observer.agentId,
    tick: world.tick, worldHash: meta.worldHash, perspective, condition: structuredClone(condition),
    scene: { hub: { ...hello.hub }, buildings, districts, observer: observerPlace, entities,
      environment: { economicHealthBand: band3(world.economicHealth, condition.bands.health, ['strained', 'steady', 'thriving']) } },
  };
}

const exactKeys = (o: unknown, keys: string[]) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const close = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) <= 1e-6;
const refuse = (code: string): never => { throw Error(code); };
const LOCATION_KEYS = ['buildingId', 'role', 'state', 'heatBand', 'occupied'];

/**
 * Accepts Godot's observation only if it is bound to this exact request and every reported item
 * exists in the request with the same public facts, inside the perspective's limits. Returns the
 * record the agent receives. Anything else is refused, never repaired. Godot decides what is
 * perceivable among the items sent; it cannot add one.
 */
export function validatePerception(request: PerceptionRequest, response: PerceptionResponse, rawResponse: string): PerceptionRecord {
  const r = response as PerceptionResponse & Record<string, unknown>;
  if (r?.type !== 'perception') refuse('perception_response_envelope');
  if (r.error !== undefined) refuse('perception_worker_error');
  if (r.schema !== PERCEPTION_SCHEMA) refuse('perception_response_envelope');
  if (r.requestId !== request.requestId || r.agentId !== request.agentId || r.tick !== request.tick ||
      r.worldHash !== request.worldHash || r.perspective !== request.perspective) refuse('perception_binding_mismatch');
  if (r.profile !== PERCEPTION_PROFILE) refuse('perception_profile_mismatch');
  if (!exactKeys(r, ['type', 'schema', 'profile', 'requestId', 'agentId', 'tick', 'worldHash', 'perspective', 'engine', 'observation']) ||
      !exactKeys(r.engine, ['name', 'version']) || typeof r.engine.name !== 'string' || typeof r.engine.version !== 'string') refuse('perception_response_fields');
  const scene = request.scene, o = r.observation as unknown as Record<string, any>;
  const building = new Map(scene.buildings.map(b => [b.id, b]));
  const occupied = new Set([scene.observer, ...scene.entities].filter(e => e.inside).map(e => e.atBuilding));
  const weather = request.condition.weather.kind;
  const unique = (xs: unknown[], code: string) => { if (new Set(xs).size !== xs.length) refuse(code); };
  const list = (x: unknown, code: string): any[] => (Array.isArray(x) ? x : refuse(code));
  const sameLocation = (l: any, extra: string[]) => {
    const b = building.get(l?.buildingId);
    if (!exactKeys(l, [...LOCATION_KEYS, ...extra]) || !b || l.role !== b.role || l.state !== b.state || l.heatBand !== b.heatBand ||
        l.occupied !== occupied.has(b.id)) refuse('perception_location_altered');
    return b!;
  };
  if (request.perspective === 'first_person') {
    if (!exactKeys(o, ['effectiveRange', 'bodies', 'locations', 'environment'])) refuse('perception_first_person_fields');
    const range = effectiveRange(request.condition);
    if (!close(o.effectiveRange, range)) refuse('perception_range_mismatch');
    const entity = new Map(scene.entities.map(e => [e.ref, e]));
    const bodies = list(o.bodies, 'perception_first_person_fields'), locations = list(o.locations, 'perception_first_person_fields');
    unique(bodies.map(b => b?.ref), 'perception_duplicate_body');
    for (const b of bodies) {
      const e = typeof b?.ref === 'string' ? entity.get(b.ref) : undefined;
      if (!exactKeys(b, ['ref', 'role', 'dx', 'dy', 'distance']) || !e) refuse('perception_unknown_body');
      const dx = e!.x - scene.observer.x, dy = e!.y - scene.observer.y;
      if (b.role !== e!.role || b.dx !== dx || b.dy !== dy || !close(b.distance, Math.hypot(dx, dy))) refuse('perception_body_altered');
      if (Math.hypot(dx, dy) > range + 1e-9) refuse('perception_body_beyond_range');
      // Walls hide a body inside a building from anyone not sharing its cell.
      if (e!.inside && (dx !== 0 || dy !== 0)) refuse('perception_body_inside_building');
    }
    unique(locations.map(l => l?.buildingId), 'perception_duplicate_location');
    for (const l of locations) {
      const b = sameLocation(l, ['dx', 'dy', 'distance']);
      const dx = b.x - scene.observer.x, dy = b.y - scene.observer.y;
      if (l.dx !== dx || l.dy !== dy || !close(l.distance, Math.hypot(dx, dy))) refuse('perception_location_altered');
      if (Math.hypot(dx, dy) > range + 1e-9) refuse('perception_location_beyond_range');
    }
    const local = scene.districts.find(d => d.id === scene.observer.districtId)?.tensionBand ?? null;
    if (!exactKeys(o.environment, ['localTensionBand', 'weather']) || o.environment.localTensionBand !== local ||
        o.environment.weather !== weather) refuse('perception_environment_mismatch');
  } else {
    if (!exactKeys(o, ['view', 'districts', 'locations', 'activity', 'environment'])) refuse('perception_isometric_fields');
    const centre = scene.districts.find(d => d.id === scene.observer.districtId);
    const [cx, cy] = centre ? [centre.plazaX, centre.plazaY] : [scene.observer.x, scene.observer.y];
    const reach = isometricReach(request.condition), within = (x: number, y: number) => Math.hypot(x - cx, y - cy) <= reach + 1e-9;
    if (!exactKeys(o.view, ['centerDistrictId', 'span']) || o.view.centerDistrictId !== scene.observer.districtId ||
        o.view.span !== request.condition.isometric.span) refuse('perception_view_mismatch');
    const districts = list(o.districts, 'perception_isometric_fields'), locations = list(o.locations, 'perception_isometric_fields'),
      activity = list(o.activity, 'perception_isometric_fields');
    unique(districts.map(d => d?.districtId), 'perception_duplicate_district');
    for (const d of districts) {
      const s = scene.districts.find(x => x.id === d?.districtId);
      if (!exactKeys(d, ['districtId', 'tensionBand']) || !s || d.tensionBand !== s.tensionBand) refuse('perception_district_altered');
      if (!within(s!.plazaX, s!.plazaY)) refuse('perception_beyond_view');
    }
    unique(locations.map(l => l?.buildingId), 'perception_duplicate_location');
    for (const l of locations) { const b = sameLocation(l, []); if (!within(b.x, b.y)) refuse('perception_beyond_view'); }
    unique(activity.map(a => a?.districtId), 'perception_duplicate_activity');
    for (const a of activity) {
      const open = scene.entities.filter(e => !e.inside && e.districtId === a?.districtId).length;
      if (!exactKeys(a, ['districtId', 'bodiesInOpen']) || (a.districtId !== null && !scene.districts.some(d => d.id === a.districtId)) ||
          !Number.isSafeInteger(a.bodiesInOpen) || a.bodiesInOpen < 1 || a.bodiesInOpen > open) refuse('perception_activity_invalid');
    }
    if (!exactKeys(o.environment, ['economicHealthBand', 'weather']) || o.environment.economicHealthBand !== scene.environment.economicHealthBand ||
        o.environment.weather !== weather) refuse('perception_environment_mismatch');
  }
  return {
    schema: PERCEPTION_RECORD_SCHEMA, requestId: request.requestId, episodeId: request.episodeId, agentId: request.agentId,
    tick: request.tick, worldHash: request.worldHash, perspective: request.perspective,
    conditionId: request.condition.id, conditionDigest: digest(request.condition), profile: r.profile as string, engine: { ...r.engine },
    requestSha256: sha256(JSON.stringify(request)), responseSha256: sha256(rawResponse),
    observation: structuredClone(r.observation),
  };
}
