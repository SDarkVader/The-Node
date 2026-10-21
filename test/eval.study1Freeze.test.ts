import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MultiActorEpisode, multiScenarioById } from '../src/eval/multiActorEpisode.js';
import { contractHash } from '../src/eval/constructs/authorityAttribution.js';
import { manifestSha256, type StudyManifest } from '../src/eval/accountedRunner.js';

/**
 * Study 1 freeze (run postponed on 2026-10-21 until the owner reactivates it; docs/research/RUNBOOK_AUTHORITY_STUDY_1.md).
 * The research object must not change mid-study: these pins hold the exact request bytes the
 * live model receives, the contract and the manifest. A failure here means a change would alter
 * what study 1 measures.
 *
 * Pins moved deliberately, before any study, by owner direction on 2026-10-21 ("no study starts
 * with known issues"; study 1 depends on the viable solution):
 *   1. contract 1.1.0 runs on the tightened recognition-v2 baseline (v1 manifest was cb172eea...);
 *   2. v2 observer references shortened to 64 bits, because v2 requests reached 32,756 of the
 *      32,768-byte fail-closed ceiling (now about 26 KB at most). The manifest is unchanged by 2.
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'gpt-5.4-nano-2026-03-17';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': 'c2ae5ef869b0c7a4a1f0a540728430f09fb7e2c7bfff88a3524bfe2ca78cf944',
  'baker-1': '8bb540e8f68be992a5b39bf7c71e28d04f6fe7982eea69c0f9adc952f546ef35',
  'miller-0': 'ad587fe9d4711cadc31ef4f3dcb7ad5f963303d296a4b2ee62af9f59affadf75',
  'courier-0': '2043d726bdac79e5632abe4e8852a30f4c9d11bb9fbb2e5417ade744c2f86b57',
  'investigator-0': '28145e3eea26227bbadd631979706a3608a778d6234e850371b69593dfe2d92b',
  'importexport-0': 'a60b461b19fc6042d10a35bbfe20daf7238429aca8fc17bee9ac433c4689b720',
  'grifter-0': '190723b50be271b0ad621221a16a774ddd30981ec51f6ef00ac67864613765e5',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '41926678a858d84201d902a12734c34f6f4b36b98489bd5159247a52869b728e', 'miller-0': 'b0bdfb4535d5ca45f2a7c82e9eb22f1e544c69ff7d4c88f90dfc6adc20d82d76', 'grifter-0': '5cdab81630ee39aeed3c38defc4807f43d67d7d426f9f695379185e85ace739a' },
  anonymous: { 'baker-0': '535056a829c6ed4006f4b5a0d7b94b0cf51129dae024967b556fdd9064eacdcd', 'miller-0': '6048eae720ff89100ed5ce237ce114f76fcb0c0735839ed6e07acb1ce8f8c1f9', 'grifter-0': '7838fcc35fb8267f7c45e6d54eab67dff7f4966a5974430ccfa850baba714850' },
  none: { 'baker-0': 'fd4df1d98a937dd742bf8122ef32499b0ec73b4de3def7d63330a780775de8d5', 'miller-0': 'fa40629be21c00c144c8b3b3b741473bd3e6090d2100c25d24cf719416bc81e3', 'grifter-0': 'cba7e88d91d3cdd2dd04d0ceb9c27f73f30290a46d1c982bfec2e79948f02f15' },
};

describe('study 1 is frozen until it has run', () => {
  for (const arm of ['council', 'anonymous', 'none'] as const) {
    it(`${arm}: tick-0 and exposure-tick request bytes are unchanged`, () => {
      const ep = new MultiActorEpisode(multiScenarioById(`authority_attribution_${arm}`), 'freeze');
      const t0 = Object.fromEntries(ep.prompts({ model: MODEL }).map((p) => [p.actorId, p.request!.sha256]));
      expect(t0).toEqual(TICK0);
      for (let t = 0; t < 2; t++) {
        const ps = ep.prompts();
        ep.act(Object.fromEntries(ps.map((p) => [p.actorId, NULL_DECISION])));
      }
      const t2 = Object.fromEntries(ep.prompts({ model: MODEL }).filter((p) => p.actorId in TICK2[arm]!).map((p) => [p.actorId, p.request!.sha256]));
      expect(t2).toEqual(TICK2[arm]);
    });
  }

  it('the contract and the manifest are the ones the allowance will be bound to', () => {
    const manifest = JSON.parse(readFileSync('evals/manifests/authority_attribution_study_1.json', 'utf8')) as StudyManifest;
    expect(contractHash()).toBe(manifest.contract.hash);
    expect(manifestSha256(manifest)).toBe(createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
    expect(manifestSha256(manifest)).toBe(MANIFEST_SHA256);
  });
});

const MANIFEST_SHA256 = 'c875f610a9c2b3df1077c7db5ebcbacccea1e8282910f576bfca7b36c162d0d5';
