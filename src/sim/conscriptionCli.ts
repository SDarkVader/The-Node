import { runConscriptionSim } from './conscriptionHarness.js';

const SEEDS = [1, 2, 3, 4, 5];
const DAYS = 365 * 20;
const R_MILLER = 2;
const R_OTHER = 4;

function summarize(N: number, conscriptionDelay: number) {
  let genuine = 0;
  let conscriptions = 0;
  let backstop = 0;
  let vacant = 0;
  let backstopped = 0;
  let fromGossip = 0;
  let fromOther = 0;
  let otherBackstop = 0;

  for (const seed of SEEDS) {
    const r = runConscriptionSim({ N, rMiller: R_MILLER, rOther: R_OTHER, pMonthly: 0.2, days: DAYS, seed, conscriptionDelay });
    genuine += r.millerGenuineFills;
    conscriptions += r.millerConscriptions;
    backstop += r.millerBackstopFires;
    vacant += r.millerVacantSlotDays;
    backstopped += r.millerBackstoppedSlotDays;
    fromGossip += r.conscriptionsFromGossip;
    fromOther += r.conscriptionsFromOtherRole;
    otherBackstop += r.otherBackstopFires;
  }

  const totalMillerSlotDays = R_MILLER * DAYS * SEEDS.length;
  return {
    ratio: genuine / Math.max(backstop, 1),
    vacantPct: (vacant / totalMillerSlotDays) * 100,
    backstoppedPct: (backstopped / totalMillerSlotDays) * 100,
    conscriptions,
    pctFromOther: (fromOther / Math.max(fromGossip + fromOther, 1)) * 100,
    otherBackstop,
  };
}

console.log(`R_miller=${R_MILLER}, R_other=${R_OTHER}. Brief §2.4 targets: ratio ~1.2-2.8, starved ~1-2%.\n`);

for (const delay of [3, 7, 14, 30]) {
  console.log(`conscriptionDelay=${delay} days after backstop:`);
  for (const N of [50, 60, 80]) {
    const s = summarize(N, delay);
    console.log(
      `  N=${N}: ratio=${s.ratio.toFixed(2)} vacant=${s.vacantPct.toFixed(2)}% backstopped=${s.backstoppedPct.toFixed(2)}% conscriptions=${s.conscriptions} (${s.pctFromOther.toFixed(0)}% from other-role, otherBackstopFires=${s.otherBackstop})`,
    );
  }
}
