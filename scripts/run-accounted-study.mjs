// Run an authorised study manifest against its experiment allowance. Capped batch: one request
// outstanding at a time, no retries, stops at the cap, expiry or the first inference failure.
// Args: <emitted runtime> <experiment allowance directory> <NEW private artifact directory>
//       <approved credential .env file> <runner commit sha> <study manifest .json> [--resume <prior run dir> ...]
// Resume: completed episodes in the prior run directories are re-verified by replay (same runner
// revision required) and skipped; an interrupted episode is re-run as a new attempt. Settle the
// failed call first (scripts/settle-failed-call.mjs) or the allowance stays blocked.
// Keep the artifact directory outside the checkout: it holds request/response bytes and records.
// Each call gets its own directory, so the unchanged transport worker never overwrites evidence.
import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, appendFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
if (args.length < 6 || !/^[a-f0-9]{40}$/.test(args[4]) || (args.length > 6 && (args[6] !== '--resume' || args.length < 8))) throw Error('explicit_arguments_required');
const priorRuns = args.slice(7).map((x) => resolve(x));
const [runtime, budgetDirectory, directory, keyPath] = args.slice(0, 4).map((x) => resolve(x));
const runnerRevision = args[4], manifestPath = resolve(args[5]);
const load = (file) => import(pathToFileURL(join(runtime, file)).href);
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { runAccountedStudy, manifestSha256 } = await load('eval/accountedRunner.js');
const { hostProcessEnvironment } = await load('agent/isolatedHost.js');
const { replay, evidenceHash } = await load('agent/replay.js');

const write = (name, value) => {
  const fd = openSync(join(directory, name), 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
};
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const worker = fileURLToPath(new URL('./initial-test-request.ps1', import.meta.url));
const report = { runnerRevision, manifestId: manifest.id, manifestSha256: manifestSha256(manifest), startedAtUtc: new Date().toISOString(), dispatched: 0, summary: null,
  resumedFrom: priorRuns, skippedVerified: [] };
// Completed episodes from earlier runs: replay-verified, same runner revision, named in the manifest.
const completedEpisodes = new Set();
for (const prior of priorRuns) {
  for (const name of readdirSync(join(prior, 'episodes')).filter((f) => f.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(join(prior, 'episodes', name), 'utf8'));
    if (record.status !== 'completed') continue;
    if (record.sourceRevision !== runnerRevision) throw Error('resume_revision_mismatch');
    if (evidenceHash(replay(record.tape, record.tape.genesis.sourceRevision)) !== record.finalStateHash) throw Error('resume_replay_mismatch');
    const episodeId = name.replace(/\.json$/, '').replace(/-a\d+$/, '');
    if (!manifest.episodes.some((e) => e.episodeId === episodeId) || completedEpisodes.has(episodeId)) throw Error('resume_episode_invalid');
    completedEpisodes.add(episodeId); report.skippedVerified.push({ episodeId, from: join(prior, 'episodes', name), finalStateHash: record.finalStateHash });
  }
}

mkdirSync(directory, { mode: 0o700 });            // exclusive: never reuse an earlier run directory
mkdirSync(join(directory, 'calls'), { mode: 0o700 });
mkdirSync(join(directory, 'episodes'), { mode: 0o700 });

const send = async (input, signal) => {
  const callDirectory = join(directory, 'calls', String(input.index).padStart(5, '0'));
  mkdirSync(callDirectory, { mode: 0o700 });
  const callWrite = (name, value) => { const fd = openSync(join(callDirectory, name), 'wx', 0o600); try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } };
  // The runner has already durably reserved this request's ceiling.
  callWrite('request.json', input.body);
  callWrite('attempt.json', JSON.stringify({ requestId: input.requestId, requestSha256: input.sha256, episodeId: input.episodeId, actorId: input.actorId, tick: input.tick, noRetry: true, reservedAtUtc: new Date().toISOString() }) + '\n');
  report.dispatched++;
  try {
    await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-File', worker, '-KeyPath', keyPath, '-ArtifactDirectory', callDirectory],
      { env: hostProcessEnvironment(process.env), windowsHide: true, signal, timeout: 15000, maxBuffer: 8192 });
  } catch { throw Error('bounded_worker_failed'); }
  const network = JSON.parse(readFileSync(join(callDirectory, 'network.json'), 'utf8'));
  if (network.httpStatus !== 200 || network.outcome !== 'response_archived') throw Error('provider_response_failed');
  const bytes = readFileSync(join(callDirectory, 'response.json'));
  if (bytes.length > 262144) throw Error('response_bounds');
  return bytes;
};
const sink = {
  call: (entry) => appendFileSync(join(directory, 'calls.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }),
  episode: (record, episodeId) => write(join('episodes', `${episodeId}.json`), record),
};

let budget;
try {
  budget = ExperimentBudget.open(budgetDirectory);
  // The fixture observer secret must never appear in a request body.
  report.summary = await runAccountedStudy(manifest, budget, send, sink, { sourceRevision: runnerRevision, forbiddenSubstrings: ['offline-fixture-observer-secret'], completedEpisodes });
} catch (error) {
  report.error = report.dispatched ? 'run_failed_after_dispatch_do_not_retry' : 'preflight_failed_no_dispatch';
  report.errorCode = /^[a-z0-9_]{1,100}$/.test(error?.message) ? error.message : 'local_runner_error';
} finally {
  if (budget) {
    try {
      const v = budget.view();
      report.allowance = { requests: v.requests.length, bookedMicroUsd: v.booked, heldMicroUsd: v.held, remainingMicroUsd: v.remainingMicroUsd, stopReason: v.stopReason };
    } finally { budget.close(); }
  }
  report.finishedAtUtc = new Date().toISOString();
  write('report.json', report);
}
console.log(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
if (report.error || report.summary?.stoppedReason) process.exitCode = 1;
