/** Reputation-triggered business support. This book is separate from the
 * legacy vacancy slot because an incumbent still owns the role during grace.
 * All transitions are driven by completed game days, never provider timeouts.
 */
import { assertPopulation, roleArrays, transitionPerson } from '../engine/inhabitants.js';
import type { ParticipantState } from '../agent/participantWorld.js';
import type { RoleType } from '../world/world.js';

export interface BackstopIncumbent {
  person: string;
  role: RoleType;
  roleEpoch: number;
  businessId: string;
  standingBefore: number;
  standingAfter: number;
}
export interface ReputationIntervention {
  person: string;
  role: RoleType;
  roleEpoch: number;
  businessId: string;
  startedDay: number;
}
export interface BackstopOutcome {
  active: ReputationIntervention[];
  started: ReputationIntervention[];
  recovered: ReputationIntervention[];
  expired: ReputationIntervention[];
}

/** A score crossing zero starts assistance. A fresh zero is not a loss.
 * Recovery above zero during the following three completed days stops the
 * intervention; a person still at or below zero after day three is evicted.
 * Changed occupant/role epochs invalidate the old intervention.
 */
export function stepReputationBackstops(
  previous: readonly ReputationIntervention[], incumbents: readonly BackstopIncumbent[], day: number,
): BackstopOutcome {
  if (!Number.isSafeInteger(day) || day < 1) throw Error('society_backstop_day');
  const byBusiness = new Map<string,BackstopIncumbent>();
  for (const item of incumbents) {
    if (!item.person || !item.businessId || !Number.isSafeInteger(item.roleEpoch) ||
      !Number.isFinite(item.standingBefore) || !Number.isFinite(item.standingAfter) || byBusiness.has(item.businessId))
      throw Error('society_backstop_incumbent');
    byBusiness.set(item.businessId,item);
  }
  const active:ReputationIntervention[]=[],started:ReputationIntervention[]=[],recovered:ReputationIntervention[]=[],expired:ReputationIntervention[]=[];
  const seen=new Set<string>(), tracked=new Set<string>();
  for (const current of previous) {
    if (tracked.has(current.businessId) || !Number.isSafeInteger(current.startedDay) || current.startedDay >= day)
      throw Error('society_backstop_history');
    tracked.add(current.businessId);
    const occupant=byBusiness.get(current.businessId);
    if (!occupant || occupant.person!==current.person || occupant.role!==current.role || occupant.roleEpoch!==current.roleEpoch) continue;
    seen.add(current.businessId);
    if (occupant.standingAfter>0) recovered.push(current);
    else if (day-current.startedDay>=3) expired.push(current);
    else active.push(current);
  }
  for (const occupant of incumbents) {
    if (seen.has(occupant.businessId)) continue;
    if (occupant.standingBefore>0 && occupant.standingAfter<=0) {
      const item={person:occupant.person,role:occupant.role,roleEpoch:occupant.roleEpoch,businessId:occupant.businessId,startedDay:day};
      active.push(item); started.push(item);
    }
  }
  const sort=(items:ReputationIntervention[])=>items.sort((a,b)=>a.businessId<b.businessId?-1:a.businessId>b.businessId?1:0);
  return {active:sort(active),started:sort(started),recovered:sort(recovered),expired:sort(expired)};
}

/** Move an expired incumbent to the real roleless pool. Transfer personal
 * wealth with the person and keep the former business mechanically backstopped.
 * Other role-specific stock remains with the business, as in existing eviction.
 */
export function evictBackstoppedOccupant(
  previous: ParticipantState, item: Pick<ReputationIntervention,'person'|'role'|'roleEpoch'|'businessId'>, day:number,
): ParticipantState {
  if (!Number.isSafeInteger(day) || day < 1) throw Error('society_backstop_day');
  const person=previous.registry.people.get(item.person);
  if (!person || person.location!==item.businessId || person.role!==item.role || person.roleEpoch!==item.roleEpoch)
    throw Error('society_backstop_stale_incumbent');
  const found=roleArrays(previous.world).find(([role])=>role===item.role)?.[1].find(s=>s.buildingId===item.businessId);
  if (!found || found.slot.state!=='FILLED') throw Error('society_backstop_stale_business');
  const key=item.role==='miller'?'millers':item.role==='baker'?'bakers':item.role==='courier'?'couriers':item.role==='investigator'?'investigators':'importExporters';
  const grifterId=`grifter-${previous.world.nextGrifterId}`;
  if (previous.registry.locations.has(grifterId) || previous.world.grifters.some(g=>g.id===grifterId)) throw Error('society_backstop_grifter_collision');
  const registry=structuredClone(previous.registry);
  transitionPerson(registry,{from:item.businessId,to:grifterId,role:null});
  const district=previous.world.shard.districts.find(d=>d.plots.some(p=>p.x===found.x&&p.y===found.y));
  const world={...previous.world,
    [key]:previous.world[key].map(s=>s.buildingId===item.businessId?{...s,wealth:0,slot:{state:'BACKSTOPPED' as const,vacantSince:day}}:s),
    grifters:[...previous.world.grifters,{id:grifterId,wealth:found.wealth,daysAsGrifter:0,x:found.x,y:found.y,...(district?{districtId:district.id}:{})}],
    nextGrifterId:previous.world.nextGrifterId+1,
  };
  assertPopulation(world,registry);
  return {...previous,world,registry};
}
