// Haiku connection check, owner-run on the Windows PC that holds the credential.
// Counts the real study-1 tick-0 requests with the FREE count_tokens endpoint; with --send-one,
// also sends ONE real message (the Baker), refusing if its cost ceiling exceeds --max-usd
// (default 0.01). Nothing is study evidence; no allowance is touched.
// Args: <emitted runtime> <NEW private artifact directory> <approved credential .env file with ANTHROPIC_API_KEY>
//       [--send-one] [--max-usd <usd>]
// Build the runtime first: node scripts/build-study-runtime.mjs <new runtime dir>
// Keep the artifact directory outside the checkout: it holds request and response bytes.
import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPowerShell7 } from './pwsh-preflight.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--max-usd');
if (positional.length !== 3 || [...flags].some((f) => !['--send-one', '--max-usd'].includes(f))) throw Error('explicit_arguments_required');
const [runtime, directory, keyPath] = positional.map((x) => resolve(x));
const maxUsdArg = args.includes('--max-usd') ? Number(args[args.indexOf('--max-usd') + 1]) : 0.01;
if (!(maxUsdArg > 0 && maxUsdArg <= 0.05)) throw Error('max_usd_out_of_range');
if (existsSync(directory)) throw Error('artifact_directory_must_not_exist');
const { runAnthropicConnectionCheck } = await import(pathToFileURL(join(runtime, 'eval/anthropicConnectionCheck.js')).href);
const { hostProcessEnvironment } = await import(pathToFileURL(join(runtime, 'agent/isolatedHost.js')).href);
const worker = fileURLToPath(new URL('./anthropic-request.ps1', import.meta.url));
// Fails here, before any call, if PowerShell 7 is missing (it used to show only as null statuses).
const powershellMajor = assertPowerShell7(hostProcessEnvironment(process.env));
mkdirSync(directory, { mode: 0o700 });
const write = (dir, name, value) => { const fd = openSync(join(dir, name), 'wx', 0o600); try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } };

const send = async (endpoint, body, label) => {
  const dir = join(directory, label); mkdirSync(dir, { mode: 0o700 });
  write(dir, 'request.json', body);
  let workerError = null;
  try {
    await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-File', worker, '-KeyPath', keyPath, '-ArtifactDirectory', dir, '-Endpoint', endpoint],
      { env: hostProcessEnvironment(process.env), windowsHide: true, timeout: 15000, maxBuffer: 8192 });
  } catch (error) { workerError = typeof error?.code === 'string' ? error.code : 'worker_failed'; }
  if (!existsSync(join(dir, 'network.json'))) {
    // The worker never wrote its record: name the local cause instead of reporting a bare null.
    return { httpStatus: null, bytes: null, elapsedMs: 0, errorType: 'local_worker_did_not_run', errorMessage: workerError };
  }
  const network = JSON.parse(readFileSync(join(dir, 'network.json'), 'utf8'));
  const bytes = existsSync(join(dir, 'response.json')) ? readFileSync(join(dir, 'response.json')) : null;
  const local = network.httpStatus == null;
  return { httpStatus: network.httpStatus ?? null, bytes, elapsedMs: network.elapsedMs ?? 0,
    errorType: network.errorType ?? (local ? `local_${network.outcome ?? 'unknown'}` : null), errorMessage: network.errorMessage ?? (local ? network.transportError ?? null : null) };
};

const report = await runAnthropicConnectionCheck(send, { sendOne: flags.has('--send-one'), maxUsd: maxUsdArg });
report.ranAtUtc = new Date().toISOString();
report.powershellMajor = powershellMajor;
write(directory, 'report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
