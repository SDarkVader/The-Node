import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../world/world.js';

const DAYS = 365;
const SEED = 42;

console.log(`Unified world kernel — seed ${SEED}, ${DAYS} days, rMiller=${DEFAULT_WORLD_CONFIG.rMiller}, rBaker=${DEFAULT_WORLD_CONFIG.rBaker}, N=${DEFAULT_WORLD_CONFIG.targetPopulation}.\n`);

let world = createWorld(SEED);
console.log('tick\tpopulation\tflourPrice\teconomicHealth\tehWithExp\tmillersFilled\tbakersFilled\tsabotage');

for (let i = 0; i < DAYS; i++) {
  world = stepWorld(world);
  if (i % 20 === 0 || world.lastSabotage) {
    const millersFilled = world.millers.filter((m) => m.slot.state === 'FILLED').length;
    const bakersFilled = world.bakers.filter((b) => b.slot.state === 'FILLED').length;
    const sabotageNote = world.lastSabotage
      ? `witnesses=${world.lastSabotage.witnesses} success=${world.lastSabotage.successfulSaboteurs} evicted=${world.lastSabotage.evicted}`
      : '';
    console.log(
      `${world.tick}\t${world.population}\t\t${world.flourPrice.toFixed(3)}\t\t${world.economicHealth.toFixed(3)}\t\t${world.economicHealthWithExperience.toFixed(3)}\t\t${millersFilled}/${DEFAULT_WORLD_CONFIG.rMiller}\t\t${bakersFilled}/${DEFAULT_WORLD_CONFIG.rBaker}\t\t${sabotageNote}`,
    );
  }
}
