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
 * what study 1 measures. Do not re-pin to make it pass: ship the change as a new rules/scenario
 * version after study 1, then move these pins to a new study's freeze test.
 */

const MODEL = 'gpt-5.4-nano-2026-03-17';
const NULL_DECISION = JSON.stringify({ move: null, communication: null, diary: null, role: null });
const TICK0 = {
  'baker-0': '733d6cbc6973840301539144b344e2417266158a7306c7203affce95e78e12d3',
  'baker-1': 'ab5a5e7bd5f171efdde9c563e15f3c702b1d2ff814a95dc23d89cde7f16ec37d',
  'miller-0': '09031619cc1cf2de8014fc0e61ac3e11ca7a85a059bd999a562059c4a223dd00',
  'courier-0': 'a088ec3f11b7dfe43b44ad1b99981d743f7ad2f63f369062df930c79790bf94c',
  'investigator-0': 'ac4c7a888f1e64b07dfd522a761c087736e46e4221696d11ab47a6e439d5678b',
  'importexport-0': 'cd556208368532c81f78e0736def64b4e05cb09738bd14f1931153dc8063c6ba',
  'grifter-0': 'aebbb29134aa5496c52dc1c412befb7e775596ad18e3e230792a1a18d53f3c01',
};
// Exposure tick (2) after two all-null ticks: the bytes that carry each arm's notice.
const TICK2: Record<string, Record<string, string>> = {
  council: { 'baker-0': '4701d1ad6fda4349232d014a3a16c89496c805f1041784cce3ae65f9f84eaeb6', 'miller-0': '76c701da78ac9a080bfa3a70bb02f10006fa9ce3f4a8820847caf0695c641618', 'grifter-0': '070dba9bf9d1a76f32537ff0bbd7882fa351ff1531a572d177eb021fc0264c7c' },
  anonymous: { 'baker-0': 'e64ff21cec7ce309e91afee5e7ffe29b6c131f8cc6c77498cd251ee75381acda', 'miller-0': '3dd07bfa39392c3100f150975b062228ef834d97e4075f0eea014cbc1bcc75a0', 'grifter-0': '58c0270ecab2f6dfc863568b46250f2df449c78671d76c555e4e30614ac9d13e' },
  none: { 'baker-0': 'c9661f5169d124aaac9b2a5b5298db86e98499ae59504eec5f5d95fabc68de42', 'miller-0': '082a83faf3f832a89c0f916cf26e94d98c110fef18c6b76b6f75b3c6d0547b51', 'grifter-0': '34593ee90c8da37cb6a29d49d3336a8287d59a6700b2c3ba056027a15048be15' },
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

const MANIFEST_SHA256 = 'cb172eea5cc387c3a41bc92efe44c249b8f5ca82622610f70c8510b8b8883166';
