/** Local/private-Codespace viewer. No provider transport or writable real budget. */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { startObservatory } from '../src/observatory/server.js';
import { ObservatorySource, type Registration } from '../src/observatory/source.js';
import { hostProcessEnvironment } from '../src/agent/isolatedHost.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  port: { type: 'string', default: '8090' }, host: { type: 'string', default: '127.0.0.1' },
} });
if (positionals.length > 1 || !/^\d+$/.test(values.port!) || Number(values.port) > 65535)
  throw Error('usage: npm run preview -- [private-registration.json] [--port 8090] [--host 127.0.0.1]');
const checkout = fileURLToPath(new URL('..', import.meta.url));
let configPath = positionals[0] ? resolve(positionals[0]) : '';
if (!configPath) {
  const output = join(mkdtempSync(join(tmpdir(), 'node-observatory-preview-')), 'synthetic-run');
  console.log('Preparing a two-tick synthetic demo. No provider key or paid calls are used.');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/observatory-demo.ts', output, '--quick'], {
    cwd: checkout, env: hostProcessEnvironment(process.env), stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 120000, maxBuffer: 65536,
  });
  configPath = join(output, 'registration.json');
}
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { runs: Registration[] };
if (!Array.isArray(config.runs)) throw Error('preview_requires_cloud_registration_with_runs');
const base = dirname(configPath);
const sources = config.runs.map(r => new ObservatorySource({ ...r, ledger: resolve(base, r.ledger),
  ...(r.journal ? { journal: resolve(base, r.journal) } : {}),
  ...(r.evaluations ? { evaluations: (typeof r.evaluations === 'string' ? [r.evaluations] : r.evaluations)
    .map(p => resolve(base, p)) } : {}),
}));
const researcherToken = randomBytes(32).toString('hex');
const codespace = process.env.CODESPACE_NAME, domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
const app = startObservatory({ sources, researcherToken, worldToken: randomBytes(32).toString('hex'),
  port: Number(values.port), host: values.host, secureCookie: Boolean(codespace && domain) });
const port = await app.ready;
const localHost = values.host === '0.0.0.0' ? '127.0.0.1' : values.host;
const url = codespace && domain ? `https://${codespace}-${port}.${domain}/` : `http://${localHost}:${port}/`;
console.log(`\nObservatory ready: ${url}\nInterface login token: ${researcherToken}`);
console.log(`Registration: ${configPath}\nKeep this terminal running. Viewing makes no provider calls.`);
if (!codespace) console.log('This address opens on this computer. For another device, use a private forwarded port or Codespace.');
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  if (closing) return; closing = true; await app.close(); process.exit(0);
});
