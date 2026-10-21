/**
 * Prints the recognition-v2 pre-build simulation (`npm run recognition-v2-sim`). Pure
 * measurement over `recognitionV2Harness.ts`; deterministic for a given source revision.
 * Results are recorded in `docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md`.
 */

import { runEpisode, resolve, runLedger, currentlyKnownBy, daysTo, populationKnownFraction, SCENARIOS, CANDIDATE_RULES, OWNER_RULES,
  type Episode, type CustomerModel, type Hearing } from './recognitionV2Harness.js';

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

const rule = (id: string) => OWNER_RULES.find((r) => r.id === id)!;
const key = (ep: Episode, o: string, s: string) => `${ep.persons.get(o)}>${ep.persons.get(s)}`;

function lapse() {
  const eps = seeds(10).map((s) => runEpisode(s, 160, SCENARIOS.pair_then_stop!.policy));
  console.log('\n## Losing resolution: A and B deal daily days 1-20, stop for 120 days, resume days 141-160 (seeds 101-110)');
  for (const id of ['O', 'O-short']) {
    const runs = eps.map((ep) => runLedger(ep, rule(id)));
    const iv = runs.map((r, i) => r.intervals.get(key(eps[i]!, 'baker-0', 'importexport-0')) ?? []);
    const firstOn = iv.map((l) => (l[0] ? l[0][0] + 1 : null));
    const lapseAfterStop = iv.map((l) => (l[0] && l[0][1] !== null ? l[0][1] - 19 : null));
    const reResolve = iv.map((l) => (l[1] ? l[1][0] - 139 : l[0] && l[0][1] === null ? 0 : null));
    const credit = runs.map((r, i) => {
      const ep = eps[i]!, k = key(ep, 'baker-0', 'importexport-0');
      return r.credit.get(k) ?? 0;
    });
    console.log(`${pad(id, 8)} first resolved day ${summary(firstOn)}; lapsed ${summary(lapseAfterStop)} days after contact stopped; ` +
      `re-resolved ${summary(reResolve)} days after resuming (0 = never lapsed); end credit ${summary(credit)}`);
  }
}

function refusal() {
  const names = ['one_way', 'refuse_reply'];
  const eps = Object.fromEntries(names.map((n) => [n, seeds(20).map((s) => runEpisode(s, 60, SCENARIOS[n]!.policy))]));
  console.log('\n## Refusal (60 days, seeds 101-120). one_way: A addresses B daily, B stays silent. refuse_reply: B answers A daily with intent refuse.');
  console.log(pad('rule', 8) + pad('one_way A knows B', 22) + pad('one_way B knows A', 22) + pad('refuse_reply A knows B', 25) + pad('refuse_reply B knows A', 25) + 'bystander C knows A or B');
  for (const id of ['O', 'O-R7', 'O-R14']) {
    const r1 = eps.one_way!.map((ep) => resolve(ep, rule(id))), r2 = eps.refuse_reply!.map((ep) => resolve(ep, rule(id)));
    const by = [...eps.one_way!.map((ep, i) => [ep, r1[i]!] as const), ...eps.refuse_reply!.map((ep, i) => [ep, r2[i]!] as const)]
      .map(([ep, R]) => { const a = daysTo(R, ep, 'miller-0', 'baker-0'), b = daysTo(R, ep, 'miller-0', 'importexport-0'); return a ?? b; });
    console.log(pad(id, 8) + pad(summary(eps.one_way!.map((ep, i) => daysTo(r1[i]!, ep, 'baker-0', 'importexport-0'))), 22) +
      pad(summary(eps.one_way!.map((ep, i) => daysTo(r1[i]!, ep, 'importexport-0', 'baker-0'))), 22) +
      pad(summary(eps.refuse_reply!.map((ep, i) => daysTo(r2[i]!, ep, 'baker-0', 'importexport-0'))), 25) +
      pad(summary(eps.refuse_reply!.map((ep, i) => daysTo(r2[i]!, ep, 'importexport-0', 'baker-0'))), 25) + summary(by));
  }
  // Interpretation: what each listener heard of B's refusals (kernel distortion, real hearings).
  const heard = eps.refuse_reply!.flatMap((ep) => ep.hearings.filter((h) => h.channel === 'talk' && !h.modelled && h.intent === 'refuse' && h.source === ep.persons.get('importexport-0'))
    .map((h) => ({ h, addressee: h.hearer === ep.persons.get('baker-0') })));
  const rate = (xs: { h: Hearing }[]) => {
    const tally: Record<string, number> = {};
    for (const { h } of xs) tally[h.heardIntent!] = (tally[h.heardIntent!] ?? 0) + 1;
    return `${xs.length} hearings: ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / xs.length).toFixed(1)}%`).join(', ');
  };
  const near = heard.filter((x) => !x.addressee && x.h.closeness >= 0.5), far = heard.filter((x) => !x.addressee && x.h.closeness < 0.5);
  console.log(`interpretation of B's refuse — addressee A: ${rate(heard.filter((x) => x.addressee))}`);
  console.log(`  bystanders closeness >= 0.5: ${rate(near)}`);
  console.log(`  bystanders closeness < 0.5: ${rate(far)}`);
}

function customers() {
  console.log('\n## Customers (MODELLED purchase channel; nobody speaks; 60 days, seeds 101-110)');
  console.log(pad('model / rule', 18) + pad('people knowing baker-0 at day 60', 34) + pad('baker-0 knows at day 60', 26) + pad('days for a customer to know baker-0', 38) + pad('grifter-0 knows a baker', 26) + pad('controlled pairs', 18) + 'share of population known by anyone at day 60');
  for (const model of ['mixed', 'loyal', 'nearest'] as CustomerModel[]) {
    const eps = seeds(10).map((s) => runEpisode(s, 60, SCENARIOS.quiet!.policy, { customers: model }));
    for (const id of ['O-C14', 'O-C45']) {
      const runs = eps.map((ep) => runLedger(ep, rule(id)));
      const knowB = runs.map((r, i) => currentlyKnownBy(r, eps[i]!, 'baker-0').length);
      const bKnows = runs.map((r, i) => { const b = eps[i]!.persons.get('baker-0')!; return [...r.intervals].filter(([k, l]) => k.startsWith(`${b}>`) && l.at(-1)![1] === null).length; });
      const days = runs.flatMap((r, i) => { const b = eps[i]!.persons.get('baker-0')!; return [...r.first].filter(([k]) => k.endsWith(`>${b}`)).map(([, d]) => d + 1); });
      const grifter = runs.map((r, i) => { const g = eps[i]!.persons.get('grifter-0')!; const d = [...r.first].filter(([k]) => k.startsWith(`${g}>`)).map(([, x]) => x + 1); return d.length ? Math.min(...d) : null; });
      const ctrl = runs.map((r, i) => { const c = new Set(eps[i]!.persons.values()); return [...r.first.keys()].filter((k) => c.has(k.split('>')[0]!) && c.has(k.split('>')[1]!)).length; });
      const coverage = runs.map((r, i) => {
        const known = new Set([...r.intervals].filter(([, l]) => l.at(-1)![1] === null).map(([k]) => k.split('>')[1]!));
        return eps[i]!.population.filter((p) => known.has(p)).length / eps[i]!.population.length;
      });
      const mean = (xs: number[]) => (xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(2);
      console.log(pad(`${model} / ${id}`, 18) + pad(summary(knowB), 34) + pad(summary(bKnows), 26) + pad(summary(days), 38) + pad(summary(grifter), 26) + pad(summary(ctrl), 18) + mean(coverage));
    }
  }
}

const part = process.argv[2] ?? 'all';
console.log('# Recognition v2 pre-build simulation');
if (part === 'all' || part === 'first') {
  for (const r of CANDIDATE_RULES) console.log(`- ${r.id}: ${r.label}`);
  shadowCheck();
  table(60, 20, Object.keys(SCENARIOS).filter((n) => !['pair_then_stop', 'refuse_reply', 'quiet'].includes(n)));
  table(200, 10, ['pair_daily', 'one_way', 'broadcast']);
}
if (part === 'all' || part === 'owner') {
  console.log('\n# Second pass: the owner statements of 2026-10-21');
  for (const r of OWNER_RULES) console.log(`- ${r.id}: ${r.label}`);
  lapse();
  refusal();
  customers();
}
