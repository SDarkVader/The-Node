import { describe, expect, it } from 'vitest';
import { clearSocietyMarket, societyPurchaseDue, validateSocietyEconomyPlan, type SocietyEconomyPlan } from '../src/engine/societyEconomy.js';
import { allocatePurchases } from '../src/engine/dealings.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { DAILY_ACTIVITY_MULTIPLIER } from '../src/engine/wealth.js';
import { FLOUR_PER_BREAD } from '../src/engine/resources.js';
import { settlementTolerance } from '../src/engine/settlement.js';
import { createParticipantState, fixtureGenesis, stepParticipantState } from '../src/agent/participantWorld.js';
import { openCampaign } from '../src/engine/sabotageCampaign.js';

const U = DAILY_ACTIVITY_MULTIPLIER;
const customers = Array.from({ length: 20 }, (_, i) => ({ identity: `person-${i}`, site: `home-${i}`, wealth: 8 }));
const bakers = [{ identity: 'baker-a', site: 'a', price: 1.4 }, { identity: 'baker-b', site: 'b', price: 1.7 }];
const market = (overrides: Partial<Parameters<typeof clearSocietyMarket>[0]> = {}) => clearSocietyMarket({ seed: 103, day: 1, cycleDays: 1,
  customers, bakers, choices: new Map(customers.map((c) => [c.identity, 'a'])),
  flour: [{ identity: 'miller', site: 'mill', quantity: 9 }], ...overrides });

function world(): World {
  const w = createWorld(103, { ...DEFAULT_WORLD_CONFIG, rMiller: 1, rBaker: 2, rCourier: 1, rInvestigator: 1,
    rImportExport: 1, targetPopulation: 14, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0,
    purchaseCycleDays: 1, recognition: 'v2', noiseSigma: 0 });
  for (const slots of [w.millers, w.bakers, w.couriers, w.investigators, w.importExporters, w.grifters]) for (const s of slots) s.wealth = 8;
  return w;
}
function plan(w: World, choice: number | null = 0): SocietyEconomyPlan {
  const people = [...w.millers, ...w.bakers, ...w.couriers, ...w.investigators, ...w.importExporters].filter((s) => s.slot.state === 'FILLED')
    .map((s) => s.buildingId).concat(w.grifters.map((g) => g.id));
  return { bakerPrices: new Map(w.bakers.filter((s) => s.slot.state === 'FILLED').map((s, i) => [s.buildingId, i === 0 ? 1.4 : 1.7])),
    millerQuantities: new Map(w.millers.filter((s) => s.slot.state === 'FILLED').map((s) => [s.buildingId, 0.8])),
    working: new Set([...w.couriers, ...w.investigators, ...w.importExporters].filter((s) => s.slot.state === 'FILLED').map((s) => s.buildingId)),
    breadChoices: new Map(people.map((person) => [person, choice === null || person === w.bakers[choice]?.buildingId ? null : w.bakers[choice]!.buildingId])) };
}

describe('explicit society market', () => {
  it('keeps the existing stable weekly purchase day for the same personal identity', () => {
    for (let day = 0; day < 21; day++) {
      const legacy = allocatePurchases({ seed: 13, day, cycleDays: 7, maxPerBaker: 12, unitQuantity: U,
        customers: [{ identity: 'person', site: 'home' }], bakers: [bakers[0]!], regulars: new Map() });
      expect(societyPurchaseDue(13, day, 'person', 7)).toBe(legacy.events.length === 1);
    }
  });

  it('customer choice changes real sales, payments and supplier dealings; abstention makes none', () => {
    const a = market({ customers: customers.slice(0, 2) });
    const b = market({ customers: customers.slice(0, 2), choices: new Map(customers.map((c) => [c.identity, 'b'])) });
    const abstain = market({ choices: new Map() });
    expect(a.served).toEqual([2, 0]); expect(b.served).toEqual([0, 2]);
    expect(a.totalPayments).toBeCloseTo(2 * 1.4 * U); expect(b.totalPayments).toBeCloseTo(2 * 1.7 * U);
    expect(a.purchaseEvents.every((e) => e.provider === 'baker-a')).toBe(true);
    expect(a.flourEvents.reduce((s, e) => s + e.quantity, 0)).toBeCloseTo(2 * U * FLOUR_PER_BREAD);
    expect(abstain.served).toEqual([0, 0]); expect(abstain.purchaseEvents).toEqual([]); expect(abstain.millerSold.size).toBe(0);
  });

  it('finite physical flour binds sales, and no provider is credited for unproduced flour', () => {
    const result = market({ flour: [{ identity: 'm1', site: 'one', quantity: 0.08 }, { identity: null, site: 'backstop', quantity: 0.20 }] });
    expect(result.served).toEqual([2, 0]);
    expect(result.flourConsumed).toBeCloseTo(0.28);
    expect(result.millerSold.get('one')).toBeLessThanOrEqual(0.08 + 1e-12);
    expect(result.millerSold.get('backstop')).toBeLessThanOrEqual(0.20 + 1e-12);
    expect(result.receipts.filter((r) => r.outcome === 'noFlour').length).toBe(18);
    expect(result.flourEvents.some((e) => e.provider === null)).toBe(true);
  });

  it('enforces affordability and the existing twelve-customer service ceiling', () => {
    const poor = market({ customers: [{ identity: 'poor', site: 'home', wealth: 0 }], choices: new Map([['poor', 'a']]) });
    expect(poor.receipts[0]!.outcome).toBe('unaffordable'); expect(poor.totalPayments).toBe(0);
    expect(poor.purchaseEvents[0]!.outcome).toBe('turnedAway'); expect(poor.flourEvents).toEqual([]);
    const justShort = market({ customers: [{ identity: 'poor', site: 'home', wealth: 1.4 * U - 1e-13 }], choices: new Map([['poor', 'a']]) });
    expect(justShort.receipts[0]!.outcome).toBe('unaffordable'); expect(justShort.customerDebits.size).toBe(0);
    const capped = market();
    expect(capped.served).toEqual([12, 0]); expect(capped.receipts.filter((r) => r.outcome === 'capacity')).toHaveLength(8);
  });

  it('permits free bread inside existing price bounds without inventing customer funds', () => {
    const free = market({ customers: [{ identity: 'poor', site: 'home', wealth: 0 }],
      choices: new Map([['poor', 'a']]), bakers: [{ ...bakers[0]!, price: 0 }] });
    expect(free.receipts[0]!.outcome).toBe('served'); expect(free.totalPayments).toBe(0);
    expect(free.flourConsumed).toBeCloseTo(U * FLOUR_PER_BREAD);
  });

  it('is independent of customer list and choice-map insertion order', () => {
    const first = market();
    const second = market({ customers: [...customers].reverse(), choices: new Map([...customers].reverse().map((c) => [c.identity, 'a'])) });
    expect(second).toEqual(first);
  });
});

describe('opt-in kernel economy integration', () => {
  it('locks both competing Baker quotes and the one Miller quantity before real sales', () => {
    const before = world(), after = stepWorld(before, undefined, plan(before));
    expect(after.bakers.map((b) => b.value)).toEqual([1.4, 1.7]);
    expect(after.millers[0]!.value).toBe(0.8);
    expect(after.societyEconomy!.day).toBe(1);
    expect(after.societyEconomy!.receipts.some((r) => r.outcome === 'served')).toBe(true);
    expect(after.lastDealings!.filter((e) => e.kind === 'purchase' && e.outcome === 'served').every((e) => e.providerSite === before.bakers[0]!.buildingId)).toBe(true);
    expect(after.lastOracleStats.entered).toBe(0);
    expect(Math.abs(after.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(after.lastSettlement));
  });

  it('changing Miller supply changes clearing cost and actual flour-constrained bread capacity', () => {
    const low = world(), high = world();
    const lowPlan = plan(low), highPlan = plan(high);
    (lowPlan.millerQuantities as Map<string, number>).set(low.millers[0]!.buildingId, 0.2);
    (highPlan.millerQuantities as Map<string, number>).set(high.millers[0]!.buildingId, 1);
    const a = stepWorld(low, undefined, lowPlan), b = stepWorld(high, undefined, highPlan);
    expect(a.flourPrice).toBeGreaterThan(b.flourPrice);
    expect(a.societyEconomy!.flourConsumed).toBeLessThan(b.societyEconomy!.flourConsumed);
    for (const w of [a, b]) expect(w.societyEconomy!.flourConsumed).toBeLessThanOrEqual(w.societyEconomy!.flourProduced + 1e-12);
  });

  it('no customer sales means no Baker/Miller occupational completion or market pay', () => {
    const w = world(), next = stepWorld(w, undefined, plan(w, null));
    expect(next.societyEconomy!.customerPayments).toBe(0);
    expect(next.societyEconomy!.flourSold).toEqual({});
    expect(next.lastSettlement.paid.millerBakerIncome).toBe(0);
    for (const s of [...next.millers, ...next.bakers]) expect(next.completionStats[s.buildingId]!.completions).toBe(0);
  });

  it('inactive support workers receive no occupational pay, completion or output; grain input remains binding', () => {
    const w = world(), p = plan(w); p.working = new Set();
    const next = stepWorld(w, undefined, p);
    expect(next.resources.today.grainDelivered).toBe(0);
    expect(next.resources.today.flourProduced).toBe(0);
    expect(next.resources.today.breadProduced).toBe(0);
    expect(next.resources.today.parcelsDelivered).toBe(0);
    expect(next.resources.today.leadsDeveloped).toBe(0);
    expect(next.lastSettlement.paid.courierPay).toBe(0); expect(next.lastSettlement.paid.supportWage).toBe(0);
    for (const s of [...next.couriers, ...next.investigators, ...next.importExporters]) expect(next.completionStats[s.buildingId]!.completions).toBe(0);
  });

  it('Courier and Investigator work choices gate real deliveries, inquiry dealings and campaign coverage', () => {
    const idle = world(), working = world();
    for (const w of [idle, working]) w.sabotageCampaigns = [openCampaign('existing-campaign', w.bakers[0]!.buildingId, w.tick)];
    const idlePlan = plan(idle), workingPlan = plan(working);
    idlePlan.working = new Set(idle.importExporters.map((s) => s.buildingId));
    const a = stepWorld(idle, undefined, idlePlan), b = stepWorld(working, undefined, workingPlan);
    expect(a.lastDealings!.some((e) => e.kind === 'delivery' || e.kind === 'evidence')).toBe(false);
    expect(a.sabotageCampaigns[0]!.investigatedBy).toBeNull();
    expect(b.lastDealings!.some((e) => e.kind === 'delivery')).toBe(true);
    expect(b.lastDealings!.some((e) => e.kind === 'evidence')).toBe(true);
    expect(b.sabotageCampaigns[0]!.investigatedBy).toBe(working.investigators[0]!.buildingId);
    expect(b.lastDealings!.every((e) => e.tick === working.tick)).toBe(true);
  });

  it('a backstopped Import/Export still delivers mechanical grain when no person can work there', () => {
    const w = world(), berth = w.importExporters[0]!;
    berth.slot = { state: 'BACKSTOPPED', vacantSince: 0 };
    w.grifters.push({ id: `grifter-${w.nextGrifterId++}`, wealth: 0, daysAsGrifter: 0, x: berth.x, y: berth.y });
    const p = plan(w); p.working = new Set();
    const after = stepWorld(w, undefined, p);
    expect(after.resources.today.grainDelivered).toBeGreaterThan(0);
    expect(after.societyEconomy!.grainConsumed).toBeLessThanOrEqual(after.resources.today.grainDelivered + 1e-12);
    expect(after.lastDealings!.filter((e) => e.kind === 'grainSupply').every((e) => e.provider === null)).toBe(true);
    expect(Math.abs(after.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(after.lastSettlement));
  });

  it('mixed staffed and mechanical grain providers never deliver more than their own physical intake', () => {
    const w = createWorld(103, { ...world().config, rImportExport: 2 });
    for (const slots of [w.millers, w.bakers, w.couriers, w.investigators, w.importExporters, w.grifters]) for (const s of slots) s.wealth = 8;
    const berth = w.importExporters[1]!;
    berth.slot = { state: 'BACKSTOPPED', vacantSince: 0 };
    w.grifters.push({ id: `grifter-${w.nextGrifterId++}`, wealth: 0, daysAsGrifter: 0, x: berth.x, y: berth.y });
    const p = plan(w); (p.millerQuantities as Map<string, number>).set(w.millers[0]!.buildingId, 1);
    const after = stepWorld(w, undefined, p), events = after.lastDealings!.filter((e) => e.kind === 'grainSupply');
    const delivered = (site: string) => events.filter((e) => e.providerSite === site).reduce((sum, e) => sum + e.quantity, 0);
    expect(delivered(w.importExporters[0]!.buildingId)).toBeGreaterThan(0);
    expect(delivered(berth.buildingId)).toBeGreaterThan(0);
    expect(delivered(w.importExporters[0]!.buildingId)).toBeLessThanOrEqual(1.05 + 1e-12);
    expect(delivered(berth.buildingId)).toBeLessThanOrEqual(0.42 + 1e-12);
    expect(events.reduce((sum, e) => sum + e.quantity, 0)).toBeCloseTo(after.resources.today.grainConsumed);
    expect(Math.abs(after.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(after.lastSettlement));
  });

  it('rejects out-of-bounds/forged plans before advancing shared RNG or mutating the world', () => {
    const w = world(), pristine = world(), p = plan(w);
    for (const price of [-0.01, 2.01, NaN, Infinity]) {
      const bad = { ...p, bakerPrices: new Map([[w.bakers[0]!.buildingId, price]]) };
      expect(() => stepWorld(w, undefined, bad)).toThrow('invalid_society_price');
    }
    for (const quantity of [0, 1.01, NaN, Infinity]) expect(() => validateSocietyEconomyPlan({ ...p,
      millerQuantities: new Map([[w.millers[0]!.buildingId, quantity]]) })).toThrow('invalid_society_quantity');
    expect(() => stepWorld(w, undefined, { ...p, bakerPrices: new Map([['forged', 1]]) })).toThrow('invalid_society_baker');
    expect(() => stepWorld(w, undefined, { ...p, breadChoices: new Map([['forged', w.bakers[0]!.buildingId]]) })).toThrow('invalid_society_customer_choice');
    expect(() => stepWorld(w, undefined, { ...p, breadChoices: new Map([[w.bakers[0]!.buildingId, w.bakers[0]!.buildingId]]) })).toThrow('invalid_society_self_purchase');
    expect(stepWorld(w, undefined, p).societyEconomy).toEqual(stepWorld(pristine, undefined, plan(pristine)).societyEconomy);
  });

  it('multiple deterministic days balance all money and physical flows without phantom dealings', () => {
    const run = () => {
      let w = world(); const evidence = [];
      for (let day = 0; day < 12; day++) {
        w = stepWorld(w, undefined, plan(w, day % 3 === 2 ? null : day % 2));
        const e = w.societyEconomy!;
        expect(e.grainConsumed).toBeLessThanOrEqual(e.grainAvailable + 1e-12);
        expect(e.flourConsumed).toBeLessThanOrEqual(e.flourProduced + 1e-12);
        expect(w.resources.today.flourConsumed).toBeCloseTo(e.flourConsumed);
        expect(w.lastDealings!.filter((x) => x.kind === 'purchase' && x.outcome === 'served')).toHaveLength(e.receipts.filter((r) => r.outcome === 'served').length);
        expect(Math.abs(w.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(w.lastSettlement));
        evidence.push({ economy: e, ledger: w.lastSettlement, completion: w.completionStats });
      }
      return evidence;
    };
    expect(run()).toEqual(run());
  });

  it('mechanical Miller coverage remains physical supply without an invented payee or completion', () => {
    const w = world(), mill = w.millers[0]!;
    mill.slot = { state: 'BACKSTOPPED', vacantSince: 0 };
    w.grifters.push({ id: `grifter-${w.nextGrifterId++}`, wealth: 0, daysAsGrifter: 0, x: mill.x, y: mill.y });
    const after = stepWorld(w, undefined, plan(w));
    expect(after.resources.today.flourProduced).toBeGreaterThan(0);
    expect(after.societyEconomy!.flourConsumed).toBeLessThanOrEqual(after.societyEconomy!.flourProduced + 1e-12);
    expect(after.lastDealings!.filter((e) => e.kind === 'flourSupply').some((e) => e.provider === null)).toBe(true);
    expect(after.lastSettlement.paid.millerBakerIncome).toBeGreaterThanOrEqual(0);
    expect(after.completionStats[mill.buildingId]?.completions ?? 0).toBe(0);
    expect(Math.abs(after.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(after.lastSettlement));
  });

  it('stable participant identities survive vacancies and replacement without inheriting workplace actions', () => {
    const genesis = fixtureGenesis(203, { ...world().config, pMonthly: 0.95 });
    let state = createParticipantState(genesis);
    for (let day = 0; day < 60; day++) {
      const p = plan(state.world, day % 2);
      // The public null commitment retains the occupant's current default, including a
      // newly assigned Miller's legal initial quantity on the day after replacement.
      p.millerQuantities = new Map(state.world.millers.filter((s) => s.slot.state === 'FILLED').map((s) => [s.buildingId, s.value]));
      p.breadChoices = new Map([...state.registry.people.values()].filter((person) => person.location !== null).map((person) => {
        const baker = state.world.bakers.find((b) => b.slot.state === 'FILLED' && b.buildingId !== person.location);
        return [person.id, baker?.buildingId ?? null];
      }));
      state = stepParticipantState(state, [], [], p).state;
      const e = state.world.societyEconomy!;
      expect(e.flourConsumed).toBeLessThanOrEqual(e.flourProduced + 1e-12);
      for (const miller of state.world.millers.filter((s) => s.slot.state === 'FILLED')) {
        expect(miller.value).toBeGreaterThanOrEqual(0.01); expect(miller.value).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(state.world.lastSettlement.residual)).toBeLessThanOrEqual(settlementTolerance(state.world.lastSettlement));
    }
    expect([...state.registry.people.values()].some((person) => person.roleEpoch > 0)).toBe(true);
  });
});
