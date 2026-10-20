import { responsesObservation, type AuthorizedObservation } from './responsesRequest.js';
import { describeRulesContext } from './rulesContext.js';

/** Same authorized projection as the provider wire. No history/config/evaluator argument. */
export function buildRulesAwareContext(observation: AuthorizedObservation) {
  const projection = responsesObservation(observation);
  return Object.freeze({ observation: projection, rules: describeRulesContext(projection) });
}
export type RulesAwareContext = ReturnType<typeof buildRulesAwareContext>;
