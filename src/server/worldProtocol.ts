/**
 * The wire format for streaming a real `World` to a client (2026-08-19).
 *
 * Replaces the §8 MVP scenario the WebSocket scaffold has been broadcasting since Phase 3 —
 * two Bakers and a price spread, which was never the game, only proof the socket worked.
 * This is item 4 of HANDOVER's "THE DIRECTION": the server streaming a real world, the last
 * step before a Godot client has something worth rendering.
 *
 * PURE, AND DELIBERATELY SEPARATE FROM `ws.ts`. Same split the playtest harness already uses
 * (`playtestRenderer` pure / `playtestCli` I/O): every function here is a pure `World` ->
 * message transform, independently testable without opening a socket. `ws.ts` owns sockets,
 * timers and connection state; this file owns what a client is allowed to know.
 *
 * ============================ WHAT MAY GO ON THE WIRE ============================
 *
 * This is the load-bearing part, and it is a privacy boundary, not a serialization detail.
 * `World` holds plenty a player must never receive, and the playtest inspector's freedom with
 * that data is explicitly a designer's x-ray, not a precedent for a client protocol.
 *
 * PUBLIC — a real player standing in the node perceives these directly:
 *   - Geometry: plots, buildings, plaza, hub. The town is visible; that is what a town is.
 *   - Which building carries which role, and its slot state. A mill looks like a mill, and a
 *     mill nobody is running looks like one too.
 *   - Economic heat per building, tension per district. This is the whole "read the world,
 *     don't compute it" doctrine (`docs/VISUAL_FRAMEWORK_2026-08-12.md`) — ambient by design.
 *   - That a person is standing at a position. Bodies in a street are observable.
 *
 * WITHHELD — no client gets these, at any subscription level:
 *   - `wealth`, `personalResourceStock`, `experience`, `daysInRole`, `completionStats`.
 *     Another player's private economic state. The inspector shows them; the wire may not.
 *   - `wealthGini`. Not a thing anyone perceives — an analyst's measure of the whole shard.
 *   - Anything diary-shaped. `World.diary` is per-player private memory (constraint 4); it
 *     has its own trespass-gated read path by design and must never ride the ambient stream.
 *   - `sabotageCampaigns`. A campaign in progress is exactly what detection is supposed to be
 *     a game about. Streaming it would hand every client the answer for free.
 *
 * PSEUDONYMOUS — the Silhouette Shield's requirement, and the reason this file exists rather
 * than a naive `JSON.stringify(world)`:
 *   Identity resolution is PER-OBSERVER (`engine/identity.ts`) — you know someone once you
 *   have really encountered them enough times. So a person's real id may not be broadcast.
 *   But a client also cannot animate movement without something stable to track a body by.
 *
 *   Resolved with a per-connection `handle`: stable for as long as that connection lasts, so
 *   the client can interpolate a body smoothly between ticks, and deterministically derived
 *   from (connection secret, real id) so two different connections see two DIFFERENT handles
 *   for the same person and cannot correlate. A handle is not a name — resolving one to an
 *   actual identity is a separate, earned message (`IdentityResolvedMessage`), sent only for
 *   subjects that observer has genuinely resolved.
 *
 *   Getting this shape right NOW is the point of doing it here: retrofitting pseudonymity
 *   after a Godot client depends on real ids means changing the wire format under a
 *   dependent, which is the expensive version of this work.
 */

import type { World, RoleEconomicSlot, SupportRoleSlot } from '../world/world.js';
import type { SlotState } from '../engine/vacancy.js';
import { computeEconomicHeat } from '../engine/economicHeat.js';
import { generateFace, type ProceduralFace } from '../engine/identity.js';

/** Which role a building's slot carries. `null` for a building with no role slot at all —
 *  16 of the shipped config's 62, real structures that are purely housing. */
export type WireRole = 'miller' | 'baker' | 'courier' | 'investigator' | 'importExport';

export interface WireBuilding {
  id: string;
  x: number;
  y: number;
  role: WireRole | null;
  /**
   * A landmark plot (`space.ts`'s `LANDMARKS_PER_DISTRICT`, 3 per district, chosen by the
   * strongest texture-field magnitude). Real generated geometry that had never been read by
   * anything — it was added to the generator and left inert. Public because it is a fact about
   * the built environment: a landmark is visibly a landmark to anyone standing in the street.
   */
  isLandmark: boolean;
}

export interface WireDistrict {
  id: string;
  plazaX: number;
  plazaY: number;
}

/** Static geometry, sent once per connection. The settlement's shape does not change tick to
 *  tick — `stepWorld` mutates weather and population, never plots — so re-sending it every
 *  tick would be pure waste on the largest payload in the protocol. */
export interface WorldHelloMessage {
  type: 'hello';
  seed: number;
  hub: { x: number; y: number };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  districts: WireDistrict[];
  buildings: WireBuilding[];
  /** Every buildable plot, so a client can draw streets and open ground rather than guessing
   *  which cells are walkable from building positions alone. */
  plots: { x: number; y: number; kind: string; districtId: string }[];
}

export interface WireStation {
  buildingId: string;
  state: SlotState;
  /** 0..1, `economicHeat.ts`'s real per-building value. Ambient — see the header. */
  heat: number;
}

export interface WirePerson {
  /** Per-connection pseudonym. NOT a player id — see the header's PSEUDONYMOUS note. */
  handle: string;
  x: number;
  y: number;
  /** A role-holder's role reads off their station from across a plaza; a grifter has none.
   *  This is deliberately public: role is what a person is DOING, visible by where they work
   *  and what they carry, and it is the basis of the floating role-glyph in the visual brief. */
  role: WireRole | null;
}

export interface WorldTickMessage {
  type: 'tick';
  day: number;
  /** Shard-wide mood — the Wall's Emissive Soul reads off this. Ambient, public. */
  economicHealth: number;
  districtTension: { districtId: string; tension: number }[];
  stations: WireStation[];
  people: WirePerson[];
}

/** Sent when an observer has genuinely resolved a subject — the moment a silhouette becomes
 *  a face. Keyed by the same handle the tick stream uses, so a client can upgrade a body it
 *  is already tracking rather than swapping it for a different entity. */
export interface IdentityResolvedMessage {
  type: 'identityResolved';
  handle: string;
  /** No raw player id (2026-10-21): resolution can now lapse, and a raw id once sent could never
   *  be withdrawn. The handle is the client's stable reference; the face is what resolution adds. */
  face: ProceduralFace;
}

/** Recognition v2: an identity resolution has lapsed. Same handle as the `identityResolved`
 *  that granted it, so the client downgrades the body it is already tracking back to a
 *  silhouette; the underlying person (and handle) never changes, only the face is withdrawn. */
export interface IdentityLapsedMessage {
  type: 'identityLapsed';
  handle: string;
}

export type WorldMessage = WorldHelloMessage | WorldTickMessage | IdentityResolvedMessage | IdentityLapsedMessage;

/**
 * Stable, non-correlatable pseudonym for `realId` on one connection.
 *
 * `connectionSecret` must be unique per connection and never leave the server. Two connections
 * therefore derive different handles for the same person, so clients cannot compare notes to
 * unmask anyone — which would defeat the Silhouette Shield just as thoroughly as broadcasting
 * real ids, only less obviously.
 *
 * This is a non-cryptographic hash, and deliberately so: it is a correlation barrier between
 * ordinary clients, not a defence against an attacker who already has the server's memory. It
 * is NOT a substitute for real auth, which this scaffold still does not have.
 */
export function personHandle(connectionSecret: string, realId: string): string {
  let h = 0x811c9dc5;
  const input = `${connectionSecret} ${realId}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `p${h.toString(36)}`;
}

const ROLE_OF_ARRAY: { key: keyof Pick<World, 'millers' | 'bakers' | 'couriers' | 'investigators' | 'importExporters'>; role: WireRole }[] = [
  { key: 'millers', role: 'miller' },
  { key: 'bakers', role: 'baker' },
  { key: 'couriers', role: 'courier' },
  { key: 'investigators', role: 'investigator' },
  { key: 'importExporters', role: 'importExport' },
];

/** buildingId -> role, the only place that association exists (`space.ts` keeps
 *  `Building.roleSlotRef` deliberately opaque, so it cannot be read off the building). */
export function roleByBuildingId(world: World): Map<string, WireRole> {
  const map = new Map<string, WireRole>();
  for (const { key, role } of ROLE_OF_ARRAY) {
    for (const s of world[key] as readonly { buildingId: string }[]) map.set(s.buildingId, role);
  }
  return map;
}

export function helloMessage(world: World): WorldHelloMessage {
  const roles = roleByBuildingId(world);
  const buildings: WireBuilding[] = [];
  const plots: WorldHelloMessage['plots'] = [];
  const districts: WireDistrict[] = [];

  let minX = world.shard.hubPlot.x;
  let maxX = world.shard.hubPlot.x;
  let minY = world.shard.hubPlot.y;
  let maxY = world.shard.hubPlot.y;

  for (const d of world.shard.districts) {
    districts.push({ id: d.id, plazaX: d.plazaPlot.x, plazaY: d.plazaPlot.y });
    for (const b of d.buildings) {
      buildings.push({ id: b.id, x: b.x, y: b.y, role: roles.get(b.id) ?? null, isLandmark: b.isLandmark === true });
    }
    for (const p of d.plots) {
      plots.push({ x: p.x, y: p.y, kind: p.kind, districtId: d.id });
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  return {
    type: 'hello',
    seed: world.seed,
    hub: { x: world.shard.hubPlot.x, y: world.shard.hubPlot.y },
    bounds: { minX, maxX, minY, maxY },
    districts,
    buildings,
    plots,
  };
}

/**
 * One tick's public state, pseudonymized for a single connection.
 *
 * Only FILLED slots contribute a person: a VACANT or BACKSTOPPED slot has nobody standing in
 * it, and a BACKSTOPPED one in particular must not render as a body — the backstop is
 * explicitly mechanical, not a person (constraint 3), and drawing it as one would invent an
 * agent the design deliberately does not have. Its STATION still streams, and still shows as
 * held-but-quiet, which is exactly the intended read.
 */
export function tickMessage(world: World, connectionSecret: string): WorldTickMessage {
  const heat = computeEconomicHeat(world);
  const stations: WireStation[] = [];
  const people: WirePerson[] = [];

  for (const { key, role } of ROLE_OF_ARRAY) {
    for (const s of world[key] as readonly (RoleEconomicSlot | SupportRoleSlot)[]) {
      stations.push({ buildingId: s.buildingId, state: s.slot.state, heat: heat[s.buildingId] ?? 0 });
      if (s.slot.state !== 'FILLED') continue;
      people.push({ handle: personHandle(connectionSecret, s.buildingId), x: s.x, y: s.y, role });
    }
  }

  for (const g of world.grifters) {
    people.push({ handle: personHandle(connectionSecret, g.id), x: g.x, y: g.y, role: null });
  }

  const districtTension = world.shard.districts.map((d) => ({
    districtId: d.id,
    tension: d.weatherHistory.length > 0 ? d.weatherHistory[d.weatherHistory.length - 1]!.tension : 0,
  }));

  return {
    type: 'tick',
    day: world.tick,
    economicHealth: world.economicHealth,
    districtTension,
    stations,
    people,
  };
}

/**
 * Resolution messages for one observer — a silhouette becoming a face.
 *
 * `resolvedIds` is what the caller has established this observer genuinely knows; this
 * function does not decide that, deliberately. Resolution is `engine/identity.ts`'s job and
 * depends on real encounter counts, and a protocol module quietly inventing its own rule for
 * who knows whom is exactly how a privacy boundary rots.
 */
export function identityResolvedMessages(
  connectionSecret: string,
  resolvedIds: readonly string[],
): IdentityResolvedMessage[] {
  return resolvedIds.map((playerId) => ({
    type: 'identityResolved',
    handle: personHandle(connectionSecret, playerId),
    face: generateFace(playerId),
  }));
}

/**
 * Recognition v2: the messages that move one viewer's client from `before` to `after` resolved
 * sets — `identityResolved` for each newly resolved person, `identityLapsed` (same handle) for
 * each lapsed one. Pure; the caller supplies both sets from the recognition ledger, exactly as
 * for `identityResolvedMessages`.
 */
export function identityTransitionMessages(
  connectionSecret: string,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): Array<IdentityResolvedMessage | IdentityLapsedMessage> {
  const gained = [...after].filter((id) => !before.has(id)).sort();
  const lost = [...before].filter((id) => !after.has(id)).sort();
  return [
    ...identityResolvedMessages(connectionSecret, gained),
    ...lost.map((id) => ({ type: 'identityLapsed' as const, handle: personHandle(connectionSecret, id) })),
  ];
}
