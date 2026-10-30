/** Atomic, opt-in role claims. The caller supplies claims in the order their
 * decisions were admitted; stale identities or already-filled sites lose.
 * No new reputation gate, fee or scripted candidate selection is introduced. */
import { assertPopulation, roleArrays, transitionPerson } from '../engine/inhabitants.js';
import type { ParticipantState } from '../agent/participantWorld.js';
import type { RoleType, World } from '../world/world.js';

export interface RoleClaim { person:string; roleEpoch:number; buildingId:string }
export interface RoleClaimOutcome extends RoleClaim { status:'claimed'|'stale'|'unavailable'; role?:RoleType }

const keyFor=(role:RoleType):'millers'|'bakers'|'couriers'|'investigators'|'importExporters'=>
  role==='miller'?'millers':role==='baker'?'bakers':role==='courier'?'couriers':role==='investigator'?'investigators':'importExporters';

export function resolveRoleClaims(previous:ParticipantState, claims:readonly RoleClaim[], day:number):
  {state:ParticipantState;outcomes:RoleClaimOutcome[]} {
  if(!Number.isSafeInteger(day)||day<1)throw Error('society_claim_day');
  let state=previous;
  const outcomes:RoleClaimOutcome[]=[];
  for(const claim of claims){
    const person=state.registry.people.get(claim.person);
    if(!person||person.location===null||person.roleEpoch!==claim.roleEpoch){
      outcomes.push({...claim,status:'stale'});continue;
    }
    const target=roleArrays(state.world).flatMap(([role,slots])=>slots.map(slot=>({role,slot})))
      .find(q=>q.slot.buildingId===claim.buildingId);
    if(!target||target.slot.slot.state==='FILLED'||state.registry.locations.has(claim.buildingId)){
      outcomes.push({...claim,status:'unavailable'});continue;
    }
    const source=person.role===null?state.world.grifters.find(g=>g.id===person.location):
      roleArrays(state.world).find(([role])=>role===person.role)?.[1].find(s=>s.buildingId===person.location);
    if(!source)throw Error('society_claim_source');
    const wealth=source.wealth,position={x:source.x,y:source.y};
    const registry=structuredClone(state.registry);
    transitionPerson(registry,{from:person.location,to:claim.buildingId,role:target.role});
    let world:World={...state.world,grifters:person.role===null?state.world.grifters.filter(g=>g.id!==person.location):state.world.grifters};
    if(person.role!==null){
      const sourceKey=keyFor(person.role),old=world[sourceKey];
      world={...world,[sourceKey]:old.map(s=>s.buildingId===person.location?{...s,wealth:0,slot:{state:'VACANT' as const,vacantSince:day}}:s)};
    }
    const targetKey=keyFor(target.role),old=world[targetKey];
    world={...world,[targetKey]:old.map(s=>s.buildingId===claim.buildingId?{
      ...s,slot:{state:'FILLED' as const,vacantSince:null},wealth,personalResourceStock:0,daysSinceRestock:0,
      daysInRole:0,...position,...('experience' in s?{experience:0}:{}),
    }:s)};
    const stats={...world.completionStats};delete stats[claim.buildingId];
    world={...world,completionStats:stats};
    assertPopulation(world,registry);
    state={...state,world,registry};
    outcomes.push({...claim,status:'claimed',role:target.role});
  }
  return {state,outcomes};
}
