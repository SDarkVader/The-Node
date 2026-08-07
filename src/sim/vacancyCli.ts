import { runVacancySim, percentile } from './vacancyHarness.js';

const DAYS = 365 * 20;
const SEEDS = [1, 2, 3, 4, 5];

/**
 * Prints both the ratio the brief's §2.4 almost certainly means (genuine fills / backstop
 * fires) and the inflated one (voluntaryFills, which also counts backstop-recovery events
 * as if they were an alternative to backstop rather than a consequence of it) — see
 * docs/BLUEPRINT.md "Open deviations" for why both are shown.
 */
function sweep(backstoppedRecoveryHazard?: number) {
  console.log('N\tcorrectedRatio\tinflatedRatio\tvacantOnly%\tvacant+backstopped%\tp90Gap');
  for (const N of [50, 60, 80]) {
    let genuine = 0;
    let recoveries = 0;
    let backstop = 0;
    let vacant = 0;
    let backstopped = 0;
    let slotDays = 0;
    let gaps: number[] = [];

    for (const seed of SEEDS) {
      const r = runVacancySim({ N, R: 3, pMonthly: 0.2, days: DAYS, seed, backstoppedRecoveryHazard });
      genuine += r.genuineVoluntaryFills;
      recoveries += r.backstopRecoveries;
      backstop += r.backstopFires;
      vacant += r.vacantSlotDays;
      backstopped += r.backstoppedSlotDays;
      slotDays += r.totalSlotDays;
      gaps = gaps.concat(r.gapDays);
    }

    const correctedRatio = genuine / Math.max(backstop, 1);
    const inflatedRatio = (genuine + recoveries) / Math.max(backstop, 1);
    const vacantOnly = (vacant / slotDays) * 100;
    const both = ((vacant + backstopped) / slotDays) * 100;
    const p90 = percentile(gaps, 90);
    console.log(
      `${N}\t${correctedRatio.toFixed(2)}\t\t${inflatedRatio.toFixed(2)}\t\t${vacantOnly.toFixed(2)}\t\t${both.toFixed(2)}\t\t\t${p90.toFixed(1)}`,
    );
  }
}

console.log('Default (beta=0.03, t_hard=3, recalibrated 2026-08-07 — hits the brief\'s §2.4 targets directly, see BLUEPRINT.md):');
sweep();

console.log('\nArtificially low recovery hazard (0.0005, ~2000-day mean recovery) for comparison — this is the OLD failure mode: throttling recovery instead of recalibrating t_hard/beta pushes BACKSTOPPED time to 80%+, the NPC-dominance tradeoff Miller conscription exists to avoid:');
sweep(0.0005);
