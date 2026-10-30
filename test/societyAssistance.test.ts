import {expect,it} from 'vitest';
import {createWorld,stepWorld,DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import {settlementTolerance} from '../src/engine/settlement.js';
import type {SocietyEconomyPlan} from '../src/engine/societyEconomy.js';
import {openCampaign} from '../src/engine/sabotageCampaign.js';
import {PARCELS_PER_COURIER_DAY,LEADS_PER_INVESTIGATOR_DAY} from '../src/engine/resources.js';
import {DAILY_ACTIVITY_MULTIPLIER} from '../src/engine/wealth.js';
import {COMPETITIVE_BACKSTOP_FRACTION} from '../src/engine/competitiveBackstop.js';

function fixture() {
  const w=createWorld(103,{...DEFAULT_WORLD_CONFIG,rMiller:1,rBaker:2,rCourier:1,rInvestigator:1,rImportExport:1,
    targetPopulation:14,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0,purchaseCycleDays:1,recognition:'v2',noiseSigma:0});
  for(const slots of [w.millers,w.bakers,w.couriers,w.investigators,w.importExporters,w.grifters])for(const s of slots)s.wealth=8;
  const people=[...w.millers,...w.bakers,...w.couriers,...w.investigators,...w.importExporters].map(s=>s.buildingId).concat(w.grifters.map(g=>g.id));
  const p:SocietyEconomyPlan={attendanceRequired:true,
    bakerPrices:new Map(w.bakers.map(b=>[b.buildingId,1.4])),millerQuantities:new Map(w.millers.map(m=>[m.buildingId,0.8])),
    breadChoices:new Map(people.map(person=>[person,person===w.bakers[0]!.buildingId?null:w.bakers[0]!.buildingId])),
    working:new Set([...w.bakers,...w.couriers,...w.investigators,...w.importExporters].map(s=>s.buildingId))};
  return {w,p};
}
it('uses anonymous mechanical flour and no occupant payment during inactive Miller assistance',()=>{
  const idle=fixture(),supported=fixture(),working=fixture();
  supported.p.assisted=new Set([supported.w.millers[0]!.buildingId]);
  (working.p.working as Set<string>).add(working.w.millers[0]!.buildingId);
  const a=stepWorld(idle.w,undefined,idle.p), b=stepWorld(supported.w,undefined,supported.p), c=stepWorld(working.w,undefined,working.p);
  expect(a.societyEconomy!.flourProduced).toBe(0);
  expect(b.societyEconomy!.flourProduced).toBeGreaterThan(0);
  expect(c.societyEconomy!.flourProduced).toBeGreaterThan(0);
  const flour=b.lastDealings!.filter(e=>e.kind==='flourSupply');
  expect(flour.length).toBeGreaterThan(0);
  expect(flour.every(e=>e.provider===null)).toBe(true);
  expect(b.millers[0]!.wealth).toBeLessThanOrEqual(supported.w.millers[0]!.wealth);
  expect(b.completionStats[b.millers[0]!.buildingId]!.completions).toBe(0);
  expect(Math.abs(b.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(b.lastSettlement));
});
it('does not combine a working Miller with additional mechanical supply',()=>{
  const base=fixture(),supported=fixture();
  for(const f of [base,supported])(f.p.working as Set<string>).add(f.w.millers[0]!.buildingId);
  supported.p.assisted=new Set([supported.w.millers[0]!.buildingId]);
  const a=stepWorld(base.w,undefined,base.p),b=stepWorld(supported.w,undefined,supported.p);
  expect(b.societyEconomy).toEqual(a.societyEconomy);
});
it('provides anonymous grain for an assisted inactive import/export business',()=>{
  const idle=fixture(),supported=fixture();
  for(const f of [idle,supported]){
    (f.p.working as Set<string>).add(f.w.millers[0]!.buildingId);
    (f.p.working as Set<string>).delete(f.w.importExporters[0]!.buildingId);
  }
  supported.p.assisted=new Set([supported.w.importExporters[0]!.buildingId]);
  const a=stepWorld(idle.w,undefined,idle.p),b=stepWorld(supported.w,undefined,supported.p);
  expect(a.resources.today.grainDelivered).toBe(0);
  expect(b.resources.today.grainDelivered).toBeGreaterThan(0);
  const supply=b.lastDealings!.filter(e=>e.kind==='grainSupply');
  expect(supply.length).toBeGreaterThan(0);
  expect(supply.every(e=>e.provider===null)).toBe(true);
  expect(b.completionStats[b.importExporters[0]!.buildingId]!.completions).toBe(0);
  expect(Math.abs(b.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(b.lastSettlement));
});
it('produces 60% anonymous parcels and leads without crediting inactive people',()=>{
  const active=fixture(),assisted=fixture();
  for(const f of [active,assisted]){
    (f.p.working as Set<string>).add(f.w.millers[0]!.buildingId);
    f.w.sabotageCampaigns=[openCampaign('existing',f.w.bakers[0]!.buildingId,f.w.tick)];
  }
  const courier=assisted.w.couriers[0]!,investigator=assisted.w.investigators[0]!;
  (assisted.p.working as Set<string>).delete(courier.buildingId);
  (assisted.p.working as Set<string>).delete(investigator.buildingId);
  assisted.p.assisted=new Set([courier.buildingId,investigator.buildingId]);
  const a=stepWorld(active.w,undefined,active.p),b=stepWorld(assisted.w,undefined,assisted.p);
  expect(b.resources.today.parcelsDelivered).toBeCloseTo(a.resources.today.parcelsDelivered*0.6,12);
  expect(b.resources.today.leadsDeveloped).toBeCloseTo(a.resources.today.leadsDeveloped*0.6,12);
  expect(b.resources.today.parcelsDelivered).toBeCloseTo(PARCELS_PER_COURIER_DAY*DAILY_ACTIVITY_MULTIPLIER*COMPETITIVE_BACKSTOP_FRACTION,12);
  expect(b.resources.today.leadsDeveloped).toBeCloseTo(LEADS_PER_INVESTIGATOR_DAY*DAILY_ACTIVITY_MULTIPLIER*COMPETITIVE_BACKSTOP_FRACTION,12);
  const delivery=b.lastDealings!.filter(e=>e.kind==='delivery'),evidence=b.lastDealings!.filter(e=>e.kind==='evidence');
  expect(delivery.length).toBeGreaterThan(0);expect(evidence).toHaveLength(0);
  expect([...delivery,...evidence].every(e=>e.provider===null)).toBe(true);
  expect(delivery.reduce((sum,e)=>sum+e.quantity,0)).toBeCloseTo(b.resources.today.parcelsDelivered,12);
  expect(b.lastSettlement.paid.courierPay).toBe(0);
  expect(b.completionStats[courier.buildingId]!.completions).toBe(0);
  expect(b.completionStats[investigator.buildingId]!.completions).toBe(0);
  expect(Math.abs(b.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(b.lastSettlement));
});
it('uses 60% for both supported and vacant trial roles but keeps the legacy 40% default',()=>{
  const legacy=fixture(),trial=fixture();
  for(const f of [legacy,trial]){
    for(const s of [f.w.millers[0]!,f.w.importExporters[0]!]) s.slot={state:'BACKSTOPPED',vacantSince:0};
    for(const s of [f.w.millers[0]!,f.w.importExporters[0]!]) f.w.grifters.push({id:`grifter-${f.w.nextGrifterId++}`,wealth:0,daysAsGrifter:0,x:s.x,y:s.y});
    f.p.bakerPrices=new Map(f.w.bakers.map(b=>[b.buildingId,1.4]));
    f.p.millerQuantities=new Map();
    f.p.working=new Set(f.w.bakers.map(b=>b.buildingId));
    f.p.breadChoices=new Map([...f.w.bakers,...f.w.couriers,...f.w.investigators,...f.w.grifters]
      .map(p=>['id' in p?p.id:p.buildingId,null]));
  }
  const a=stepWorld(legacy.w,undefined,{...legacy.p,working:new Set(),attendanceRequired:undefined}),b=stepWorld(trial.w,undefined,trial.p);
  expect(b.resources.today.grainDelivered).toBeCloseTo(a.resources.today.grainDelivered*1.5,12);
  expect(b.resources.today.flourProduced).toBeCloseTo(a.resources.today.flourProduced*1.5,12);
  expect(b.lastDealings!.filter(e=>e.kind==='flourSupply'||e.kind==='grainSupply').every(e=>e.provider===null)).toBe(true);
});
it('continues anonymous Courier and Investigator output after eviction',()=>{
  const f=fixture(),courier=f.w.couriers[0]!,investigator=f.w.investigators[0]!;
  for(const s of [courier,investigator]){
    s.slot={state:'BACKSTOPPED',vacantSince:0};
    f.w.grifters.push({id:`grifter-${f.w.nextGrifterId++}`,wealth:0,daysAsGrifter:0,x:s.x,y:s.y});
    (f.p.working as Set<string>).delete(s.buildingId);
  }
  (f.p.working as Set<string>).add(f.w.millers[0]!.buildingId);
  f.p.breadChoices=new Map([...f.w.millers,...f.w.bakers,...f.w.importExporters,...f.w.grifters]
    .map(p=>['id' in p?p.id:p.buildingId,'id' in p?f.w.bakers[0]!.buildingId:null]));
  f.w.sabotageCampaigns=[openCampaign('existing',f.w.bakers[0]!.buildingId,f.w.tick)];
  const after=stepWorld(f.w,undefined,f.p);
  expect(after.resources.today.parcelsDelivered).toBeCloseTo(0.6*PARCELS_PER_COURIER_DAY*DAILY_ACTIVITY_MULTIPLIER,12);
  expect(after.resources.today.leadsDeveloped).toBeCloseTo(0.6*LEADS_PER_INVESTIGATOR_DAY*DAILY_ACTIVITY_MULTIPLIER,12);
  const events=after.lastDealings!.filter(e=>e.kind==='delivery'||e.kind==='evidence');
  expect(events.some(e=>e.kind==='delivery')).toBe(true);
  expect(events.some(e=>e.kind==='evidence')).toBe(false);
  expect(events.every(e=>e.provider===null)).toBe(true);
});
