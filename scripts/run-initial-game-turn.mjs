// Explicit one-shot experiment. No retries, allowance creation, or production gate changes.
// Args: emitted runtime directory, existing budget directory, NEW private artifact directory,
// approved credential file, committed source revision. Keep artifacts outside a checkout.
import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
if (args.length !== 5 || !/^[a-f0-9]{40}$/.test(args[4])) throw Error('five_explicit_arguments_required');
const [runtime, budgetDirectory, directory, keyPath] = args.slice(0, 4).map(x => resolve(x));
const sourceRevision = args[4];
const load = file => import(pathToFileURL(join(runtime, 'agent', file)).href);
const { InitialTestBudget } = await load('initialTestBudget.js');
const { runInitialGameTurn } = await load('initialGameTurn.js');
const { IsolatedParticipantHost, hostProcessEnvironment } = await load('isolatedHost.js');
const { fixtureGenesis, createParticipantState } = await load('participantWorld.js');
// Exclusive directory is the attempt marker. Never reuse or overwrite an earlier attempt.
mkdirSync(directory, { mode: 0o700 });
const write = (name, value) => {
  const fd = openSync(join(directory, name), 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
};
let budget, host;
const report = { sourceRevision, startedAtUtc: new Date().toISOString(), attemptedRequests: 0, result: null };
try {
  budget = InitialTestBudget.open(budgetDirectory);
  const initial = budget.view();
  if (!initial.canReserve || initial.requests.length !== 0) throw Error('first_turn_requires_unused_existing_budget');
  const genesis = { ...fixtureGenesis(32), namespace: 'initial-budget-game', observerSecret: randomBytes(32).toString('hex'), sourceRevision };
  const state = createParticipantState(genesis);
  const baker = [...state.registry.people.values()].find(p => p.role === 'baker' && p.location !== null);
  if (!baker) throw Error('existing_baker_missing');
  write('genesis.json', { genesis, person: baker.id });
  host = await IsolatedParticipantHost.create({ genesis, person: baker.id, controllerToken: randomBytes(32).toString('hex'), checkpointDirectory: join(directory, 'checkpoint') });
  const initialObservation = await host.read();
  const authority = [genesis.observerSecret, initialObservation.observationId];
  report.beforeStateHash = await host.evidence();
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
} catch {
  report.error = report.attemptedRequests ? 'attempt_failed_do_not_retry' : 'preflight_failed_no_dispatch';
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
