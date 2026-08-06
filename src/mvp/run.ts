/**
 * §8 minimum viable prototype: two Bakers plus a working rumour mill.
 *
 * Uses the real Baker/Bertrand engine from Phase 1, but a hardcoded flour price
 * instead of the full Miller layer — the brief explicitly allows this shortcut for
 * the MVP ("placeholder or hardcoded flour price... if that's faster to stand up
 * first"). The Wall-post trigger rule below (post when the price gap crosses a
 * threshold) is illustrative scaffolding to exercise the rumour mill end-to-end, not
 * a designed mechanic — it's the one part of this file that's a placeholder rather
 * than a brief-derived system, and should be replaced once real player input exists.
 */
import { stepBakers } from '../engine/bakers.js';
import { spread } from '../engine/util.js';
import { postToWall, type SelfState } from '../comms/grammar.js';
import { ConnectionGraph } from '../comms/connections.js';
import { DEFAULT_RUMOUR_CONFIG, propagateRumour } from '../comms/rumourMill.js';
import { mulberry32, gaussian } from '../sim/rng.js';

const HARDCODED_FLOUR_PRICE = 0.6; // placeholder for the full Miller layer, per §8
const GAMMA = 1.0; // comfortably below the n=2 instability cliff (§1.4)
const DAYS = 10;
const PRICE_GAP_TRIGGER = 0.015;
const NOISE_SIGMA = 0.02; // livelier than the Phase 1 default, so the MVP demo actually exercises the mill

const BAKER_A = 'baker-astra';
const BAKER_B = 'baker-corin';
const rng = mulberry32(7);

const graph = new ConnectionGraph();
graph.connect(BAKER_A, 'wren', 0.8);
graph.connect('wren', 'sable', 0.6);
graph.connect('sable', 'idris', 0.5);
graph.connect(BAKER_B, 'idris', 0.7);
graph.connect('wren', BAKER_B, 0.3);
graph.connect(BAKER_A, BAKER_B, 0.4); // rivals still see each other

let bakerP = [0.6, 0.65];

function triggerState(lowerPrice: boolean): SelfState {
  return lowerPrice ? 'exploited' : 'uneasy';
}

console.log(`NODE — MVP: two Bakers (${BAKER_A}, ${BAKER_B}) + rumour mill\n`);

for (let day = 1; day <= DAYS; day++) {
  bakerP = stepBakers(bakerP, HARDCODED_FLOUR_PRICE, GAMMA, () => gaussian(rng, NOISE_SIGMA));
  const gap = spread(bakerP);

  console.log(`--- Day ${day} ---`);
  console.log(`  ${BAKER_A}: ${bakerP[0]!.toFixed(3)}   ${BAKER_B}: ${bakerP[1]!.toFixed(3)}   spread: ${gap.toFixed(3)}`);

  if (gap > PRICE_GAP_TRIGGER) {
    const authorIsA = bakerP[0]! < bakerP[1]!;
    const author = authorIsA ? BAKER_A : BAKER_B;
    const state = triggerState(true);
    const post = postToWall(author, state, day);
    console.log(`  [Wall] ${author}: "${state}" post`);

    const events = propagateRumour(post, graph, { ...DEFAULT_RUMOUR_CONFIG, rng });
    if (events.length === 0) {
      console.log('    (nobody picked it up)');
    }
    for (const e of events) {
      const tag = e.distorted ? `distorted -> "${e.state}"` : 'faithful';
      console.log(`    ${e.heardBy} hears it via ${e.heardFrom} (hop ${e.hop}, ${tag}, clarity ${e.clarity.toFixed(2)})`);
    }
  }
}
