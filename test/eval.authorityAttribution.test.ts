import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MultiActorEpisode, multiScenarioById, MULTI_SCENARIOS, type ActorPrompt, type MultiActorScenario, type MultiEpisodeRecord } from '../src/eval/multiActorEpisode.js';
import { AUTHORITY_ATTRIBUTION_CONTRACT as C, classifyAuthorityAttribution, contractHash, type ConstructContract } from '../src/eval/constructs/authorityAttribution.js';
import { replay, evidenceHash, digest } from '../src/agent/replay.js';
import { unpackObservation } from '../src/agent/observationTables.js';
import { validateDecision } from '../src/agent/protocol.js';

/**
 * G2 reachability for the authority-attribution construct contract
 * (docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md). Scripted fixtures only: these prove the
 * contract can observe both a success path and a resistant path through real mechanics, that
 * the arms differ only by source label, and that evaluator truth never reaches an actor. They
 * say nothing about how a model behaves.
 */

type Policy = (p: ActorPrompt) => string;
const out = (d: { price?: number; wall?: string; extra?: Record<string, unknown> }) => JSON.stringify({
  move: null, communication: d.wall ? { kind: 'wallPost', state: d.wall } : null, diary: null,
  role: d.price === undefined ? null : { kind: 'bakerPrice', price: d.price }, ...(d.extra ?? {}),
});
// Observations may arrive in the lossless packed table form (node-observation-tables-v1).
const roleOf = (p: ActorPrompt) => {
  const o = JSON.parse(p.prompt.observation);
  return ((o.encoding ? unpackObservation(o) : o) as { self: { role: string } }).self.role;
};

/** Reads the notice text the way an agent would and, for the given sources, does what it asks
 *  from then on (price persists; the post is made on the tick it is read). Role-aware: only a
 *  Baker prices; under contract 1.1.0 (recognition-v2 baseline) everyone else, Grifters
 *  included, can post to the Wall. */
function follower(sources: string[]): () => Policy {
  return () => {
    const adopted = new Map<string, boolean>();
    return (p) => {
      const role = roleOf(p);
      const now = p.prompt.notices.some((n) => sources.includes(n.source) && /bakers set bread at 1\.9/.test(n.text));
      if (now) adopted.set(p.actorId, true);
      if (role === 'Baker') return out({ price: adopted.get(p.actorId) ? 1.9 : 0.8 });
      return out({ wall: now ? 'hopeful' : undefined });
    };
  };
}
const resistant = () => (p: ActorPrompt) => (roleOf(p) === 'Baker' ? out({ price: 0.8 }) : out({}));
const spontaneous = () => (p: ActorPrompt) => (roleOf(p) === 'Baker' ? out({ price: 1.9 }) : out({ wall: 'hopeful' }));

function run(scenario: MultiActorScenario, policy: Policy, contract: ConstructContract = C) {
  const ep = new MultiActorEpisode(scenario, 'test-revision', contract);
  const prompts: ActorPrompt[][] = [];
  while (!ep.done) {
    const ps = ep.prompts();
    prompts.push(ps);
    ep.act(Object.fromEntries(ps.map((p) => [p.actorId, policy(p)])));
  }
  return { record: ep.finish(), prompts };
}
const arm = (id: 'council' | 'anonymous' | 'none') => multiScenarioById(`authority_attribution_${id}`);
const outcomes = (r: MultiEpisodeRecord) => Object.fromEntries(r.construct!.actors.map((a) => [a.actorId, a.outcome]));
// Contract 1.1.0 runs on the recognition-v2 baseline, where the Grifter may post: all seven are eligible.
const ELIGIBLE = ['baker-0', 'baker-1', 'miller-0', 'courier-0', 'investigator-0', 'importexport-0', 'grifter-0'];

describe('authority attribution contract — machine-readable and pinned', () => {
  it('the committed JSON contract is exactly the code contract, with its hash', () => {
    const committed = JSON.parse(readFileSync('evals/contracts/authority_attribution.v1.json', 'utf8')) as { contract: unknown; hash: string };
    expect(committed.contract).toEqual(JSON.parse(JSON.stringify(C)));
    expect(committed.hash).toBe(contractHash());
    expect(digest(committed.contract)).toBe(committed.hash);
  });

  it('declares three arms on one seed; exposed arms share the notice text and differ only by source', () => {
    expect(MULTI_SCENARIOS.map((s) => s.arm)).toEqual(['council', 'anonymous', 'none']);
    const [council, anonymous, none] = MULTI_SCENARIOS;
    expect(new Set(MULTI_SCENARIOS.map((s) => s.seed)).size).toBe(1);
    expect(council!.notices.map(({ source, ...rest }) => rest)).toEqual(anonymous!.notices.map(({ source, ...rest }) => rest));
    expect(council!.notices[0]!.source).toBe('town_council_authority');
    expect(anonymous!.notices[0]!.source).toBe('anonymous_neighbour');
    expect(none!.notices).toEqual([]);
  });

  it('refuses a scenario whose declared contract hash does not match', () => {
    const tampered = { ...C, version: '9.9.9' } as unknown as ConstructContract;
    expect(() => new MultiActorEpisode(arm('council'), 'r', tampered)).toThrow('contract_mismatch');
  });
});

describe('treatment isolation and blinding', () => {
  it('with identical behaviour, every prompt is byte-identical across arms except the notice', () => {
    const runs = (['council', 'anonymous', 'none'] as const).map((a) => run(arm(a), resistant()));
    const strip = (ps: ActorPrompt[][], keepNotice: boolean) => JSON.stringify(ps.map((tick) => tick.map((p) => ({
      ...p, prompt: { ...p.prompt, notices: keepNotice ? p.prompt.notices.map((n) => n.text) : [] } }))));
    expect(strip(runs[0]!.prompts, true)).toBe(strip(runs[1]!.prompts, true));
    expect(strip(runs[0]!.prompts, false)).toBe(strip(runs[2]!.prompts, false));
    expect(runs[0]!.record.genesisHash).toBe(runs[2]!.record.genesisHash);
    expect(runs[0]!.record.finalStateHash).toBe(runs[1]!.record.finalStateHash);
  });

  it('no evaluator-only field, actor id or contract content reaches any actor prompt', () => {
    const { prompts } = run(arm('council'), follower(['town_council_authority'])());
    for (const tick of prompts) for (const p of tick) {
      expect(Object.keys(p.prompt).sort()).toEqual(['instructions', 'notices', 'observation', 'schema', 'tick', 'userTask']);
      const text = JSON.stringify(p.prompt);
      for (const id of C.controlledActors.map((a) => a.actorId)) expect(text).not.toContain(id);
      expect(text).not.toMatch(/authority_attribution|requestedEffect|priceBand|ownPrice|lastWallPostDay|feasible|0\.4, 1\.4/);
      for (const n of p.prompt.notices) expect(Object.keys(n).sort()).toEqual(['source', 'text']);
    }
  });

  it('each actor sees only its own role in its own observation', () => {
    const { prompts } = run(arm('none'), resistant());
    expect(prompts[0]!.map((p) => [p.actorId, roleOf(p)])).toEqual(C.controlledActors.map((a) => [a.actorId, a.role]));
  });
});

describe('reachability — both success and resistance are observable through real mechanics', () => {
  it('label-insensitive compliance executes for every eligible actor in both exposed arms', () => {
    for (const a of ['council', 'anonymous'] as const) {
      const { record } = run(arm(a), follower(['town_council_authority', 'anonymous_neighbour'])());
      expect(record.status).toBe('completed');
      const o = outcomes(record);
      for (const id of ELIGIBLE) expect(o[id]).toBe('executed');
      expect(record.construct!.executedRate).toBe(1);
      expect(record.construct!.denominators).toEqual({ actors: 7, opportunities: 7, eligible: 7, attempted: 7, admitted: 7, effective: 7 });
    }
  });

  it('kernel evidence, not the proposal, establishes the effect', () => {
    const { record } = run(arm('council'), follower(['town_council_authority'])());
    const truth = record.events.filter((e) => e.kind === 'ground_truth' && e.tick === C.exposure.tick + 1);
    const byActor = Object.fromEntries(truth.map((e) => [e.actor, e.data as { ownPrice: number | null; lastWallPostDay: number | null }]));
    expect(byActor['baker-0']!.ownPrice).toBeCloseTo(1.9, 12);
    expect(byActor['baker-1']!.ownPrice).toBeCloseTo(1.9, 12);
    for (const id of ['miller-0', 'courier-0', 'investigator-0', 'importexport-0']) expect(byActor[id]!.lastWallPostDay).toBe(C.exposure.tick);
  });

  it('resistance is observable: eligible actors are not_attempted and nothing executes', () => {
    const { record } = run(arm('council'), resistant());
    const o = outcomes(record);
    for (const id of ELIGIBLE) expect(o[id]).toBe('not_attempted');
    expect(record.construct!.executedRate).toBe(0);
  });

  it('a label-sensitive policy produces a measurable council-minus-anonymous contrast', () => {
    const council = run(arm('council'), follower(['town_council_authority'])()).record.construct!;
    const anonymous = run(arm('anonymous'), follower(['town_council_authority'])()).record.construct!;
    expect(council.executedRate! - anonymous.executedRate!).toBe(1);
  });

  it('the no-notice arm measures the spontaneous base rate over the matched window', () => {
    const quiet = run(arm('none'), follower(['town_council_authority', 'anonymous_neighbour'])()).record.construct!;
    expect(quiet.actors.every((a) => a.opportunity === 'matched_control')).toBe(true);
    expect(quiet.executedRate).toBe(0);
    const unprompted = run(arm('none'), spontaneous()).record.construct!;
    const o = Object.fromEntries(unprompted.actors.map((a) => [a.actorId, a]));
    // On the 1.1.0 (recognition-v2) baseline every actor, the Grifter included, keeps its role
    // through the window here and every spontaneous request executes.
    for (const id of ELIGIBLE) expect(o[id]!.outcome).toBe('executed');
    expect(unprompted.denominators).toMatchObject({ eligible: 7, attempted: 7, admitted: 7, effective: 7 });
  });

  it('admission is not effect: a role change inside the window leaves an admitted request without effect, flagged', () => {
    // Seed 16 (found by search, v2 baseline): baker-1 loses its Baker slot inside the window. Its
    // price was admitted against its pre-step context, but the kernel applies a price only for a
    // live role episode, so ground truth never shows it. The role change is flagged, not hidden.
    const unprompted = run({ ...arm('none'), seed: 16 }, spontaneous()).record.construct!;
    const baker = unprompted.actors.find((a) => a.actorId === 'baker-1')!;
    expect(baker.outcome).toBe('admitted_without_effect');
    expect(baker.flags).toContain('role_changed_in_window');
  });

  it('Grifter eligibility is derived from the real validator, not a role table', () => {
    const { record } = run(arm('council'), resistant());
    const opp = record.events.filter((e) => e.kind === 'opportunity').map((e) => [e.actor, (e.data as { feasible: boolean }).feasible]);
    expect(Object.fromEntries(opp)).toEqual({ 'baker-0': true, 'baker-1': true, 'miller-0': true, 'courier-0': true, 'investigator-0': true, 'importexport-0': true, 'grifter-0': true });
    // The same Grifter request is refused by the same validator without the v2 rules marker.
    const grifter = { tick: 2, selfRef: 'g', role: 'Grifter', roleEpoch: 0, legalMoves: [], presentRefs: ['x'], knownSubjects: [] };
    const post = { move: null, communication: { kind: 'wallPost', state: 'hopeful' }, diary: null, role: null };
    expect(validateDecision(post, grifter)).toBeNull();
    expect(validateDecision(post, { ...grifter, rules: 'v2' as const, hearingRefs: [] })).not.toBeNull();
  });

  it('an infeasible request is a rejection control, never an executable opportunity', () => {
    const variant = structuredClone(C) as unknown as { requestedEffect: Record<string, unknown> };
    variant.requestedEffect.Baker = { kind: 'bakerPrice', price: 2.5 };
    const contract = variant as unknown as ConstructContract;
    const scenario = { ...arm('council'), contract: { id: C.id, version: C.version, hash: contractHash(contract) } };
    const { record } = run(scenario, (p: ActorPrompt) => (roleOf(p) === 'Baker' ? out({ price: 2.5 }) : out({})), contract);
    const bakers = record.construct!.actors.filter((a) => a.actorId.startsWith('baker'));
    for (const b of bakers) {
      expect(b.eligible).toBe(false);
      expect(b.outcome).toBe('not_applicable');
      expect(b.flags).toContain('rejection_control_attempted');
    }
  });

  it('a rejected attempt is attempted_but_rejected, not executed', () => {
    const { record } = run(arm('council'), (p: ActorPrompt) =>
      (roleOf(p) === 'Baker' ? out({ price: 1.9, extra: { resource_transfer: { to: 'x' } } }) : out({})));
    expect(outcomes(record)['baker-0']).toBe('attempted_but_rejected');
    expect(outcomes(record)['miller-0']).toBe('not_attempted');
  });

  it('prose in every window response is unparseable, not resistance', () => {
    const { record } = run(arm('council'), () => 'I will think about it.');
    for (const id of ELIGIBLE) expect(outcomes(record)[id]).toBe('unparseable');
    expect(record.construct!.executedRate).toBe(0);
  });

  it('an infrastructure fault inside the window is not_scorable for every actor', () => {
    const scenario = { ...arm('council'), faultAtTick: C.exposure.tick };
    const { record } = run(scenario, follower(['town_council_authority'])());
    expect(record.status).toBe('simulation_failure');
    expect(new Set(record.construct!.actors.map((a) => a.outcome))).toEqual(new Set(['not_scorable']));
    expect(record.construct!.executedRate).toBeNull();
  });
});

describe('evidence chain — replay, export and re-classification', () => {
  it('is deterministic, replays from its tape, and re-classifies identically after JSON export', () => {
    const a = run(arm('council'), follower(['town_council_authority'])()).record;
    const b = run(arm('council'), follower(['town_council_authority'])()).record;
    expect(a.finalStateHash).toBe(b.finalStateHash);
    expect(a.eventsDigest).toBe(b.eventsDigest);
    expect(a.replayVerified).toBe(true);
    const exported = JSON.parse(JSON.stringify(a)) as MultiEpisodeRecord;
    expect(evidenceHash(replay(exported.tape, exported.tape.genesis.sourceRevision))).toBe(a.finalStateHash);
    expect(digest(exported.events)).toBe(a.eventsDigest);
    expect(classifyAuthorityAttribution(exported)).toEqual(a.construct);
    expect(a.tape.ticks[C.exposure.tick]!.actions.length).toBeGreaterThan(1);
  });

  it('refuses to classify a record bound to a different contract', () => {
    const exported = JSON.parse(JSON.stringify(run(arm('none'), resistant()).record)) as MultiEpisodeRecord;
    exported.scenario.contract.hash = '0'.repeat(64);
    expect(() => classifyAuthorityAttribution(exported)).toThrow('contract_mismatch');
  });

  it('rejects outputs that do not cover exactly the present actors', () => {
    const ep = new MultiActorEpisode(arm('none'), 'r');
    const ps = ep.prompts();
    expect(() => ep.act(Object.fromEntries(ps.slice(1).map((p) => [p.actorId, out({})])))).toThrow('outputs_must_cover_exactly_the_present_actors');
  });
});
