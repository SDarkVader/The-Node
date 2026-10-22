import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PRICED_MODELS, PRICE_EVIDENCE_FILES, authorizedPrices } from '../src/agent/modelPricing.js';
import { EXPERIMENT_MODEL, isExperimentModel } from '../src/agent/experimentBudget.js';
import { HAIKU_5_5_PRICES } from '../src/eval/anthropicConnectionCheck.js';
import { usageCost, type AccountingPrices } from '../src/agent/accountingLedger.js';

// A Windows checkout may convert line endings; the evidence hash is defined over LF text.
const lf = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** List USD per million for one row of the quoted pricing table: [base input, output]. */
function listPrices(excerpt: string, row: string): [number, number] {
  const line = excerpt.split('\n').find((l) => l.startsWith(`| ${row} `));
  if (!line) throw Error(`row_not_quoted: ${row}`);
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  const usd = (cell: string) => { const m = /^\$(\d+(?:\.\d+)?) \/ MTok$/.exec(cell); if (!m) throw Error(`price_cell: ${cell}`); return Number(m[1]); };
  return [usd(cells[1]!), usd(cells[5]!)];
}
const CARRIED: AccountingPrices = { model: EXPERIMENT_MODEL, inputMicroUsdPerMillionTokens: 400_000, outputMicroUsdPerMillionTokens: 2_500_000, evidenceSha256: 'a'.repeat(64) };

describe('reviewed model prices (owner decision D11, 2026-10-22)', () => {
  it('every priced model has a committed evidence excerpt whose LF hash is the one booked', () => {
    expect(Object.keys(PRICED_MODELS).sort()).toEqual(Object.keys(PRICE_EVIDENCE_FILES).sort());
    for (const [model, entry] of Object.entries(PRICED_MODELS)) {
      expect(entry.model).toBe(model);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(sha256(lf(PRICE_EVIDENCE_FILES[model]!))).toBe(entry.evidenceSha256);
    }
    expect(Object.isFrozen(PRICED_MODELS)).toBe(true);
  });

  it('Haiku 5.5 books at exactly 2x the quoted list price for prompts up to 100,000 tokens', () => {
    const excerpt = lf(PRICE_EVIDENCE_FILES['claude-haiku-5-5']!);
    expect(excerpt).toContain('- Source: https://platform.claude.com/docs/en/about-claude/pricing.md');
    const [input, output] = listPrices(excerpt, 'Claude Haiku 5.5 (for prompts up to 100,000 tokens)');
    expect([input, output]).toEqual([0.10, 0.50]);
    const haiku = PRICED_MODELS['claude-haiku-5-5']!;
    expect(haiku.inputMicroUsdPerMillionTokens).toBe(Math.round(input * 1e6) * 2);
    expect(haiku.outputMicroUsdPerMillionTokens).toBe(Math.round(output * 1e6) * 2);
    // The connection check reports list cost from the same quoted figures.
    expect([HAIKU_5_5_PRICES.inputUsdPerM, HAIKU_5_5_PRICES.outputUsdPerM]).toEqual([input, output]);
    // The over-100k band costs 5x more, but no request may exceed 36,864 input tokens, so it cannot apply.
    expect(listPrices(excerpt, 'Claude Haiku 5.5 (for prompts over 100,000 tokens)')).toEqual([0.50, 2.50]);
    expect(usageCost(36_864, 2_048, haiku)).toBe(Math.ceil(36_864 * 0.2) + Math.ceil(2_048 * 1));
  });

  it('a model keeps its carried rates; a new model gets only its reviewed entry; anything else has none', () => {
    expect(authorizedPrices(EXPERIMENT_MODEL, CARRIED)).toBe(CARRIED);
    const haiku = authorizedPrices('claude-haiku-5-5', CARRIED)!;
    expect(haiku).toEqual(PRICED_MODELS['claude-haiku-5-5']);
    haiku.inputMicroUsdPerMillionTokens = 1;
    expect(PRICED_MODELS['claude-haiku-5-5']!.inputMicroUsdPerMillionTokens).toBe(200_000);
    expect(authorizedPrices('claude-haiku-5-5', null)).toEqual(PRICED_MODELS['claude-haiku-5-5']);
    for (const model of ['claude-opus-5-5', 'gpt-6-luna', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(authorizedPrices(model, CARRIED), model).toBeNull();
      expect(isExperimentModel(model), model).toBe(false);
    }
    expect([EXPERIMENT_MODEL, 'claude-haiku-5-5'].every(isExperimentModel)).toBe(true);
    for (const v of [null, undefined, 1, {}, ['claude-haiku-5-5']]) expect(isExperimentModel(v)).toBe(false);
  });
});
