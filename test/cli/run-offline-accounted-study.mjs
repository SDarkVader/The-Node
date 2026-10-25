// TEST ONLY G3 CLI fixture. Uses the real compiled accounting/runner/replay with a fixed
// pure response fixture. No credential argument, process launcher, network client or gate
// override exists. Non-fixture financial journals are refused before a writer lock is opened.
// Args: runtime TEST-ONLY allowance NEW output revision TEST-ONLY manifest
//       [--fail-at <index>] [--resume <prior run> ...].
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, appendFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scriptedStudyResponse } from './scripted-study-response.mjs';

const raw = process.argv.slice(2), flagAt = raw.indexOf('--fail-at');
const failAt = flagAt === -1 ? undefined : Number(raw[flagAt + 1]);
if (flagAt !== -1 && (!Number.isSafeInteger(failAt) || failAt < 0)) throw Error('test_only_failure_index');
const args = flagAt === -1 ? raw : [...raw.slice(0, flagAt), ...raw.slice(flagAt + 2)];
if (args.length < 5 || !/^[a-f0-9]{40}$/.test(args[3]) || (args.length > 5 && (args[5] !== '--resume' || args.length < 7))) throw Error('test_only_explicit_arguments');
const [runtime, allowance, directory] = args.slice(0, 3).map(p => resolve(p));
const revision = args[3], manifest = JSON.parse(readFileSync(resolve(args[4]), 'utf8'));
if (manifest.id !== 'TEST-ONLY-rehearsal') throw Error('test_only_manifest_required');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { sha256 } = await load('agent/accountingStore.js');
const { runAccountedStudy, manifestSha256, providerFor } = await load('eval/accountedRunner.js');
const { replay, evidenceHash } = await load('agent/replay.js');
const envelope = JSON.parse(readFileSync(join(allowance, 'accounting.journal.json'), 'utf8'));
if (envelope.format !== 'node-accounting-journal-v1' || sha256(envelope.payload) !== envelope.sha256) throw Error('test_only_journal_checksum');
const document = JSON.parse(envelope.payload), inspected = ExperimentBudget.inspect(document);
const prior = document.carried?.document;
const initialAuthorization = prior?.events?.find(e => e.kind === 'authorization')?.value;
if (!inspected.authorization?.runId.startsWith('TEST-ONLY-rehearsal-')
  || inspected.authorization.instruction !== 'TEST ONLY rehearsal. Not a financial authorization.'
  || document.carried?.kind !== 'node-initial-test-budget-v1'
  || initialAuthorization?.runId !== 'TEST-ONLY-initial' || initialAuthorization.instruction !== 'TEST ONLY fixture.'
  || prior.events.some(e => e.kind !== 'authorization')) throw Error('test_only_allowance_required');

const priorRuns = args.slice(6).map(p => resolve(p));
const report = { mode: 'TEST_ONLY_OFFLINE_REHEARSAL', transport: 'pure_scripted_fixture', networkRequests: 0,
  credentialReads: 0, childProcesses: 0, runnerRevision: revision, manifestId: manifest.id,
  manifestSha256: manifestSha256(manifest), provider: providerFor(manifest.model), model: manifest.model,
  dispatched: 0, summary: null, resumedFrom: priorRuns, skippedVerified: [] };
const completedEpisodes = new Set();
for (const run of priorRuns) {
  for (const name of readdirSync(join(run, 'episodes')).filter(name => name.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(join(run, 'episodes', name), 'utf8'));
    if (record.status !== 'completed') continue;
    if (record.sourceRevision !== revision) throw Error('resume_revision_mismatch');
    if (evidenceHash(replay(record.tape, record.tape.genesis.sourceRevision)) !== record.finalStateHash) throw Error('resume_replay_mismatch');
    const episodeId = name.replace(/\.json$/, '').replace(/-a\d+$/, '');
    if (!manifest.episodes.some(e => e.episodeId === episodeId) || completedEpisodes.has(episodeId)) throw Error('resume_episode_invalid');
    completedEpisodes.add(episodeId);
    report.skippedVerified.push({ episodeId, from: join(run, 'episodes', name), finalStateHash: record.finalStateHash });
  }
}
mkdirSync(directory, { mode: 0o700 });
mkdirSync(join(directory, 'calls'), { mode: 0o700 });
mkdirSync(join(directory, 'episodes'), { mode: 0o700 });
const write = (path, value) => {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
};
const budget = ExperimentBudget.open(allowance);
try {
  const sender = async (input, signal) => {
    const held = budget.view().requests.filter(r => r.bookedMicroUsd === null);
    if (signal.aborted || held.length !== 1 || held[0].request.id !== input.requestId || held[0].request.inputSha256 !== input.sha256)
      throw Error('test_only_reservation_required_before_response');
    const call = join(directory, 'calls', String(input.index).padStart(5, '0'));
    mkdirSync(call, { mode: 0o700 });
    write(join(call, 'request.json'), input.body);
    write(join(call, 'attempt.json'), { requestId: input.requestId, requestSha256: input.sha256,
      episodeId: input.episodeId, actorId: input.actorId, tick: input.tick, noRetry: true, simulated: true });
    report.dispatched++;
    if (input.index === failAt) {
      write(join(call, 'network.json'), { simulated: true, httpStatus: 429, outcome: 'http_response', errorCode: 'rate_limit_exceeded' });
      throw Error('test_only_injected_429');
    }
    if (input.provider !== report.provider) throw Error('provider_mismatch');
    const response = scriptedStudyResponse(input.body, input.requestId.slice(0, 40));
    write(join(call, 'response.json'), response);
    write(join(call, 'network.json'), { simulated: true, endpoint: report.provider === 'anthropic' ? 'messages' : 'responses', httpStatus: 200, outcome: 'response_archived' });
    return response;
  };
  report.summary = await runAccountedStudy(manifest, budget, sender, {
    call: entry => appendFileSync(join(directory, 'calls.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }),
    episode: (record, episodeId) => write(join(directory, 'episodes', episodeId + '.json'), record),
  }, { sourceRevision: revision, forbiddenSubstrings: ['offline-fixture-observer-secret'], completedEpisodes });
} finally {
  const v = budget.view();
  report.allowance = { requests: v.requests.length, bookedMicroUsd: String(v.booked), heldMicroUsd: String(v.held),
    remainingMicroUsd: String(v.remainingMicroUsd), stopReason: v.stopReason };
  budget.close();
  write(join(directory, 'report.json'), report);
}
console.log(JSON.stringify(report, null, 2));
if (report.summary?.stoppedReason) process.exitCode = 1;
