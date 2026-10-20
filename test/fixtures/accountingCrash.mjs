// Mechanical process-crash fixture. No agent, network, model, financial operator or real-account write.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const [build, directory, stage, operation, inputPath] = process.argv.slice(2);
const { AccountingLedger } = await import(pathToFileURL(join(build, 'agent', 'accountingLedger.js')).href);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const ledger = AccountingLedger.open(directory, { fault: where => { if (where === stage) process.exit(73); } });
if (operation === 'reservation') ledger.reserve(input.request);
else if (operation === 'receipt') ledger.recordReceipt(input.receipt);
else if (operation === 'decision_claim') ledger.claimDecision(input.request.id);
else throw Error('unknown crash fixture operation');
process.exit(74);
