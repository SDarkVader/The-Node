// Explicit deterministic offline evaluation. No provider, key, network or spending access.
// Compile src + test/fixtures/rulesScenario.ts with rootDir .; pass that emitted root.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
if (args.length !== 1) throw Error('emitted_runtime_directory_required');
const runtime = resolve(args[0]);
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { memoryScenario, cautiousInquiry, idleDecision } = await load('test/fixtures/rulesScenario.js');
const { buildRulesAwareContext } = await load('src/agent/rulesAwareContext.js');
const { buildResponsesRequest } = await load('src/agent/responsesRequest.js');
const { evaluateOfflineProposal, INTERPRETATION_RUBRIC } = await load('src/agent/offlineRulesEvaluation.js');
const { evidenceHash } = await load('src/agent/replay.js');
const { createParticipantState, fixtureGenesis, stepParticipantState } = await load('src/agent/participantWorld.js');
const { DEFAULT_WORLD_CONFIG } = await load('src/world/world.js');
const { observe } = await load('src/server/observer.js');
const { bakerDailyIncome } = await load('src/engine/wealth.js');
const config = { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 };
const report = { kind: 'deterministic-offline-fixture-evaluation', providerRequests: 0,
  limitation: 'Handwritten fixture policies/rubric answers; no measured LLM reasoning improvement, overall game utility or strategic intelligence is claimed.',
  memory: { cases: 0, currentMemorySuccesses: 0, ablatedMemorySuccesses: 0, replayRestoredSuccesses: 0, realHeardEffects: 0, replayVerified: 0 },
};
const addressed = decision => decision.communication?.referent?.playerId;
for (const seed of [11, 24, 32, 47]) for (const target of [0, 1]) {
  const scenario = memoryScenario(seed, target), original = scenario.observation(), packet = buildRulesAwareContext(original);
  const ablated = structuredClone(original); ablated.projection.diary = [];
  const before = evidenceHash(scenario.state()), informed = cautiousInquiry(packet), blind = cautiousInquiry(buildRulesAwareContext(ablated));
  report.memory.cases++;
  report.memory.currentMemorySuccesses += Number(addressed(informed) === scenario.target);
  report.memory.ablatedMemorySuccesses += Number(addressed(blind) === scenario.target);
  report.memory.replayRestoredSuccesses += Number(addressed(cautiousInquiry(buildRulesAwareContext(scenario.restore()))) === scenario.target);
  if (evidenceHash(scenario.state()) !== before) throw Error('fixture_restore_diverged');
  report.memory.realHeardEffects += Number(scenario.advanceDecision(informed).effects.some(e => e.category === 'proximityHeard'));
  const final = evidenceHash(scenario.state()); scenario.restore();
  report.memory.replayVerified += Number(evidenceHash(scenario.state()) === final);
}
const scenario = memoryScenario(32, 0), observation = scenario.observation();
const answers = Object.entries(INTERPRETATION_RUBRIC).map(([question, x]) => ({ question, answer: x.answer, evidence: x.evidence }));
const correct = evaluateOfflineProposal(observation, { decision: idleDecision(), answers });
const unsupported = evaluateOfflineProposal(observation, { decision: idleDecision(), answers: answers.map(x => ({ ...x, evidence: '/evaluator/privateTruth' })) });
report.rubricSelfCheck = { total: correct.interpretation.total, scriptedCorrectAndSupported: correct.interpretation.supported, supportedWithForbiddenEvidence: unsupported.interpretation.supported };
const wire = buildResponsesRequest(observation, 'gpt-5.4-nano-2026-03-17');
report.socialWire = { bytes: Buffer.byteLength(wire.body), maxInputTokens: wire.maxInputTokens, encoding: JSON.parse(JSON.parse(wire.body).input[0].content[0].text).encoding ?? 'objects', recognition: observation.projection.recognition.length, diary: observation.projection.diary.length };
scenario.age(); report.memory.entriesAfterActualExpiry = scenario.restore().projection.diary.length;
report.priceTradeoffs = [0, 0.7, 2].map(price => {
  const s = createParticipantState(fixtureGenesis(32, config)), person = [...s.registry.people.values()].find(p => p.role === 'baker');
  const result = stepParticipantState(s, [{ person: person.id, epoch: person.roleEpoch, tick: 0, decision: { ...idleDecision(), role: { kind: 'bakerPrice', price } } }], [person.id]);
  const slot = result.state.world.bakers.find(x => x.buildingId === person.location);
  return { price, wealthAfterTick: slot.wealth, completions: result.state.world.completionStats[person.location]?.completions ?? 0,
    salesMarginAtUnitDemand: bakerDailyIncome(price, result.state.world.flourPrice, 1) };
});
console.log(JSON.stringify(report, null, 2));
if (report.memory.currentMemorySuccesses !== 8 || report.memory.ablatedMemorySuccesses !== 4 || report.memory.replayVerified !== 8 || report.memory.entriesAfterActualExpiry !== 0) throw Error('offline_acceptance_failed');
