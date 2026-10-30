import { describe, expect, it } from 'vitest';
import {
  civicRelativeShares, civicReputationScore, computeCivicReputation,
  DEFAULT_CIVIC_REPUTATION_PARAMS, type CivicReputationEvent,
} from '../src/engine/civicReputation.js';
const e = (id: string, subjectId: string, day: number, domain: CivicReputationEvent['domain'], valence: CivicReputationEvent['valence'], weight = 1): CivicReputationEvent =>
  ({ id, subjectId, day, domain, valence, weight });
const score = (events: CivicReputationEvent[], subject = 'miller') => computeCivicReputation(events).get(subject)!;

describe('experimental civic reputation, no live-world wiring', () => {
  it('starts at zero with a positive evidence prior', () => {
    expect(civicReputationScore(0, 0)).toEqual({positive: 0,negative: 0,standing: 0,notoriety: 0});
    expect(computeCivicReputation([]).size).toBe(0);
  });
  it('separates notoriety from signed standing', () => {
    const one = civicReputationScore(3, 3);
    expect(one.standing).toBeCloseTo(0, 12);
    expect(one.notoriety).toBeGreaterThan(0);
    expect(civicReputationScore(1, 7).standing).toBeLessThan(0);
  });
  it('does not subtract anything for silence or empty days', () => {
    const days = [e('x','miller',1,'service','positive')];
    expect(score(days)).toEqual(score([...days]));
    expect(score(days).standing).toBeGreaterThan(0);
  });
  it('rejects a duplicated event rather than double-crediting it', () => {
    const one = e('x', 'miller', 1, 'service', 'positive');
    expect(() => computeCivicReputation([one, one])).toThrow('civic_reputation_duplicate_event');
  });
  it('is order independent and separately cumulative across days', () => {
    const entries = [e('a','miller',1,'service','positive',2),e('b','miller',2,'service','positive',2),e('c','miller',2,'conduct','negative',1)];
    expect(score(entries)).toEqual(score([...entries].reverse()));
    expect(score(entries).positive).toBe(4);
    expect(score(entries).negative).toBe(1);
  });
  it('reduces fractional caps in a deterministic day order', () => {
    const entries = [e('a','miller',1,'service','positive'), e('b','miller',2,'service','positive'), e('c','miller',3,'service','positive', 2)];
    const params = {...DEFAULT_CIVIC_REPUTATION_PARAMS, dailyCap: 1.1};
    expect(computeCivicReputation(entries, params).get('miller'))
      .toEqual(computeCivicReputation([...entries].reverse(), params).get('miller'));
  });
  it('caps same-day positive farming but does not erase other days', () => {
    const entries = Array.from({length: 10}, (_, i) => e(`a${i}`,'miller',2,'service','positive'));
    expect(score(entries).positive).toBe(3);
    expect(score([...entries,e('next','miller',3,'service','positive')]).positive).toBe(4);
  });
  it('caps negatives independently of positives, and preserves audience domains', () => {
    const events = [e('a','miller',2,'service','positive',3),e('b','miller',2,'service','negative',2),e('c','miller',2,'conduct','negative',3)];
    const s = score(events);
    expect(s.positive).toBe(3); expect(s.negative).toBe(5);
    expect(s.domains.service.positive).toBe(3);
    expect(s.domains.service.negative).toBe(2);
    expect(s.domains.conduct.negative).toBe(3);
  });
  it('rejects forged shape, impossible days, invalid weights and parameters', () => {
    expect(() => computeCivicReputation([e('bad id','miller',0,'service','positive')])).toThrow();
    expect(() => computeCivicReputation([e('a','miller',-1,'service','positive')])).toThrow();
    expect(() => computeCivicReputation([e('a','miller',1,'service','positive',4)])).toThrow();
    expect(() => computeCivicReputation([], {...DEFAULT_CIVIC_REPUTATION_PARAMS, prior: 0})).toThrow();
  });
  it('computes stable normalized relative standing without treating it as a win probability', () => {
    const shares = civicRelativeShares([{subjectId:'miller',standing:7.731898882334817},{subjectId:'grifter',standing:6.931471805599453}]);
    expect(shares.get('grifter')).toBeCloseTo(0.4600638977635783, 10);
    expect([...shares.values()].reduce((a,b)=>a+b,0)).toBeCloseTo(1,12);
    const huge = civicRelativeShares([{subjectId:'miller',standing:1e200},{subjectId:'grifter',standing:-1e200}]);
    expect(huge.get('miller')).toBe(1);
    expect(huge.get('grifter')).toBe(0);
  });
  it('rejects repeated subjects and non-finite standings in shares', () => {
    expect(() => civicRelativeShares([{subjectId:'x',standing:0},{subjectId:'x',standing:3}])).toThrow();
    expect(() => civicRelativeShares([{subjectId:'x',standing:NaN}])).toThrow();
  });
  it('normalizes shares for extreme finite standings and temperatures', () => {
    const tied = civicRelativeShares([{subjectId:'a',standing:1e308},{subjectId:'b',standing:1e308}], 0.1);
    expect(tied.get('a')).toBe(0.5);
    expect(tied.get('b')).toBe(0.5);
    const opposite = civicRelativeShares([{subjectId:'a',standing:Number.MAX_VALUE},{subjectId:'b',standing:-Number.MAX_VALUE}], Number.MAX_VALUE);
    expect(opposite.get('a')).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
    expect(opposite.get('b')).toBeCloseTo(1 / (1 + Math.exp(2)), 12);
    const tiny = civicRelativeShares([{subjectId:'a',standing:1e308},{subjectId:'b',standing:-1e308}], Number.MIN_VALUE);
    expect([...tiny.values()]).toEqual([1, 0]);
  });
  it('positive evidence cannot lower standing, negative evidence cannot raise it across 1000 samples', () => {
    for (let p=0;p<100;p++) for(let n=0;n<10;n++) {
      const original=civicReputationScore(p,n).standing;
      expect(civicReputationScore(p+1,n).standing).toBeGreaterThanOrEqual(original-1e-12);
      expect(civicReputationScore(p,n+1).standing).toBeLessThanOrEqual(original+1e-12);
    }
  });
});

describe('synthetic competitive reference (never treated as observed agent actions)', () => {
  it('reproduces the Wolfram two-agent payoff values', () => {
    const r = (p: number, n: number) => civicReputationScore(p, n).standing;
    const share = (g: number, m: number) => civicRelativeShares([
      {subjectId:'Grifter', standing: g}, {subjectId:'Miller', standing: m},
    ]).get('Grifter')!;
    const quiet = share(r(7,0),r(8,1));
    const undetected = share(r(7,0),r(8,4));
    const detected = share(r(7,4),r(8,4));
    expect(quiet).toBeCloseTo(0.5509618450419811, 12);
    expect(undetected).toBeCloseTo(0.7340927685820379, 12);
    expect(detected).toBeCloseTo(0.4600638977635783, 12);
    expect((undetected-quiet)/(undetected-detected)).toBeCloseTo(0.6682906184048707, 12);
  });
  it('permits stable absolute standing while a competitor overtakes it', () => {
    const miller = Array.from({length:8},(_,i) => e(`mpos${i}`,'Miller',i%4,'service','positive'));
    const first = [...miller,e('mneg','Miller',0,'conduct','negative'),
      ...Array.from({length:5},(_,i)=>e(`gpos${i}`,'Grifter',i%3,'cooperation','positive'))];
    const second = [...first,...Array.from({length:20},(_,i)=>e(`gday${i}`,'Grifter',i+5,'service','positive'))];
    const before = computeCivicReputation(first), after = computeCivicReputation(second);
    expect(before.get('Miller')!.standing).toBeCloseTo(after.get('Miller')!.standing, 12);
    expect(before.get('Miller')!.standing).toBeGreaterThan(before.get('Grifter')!.standing);
    expect(after.get('Grifter')!.standing).toBeGreaterThan(after.get('Miller')!.standing);
  });
});
