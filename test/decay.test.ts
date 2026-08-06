import { describe, expect, it } from 'vitest';
import { stepClarity, applyDistortion } from '../src/comms/decay.js';
import { mulberry32 } from '../src/sim/rng.js';

describe('stepClarity', () => {
  it('always fails when baseSuccessChance is 0', () => {
    const rng = mulberry32(1);
    const result = stepClarity(1, 1, { baseSuccessChance: 0, decayPerStep: 0.1, clarityFloor: 0 }, rng);
    expect(result.passed).toBe(false);
  });

  it('always passes when baseSuccessChance/closeness/clarity guarantee success and floor is unreachable', () => {
    const rng = mulberry32(2);
    const result = stepClarity(1, 1, { baseSuccessChance: 1, decayPerStep: 0.1, clarityFloor: 0 }, rng);
    expect(result.passed).toBe(true);
    expect(result.nextClarity).toBeCloseTo(0.9);
  });

  it('fails once decay would push clarity below the floor, even if the success roll passes', () => {
    const rng = mulberry32(3);
    // baseSuccessChance=10 guarantees the roll passes (successChance clips above 1) regardless
    // of the rng draw, isolating the floor check as the only thing this test exercises.
    const result = stepClarity(0.15, 1, { baseSuccessChance: 10, decayPerStep: 0.1, clarityFloor: 0.1 }, rng);
    expect(result.passed).toBe(false); // 0.15 - 0.1 = 0.05, below the 0.1 floor
    expect(result.nextClarity).toBeCloseTo(0.05);
  });

  it('closeness scales the success chance', () => {
    const rng = () => 0.5; // fixed roll
    const config = { baseSuccessChance: 0.6, decayPerStep: 0, clarityFloor: 0 };
    // successChance = 0.6 * closeness * clarity(1); roll 0.5 passes only if successChance > 0.5
    expect(stepClarity(1, 1, config, rng).passed).toBe(true); // 0.6 > 0.5
    expect(stepClarity(1, 0.5, config, rng).passed).toBe(false); // 0.3 < 0.5
  });
});

describe('applyDistortion', () => {
  const neighbors = { a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] } as const;

  it('never distorts when distortionRate is 0', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 50; i++) {
      const result = applyDistortion('a', { distortionRate: 0, neighbors }, rng);
      expect(result.distorted).toBe(false);
      expect(result.value).toBe('a');
    }
  });

  it('always distorts to a listed neighbor when distortionRate is 1', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const result = applyDistortion('a', { distortionRate: 1, neighbors }, rng);
      expect(result.distorted).toBe(true);
      expect(neighbors.a).toContain(result.value);
    }
  });
});
