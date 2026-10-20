import { describe, expect, it } from 'vitest';
import { evaluateOfflineProposal, INTERPRETATION_RUBRIC, resolveCurrentEvidence, type InterpretationAnswer } from '../src/agent/offlineRulesEvaluation.js';
import { buildRulesAwareContext } from '../src/agent/rulesAwareContext.js';
import { buildResponsesRequest } from '../src/agent/responsesRequest.js';
import { createParticipantState, fixtureGenesis, stepParticipantState } from '../src/agent/participantWorld.js';
import { observe } from '../src/server/observer.js';
import { evidenceHash } from '../src/agent/replay.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { bakerDailyIncome } from '../src/engine/wealth.js';
import { idleDecision, memoryScenario, cautiousInquiry } from './fixtures/rulesScenario.js';

const supportedAnswers = (): InterpretationAnswer[] => Object.entries(INTERPRETATION_RUBRIC).map(([question, x]) => ({ question: question as InterpretationAnswer['question'], answer: x.answer, evidence: x.evidence }));

describe('offline interpretation and evidence rubric', () => {
  it('separates declared interpretation, evidence support and valid decisions', () => {
    const s = memoryScenario(32, 0), observation = s.observation();
    const correct = evaluateOfflineProposal(observation, { decision: idleDecision(), answers: supportedAnswers() });
    expect(correct.interpretation).toMatchObject({ correct: 8, supported: 8, total: 8 });
    const unsupported = evaluateOfflineProposal(observation, { decision: idleDecision(), answers: supportedAnswers().map(a => ({ ...a, evidence: '/evaluator/privateTruth' })) });
    expect(unsupported.interpretation).toMatchObject({ correct: 8, supported: 0 });
    const naive = evaluateOfflineProposal(observation, { decision: { ...idleDecision(), role: { kind: 'bakerPrice', price: 99 } }, answers: supportedAnswers().map(a => ({ ...a, answer: 'certain_profit_or_truth' })) });
    expect(naive.schemaValid).toBe(false); expect(naive.interpretation.correct).toBe(0);
    const duplicate = evaluateOfflineProposal(observation, { decision: idleDecision(), answers: [...supportedAnswers(), supportedAnswers()[0]!] });
    expect(duplicate.interpretation.correct).toBe(7);
    const packet = buildRulesAwareContext(observation);
    for (const path of ['/world/seed', '/observation/__proto__', '/rules/constructor', '/observation/diary/999', '/observation/../seed', '/history/0']) expect(resolveCurrentEvidence(packet, path)).toBe(false);
  });
  it('reports legacy schema-valid diary composition separately from intended event-mark compliance', () => {
    const s = memoryScenario(32, 0), result = evaluateOfflineProposal(s.observation(), { answers: [], decision: { ...idleDecision(),
      diary: { subject: s.target, observation: 'sharedARumourFreely', reading: 'cantTellYet', context: null } } });
    expect(result.schemaValid).toBe(true); expect(result.intendedDiaryRulesCompatible).toBe(false);
    expect(evaluateOfflineProposal(s.observation(), { answers: [], decision: { ...idleDecision(), eventMark: 'invented-event' } }).schemaValid).toBe(false);
  });
});

describe('legitimate memory and continuity ablations', () => {
  it('improves a precisely defined follow-up task across counterbalanced cases without giving the policy historical or evaluator state', () => {
    let withMemory = 0, withoutMemory = 0, restored = 0, count = 0;
    for (const seed of [11, 24, 32, 47]) for (const target of [0, 1] as const) {
      const scenario = memoryScenario(seed, target), observation = scenario.observation();
      const before = evidenceHash(scenario.state()), packet = buildRulesAwareContext(observation);
      const ablated = structuredClone(observation); ablated.projection.diary = [];
      const informed = cautiousInquiry(packet, true), blind = cautiousInquiry(buildRulesAwareContext(ablated), true);
      // Grader knows the fixture's recorded encounter. Policy receives only current observer data.
      const addressed = (d: ReturnType<typeof cautiousInquiry>) => (d.communication?.referent as { playerId?: string })?.playerId;
      withMemory += Number(addressed(informed) === scenario.target); withoutMemory += Number(addressed(blind) === scenario.target); count++;
      expect(evaluateOfflineProposal(observation, { decision: informed, answers: [] }).schemaValid).toBe(true);
      expect(evaluateOfflineProposal(ablated, { decision: blind, answers: [] }).schemaValid).toBe(true);
      const reopened = buildRulesAwareContext(scenario.restore());
      expect(reopened).toEqual(packet); restored += Number(addressed(cautiousInquiry(reopened, true)) === scenario.target);
      expect(evidenceHash(scenario.state())).toBe(before);
      const effect = scenario.advanceDecision(informed);
      expect(effect.effects.some(e => e.category === 'proximityHeard')).toBe(true);
      expect(buildRulesAwareContext(scenario.restore())).toEqual(buildRulesAwareContext(scenario.observation()));
    }
    expect({ count, withMemory, withoutMemory, restored }).toEqual({ count: 8, withMemory: 8, withoutMemory: 4, restored: 8 });
  });
  it('keeps surviving current memory after replay, never rerolls on reads, and loses the advantage at real expiry', () => {
    const s = memoryScenario(32, 1), original = s.observation().projection.diary[0]!;
    expect(buildRulesAwareContext(s.restore()).rules.memory.entries).toBe(1);
    const before = evidenceHash(s.state());
    for (let i = 0; i < 5; i++) expect(s.observation().projection.diary[0]!.subject).toBe(original.subject);
    expect(evidenceHash(s.state())).toBe(before);
    // A queued write is created on the pre-step day, then aged at the next tick boundary.
    // It is already one day old in this first post-write observation; one further tick expires it.
    s.age();
    expect(buildRulesAwareContext(s.restore()).rules.memory.entries).toBe(0);
    const expired = s.observation(), without = structuredClone(expired); without.projection.diary = [];
    expect(cautiousInquiry(buildRulesAwareContext(expired), true)).toEqual(cautiousInquiry(buildRulesAwareContext(without), true));
  });
  it('does not revive prior role permissions or memories under another observer identity', () => {
    const s = memoryScenario(32, 0), first = s.observation(), oldPrice = { ...idleDecision(), role: { kind: 'bakerPrice', price: 0.7 } };
    const grifter = [...s.state().registry.people.values()].find(p => p.role === null)!;
    const current = { ...observe(s.state(), grifter.id, s.genesis.observerSecret), observationId: 'TEST-other-observer' };
    const packet = buildRulesAwareContext(current);
    expect(packet.observation.self.ref).not.toBe(first.context.selfRef); expect(packet.rules.memory.entries).toBe(0);
    expect(evaluateOfflineProposal(current, { decision: oldPrice, answers: [] }).schemaValid).toBe(false);
  });
});

describe('decision quality uses real consequences and explicit objectives', () => {
  it('keeps sales margin, completion and wealth separate instead of calling a higher balance victory', () => {
    const config = { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 };
    const metrics = [0, 0.7, 2].map(price => {
      const state = createParticipantState(fixtureGenesis(32, config)), p = [...state.registry.people.values()].find(x => x.role === 'baker')!;
      const observation = { ...observe(state, p.id, state.genesis.observerSecret), observationId: 'TEST-price-case' };
      const decision = { ...idleDecision(), role: { kind: 'bakerPrice' as const, price } };
      expect(evaluateOfflineProposal(observation, { decision, answers: [] }).schemaValid).toBe(true);
      const result = stepParticipantState(state, [{ person: p.id, epoch: p.roleEpoch, tick: 0, decision }], [p.id]);
      const slot = result.state.world.bakers.find(x => x.buildingId === p.location)!;
      return { price, wealth: slot.wealth, completion: result.state.world.completionStats[p.location!]?.completions ?? 0,
        priceApplied: result.effects.some(x => x.category === 'bakerPrice'), profitAtUnitDemand: bakerDailyIncome(price, result.state.world.flourPrice, 1) };
    });
    expect(metrics.every(m => m.priceApplied)).toBe(true);
    expect(metrics[0]!.profitAtUnitDemand).toBe(0); expect(metrics[0]!.wealth).toBeGreaterThan(0); // completion can pay even with no sales margin
    expect(metrics[1]!.profitAtUnitDemand).toBeGreaterThan(0);
    expect(new Set(metrics.map(m => m.wealth)).size).toBeGreaterThan(1);
    // No assertion that the fixture's best wealth, lowest heat or cheapest price is the game's best strategy.
  });
});
