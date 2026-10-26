import { createHmac } from 'node:crypto';
import { resolvedSubjects, generateFace } from '../engine/identity.js';
import { resolvedBy } from '../engine/recognition.js';
import { roleArrays, type Inhabitant } from '../engine/inhabitants.js';
import { distance, proximityCloseness } from '../engine/space.js';
import { computeEconomicHeat } from '../engine/economicHeat.js';
import type { ParticipantState } from '../agent/participantWorld.js';
import type { DecisionContext } from '../agent/protocol.js';

const roles = {miller:'Miller', baker:'Baker', courier:'Courier', investigator:'Investigator', importExport:'ImportExport'} as const;
export function observerRef(secret: string, observer: string, subject: string, hexLength = 64): string {
  return createHmac('sha256', secret).update(JSON.stringify([observer, subject])).digest('hex').slice(0, hexLength);
}
/** Recognition-v2 worlds use 64-bit references (16 hex): still unguessable and uncorrelatable per
 *  observer, and they keep every request under the 32 KB fail-closed ceiling, where 64-hex
 *  references repeated across the people list and schema enums did not. v1 keeps 64 hex. */
export const refHexLength = (world: { config: { recognition?: 'v2' } }) => (world.config.recognition === 'v2' ? 16 : 64);
export function personBody(s: ParticipantState, p: Inhabitant) {
  if (!p.location) throw Error('departed');
  for (const [role, slots] of roleArrays(s.world)) {
    const slot = slots.find(x => x.buildingId === p.location && x.slot.state === 'FILLED');
    if (slot) return {x:slot.x, y:slot.y, role:roles[role], workplace:slot.buildingId,
      wealth:slot.wealth, stock:slot.personalResourceStock, price:role === 'baker' && 'value' in slot ? slot.value : null,
      progress:null};
  }
  const g = s.world.grifters.find(x => x.id === p.location);
  if (!g) throw Error('missing_body');
  return {x:g.x,y:g.y,role:'Grifter',workplace:null,wealth:g.wealth,stock:0,price:null,progress:g.reputationProgress ?? 0};
}

/** A detached authorized projection. Never calls readDiary or any RNG. */
export function observe(s: ParticipantState, personId: string, secret: string) {
  const self = s.registry.people.get(personId);
  if (!self || self.location === null) throw Error('departed');
  const ref = (id: string) => observerRef(secret, personId, id, refHexLength(s.world));
  const own = personBody(s, self);
  const district = s.world.shard.districts.find(d => d.plots.some(p => p.x === own.x && p.y === own.y));
  const legalMoves = district?.plots.filter(p => distance(own, p) === 1).map(p => ({x:p.x,y:p.y})) ?? [];
  const people = [...s.registry.people.values()].filter(p => p.location !== null).map(p => {
    const b = personBody(s, p);
    return {ref:ref(p.id),x:b.x,y:b.y,role:b.role};
  });
  // Recognition v2 when the world runs it; the person reference (ref) never changes either way.
  const resolved = s.world.recognitionV2 ? resolvedBy(s.world.recognitionV2.recognition.ledger, personId) : resolvedSubjects(s.world.identityLedger, personId);
  const known = [...resolved].filter(id => s.registry.people.get(id)?.location != null);
  const presentRefs = people.filter(p => p.ref !== ref(personId)).map(p => p.ref);
  // v2: who hears you now, by the kernel's own range rule (Manhattan distance through
  // `proximityCloseness`, as `buildProximityGraph` uses). Speech and moves resolve from where
  // everyone stands at this observation (moves apply after the day's speech), so each listed
  // person hears an address made to them.
  const hearingRefs = people.filter(p => p.ref !== ref(personId) &&
    proximityCloseness(Math.abs(p.x - own.x) + Math.abs(p.y - own.y), s.world.config.commsProximityRange) !== null).map(p => p.ref);
  const v2 = s.world.config.recognition === 'v2';
  const context: DecisionContext = {tick:s.world.tick,selfRef:ref(personId),role:own.role,roleEpoch:self.roleEpoch,
    legalMoves,presentRefs,knownSubjects:known.map(ref),
    ...(v2 ? {rules:'v2' as const,hearingRefs,...(s.world.config.diarySubjectOptional ? {diarySubjectOptional:true as const} : {})} : {})};
  const diary = (s.world.diary.get(personId) ?? []).filter(e => s.world.tick - e.createdOnDay < 2).map(e => ({
    subject:e.value.subject === null ? null : ref(e.value.subject),observation:e.value.observation,reading:e.value.reading,context:e.value.context ?? null,
  }));
  const rumours = s.world.lastRumourEvents.filter(e => e.heardBy === personId).map(e => ({source:ref(e.heardFrom),state:e.state,clarity:e.clarity}));
  const proximity = s.world.lastProximityConversations.filter(e => e.listenerId === personId).map(e => {
    // Only listener-degraded content; explicitly map references and omit source internals.
    const h = e.heard;
    return {speaker:ref(h.speakerId),intent:h.intent,tone:h.tone,clarity:h.clarity,
      referent:h.referent.kind === 'room' ? {kind:'room'} : {kind:'player',playerId:ref(h.referent.playerId)},context:h.context ?? null};
  });
  const heat = computeEconomicHeat(s.world);
  const plots = s.world.shard.districts.flatMap(d => d.plots);
  const xs = [s.world.shard.hubPlot.x,...plots.map(p => p.x)];
  const ys = [s.world.shard.hubPlot.y,...plots.map(p => p.y)];
  const projection = {tick:s.world.tick,self:{ref:ref(personId),...own,roleEpoch:self.roleEpoch},
    city:{day:s.world.tick,economicHealth:s.world.economicHealth,people,
      stations:roleArrays(s.world).flatMap(([, slots]) => slots.map(x => ({buildingId:x.buildingId,state:x.slot.state,heat:heat[x.buildingId] ?? 0}))),
      tension:s.world.shard.districts.map(d => ({districtId:d.id,tension:d.weatherHistory.at(-1)?.tension ?? 0}))},
    geometry:{hub:{x:s.world.shard.hubPlot.x,y:s.world.shard.hubPlot.y},
      bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)},
      districts:s.world.shard.districts.map(d => ({id:d.id,plots:d.plots.map(p => ({x:p.x,y:p.y,kind:p.kind})),
        buildings:d.buildings.map(b => ({id:b.id,x:b.x,y:b.y}))}))},
    recognition:known.map(id => ({ref:ref(id),face:generateFace(id)})),rumours,proximity,diary,legalMoves,
    ...(s.world.lastDealings ? {dealings:ownDealings(s, personId, ref)} : {}),
    ...(v2 ? {hearing:hearingRefs} : {})};
  return structuredClone({context,projection});
}

/**
 * Recognition v2: today's dealings this person took part in, and nothing else. The
 * counterparty is the same per-observer ref used everywhere; a mechanical (unstaffed) slot is
 * null. Internal quantities of a service (a Courier's parcels, an Investigator's leads) are
 * shown only to the one providing it, and an inquiry tells the person questioned nothing about
 * why. Ground truth (`world.lastDealings`) stays evaluator-only.
 */
function ownDealings(s: ParticipantState, me: string, ref: (id: string) => string) {
  const out: {kind:string;as:'provider'|'recipient'|'sender';counterparty:string|null;quantity:number|null;outcome:string}[] = [];
  const other = (id: string | null | undefined) => (id ? ref(id) : null);
  const goods = (kind: string) => kind === 'purchase' || kind === 'flourSupply' || kind === 'grainSupply';
  for (const e of s.world.lastDealings ?? []) {
    if (e.provider === me) out.push({kind:e.kind,as:'provider',counterparty:other(e.recipient),quantity:e.quantity,outcome:e.outcome});
    if (e.recipient === me) out.push({kind:e.kind === 'evidence' ? 'inquiry' : e.kind,as:'recipient',counterparty:other(e.provider),
      quantity:goods(e.kind) ? e.quantity : null,outcome:e.outcome});
    if (e.kind === 'delivery' && e.sender === me) out.push({kind:e.kind,as:'sender',counterparty:other(e.provider),quantity:null,outcome:e.outcome});
  }
  return out;
}
