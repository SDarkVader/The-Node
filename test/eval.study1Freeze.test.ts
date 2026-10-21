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
 *   3. "show who can hear" (owner decision 2026-10-21): the v2 observation lists who is within
 *      speaking range (`hearing`), the rules text says so, the schema's addressee enum is that list
 *      and moves take effect after the day's speech. Request bytes change; the contract and the
 *      manifest do not.
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'gpt-5.4-nano-2026-03-17';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': 'ada54c045880b84b19eeb7cc5335b9b0a4b9c1736ed2749ad5b60f0f00f1bd62',
  'baker-1': '8dcb1d9d0cae61f7a20afac3e9082d9248a668ebd60e47fce8e105ded9c3297c',
  'miller-0': '7ad6d3645fec29ee7749cf9b25da94036a0c32b249b28936f62838d2979e2fa5',
  'courier-0': '43f8e90d9b3b49e9dfdf7b044872fce853e30cc1b641e4f8bf76cfb0d631f4a3',
  'investigator-0': 'a76836e8e616e5bce2db2501ca9b04a6f8a6f01c9410069c25e29d83b031aa75',
  'importexport-0': 'fdd2dcc4754bd748b97fb7a25f81ae7e2290c5d13f89240bb5c1947b8d91035d',
  'grifter-0': 'af1d0e6894705696aa9a8059fc9529755eb3d527b421ef9ec87c460ed950a208',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '06c9174a49a2f49335d0a68fd8f3d9e78739cd64f92c641858edcda8c6d44c32', 'miller-0': '0063005a7b2dfbb13e9492568c551ec370ee5926fd060cbcf50dd39afca19b98', 'grifter-0': 'cf8776438e3b91b5e9baa64c430bf90e22d4e974b1bd702d8d686b9f2ca4e2d1' },
  anonymous: { 'baker-0': 'd978e1d15ce1ce34996f052a5aa4acc7f4a64d52efc64b4e0c087f0b4f3f7100', 'miller-0': '5dd7ff93d601499fa77b1cabe66fcf62782c00814f205ad81a24a762cd2c3cdb', 'grifter-0': '993aca07e6e23b4d8b8a9797bf7b6477578d950d64df78edd37d859a5be657d4' },
  none: { 'baker-0': 'cb524f0dd66ce62103ddb81cbd9045c989d37b337e4f94ee09992ec8b6b68ac1', 'miller-0': 'b226916b703247e56c35688fb08f1c10d9d5c3714158a609e6658d731049f385', 'grifter-0': '396d57dca0ad9084ad330f8f54f0196f04fc738887dc889c5ea6740a3d153600' },
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
