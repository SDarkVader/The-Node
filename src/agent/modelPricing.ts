import type { AccountingPrices } from './accountingLedger.js';

/**
 * Reviewed, evidence-backed conservative rates for models an experiment allowance may authorise
 * when they differ from the carried allowance's model (owner decision D11, 2026-10-22: study 1 on
 * claude-haiku-5-5). Rates are never supplied by the operator at preparation time. A new model
 * enters only through a reviewed commit that adds its entry here together with its evidence file.
 *
 * Conservative = 2x list, the same booking rule as the carried gpt-5.4-nano rates (list
 * 0.20 / 1.25, booked 0.40 / 2.50 USD per million tokens).
 *
 * `evidenceSha256` is the sha256 of the committed excerpt below, with line endings normalised to
 * LF (a Windows checkout may convert them). `test/modelPricing.test.ts` holds the hash, the
 * quoted list prices and the 2x rule together.
 *
 * Never edit an entry once an allowance may use it: every open of the allowance re-checks its
 * rates against this entry, so a changed entry refuses that allowance (fail closed). New prices
 * mean a new reviewed entry for a new model id.
 */
export const PRICE_EVIDENCE_FILES: Readonly<Record<string, string>> = {
  'claude-haiku-5-5': 'docs/research/model-options-2026-10-21/evidence/anthropic-pricing-haiku-5-5-2026-10-22.md',
};

export const PRICED_MODELS: Readonly<Record<string, AccountingPrices>> = Object.freeze({
  // List $0.10 / $0.50 per MTok for prompts up to 100,000 tokens (evidence excerpt, retrieved
  // 2026-10-22). Study 1 remains capped at 36,864 input tokens. The explicit continuation
  // extension admits at most 100,000; larger inputs are refused before dispatch.
  'claude-haiku-5-5': Object.freeze({ model: 'claude-haiku-5-5', inputMicroUsdPerMillionTokens: 200_000, outputMicroUsdPerMillionTokens: 1_000_000,
    evidenceSha256: '047daf84d023e17190bde34847982fab9e1f33e46492057c88334332fb2f30d0' }),
});

/**
 * The only prices an allowance for `model` may carry: the carried allowance's own rates when the
 * model is unchanged, otherwise the reviewed entry above. Null means no evidence-backed rate.
 */
export function authorizedPrices(model: string, carried: AccountingPrices | null): AccountingPrices | null {
  if (carried && carried.model === model) return carried;
  return Object.hasOwn(PRICED_MODELS, model) ? { ...PRICED_MODELS[model]! } : null;
}
