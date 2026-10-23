// Offline end-to-end: simulated provider, real world kernel, disposable synthetic account.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { continuationPlan, continuationGenesis, continuationBudget, simulatedContinuationProvider } from '../fixtures/continuationFixture.js';
import { cleanup } from '../fixtures/accountingFixture.js';
import { runContinuation } from '../../src/eval/continuationRunner.js';
import { ContinuationLedger, readContinuationLedger, verifyContinuation, continuationInspectSamples } from '../../src/eval/continuationLedger.js';
const [out, revision, count = '4'] = process.argv.slice(2);
if (!out || !/^[a-f0-9]{40}$/.test(revision ?? '') || ![4, 10, 20, 50].includes(Number(count))) throw Error('explicit_offline_arguments_required');
const directory = resolve(out);
mkdirSync(directory, { mode: 0o700 });
const plan = continuationPlan(Number(count)), budget = continuationBudget(plan, join(directory, 'TEST-ONLY-allowance'));
const ledger = new ContinuationLedger(join(directory, 'trace'));
try {
  const provider = simulatedContinuationProvider({ redacted: true });
  const summary = await runContinuation(plan, continuationGenesis(revision!), budget, provider.send, ledger, { sourceRevision: revision!, mode: 'offline_simulated_provider' });
  ledger.close(); budget.close();
  const events = readContinuationLedger(ledger.path), verification = verifyContinuation(events, revision!);
  writeFileSync(join(directory, 'verification.json'), JSON.stringify(verification, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'inspect-samples.jsonl'), continuationInspectSamples(events, revision!).map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ directory, ledger: ledger.path, ...summary, independentlyVerified: verification.verified }, null, 2));
  if (summary.status !== 'completed') process.exitCode = 1;
} finally { ledger.close(); budget.close(); cleanup(); }
