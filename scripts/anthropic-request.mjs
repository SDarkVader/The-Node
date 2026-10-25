// Credential-separated Node 24 transport for remote Linux/macOS/Windows execution.
// The mechanical runner never reads the credential. Exactly one POST, no retry or redirect.
import { readFileSync, lstatSync, openSync, writeFileSync, closeSync, fsyncSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const durable = (path, value, flag = 'wx') => {
  const fd = openSync(path, flag, 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
};
export async function runAnthropicWorker({ keyPath, directory, maxRequestBytes = 32768 }, fetcher = fetch) {
  const networkPath = join(directory, 'network.json'), responsePath = join(directory, 'response.json');
  if (existsSync(networkPath) || existsSync(responsePath)) throw Error('worker_artifacts_exist');
  const result = { endpoint: 'messages', httpStatus: null, elapsedMs: null, outcome: 'not_started', requestId: null };
  let key = '', begun = performance.now();
  try {
    const stat = lstatSync(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16384 ||
        process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw Error('credential_file_invalid');
    const lines = readFileSync(keyPath, 'utf8').split(/\r?\n/).filter(line => /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=/.test(line));
    if (lines.length !== 1) throw Error('credential_entry_invalid');
    key = lines[0].slice(lines[0].indexOf('=') + 1).trim();
    if (key.startsWith('"') && key.endsWith('"') || key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
    if (key.length > 512 || !/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(key)) throw Error('credential_entry_invalid');
    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 32768 || maxRequestBytes > 95000) throw Error('request_bounds');
    const body = readFileSync(join(directory, 'request.json'));
    if (!body.length || body.length > maxRequestBytes) throw Error('request_bounds');
    result.outcome = 'dispatching_cost_unknown'; durable(networkPath, JSON.stringify(result) + '\n');
    begun = performance.now();
    const response = await fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', redirect: 'error',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', accept: 'application/json' },
      body, signal: AbortSignal.timeout(12000) });
    result.httpStatus = response.status;
    const id = response.headers.get('request-id');
    if (/^req_[A-Za-z0-9_-]{1,128}$/.test(id ?? '')) result.requestId = id;
    const chunks = []; let size = 0;
    if (!response.body) throw Error('response_empty');
    for await (const chunk of response.body) { size += chunk.length; if (size > 262144) throw Error('response_bounds'); chunks.push(Buffer.from(chunk)); }
    const raw = Buffer.concat(chunks);
    if (raw.includes(Buffer.from(key))) throw Error('unsafe_response');
    // Preserve non-2xx/malformed envelopes as evidence; the original parser keeps their hold.
    durable(responsePath, raw); result.outcome = 'response_archived';
  } catch { result.outcome = result.httpStatus === null ? 'transport_or_local_error' : 'response_processing_error'; }
  finally {
    key = ''; result.elapsedMs = performance.now() - begun;
    durable(networkPath, JSON.stringify(result) + '\n', existsSync(networkPath) ? 'w' : 'wx');
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [keyPath, directory, limit] = process.argv.slice(2);
  if (!keyPath || !directory || !limit || process.argv.length !== 5) throw Error('explicit_worker_arguments_required');
  await runAnthropicWorker({ keyPath: resolve(keyPath), directory: resolve(directory), maxRequestBytes: Number(limit) });
}
