import {expect,it} from 'vitest';
import {createWorld,stepWorld,DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import {settlementTolerance} from '../src/engine/settlement.js';
import type {SocietyEconomyPlan} from '../src/engine/societyEconomy.js';

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
