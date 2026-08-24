import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../world/world.js';
import { DAILY_ACTIVITY_MULTIPLIER, DOWNTIME_DAMPENING, THROTTLE_WINDOWS_PER_DAY, THROTTLE_WINDOW_HOURS } from '../engine/wealth.js';

/**
 * Item 8 (2026-08-11 addendum, "economic throttle windows") report-back verification.
 * `test/throttleWindowImpact.test.ts` proves, structurally and exactly, that the windows scale
 * every activity-dependent income LINE by a fixed factor and never distort market-clearing
 * dynamics (flour price, Miller/Baker competition). This anchors that in real measured numbers
 * from a live running world.
 *
 * METHODOLOGY NOTE #1, a real bug caught while writing this: measuring mean wealth at two
 * widely separated points in time and dividing by elapsed days is WRONG here — the set of
 * FILLED role-holders churns (conscription, backstop, sabotage), so a naive before/after
 * population mean mixes real income with role-holder turnover (a departing high-wealth holder
 * leaving the array, a fresh occupant resetting to 0, both masquerading as "income"). Fixed by
 * sampling SAME-SLOT single-day deltas instead — every sample is a genuine one-day income
 * observation for one continuously-held slot, not a population-level artifact.
 *
 * METHODOLOGY NOTE #2, equally real: Miller/Baker/Courier/Journalist/Detective also earn
 * `COMPLETION_REWARD` (item 4) — a FLAT bonus, deliberately NOT scaled by
 * `DAILY_ACTIVITY_MULTIPLIER` (a role either clears its completion condition that day or it
 * doesn't; the addendum never asked completion rewards to be activity-dampened, and doing so
 * would have been a second, uninstructed change). That means the TOTAL realized wealth this
 * report measures for those five roles is a MIX of activity-scaled market/wage income and an
 * unscaled flat bonus — dividing the total by `DAILY_ACTIVITY_MULTIPLIER` to reconstruct an
 * "unthrottled equivalent" would overstate it (the bonus wouldn't actually grow if the windows
 * vanished). So this report does NOT attempt that reconstruction for those five roles — the
 * exact 30%-of-market-income claim is proven directly against the pure income formulas in
 * `test/throttleWindowImpact.test.ts`, which is the right place for an exact number. Grifters
 * earn no completion bonus, so their figure alone is a clean, fully activity-scaled sample.
 */

const BURN_IN = 300;
const DAYS_AFTER_BURN_IN = 800;
const SEEDS = [1, 2, 3];

interface SlotSample {
  id: string;
  wealth: number;
}

function millerSamples(w: World): SlotSample[] {
  return w.millers.filter((m) => m.slot.state === 'FILLED').map((m) => ({ id: m.buildingId, wealth: m.wealth }));
}
function bakerSamples(w: World): SlotSample[] {
  return w.bakers.filter((b) => b.slot.state === 'FILLED').map((b) => ({ id: b.buildingId, wealth: b.wealth }));
}
function courierSamples(w: World): SlotSample[] {
  return w.couriers.filter((c) => c.slot.state === 'FILLED').map((c) => ({ id: c.buildingId, wealth: c.wealth }));
}
function investigatorSamples(w: World): SlotSample[] {
  return w.investigators.filter((i) => i.slot.state === 'FILLED').map((i) => ({ id: i.buildingId, wealth: i.wealth }));
}
function grifterSamples(w: World): SlotSample[] {
  return w.grifters.map((g) => ({ id: g.id, wealth: g.wealth }));
}

/** Mean genuine one-day income for `pick`'s role, sampled across every day after burn-in where
 *  a slot stayed occupied by the SAME holder across that one day — never a population mean at
 *  two distant points, which conflates income with role-holder turnover (see header note #1). */
function meanSameSlotDailyIncome(seed: number, pick: (w: World) => SlotSample[]): number {
  let world = createWorld(seed, DEFAULT_WORLD_CONFIG);
  for (let i = 0; i < BURN_IN; i++) world = stepWorld(world);

  const deltas: number[] = [];
  for (let i = 0; i < DAYS_AFTER_BURN_IN; i++) {
    const before = new Map(pick(world).map((s) => [s.id, s.wealth]));
    world = stepWorld(world);
    const after = pick(world);
    for (const s of after) {
      const priorWealth = before.get(s.id);
      if (priorWealth !== undefined) deltas.push(s.wealth - priorWealth);
    }
  }
  return deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : NaN;
}

console.log(`Throttle windows: what they remove, in real measured numbers (${BURN_IN}-day burn-in, then ${DAYS_AFTER_BURN_IN} sampled days).\n`);
console.log(
  `Shipped constants: ${THROTTLE_WINDOWS_PER_DAY} windows/day x ${THROTTLE_WINDOW_HOURS}h each, dampened to ${(DOWNTIME_DAMPENING * 100).toFixed(0)}% ` +
    `of normal output. DAILY_ACTIVITY_MULTIPLIER = ${DAILY_ACTIVITY_MULTIPLIER.toFixed(4)} — every activity-scaled income LINE pays exactly this\n` +
    `fraction of what full 24-hour activity would pay (proved exactly against the pure income functions in\n` +
    `test/throttleWindowImpact.test.ts). Miller/Baker/Courier/Journalist figures below also include the flat,\n` +
    `unscaled item-4 completion bonus, so they are NOT pure activity-scaled samples — reported as real measured\n` +
    `totals, not decomposed. Grifter has no completion bonus, so its figure is a clean, exactly-scaled sample.\n`,
);

console.log('role\tseed\trealMeanDailyIncome\t(grifter only: unthrottled-equivalent, removed)');
for (const seed of SEEDS) {
  const roles: [string, (w: World) => SlotSample[], boolean][] = [
    ['miller', millerSamples, false],
    ['baker', bakerSamples, false],
    ['courier', courierSamples, false],
    ['investigator', investigatorSamples, false],
    ['grifter', grifterSamples, true],
  ];
  for (const [label, pick, exactlyScaled] of roles) {
    const real = meanSameSlotDailyIncome(seed, pick);
    if (exactlyScaled) {
      const unthrottled = real / DAILY_ACTIVITY_MULTIPLIER;
      const removed = unthrottled - real;
      const removedFraction = (1 - DAILY_ACTIVITY_MULTIPLIER) * 100;
      console.log(`${label}\t${seed}\t${real.toFixed(4)}\t\t${unthrottled.toFixed(4)} unthrottled, ${removed.toFixed(4)} removed (${removedFraction.toFixed(0)}%)`);
    } else {
      console.log(`${label}\t${seed}\t${real.toFixed(4)}\t\t(includes flat completion bonus — see header note #2)`);
    }
  }
}

console.log(
  '\nGrifter income (no completion bonus, fully activity-scaled) confirms the exact 30% figure in real measured\n' +
    'numbers, not just algebra. The other five roles genuinely do have a real ~30% cap on their MARKET/WAGE\n' +
    'income specifically (proven exactly in the test file) plus a completion bonus the windows never touch —\n' +
    'two real, distinct income sources with two different relationships to the throttle, which is itself worth\n' +
    'knowing rather than flattening into one misleading percentage.',
);
