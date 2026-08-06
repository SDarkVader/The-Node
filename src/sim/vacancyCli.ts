import { runVacancySim, percentile } from './vacancyHarness.js';

const DAYS = 365 * 20;
const SEEDS = [1, 2, 3, 4, 5];

console.log('N\tratio\tvacantOnly%\tvacant+backstopped%\tp90Gap');
for (const N of [50, 60, 80]) {
  let voluntary = 0;
  let backstop = 0;
  let vacant = 0;
  let backstopped = 0;
  let slotDays = 0;
  let gaps: number[] = [];

  for (const seed of SEEDS) {
    const r = runVacancySim({ N, R: 3, pMonthly: 0.2, days: DAYS, seed });
    voluntary += r.voluntaryFills;
    backstop += r.backstopFires;
    vacant += r.vacantSlotDays;
    backstopped += r.backstoppedSlotDays;
    slotDays += r.totalSlotDays;
    gaps = gaps.concat(r.gapDays);
  }

  const ratio = voluntary / Math.max(backstop, 1);
  const vacantOnly = (vacant / slotDays) * 100;
  const both = ((vacant + backstopped) / slotDays) * 100;
  const p90 = percentile(gaps, 90);
  console.log(`${N}\t${ratio.toFixed(2)}\t${vacantOnly.toFixed(2)}\t\t${both.toFixed(2)}\t\t\t${p90.toFixed(1)}`);
}
