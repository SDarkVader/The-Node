/** Contract-aware continuation → A01 bridge. Reconstructs eligibility and grounding through
 * the existing classifier. Does not invent treatment arms or interpret returned reasoning. */
import { recoverContinuation, type ContinuationEvent } from '../eval/continuationLedger.js';
import { classifyDiary, type DiaryRecord } from '../eval/constructs/diaryContract.js';
import type { ActorEvent } from '../eval/constructs/authorityAttribution.js';
import type { EvaluationRecord } from './evaluations.js';
import { points } from './source.js';

export function evaluateContinuationDiary(events: readonly ContinuationEvent[], experimentId: string) {
  const verified = recoverContinuation(events, events[0]?.data.sourceRevision);
  if (!verified.complete || !verified.recovery.tape.ticks.length) throw Error('observatory_sealed_committed_input_required');
  const chain = points(events), eventLog: ActorEvent[] = [];
  const record = (tick: number, actor: string, kind: string, data: unknown) => {
    eventLog.push({ seq: eventLog.length, tick, category: 'observed', actor, kind, data });
  };
  for (const p of chain.filter(p => p.event.kind === 'transition')) {
    const t = p.event.data;
    for (const [actor, requestId] of Object.entries(t.requests)) {
      const request = chain.find(q => q.event.kind === 'request' && q.event.data.requestId === requestId);
      const validation = chain.find(q => q.event.kind === 'validation' && q.event.data.requestId === requestId)?.event.data;
      if (!request || !validation) throw Error('observatory_diary_join');
      record(t.tick, actor, 'validator_verdict', { code: validation.admitted ? 'admitted' : 'rejected',
        decision: validation.admitted, candidate: validation.proposed });
      const person = request.start.identities.find(a => a.actorId === actor)?.person;
      record(t.tick, actor, 'kernel_effects', t.effects.filter((e: { person: string }) => e.person === person).map((e: { category: string }) => e.category));
    }
    for (const before of t.before) if (!t.after.some((a: { actorId: string }) => a.actorId === before.actorId)) record(t.nextTick, before.actorId, 'person_departed', {});
  }
  const input: DiaryRecord = { scenario: { actors: verified.recovery.plan.actors }, events: eventLog, tape: verified.recovery.tape };
  const result = classifyDiary(input), p = chain.at(-1)!;
  const records: EvaluationRecord[] = result.actors.map(actor => {
    const exclusions: Record<string, number> = {};
    for (const day of actor.days) if (['not_applicable', 'not_scorable', 'budget_stopped', 'censored_by_departure'].includes(day.outcome)) exclusions[day.outcome] = (exclusions[day.outcome] ?? 0) + 1;
    return { schema: 'node-observatory-evaluation-v1', phase: 'evaluation',
      evaluationId: `a01-${actor.actorId}-${p.event.hash.slice(0, 16)}`, experimentId,
      inputLedgerRoot: verified.ledgerRoot, inputEventHash: p.event.hash, evaluatedThroughCursor: p.cursor,
      evaluatedThroughTick: verified.recovery.tape.ticks.length,
      producer: { kind: 'declared_metric', name: 'NODE A01 classifyDiary', version: result.contract.version },
      executor: { kind: 'process', id: 'node.observatory.diaryEvaluation' },
      metricId: 'diary_daily_adherence', metricVersion: '1', contractHash: result.contract.hash,
      definition: 'Kernel-confirmed written actor-days divided by eligible behavioural actor-days. Eligibility and evidence grounding reconstructed by the unchanged A01 classifier from the original participant tape. Unscheduled, not applicable, failed and departed days are excluded and counted. Entries are authored impressions; this is not a truth, deception or reasoning-quality score.',
      status: actor.adherence === null ? 'not_applicable' : 'scored', value: actor.adherence,
      unit: 'fraction', numerator: actor.writtenDays, denominator: actor.eligibleDays, exclusions,
      scope: { actorId: actor.actorId, startTick: 0, endTick: verified.recovery.tape.ticks.length },
      evidence: chain.filter(q => ['transition', 'stop'].includes(q.event.kind)).map(q => ({ segmentId: q.segmentId, seq: q.event.seq, eventHash: q.event.hash })),
      createdAt: new Date().toISOString() };
  });
  return { input, result, records };
}
