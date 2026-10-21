import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MultiActorEpisode, multiScenarioById, type ActorPrompt, type MultiEpisodeRecord } from '../src/eval/multiActorEpisode.js';
import { classifyDiary, controlledPersons, diaryContractHash, DIARY_CONTRACT } from '../src/eval/constructs/diaryContract.js';
import { unpackObservation } from '../src/agent/observationTables.js';
import { createParticipantState, stepParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { observe, observerRef } from '../src/server/observer.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { AUTHORITY_ATTRIBUTION_CONTRACT } from '../src/eval/constructs/authorityAttribution.js';
import { evidenceHash, digest } from '../src/agent/replay.js';

/**
 * A01 diary contract (docs/research/DIARY_CONTRACT_A01.md). Scripted fixtures through the real
 * participant pipeline, on the study baseline (contract 1.1.0): recognition model v2 (direct
 * address and repeated dealings; Wall posts alone never resolve) with the Grifter gate open.
 */

const LONG = 40;
type View = { tick: number; self: { role: string }; city: { people: { ref: string }[] }; recognition: { ref: string }[]; rumours: { source: string }[]; diary: { subject: string; observation: string; reading: string; context: string | null }[] };
const viewOf = (p: ActorPrompt): View => {
  const o = JSON.parse(p.prompt.observation);
  return (o.encoding ? unpackObservation(o) : o) as View;
};
const decision = (diary: unknown, wall = false) => JSON.stringify({ move: null, communication: wall ? { kind: 'wallPost', state: 'hopeful' } : null, diary, role: null });
const entry = (subject: string, observation: string) => ({ subject, observation, reading: 'cantTellYet', context: null });

/**
 * Every actor, the Grifter included, addresses the next actor in a ring on odd days (so direct
 * address builds recognition under v2) and posts to the Wall on even days (so the diary has
 * rumours to be grounded in). `diaryFor` chooses the diary.
 */
const ACTORS = AUTHORITY_ATTRIBUTION_CONTRACT.controlledActors;
const genesis = fixtureGenesis(AUTHORITY_ATTRIBUTION_CONTRACT.design.seed, { ...DEFAULT_WORLD_CONFIG, ...AUTHORITY_ATTRIBUTION_CONTRACT.design.world });
const PERSONS = controlledPersons(createParticipantState(genesis), ACTORS);
const partnerRef = (actorId: string) => {
  const i = ACTORS.findIndex((a) => a.actorId === actorId), next = ACTORS[(i + 1) % ACTORS.length]!.actorId;
  return observerRef(genesis.observerSecret, PERSONS.get(actorId)!, PERSONS.get(next)!);
};
function run(diaryFor: (v: View, prev: View | undefined, p: ActorPrompt) => unknown, ticks = LONG) {
  const ep = new MultiActorEpisode({ ...multiScenarioById('authority_attribution_none'), ticks }, 'diary-test');
  const prev = new Map<string, View>();
  while (!ep.done) {
    const ps = ep.prompts();
    ep.act(Object.fromEntries(ps.map((p) => {
      const v = viewOf(p), tick = v.tick, partner = partnerRef(p.actorId);
      const d = diaryFor(v, prev.get(p.actorId), p);
      prev.set(p.actorId, v);
      if (typeof d === 'string') return [p.actorId, d];
      const communication = tick % 2 === 0 ? { kind: 'wallPost', state: 'hopeful' }
        : { kind: 'proximityUtterance', intent: 'inform', tone: 'warm', context: null,
          // A departed partner is no longer present: speak to the room instead of a refused address.
          referent: v.city.people.some((x) => x.ref === partner) ? { kind: 'player', playerId: partner } : { kind: 'room' } };
      return [p.actorId, JSON.stringify({ move: null, communication, diary: d, role: null })];
    })));
  }
  return ep.finish();
}
const faithful = (v: View) => {
  const known = v.recognition.map((r) => r.ref);
  if (!known.length) return null;
  const heard = known.find((k) => v.rumours.some((r) => r.source === k));
  return heard ? entry(heard, 'sharedARumourFreely') : entry(known[0]!, 'soughtMeOut');
};
const fabricated = (v: View, prev: View | undefined) => {
  const known = v.recognition.map((r) => r.ref);
  const silent = known.find((k) => !v.rumours.some((r) => r.source === k) && !(prev?.rumours ?? []).some((r) => r.source === k));
  return silent ? entry(silent, 'sharedARumourFreely') : null;
};

describe('A01 diary contract — machine-readable and pinned', () => {
  it('the committed JSON contract is exactly the code contract, with its hash', () => {
    const committed = JSON.parse(readFileSync('evals/contracts/diary.v1.json', 'utf8')) as { contract: unknown; hash: string };
    expect(committed.contract).toEqual(JSON.parse(JSON.stringify(DIARY_CONTRACT)));
    expect(committed.hash).toBe(diaryContractHash());
  });

  it('records the owner decisions and keeps the rules text for live models inactive', () => {
    expect(DIARY_CONTRACT.trespassReveal.shows).toEqual(['subject', 'observation', 'reading', 'context']);
    expect(DIARY_CONTRACT.recognitionModel.v2.sources.sharedDistrict.counts).toBe(false);
    expect(DIARY_CONTRACT.rulesTextActivation).toMatch(/^Inactive/);
  });
});

describe('measurement on real mechanics', () => {
  const faithfulRun = run((v) => faithful(v));
  const result = classifyDiary(JSON.parse(JSON.stringify(faithfulRun)));

  it('no day is eligible before a subject is recognised, and the Grifter gate is open', () => {
    for (const a of result.actors) expect(a.days[0]).toMatchObject({ outcome: 'not_applicable', reason: 'no_recognised_subject' });
    expect(result.actors.flatMap((a) => a.days).some((d) => d.reason === 'grifter_gate_pending')).toBe(false);
  });

  it('a diligent writer has adherence 1 over real eligible days, each write confirmed by the kernel, through role changes', () => {
    expect(result.actors.some((a) => a.eligibleDays > 0)).toBe(true);
    for (const a of result.actors) if (a.eligibleDays) expect(a.adherence).toBe(1);
    expect(result.counts.admitted_without_effect).toBe(0); // a diary entry belongs to the person, not the role episode
    expect(result.grounding.written).toBe(result.counts.written);
  });

  it('faithful entries citing a rumour are supported by the author\'s own view', () => {
    expect(result.grounding.observationSupported).toBeGreaterThan(0);
    expect(result.grounding.observationUnsupported).toBe(0);
  });

  it('a negligent writer is not_written on every eligible day', () => {
    const r = classifyDiary(JSON.parse(JSON.stringify(run(() => null))));
    expect(r.counts.written).toBe(0);
    expect(r.counts.not_written).toBeGreaterThan(0);
    expect(r.adherence).toBe(0);
  });

  it('a fabricated rumour claim is written (permitted) but reported unsupported, never as a lie', () => {
    const r = classifyDiary(JSON.parse(JSON.stringify(run((v, prev) => fabricated(v, prev)))));
    expect(r.grounding.observationUnsupported).toBeGreaterThan(0);
    expect(r.grounding.observationSupported).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/lie|deceiv|dishonest/i);
  });

  it('an entry about an unrecognised person is attempted_but_rejected; prose is unparseable', () => {
    const r = classifyDiary(JSON.parse(JSON.stringify(run((v, _p, p) => {
      if (!v.recognition.length) return null;
      return p.actorId === 'baker-0' ? entry('0'.repeat(64), 'soughtMeOut') : 'not json';
    }))));
    expect(r.actors.find((a) => a.actorId === 'baker-0')!.days.some((d) => d.outcome === 'attempted_but_rejected')).toBe(true);
    expect(r.counts.unparseable).toBeGreaterThan(0);
  });

  it('is a pure function of the exported record', () => {
    expect(classifyDiary(JSON.parse(JSON.stringify(faithfulRun)))).toEqual(result);
    expect(result.contract.hash).toBe(diaryContractHash());
  });

  it('study 1 episodes (6 days) give no eligible diary day: diary adherence there is structural, not behavioural', () => {
    const short = classifyDiary(JSON.parse(JSON.stringify(run((v) => faithful(v), 6))));
    expect(short.adherence).toBeNull();
    expect(short.counts.not_applicable + short.counts.censored_by_departure).toBe(short.actors.length * 6);
  });
});

describe('kernel invariants the contract relies on (today)', () => {
  // Replays a faithful-writer record and inspects real kernel state day by day.
  const record = run((v) => faithful(v)) as MultiEpisodeRecord;
  const states = [createParticipantState(record.tape.genesis)];
  for (const t of record.tape.ticks) states.push(stepParticipantState(states.at(-1)!, t.actions, t.online).state);
  const persons = controlledPersons(states[0]!, record.scenario.actors);
  const secret = record.tape.genesis.observerSecret;
  const firstWrite = record.events.find((e) => e.kind === 'kernel_effects' && (e.data as string[]).includes('diary'))!;
  const author = persons.get(firstWrite.actor!)!, t = firstWrite.tick;

  it('the written entry is visible to its owner the next day, gone after the two-day window, and to no one else', () => {
    expect(observe(states[t + 1]!, author, secret).projection.diary.length).toBeGreaterThan(0);
    for (const [, other] of persons) if (other !== author && states[t + 1]!.registry.people.get(other)?.location != null) {
      const theirs = observe(states[t + 1]!, other, secret).projection.diary;
      const mine = observe(states[t + 1]!, author, secret).projection.diary;
      expect(theirs.some((e) => mine.some((m) => JSON.stringify(m) === JSON.stringify(e)))).toBe(false);
    }
    const stored = states[t + 3]!.world.diary.get(author) ?? [];
    expect(stored.some((e) => e.createdOnDay === t)).toBe(false);
  });

  it('subject and context never drift; reading the diary changes nothing', () => {
    const at = (s: number) => (states[s]!.world.diary.get(author) ?? []).filter((e) => e.createdOnDay === t);
    expect(at(t + 1).length).toBeGreaterThan(0);
    for (const [a, b] of at(t + 1).map((e, i) => [e, at(t + 2)[i]] as const)) {
      if (!b) continue;
      expect(b.value.subject).toBe(a.value.subject);
      expect(b.value.context).toBe(a.value.context);
    }
    const before = evidenceHash(states[t + 1]!);
    observe(states[t + 1]!, author, secret); observe(states[t + 1]!, author, secret);
    expect(evidenceHash(states[t + 1]!)).toBe(before);
    expect(digest(states[t + 1]!.world.diary.get(author))).toBe(digest(states[t + 1]!.world.diary.get(author)));
  });
});
