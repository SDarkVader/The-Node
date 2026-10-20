import { createHash } from 'node:crypto';
import { buildMockProviderRequest, createMockProviderFixture, type MockProviderTransport } from './mockProvider.js';
import { SyntheticBudgetLedger, SyntheticBudgetError } from './syntheticBudget.js';
import type { DecisionContext } from './protocol.js';
import type { FixtureResponse } from './broker.js';

export interface SyntheticPrices {
  kind: 'synthetic-price-fixture';
  model: 'offline-fixture';
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
}
const validPrices = (value: SyntheticPrices) => value !== null && typeof value === 'object' &&
  Object.keys(value).length === 4 && ['kind', 'model', 'inputMicroUsdPerMillionTokens', 'outputMicroUsdPerMillionTokens'].every(key => Object.hasOwn(value, key)) &&
  value.kind === 'synthetic-price-fixture' && value.model === 'offline-fixture' &&
  Number.isSafeInteger(value.inputMicroUsdPerMillionTokens) && value.inputMicroUsdPerMillionTokens > 0 &&
  Number.isSafeInteger(value.outputMicroUsdPerMillionTokens) && value.outputMicroUsdPerMillionTokens > 0;

/** Integer upward rounding with invented fixture rates; never real model pricing. */
export function syntheticCost(inputTokens: number, outputTokens: number, prices: SyntheticPrices): number {
  if (!validPrices(prices) || !Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    throw new SyntheticBudgetError('synthetic_price_invalid');
  }
  const cost = (BigInt(inputTokens) * BigInt(prices.inputMicroUsdPerMillionTokens) + 999_999n) / 1_000_000n +
    (BigInt(outputTokens) * BigInt(prices.outputMicroUsdPerMillionTokens) + 999_999n) / 1_000_000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new SyntheticBudgetError('synthetic_price_overflow');
  return Number(cost);
}

/** Synthetic spend exercise around an in-memory mock. Not a provider client or real-account admission. */
export function createBudgetedMockFixture(ledger: SyntheticBudgetLedger, transport: MockProviderTransport, prices: SyntheticPrices) {
  if (!validPrices(prices)) throw new SyntheticBudgetError('synthetic_price_invalid');
  const pinnedPrices = Object.freeze(structuredClone(prices));
  const fixture = createMockProviderFixture(transport);
  return async (context: DecisionContext, signal: AbortSignal): Promise<FixtureResponse> => {
    if (signal.aborted) throw new SyntheticBudgetError('synthetic_mock_aborted');
    const request = buildMockProviderRequest(context);
    const view = ledger.view();
    const requestId = createHash('sha256').update(JSON.stringify([view.fixtureId, request.input.selfRef, request.input.tick])).digest('hex');
    const ceiling = syntheticCost(request.maxInputTokens, request.maxOutputTokens, pinnedPrices);
    if (ledger.reserve(requestId, ceiling) !== 'reserved') throw new SyntheticBudgetError('synthetic_mock_duplicate');
    let result: FixtureResponse;
    try { result = await fixture(request.input, signal); }
    catch {
      ledger.markUncertain(requestId);
      throw new SyntheticBudgetError('synthetic_mock_uncertain');
    }
    const cost = syntheticCost(result.inputTokens, result.outputTokens, pinnedPrices);
    const settled = ledger.settle(requestId, cost);
    if (settled.halt) throw new SyntheticBudgetError('synthetic_budget_halted');
    return result;
  };
}
