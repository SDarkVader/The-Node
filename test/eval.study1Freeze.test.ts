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
 *   6. v2 Grifter role line (owner direction 2026-10-22, "fix them"): it said movement/observation
 *      only, contradicting the v2 action line and the validator, which let the Grifter speak and keep
 *      the diary. Only grifter-0's bytes change; the other actors, the contract and the manifest do not.
 *   7. reasoning evidence (owner decision 2026-10-22: reasoning is part of the design; study 1
 *      captures it at medium effort): every Anthropic request asks for adaptive thinking with
 *      summarized display at effort medium, in place of thinking disabled at effort low. Every
 *      actor's bytes change; the manifest records the setting (manifest pin moves); the contract
 *      and the analysis do not.
 * Pins move only by explicit owner direction before the study runs, never to make a test pass.
 */

const MODEL = 'claude-haiku-5-5';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': '33d1e020ad8e12536010f29b2beded3401c82f854e0c15cef9205d70b1326ec6',
  'baker-1': '7c7a9df6fa3cedfc1a08261b182fb924fd854b2efd96f353580ebf96104a607e',
  'miller-0': 'd542669994c2ec331e2badb5dc78f9472e864abfe4ace631a9b28a14a8f9f4cd',
  'courier-0': '01c9c3515b7fd6c8fef81a6eef3e68b65396784d31d7780fe1df583e670a35b0',
  'investigator-0': '76ac752ea8aa6b6c5ba1c6d286ac0362fec93629d15a627c4ebd92520ed33e2f',
  'importexport-0': '6edf15bc64d732cc454f777fb78bab832ce34edc5cabd0a3fe28406f1272b43e',
  'grifter-0': '30bed5a0eddb524090238f74779c52bb2dbd7093865ab889fc24f6112ab3afac',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '329716922a1a98a28e8f0564b5f981a9f011704cf500eff9132d28aa451c54c9', 'miller-0': '7d203a01d4883d4845cb520f000868fac33d5cc9f68b0e2b7fa201e0773b116e', 'grifter-0': 'cbb93cb9de7b30e96ab788a2ebfd3797d747a564474959535fc2c6d454b23fca' },
  anonymous: { 'baker-0': '2ac08a95516ac2091362eaba3de9a7ac3c4542e00061fa8fb2ae3114f546c628', 'miller-0': 'f05c67f872e1a98256fea47cc0ce7b569580abfa9b88e69239d485960dfec1e3', 'grifter-0': '5dd010e04072e3d000140976686a09f74bef90f8b9c41f19f4833b27e84715a6' },
  none: { 'baker-0': 'a2d1f964cbdf3785113cc6d611f6ebcdb6eaef0d4021a68f5f04dd8bddc036ea', 'miller-0': '46386329fe16c17e25f95121c8dcb7823a8ed695f588fc2d5d41748857b8aa51', 'grifter-0': '7bb0abd8373c5f21bd1820b3e6806d575d5ea151447a558e296f515833321bfb' },
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

const MANIFEST_SHA256 = '8237ceeba60ae7682b7b6331c9707b58aebc0521e976955b3a35d80e5c2086e7';
