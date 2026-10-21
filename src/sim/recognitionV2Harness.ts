/**
 * Recognition model v2 — pre-build simulation (A01 follow-up, 2026-10-21). Constraint 1:
 * simulate before trusting. v2 is specified in `src/eval/constructs/diaryContract.ts`
 * (`recognitionModel.v2`) and is NOT built; this harness measures candidate v2 rules before
 * any of them touches the kernel.
 *
 * HOW IT WORKS. Real participant-kernel episodes (`stepParticipantState`, the same pipeline
 * study 1 runs) are driven by scripted policies for the seven study actors. Each day's real
 * hearings are read from the kernel (`lastRumourEvents`, `lastProximityConversations`) and
 * replayed through a candidate rule into a SHADOW ledger. Nothing is written back: the kernel
 * keeps running recognition v1, so every episode here is byte-identical to what the kernel
 * would do anyway, and study 1's frozen inputs are untouched.
 *
 * WHAT IS MODELLED RATHER THAN MEASURED, FLAGGED. The validator refuses Grifter speech and
 * the kernel keeps Grifters out of the proximity graph, so the decided Grifter channels
 * (speak and hear proximity talk where they stand, hear Wall posts in their own district) are
 * reconstructed here from real positions with the kernel's own rules: talk is heard by
 * everyone within `commsProximityRange` (as `degradeForListener` does), and a district Wall
 * post reaches a Grifter with the kernel's base success chance (0.6) from a harness-owned RNG,
 * never the kernel's. Every such hearing carries `modelled: true`. Trades, deliveries and
 * campaign cooperation have no per-person record in the kernel, so no rule here credits them;
 * that gap is reported, not filled.
 */

import { DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { createParticipantState, fixtureGenesis, stepParticipantState, type CanonicalAction, type ParticipantState } from '../agent/participantWorld.js';
import { observerRef, personBody } from '../server/observer.js';
import { validateDecision, type Decision } from '../agent/protocol.js';
import { observe } from '../server/observer.js';
import { controlledPersons } from '../eval/constructs/diaryContract.js';
import { AUTHORITY_ATTRIBUTION_CONTRACT } from '../eval/constructs/authorityAttribution.js';
import { distance, proximityCloseness } from '../engine/space.js';
import { resolvedSubjects } from '../engine/identity.js';
import { mulberry32 } from './rng.js';

/** One actor's communication for a day. `about` is an actor id, or null for the room. */
export type Act = null | { kind: 'wall' } | { kind: 'talk'; about: string | null };
export type Policy = (day: number, actorId: string) => Act;

/**
 * `addressed`: the referent, AS THE LISTENER HEARD IT (the kernel corrupts it with distance), was
 * the listener. `addressedIntended`: the speaker actually addressed the listener.
 */
export interface Hearing {
  day: number; channel: 'wall' | 'talk'; hearer: string; source: string; closeness: number;
  addressed: boolean; addressedIntended: boolean; modelled: boolean;
}

export interface Episode {
  seed: number;
  days: number;
  /** actorId -> person id */
  persons: ReadonlyMap<string, string>;
  hearings: Hearing[];
  /** Every person located at genesis — the bystander population. */
  population: string[];
  /** actorId -> first day the person was no longer located (departure censors the actor). */
  departedOn: Map<string, number>;
  /** `${observer}>${subject}` -> first day the KERNEL's v1 ledger recognised the pair (all observers, controlled subjects). */
  kernelV1: Map<string, number>;
  /** Listeners per controlled utterance, to report how wide one "conversation" is. */
  talkAudience: number[];
  /** Per controlled actor, per day: role and position before that day's step (null once departed). */
  trace: Map<string, ({ role: string; x: number; y: number } | null)[]>;
}

const MODEL_WALL_SUCCESS = 0.6; // the kernel's Wall `baseSuccessChance`

const pairKey = (o: string, s: string) => `${o}>${s}`;

function located(s: ParticipantState) {
  return [...s.registry.people.values()].filter((p) => p.location !== null);
}
function districtOf(s: ParticipantState, pos: { x: number; y: number }) {
  return s.world.shard.districts.find((d) => d.plots.some((p) => p.x === pos.x && p.y === pos.y))?.id ?? null;
}

/** Runs one real participant-kernel episode under `policy` and records every hearing. */
export function runEpisode(seed: number, days: number, policy: Policy): Episode {
  const config = JSON.parse(JSON.stringify(DEFAULT_WORLD_CONFIG)) as typeof DEFAULT_WORLD_CONFIG;
  const range = config.commsProximityRange;
  let state = createParticipantState(fixtureGenesis(seed, config));
  const secret = state.genesis.observerSecret;
  const actors = AUTHORITY_ATTRIBUTION_CONTRACT.controlledActors;
  const persons = controlledPersons(state, actors);
  const subjects = new Set(persons.values());
  const population = located(state).map((p) => p.id);
  const rand = mulberry32((seed ^ 0x5eed_0002) >>> 0);
  const ep: Episode = { seed, days, persons, hearings: [], population, departedOn: new Map(), kernelV1: new Map(), talkAudience: [], trace: new Map(actors.map((a) => [a.actorId, []])) };

  for (let day = 0; day < days; day++) {
    const before = state;
    const bodies = new Map(located(before).map((p) => [p.id, personBody(before, p)]));
    const actions: CanonicalAction[] = [];
    const online: string[] = [];
    const modelledTalk: { speaker: string; target: string | null }[] = [];
    const kernelTarget = new Map<string, string | null>();
    const wallAuthors: string[] = [];
    const kernelTalkers: string[] = [];
    for (const { actorId } of actors) {
      const person = persons.get(actorId)!;
      const self = before.registry.people.get(person);
      if (!self || self.location === null) {
        if (!ep.departedOn.has(actorId)) ep.departedOn.set(actorId, day);
        ep.trace.get(actorId)!.push(null);
        continue;
      }
      const body = bodies.get(person)!;
      ep.trace.get(actorId)!.push({ role: body.role, x: body.x, y: body.y });
      online.push(person);
      const act = policy(day, actorId);
      const grifter = body.role === 'Grifter';
      if (act?.kind === 'talk' && grifter) { modelledTalk.push({ speaker: person, target: act.about === null ? null : persons.get(act.about)! }); continue; }
      if (act === null || grifter) continue;
      let communication: Decision['communication'];
      if (act.kind === 'wall') { communication = { kind: 'wallPost', state: 'hopeful' }; }
      else {
        const target = act.about === null ? null : persons.get(act.about)!;
        const present = target !== null && before.registry.people.get(target)?.location != null;
        kernelTarget.set(person, present ? target : null);
        communication = { kind: 'proximityUtterance', intent: 'inform', tone: 'warm', context: null,
          referent: present ? { kind: 'player', playerId: observerRef(secret, person, target!) } : { kind: 'room' } };
      }
      const decision = validateDecision({ move: null, communication, diary: null, role: null }, observe(before, person, secret).context);
      if (!decision) throw Error(`harness_built_an_invalid_decision:${actorId}`);
      actions.push({ person, epoch: self.roleEpoch, tick: day, decision });
      (act.kind === 'wall' ? wallAuthors : kernelTalkers).push(person);
    }
    const result = stepParticipantState(before, actions, online);
    state = result.state;
    const w = state.world;

    for (const e of w.lastRumourEvents) ep.hearings.push({ day, channel: 'wall', hearer: e.heardBy, source: e.heardFrom, closeness: e.clarity, addressed: false, addressedIntended: false, modelled: false });
    for (const e of w.lastProximityConversations) ep.hearings.push({ day, channel: 'talk', hearer: e.listenerId, source: e.heard.speakerId, closeness: e.heard.clarity,
      addressed: e.heard.referent.kind === 'player' && e.heard.referent.playerId === e.listenerId,
      addressedIntended: kernelTarget.get(e.heard.speakerId) === e.listenerId, modelled: false });
    for (const t of kernelTalkers) if (!w.lastProximityRejections.some((r) => r.speakerId === t)) {
      ep.talkAudience.push(w.lastProximityConversations.filter((e) => e.heard.speakerId === t).length);
    }

    // Modelled Grifter channels, from the same pre-step positions the kernel used. The kernel
    // rejects an utterance whose addressee is outside the proximity graph, which today includes
    // every Grifter; under v2 an addressed Grifter in range is present, so that utterance is
    // modelled as heard by everyone in range. Any other rejection stands.
    const grifterIds = [...bodies].filter(([, b]) => b.role === 'Grifter').map(([id]) => id);
    const rejected = new Set(w.lastProximityRejections.map((r) => r.speakerId));
    const inRange = (a: { x: number; y: number }, b: { x: number; y: number }) => proximityCloseness(distance(a, b), range);
    for (const speaker of kernelTalkers.filter((t) => rejected.has(t))) {
      const target = kernelTarget.get(speaker) ?? null;
      if (target !== null && bodies.get(target)?.role === 'Grifter' && inRange(bodies.get(speaker)!, bodies.get(target)!) !== null) {
        modelledTalk.push({ speaker, target });
      }
    }
    for (const { speaker, target } of modelledTalk) {
      const at = bodies.get(speaker)!;
      let n = 0;
      for (const [id, b] of bodies) {
        if (id === speaker) continue;
        const c = proximityCloseness(distance(at, b), range);
        if (c !== null) { ep.hearings.push({ day, channel: 'talk', hearer: id, source: speaker, closeness: c, addressed: id === target, addressedIntended: id === target, modelled: true }); n++; }
      }
      ep.talkAudience.push(n);
    }
    for (const g of grifterIds) {
      const at = bodies.get(g)!;
      for (const speaker of kernelTalkers) {
        if (rejected.has(speaker)) continue;
        const c = inRange(at, bodies.get(speaker)!);
        if (c !== null) ep.hearings.push({ day, channel: 'talk', hearer: g, source: speaker, closeness: c, addressed: kernelTarget.get(speaker) === g, addressedIntended: kernelTarget.get(speaker) === g, modelled: true });
      }
      const home = districtOf(before, at);
      for (const author of wallAuthors) {
        if (home === null || districtOf(before, bodies.get(author)!) !== home) continue;
        if (rand() < MODEL_WALL_SUCCESS) ep.hearings.push({ day, channel: 'wall', hearer: g, source: author, closeness: 1, addressed: false, addressedIntended: false, modelled: true });
      }
    }

    // Kernel v1 ground truth, for the shadow-ledger check.
    for (const o of population) {
      if (w.identityLedger.get(o) === undefined) continue;
      for (const s of resolvedSubjects(w.identityLedger, o)) {
        if (subjects.has(s) && !ep.kernelV1.has(pairKey(o, s))) ep.kernelV1.set(pairKey(o, s), day);
      }
    }
  }
  return ep;
}

/**
 * A candidate recognition rule over integer credit units. `exchangeWindow` set => the talk
 * credit is earned only when the subject also heard the observer within the window (a two-way
 * exchange); a one-way overheard utterance earns `overheard`. `addressedOnly` narrows a
 * qualifying utterance to one that addressed the hearer (referent = hearer, as heard).
 * `decayPerDay` makes the ledger leaky: each day a pair loses that many units before today's
 * credit is added.
 */
export interface Rule {
  id: string;
  threshold: number;
  wall: number;
  talk: number;
  overheard?: number;
  closenessWeighted?: boolean;
  exchangeWindow?: number;
  /** Talk credit requires direct address (and, with `exchangeWindow`, address back); other talk earns `overheard`. */
  addressedOnly?: boolean;
  /** With `addressedOnly`: judge address by the speaker's intent rather than by what the listener heard. */
  addressByIntent?: boolean;
  decayPerDay?: number;
}

/** First day each observer recognised each subject under `rule`; observers are the whole located population. */
export function resolve(ep: Episode, rule: Rule): Map<string, number> {
  const credit = new Map<string, number>();
  const lastHeard = new Map<string, number>();
  const firstDay = new Map<string, number>();
  const byDay = new Map<number, Hearing[]>();
  for (const h of ep.hearings) { const l = byDay.get(h.day) ?? []; l.push(h); byDay.set(h.day, l); }
  for (let day = 0; day < ep.days; day++) {
    const today = byDay.get(day) ?? [];
    const isAddressed = (h: Hearing) => rule.addressByIntent ? h.addressedIntended : h.addressed;
    for (const h of today) if (h.channel === 'talk' && (!rule.addressedOnly || isAddressed(h))) lastHeard.set(pairKey(h.hearer, h.source), day);
    if (rule.decayPerDay) for (const [k, v] of credit) credit.set(k, Math.max(0, v - rule.decayPerDay));
    for (const h of today) {
      if (h.hearer === h.source) continue;
      let units: number;
      if (h.channel === 'wall') units = rule.wall;
      else {
        const base = rule.closenessWeighted ? Math.round(rule.talk * h.closeness) : rule.talk;
        if (rule.addressedOnly && !isAddressed(h)) units = rule.overheard ?? 0;
        else if (rule.exchangeWindow === undefined) units = base;
        else {
          const back = lastHeard.get(pairKey(h.source, h.hearer));
          units = back !== undefined && back > day - rule.exchangeWindow ? base : (rule.overheard ?? 0);
        }
      }
      const k = pairKey(h.hearer, h.source);
      const v = (credit.get(k) ?? 0) + units;
      credit.set(k, v);
      if (v >= rule.threshold && !firstDay.has(k)) firstDay.set(k, day);
    }
  }
  return firstDay;
}

/** Days elapsed until recognition (day index + 1), or null if never within the episode. */
export function daysTo(resolved: ReadonlyMap<string, number>, ep: Episode, observerActor: string, subjectActor: string): number | null {
  const d = resolved.get(pairKey(ep.persons.get(observerActor)!, ep.persons.get(subjectActor)!));
  return d === undefined ? null : d + 1;
}

/** Fraction of the genesis population (excluding the subject) that has recognised `subjectActor` by the end. */
export function populationKnownFraction(resolved: ReadonlyMap<string, number>, ep: Episode, subjectActor: string): number {
  const s = ep.persons.get(subjectActor)!;
  const others = ep.population.filter((p) => p !== s);
  return others.filter((o) => resolved.has(pairKey(o, s))).length / others.length;
}

export const ROLE_ACTORS = ['baker-0', 'baker-1', 'miller-0', 'courier-0', 'investigator-0', 'importexport-0'] as const;

/** Scripted behaviour scenarios. A and B are the dealing pair. */
export const SCENARIOS: Record<string, { description: string; policy: Policy }> = {
  pair_daily: { description: 'A and B talk about each other every day; everyone else silent.',
    policy: (_d, a) => a === 'baker-0' ? { kind: 'talk', about: 'importexport-0' } : a === 'importexport-0' ? { kind: 'talk', about: 'baker-0' } : null },
  pair_alternate: { description: 'A and B talk about each other every other day; everyone else silent.',
    policy: (d, a) => d % 2 ? null : a === 'baker-0' ? { kind: 'talk', about: 'importexport-0' } : a === 'importexport-0' ? { kind: 'talk', about: 'baker-0' } : null },
  one_way: { description: 'A talks about B every day; B never speaks.',
    policy: (_d, a) => a === 'baker-0' ? { kind: 'talk', about: 'importexport-0' } : null },
  broadcast: { description: 'Every role holder posts to the Wall every day; nobody talks.',
    policy: (_d, a) => (ROLE_ACTORS as readonly string[]).includes(a) ? { kind: 'wall' } : null },
  room: { description: 'Every role holder speaks to the room every day.',
    policy: (_d, a) => (ROLE_ACTORS as readonly string[]).includes(a) ? { kind: 'talk', about: null } : null },
  grifter_pair: { description: 'The Grifter and A talk about each other every day (Grifter speech modelled).',
    policy: (_d, a) => a === 'grifter-0' ? { kind: 'talk', about: 'baker-0' } : a === 'baker-0' ? { kind: 'talk', about: 'grifter-0' } : null },
  mixed: { description: 'A and B talk every other day and post to the Wall on the others; every other role holder posts daily.',
    policy: (d, a) => a === 'baker-0' || a === 'importexport-0'
      ? (d % 2 ? { kind: 'wall' } : { kind: 'talk', about: a === 'baker-0' ? 'importexport-0' : 'baker-0' })
      : (ROLE_ACTORS as readonly string[]).includes(a) ? { kind: 'wall' } : null },
};

/**
 * Candidate rules measured in `docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md`. Units are
 * integers; `talk / threshold` = 1/10 puts daily two-way dealings at 10 days. These are the
 * simulated alternatives, not a calibrated production choice — that waits for the owner's
 * decisions recorded in the evidence note.
 */
export const CANDIDATE_RULES: readonly (Rule & { label: string })[] = [
  { id: 'v1', label: 'kernel today: heard Wall post = 1, threshold 5', threshold: 5, wall: 1, talk: 0 },
  { id: 'L', label: 'literal: every heard utterance counts', threshold: 100, wall: 2, talk: 10 },
  { id: 'C', label: 'literal, weighted by closeness', threshold: 100, wall: 2, talk: 20, closenessWeighted: true },
  { id: 'XR', label: 'co-speaking exchange, no address needed', threshold: 100, wall: 2, talk: 10, overheard: 1, exchangeWindow: 1 },
  { id: 'A1', label: 'addressed as heard, one-way', threshold: 100, wall: 2, talk: 10, overheard: 1, addressedOnly: true },
  { id: 'A2', label: 'addressed as heard, two-way within 2 days', threshold: 100, wall: 2, talk: 10, overheard: 1, addressedOnly: true, exchangeWindow: 2 },
  { id: 'I1', label: 'addressed by intent, one-way', threshold: 100, wall: 2, talk: 10, overheard: 1, addressedOnly: true, addressByIntent: true },
  { id: 'I2', label: 'addressed by intent, two-way within 2 days', threshold: 100, wall: 2, talk: 10, overheard: 1, addressedOnly: true, addressByIntent: true, exchangeWindow: 2 },
  { id: 'I1D', label: 'I1 with a leaky ledger (1 unit/day)', threshold: 120, wall: 2, talk: 14, overheard: 1, addressedOnly: true, addressByIntent: true, decayPerDay: 1 },
  { id: 'I2D', label: 'I2 with a leaky ledger (1 unit/day)', threshold: 120, wall: 2, talk: 14, overheard: 1, addressedOnly: true, addressByIntent: true, exchangeWindow: 2, decayPerDay: 1 },
];
