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
 * Re-pinned ONCE, deliberately, on 2026-10-21 by owner direction ("no study starts with known
 * issues"; study 1 depends on the viable solution): contract 1.1.0 runs on the tightened
 * recognition-v2 baseline. Before that the pins held the v1 baseline (manifest cb172eea...).
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'gpt-5.4-nano-2026-03-17';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': 'c08fd3bf8156a1e575115e495d18ab3914be22aeca8fd3593e9e17af0e0095cc',
  'baker-1': '13dbf0d6ae3aaab4882b07ef73c70fcedb24190ef0d9f061d7493898d7d023a3',
  'miller-0': '57554c84b7214a8a5eaf4a18d8ae0190bbf1eddd64666e7b30b505ec7370d2c2',
  'courier-0': '2b52809818b316fba027bcc4a88ac22a6e457696f00f246036146c25f4a8ce0d',
  'investigator-0': '256a81b626349e018c531e95e77d1fe695c174d4848b8bca955b5ec750896bdf',
  'importexport-0': '0be12bb6cd41eaa3dcbe82b7d8c5bd378b2b3b0d4952381845f609f76019905a',
  'grifter-0': '016659b6316b6891911149377e8f022e38e79c78cc32032490287a7743ed83be',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '3036e178203c74d01a2bb80c63a5c983c9f2727aeae7a69f7ced9b29afde3864', 'miller-0': '252f92f689e5518fc39948a266376e961a955b9b5089fb02c89dfab6e159f609', 'grifter-0': 'ca5b1fe9b4d84fd7b4a8c8b4a122268cd2774afecd7eebb66f8dee18662a87b0' },
  anonymous: { 'baker-0': 'ce31bb269f99badcf4d3ffd86797032f535aca23d182011af94a2741ea2c53f2', 'miller-0': 'a35fe93064e225d931120bf9b250542ffd2d07e70510a2db9ced112c3d1bff49', 'grifter-0': '8704dedc3a4504b12bd52eb0759c9bd38239ea386ed73f964125c053e73703a0' },
  none: { 'baker-0': '80382d5fbcae5b6ce7851a4fdfcf0fcabdde4abaf90909cf8d70b59e46df1795', 'miller-0': '5b4224dab4ee9abbd31c60bc9a86b564d9bfac38269de62a8ca6083ceed2b292', 'grifter-0': '66be47f223f94457c8a8626221bfeaaf88cafed4d6f9c7ee5cc52f306fd6c136' },
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
