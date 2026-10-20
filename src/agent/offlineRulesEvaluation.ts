import { validateDecision } from './protocol.js';
import type { AuthorizedObservation } from './responsesRequest.js';
import { buildRulesAwareContext, type RulesAwareContext } from './rulesAwareContext.js';

/** Offline interpretation rubric, not an LLM judge, winning strategy or provider runner. */
export const INTERPRETATION_RUBRIC = {
  station_heat: { answer: 'role_dependent_measure', evidence: '/rules/observations/heat' },
  tension_attribution: { answer: 'cause_and_actor_unknown', evidence: '/rules/observations/tension' },
  visible_identity: { answer: 'visibility_is_not_recognition', evidence: '/rules/observations/identity' },
  rumour_truth: { answer: 'uncertain_claim', evidence: '/rules/observations/rumours' },
  memory: { answer: 'mortal_impression_not_ground_truth', evidence: '/rules/memory/meaning' },
  null_price: { answer: 'normal_reaction', evidence: '/rules/actions/role/consequence' },
  diary_mark: { answer: 'unimplemented_legacy_append_only', evidence: '/rules/memory/gap' },
  wealth: { answer: 'metric_not_victory', evidence: '/rules/purpose' },
} as const;
export type InterpretationQuestion = keyof typeof INTERPRETATION_RUBRIC;
export interface InterpretationAnswer { question: InterpretationQuestion; answer: string; evidence: string }
export interface OfflinePolicyProposal { decision: unknown; answers: readonly InterpretationAnswer[] }

/** A source pointer is evidence only inside this exact current authorized packet.
 * It cannot open a file, inspect a prototype, query history or access evaluator state.
 */
export function resolveCurrentEvidence(packet: RulesAwareContext, pointer: string): boolean {
  if (typeof pointer !== 'string' || pointer.length > 256 || !/^\/(observation|rules)(\/[^/~]+)*$/.test(pointer)) return false;
  let value: unknown = packet;
  for (const key of pointer.slice(1).split('/')) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

export function evaluateOfflineProposal(observation: AuthorizedObservation, proposal: OfflinePolicyProposal) {
  const packet = buildRulesAwareContext(observation);
  const decision = validateDecision(proposal.decision, observation.context);
  const answers = Object.entries(INTERPRETATION_RUBRIC).map(([question, rule]) => {
    const submitted = proposal.answers.filter(a => a.question === question);
    const a = submitted[0];
    const correct = submitted.length === 1 && a?.answer === rule.answer;
    const supported = correct && a?.evidence === rule.evidence && resolveCurrentEvidence(packet, a.evidence);
    return { question, correct, supported };
  });
  return {
    version: 'node-offline-rules-evaluation-v1' as const,
    schemaValid: decision !== null,
    // Compatibility of a legacy action is reported separately from its core validity.
    intendedDiaryRulesCompatible: decision !== null && decision.diary === null,
    decision,
    interpretation: { correct: answers.filter(a => a.correct).length, supported: answers.filter(a => a.supported).length, total: answers.length, answers },
    limitations: 'Exact rubric answers/source citations test declared interpretation, not private reasoning or model intelligence. Gameplay consequences require actual kernel execution and separate task-specific metrics.',
  };
}
