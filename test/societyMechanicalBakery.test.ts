import {expect,it} from 'vitest';
import {clearSocietyMarket,type SocietyEconomyPlan} from '../src/engine/societyEconomy.js';
import {societyCivicEvents} from '../src/society/civicStanding.js';
import {createWorld,stepWorld,DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import {settlementTolerance} from '../src/engine/settlement.js';
import {DAILY_ACTIVITY_MULTIPLIER} from '../src/engine/wealth.js';

it('serves full customer orders up to 60% capacity with anonymous seller attribution',()=>{
  const customers=Array.from({length:12},(_,i)=>({identity:`customer-${i}`,site:`home-${i}`,wealth:10}));
  const result=clearSocietyMarket({seed:1,day:1,cycleDays:1,customers,
    bakers:[{identity:null,site:'mechanical-bakery',price:2,capacityMultiplier:0.6}],
    flour:[{identity:'miller',site:'mill',quantity:100}],choices:new Map(customers.map(c=>[c.identity,'mechanical-bakery'])),
    mechanicalChoices:new Set(customers.map(c=>c.identity))});
  expect(result.receipts.filter(r=>r.outcome==='served')).toHaveLength(7);
  expect(result.receipts.filter(r=>r.outcome==='capacity')).toHaveLength(5);
  expect(result.purchaseEvents.every(e=>e.provider===null)).toBe(true);
  expect(result.flourEvents).toEqual([]);
  expect(result.mechanicalFlourSupplies.every(e=>e.provider==='miller')).toBe(true);
  const events=societyCivicEvents(1,result.purchaseEvents,result.receipts,new Set(customers.map(c=>c.identity)));
  expect(events).toHaveLength(7);
  expect(events.every(e=>e.domain==='cooperation')).toBe(true);
});

it('still requires sufficient flour and buyer wealth for mechanical bread',()=>{
  const customers=[{identity:'customer',site:'home',wealth:10}];
  const market={seed:1,day:1,cycleDays:1,customers,
    bakers:[{identity:null,site:'mechanical-bakery',price:2,capacityMultiplier:0.6}],
    choices:new Map([['customer','mechanical-bakery']]),mechanicalChoices:new Set(['customer'])};
  expect(clearSocietyMarket({...market,flour:[]}).receipts[0]!.outcome).toBe('noFlour');
  expect(clearSocietyMarket({...market,customers:[{...customers[0]!,wealth:0}],flour:[{identity:'miller',site:'mill',quantity:100}]}).receipts[0]!.outcome).toBe('unaffordable');
});

it('never substitutes a different offer or price when a seller works or does not work',()=>{
  const customers=[{identity:'customer',site:'home',wealth:20}],choice=new Map([['customer','bakery']]);
  const input={seed:1,day:1,cycleDays:1,customers,flour:[{identity:'miller',site:'mill',quantity:100}],choices:choice};
  const personal={identity:'baker',site:'bakery',price:1,available:true};
  const mechanical={identity:null,site:'bakery',price:2,available:false,capacityMultiplier:0.6};
  const worked=[personal,mechanical],absent=[{...personal,available:false},{...mechanical,available:true}];
  const buyPersonal=clearSocietyMarket({...input,bakers:worked}).receipts[0]!;
  expect(buyPersonal).toMatchObject({outcome:'served',paid:expect.closeTo(DAILY_ACTIVITY_MULTIPLIER)});
  expect(clearSocietyMarket({...input,bakers:absent}).receipts[0]!.outcome).toBe('unavailable');
  const buyMechanical=clearSocietyMarket({...input,bakers:absent,mechanicalChoices:new Set(['customer'])}).receipts[0]!;
  expect(buyMechanical).toMatchObject({outcome:'served',paid:expect.closeTo(2*DAILY_ACTIVITY_MULTIPLIER)});
  expect(clearSocietyMarket({...input,bakers:worked,mechanicalChoices:new Set(['customer'])}).receipts[0]!.outcome).toBe('unavailable');
});

it.each(['assisted','backstopped'] as const)('offers mechanical bakery output with its own last posted price in %s mode',mode=>{
  const w=createWorld(103,{...DEFAULT_WORLD_CONFIG,rMiller:1,rBaker:2,rCourier:1,rInvestigator:1,rImportExport:1,
    targetPopulation:14,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0,purchaseCycleDays:1,recognition:'v2',noiseSigma:0});
  for(const slots of [w.millers,w.bakers,w.couriers,w.investigators,w.importExporters,w.grifters])for(const s of slots)s.wealth=8;
  const target=w.bakers[0]!,other=w.bakers[1]!;
  target.value=1.1;
  if(mode==='backstopped'){target.slot={state:'BACKSTOPPED',vacantSince:0};target.wealth=0;}
  const customers=[...w.millers,...w.bakers.filter(b=>b.slot.state==='FILLED'),...w.couriers,...w.investigators,...w.importExporters].map(s=>s.buildingId).concat(w.grifters.map(g=>g.id));
  const p:SocietyEconomyPlan={attendanceRequired:true,bakerPrices:new Map([[other.buildingId,1.8],...(mode==='assisted'?[[target.buildingId,1.1] as [string,number]]:[])]),
    millerQuantities:new Map([[w.millers[0]!.buildingId,0.8]]),breadChoices:new Map(customers.map(c=>[c,c===target.buildingId?null:target.buildingId])),
    working:new Set([w.millers[0]!.buildingId,other.buildingId,...w.couriers.map(x=>x.buildingId),...w.investigators.map(x=>x.buildingId),...w.importExporters.map(x=>x.buildingId)]),
    assisted:new Set(mode==='assisted'?[target.buildingId]:[]),mechanicalChoices:new Set(customers.filter(c=>c!==target.buildingId))};
  const result=stepWorld(w,undefined,p);
  expect(result.societyEconomy!.mechanicalPrices![target.buildingId]).toBe(1.1);
  expect(result.societyEconomy!.breadSold[target.buildingId]).toBeGreaterThan(0);
  expect(result.resources.today.breadProduced).toBeCloseTo(Object.values(result.societyEconomy!.breadSold).reduce((a,b)=>a+b,0),12);
  expect(result.resources.today.flourConsumed).toBeCloseTo(result.societyEconomy!.flourConsumed,12);
  expect(result.lastDealings!.filter(e=>e.kind==='purchase'&&e.providerSite===target.buildingId).every(e=>e.provider===null)).toBe(true);
  expect(Math.abs(result.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(result.lastSettlement));
  if(mode==='assisted')expect(result.completionStats[target.buildingId]!.completions).toBe(0);
});

it('does not invent a mechanical price when a bakery has no valid stored quote',()=>{
  const w=createWorld(103,{...DEFAULT_WORLD_CONFIG,rMiller:1,rBaker:2,rCourier:1,rInvestigator:1,rImportExport:1,
    targetPopulation:14,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0,purchaseCycleDays:1,recognition:'v2',noiseSigma:0});
  for(const slots of [w.millers,w.couriers,w.investigators,w.importExporters,w.grifters])for(const s of slots)s.wealth=8;
  for(const b of w.bakers){b.slot={state:'BACKSTOPPED',vacantSince:0};b.wealth=0;b.value=Number.NaN;}
  const target=w.bakers[0]!.buildingId;
  const customers=[...w.millers,...w.couriers,...w.investigators,...w.importExporters].map(s=>s.buildingId).concat(w.grifters.map(g=>g.id));
  const plan:SocietyEconomyPlan={attendanceRequired:true,bakerPrices:new Map(),millerQuantities:new Map([[w.millers[0]!.buildingId,0.8]]),
    breadChoices:new Map(customers.map(c=>[c,target])),mechanicalChoices:new Set(customers),working:new Set([w.millers[0]!.buildingId,...w.importExporters.map(x=>x.buildingId)])};
  const result=stepWorld(w,undefined,plan);
  expect(result.societyEconomy!.prices[target]).toBeUndefined();
  expect(result.societyEconomy!.breadSold[target]).toBe(0);
  expect(result.societyEconomy!.receipts.every(r=>r.outcome==='unavailable')).toBe(true);
});
