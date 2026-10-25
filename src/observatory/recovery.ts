/** Dispatch to the verifier for the recorded condition; never normalize incompatible wire evidence. */
import { recoverContinuation, type ContinuationEvent } from '../eval/continuationLedger.js';
import { recoverPerceptionContinuation } from './perceptionContinuation.js';
import { recoverFreshPerception } from './freshPerception.js';
export function recoverExperiment(events: readonly ContinuationEvent[], sourceRevision: string):
  ReturnType<typeof recoverContinuation> | ReturnType<typeof recoverFreshPerception> {
  if (events[0]?.data.sourceRevision !== sourceRevision) throw Error('observatory_source_revision');
  switch (events[0]?.kind) {
    case 'start': return recoverContinuation(events, sourceRevision);
    case 'perception_start': return recoverPerceptionContinuation(events, true);
    case 'perception_fresh_start': return recoverFreshPerception(events, true);
    default: throw Error('observatory_experiment_condition');
  }
}
export const eventType = (event: ContinuationEvent) => event.kind.startsWith('perception_') ? event.kind.slice('perception_'.length) : event.kind;
