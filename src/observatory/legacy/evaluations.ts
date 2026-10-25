/**
 * Framework evaluation jobs for continuation evidence (observatory handover, 2026-10-23, step 4).
 *
 * These run as SEPARATE jobs, never inside the serving path. They consume a verified evidence
 * prefix and emit EvaluationRecords that name their producer, contract, definition, evidence
 * cursor and evaluated-through tick. The server only reads the resulting files.
 *
 * - Diary: the existing `classifyDiary` (contract diary_daily_task, A01), reached through a
 *   contract-aware bridge from ContinuationEvent records to its DiaryRecord input. No field is
 *   renamed blindly: each input the classifier reads is mapped from the continuation record that
 *   carries the same fact, and applicability is checked against the rules text the actors got.
 * - Authority attribution: applies only to runs with authority arms. A continuation plan has no
 *   notice input at all, so the classifier is recorded as not_applicable rather than given arms.
 * Nothing here scores reasoning quality, memory benefit, honesty or deception.
 */
import type { ContinuationEvent } from '../../eval/continuationLedger.js';
import type { StartEvidence } from '../../eval/continuationRunner.js';
import type { ActorEvent } from '../../eval/constructs/authorityAttribution.js';
import { classifyDiary, diaryContractHash, DIARY_CONTRACT, type DiaryRecord, type DiaryResult } from '../../eval/constructs/diaryContract.js';
import { contractHash as authorityContractHash, AUTHORITY_ATTRIBUTION_CONTRACT } from '../../eval/constructs/authorityAttribution.js';
import { EVALUATION_SCHEMA, validateEvaluationRecord, type EvaluationRecord, type EvidenceRef } from './contracts.js';
import type { ObservatoryExperiment } from './ledgerTail.js';

interface Through { cursor: string; eventHash: string; tick: number; ledgerRoot: string | null; refs: EvidenceRef[] }

/** The latest committed transition and the root of the newest sealed segment it lies in. */
function evaluatedThrough(experiment: ObservatoryExperiment): Through {
  const raw = experiment.rawEvents();
  const last = [...raw].reverse().find(x => x.event.kind === 'transition');
  if (!last) throw Error('observatory_nothing_committed');
  const segment = experiment.segments().find(s => s.segmentId === last.segmentId)!;
  const sealedRoots = experiment.segments().filter(s => s.sealed).map(s => s.segmentRoot);
  return { cursor: `${last.segmentId}:${last.event.seq}`, eventHash: last.event.hash, tick: last.event.data.nextTick,
    ledgerRoot: segment.sealed ? segment.segmentRoot : (sealedRoots.at(-1) ?? null),
    refs: [{ segmentId: last.segmentId, segmentRoot: segment.segmentRoot, seq: last.event.seq, eventHash: last.event.hash }] };
}

/** Contract-aware bridge: continuation evidence -> the diary classifier's own input. */
export function continuationDiaryRecord(experiment: ObservatoryExperiment): { record: DiaryRecord; rulesTextPresented: boolean; through: Through } {
  const raw = experiment.rawEvents().map(x => x.event);
  const starts = raw.filter(e => e.kind === 'start'), first = starts[0]!.data as StartEvidence;
  const through = evaluatedThrough(experiment);
  const personOf = new Map(first.identities.map(i => [i.person, i.actorId]));
  const events: ActorEvent[] = [];
  let seq = 0;
  const push = (actor: string | null, category: ActorEvent['category'], kind: string, tick: number, data: unknown) =>
    events.push({ seq: seq++, tick, category, kind, actor, data });
  const intents = new Map(raw.filter(e => e.kind === 'tick_intent').map(e => [e.data.tick as number, e.data]));
  const transitions = raw.filter(e => e.kind === 'transition');
  for (const t of transitions) {
    const d = t.data, proposals = intents.get(d.tick)?.proposals ?? {};
    for (const actorId of d.scheduledActors as string[]) {
      const v = d.verdicts[actorId];
      // validator_verdict as MultiActorEpisode records it: the code, the admitted decision and the candidate.
      push(actorId, 'observed', 'validator_verdict', d.tick, { code: v.code, decision: v.decision, candidate: proposals[actorId] });
    }
    for (const actorId of new Set((d.effects as { person: string }[]).map(e => personOf.get(e.person)).filter((a): a is string => !!a))) {
      push(actorId, 'observed', 'kernel_effects', d.tick, (d.effects as { person: string; category: string }[])
        .filter(e => personOf.get(e.person) === actorId).map(e => e.category));
    }
    const present = new Set((d.after as { actorId: string }[]).map(v => v.actorId));
    for (const { actorId } of d.before as { actorId: string }[]) if (!present.has(actorId)) push(actorId, 'observed', 'person_departed', d.nextTick, null);
  }
  const stop = [...raw].reverse().find(e => e.kind === 'stop');
  const status = String(stop?.data.summary.status ?? '');
  if (status === 'simulation_failure') push(null, 'simulation_failure', 'simulation_failure', stop!.data.summary.ticks, null);
  if (status.startsWith('budget_stopped')) push(null, 'observed', 'budget_stopped', stop!.data.summary.ticks, null);
  const requests = raw.filter(e => e.kind === 'request');
  const rulesTextPresented = requests.length > 0 && requests.every(r => String(JSON.parse(r.data.body).system).includes(DIARY_CONTRACT.rulesTextV2));
  const record: DiaryRecord = {
    scenario: { actors: first.plan.actors },
    events,
    tape: { genesis: first.genesis, ticks: transitions.map(t => ({ tick: t.data.tapeTick.tick, online: t.data.tapeTick.online, actions: t.data.tapeTick.actions })) },
  };
  return { record, rulesTextPresented, through };
}

const PRODUCER = { kind: 'framework' as const, name: 'diary_daily_task classifier (classifyDiary)', version: DIARY_CONTRACT.version };

export function diaryEvaluationRecords(experiment: ObservatoryExperiment, executorId: string, now = new Date()): { records: EvaluationRecord[]; result: DiaryResult | null } {
  const { record, rulesTextPresented, through } = continuationDiaryRecord(experiment);
  const experimentId = experiment.registration.experimentId, createdAt = now.toISOString();
  const base = { schema: EVALUATION_SCHEMA, experimentId, inputLedgerRoot: through.ledgerRoot, inputEventHash: through.eventHash,
    evaluatedThroughCursor: through.cursor, phase: 'evaluation' as const, producer: PRODUCER, executor: { kind: 'process' as const, id: executorId },
    contractHash: diaryContractHash(), createdAt, evaluatedThroughTick: through.tick, evidence: through.refs };
  if (!rulesTextPresented) {
    return { result: null, records: [validateEvaluationRecord({ ...base, evaluationId: `${experimentId}:diary:applicability`, status: 'not_applicable', value: null,
      reason: 'The actors were not given the contract rules text (rulesTextV2), so the diary task the contract measures was not presented.',
      scope: { startTick: 0, endTick: through.tick } })] };
  }
  const result = classifyDiary(record);
  const behavioural = new Set<string>(DIARY_CONTRACT.measurement.behaviouralOutcomes);
  const exclusions = (days: { outcome: string }[]) => Object.fromEntries([...new Set(days.map(d => d.outcome))]
    .filter(o => !behavioural.has(o)).map(o => [o, days.filter(d => d.outcome === o).length]));
  const adherenceDefinition = `${DIARY_CONTRACT.measurement.unit}. Eligibility: ${DIARY_CONTRACT.measurement.eligibility} Value = written days / days with a behavioural outcome (${DIARY_CONTRACT.measurement.behaviouralOutcomes.join(', ')}). Truth of an entry is not checked: ${DIARY_CONTRACT.entry.truth}`;
  const records: EvaluationRecord[] = result.actors.map(a => ({
    ...base, evaluationId: `${experimentId}:diary:adherence:${a.actorId}`, metricId: 'diary_adherence', metricVersion: DIARY_CONTRACT.version,
    definition: adherenceDefinition,
    status: a.eligibleDays ? 'scored' as const : 'not_applicable' as const, value: a.eligibleDays ? a.adherence : null, unit: 'ratio',
    numerator: a.writtenDays, denominator: a.eligibleDays, exclusions: exclusions(a.days),
    ...(a.eligibleDays ? {} : { reason: 'No eligible day: no recognised subject was available to this actor in the window.' }),
    scope: { actorId: a.actorId, startTick: 0, endTick: Math.max(0, through.tick - 1) },
  }));
  const g = result.grounding;
  records.push({ ...base, evaluationId: `${experimentId}:diary:subject_grounding`, metricId: 'diary_subject_grounding', metricVersion: DIARY_CONTRACT.version,
    definition: `${DIARY_CONTRACT.measurement.grounding.evidence} Value = grounded written entries / written entries. ${DIARY_CONTRACT.measurement.grounding.claimBoundary}`,
    status: g.written ? 'scored' : 'not_applicable', value: g.written ? g.subjectGrounded / g.written : null, unit: 'ratio',
    numerator: g.subjectGrounded, denominator: g.written,
    exclusions: { observation_supported: g.observationSupported, observation_unsupported: g.observationUnsupported, observation_unverifiable: g.observationUnverifiable },
    ...(g.written ? {} : { reason: 'No written entry in the window.' }),
    scope: { startTick: 0, endTick: Math.max(0, through.tick - 1) } });
  return { result, records: records.map(validateEvaluationRecord) };
}

/** The authority classifier needs authority arms; a continuation plan has none. */
export function authorityApplicability(experiment: ObservatoryExperiment, now = new Date()): EvaluationRecord {
  const through = evaluatedThrough(experiment), experimentId = experiment.registration.experimentId;
  const start = experiment.rawEvents()[0]!;
  return validateEvaluationRecord({
    schema: EVALUATION_SCHEMA, evaluationId: `${experimentId}:authority_attribution:applicability`, experimentId,
    inputLedgerRoot: through.ledgerRoot, inputEventHash: through.eventHash, evaluatedThroughCursor: through.cursor, phase: 'evaluation',
    producer: { kind: 'framework', name: 'authority_attribution classifier (classifyAuthorityAttribution)', version: AUTHORITY_ATTRIBUTION_CONTRACT.version },
    executor: { kind: 'process', id: 'observatory-evaluate applicability' }, status: 'not_applicable', value: null,
    reason: 'The continuation plan carries no notice or authority arm, and the continuation runner has no notice input; the classifier\'s council/anonymous/none comparison does not exist in this run.',
    contractHash: authorityContractHash(), scope: { startTick: 0, endTick: through.tick },
    evidence: [{ segmentId: start.segmentId, segmentRoot: experiment.segments()[0]!.segmentRoot, seq: 0, eventHash: start.event.hash }],
    createdAt: now.toISOString(), evaluatedThroughTick: through.tick,
  });
}

export type { ContinuationEvent };
