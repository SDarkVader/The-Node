import { createWorld, stepWorld, type World, type WorldConfig } from '../world/world.js';

/**
 * Measures the real, aggregate effect of `engine/experienceFloor.ts`'s head start —
 * queued in `docs/HANDOVER.md` as the real next step after the 2026-08-13 cap correction
 * (50%->15% of EXPERIENCE_CAP): "simulate the actual size of the productivity dip
 * with/without the floor... before trusting it further."
 *
 * Both arms run from the SAME seed and the SAME `WorldConfig`, so every random draw (who
 * churns, who's selected for conscription/genuineFill, who's noticed for Shift Cover) stays
 * in exact lockstep between them — `shiftsCoveredByRole` never influences selection or any
 * rng draw (confirmed directly in `world.ts`: selection is purely lowest-level/longest-wait).
 * The ONLY difference between the two arms is that the "no floor" arm has every grifter's
 * `shiftsCoveredByRole` stripped after each tick, so `experienceFloorFromShiftsCovered`
 * always computes from 0 there — an honest counterfactual, not a different code path.
 */

export interface ExperienceFloorRunResult {
  /** Miller+Baker mean `experience` each day, FILLED slots only (undefined = none FILLED). */
  meanFilledExperience: (number | undefined)[];
  economicHealthWithExperienceSeries: number[];
  /** Non-zero starting `experience` values landed on a Miller/Baker slot the SAME tick it
   *  transitioned from not-FILLED to FILLED — the direct, per-event size of the head start. */
  fillFloorValues: number[];
}

function stripShiftHistory(world: World): World {
  return { ...world, grifters: world.grifters.map((g) => ({ ...g, shiftsCoveredByRole: undefined })) };
}

function meanFilledExperience(w: World): number | undefined {
  const filled = [...w.millers, ...w.bakers].filter((s) => s.slot.state === 'FILLED');
  return filled.length > 0 ? filled.reduce((a, s) => a + s.experience, 0) / filled.length : undefined;
}

/** Miller+Baker buildingIds that were not FILLED before this tick and are FILLED after. */
function newlyFilledExperience(before: World, after: World): number[] {
  const beforeById = new Map(
    [...before.millers, ...before.bakers].map((s) => [s.buildingId, s.slot.state] as const),
  );
  const values: number[] = [];
  for (const s of [...after.millers, ...after.bakers]) {
    if (s.slot.state === 'FILLED' && beforeById.get(s.buildingId) !== 'FILLED') values.push(s.experience);
  }
  return values;
}

export function runExperienceFloorComparison(
  seed: number,
  days: number,
  config: WorldConfig,
): { withFloor: ExperienceFloorRunResult; withoutFloor: ExperienceFloorRunResult } {
  let withFloorWorld = createWorld(seed, config);
  let withoutFloorWorld = createWorld(seed, config);

  const withFloor: ExperienceFloorRunResult = { meanFilledExperience: [], economicHealthWithExperienceSeries: [], fillFloorValues: [] };
  const withoutFloor: ExperienceFloorRunResult = { meanFilledExperience: [], economicHealthWithExperienceSeries: [], fillFloorValues: [] };

  for (let day = 0; day < days; day++) {
    const prevWithFloor = withFloorWorld;
    const prevWithoutFloor = withoutFloorWorld;

    withFloorWorld = stepWorld(withFloorWorld);
    withoutFloorWorld = stripShiftHistory(stepWorld(withoutFloorWorld));

    withFloor.fillFloorValues.push(...newlyFilledExperience(prevWithFloor, withFloorWorld));
    withoutFloor.fillFloorValues.push(...newlyFilledExperience(prevWithoutFloor, withoutFloorWorld));

    withFloor.meanFilledExperience.push(meanFilledExperience(withFloorWorld));
    withFloor.economicHealthWithExperienceSeries.push(withFloorWorld.economicHealthWithExperience);
    withoutFloor.meanFilledExperience.push(meanFilledExperience(withoutFloorWorld));
    withoutFloor.economicHealthWithExperienceSeries.push(withoutFloorWorld.economicHealthWithExperience);
  }

  return { withFloor, withoutFloor };
}
