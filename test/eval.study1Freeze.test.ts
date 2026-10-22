import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MultiActorEpisode, multiScenarioById } from '../src/eval/multiActorEpisode.js';
import { contractHash } from '../src/eval/constructs/authorityAttribution.js';
import { manifestSha256, wireRequest, type StudyManifest } from '../src/eval/accountedRunner.js';

/**
 * Study 1 freeze (run postponed on 2026-10-21 until the owner reactivates it; docs/research/RUNBOOK_AUTHORITY_STUDY_1.md).
 * The research object must not change mid-study: these pins hold the exact request bytes the
 * live model receives (the runner's own `wireRequest`, so they are what it dispatches), the
 * contract and the manifest. A failure here means a change would alter
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
 *   4. schema `const` written as one-value typed enums (owner approved 2026-10-22): Google does not
 *      support `const` and OpenAI does not document it (it accepted it in the two live calls of
 *      2026-10-18). Same constraint, in the form every provider documents; request bytes change,
 *      the contract and the manifest do not.
 *   5. study 1 runs on claude-haiku-5-5 (owner decision D11, 2026-10-22: "use haiku"). The model
 *      receives the Anthropic Messages translation of each final request, so the pins now hold
 *      those bytes; the manifest's model changes (manifest pin moves), the contract does not.
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'claude-haiku-5-5';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': '471f5288994e9bd84b3232435c98617bde2378ec4a7d1fa1ab810fc22620d448',
  'baker-1': 'e64fbdea059a54681a0b1f5fc3c207a52df802bf5d26b90d1223a415c8650059',
  'miller-0': 'c3ea59ef43f7ce3947283ae65ca134a34d2915d5ae38958e77def814b23e156d',
  'courier-0': '21b69f0475123023ce858ff40580eeb57b035d9b99f7ff91c5da485505a021d2',
  'investigator-0': 'fa0dbdf2752a6ee601d1adcb5f3d3a8cd81be023931fe5d8c3f20f0c1f4eb3c5',
  'importexport-0': '6a492121006a0115c28c0b6939bc2b95351bcb2a61e305c1285635ec3cec9d48',
  'grifter-0': 'f37f80f466390cb0b6e8b776bf4c8cd03753fc4581ffb6136483329b4b8ffb43',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '4975c8a83bbef48485e4bc377f2c7850c5ca2331c3ce8927ebabdec4f4435e3e', 'miller-0': 'e58d12db50160aced8607fdea1242de04a0afc4be833f047d759ef490b322414', 'grifter-0': '1d9206340a9ce2f7718036abf4289b40be74e755de01a5999fbdbe539c38e34d' },
  anonymous: { 'baker-0': 'a9a495e5f2162ed9e8f5852502fe1a9fd60e4abdfe102b91e8e22f4a1ca07606', 'miller-0': '0f7fd47f2d95e49c0eb4cc48b605de23c6acb1030e7871288eb339975c92b402', 'grifter-0': '4a37b41c526970c4905bac30b835a4f8ec9e7182b0d61fe8bf1734c26dfe0fea' },
  none: { 'baker-0': '1dc5ac1d3294fa31dbbbe614f8849245dce638e3e5b5f3f97bd9095beda509d2', 'miller-0': '4aa9a9589beaaa4a15fb6e9255aebc062edee9d02a957e2dad98ab10d95d5cf7', 'grifter-0': '309d39d8f17009cf52cdf9ca882b8c143e3dbcf2c66b31f18d0618a413ba061a' },
};

describe('study 1 is frozen until it has run', () => {
  for (const arm of ['council', 'anonymous', 'none'] as const) {
    it(`${arm}: tick-0 and exposure-tick request bytes are unchanged`, () => {
      const ep = new MultiActorEpisode(multiScenarioById(`authority_attribution_${arm}`), 'freeze');
      const t0 = Object.fromEntries(ep.prompts({ model: MODEL }).map((p) => [p.actorId, wireRequest(p.request!, MODEL).sha256]));
      expect(t0).toEqual(TICK0);
      for (let t = 0; t < 2; t++) {
        const ps = ep.prompts();
        ep.act(Object.fromEntries(ps.map((p) => [p.actorId, NULL_DECISION])));
      }
      const t2 = Object.fromEntries(ep.prompts({ model: MODEL }).filter((p) => p.actorId in TICK2[arm]!).map((p) => [p.actorId, wireRequest(p.request!, MODEL).sha256]));
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

const MANIFEST_SHA256 = '5979c6f9ae8ed134d4307707f0a43b1713a34062eb5cc6283c946450f48c50ac';
