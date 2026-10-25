/** Private inputs stay outside the checkout. Only fixed check names and counts are emitted. */
import { readFileSync, writeFileSync } from 'node:fs';
import { acceptArchive } from './archiveAcceptance.js';

const [registration, journal, expectations, output] = process.argv.slice(2);
try {
  if (!registration || !journal || !expectations) throw Error('observatory_acceptance_arguments_required');
  const result = await acceptArchive(JSON.parse(readFileSync(registration, 'utf8')), journal,
    JSON.parse(readFileSync(expectations, 'utf8')));
  const text = JSON.stringify(result, null, 2) + '\n';
  if (output) writeFileSync(output, text, { flag: 'wx', mode: 0o600 });
  console.log(text);
} catch (error) {
  const message = (error as Error).message;
  console.error(JSON.stringify({ passed: false, error: /^observatory_acceptance_[a-z_]+$/.test(message) ? message : 'observatory_acceptance_failed' }));
  process.exitCode = 1;
}
