import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';
import type { ShardLayoutConfig } from '../engine/space.js';
import { createMultiShardState, stepMultiShard, totalPopulation } from './multiShardHarness.js';

/**
 * Joint grid search over six-role allocation x district layout (2026-08-11). The previous
 * sweep tested 7 hand-picked allocations against 3 district counts separately — evidence-
 * backed but explicitly not a joint search, and flagged as such. This closes that gap.
 *
 * A full joint grid at full fidelity is far too expensive (hundreds of multi-shard runs of
 * 1500 days x multiple seeds), so this is the standard coarse-to-fine approach, which is
 * honest about what each phase can and cannot conclude:
 *
 *   PHASE 1 (screen) — the whole allocation grid at reduced fidelity (short runs, 1 seed),
 *     at the default district layout. Cheap enough to be exhaustive over the grid, too
 *     noisy to pick a winner from. Its ONLY job is to discard candidates that are clearly
 *     bad or clearly incoherent, and to rank the rest.
 *   PHASE 2 (confirm) — the surviving top candidates re-run jointly against every district
 *     layout at full fidelity (long runs, multiple seeds). Only Phase 2 numbers are ever
 *     used to make a decision.
 *
 * Screening results are written to disk between phases so the two can run separately
 * without repeating Phase 1's cost.
 *
 * COHERENCE IS A HARD FILTER, not a scored metric: a candidate whose Bakers consume more
 * flour than its Millers mill is baking flour nobody produced, and no amount of good
 * population or equality numbers redeems that. Those are discarded outright.
 */

const SCREEN_DAYS = 500;
const SCREEN_BURN_IN = 120;
const FINE_DAYS = 1500;
const FINE_BURN_IN = 300;
const FINE_SEEDS = [1, 2];
const TOP_PER_TOTAL = 2;

/**
 * Target single-shard population this run screens/confirms against (2026-08-13 addendum's
 * "does a shard need more capacity than 65" question, re-derived against the real engine
 * rather than the addendum's own toy-formula sweep — see docs/DESIGN_ADDENDUM_2026-08-13.md
 * and docs/DEVLOG.md's 2026-08-13 entry for why that sweep wasn't trusted as-is).
 * `npm run joint-grid-search screen 100` / `npm run joint-grid-search confirm 100` runs this
 * at pop=100; omitting the population argument preserves the original pop=65 behaviour
 * exactly, including its screen-file path, so the original run's results are never clobbered.
 */
const TARGET_POPULATION = Number(process.argv[3] ?? DEFAULT_WORLD_CONFIG.targetPopulation);
const SCREEN_PATH = `/tmp/claude-0/-home-user-The-Node/9b509fd8-9475-53af-88b9-37bdfbc4d5e5/scratchpad/grid-screen-pop${TARGET_POPULATION}.json`;

export interface Split {
  rMiller: number;
  rBaker: number;
  rCourier: number;
  rJournalist: number;
  rDetective: number;
  rImportExport: number;
}

const label = (s: Split) => `M${s.rMiller} B${s.rBaker} C${s.rCourier} J${s.rJournalist} D${s.rDetective} IE${s.rImportExport}`;
const total = (s: Split) => s.rMiller + s.rBaker + s.rCourier + s.rJournalist + s.rDetective + s.rImportExport;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * The allocation grid. Totals span the band either side of the current S=32 — S=38+ is
 * excluded because the equilibrium sweep already showed it drives shard count into the
 * proliferation regime, and S<=26 was both thinner and incoherent, so spending grid budget
 * there would be re-testing settled ground. That reasoning was calibrated against
 * targetPopulation=65; at a higher target (`TARGET_POPULATION`, 2026-08-13) the whole band
 * is scaled proportionally rather than re-guessed, so the search space keeps the same
 * relative shape a larger population would need.
 */
const POP_SCALE = TARGET_POPULATION / DEFAULT_WORLD_CONFIG.targetPopulation;

function scaledBand(base: readonly number[]): number[] {
  if (POP_SCALE === 1) return [...base];
  return [...new Set(base.map((v) => Math.max(1, Math.round(v * POP_SCALE))))].sort((a, b) => a - b);
}

function buildGrid(): Split[] {
  const out: Split[] = [];
  const sBand = scaledBand([28, 30, 32, 34]);
  const millerBand = scaledBand([4, 5, 6, 7]);
  const bakerBand = scaledBand([5, 6, 7, 8]);
  const detectiveBand = scaledBand([3, 4, 5]);
  const ieBand = scaledBand([3, 4, 5]);
  const remFloor = Math.max(6, Math.round(6 * POP_SCALE)); // Courier and Journalist each need a viable floor
  const eachCap = Math.round(10 * POP_SCALE);
  for (const S of sBand) {
    for (const rMiller of millerBand) {
      for (const rBaker of bakerBand) {
        for (const rDetective of detectiveBand) {
          for (const rImportExport of ieBand) {
            const rem = S - rMiller - rBaker - rDetective - rImportExport;
            if (rem < remFloor) continue;
            const rCourier = Math.ceil(rem / 2);
            const rJournalist = Math.floor(rem / 2);
            if (rCourier > eachCap || rJournalist > eachCap) continue;
            out.push({ rMiller, rBaker, rCourier, rJournalist, rDetective, rImportExport });
          }
        }
      }
    }
  }
  return out;
}

/** Building counts scaled by POP_SCALE so a wider role-slot grid never trips world.ts's
 *  "not enough buildings for the requested role count" guard — same proportion the original
 *  pop=65 configs had. Identity at POP_SCALE=1 (the shipped default, byte-for-byte). */
const bpc = (n: number) => Math.round(n * POP_SCALE);
const SCREEN_SHARD_CONFIG: ShardLayoutConfig =
  POP_SCALE === 1
    ? DEFAULT_WORLD_CONFIG.shardConfig
    : { ...DEFAULT_WORLD_CONFIG.shardConfig, buildingsPerCoreDistrict: bpc(10), buildingsPerPeripheryDistrict: bpc(5) };

function run(split: Split, shardConfig: ShardLayoutConfig, days: number, burnIn: number, seeds: number[]) {
  const config: WorldConfig = { ...DEFAULT_WORLD_CONFIG, targetPopulation: TARGET_POPULATION, shardConfig, ...split };
  const pops: number[] = [];
  const healths: number[] = [];
  const ginis: number[] = [];
  const waits: number[] = [];
  const shardCounts: number[] = [];
  const flourRatios: number[] = [];
  const grainCovers: number[] = [];

  for (const seed of seeds) {
    let state = createMultiShardState(seed, config);
    for (let i = 0; i < days; i++) {
      state = stepMultiShard(state);
      if (i >= burnIn) {
        const live = [...state.worlds.values()].filter((w) => w.population > 0);
        if (live.length > 0) {
          pops.push(totalPopulation(state) / state.registry.shards.length);
          healths.push(mean(live.map((w) => w.economicHealth)));
          ginis.push(mean(live.map((w) => w.wealthGini)));
          waits.push(mean(live.flatMap((w) => w.grifters.map((g) => g.daysAsGrifter))));
        }
      }
    }
    shardCounts.push(state.registry.shards.length);
    for (const w of state.worlds.values()) {
      const c = w.resources.cumulative;
      if (c.flourProduced > 0) flourRatios.push(c.flourConsumed / c.flourProduced);
      if (c.grainConsumed > 0) grainCovers.push(c.grainDelivered / c.grainConsumed);
    }
  }

  return {
    perShardPop: mean(pops),
    health: mean(healths),
    gini: mean(ginis),
    waitMean: mean(waits),
    shards: mean(shardCounts),
    flourRatio: mean(flourRatios),
    grainCover: mean(grainCovers),
  };
}

/**
 * Composite score used ONLY to rank screening candidates for promotion to Phase 2 — never
 * to pick the final answer, which is a judgement call made on Phase 2's separate metrics.
 * Population is normalized against the brief's own 50-80 band rather than against 65, since
 * anywhere in that band is in spec; equality and grifter wait are penalties. Scaled by
 * POP_SCALE at a higher TARGET_POPULATION so the same "how close to the target range" shape
 * applies, rather than a band calibrated for pop=65 silently misjudging a pop=100 run.
 */
function screenScore(r: ReturnType<typeof run>): number {
  const popScore = Math.min(1, Math.max(0, (r.perShardPop - 45 * POP_SCALE) / (25 * POP_SCALE)));
  const waitPenalty = Math.min(1, r.waitMean / 60);
  return popScore * 1.0 + r.health * 1.0 - r.gini * 0.8 - waitPenalty * 0.4;
}

const phase = process.argv[2] ?? 'screen';

if (phase === 'screen') {
  const grid = buildGrid();
  console.log(`PHASE 1 — screening ${grid.length} allocations at reduced fidelity, targetPopulation=${TARGET_POPULATION}${POP_SCALE !== 1 ? ` (scale x${POP_SCALE.toFixed(3)} vs the shipped pop=65 grid)` : ''}`);
  console.log(`(${SCREEN_DAYS} days, burn-in ${SCREEN_BURN_IN}, 1 seed, default district layout)`);
  console.log('Screening ranks candidates and discards incoherent ones. It does NOT pick a winner.\n');

  const scored: { split: Split; r: ReturnType<typeof run>; score: number }[] = [];
  let incoherent = 0;
  for (const split of grid) {
    const r = run(split, SCREEN_SHARD_CONFIG, SCREEN_DAYS, SCREEN_BURN_IN, [1]);
    if (r.flourRatio > 1.0) {
      incoherent++;
      continue; // hard filter — baking flour nobody milled
    }
    scored.push({ split, r, score: screenScore(r) });
  }
  scored.sort((a, b) => b.score - a.score);

  console.log(`${grid.length} tested | ${incoherent} discarded as INCOHERENT (flourRatio > 1) | ${scored.length} survived\n`);
  console.log('rank  allocation                        S   pop/65  health   gini  waitMean  shards  flourRatio  score');
  scored.slice(0, 15).forEach((c, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${label(c.split).padEnd(32)} ${String(total(c.split)).padStart(2)}  ` +
        `${c.r.perShardPop.toFixed(1).padStart(6)}  ${c.r.health.toFixed(3)}  ${c.r.gini.toFixed(3)}  ` +
        `${c.r.waitMean.toFixed(1).padStart(8)}  ${c.r.shards.toFixed(1).padStart(6)}  ${c.r.flourRatio.toFixed(3).padStart(10)}  ${c.score.toFixed(3)}`,
    );
  });

  // Promote the top TWO PER TOTAL rather than the top N overall. Reason, found by
  // inspecting the screen rather than assumed: at the reduced 500-day horizon shard count
  // has not yet grown (every top candidate still shows 2 shards), so per-shard population
  // is inflated for allocations that merely delay the first shard opening — which
  // systematically favours smaller totals. Taking the best of each total keeps the
  // finalist set honest across that bias, and Phase 2's long runs then settle it.
  const byTotal = new Map<number, typeof scored>();
  for (const c of scored) {
    const S = total(c.split);
    if (!byTotal.has(S)) byTotal.set(S, []);
    byTotal.get(S)!.push(c);
  }
  const finalists = [...byTotal.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, list]) => list.slice(0, 2));
  console.log(`\nFinalists (top 2 per total, guarding against the short-horizon bias above):`);
  for (const c of finalists) console.log(`  S=${total(c.split)}  ${label(c.split)}  score=${c.score.toFixed(3)}`);
  writeFileSync(SCREEN_PATH, JSON.stringify(finalists.map((c) => c.split), null, 2));
  console.log(`\n${finalists.length} finalists written for Phase 2. Run: npm run joint-grid-search confirm`);
} else {
  if (!existsSync(SCREEN_PATH)) throw new Error('No screening results — run the screen phase first.');
  const finalists: Split[] = JSON.parse(readFileSync(SCREEN_PATH, 'utf8'));

  const LAYOUTS: { label: string; shardConfig: ShardLayoutConfig }[] = [
    { label: '3 districts', shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 1, peripheryDistrictCount: 2, buildingsPerCoreDistrict: bpc(24), buildingsPerPeripheryDistrict: bpc(12) } },
    { label: '6 districts', shardConfig: SCREEN_SHARD_CONFIG },
    { label: '11 districts', shardConfig: { ...DEFAULT_WORLD_CONFIG.shardConfig, coreDistrictCount: 3, peripheryDistrictCount: 8, buildingsPerCoreDistrict: bpc(8), buildingsPerPeripheryDistrict: bpc(4) } },
  ];

  console.log(`PHASE 2 — confirming ${finalists.length} finalists x ${LAYOUTS.length} district layouts at FULL fidelity`);
  console.log(`(${FINE_DAYS} days, burn-in ${FINE_BURN_IN}, seeds ${JSON.stringify(FINE_SEEDS)})`);
  console.log('These are the only numbers a decision is made from.\n');
  console.log('allocation                        S  layout         pop/65  health   gini  waitMean  shards  flourRatio  grainCover');

  for (const split of finalists) {
    for (const lay of LAYOUTS) {
      const r = run(split, lay.shardConfig, FINE_DAYS, FINE_BURN_IN, FINE_SEEDS);
      const flag = r.flourRatio > 1.0 ? '!' : ' ';
      console.log(
        `${label(split).padEnd(32)} ${String(total(split)).padStart(2)}  ${lay.label.padEnd(13)} ` +
          `${r.perShardPop.toFixed(1).padStart(6)}  ${r.health.toFixed(3)}  ${r.gini.toFixed(3)}  ` +
          `${r.waitMean.toFixed(1).padStart(8)}  ${r.shards.toFixed(1).padStart(6)}  ${r.flourRatio.toFixed(3).padStart(10)}${flag}  ${r.grainCover.toFixed(2).padStart(10)}`,
      );
    }
    console.log('');
  }
  console.log('flourRatio <= 1.000 required (hard filter). See docs/BLUEPRINT.md for the reading.');
}
