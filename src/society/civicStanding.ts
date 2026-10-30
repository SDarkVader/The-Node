/** Opt-in civic event projection from authenticated kernel outcomes.
 * Rumours, speech and diaries never create certified events. */
import { createHash } from 'node:crypto';
import type { DealingEvent } from '../engine/dealings.js';
import type { SocietyPurchaseReceipt } from '../engine/societyEconomy.js';
import { computeCivicReputation, civicReputationScore, type CivicReputationEvent } from '../engine/civicReputation.js';

const id = (day:number, kind:string, person:string) =>
  'civic:' + createHash('sha256').update(JSON.stringify([day,kind,person])).digest('hex');

/** A trial endowment is an offset, not an event and not part of notoriety. */
export const CIVIC_STANDING_BASELINE=civicReputationScore(1,0).standing;

/** One unit per verified achievement type per inhabitant/day, independently of quantity,
 * buyer count or event order. Mechanical providers have no person to receive credit. */
export function societyCivicEvents(day:number, dealings:readonly DealingEvent[], receipts:readonly SocietyPurchaseReceipt[], people:ReadonlySet<string>, missedWork:readonly string[]=[]): CivicReputationEvent[] {
  const events=new Map<string,CivicReputationEvent>();
  const add=(person:string,kind:string,domain:CivicReputationEvent['domain'],valence:CivicReputationEvent['valence'])=>{
    if(!people.has(person))return;
    const key=id(day,kind,person);
    events.set(key,{id:key,subjectId:person,day,domain,valence,weight:1});
  };
  for(const e of dealings){
    if(!(e.quantity>0))continue;
    const paid=e.kind==='purchase'&&e.outcome==='served'&&receipts.some(r=>r.customer===e.recipient&&r.bakerSite===e.providerSite&&r.outcome==='served'&&r.paid>0);
    if(e.provider && (paid ||
      (e.kind==='flourSupply'&&e.outcome==='supplied')))
      add(e.provider,e.kind,'service','positive');
    if(paid)add(e.recipient,'bread_bought','cooperation','positive');
  }
  for(const person of missedWork)add(person,'missed_work','service','negative');
  return [...events.values()].sort((a,b)=>a.id.localeCompare(b.id,'en'));
}
export function societyCivicScores(events:readonly CivicReputationEvent[], people:readonly string[]) {
  const profiles=computeCivicReputation(events);
  return new Map(people.map(person=>{
    const score=profiles.get(person)??civicReputationScore(0,0);
    return [person,{standing:CIVIC_STANDING_BASELINE+score.standing,notoriety:score.notoriety}] as const;
  }));
}
