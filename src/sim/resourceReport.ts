import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { flourBalance, GRAIN_PER_FLOUR, RESOURCE_OWNER } from '../engine/resources.js';

/**
 * Named per-role resources tracked over time (2026-08-11, user-requested: "associate them
 * with real numbers I can track over time"). Prints a real time series from the actual
 * kernel — per-day flows and cumulative totals — not illustrative figures.
 */
const DAYS = 2000;
const MARKS = [30, 90, 180, 365, 730, 1095, 1460, 2000];
const SEED = 7;

console.log('NODE — named resource flows per role, over time.');
console.log(`seed=${SEED} days=${DAYS}  roles: ${Object.entries(RESOURCE_OWNER).map(([r, o]) => `${r}<-${o}`).join('  ')}\n`);
console.log('  day    flour/d   bread/d  parcels/d   leads/d   flourBal/d      grainOwed(cum)');

let world = createWorld(SEED, DEFAULT_WORLD_CONFIG);
for (let d = 1; d <= DAYS; d++) {
  world = stepWorld(world);
  if (MARKS.includes(d)) {
    const t = world.resources.today;
    console.log(
      `${String(d).padStart(5)}  ${t.flourProduced.toFixed(2).padStart(9)}  ${t.breadProduced.toFixed(2).padStart(8)}  ` +
        `${t.parcelsDelivered.toFixed(1).padStart(9)}  ${t.leadsDeveloped.toFixed(2).padStart(8)}  ` +
        `${flourBalance(t).toFixed(2).padStart(10)}  ${world.resources.cumulative.grainConsumed.toFixed(0).padStart(17)}`,
    );
  }
}

const c = world.resources.cumulative;
console.log(`\nCumulative over ${DAYS} days (one shard, seed ${SEED}):`);
console.log(`  flour milled      ${c.flourProduced.toFixed(0).padStart(10)}   (Miller)`);
console.log(`  bread baked       ${c.breadProduced.toFixed(0).padStart(10)}   (Baker)`);
console.log(`  flour consumed    ${c.flourConsumed.toFixed(0).padStart(10)}   (by Bakers)`);
console.log(`  parcels delivered ${c.parcelsDelivered.toFixed(0).padStart(10)}   (Courier)`);
console.log(`  leads developed   ${c.leadsDeveloped.toFixed(0).padStart(10)}   (Investigator)`);
console.log(`  grain consumed    ${c.grainConsumed.toFixed(0).padStart(10)}   (Import/Export — NOT YET BUILT: this is the supply gap, at ${GRAIN_PER_FLOUR}x flour)`);
console.log(
  `\n  net flour balance ${(c.flourProduced - c.flourConsumed).toFixed(0).padStart(10)}   ` +
    `(milled minus baked; positive = Millers out-produce Bakers' draw. Reported, not enforced —\n` +
    `                              no stockpile is simulated, so nobody can be starved by it yet.)`,
);
