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
 *
 * OWNER STATEMENTS OF 2026-10-21 (second pass). Resolution can be lost while a trace remains
 * (`cap`, `loseBelow`: hysteresis); refusal is a remembered signal (`refusal`: an address the
 * addressee heard and did not answer within a day, as the addresser perceives it); role holders
 * must interact with customers (`customers` episode option, MODELLED: the kernel's demand is an
 * aggregate price-share count with no per-person purchase, so each customer model below is an
 * assumption about who buys from whom, drawn from a harness-owned RNG and flagged `modelled`);
 * deception is also interpretation (`intent`/`heardIntent` on every kernel talk hearing).
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
import type { Intent } from '../comms/proximityConversation.js';

/** One actor's communication for a day. `about` is an actor id, or null for the room; `intent` defaults to 'inform'. */
export type Act = null | { kind: 'wall' } | { kind: 'talk'; about: string | null; intent?: Intent };
export type Policy = (day: number, actorId: string) => Act;

/**
 * `addressed`: the referent, AS THE LISTENER HEARD IT (the kernel corrupts it with distance), was
 * the listener. `addressedIntended`: the speaker actually addressed the listener.
 */
export interface Hearing {
  day: number; channel: 'wall' | 'talk' | 'custom'; hearer: string; source: string; closeness: number;
  addressed: boolean; addressedIntended: boolean; modelled: boolean;
  /** Talk only: the intent the speaker chose, and the intent this listener heard. */
  intent?: Intent; heardIntent?: Intent;
}

/**
 * Who buys bread from whom — MODELLED, because the kernel has no per-person purchase. All three
 * keep the kernel's purchase cycle (each person is due one purchase per 7 days, wealth.ts) and
 * buy only from FILLED Bakers who are not themselves.
 *   mixed:   each day, probability 1/7, from a Baker drawn by the kernel's inverse-price share.
 *            This is the kernel's demand split taken per person, with no loyalty.
 *   loyal:   a regular Baker drawn once by price share (redrawn only if they stop being a Baker),
 *            visited weekly on a fixed weekday.
 *   nearest: the nearest Baker, visited weekly on a fixed weekday.
 * A purchase records two hearings: the customer meets the Baker and the Baker meets the customer.
 */
export type CustomerModel = 'none' | 'mixed' | 'loyal' | 'nearest';
export interface EpisodeOptions { customers?: CustomerModel }

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
  customers: CustomerModel;
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
export function runEpisode(seed: number, days: number, policy: Policy, options: EpisodeOptions = {}): Episode {
  const config = JSON.parse(JSON.stringify(DEFAULT_WORLD_CONFIG)) as typeof DEFAULT_WORLD_CONFIG;
  const range = config.commsProximityRange;
  let state = createParticipantState(fixtureGenesis(seed, config));
  const secret = state.genesis.observerSecret;
  const actors = AUTHORITY_ATTRIBUTION_CONTRACT.controlledActors;
  const persons = controlledPersons(state, actors);
  const subjects = new Set(persons.values());
  const population = located(state).map((p) => p.id);
  const rand = mulberry32((seed ^ 0x5eed_0002) >>> 0);
  const customers = options.customers ?? 'none';
  const shop = mulberry32((seed ^ 0x5eed_0003) >>> 0); // customer model only: never world.rng, never `rand`
  const regular = new Map<string, string>();
  const weekday = new Map<string, number>();
  const ep: Episode = { seed, days, persons, hearings: [], population, departedOn: new Map(), kernelV1: new Map(), talkAudience: [],
    trace: new Map(actors.map((a) => [a.actorId, []])), customers };

  for (let day = 0; day < days; day++) {
    const before = state;
    const bodies = new Map(located(before).map((p) => [p.id, personBody(before, p)]));
    const actions: CanonicalAction[] = [];
    const online: string[] = [];
    const modelledTalk: { speaker: string; target: string | null; intent: Intent }[] = [];
    const kernelTarget = new Map<string, string | null>();
    const kernelIntent = new Map<string, Intent>();
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
      if (act?.kind === 'talk' && grifter) {
        modelledTalk.push({ speaker: person, target: act.about === null ? null : persons.get(act.about)!, intent: act.intent ?? 'inform' });
        continue;
      }
      if (act === null || grifter) continue;
      let communication: Decision['communication'];
      if (act.kind === 'wall') { communication = { kind: 'wallPost', state: 'hopeful' }; }
      else {
        const target = act.about === null ? null : persons.get(act.about)!;
        const present = target !== null && before.registry.people.get(target)?.location != null;
        kernelTarget.set(person, present ? target : null);
        kernelIntent.set(person, act.intent ?? 'inform');
        communication = { kind: 'proximityUtterance', intent: act.intent ?? 'inform', tone: 'warm', context: null,
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
      addressedIntended: kernelTarget.get(e.heard.speakerId) === e.listenerId, modelled: false,
      intent: kernelIntent.get(e.heard.speakerId), heardIntent: e.heard.intent });
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
        modelledTalk.push({ speaker, target, intent: kernelIntent.get(speaker) ?? 'inform' });
      }
    }
    // Modelled speech is not distorted here, so a modelled listener hears the intended intent.
    for (const { speaker, target, intent } of modelledTalk) {
      const at = bodies.get(speaker)!;
      let n = 0;
      for (const [id, b] of bodies) {
        if (id === speaker) continue;
        const c = proximityCloseness(distance(at, b), range);
        if (c !== null) {
          ep.hearings.push({ day, channel: 'talk', hearer: id, source: speaker, closeness: c, addressed: id === target, addressedIntended: id === target, modelled: true, intent, heardIntent: intent });
          n++;
        }
      }
      ep.talkAudience.push(n);
    }
    for (const g of grifterIds) {
      const at = bodies.get(g)!;
      for (const speaker of kernelTalkers) {
        if (rejected.has(speaker)) continue;
        const c = inRange(at, bodies.get(speaker)!);
        if (c !== null) {
          const intent = kernelIntent.get(speaker);
          ep.hearings.push({ day, channel: 'talk', hearer: g, source: speaker, closeness: c, addressed: kernelTarget.get(speaker) === g,
            addressedIntended: kernelTarget.get(speaker) === g, modelled: true, intent, heardIntent: intent });
        }
      }
      const home = districtOf(before, at);
      for (const author of wallAuthors) {
        if (home === null || districtOf(before, bodies.get(author)!) !== home) continue;
        if (rand() < MODEL_WALL_SUCCESS) ep.hearings.push({ day, channel: 'wall', hearer: g, source: author, closeness: 1, addressed: false, addressedIntended: false, modelled: true });
      }
    }

    // Modelled customer purchases (see CustomerModel), from the same pre-step bodies and prices.
    if (customers !== 'none') {
      const bakers = [...bodies].filter(([, b]) => b.role === 'Baker' && b.price !== null).map(([id, b]) => ({ id, b }));
      const draw = (exclude: string) => {
        const pool = bakers.filter((k) => k.id !== exclude);
        const weights = pool.map((k) => 1 / Math.max(Number(k.b.price), 1e-6));
        let u = shop() * weights.reduce((a, x) => a + x, 0);
        for (let i = 0; i < pool.length; i++) { u -= weights[i]!; if (u <= 0) return pool[i]!.id; }
        return pool.at(-1)?.id ?? null;
      };
      const nearest = (q: string) => {
        const at = bodies.get(q)!;
        return bakers.filter((k) => k.id !== q).sort((x, y) => distance(at, x.b) - distance(at, y.b) || x.id.localeCompare(y.id))[0]?.id ?? null;
      };
      for (const q of bodies.keys()) {
        let baker: string | null = null;
        if (customers === 'mixed') { if (shop() < 1 / 7) baker = draw(q); }
        else {
          if (!weekday.has(q)) weekday.set(q, Math.floor(shop() * 7));
          const r = regular.get(q);
          if (r === undefined || bodies.get(r)?.role !== 'Baker' || r === q) {
            const pick = customers === 'loyal' ? draw(q) : nearest(q);
            if (pick !== null) regular.set(q, pick); else regular.delete(q);
          } else if (customers === 'nearest') regular.set(q, nearest(q) ?? r);
          if (day % 7 === weekday.get(q)) baker = regular.get(q) ?? null;
        }
        if (baker === null || baker === q) continue;
        ep.hearings.push({ day, channel: 'custom', hearer: q, source: baker, closeness: 1, addressed: false, addressedIntended: false, modelled: true });
        ep.hearings.push({ day, channel: 'custom', hearer: baker, source: q, closeness: 1, addressed: false, addressedIntended: false, modelled: true });
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
  /** Credit per modelled purchase, to both the customer and the Baker. */
  custom?: number;
  /**
   * Credit to an addresser whose address the addressee heard and did not answer (by direct
   * address back) that day or the next: the refusal as the addresser perceives it. Silence has
   * many causes (one communication a day, out of range, offline); the addresser cannot tell
   * them apart, so neither does this rule.
   */
  refusal?: number;
  /** Credit never exceeds this, so the time to lapse after contact stops is bounded. */
  cap?: number;
  /** Once resolved, resolution is lost only when credit falls below this (hysteresis). Default: `threshold`. */
  loseBelow?: number;
}

export interface LedgerRun {
  /** First day each pair was resolved (same meaning as `resolve`). */
  first: Map<string, number>;
  /** Resolved intervals per pair: [startDay, endDay] with endDay null if still resolved at the end. */
  intervals: Map<string, [number, number | null][]>;
  /** Credit per pair at the end of the episode. */
  credit: Map<string, number>;
}

/**
 * Replays an episode's hearings through `rule`. Each day: decay every pair, then credit today's
 * hearings in order (and yesterday's unanswered addresses), then apply loss. Without `cap`,
 * `refusal`, `custom` or `loseBelow` this is exactly the first-pass rule engine.
 */
export function runLedger(ep: Episode, rule: Rule): LedgerRun {
  const credit = new Map<string, number>();
  const lastHeard = new Map<string, number>();
  const first = new Map<string, number>();
  const intervals = new Map<string, [number, number | null][]>();
  const open = new Set<string>();
  const byDay = new Map<number, Hearing[]>();
  for (const h of ep.hearings) { const l = byDay.get(h.day) ?? []; l.push(h); byDay.set(h.day, l); }
  const isAddressed = (h: Hearing) => rule.addressByIntent ? h.addressedIntended : h.addressed;
  const addressesOn = (d: number) => (byDay.get(d) ?? []).filter((h) => h.channel === 'talk' && h.addressedIntended);
  const add = (k: string, units: number, day: number) => {
    const v = Math.min(rule.cap ?? Infinity, (credit.get(k) ?? 0) + units);
    credit.set(k, v);
    if (v >= rule.threshold) {
      if (!first.has(k)) first.set(k, day);
      if (!open.has(k)) { open.add(k); const l = intervals.get(k) ?? []; l.push([day, null]); intervals.set(k, l); }
    }
  };
  for (let day = 0; day < ep.days; day++) {
    const today = byDay.get(day) ?? [];
    for (const h of today) if (h.channel === 'talk' && (!rule.addressedOnly || isAddressed(h))) lastHeard.set(pairKey(h.hearer, h.source), day);
    if (rule.decayPerDay) for (const [k, v] of credit) credit.set(k, Math.max(0, v - rule.decayPerDay));
    for (const h of today) {
      if (h.hearer === h.source) continue;
      let units: number;
      if (h.channel === 'wall') units = rule.wall;
      else if (h.channel === 'custom') units = rule.custom ?? 0;
      else {
        const base = rule.closenessWeighted ? Math.round(rule.talk * h.closeness) : rule.talk;
        if (rule.addressedOnly && !isAddressed(h)) units = rule.overheard ?? 0;
        else if (rule.exchangeWindow === undefined) units = base;
        else {
          const back = lastHeard.get(pairKey(h.source, h.hearer));
          units = back !== undefined && back > day - rule.exchangeWindow ? base : (rule.overheard ?? 0);
        }
      }
      add(pairKey(h.hearer, h.source), units, day);
    }
    // Yesterday's addresses that went unanswered through today: the addresser perceives refusal.
    if (rule.refusal && day > 0) {
      const answered = new Set([...addressesOn(day - 1), ...addressesOn(day)].map((h) => pairKey(h.hearer, h.source)));
      const seen = new Set<string>();
      for (const h of addressesOn(day - 1)) {
        const k = pairKey(h.source, h.hearer); // the addresser learns about the addressee
        if (h.hearer === h.source || answered.has(k) || seen.has(k)) continue;
        seen.add(k);
        add(k, rule.refusal, day);
      }
    }
    for (const k of open) {
      if ((credit.get(k) ?? 0) < (rule.loseBelow ?? rule.threshold)) {
        open.delete(k);
        const l = intervals.get(k)!; l[l.length - 1]![1] = day;
      }
    }
  }
  return { first, intervals, credit };
}

/** First day each observer recognised each subject under `rule`; observers are the whole located population. */
export function resolve(ep: Episode, rule: Rule): Map<string, number> {
  return runLedger(ep, rule).first;
}

/** Who resolves `subjectActor` at the end of the episode (currently known, not ever known). */
export function currentlyKnownBy(run: LedgerRun, ep: Episode, subjectActor: string): string[] {
  const s = ep.persons.get(subjectActor)!;
  return [...run.intervals].filter(([k, l]) => k.endsWith(`>${s}`) && l.at(-1)![1] === null).map(([k]) => k.split('>')[0]!);
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
  pair_then_stop: { description: 'A and B address each other daily for 20 days, stop for 120, then resume for 20 (run 160 days).',
    policy: (d, a) => (d < 20 || (d >= 140 && d < 160)) ? (a === 'baker-0' ? { kind: 'talk', about: 'importexport-0' } : a === 'importexport-0' ? { kind: 'talk', about: 'baker-0' } : null) : null },
  refuse_reply: { description: 'A addresses B daily; B answers A daily with intent refuse.',
    policy: (_d, a) => a === 'baker-0' ? { kind: 'talk', about: 'importexport-0' } : a === 'importexport-0' ? { kind: 'talk', about: 'baker-0', intent: 'refuse' } : null },
  quiet: { description: 'Nobody speaks or posts (for the customer channel alone).', policy: () => null },
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

/**
 * Rules for the owner's statements of 2026-10-21, all on I1D's address-by-intent base (threshold
 * 120, talk 14, decay 1/day). `cap` and `loseBelow` bound the lapse: once contact stops, resolution
 * is lost after (cap - loseBelow)/decay days, and the credit left below `loseBelow` is the trace
 * that makes re-resolution faster than first resolution, until it too decays.
 */
const OWNER_BASE = { threshold: 120, wall: 2, talk: 14, overheard: 1, addressedOnly: true, addressByIntent: true, decayPerDay: 1, cap: 240, loseBelow: 60 } as const;
export const OWNER_RULES: readonly (Rule & { label: string })[] = [
  { id: 'O', label: 'I1D + cap 240 + lose below 60 (lapse 180 days after contact)', ...OWNER_BASE },
  { id: 'O-short', label: 'O with cap 150, lose below 90 (lapse 60 days)', ...OWNER_BASE, cap: 150, loseBelow: 90 },
  { id: 'O-R7', label: 'O + silent refusal worth half an address (7)', ...OWNER_BASE, refusal: 7 },
  { id: 'O-R14', label: 'O + silent refusal worth an address (14)', ...OWNER_BASE, refusal: 14 },
  { id: 'O-C14', label: 'O + a purchase worth one address (14)', ...OWNER_BASE, custom: 14 },
  { id: 'O-C45', label: 'O + a purchase worth about three addresses (45)', ...OWNER_BASE, custom: 45 },
];
