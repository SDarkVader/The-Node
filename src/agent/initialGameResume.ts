import type { InitialTestBudget } from './initialTestBudget.js';
import type { AuthorizedObservation } from './responsesRequest.js';

type BudgetView = ReturnType<InitialTestBudget['view']>;
/** Trusted operator report is evidence to compare with the journal, never authorization. */
export function assertInitialGameContinuation(view: BudgetView, report: unknown, observation: AuthorizedObservation, stateHash: string): void {
  const r = report as any, prior = r?.result, last = view.requests.at(-1);
  if (!view.canReserve || !view.authorization || !last?.receipt || last.bookedMicroUsd === null) throw Error('resume_budget_not_ready');
  if (prior?.status !== 'applied' || prior.replayVerified !== true || r.hostClosed !== true ||
      prior.requestId !== last.request.id || prior.model !== last.receipt.model ||
      prior.usage?.inputTokens !== last.receipt.inputTokens || prior.usage?.outputTokens !== last.receipt.outputTokens ||
      r.budget?.requests !== view.requests.length) throw Error('resume_report_not_latest_accounted_turn');
  if (observation.context.selfRef !== last.request.context.selfRef || prior.after?.ref !== observation.context.selfRef ||
      observation.context.tick !== last.request.context.tick + 1 || prior.tickAfter !== observation.context.tick ||
      prior.tickBefore !== last.request.context.tick) throw Error('resume_participant_or_tick_mismatch');
  if (!/^[a-f0-9]{64}$/.test(stateHash) || stateHash !== prior.completeStateHash ||
      stateHash !== prior.replayHash || stateHash !== r.afterStateHash) throw Error('resume_state_evidence_mismatch');
}
