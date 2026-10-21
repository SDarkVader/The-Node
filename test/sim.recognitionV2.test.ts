import { describe, expect, it } from 'vitest';
import { runEpisode, resolve, daysTo, SCENARIOS, CANDIDATE_RULES, type Episode, type Hearing, type Rule } from '../src/sim/recognitionV2Harness.js';

/**
 * Recognition v2 pre-build simulation (docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md).
 * The harness reads the kernel and never writes to it; these tests pin that the shadow ledger is
 * faithful, that each rule does what its definition says, and the findings the evidence note
 * rests on.
 */

const rule = (id: string) => CANDIDATE_RULES.find((r) => r.id === id)!;
const talk = (day: number, hearer: string, source: string, addressed = true): Hearing =>
  ({ day, channel: 'talk', hearer, source, closeness: 0.5, addressed, addressedIntended: addressed, modelled: false });
const synthetic = (days: number, hearings: Hearing[]): Episode => ({
  seed: 0, days, persons: new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]), hearings, population: ['A', 'B', 'C'],
  departedOn: new Map(), kernelV1: new Map(), talkAudience: [], trace: new Map(),
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
