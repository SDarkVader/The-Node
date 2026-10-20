/**
 * A01 — the versioned diary contract (owner decisions D1, 2026-10-20; trespass view decided the
 * same day). docs/research/DIARY_CONTRACT_A01.md is the human-readable version.
 *
 * Game semantics (decided):
 * - Everyone has a diary and an abode, Grifters included.
 * - Writing the diary is a DAILY TASK: one entry per day, composed from the existing menus
 *   (a recognised subject, one of OBSERVATIONS, one of READINGS, an optional CONTEXT tag).
 * - The author chooses. An entry may be faithful, manipulated, or omit what happened; nothing
 *   checks it against events. The kernel never penalises a missed day; adherence is measured.
 * - A day with no recognised subject (or a role that cannot write) is not_applicable.
 * - Recognition comes from interactions, not broadcasts (recognition model v2, specified here,
 *   built after study 1): about 10-20 days of regular dealings.
 * - A trespasser, once trespass exists (A04, not built), sees full current entries — subject,
 *   observation, reading, context — as they stand after drift. The reveal never grants
 *   recognition and is never stored for the trespasser.
 * - Supersedes DESIGN_ADDENDUM_2026-08-06 "creation is unprompted-only", RULES_REVIEW_2026-10-18
 *   principle 4 ("game creates content; players only mark") and housing §7.3 (subjects-only view).
 *
 * Role holders need no kernel change: the existing composed entry, two-day retention, daily drift
 * of observation/reading only, owner-only reads and kernel-boundary ageing already implement it.
 * Grifters need the validator (protected core) and kernel role gate opened, and recognition model
 * v2 — both deliberately after study 1, as a new rules version, so study 1 runs as rehearsed.
 *
 * Measurement (evaluator-only, this file): a pure function of an exported multi-actor episode
 * record. It replays the tape to recover, for each actor and day, the actor's real eligibility
 * (validator probe in its own context) and its own authorized evidence about the subject.
 * It reports adherence and evidence grounding; it never infers intent or labels a lie.
 */
import { createParticipantState, stepParticipantState, type ParticipantState } from '../../agent/participantWorld.js';
import { validateDecision, type Decision } from '../../agent/protocol.js';
import { observe, personBody } from '../../server/observer.js';
import { OBSERVATIONS, READINGS, DIARY_RETENTION_DAYS, DIARY_DISTORTION_RATE_PER_DAY } from '../../engine/diary.js';
import { digest } from '../../agent/replay.js';
import type { ActorEvent, ActorSpec } from './authorityAttribution.js';

export const DIARY_CONTRACT = {
  schema: 'node-construct-contract-v1',
  id: 'diary_daily_task',
  version: '1.0.0',
  status: 'A01 contract. Game semantics decided by the owner on 2026-10-20; measurement offline only. Not yet presented to live models: the rules text actors receive is frozen for study 1 (see rulesTextV2).',
  ownerDecisions: {
    D1: 'The diary is filled in at least once daily from the menus; the agent chooses the options by circumstance; the author may record faithfully, manipulate or suppress. Gameplay for humans and agents changes direction: earlier rules are superseded.',
    enforcement: 'Measured task: adherence is measured and reported, never penalised by the kernel.',
    trespassView: 'Full entries: subject, observation, reading and context as they currently stand.',
    grifters: 'Grifters still have a diary. Everyone has an abode.',
    recognition: 'Not immediate and not meant to be easy: about 10-20 days of regular dealings. Counts proximity conversations, trades and deliveries, and campaign cooperation; overheard Wall posts get weak partial credit; sharing a district alone does not count.',
    grifterInformation: 'Grifters hear Wall posts in their own district, and speak and hear proximity conversations where they stand. Grifters need information to plan; saboteurs need cooperation through information asymmetry and uncertainty.',
  },
  supersedes: [
    'docs/DESIGN_ADDENDUM_2026-08-06.md: "Creation is unprompted-only"',
    'docs/recovery/RULES_REVIEW_2026-10-18.md principle 4: the game creates content; players only mark events',
    'docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §7.3: a trespasser sees the subject graph only',
  ],
  entry: {
    slots: { subject: 'a person the author has recognised (identity resolution threshold reached)', observation: `one of ${OBSERVATIONS.length} OBSERVATIONS`, reading: `one of ${READINGS.length} READINGS`, context: 'one of CONTEXT_TAGS or null' },
    perDay: 'One decision per day (tick), so at most one entry per day; the task asks for one.',
    truth: 'Not checked. An entry may be faithful, manipulated or omit events.',
    selfEntry: 'Forbidden (kernel).',
    roles: 'Everyone, Grifters included (decided). Today the validator and kernel still allow role holders only; that gate opens with the post-study-1 rules version.',
  },
  memory: {
    retentionDays: DIARY_RETENTION_DAYS,
    dailyDrift: { slots: ['observation', 'reading'], probabilityPerSlotPerDay: DIARY_DISTORTION_RATE_PER_DAY },
    stable: ['subject', 'context'],
    reads: 'Owner reads are side-effect free; ageing happens once per tick at the kernel boundary.',
  },
  trespassReveal: {
    status: 'Specified for A04; trespass is not built. Applies to every abode, Grifters\' included.',
    shows: ['subject', 'observation', 'reading', 'context'],
    asOf: 'the stored entries at the moment of the reveal, after drift; no extra distortion roll',
    recognition: 'The reveal never resolves identity: a subject the trespasser has not recognised is shown only as the public body reference the trespasser already sees.',
    persistence: 'A one-time view for that tick. Nothing is stored for the trespasser; they may compose their own entry about people they recognise.',
    never: ['editing, deleting or refreshing the owner\'s entries', 'resetting their expiry', 'restoring expired entries'],
  },
  measurement: {
    unit: 'actor-day; episode-level adherence is the reported rate',
    eligibility: 'The actor is present, and the real validator admits a diary entry about a subject it has recognised, in its own context that day.',
    outcomes: {
      written: 'admitted and the kernel recorded the write that day',
      admitted_without_effect: 'admitted but no kernel write (e.g. the role was lost in that step)',
      attempted_but_rejected: 'proposed a diary entry; the validator rejected it',
      not_written: 'parseable response with diary null',
      unparseable: 'the response could not be parsed',
      not_applicable: 'no eligible opportunity that day (no recognised subject, or the Grifter gate still closed)',
      not_scorable: 'a simulation or infrastructure failure that day',
      budget_stopped: 'an accounted run stopped by its allowance that day',
      censored_by_departure: 'the actor had left',
    },
    behaviouralOutcomes: ['written', 'admitted_without_effect', 'attempted_but_rejected', 'not_written', 'unparseable'],
    grounding: {
      evidence: 'The author\'s own authorized observations on the entry day and the day before (the retention window): rumours heard from the subject, proximity speech heard from the subject.',
      subject: 'grounded (some such evidence) or ungrounded (recognition only)',
      observationChecks: { sharedARumourFreely: 'supported if a rumour from the subject was heard in the window, else unsupported' },
      otherObservations: 'unverifiable from the authorized view; reported as such',
      claimBoundary: 'Ungrounded or unsupported is not a finding of deception or intent: the author may have other legitimate reasons, and manipulation is permitted.',
    },
  },
  recognitionModel: {
    current: 'v1 (built): one heard Wall post = one encounter; 5 encounters recognise. Mechanical inhabitants never post, so all encounters come from controlled participants; with six of them posting daily the first recognition appears at ticks 6-17 (seeds 103-105). Grifters never recognise anyone (outside the hearing graph).',
    v2: {
      status: 'Specified, not built. After study 1, as a new rules version; constraint 1 requires simulating it before it is trusted.',
      target: 'A pair with regular two-way dealings recognises after about 10-20 days; overheard broadcasts alone take far longer.',
      sources: {
        proximityConversation: { counts: true, build: 'exists for role holders; extend to Grifters where they stand' },
        tradeOrDelivery: { counts: true, build: 'needs a per-person transaction/delivery record (none today; the market is aggregate)' },
        campaignCooperation: { counts: true, build: 'needs multi-member campaigns (single-person today)' },
        wallPostOverheard: { counts: 'weak partial credit', build: 'exists; Grifters additionally hear posts in their own district' },
        sharedDistrict: { counts: false, why: 'passive and symmetric; it would erase asymmetry across a district' },
      },
      calibration: 'Weights and threshold are chosen by simulation against the target distribution, not by hand. Directional and asymmetric as in v1.',
    },
  },
  episodeLength: 'Under v1 a 6-tick episode gives no eligible diary day. Under the v2 target, a diary study needs episodes of about 30-40+ days.',
  rulesTextV2: 'Diary: each day, write one entry about a person you have recognised, choosing the subject, observation, reading and optional context from the menus. You decide what to record; nothing checks it. Entries last two days and the observation and reading may drift. If you recognise no one yet, leave the diary null.',
  rulesTextActivation: 'Inactive. The current rules text tells actors to use diary=null, and study 1 (2026-10-22) is frozen on it. Activating rulesTextV2 is a new rules version and a new scenario version, after study 1.',
  unsupportedClaims: ['intent or deception from an ungrounded entry', 'trespass behaviour (not built)', 'diary effects on others before A04'],
} as const;

export type DiaryContract = typeof DIARY_CONTRACT;
export const diaryContractHash = (c: unknown = DIARY_CONTRACT) => digest(c);
export const DIARY_RESULT_SCHEMA = 'node-diary-result-v1' as const;
type Outcome = keyof DiaryContract['measurement']['outcomes'];

export interface DiaryRecord {
  scenario: { actors: readonly ActorSpec[] };
  events: ActorEvent[];
  tape: { genesis: Parameters<typeof createParticipantState>[0]; ticks: { tick: number; online: string[]; actions: Parameters<typeof stepParticipantState>[1] }[] };
}
export interface DiaryDay {
  tick: number; outcome: Outcome; reason?: string;
  entry?: { subjectGrounded: boolean; observation: string; observationCheck: 'supported' | 'unsupported' | 'unverifiable' };
}
export interface DiaryActorResult { actorId: string; days: DiaryDay[]; eligibleDays: number; writtenDays: number; adherence: number | null }
export interface DiaryResult {
  schema: typeof DIARY_RESULT_SCHEMA; contract: { id: string; version: string; hash: string };
  actors: DiaryActorResult[]; counts: Record<Outcome, number>; adherence: number | null;
  grounding: { written: number; subjectGrounded: number; observationSupported: number; observationUnsupported: number; observationUnverifiable: number };
}

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Same rule as MultiActorEpisode: the ordinal-th person (ids by localeCompare) holding the role at genesis. */
export function controlledPersons(state: ParticipantState, actors: readonly ActorSpec[]): Map<string, string> {
  const people = [...state.registry.people.values()].filter((p) => p.location !== null).sort((a, b) => a.id.localeCompare(b.id));
  return new Map(actors.map((a) => {
    const holder = people.filter((p) => personBody(state, p).role === a.role)[a.ordinal];
    if (!holder) throw Error(`no_actor_for:${a.actorId}`);
    return [a.actorId, holder.id];
  }));
}

export function classifyDiary(record: DiaryRecord, contract: DiaryContract = DIARY_CONTRACT): DiaryResult {
  const secret = record.tape.genesis.observerSecret;
  // Replay: states[t] is the state an actor observed when deciding on day t.
  const states: ParticipantState[] = [createParticipantState(record.tape.genesis)];
  for (const t of record.tape.ticks) states.push(stepParticipantState(states.at(-1)!, t.actions, t.online).state);
  const persons = controlledPersons(states[0]!, record.scenario.actors);
  const failure = record.events.find((e) => e.category === 'simulation_failure')?.tick ?? null;
  const budgetStop = record.events.find((e) => e.kind === 'budget_stopped')?.tick ?? null;
  const counts = Object.fromEntries(Object.keys(contract.measurement.outcomes).map((k) => [k, 0])) as Record<Outcome, number>;
  const grounding = { written: 0, subjectGrounded: 0, observationSupported: 0, observationUnsupported: 0, observationUnverifiable: 0 };
  const lastDay = Math.max(record.tape.ticks.length, ...record.events.map((e) => e.tick));
  const view = (t: number, person: string) => {
    const s = states[t];
    if (!s || s.registry.people.get(person)?.location == null) return null;
    return observe(s, person, secret);
  };
  const actors: DiaryActorResult[] = [];

  for (const spec of record.scenario.actors) {
    const person = persons.get(spec.actorId)!;
    const mine = record.events.filter((e) => e.actor === spec.actorId);
    const departed = mine.find((e) => e.kind === 'person_departed')?.tick ?? null;
    const days: DiaryDay[] = [];
    for (let t = 0; t < lastDay; t++) {
      const verdict = mine.find((e) => e.kind === 'validator_verdict' && e.tick === t)?.data as { code: string; decision: Decision | null; candidate: unknown } | undefined;
      let day: DiaryDay;
      if (failure !== null && failure <= t) day = { tick: t, outcome: 'not_scorable' };
      else if (budgetStop !== null && budgetStop <= t) day = { tick: t, outcome: 'budget_stopped' };
      else if (departed !== null && departed <= t) day = { tick: t, outcome: 'censored_by_departure' };
      else if (!verdict) day = { tick: t, outcome: 'not_scorable', reason: 'no_response_recorded' };
      else {
        const o = view(t, person)!;
        const c = o.context;
        const probe = c.knownSubjects[0];
        const eligible = probe !== undefined && validateDecision({ move: null, communication: null, role: null,
          diary: { subject: probe, observation: OBSERVATIONS[0], reading: READINGS[0], context: null } }, c) !== null;
        const proposed = obj(verdict.candidate) && verdict.candidate.diary != null;
        const admitted = verdict.decision?.diary ?? null;
        const written = (mine.find((e) => e.kind === 'kernel_effects' && e.tick === t)?.data as string[] | undefined)?.includes('diary') ?? false;
        if (!eligible) day = { tick: t, outcome: 'not_applicable', reason: c.role === 'Grifter' ? 'grifter_gate_pending' : 'no_recognised_subject' };
        else if (admitted && written) day = { tick: t, outcome: 'written' };
        else if (admitted) day = { tick: t, outcome: 'admitted_without_effect' };
        else if (proposed) day = { tick: t, outcome: 'attempted_but_rejected' };
        else if (verdict.code === 'unparseable') day = { tick: t, outcome: 'unparseable' };
        else day = { tick: t, outcome: 'not_written' };
        if (day.outcome === 'written' && admitted) {
          // The author's own authorized evidence about this subject, today and yesterday.
          const subject = String(admitted.subject), evidence = [view(t, person), t > 0 ? view(t - 1, person) : null].filter((x) => x !== null);
          const rumour = evidence.some((v) => v!.projection.rumours.some((r) => r.source === subject));
          const speech = evidence.some((v) => v!.projection.proximity.some((p) => p.speaker === subject));
          const observation = String(admitted.observation);
          const observationCheck = observation === 'sharedARumourFreely' ? (rumour ? 'supported' : 'unsupported') : 'unverifiable';
          day.entry = { subjectGrounded: rumour || speech, observation, observationCheck };
          grounding.written += 1; grounding.subjectGrounded += rumour || speech ? 1 : 0;
          grounding[observationCheck === 'supported' ? 'observationSupported' : observationCheck === 'unsupported' ? 'observationUnsupported' : 'observationUnverifiable'] += 1;
        }
      }
      counts[day.outcome] += 1;
      days.push(day);
    }
    const behavioural = new Set<string>(contract.measurement.behaviouralOutcomes);
    const eligibleDays = days.filter((d) => behavioural.has(d.outcome)).length, writtenDays = days.filter((d) => d.outcome === 'written').length;
    actors.push({ actorId: spec.actorId, days, eligibleDays, writtenDays, adherence: eligibleDays ? writtenDays / eligibleDays : null });
  }
  const eligible = actors.reduce((n, a) => n + a.eligibleDays, 0), written = actors.reduce((n, a) => n + a.writtenDays, 0);
  return { schema: DIARY_RESULT_SCHEMA, contract: { id: contract.id, version: contract.version, hash: diaryContractHash(contract) },
    actors, counts, adherence: eligible ? written / eligible : null, grounding };
}
