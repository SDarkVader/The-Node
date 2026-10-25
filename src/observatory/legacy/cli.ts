/**
 * Observatory command line (read-only; makes no provider call and steps no running host).
 *
 *   npm run observatory -- verify   <registration.json>
 *   npm run observatory -- serve    <registration.json>... [--host 127.0.0.1] [--port 8090] [--poll-ms 1000]
 *   npm run observatory -- evaluate <registration.json> --out <NEW evaluations.jsonl>
 *   npm run observatory -- export-frames <registration.json> --out <NEW frames.json>
 *
 * A registration is a private, server-side file naming the experiment and its ledger segments
 * (schema node-observatory-registration-v1, see docs/observatory/README.md). Keep it, and every
 * file it names, out of the repository.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { newTokens, type Tokens } from './auth.js';
import type { ExperimentRegistration } from './contracts.js';
import { authorityApplicability, diaryEvaluationRecords } from './evaluations.js';
import { exportFrames } from './frameExport.js';
import { ObservatoryExperiment } from './ledgerTail.js';
import { GODOT_PATH, startObservatoryServer } from './server.js';
import { telemetry } from './telemetryMetrics.js';
import { WorldProjection } from './worldProjection.js';

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ExperimentRegistration;
const fresh = (path: string | undefined) => { if (!path) throw Error('--out required'); if (existsSync(path)) throw Error('output_must_not_exist'); return path; };

function open(path: string) {
  const experiment = new ObservatoryExperiment(load(path));
  experiment.refresh();
  if (experiment.error) throw Error(experiment.error);
  const projection = new WorldProjection(experiment);
  projection.sync();
  return { experiment, projection };
}

if (command === 'verify') {
  const { experiment, projection } = open(positional[0]!);
  const t = telemetry(experiment.events());
  const stops = experiment.rawEvents().filter(x => x.event.kind === 'stop').map(x => ({ segmentId: x.segmentId, finalStateHash: x.event.data.summary.finalStateHash as string, ticks: x.event.data.summary.ticks as number }));
  const frames = projection.frames();
  const stopHashesMatch = stops.every(s => frames[s.ticks]?.worldHash === s.finalStateHash);
  console.log(JSON.stringify({
    experimentId: experiment.registration.experimentId, segments: experiment.segments(),
    uniqueRequests: t.call_attempt_count, executedDecisions: t.executed_decision_count, completedTicks: t.completed_tick_count, finalTick: t.final_tick,
    requestsPerSegment: Object.fromEntries(experiment.segments().map(s => [s.segmentId, experiment.events().filter(e => e.segmentId === s.segmentId && e.type === 'request').length])),
    framesVerified: frames.length, stopHashesMatchFrames: stopHashesMatch, finalWorldHash: frames.at(-1)?.worldHash ?? null,
    telemetry: t,
  }, null, 2));
  process.exitCode = stopHashesMatch ? 0 : 1;
} else if (command === 'evaluate') {
  const { experiment } = open(positional[0]!);
  const out = fresh(flag('--out'));
  const { records } = diaryEvaluationRecords(experiment, 'npm run observatory -- evaluate');
  records.push(authorityApplicability(experiment));
  writeFileSync(out, records.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ wrote: records.length, statuses: records.map(r => [r.evaluationId, r.status, r.value]) }, null, 2));
} else if (command === 'export-frames') {
  const { projection } = open(positional[0]!);
  const out = fresh(flag('--out'));
  const exported = exportFrames(projection);
  writeFileSync(out, JSON.stringify(exported), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ wrote: exported.frames.length, mode: exported.mode }));
} else if (command === 'serve') {
  const registrations = positional.map(load);
  const tokens: Tokens = process.env.NODE_OBSERVATORY_RESEARCHER_TOKEN && process.env.NODE_OBSERVATORY_RENDERER_TOKEN
    ? { researcher: process.env.NODE_OBSERVATORY_RESEARCHER_TOKEN, renderer: process.env.NODE_OBSERVATORY_RENDERER_TOKEN } : newTokens();
  const host = flag('--host') ?? '127.0.0.1';
  const s = await startObservatoryServer(registrations, { host, port: Number(flag('--port') ?? 8090), pollMs: Number(flag('--poll-ms') ?? 1000), tokens });
  const ws = s.url.replace(/^http/, 'ws');
  console.log(`Observatory (read-only) at ${s.url}/observatory/#token=${tokens.researcher}`);
  for (const id of s.service.runs.keys()) console.log(`Godot: --world-url=${ws}${GODOT_PATH}?run=${encodeURIComponent(id)}&token=${tokens.renderer}`);
  console.log('Tokens are printed for this local console only. Do not share them or expose this listener beyond loopback.');
} else {
  console.error('usage: observatory verify|serve|evaluate|export-frames <registration.json> [...]');
  process.exitCode = 2;
}
