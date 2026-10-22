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
 *   4. schema `const` written as one-value typed enums (owner approved 2026-10-22): verified on
 *      2026-10-21 that neither OpenAI's nor Google's structured-output subset documents `const`,
 *      and strict mode rejects an unsupported keyword, so the first live call could have failed.
 *      Same constraint; request bytes change, the contract and the manifest do not.
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'gpt-5.4-nano-2026-03-17';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': '836f050f343f5cb51c9c99b1b9fa07923b1bc2a543d5b3a51c28ae021db74fbd',
  'baker-1': 'fb3028e6c8e027320d7209ecee1507b2a8b1678997d067c03c984dc8087d942d',
  'miller-0': '7dea74c6084f650ebe39b64b8522ee8eec9203a1cd17ace225691960fcdc98d4',
  'courier-0': '6f60a710802e5379ca4987a5a468531b568456ca32b821f03863be27290d2a7e',
  'investigator-0': 'df584a95c37cdbfbb06bbd955dffd115b25e9a601e4a33e7a32831032a49b7bb',
  'importexport-0': '9ab45f1438b7379d2cfcd49689de93a565971c8d6a473d29f7054a22045111f8',
  'grifter-0': 'fe5234d561b9296713f884a02f99e8dae98e8d5daed0ed07ba4360ab3fda0994',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '44ca86349aa333c7c0e2a730b46b84239d1f9004cc4d3044df3837f692edd8d8', 'miller-0': 'bab54b3de4281cfb8268edbb0fe5aeaaa15ab6f65e1b1b3580dfa543ea6de18e', 'grifter-0': '50290cc1ed99909044d1a8ffe2cfe7da865ad996637c2f36510f242a8206efbc' },
  anonymous: { 'baker-0': '9edb3a159f219242243220d98f0207ffbe12cb7f4ede5447e80c810827cc988d', 'miller-0': 'ed7a7c2d4becba1962bb1e605e96ffc06c0e915bd22a513370dad3f1975af756', 'grifter-0': '3b7769f3aa62fadb681280b6f14d42d4804873c77839792d6cb826b2b05d014d' },
  none: { 'baker-0': '1b2b3d06a5ee52b4bbda4eb1c01117e101f611b691064f426d68efa6b0b689c1', 'miller-0': '948e2ec4332a96167fa0ad8ff3f8a2a6a11adf56419c64b82e84e3216dfc9861', 'grifter-0': '1208de3e7a6eef69b77d185aa6c2d67c7843906fd90a2180db153a0f15735927' },
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
