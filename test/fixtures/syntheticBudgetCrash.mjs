// Mechanical accounting-fixture crash test. No real ledger, agent, provider or network operation.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const [build, directory, stage, writeNumber] = process.argv.slice(2);
const { SyntheticBudgetLedger } = await import(pathToFileURL(join(build, 'syntheticBudget.js')).href);
let writes = 0;
const ledger = SyntheticBudgetLedger.create(directory, 'fixture-budget-regression', { totalMicroUsd: 1000, maxRequests: 3 }, {
  fault: where => { if (where === 'before_write') writes++; if (writes === Number(writeNumber) && where === stage) process.exit(73); },
});
ledger.reserve('one', 100);
writeFileSync(join(directory, 'mock-dispatched'), '1', { flag: 'wx', mode: 0o600 });
ledger.settle('one', 25);
process.exit(74);
