/**
 * Prints the recognition-v2 pre-build simulation (`npm run recognition-v2-sim`). Pure
 * measurement over `recognitionV2Harness.ts`; deterministic for a given source revision.
 * Results are recorded in `docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md`.
 */

import { runEpisode, resolve, daysTo, populationKnownFraction, SCENARIOS, CANDIDATE_RULES, type Episode } from './recognitionV2Harness.js';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => 101 + i);
const summary = (xs: (number | null)[]) => {
  const n = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const never = xs.length - n.length;
  return (n.length ? `${n[Math.floor(n.length / 2)]} [${n[0]}-${n.at(-1)}]` : '—') + (never ? ` ∅${never}` : '');
};
const pad = (s: string, n: number) => s.padEnd(n);

function table(days: number, seedCount: number, names: string[]) {
  const eps: Record<string, Episode[]> = Object.fromEntries(names.map((n) => [n, seeds(seedCount).map((s) => runEpisode(s, days, SCENARIOS[n]!.policy))]));
  const res = Object.fromEntries(CANDIDATE_RULES.map((r) => [r.id, Object.fromEntries(names.map((n) => [n, eps[n]!.map((ep) => resolve(ep, r))]))]));
  const checks: [string, string, string, string][] = [
    ['pair_daily', 'baker-0', 'importexport-0', 'A knows B'], ['pair_daily', 'importexport-0', 'baker-0', 'B knows A'],
    ['pair_daily', 'miller-0', 'baker-0', 'silent bystander C knows A'], ['pair_alternate', 'baker-0', 'importexport-0', 'A knows B'],
    ['one_way', 'importexport-0', 'baker-0', 'listener B knows speaker A'], ['one_way', 'baker-0', 'importexport-0', 'speaker A knows B'],
    ['broadcast', 'baker-0', 'importexport-0', 'A knows B'], ['room', 'baker-0', 'importexport-0', 'A knows B'],
    ['grifter_pair', 'grifter-0', 'baker-0', 'Grifter knows A'], ['grifter_pair', 'baker-0', 'grifter-0', 'A knows Grifter'],
    ['mixed', 'baker-0', 'importexport-0', 'A knows B'], ['mixed', 'miller-0', 'baker-0', 'C knows A'],
  ];
  console.log(`\n## ${days} days, seeds 101-${100 + seedCount}: days until recognition, median [min-max], ∅n = never in n seeds`);
  console.log(pad('scenario / pair', 44) + CANDIDATE_RULES.map((r) => pad(r.id, 17)).join(''));
  for (const [n, o, s, label] of checks) {
    if (!eps[n]) continue;
    console.log(pad(`${n}: ${label}`, 44) + CANDIDATE_RULES.map((r) => pad(summary(eps[n]!.map((ep, i) => daysTo(res[r.id]![n]![i]!, ep, o, s))), 17)).join(''));
  }
  for (const n of ['pair_daily', 'broadcast', 'room', 'mixed']) {
    if (!eps[n]) continue;
    const mean = (rid: string) => (eps[n]!.reduce((t, ep, i) => t + populationKnownFraction(res[rid]![n]![i]!, ep, 'baker-0'), 0) / eps[n]!.length).toFixed(2);
    console.log(pad(`${n}: share of population knowing A`, 44) + CANDIDATE_RULES.map((r) => pad(mean(r.id), 17)).join(''));
  }
  const first = eps[names[0]!]!;
  const audience = first.flatMap((e) => e.talkAudience).sort((a, b) => a - b);
  const departed = (a: string) => summary(first.map((ep) => (ep.departedOn.has(a) ? ep.departedOn.get(a)! + 1 : null)));
  const toGrifter = (a: string) => first.filter((ep) => ep.trace.get(a)!.some((t) => t?.role === 'Grifter')).length;
  console.log(`listeners per role-holder utterance (${names[0]}): median ${audience[Math.floor(audience.length / 2)]}, range ${audience[0]}-${audience.at(-1)}`);
  console.log(`departure day (${names[0]}): grifter-0 ${departed('grifter-0')}; baker-0 ${departed('baker-0')}; importexport-0 ${departed('importexport-0')}`);
  console.log(`role holders who became Grifters (of ${seedCount}): baker-0 ${toGrifter('baker-0')}, importexport-0 ${toGrifter('importexport-0')}`);
}

function shadowCheck() {
  let pairs = 0, mismatches = 0;
  for (const seed of seeds(5)) {
    const ep = runEpisode(seed, 40, SCENARIOS.mixed!.policy);
    const kernelOnly = { ...ep, hearings: ep.hearings.filter((h) => !h.modelled) };
    const shadow = resolve(kernelOnly, CANDIDATE_RULES[0]!);
    const pop = new Set(ep.population), subjects = new Set(ep.persons.values());
    const mine = [...shadow].filter(([k]) => pop.has(k.split('>')[0]!) && subjects.has(k.split('>')[1]!));
    pairs += ep.kernelV1.size;
    mismatches += Math.abs(mine.length - ep.kernelV1.size) + mine.filter(([k, d]) => ep.kernelV1.get(k) !== d).length;
  }
  console.log(`## Shadow-ledger check: rule v1 replayed on kernel hearings vs the kernel's own ledger, 5 seeds x 40 days: ${pairs} recognised pairs, ${mismatches} mismatches`);
}

console.log('# Recognition v2 pre-build simulation');
for (const r of CANDIDATE_RULES) console.log(`- ${r.id}: ${r.label}`);
shadowCheck();
table(60, 20, Object.keys(SCENARIOS));
table(200, 10, ['pair_daily', 'one_way', 'broadcast']);
