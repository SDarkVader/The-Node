import { mulberry32 } from './rng.js';
import {
  generateShardLayout,
  occupantsWithin,
  type ShardLayoutConfig,
  type PlayerPosition,
} from '../engine/space.js';
import { detectionProbability, patternStepDetectionProbability } from '../engine/ecosystem.js';

/**
 * Phase A deliverable: what real spatial witness counts do to the two existing sabotage
 * calibrations, which both assumed a flat ~23 witnesses (S_DEFAULT=24 role-slots, "every
 * other role-holder in a healthy shard sees everything, regardless of where they are").
 * Reports the real numbers; does NOT retune DETECTION_P_PER_WITNESS, PATTERN_P_PER_WITNESS,
 * or anything else — per the spec's explicit instruction.
 *
 * Config below produces exactly S_DEFAULT=24 buildings (1 core district, 14 buildings;
 * 2 periphery districts, 5 each) so the role-holder count matches the existing
 * calibration's own assumption — an apples-to-apples comparison, not a different shard
 * shape entirely.
 */

const REPORT_CONFIG: ShardLayoutConfig = {
  targetPopulation: 65,
  coreDistrictCount: 1,
  peripheryDistrictCount: 2,
  coreDistrictRadius: 6,
  peripheryDistrictRadius: 5,
  coreSpacing: 1,
  peripherySpacing: 2,
  buildingsPerCoreDistrict: 14,
  buildingsPerPeripheryDistrict: 5,
};

function buildOccupants(shard: ReturnType<typeof generateShardLayout>, targetPopulation: number, rand: () => number) {
  const occupants: PlayerPosition[] = [];
  const buildingIdToPlayerId = new Map<string, string>();
  let idCounter = 0;

  // Role-holders: one player per building, standing at their building's own plot.
  for (const district of shard.districts) {
    for (const building of district.buildings) {
      const playerId = `role-${idCounter++}`;
      occupants.push({ playerId, x: building.x, y: building.y });
      buildingIdToPlayerId.set(building.id, playerId);
    }
  }
  const roleHolderCount = occupants.length;
  const roleHolderIds = new Set(occupants.map((o) => o.playerId));

  // Gossip-layer players: scattered across every district's street/plaza plots, deterministic.
  const gossipCount = Math.max(0, targetPopulation - roleHolderCount);
  const allStreetPlots = shard.districts.flatMap((d) => d.plots.filter((p) => p.kind !== 'building'));
  for (let i = 0; i < gossipCount; i++) {
    const plot = allStreetPlots[Math.floor(rand() * allStreetPlots.length)]!;
    occupants.push({ playerId: `gossip-${i}`, x: plot.x, y: plot.y });
  }

  return { occupants, roleHolderCount, roleHolderIds, buildingIdToPlayerId };
}

function report(seed: number) {
  const rand = mulberry32(seed);
  const shard = generateShardLayout(seed, REPORT_CONFIG);
  const { occupants, roleHolderCount, roleHolderIds, buildingIdToPlayerId } = buildOccupants(
    shard,
    REPORT_CONFIG.targetPopulation,
    rand,
  );

  console.log(`Seed ${seed}: ${shard.districts.length} districts, ${roleHolderCount} role-holder buildings, ${occupants.length} total occupants.\n`);

  const coreDistrict = shard.districts.find((d) => d.classification === 'core')!;
  const target = coreDistrict.buildings[0]!;
  const targetPlot = { x: target.x, y: target.y };
  const targetPlayerId = buildingIdToPlayerId.get(target.id)!;

  console.log(`Sabotage target: building ${target.id} in core district ${coreDistrict.id}, plot (${targetPlot.x},${targetPlot.y}).\n`);

  const ASSUMED_FLAT_WITNESSES = 23; // S_DEFAULT - 1, the previous calibration's assumption

  console.log('radius\trawOccupants\troleHoldersOnly\tactBased(assumed23)\tactBased(real,raw)\tactBased(real,roleHolders)');
  for (const radius of [3, 6, 15, 999]) {
    const withinRaw = occupantsWithin(shard, occupants, targetPlot, radius).filter((id) => id !== targetPlayerId);
    const withinRoleHolders = withinRaw.filter((id) => roleHolderIds.has(id));
    const rawCount = withinRaw.length;
    const roleHolderOnlyCount = withinRoleHolders.length;

    const actAssumed = detectionProbability(ASSUMED_FLAT_WITNESSES);
    const actRealRaw = detectionProbability(rawCount);
    const actRealRoleHolders = detectionProbability(roleHolderOnlyCount);

    console.log(
      `${radius}\t${rawCount}\t\t${roleHolderOnlyCount}\t\t${(actAssumed * 100).toFixed(1)}%\t\t\t${(actRealRaw * 100).toFixed(1)}%\t\t\t${(actRealRoleHolders * 100).toFixed(1)}%`,
    );
  }

  console.log('\nPattern-based proposal — step 1 of 6 (should stay near-undetectable) and step 6 of 6 (full pattern):');
  console.log('radius\trawOccupants\tstep1(assumed23)\tstep1(real,raw)\tstep6(assumed23)\tstep6(real,raw)');
  for (const radius of [3, 6, 15, 999]) {
    const withinRaw = occupantsWithin(shard, occupants, targetPlot, radius).filter((id) => id !== targetPlayerId);
    const rawCount = withinRaw.length;

    const step1Assumed = patternStepDetectionProbability(1, 6, ASSUMED_FLAT_WITNESSES, false);
    const step1Real = patternStepDetectionProbability(1, 6, rawCount, false);
    const step6Assumed = patternStepDetectionProbability(6, 6, ASSUMED_FLAT_WITNESSES, false);
    const step6Real = patternStepDetectionProbability(6, 6, rawCount, false);

    console.log(
      `${radius}\t${rawCount}\t\t${(step1Assumed * 100).toFixed(2)}%\t\t\t${(step1Real * 100).toFixed(2)}%\t\t\t${(step6Assumed * 100).toFixed(1)}%\t\t\t${(step6Real * 100).toFixed(1)}%`,
    );
  }
  console.log('');
}

console.log('Spatial witness counts vs. the previously assumed flat 23 — Phase A deliverable, NOT a recalibration.\n');
console.log(
  'ASSUMPTION FLAGGED FOR REVIEW: the witnessing radius itself is not specified anywhere in the brief or the\n' +
    'Observatory spec. Reported at four illustrative radii (3 = immediate street, 6 = whole core district,\n' +
    '15 = most of the shard, 999 = everyone regardless of location) rather than picking one and asserting it is\n' +
    'correct. Also flagged: whether "witness" should mean anyone physically nearby (raw occupants, including\n' +
    'the roleless gossip layer) or only other role-holders (matching the original calibration\'s own framing,\n' +
    '"other role-holders present") is a real open design question — both are reported.\n',
);

for (const seed of [1, 2, 3]) {
  report(seed);
}
