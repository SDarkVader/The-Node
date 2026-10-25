// Explicit one-shot experiment. No retries, allowance creation, or production gate changes.
// Args: emitted runtime directory, existing budget directory, NEW private artifact directory,
// approved credential file, committed runner revision, optionally --resume prior-artifact-directory.
// Keep artifacts outside a checkout. Resume copies a clean checkpoint, preserving old evidence.
import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertLegacyLiveDispatchClosed } from './legacy-live-gate.mjs';

const args = process.argv.slice(2);
if (![5, 7].includes(args.length) || !/^[a-f0-9]{40}$/.test(args[4]) || args.length === 7 && args[5] !== '--resume') throw Error('explicit_arguments_required');
assertLegacyLiveDispatchClosed();
const [runtime, budgetDirectory, directory, keyPath] = args.slice(0, 4).map(x => resolve(x));
const runnerRevision = args[4], priorDirectory = args.length === 7 ? resolve(args[6]) : null;
const load = file => import(pathToFileURL(join(runtime, 'agent', file)).href);
const { InitialTestBudget } = await load('initialTestBudget.js');
const { runInitialGameTurn } = await load('initialGameTurn.js');
const { IsolatedParticipantHost, hostProcessEnvironment } = await load('isolatedHost.js');
const { fixtureGenesis, createParticipantState } = await load('participantWorld.js');
const { assertInitialGameContinuation } = await load('initialGameResume.js');
const { replay, evidenceHash } = await load('replay.js');
// Exclusive directory is the attempt marker. Never reuse or overwrite an earlier attempt.
mkdirSync(directory, { mode: 0o700 });
const write = (name, value) => {
  const fd = openSync(join(directory, name), 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
};
let budget, host;
const report = { runnerRevision, sourceRevision: runnerRevision, startedAtUtc: new Date().toISOString(), attemptedRequests: 0, result: null };
try {
  budget = InitialTestBudget.open(budgetDirectory);
  const initial = budget.view();
  if (!initial.canReserve) throw Error('existing_budget_not_ready');
  let genesis, previous;
  if (priorDirectory) {
    const readPrior = (name, maxBytes) => {
      const file = join(priorDirectory, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Error('prior_artifact_invalid');
      return readFileSync(file);
    };
    previous = JSON.parse(readPrior('report.json', 65536));
    if (!/^[a-f0-9]{40}$/.test(previous.sourceRevision)) throw Error('prior_source_revision_invalid');
    report.sourceRevision = previous.sourceRevision;
    report.previousArtifactDirectory = priorDirectory;
    const saved = JSON.parse(readPrior('genesis.json', 65536));
    const tape = JSON.parse(readPrior('replay-tape.json', 8388608));
    if (JSON.stringify(saved.genesis) !== JSON.stringify(tape.genesis)) throw Error('prior_genesis_mismatch');
    genesis = tape.genesis;
    if (evidenceHash(replay(tape, report.sourceRevision)) !== previous.result?.completeStateHash) throw Error('prior_tape_replay_mismatch');
    // Only the canonical checkpoint file is copied, never lock files or interrupted writes.
    const checkpoint = readPrior('checkpoint/participant.checkpoint.json', 16777216);
    mkdirSync(join(directory, 'checkpoint'), { mode: 0o700 });
    write('checkpoint/participant.checkpoint.json', checkpoint.toString('utf8'));
    write('genesis.json', saved);
    host = await IsolatedParticipantHost.resume({ sourceRevision: report.sourceRevision, controllerToken: randomBytes(32).toString('hex'), checkpointDirectory: join(directory, 'checkpoint') });
  } else {
    if (initial.requests.length !== 0) throw Error('first_turn_requires_unused_existing_budget');
    genesis = { ...fixtureGenesis(32), namespace: 'initial-budget-game', observerSecret: randomBytes(32).toString('hex'), sourceRevision: report.sourceRevision };
    const state = createParticipantState(genesis);
    const baker = [...state.registry.people.values()].find(p => p.role === 'baker' && p.location !== null);
    if (!baker) throw Error('existing_baker_missing');
    write('genesis.json', { genesis, person: baker.id });
    host = await IsolatedParticipantHost.create({ genesis, person: baker.id, controllerToken: randomBytes(32).toString('hex'), checkpointDirectory: join(directory, 'checkpoint') });
  }
  const initialObservation = await host.read();
  const authority = [genesis.observerSecret, initialObservation.observationId];
  report.beforeStateHash = await host.evidence();
  if (previous) assertInitialGameContinuation(initial, previous, initialObservation, report.beforeStateHash);
  const sender = async (request, signal) => {
    if (signal.aborted || authority.some(secret => request.body.includes(secret))) throw Error('dispatch_precondition');
    // runInitialGameTurn has already durably reserved this request's cost ceiling.
    write('request.json', request.body);
    write('attempt.json', { requestSha256: request.sha256, context: request.context, noRetry: true, reservedAtUtc: new Date().toISOString() });
    report.attemptedRequests++;
    const worker = fileURLToPath(new URL('./initial-test-request.ps1', import.meta.url));
    try {
      await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-File', worker, '-KeyPath', keyPath, '-ArtifactDirectory', directory],
        { env: hostProcessEnvironment(process.env), windowsHide: true, signal, timeout: 15000, maxBuffer: 8192 });
    } catch { throw Error('bounded_worker_failed'); }
    const network = JSON.parse(readFileSync(join(directory, 'network.json'), 'utf8'));
    report.network = network;
    if (network.httpStatus !== 200 || network.outcome !== 'response_archived') throw Error('provider_response_failed');
    const bytes = readFileSync(join(directory, 'response.json'));
    if (bytes.length > 262144) throw Error('response_bounds');
    return bytes;
  };
  report.result = await runInitialGameTurn(budget, host, sender);
  write('replay-tape.json', await host.exportTape());
  report.afterStateHash = await host.evidence();
  if (report.result.usage) {
    const raw = JSON.parse(readFileSync(join(directory, 'response.json'), 'utf8'));
    const u = report.result.usage, cached = raw.usage.input_tokens_details?.cached_tokens ?? 0;
    report.estimatedCostUsd = ((u.inputTokens - cached) * 0.20 + cached * 0.02 + u.outputTokens * 1.25) / 1000000;
    report.priceSource = 'https://developers.openai.com/api/docs/models/gpt-5.4-nano';
  }
} catch (error) {
  report.error = report.attemptedRequests ? 'attempt_failed_do_not_retry' : 'preflight_failed_no_dispatch';
  report.errorCode = /^[a-z0-9_]{1,100}$/.test(error?.message) ? error.message : 'local_runner_error';
} finally {
  if (host) { try { await host.close(); report.hostClosed = true; } catch { report.hostClosed = false; } }
  if (budget) {
    try {
      const view = budget.view();
      report.budget = { requests: view.requests.length, bookedMicroUsd: view.booked, heldMicroUsd: view.held, remainingMicroUsd: view.remainingMicroUsd };
    } finally { budget.close(); }
  }
  report.finishedAtUtc = new Date().toISOString();
  write('report.json', report);
}
console.log(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
if (report.result?.status !== 'applied') process.exitCode = 1;
