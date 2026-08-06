/**
 * §8 minimum viable prototype, CLI runner: two Bakers plus a working rumour mill.
 * Simulation logic lives in scenario.ts, shared with the WebSocket server.
 */
import { mulberry32 } from '../sim/rng.js';
import { BAKER_A, BAKER_B, initScenario, stepScenario } from './scenario.js';

const DAYS = 10;
let state = initScenario(mulberry32(7));

console.log(`NODE — MVP: two Bakers (${BAKER_A}, ${BAKER_B}) + rumour mill\n`);

for (let i = 0; i < DAYS; i++) {
  const stepped = stepScenario(state);
  state = stepped.state;
  const { day, bakerP, spread, wallPost, rumours } = stepped.result;

  console.log(`--- Day ${day} ---`);
  console.log(`  ${BAKER_A}: ${bakerP[0].toFixed(3)}   ${BAKER_B}: ${bakerP[1].toFixed(3)}   spread: ${spread.toFixed(3)}`);

  if (wallPost) {
    console.log(`  [Wall] ${wallPost.authorId}: "${wallPost.state}" post`);
    if (rumours.length === 0) {
      console.log('    (nobody picked it up)');
    }
    for (const e of rumours) {
      const tag = e.distorted ? `distorted -> "${e.state}"` : 'faithful';
      console.log(`    ${e.heardBy} hears it via ${e.heardFrom} (hop ${e.hop}, ${tag}, clarity ${e.clarity.toFixed(2)})`);
    }
  }
}
