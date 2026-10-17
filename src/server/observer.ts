import { createHmac } from 'node:crypto';
import { resolvedSubjects, generateFace } from '../engine/identity.js';
import { roleArrays, type Inhabitant } from '../engine/inhabitants.js';
import { distance } from '../engine/space.js';
import { computeEconomicHeat } from '../engine/economicHeat.js';
import type { ParticipantState } from '../agent/participantWorld.js';
import type { DecisionContext } from '../agent/protocol.js';

const roles = {miller:'Miller', baker:'Baker', courier:'Courier', investigator:'Investigator', importExport:'ImportExport'} as const;
export function observerRef(secret: string, observer: string, subject: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([observer, subject])).digest('hex');
}
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
  const ref = (id: string) => observerRef(secret, personId, id);
  const own = personBody(s, self);
  const district = s.world.shard.districts.find(d => d.plots.some(p => p.x === own.x && p.y === own.y));
  const legalMoves = district?.plots.filter(p => distance(own, p) === 1).map(p => ({x:p.x,y:p.y})) ?? [];
  const people = [...s.registry.people.values()].filter(p => p.location !== null).map(p => {
    const b = personBody(s, p);
    return {ref:ref(p.id),x:b.x,y:b.y,role:b.role};
  });
  const known = [...resolvedSubjects(s.world.identityLedger, personId)].filter(id => s.registry.people.get(id)?.location != null);
  const context: DecisionContext = {tick:s.world.tick,selfRef:ref(personId),role:own.role,roleEpoch:self.roleEpoch,
    legalMoves,presentRefs:people.filter(p => p.ref !== ref(personId)).map(p => p.ref),knownSubjects:known.map(ref)};
  const diary = (s.world.diary.get(personId) ?? []).filter(e => s.world.tick - e.createdOnDay < 2).map(e => ({
    subject:ref(e.value.subject),observation:e.value.observation,reading:e.value.reading,context:e.value.context ?? null,
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
    recognition:known.map(id => ({ref:ref(id),face:generateFace(id)})),rumours,proximity,diary,legalMoves};
  return structuredClone({context,projection});
}
