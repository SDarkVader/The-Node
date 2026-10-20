// TEST ONLY: a closed initial allowance like the owner's (expired, priced), from the disposable
// accounting fixture. Never a real financial record.
import { InitialTestBudget } from '../../src/agent/initialTestBudget.js';
import { setup } from '../fixtures/accountingFixture.js';
const { ledger } = setup(); const directory = process.argv[2]!;
const b = InitialTestBudget.create(directory, ledger.exportDocument());
const iso = (ms: number) => new Date(Date.now() + ms).toISOString(), DAY = 86_400_000;
const prices = { model: 'gpt-5.4-nano-2026-03-17', inputMicroUsdPerMillionTokens: 400000, outputMicroUsdPerMillionTokens: 2500000, evidenceSha256: 'a'.repeat(64) };
b.authorize({ runId: 'TEST-ONLY-initial', authorizedAt: iso(-3 * DAY), expiresAt: iso(-2 * DAY), expectedHistoryHash: b.view().historyHash, instruction: 'TEST ONLY fixture.',
  scope: 'additional_initial_test_spending_only', model: 'gpt-5.4-nano-2026-03-17', maxRequests: 5, limitMicroUsd: 100000, perRequestMicroUsd: 20000, prices });
b.close(); ledger.close();
