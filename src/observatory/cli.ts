import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ObservatorySource, type Registration } from './source.js';
import { startObservatory } from './server.js';

if (['verify','serve','evaluate','export-frames'].includes(process.argv[2] ?? '')) {
  await import('./legacy/cli.js');
} else {
const [configPath] = process.argv.slice(2);
if (!configPath || process.argv.length !== 3) throw Error('usage_observatory_private_registration_json');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { runs: Registration[]; host?: string; port?: number };
if (!Array.isArray(config.runs)) throw Error('observatory_registration');
const base = dirname(resolve(configPath));
const sources = config.runs.map(r => new ObservatorySource({ ...r, ledger: resolve(base, r.ledger),
  ...(r.journal ? { journal: resolve(base, r.journal) } : {}), ...(r.evaluations ? { evaluations: (typeof r.evaluations === 'string' ? [r.evaluations] : r.evaluations).map(p => resolve(base, p)) } : {}) }));
const app = startObservatory({ sources, host: config.host, port: config.port,
  researcherToken: process.env.NODE_OBSERVATORY_RESEARCHER_TOKEN ?? '', worldToken: process.env.NODE_OBSERVATORY_WORLD_TOKEN ?? '',
  secureCookie: process.env.NODE_OBSERVATORY_SECURE_COOKIE === '1' });
console.log(JSON.stringify({ port: await app.ready, host: config.host ?? '127.0.0.1', mode: 'read_only_evidence_observatory', runs: config.runs.map(r => r.id) }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });

}
