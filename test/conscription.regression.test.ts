import { describe, expect, it } from 'vitest';
import { runConscriptionSim } from '../src/sim/conscriptionHarness.js';

/**
 * Regression tests for Miller conscription (2026-08-07 design — not in the original
 * brief, added because a passive BACKSTOPPED-recovery hazard low enough to hit the
 * brief's §2.4 ratio target required role-slots to sit NPC-run 79-86% of the time,
 * conflicting with the brief's premise of a player-driven economy. Conscription: NPC
 * backstops a vacant Miller slot only temporarily; past a fixed delay, a random player
 * is mandatorily drafted — from the gossip layer, or from an existing other-role holder
 * (creating a real cascading vacancy there). See docs/BLUEPRINT.md.
 */

const DAYS_PER_YEAR = 365;
const SEEDS = [1, 2, 3, 4, 5];
const R_MILLER = 2;
const R_OTHER = 4;

function longRun(N: number, conscriptionDelay: number, days = DAYS_PER_YEAR * 20) {
  let millerGenuineFills = 0;
  let millerConscriptions = 0;
  let millerBackstopFires = 0;
  let millerBackstoppedSlotDays = 0;
  let conscriptionsFromOtherRole = 0;
  let conscriptionsFromGossip = 0;
  let otherBackstopFires = 0;
  let totalMillerSlotDays = 0;

  for (const seed of SEEDS) {
    const r = runConscriptionSim({ N, rMiller: R_MILLER, rOther: R_OTHER, pMonthly: 0.2, days, seed, conscriptionDelay });
    millerGenuineFills += r.millerGenuineFills;
    millerConscriptions += r.millerConscriptions;
    millerBackstopFires += r.millerBackstopFires;
    millerBackstoppedSlotDays += r.millerBackstoppedSlotDays;
    conscriptionsFromOtherRole += r.conscriptionsFromOtherRole;
    conscriptionsFromGossip += r.conscriptionsFromGossip;
    otherBackstopFires += r.otherBackstopFires;
    totalMillerSlotDays += r.totalMillerSlotDays;
  }

  return {
    millerGenuineFills,
    millerConscriptions,
    millerBackstopFires,
    millerBackstoppedSlotDays,
    conscriptionsFromOtherRole,
    conscriptionsFromGossip,
    otherBackstopFires,
    totalMillerSlotDays,
  };
}

describe('Miller conscription — resolves the NPC-dominance tradeoff', () => {
  it('Miller spends only a small fraction of time BACKSTOPPED, unlike the pure-recovery-hazard version', () => {
    // The version without conscription needed vacant+backstopped ~80%+ to hit the
    // brief's ratio target. Conscription should keep BACKSTOPPED time far below that at
    // any reasonable delay.
    const r = longRun(50, 14);
    const backstoppedFraction = r.millerBackstoppedSlotDays / r.totalMillerSlotDays;
    expect(backstoppedFraction).toBeLessThan(0.1);
  });

  it('the genuine-fill:backstop ratio increases with N, matching the brief\'s claimed direction', () => {
    const at50 = longRun(50, 14);
    const at80 = longRun(80, 14);
    const ratio50 = at50.millerGenuineFills / at50.millerBackstopFires;
    const ratio80 = at80.millerGenuineFills / at80.millerBackstopFires;
    expect(ratio80).toBeGreaterThan(ratio50);
  });

  it('longer conscription delay increases BACKSTOPPED time but barely moves the ratio', () => {
    // Matches the finding that recovery/conscription timing is a downstream consequence
    // of how long NPC coverage lasts, not a cause of the genuine-fill-vs-backstop balance.
    const short = longRun(50, 3);
    const long = longRun(50, 30);
    expect(long.millerBackstoppedSlotDays).toBeGreaterThan(short.millerBackstoppedSlotDays * 3);

    const shortRatio = short.millerGenuineFills / short.millerBackstopFires;
    const longRatio = long.millerGenuineFills / long.millerBackstopFires;
    expect(Math.abs(shortRatio - longRatio)).toBeLessThan(0.5);
  });

  it('every conscription is accounted for as either gossip-layer or other-role-cascade, and both occur', () => {
    const r = longRun(50, 14);
    expect(r.conscriptionsFromGossip + r.conscriptionsFromOtherRole).toBe(r.millerConscriptions);
    expect(r.conscriptionsFromGossip).toBeGreaterThan(0);
    expect(r.conscriptionsFromOtherRole).toBeGreaterThan(0);
  });

  it('the cascade is real but modest — other-role backstop fires still happen mostly from their own churn, not the cascade', () => {
    const r = longRun(50, 14);
    // Sanity bound: cascading conscriptions shouldn't dominate other-role vacancy
    // pressure — if this fails, conscription is destabilizing the roles it drafts from.
    expect(r.conscriptionsFromOtherRole).toBeLessThan(r.otherBackstopFires);
  });
});
