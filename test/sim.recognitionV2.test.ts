import { describe, expect, it } from 'vitest';
import { runEpisode, resolve, runLedger, daysTo, SCENARIOS, CANDIDATE_RULES, OWNER_RULES, type Episode, type Hearing, type Rule } from '../src/sim/recognitionV2Harness.js';

/**
 * Recognition v2 pre-build simulation (docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md).
 * The harness reads the kernel and never writes to it; these tests pin that the shadow ledger is
 * faithful, that each rule does what its definition says, and the findings the evidence note
 * rests on.
 */

const rule = (id: string) => [...CANDIDATE_RULES, ...OWNER_RULES].find((r) => r.id === id)!;
const talk = (day: number, hearer: string, source: string, addressed = true): Hearing =>
  ({ day, channel: 'talk', hearer, source, closeness: 0.5, addressed, addressedIntended: addressed, modelled: false });
const synthetic = (days: number, hearings: Hearing[]): Episode => ({
  seed: 0, days, persons: new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]), hearings, population: ['A', 'B', 'C'],
  departedOn: new Map(), kernelV1: new Map(), talkAudience: [], trace: new Map(), customers: 'none',
});
const daily = (days: number, f: (d: number) => Hearing[]) => Array.from({ length: days }, (_, d) => f(d)).flat();

describe('rule engine (synthetic hearings)', () => {
  const I2 = rule('I2');
  it('two-way addressed dealings recognise at exactly threshold/talk days; one-way and overheard do not', () => {
    const ep = synthetic(30, daily(30, (d) => [talk(d, 'A', 'B'), talk(d, 'B', 'A'), talk(d, 'C', 'A', false)]));
    const r = resolve(ep, I2);
    expect(daysTo(r, ep, 'a', 'b')).toBe(I2.threshold / I2.talk);
    expect(daysTo(r, ep, 'b', 'a')).toBe(10);
    expect(daysTo(r, ep, 'c', 'a')).toBeNull(); // 30 days of overheard credit at 1/day
    const oneWay = synthetic(30, daily(30, (d) => [talk(d, 'B', 'A')]));
    expect(daysTo(resolve(oneWay, I2), oneWay, 'b', 'a')).toBeNull();
    expect(daysTo(resolve(oneWay, rule('I1')), oneWay, 'b', 'a')).toBe(10);
  });

  it('the exchange window admits an answer the next day, not three days later', () => {
    const nextDay = synthetic(40, daily(40, (d) => d % 2 ? [talk(d, 'B', 'A')] : [talk(d, 'A', 'B')]));
    expect(daysTo(resolve(nextDay, I2), nextDay, 'a', 'b')).not.toBeNull();
    const late = synthetic(80, daily(80, (d) => d % 4 === 0 ? [talk(d, 'A', 'B')] : d % 4 === 1 ? [talk(d, 'B', 'A')] : []));
    expect(daysTo(resolve(late, I2), late, 'a', 'b')).toBeNull();
  });

  it('talking to the room is not dealing under the addressed rules, even when both speak', () => {
    const room = synthetic(30, daily(30, (d) => [talk(d, 'A', 'B', false), talk(d, 'B', 'A', false)]));
    expect(daysTo(resolve(room, rule('XR')), room, 'a', 'b')).toBe(10);
    for (const id of ['A1', 'A2', 'I1', 'I2', 'I2D']) expect(daysTo(resolve(room, rule(id)), room, 'a', 'b'), id).toBeNull();
  });

  it('without decay, overheard credit saturates eventually; with decay it never does', () => {
    const overheard = synthetic(130, daily(130, (d) => [talk(d, 'C', 'A', false)]));
    expect(daysTo(resolve(overheard, I2), overheard, 'c', 'a')).toBe(100);
    expect(daysTo(resolve(overheard, rule('I2D')), overheard, 'c', 'a')).toBeNull();
  });

  it('"as heard" and "by intent" differ only when the listener misheard the address', () => {
    const misheard: Hearing[] = daily(20, (d) => [{ ...talk(d, 'A', 'B'), addressed: false }, { ...talk(d, 'B', 'A'), addressed: false }]);
    const ep = synthetic(20, misheard);
    expect(daysTo(resolve(ep, I2), ep, 'a', 'b')).toBe(10);
    expect(daysTo(resolve(ep, rule('A2')), ep, 'a', 'b')).toBeNull();
  });

  it('every candidate puts daily two-way addressed dealings at 10 days', () => {
    for (const r of CANDIDATE_RULES.filter((x) => x.id !== 'v1')) {
      const ep = synthetic(30, daily(30, (d) => [talk(d, 'A', 'B'), talk(d, 'B', 'A')]));
      const expected = r.closenessWeighted ? Math.ceil(r.threshold / Math.round(r.talk * 0.5)) : 10;
      expect(daysTo(resolve(ep, r as Rule), ep, 'a', 'b'), r.id).toBe(expected);
    }
  });
});

describe('real kernel episodes', () => {
  // Seed 103: baker-0 and importexport-0 stand 1 apart; miller-0 is 8 from baker-0, inside range.
  const pair = runEpisode(103, 12, SCENARIOS.pair_daily!.policy);

  it('the shadow ledger replays rule v1 exactly as the kernel recognises', () => {
    const ep = runEpisode(103, 20, SCENARIOS.mixed!.policy);
    const shadow = resolve({ ...ep, hearings: ep.hearings.filter((h) => !h.modelled) }, rule('v1'));
    const pop = new Set(ep.population), subjects = new Set(ep.persons.values());
    const mine = new Map([...shadow].filter(([k]) => pop.has(k.split('>')[0]!) && subjects.has(k.split('>')[1]!)));
    expect(ep.kernelV1.size).toBeGreaterThan(0);
    expect(mine).toEqual(ep.kernelV1);
  });

  it('is deterministic for a seed and policy', () => {
    expect(runEpisode(103, 12, SCENARIOS.pair_daily!.policy).hearings).toEqual(pair.hearings);
  });

  it('finding: one utterance reaches dozens of listeners, so the literal rule recognises a silent bystander as fast as the partner', () => {
    expect(Math.min(...pair.talkAudience)).toBeGreaterThan(20);
    const L = resolve(pair, rule('L'));
    expect(daysTo(L, pair, 'baker-0', 'importexport-0')).toBe(10);
    expect(daysTo(L, pair, 'miller-0', 'baker-0')).toBe(10);
  });

  it('addressed two-way exchange recognises the pair in 10 days and nobody else', () => {
    const I2 = resolve(pair, rule('I2'));
    expect(daysTo(I2, pair, 'baker-0', 'importexport-0')).toBe(10);
    expect(daysTo(I2, pair, 'importexport-0', 'baker-0')).toBe(10);
    const A = pair.persons.get('baker-0')!;
    expect([...I2.keys()].filter((k) => k.endsWith(`>${A}`))).toEqual([`${pair.persons.get('importexport-0')}>${A}`]);
  });

  it('Grifter channels are marked modelled; role-holder hearings come from the kernel', () => {
    const ep = runEpisode(103, 6, SCENARIOS.grifter_pair!.policy);
    const G = ep.persons.get('grifter-0')!;
    const withGrifter = ep.hearings.filter((h) => h.hearer === G || h.source === G);
    expect(withGrifter.length).toBeGreaterThan(0);
    expect(withGrifter.every((h) => h.modelled)).toBe(true);
    const keys = ep.hearings.map((h) => `${h.day}|${h.channel}|${h.hearer}|${h.source}`);
    expect(new Set(keys).size).toBe(keys.length); // one utterance is heard at most once by each listener
    const roleOnly = ep.hearings.filter((h) => !h.modelled);
    expect(roleOnly.every((h) => h.hearer !== G && h.source !== G)).toBe(true);
  });
});

describe('owner statements of 2026-10-21 (synthetic hearings)', () => {
  it('resolution is lost after the bounded lapse, and the trace left makes re-resolution faster', () => {
    // O-short: threshold 120, talk 14, decay 1, cap 150, lose below 90. Contact days 0-19, then 140-159.
    const ep = synthetic(160, daily(160, (d) => (d < 20 || d >= 140 ? [talk(d, 'A', 'B')] : [])));
    const run = runLedger(ep, rule('O-short'));
    expect(run.intervals.get('A>B')).toEqual([[9, 80], [146, null]]); // 14+13d >= 120 at d=9; 150-61 < 90 at d=80; 29+14+13*6 at d=146
    expect(run.first.get('A>B')).toBe(9);
    // Without the cap, 20 days of dealings build 261 units, which outlast the 120-day gap entirely.
    const uncapped = runLedger(ep, { ...rule('O-short'), cap: undefined });
    expect(uncapped.intervals.get('A>B')).toEqual([[9, null]]);
  });

  it('a silent addressee is remembered by the addresser as a refusal; an answer within a day is not a refusal', () => {
    const silent = synthetic(30, daily(30, (d) => [talk(d, 'B', 'A')])); // A addresses B daily, B never answers
    expect(daysTo(resolve(silent, rule('O')), silent, 'a', 'b')).toBeNull();
    expect(daysTo(resolve(silent, rule('O-R14')), silent, 'a', 'b')).toBe(11);
    expect(daysTo(resolve(silent, rule('O-R14')), silent, 'b', 'a')).toBe(10);
    const nextDay = synthetic(30, daily(30, (d) => (d % 2 ? [talk(d, 'A', 'B')] : [talk(d, 'B', 'A')])));
    expect(runLedger(nextDay, rule('O-R14')).credit).toEqual(runLedger(nextDay, rule('O')).credit);
  });

  it('a purchase credits customer and Baker alike and nobody else', () => {
    const custom = (day: number, h: string, s: string): Hearing => ({ day, channel: 'custom', hearer: h, source: s, closeness: 1, addressed: false, addressedIntended: false, modelled: true });
    const ep = synthetic(30, daily(30, (d) => (d % 7 === 0 ? [custom(d, 'A', 'B'), custom(d, 'B', 'A')] : [])));
    const run = runLedger(ep, rule('O-C45'));
    expect(run.first.get('A>B')).toBe(14); // 45, 38+45, 76+45 = 121 on the third weekly visit
    expect(run.first.get('B>A')).toBe(14);
    expect(runLedger(ep, rule('O')).first.size).toBe(0); // the base rule ignores purchases
  });
});

describe('owner statements of 2026-10-21 (real kernel)', () => {
  it('the customer channel adds only modelled, mirrored purchase hearings and leaves every other hearing unchanged', () => {
    const plain = runEpisode(103, 15, SCENARIOS.mixed!.policy);
    for (const customers of ['mixed', 'nearest'] as const) {
      expect(runEpisode(103, 15, SCENARIOS.mixed!.policy, { customers }).hearings.filter((h) => h.channel !== 'custom'), customers).toEqual(plain.hearings);
    }
    const shopping = runEpisode(103, 15, SCENARIOS.mixed!.policy, { customers: 'loyal' });
    expect(shopping.hearings.filter((h) => h.channel !== 'custom')).toEqual(plain.hearings);
    const purchases = shopping.hearings.filter((h) => h.channel === 'custom');
    expect(purchases.length).toBeGreaterThan(0);
    expect(purchases.every((h) => h.modelled)).toBe(true);
    for (let i = 0; i < purchases.length; i += 2) {
      expect(purchases[i + 1]).toMatchObject({ day: purchases[i]!.day, hearer: purchases[i]!.source, source: purchases[i]!.hearer });
    }
  });

  it('customers keep the kernel purchase cycle: about one purchase per person per week', () => {
    for (const customers of ['mixed', 'loyal'] as const) {
      const ep = runEpisode(104, 28, SCENARIOS.quiet!.policy, { customers });
      const perPersonDay = ep.hearings.filter((h) => h.channel === 'custom').length / 2 / (ep.population.length * 28);
      expect(perPersonDay, customers).toBeGreaterThan(0.11);
      expect(perPersonDay, customers).toBeLessThan(0.16);
    }
  });

  it('records what was meant and what was heard: a refusal can be heard as its kernel neighbours only', () => {
    const ep = runEpisode(103, 8, SCENARIOS.refuse_reply!.policy);
    const B = ep.persons.get('importexport-0')!;
    const fromB = ep.hearings.filter((h) => h.channel === 'talk' && !h.modelled && h.source === B);
    expect(fromB.length).toBeGreaterThan(0);
    expect(fromB.every((h) => h.intent === 'refuse' && ['refuse', 'deflect', 'needle'].includes(h.heardIntent!))).toBe(true);
    expect(fromB.some((h) => h.heardIntent !== 'refuse')).toBe(true);
  });
});
