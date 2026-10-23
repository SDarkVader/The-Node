/**
 * SYNTHETIC observatory demo. Builds a TEST-ONLY three-segment continuation with the offline
 * simulated provider (no account, credential, private ledger or API), registers it as synthetic,
 * runs the framework jobs into a separate file, then serves it read-only.
 *
 *   npx tsx scripts/observatory-demo.ts <NEW empty directory> [--port 8090] [--no-serve]
 *
 * Everything it writes is synthetic test data and is labelled so in every view.
 */
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stagedRun, registration } from '../test/fixtures/observatoryFixture.js';
import { ObservatoryExperiment } from '../src/observatory/ledgerTail.js';
import { authorityApplicability, diaryEvaluationRecords } from '../src/observatory/evaluations.js';
import { newTokens } from '../src/observatory/auth.js';
import { GODOT_PATH, startObservatoryServer } from '../src/observatory/server.js';

const args = process.argv.slice(2), dir = resolve(args[0] ?? '');
if (!args[0] || (existsSync(dir) && readdirSync(dir).length)) throw Error('usage: observatory-demo.ts <NEW empty directory>');
mkdirSync(dir, { recursive: true });
const handles: { close(): void }[] = [];
const { stages } = await stagedRun(handles);
for (const h of handles) h.close();
const evaluations = join(dir, 'evaluations.jsonl');
const reg = registration(stages, { experimentId: 'SYNTHETIC-observatory-demo', label: 'SYNTHETIC demo (offline simulated provider)',
  annotations: join(dir, 'annotations.jsonl'), evaluations: [evaluations] });
writeFileSync(join(dir, 'registration.json'), JSON.stringify(reg, null, 2));
const experiment = new ObservatoryExperiment(reg); experiment.refresh();
writeFileSync(evaluations, [...diaryEvaluationRecords(experiment, 'scripts/observatory-demo.ts').records, authorityApplicability(experiment)].map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`SYNTHETIC registration: ${join(dir, 'registration.json')}`);
if (!args.includes('--no-serve')) {
  const tokens = newTokens(), port = Number(args[args.indexOf('--port') + 1] || 8090);
  const s = await startObservatoryServer([reg], { tokens, port: args.includes('--port') ? port : 8090 });
  console.log(`Observatory (read-only, SYNTHETIC) at ${s.url}/observatory/#token=${tokens.researcher}`);
  console.log(`Godot: --world-url=${s.url.replace('http', 'ws')}${GODOT_PATH}?run=${reg.experimentId}&token=${tokens.renderer}`);
}
