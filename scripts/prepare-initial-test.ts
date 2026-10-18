import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { AccountingLedger } from '../src/agent/accountingLedger.js';
import { InitialTestBudget, inspectDiagnostic, type DiagnosticEvidence } from '../src/agent/initialTestBudget.js';
import { sha256 } from '../src/agent/accountingStore.js';

/** Local configuration only: imports diagnostic evidence and caps additional test spending. No credentials or network. */
function main() {
  const args = process.argv.slice(2), allowed = ['--source-ledger', '--evidence-directory', '--instruction', '--price-evidence', '--out'];
  const options = new Map<string, string>();
  for (let n = 0; n < args.length; n += 2) {
    const key = args[n], value = args[n + 1];
    if (!key || !allowed.includes(key) || !value || options.has(key)) throw Error('test_budget_arguments');
    options.set(key, resolve(value));
  }
  if (options.size !== allowed.length) throw Error('test_budget_arguments');
  const get = (key: string) => options.get(key)!;
  const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  // A second output name must not accidentally issue this same run another allowance.
  if (normalize(get('--out')) !== normalize(join(dirname(get('--source-ledger')), 'initial-test-budget-2026-10-18'))) throw Error('test_budget_canonical_run_path');
  const read = (path: string) => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 131072) throw Error('test_budget_input_file');
    return readFileSync(path, 'utf8');
  };
  const evidenceDirectory = get('--evidence-directory');
  if (lstatSync(evidenceDirectory).isSymbolicLink() || normalize(realpathSync(evidenceDirectory)) !== normalize(evidenceDirectory)) throw Error('test_budget_evidence_path');
  const packets = readdirSync(evidenceDirectory).filter(name => name.endsWith('.diagnostic.json')).sort()
    .map(name => JSON.parse(read(join(evidenceDirectory, name))) as DiagnosticEvidence);
  if (packets.length !== 5 || packets.filter(e => e.kind === 'generation').length !== 3 || packets.filter(e => e.kind === 'models-list').length !== 2) throw Error('test_budget_expected_diagnostics');
  if (new Set(packets.map(e => inspectDiagnostic(e).id)).size !== 5) throw Error('test_budget_duplicate_inputs');
  const instruction = read(get('--instruction')), priceBytes = read(get('--price-evidence')), price = JSON.parse(priceBytes);
  if (price.model !== 'gpt-5.4-nano-2026-03-17' || price.inputUsdPerMillion !== 0.2 || price.outputUsdPerMillion !== 1.25 ||
    price.source !== 'https://developers.openai.com/api/docs/models/gpt-5.4-nano') throw Error('test_budget_price_evidence');
  const sourceFile = join(get('--source-ledger'), 'accounting.journal.json'), before = sha256(readFileSync(sourceFile));
  const source = AccountingLedger.open(get('--source-ledger'));
  let historical: unknown;
  try { historical = source.exportDocument(); } finally { source.close(); }
  const budget = InitialTestBudget.create(get('--out'), historical);
  try {
    for (const packet of packets) budget.importDiagnostic(packet);
    const now = new Date(), authorizedAt = now.toISOString(), expiresAt = new Date(now.getTime() + 86400000).toISOString();
    budget.authorize({ runId: 'initial-baker-test-2026-10-18', authorizedAt, expiresAt, expectedHistoryHash: budget.view().historyHash, instruction,
      scope: 'additional_initial_test_spending_only', model: 'gpt-5.4-nano-2026-03-17', maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000,
      prices: { model: 'gpt-5.4-nano-2026-03-17', inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: sha256(priceBytes) } });
    const v = budget.view();
    if (sha256(readFileSync(sourceFile)) !== before) throw Error('test_budget_source_changed');
    console.log(JSON.stringify({ directory: get('--out'), budgetScope: v.budgetScope, configured: true, historicalJournalUnchanged: true,
      importedDiagnostics: v.diagnostics.length, carriedAdmissionCount: v.carriedAdmissionCount, historicalBillingReconciled: false,
      model: v.authorization!.model, maxAdditionalRequests: 5, remainingNewTestMicroUsd: v.remainingMicroUsd!.toString(), perRequestMicroUsd: 20000,
      newRequestsMade: v.requests.length, canReserve: v.canReserve, expiresAt, apiCallsMade: 0 }, null, 2));
  } finally { budget.close(); }
}
try { main(); } catch { console.error('initial_test_budget_configuration_failed; preserve any existing state and inspect before retry'); process.exitCode = 1; }
