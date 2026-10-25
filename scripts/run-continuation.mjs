// LIVE PAID runner. Requires a separately authorized unused plan-bound allowance, plus an
// explicit --dispatch-authorized-pilot flag. No retries or resets. Resumption requires a
// verified sealed parent ledger matching the exact current allowance journal.
// Args: <runtime> <allowance dir> <NEW artifacts dir> <approved .env file> <plan.json>
//       --dispatch-authorized-pilot
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, fsyncSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPowerShell7 } from './pwsh-preflight.mjs';
const args = process.argv.slice(2);
if (args.length < 6 || args.length > 12 || args.length % 2 || args[5] !== '--dispatch-authorized-pilot') throw Error('separate_paid_pilot_authorization_required');
const flags = new Map();
for (let i = 6; i < args.length; i += 2) {
  if (!['--resume-ledger', '--stop-at-tick', '--transport'].includes(args[i]) || flags.has(args[i]) || !args[i + 1]) throw Error('continuation_cli_flags');
  flags.set(args[i], args[i + 1]);
}
const stopAtTick = flags.has('--stop-at-tick') ? Number(flags.get('--stop-at-tick')) : undefined;
if (stopAtTick !== undefined && (!Number.isSafeInteger(stopAtTick) || stopAtTick < 1)) throw Error('continuation_stage_bound');
const [runtime, allowance, directory, keyPath, planPath] = args.slice(0, 5).map(x => resolve(x));
const checkout = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const inside = relative(checkout, realpathSync(resolve(directory, '..')));
if (inside === '' || (inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside))) throw Error('private_artifacts_must_be_outside_checkout');
if (existsSync(directory)) throw Error('new_artifact_directory_required');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { runContinuation, validateContinuationPlan } = await load('eval/continuationRunner.js');
const { ContinuationLedger, verifyContinuation, readContinuationLedger, continuationInspectSamples } = await load('eval/continuationLedger.js');
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { hostProcessEnvironment } = await load('agent/isolatedHost.js');
const { fixtureGenesis } = await load('agent/participantWorld.js');
const { DEFAULT_WORLD_CONFIG } = await load('world/world.js');
const plan = JSON.parse(readFileSync(planPath, 'utf8')); validateContinuationPlan(plan);
const sourceRevision = readFileSync(join(runtime, 'REVISION'), 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw Error('runtime_revision_required');
const parent = flags.has('--resume-ledger') ? readContinuationLedger(resolve(flags.get('--resume-ledger'))) : undefined;
if (parent && !verifyContinuation(parent, parent[0]?.data.sourceRevision).complete) throw Error('continuation_parent_incomplete');
// Preflight before reservation or credential read.
const transport = flags.get('--transport') ?? 'powershell';
if (!['powershell', 'node'].includes(transport)) throw Error('continuation_transport_invalid');
if (transport === 'node' && Number(process.versions.node.split('.')[0]) < 24) throw Error('node_24_transport_required');
const powershellMajor = transport === 'powershell' ? assertPowerShell7(hostProcessEnvironment(process.env)) : null;
mkdirSync(directory, { mode: 0o700 });
mkdirSync(join(directory, 'calls'), { mode: 0o700 });
const write = (path, value) => {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
};
const ledger = new ContinuationLedger(join(directory, 'trace'));
const worker = fileURLToPath(new URL('./anthropic-request.ps1', import.meta.url));
const report = { sourceRevision, powershellMajor, transport, paidDispatches: 0, summary: null, verification: null, error: null };
const send = async (input, signal) => {
  const call = join(directory, 'calls', String(input.index).padStart(5, '0'));
  mkdirSync(call, { mode: 0o700 });
  write(join(call, 'request.json'), input.body);
  write(join(call, 'attempt.json'), { requestId: input.requestId, actorId: input.actorId, tick: input.tick, sha256: input.sha256, noRetry: true });
  report.paidDispatches++;
  if (transport === 'powershell') {
    await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-File', worker, '-KeyPath', keyPath,
      '-ArtifactDirectory', call, '-Endpoint', 'messages', '-ArchiveAllResponses', '-MaxRequestBytes', String(plan.maxRequestBytes ?? 32768)], { env: hostProcessEnvironment(process.env), windowsHide: true, signal, timeout: 15000, maxBuffer: 8192 });
  } else {
    // Only transport/proxy trust configuration crosses into the credential worker; no
    // NODE_OPTIONS, provider environment variables or game-host credential inheritance.
    const env = hostProcessEnvironment(process.env);
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    await promisify(execFile)(process.execPath, ['--use-env-proxy', fileURLToPath(new URL('./anthropic-request.mjs', import.meta.url)),
      keyPath, call, String(plan.maxRequestBytes ?? 32768)], { env, windowsHide: true, signal, timeout: 15000, maxBuffer: 8192 });
  }
  // Even non-2xx provider bodies are preserved in the ledger. The response parser will refuse
  // their use and retain the accounting hold; transport failures without bytes remain failures.
  if (!existsSync(join(call, 'response.json'))) throw Error('provider_response_failed');
  return readFileSync(join(call, 'response.json'));
};
let budget;
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
try {
  budget = ExperimentBudget.open(allowance);
  const config = JSON.parse(JSON.stringify({ ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }));
  const genesis = parent ? parent[0].data.genesis : { ...fixtureGenesis(plan.seed, config), sourceRevision };
  report.summary = await runContinuation(plan, genesis, budget, send, ledger, { sourceRevision, mode: 'live', parent, stopAtTick, signal: controller.signal });
} catch (error) {
  report.error = /^[a-z_]{1,100}$/.test(error?.message) ? error.message : 'run_failed_do_not_retry';
} finally { ledger.close(); budget?.close(); }
try {
  const events = readContinuationLedger(ledger.path);
  report.verification = verifyContinuation(events, sourceRevision);
  if (report.verification.complete) write(join(directory, 'inspect-samples.jsonl'), continuationInspectSamples(events, sourceRevision).map(x => JSON.stringify(x)).join('\n') + '\n');
} catch { report.verification = { verified: false }; }
write(join(directory, 'report.json'), report);
console.log(JSON.stringify({ ...report, verification: report.verification && { verified: report.verification.verified, complete: report.verification.complete } }, null, 2));
if (report.error || !['completed', 'checkpoint'].includes(report.summary?.status) || !report.verification?.verified) process.exitCode = 1;
