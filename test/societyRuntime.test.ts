import { describe, expect, it } from 'vitest';
import { Society, verifySocietyTape, type SocietyTape } from '../src/society/runtime.js';
import { autonomousPolicy, emptySocietyAction } from '../src/society/policy.js';
import { SocietySecurityError } from '../src/society/boundary.js';
import type { SocietyEconomyDay } from '../src/engine/societyEconomy.js';
import { FLOUR_PER_BREAD } from '../src/engine/resources.js';

const sourceRevision = 'a'.repeat(40);

/** The simulated model and autonomous residents receive the identical actual boundary.
 * No action, draw, actor position, vacancy, environmental event or inventory is injected. */
function run(days = 14, seed = 20261025) {
  const society = new Society({ seed, sourceRevision });
  while (society.tick < days) {
    const pending = society.pendingPeople();
    expect(pending.length).toBeGreaterThan(0);
    for (const person of pending) {
      const context = society.view(person).visible;
      society.submit(person, JSON.stringify(autonomousPolicy(context)));
    }
  }
  return { society, tape: society.exportTape() };
}

describe('secure society complete offline loop', () => {
  it('runs two competing Bakers, one deciding Miller and autonomous holders of every other role under the same rules', () => {
    const { society, tape } = run();
    const controlled = tape.decisions.filter(d => d.controlled);
    const initialRoles = controlled.filter(d => d.day === 1 && d.phase === 'commit').map(d => d.visible.self.role).sort();
    expect(initialRoles).toEqual(['Baker', 'Baker', 'Miller']);
    expect(tape.controlled).toHaveLength(3);
    expect(tape.transitions).toHaveLength(14);
    expect(society.halted).toBe(false);
    const autonomous = tape.decisions.filter(d => !d.controlled && d.phase === 'act');
    expect(new Set(autonomous.map(d => d.visible.self.role))).toEqual(new Set(['Courier', 'Investigator', 'ImportExport', 'Grifter']));
    for (const role of ['Courier', 'Investigator', 'ImportExport']) {
      expect(autonomous.some(d => d.visible.self.role === role && d.action.occupation?.kind === 'work')).toBe(true);
    }
    expect(tape.decisions.some(d => d.action.move !== null)).toBe(true);
    expect(tape.decisions.some(d => d.action.communication?.kind === 'wallPost')).toBe(true);
    expect(tape.decisions.some(d => d.action.communication?.kind === 'proximityUtterance')).toBe(true);
    expect(tape.decisions.some(d => d.visible.heard.length > 0)).toBe(true);
    expect(tape.decisions.some(d => d.action.diary !== null)).toBe(true);
    expect(tape.decisions.some(d => d.visible.self.role === 'Miller' && d.action.purchase !== null)).toBe(true);

    const quotes = new Map<number, Map<string, number>>();
    for (const decision of tape.decisions) {
      if (decision.phase !== 'commit' || decision.action.occupation?.kind !== 'bakerPrice') continue;
      const day = quotes.get(decision.day) ?? new Map<string, number>();
      day.set(decision.visible.self.workplace!, decision.action.occupation.price);
      quotes.set(decision.day, day);
    }
    expect([...quotes.values()].some(q => new Set(q.values()).size > 1)).toBe(true);
    for (const decision of tape.decisions.filter(d => d.phase === 'act')) {
      for (const offer of decision.visible.wall.prices) {
        expect(offer.price).toBe(quotes.get(decision.day)!.get(offer.buildingId));
      }
    }
    const days = tape.transitions.map(t => t.economy as SocietyEconomyDay);
    expect(days.some(d => d.receipts.some(r => r.outcome === 'served'))).toBe(true);
    expect(new Set(days.flatMap(d => Object.values(d.quantities))).size).toBeGreaterThan(1);
    expect(new Set(controlled.filter(d => d.visible.self.role === 'Baker').map(d => d.visible.self.flourCost)).size).toBeGreaterThan(1);
    for (const day of days) {
      expect(day.grainConsumed).toBeLessThanOrEqual(day.grainAvailable + 1e-9);
      expect(day.flourConsumed).toBeLessThanOrEqual(day.flourProduced + 1e-9);
      expect(Object.values(day.breadSold).reduce((a, b) => a + b, 0) * FLOUR_PER_BREAD).toBeCloseTo(day.flourConsumed, 10);
      expect(day.receipts.reduce((sum, r) => sum + r.paid, 0)).toBeCloseTo(day.customerPayments, 10);
    }
    const oracle = tape.transitions.flatMap(t => t.oracle);
    expect(oracle.some(e => e.result.status === 'entered')).toBe(true);
    expect(oracle.some(e => e.result.won)).toBe(true);
    expect(oracle.some(e => e.result.prize === 'entryVoucher')).toBe(true);
    expect(oracle.some(e => e.result.fundedBy === 'voucher')).toBe(true);
    for (const transition of tape.transitions) {
      expect(Math.abs(transition.accounting.residual)).toBeLessThan(1e-7);
      expect(Math.abs(transition.accounting.oracleResidual)).toBeLessThan(1e-8);
    }
  });

  it('observes natural District Weather changes over sixty ticks with the same declared seed and ordinary churn', () => {
    // At fourteen ticks this seed has calm weather throughout. A longer unmodified run,
    // rather than a forced weather event or a different seed, covers the changing context.
    const { tape } = run(60);
    expect(new Set(tape.transitions.flatMap(t => t.conditions.map(c => c.tension))).size).toBeGreaterThan(1);
    expect(new Set(tape.decisions.map(d => d.visible.local.districtWeather)).size).toBeGreaterThan(1);
    expect(tape.decisions.some(d => d.visible.local.locations.some(l => l.heat !== 'none'))).toBe(true);
    expect(verifySocietyTape(tape).verified).toBe(true);
    for (const transition of tape.transitions) expect(Math.abs(transition.accounting.residual)).toBeLessThan(1e-7);
  }, 15_000);

  it('records exact inhabitant contexts and submitted choices, and independently reproduces the whole run', () => {
    const { society, tape } = run();
    const repeated = run().tape;
    expect(repeated).toEqual(tape);
    expect(verifySocietyTape(tape, sourceRevision)).toEqual({
      verified: true, ticks: 14, decisions: tape.decisions.length, finalHash: society.hash,
    });
    expect(tape.transitions.at(-1)!.afterHash).toBe(society.hash);
    for (const decision of tape.decisions) {
      expect(decision.legalChoices).toEqual({ menu: decision.visible.legalChoices, schema: decision.visible.decisionSchema });
      const bytes = JSON.stringify(decision.visible);
      for (const forbidden of [tape.genesis.observerSecret, sourceRevision, 'worldHash', 'sourceRevision', 'requestId', 'packageInformation']) {
        expect(bytes).not.toContain(forbidden);
      }
    }
  });

  it('halts on an illegal host-shaped or repricing action before any world transition', () => {
    for (const proposal of [
      { ...emptySocietyAction(), tool_calls: [{ name: 'read_file', arguments: {} }] },
      'not JSON',
      { ...emptySocietyAction(), move: { x: 99999, y: 99999 } },
    ]) {
      const society = new Society({ seed: 3, sourceRevision });
      const hash = society.hash, tick = society.tick, person = society.pendingPeople()[0]!;
      expect(() => society.submit(person, proposal)).toThrow(SocietySecurityError);
      expect(society.halted).toBe(true);
      expect(society.tick).toBe(tick);
      expect(society.hash).toBe(hash);
      expect(society.exportTape().transitions).toEqual([]);
      expect(() => society.submit(person, emptySocietyAction())).toThrow('society_halted');
      expect(() => society.view(person)).toThrow('society_no_current_observation');
    }
    const society = new Society({ seed: 3, sourceRevision });
    for (const person of society.pendingPeople()) society.submit(person, emptySocietyAction());
    expect(society.phase).toBe('act');
    const baker = society.pendingPeople().find(p => society.view(p).visible.self.role === 'Baker')!;
    const hash = society.hash;
    expect(() => society.submit(baker, { ...emptySocietyAction(), occupation: { kind: 'bakerPrice', price: 0 } })).toThrow(SocietySecurityError);
    expect(society.tick).toBe(0);
    expect(society.hash).toBe(hash);
  });

  it('accepts ordinary null choices and lets later lawful work resume supply', () => {
    const society = new Society({ seed: 19, sourceRevision });
    while (society.tick === 0) {
      for (const person of society.pendingPeople()) society.submit(person, emptySocietyAction());
    }
    expect(society.halted).toBe(false);
    const first = society.exportTape();
    expect(first.decisions.every(d => Object.values(d.action).every(value => value === null))).toBe(true);
    expect(first.transitions[0]!.oracle).toEqual([]);
    const market = first.transitions[0]!.economy as SocietyEconomyDay;
    expect(market.customerPayments).toBe(0);
    expect(market.grainAvailable).toBe(0);
    while (society.tick < 3) {
      for (const person of society.pendingPeople()) society.submit(person, autonomousPolicy(society.view(person).visible));
    }
    expect((society.exportTape().transitions[2]!.economy as SocietyEconomyDay).grainAvailable).toBeGreaterThan(0);
    expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
  });

  it('rejects altered visible context, submitted action, legal menu and resulting transition evidence', () => {
    const tape = run(3).tape;
    const tamper = (edit: (copy: SocietyTape) => void) => {
      const copy = structuredClone(tape);
      edit(copy);
      expect(() => verifySocietyTape(copy)).toThrow();
    };
    tamper(t => { t.decisions[0]!.visible.self.wealth += 1; });
    tamper(t => { t.decisions[0]!.action.occupation = { kind: 'bakerPrice', price: 99 }; });
    tamper(t => { t.decisions[0]!.legalChoices = {}; });
    tamper(t => { t.transitions[0]!.accounting.escrow += 0.3; });
    tamper(t => { t.transitions[0]!.afterHash = '0'.repeat(64); });
  });
});
