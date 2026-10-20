import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AccountingLedger } from '../src/agent/accountingLedger.js';

// No credentials, network, provider calls or financial reconciliation entrypoint.
const [mode, directory, ...extra] = process.argv.slice(2);
if (!['--reconstruct', '--inspect'].includes(mode ?? '') || !directory || extra.length) {
  throw Error('Usage: tsx scripts/rebuild-accounting.ts --reconstruct NEW_DIRECTORY | --inspect EXISTING_DIRECTORY');
}
const repository = new URL('../', import.meta.url);
let ledger: AccountingLedger | undefined;
try {
  if (mode === '--reconstruct') {
    const sources = ['EXPERIMENT_FIRST_PASS_RESULTS.md', 'CREDENTIAL_BINDING_SUPPORT_REPORT.md', 'EXPERIMENT_EVALS_AND_SAFEGUARDS.md']
      .map(name => ({ name, bytes: readFileSync(new URL(`docs/recovery/${name}`, repository), 'utf8') }));
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
    ledger = AccountingLedger.reconstruct(resolve(directory), sources, sourceRevision);
  } else ledger = AccountingLedger.open(resolve(directory));
  console.log(JSON.stringify({ directory: resolve(directory), dispatchAllowed: false, ...ledger.view() },
    (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2));
} finally { ledger?.close(); }
