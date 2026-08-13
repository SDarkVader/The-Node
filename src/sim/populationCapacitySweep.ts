import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type WorldConfig } from '../world/world.js';

/**
 * Verifies `docs/DESIGN_ADDENDUM_2026-08-13.md`'s central economic claim — "scale
 * district/shard count as population grows, not role-slot count, because slot-scaling
 * starves the grifter pool" — against the REAL shipped engine (`world.ts`'s actual Cournot/
 * Bertrand markets, grain/nodule chain, vacancy/backstop/consolidation, wealth tracking),
 * not the addendum's own toy Python `economic_health()` formula (`design/node_core_
 * reference.py` — a flat `(filled*1.0 + npc*0.4)/S` with no districts, no market, no grain
 * chain: the PRE-PORT design sketch this whole engine was later built from and has long
 * since outgrown). Per CLAUDE.md constraint 1 ("simulate before trusting") — an external
 * document's own sweep script is not itself a substitute for checking against the real
 * system, the same discipline every other addendum item this session was held to.
 *
 * METHOD: holds the validated 5:5:5:5:5:3 role RATIO (`jointGridSearch.ts`'s shipped
 * winner) fixed, and compares two ways of accommodating a higher target population within
 * ONE shard: (A) role-slot count SCALED UP proportionally with population (mirroring the
 * addendum's "Larger (S=30/32)" candidates), vs (B) role-slot count held FIXED at the
 * shipped 28 regardless of target population (mirroring "scale the settlement, not the
 * slots" — the addendum's own preferred direction, though its mechanism is adding
 * DISTRICTS within a shard, not raising `targetPopulation` on a fixed-district shard;
 * that district-count mechanic does not exist in this engine yet, so this sweep tests the
 * economic CLAIM the addendum is built on, not yet the exact geometry it proposes).
 */

const DAYS = 2000;
const BURN_IN = 400;
const SEEDS = [1, 2, 3];

interface Candidate {
  label: string;
  targetPopulation: number;
  scaleSlotsWithPopulation: boolean;
}

const CANDIDATES: Candidate[] = [
  { label: 'shipped baseline (targetPop=65, 28 slots)', targetPopulation: 65, scaleSlotsWithPopulation: false },
  { label: 'higher target, slots FIXED at 28 (targetPop=90)', targetPopulation: 90, scaleSlotsWithPopulation: false },
  { label: 'higher target, slots FIXED at 28 (targetPop=100)', targetPopulation: 100, scaleSlotsWithPopulation: false },
  { label: 'higher target, slots SCALED to match (targetPop=90, ~39 slots)', targetPopulation: 90, scaleSlotsWithPopulation: true },
  { label: 'higher target, slots SCALED to match (targetPop=100, ~43 slots)', targetPopulation: 100, scaleSlotsWithPopulation: true },
];

function configFor(c: Candidate): WorldConfig {
  if (!c.scaleSlotsWithPopulation) {
    return { ...DEFAULT_WORLD_CONFIG, targetPopulation: c.targetPopulation };
  }
  // Scale the shipped 5:5:5:5:5:3 (28 total) ratio up proportionally to the new target
  // population, same ratio the addendum's "Larger (S=30/32)" candidates approximate.
  const scale = c.targetPopulation / DEFAULT_WORLD_CONFIG.targetPopulation;
  const round = (n: number) => Math.max(1, Math.round(n * scale));
  return {
    ...DEFAULT_WORLD_CONFIG,
    targetPopulation: c.targetPopulation,
    rMiller: round(DEFAULT_WORLD_CONFIG.rMiller),
    rBaker: round(DEFAULT_WORLD_CONFIG.rBaker),
    rCourier: round(DEFAULT_WORLD_CONFIG.rCourier),
    rJournalist: round(DEFAULT_WORLD_CONFIG.rJournalist),
    rDetective: round(DEFAULT_WORLD_CONFIG.rDetective),
    rImportExport: round(DEFAULT_WORLD_CONFIG.rImportExport),
    shardConfig: {
      ...DEFAULT_WORLD_CONFIG.shardConfig,
      buildingsPerCoreDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerCoreDistrict * scale),
      buildingsPerPeripheryDistrict: Math.round(DEFAULT_WORLD_CONFIG.shardConfig.buildingsPerPeripheryDistrict * scale),
    },
  };
}

function totalSlots(config: WorldConfig): number {
  return config.rMiller + config.rBaker + config.rCourier + config.rJournalist + config.rDetective + config.rImportExport;
}

console.log(`Population-capacity sweep: does slot-scaling or settlement-scaling protect grifter headroom, in the REAL engine? (${DAYS} days, burn-in ${BURN_IN}, seeds ${SEEDS.join(',')})\n`);
console.log('candidate\tslots\tmeanPop\tmeanGrifterPct\tmeanEconHealth\tmeanFlourRatio');

for (const c of CANDIDATES) {
  const config = configFor(c);
  const slots = totalSlots(config);
  let popSum = 0;
  let grifterPctSum = 0;
  let healthSum = 0;
  let flourRatioSum = 0;
  let n = 0;

  for (const seed of SEEDS) {
    let world = createWorld(seed, config);
    for (let i = 0; i < DAYS; i++) {
      world = stepWorld(world);
      if (i < BURN_IN) continue;
      const grifterPct = world.population > 0 ? (world.grifters.length / world.population) * 100 : 0;
      popSum += world.population;
      grifterPctSum += grifterPct;
      healthSum += world.economicHealth;
      const c2 = world.resources.cumulative;
      flourRatioSum += c2.flourProduced > 0 ? c2.flourConsumed / c2.flourProduced : 1;
      n++;
    }
  }

  console.log(
    `${c.label}\t${slots}\t${(popSum / n).toFixed(1)}\t${(grifterPctSum / n).toFixed(1)}%\t\t${(healthSum / n).toFixed(3)}\t\t${(flourRatioSum / n).toFixed(3)}`,
  );
}

console.log(
  '\nIf slot-scaling genuinely starved the grifter pool the way the addendum\'s toy formula predicts, the\n' +
    '"SCALED" rows above should show a materially lower grifter% than the "FIXED" rows at the same target\n' +
    'population. If flourRatio breaks (>1.05) for the scaled candidates, that is a SEPARATE, real coherence\n' +
    'risk the toy formula could never have caught (it has no grain/flour chain at all) — exactly the kind of\n' +
    'thing "measure against the real system" exists to catch.',
);
