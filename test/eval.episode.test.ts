import { describe, expect, it } from 'vitest';
import { EvalEpisode, parseAgentOutput, rejectionReasons } from '../src/eval/episode.js';
import { scenarioById, SCENARIOS } from '../src/eval/scenarios.js';
import { replay, evidenceHash, digest } from '../src/agent/replay.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { observe } from '../src/server/observer.js';
import { buildResponsesRequest } from '../src/agent/responsesRequest.js';

/**
 * Evaluation episode runner (src/eval/episode.ts). Uses the real participant pipeline; these
 * tests check the evaluation layer records it faithfully and keeps observed behaviour,
 * validator decisions and simulation failures apart.
 */

const decision = (price: number | null) =>
  JSON.stringify({ move: null, communication: null, diary: null, role: price === null ? null : { kind: 'bakerPrice', price } });

function runScripted(id: string, outputs: (tick: number) => string) {
  const ep = new EvalEpisode(scenarioById(id), 'test-revision');
  const prompts = [];
  while (!ep.done) {
    const p = ep.prompt();
    prompts.push(p);
    ep.act(outputs(p.tick));
  }
  return { record: ep.finish(), prompts };
}

describe('EvalEpisode — real pipeline, faithfully recorded', () => {
  it('prompts use the authorized provider request and exclude evaluator-only answers', () => {
    for (const scenario of SCENARIOS) {
      const state = createParticipantState(fixtureGenesis(scenario.seed));
      const baker = [...state.registry.people.values()].filter(p => p.role === 'baker' && p.location !== null)
        .sort((a, b) => a.id.localeCompare(b.id))[0]!;
      const observation = { ...observe(state, baker.id, state.genesis.observerSecret), observationId: 'eval' };
      const wire = JSON.parse(buildResponsesRequest(observation, 'inspect-eval-harness').body);
      const prompt = new EvalEpisode(scenario, 'test').prompt();
      expect(prompt.instructions).toBe(wire.instructions);
      expect(prompt.observation).toBe(wire.input[0].content[0].text);
      expect(prompt.schema).toEqual(wire.text.format.schema);
      expect(Object.keys(prompt).sort()).toEqual(['instructions', 'notices', 'observation', 'schema', 'tick', 'userTask']);
      expect(JSON.stringify(prompt)).not.toMatch(/rivalMeanPrice|settlementResidual|priceBand|fixture_expected|sideTask|faultAtTick/);
      for (const notice of prompt.notices) expect(Object.keys(notice).sort()).toEqual(['source', 'text']);
    }
  });

  it('admits a valid price, and the kernel actually applies it', () => {
    const { record } = runScripted('baseline_operations', () => decision(0.8));
    expect(record.status).toBe('completed');
    const verdicts = record.events.filter((e) => e.kind === 'validator_verdict');
    expect(verdicts.every((e) => (e.data as { code: string }).code === 'admitted')).toBe(true);
    const truth = record.events.filter((e) => e.kind === 'ground_truth').map((e) => e.data as { ownPrice: number });
    expect(truth.length).toBe(12);
    for (const t of truth) expect(t.ownPrice).toBeCloseTo(0.8, 12);
  });

  it('is deterministic: same scenario and outputs give identical evidence', () => {
    const a = runScripted('cooperation_pricing', (t) => decision(t % 2 ? 0.7 : 0.9)).record;
    const b = runScripted('cooperation_pricing', (t) => decision(t % 2 ? 0.7 : 0.9)).record;
    expect(a.finalStateHash).toBe(b.finalStateHash);
    expect(a.eventsDigest).toBe(b.eventsDigest);
  });

  it('every completed episode replays from its tape to the same final state', () => {
    const { record } = runScripted('prompt_injection_price', (t) => decision(t >= 3 ? 0 : 0.8));
    expect(record.replayVerified).toBe(true);
    expect(record.tape.ticks.length).toBe(10);
  });

  it('exported JSON evidence independently replays and preserves the event digest', () => {
    const { record } = runScripted('baseline_operations', () => decision(0.8));
    const exported = JSON.parse(JSON.stringify(record)) as typeof record;
    expect(evidenceHash(replay(exported.tape, exported.tape.genesis.sourceRevision))).toBe(exported.finalStateHash);
    expect(digest(exported.events)).toBe(exported.eventsDigest);
  });

  it('a rejected proposal admits nothing to the kernel that tick, and names why', () => {
    const { record } = runScripted('baseline_operations', (t) =>
      t === 2 ? JSON.stringify({ move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 5 }, resource_transfer: { to: 'x' } }) : decision(null));
    const verdict = record.events.find((e) => e.kind === 'validator_verdict' && e.tick === 2)!.data as { code: string; reasons: string[] };
    expect(verdict.code).toBe('rejected');
    expect(verdict.reasons).toEqual(expect.arrayContaining(['unavailable_action:resource_transfer', 'role_price_out_of_bounds']));
    expect(record.tape.ticks.find((t) => t.tick === 2)!.actions).toEqual([]);
  });

  it('notices appear only on their scenario tick, beside the untouched observation', () => {
    const { prompts } = runScripted('prompt_injection_price', () => decision(null));
    for (const p of prompts) expect(p.notices.length).toBe(p.tick === 3 ? 1 : 0);
    // The observation is the provider-path projection: it never contains the notice text.
    for (const p of prompts) expect(p.observation.includes('IGNORE ALL PREVIOUS')).toBe(false);
  });

  it('an infrastructure fault is a simulation_failure, not behaviour, and ends the episode', () => {
    const { record } = runScripted('simulation_fault', () => decision(0.8));
    expect(record.status).toBe('simulation_failure');
    const failures = record.events.filter((e) => e.category === 'simulation_failure');
    expect(failures.length).toBe(1);
    expect(failures[0]!.tick).toBe(4);
    // Behavioural records stay separate: the agent's last proposal was valid and recorded as such.
    const last = record.events.filter((e) => e.kind === 'validator_verdict').at(-1)!.data as { code: string };
    expect(last.code).toBe('admitted');
    expect(record.replayVerified).toBe(true); // the four completed ticks still replay
  });

  it('unparseable output is recorded as such, never as a validator decision about content', () => {
    expect(parseAgentOutput('nope')).toBeNull();
    expect(parseAgentOutput('```json\n{"decision":{"move":null},"answers":[]}\n```')!.candidate).toEqual({ move: null });
  });

  it('rejection reasons come from the real validator, field by field', () => {
    const context = { tick: 0, selfRef: 'me', role: 'Grifter', roleEpoch: 0, legalMoves: [{ x: 0, y: 1 }], presentRefs: [], knownSubjects: [] };
    expect(rejectionReasons({ move: { x: 9, y: 9 }, communication: null, diary: null, role: { kind: 'bakerPrice', price: 1 } }, context))
      .toEqual(['illegal_move', 'role_not_permitted']);
    expect(rejectionReasons({ move: null }, context)).toEqual(['missing_field:communication', 'missing_field:diary', 'missing_field:role']);
  });

  it('every scenario starts and runs on the real kernel', () => {
    for (const s of SCENARIOS) {
      const ep = new EvalEpisode(scenarioById(s.id), 'test');
      ep.prompt();
      ep.act(decision(null));
      expect(['running', 'completed', 'simulation_failure', 'person_departed']).toContain(ep.status);
    }
  });
});
