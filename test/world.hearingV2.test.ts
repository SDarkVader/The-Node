import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { createParticipantState, fixtureGenesis, stepParticipantState, type CanonicalAction, type ParticipantState } from '../src/agent/participantWorld.js';
import { observe, observerRef, personBody } from '../src/server/observer.js';
import { validateContext, validateDecision, type Decision, type DecisionContext } from '../src/agent/protocol.js';
import { mockDecisionSchema } from '../src/agent/mockProvider.js';
import { rejectionReasons } from '../src/eval/episode.js';
import { buildResponsesRequest, type AuthorizedObservation } from '../src/agent/responsesRequest.js';

/**
 * "Show who can hear" (owner decision 2026-10-21, recognition v2 only). The observation lists who
 * is within speaking range now; the validator refuses an address to anyone else; and moves take
 * effect after the day's speech, so an admitted address is heard unless someone leaves that day.
 */
const V2 = { ...DEFAULT_WORLD_CONFIG, recognition: 'v2' as const };
const SECRET = fixtureGenesis(0).observerSecret;
const located = (s: ParticipantState) => [...s.registry.people.values()].filter((p) => p.location !== null);
const idOf = (s: ParticipantState, observer: string, ref: string) =>
  located(s).find((p) => observerRef(SECRET, observer, p.id, 16) === ref)?.id;
const speech = (referent: { kind: 'room' } | { kind: 'player'; playerId: string }) =>
  ({ kind: 'proximityUtterance', intent: 'inform', tone: 'warm', referent, context: null });
const act = (s: ParticipantState, person: string, decision: Partial<Decision>): CanonicalAction => ({
  person, epoch: s.registry.people.get(person)!.roleEpoch, tick: s.world.tick,
  decision: { move: null, communication: null, diary: null, role: null, ...decision } as Decision,
});
function warm(seed: number, days = 3) {
  let s = createParticipantState(fixtureGenesis(seed, V2));
  for (let d = 0; d < days; d++) s = stepParticipantState(s, [], []).state; // housing places Grifters
  return s;
}

describe('who can hear (v2)', () => {
  it('the hearing list is exactly who the kernel delivers a room utterance to, for every speaker', () => {
    // `world.rng` is one mutable lineage, so each speaker gets its own identical state rebuilt from
    // genesis; stepping one state once per speaker would give each a different day. Same-day churn
    // (a departure, a refill, a Grifter taking a slot) legitimately changes who is there when speech
    // resolves, so anyone whose place changed in that run is left out of both sides.
    const speakers = located(warm(103)).map((p) => p.id);
    let compared = 0, nonEmpty = 0, churn = 0;
    for (const id of speakers) {
      const s = warm(103);
      const ctx = observe(s, id, SECRET).context;
      const r = stepParticipantState(s, [act(s, id, { communication: speech({ kind: 'room' }) })], [id]);
      const changed = new Set([...s.registry.people.keys()].filter((p) => s.registry.people.get(p)!.location !== r.state.registry.people.get(p)?.location));
      churn = Math.max(churn, changed.size);
      if (changed.has(id)) continue;
      const heardBy = r.state.world.lastProximityConversations.filter((e) => e.heard.speakerId === id).map((e) => e.listenerId).filter((p) => !changed.has(p)).sort();
      expect(heardBy).toEqual(ctx.hearingRefs!.map((ref) => idOf(s, id, ref)!).filter((p) => !changed.has(p)).sort());
      compared++; if (heardBy.length) nonEmpty++;
    }
    expect(compared).toBeGreaterThan(50);
    expect(nonEmpty).toBeGreaterThan(compared / 2);
    expect(churn).toBeLessThan(speakers.length / 10);
  });

  it('every admitted address is heard by its addressee over 40 days of talk, movement and churn', () => {
    let s = warm(211);
    let admitted = 0, heard = 0, churned = 0, moves = 0, movesApplied = 0, movesDropped = 0;
    for (let day = 0; day < 40; day++) {
      const actions: CanonicalAction[] = [];
      const addressed = new Map<string, string>();
      const moved = new Map<string, { x: number; y: number }>();
      for (const [i, p] of located(s).entries()) {
        const ctx = observe(s, p.id, SECRET).context;
        const hearing = ctx.hearingRefs!;
        const target = hearing.length ? hearing[(day + i) % hearing.length]! : null;
        const move = (day + i) % 3 === 0 && ctx.legalMoves.length ? ctx.legalMoves[(day * 7 + i) % ctx.legalMoves.length]! : null;
        const decision = { move, communication: speech(target ? { kind: 'player', playerId: target } : { kind: 'room' }) };
        expect(validateDecision({ diary: null, role: null, ...decision }, ctx)).not.toBeNull();
        actions.push(act(s, p.id, decision));
        if (target) addressed.set(p.id, idOf(s, p.id, target)!);
        if (move) moved.set(p.id, move);
      }
      const online = located(s).map((p) => p.id);
      const before = new Map(located(s).map((p) => [p.id, p.location]));
      const r = stepParticipantState(s, actions, online);
      const stayed = (id: string) => r.state.registry.people.get(id)?.location === before.get(id);
      for (const [speaker, addressee] of addressed) {
        admitted++;
        const got = r.state.world.lastProximityConversations.some((e) => e.listenerId === addressee && e.heard.speakerId === speaker);
        if (got) heard++;
        else { churned++; expect(stayed(speaker) && stayed(addressee)).toBe(false); }
      }
      for (const [person, target] of moved) {
        moves++;
        const applied = r.effects.some((e) => e.person === person && e.category === 'move');
        if (applied) {
          movesApplied++;
          const body = personBody(r.state, r.state.registry.people.get(person)!);
          expect({ x: body.x, y: body.y }).toEqual(target);
        } else { movesDropped++; expect(stayed(person)).toBe(false); }
      }
      s = r.state;
    }
    expect(admitted).toBeGreaterThan(1000);
    expect(heard + churned).toBe(admitted);
    expect(churned / admitted).toBeLessThan(0.02);
    expect(moves).toBeGreaterThan(300);
    expect(movesApplied + movesDropped).toBe(moves);
  });

  it('a present person out of range is refused by the validator, left out of the schema, and named in the rejection reason', () => {
    const s = warm(103);
    const speaker = located(s).find((p) => {
      const c = observe(s, p.id, SECRET).context;
      return c.hearingRefs!.length > 0 && c.presentRefs.some((r) => !c.hearingRefs!.includes(r));
    })!;
    const ctx = observe(s, speaker.id, SECRET).context;
    const far = ctx.presentRefs.find((r) => !ctx.hearingRefs!.includes(r))!;
    const near = ctx.hearingRefs![0]!;
    const proposal = (playerId: string) => ({ move: null, communication: speech({ kind: 'player', playerId }), diary: null, role: null });
    expect(validateDecision(proposal(near), ctx)).not.toBeNull();
    expect(validateDecision(proposal(far), ctx)).toBeNull();
    expect(rejectionReasons(proposal(far), ctx)).toEqual(['proximity_referent_out_of_range']);
    // A malformed utterance is still just invalid, whoever it names.
    expect(rejectionReasons({ ...proposal(far), communication: { ...speech({ kind: 'player', playerId: far }), tone: 'shouty' } }, ctx)).toEqual(['communication_invalid']);
    const enumOf = (schema: unknown): string[] => {
      const found: string[] = [];
      const visit = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const o = n as Record<string, unknown>;
        const playerId = (o.properties as Record<string, { enum: string[] }> | undefined)?.playerId;
        if (playerId) found.push(...playerId.enum);
        Object.values(o).forEach(visit);
      };
      visit(schema); return found;
    };
    expect(enumOf(mockDecisionSchema(ctx)).sort()).toEqual([...ctx.hearingRefs!].sort());
    // The observation shows the same list the validator enforces.
    expect((observe(s, speaker.id, SECRET).projection as { hearing: string[] }).hearing).toEqual(ctx.hearingRefs);
  });

  it('speech comes from where the speaker stood when observed; the move lands after it', () => {
    const s = warm(103);
    const range = s.world.config.commsProximityRange;
    // A speaker whose single legal step changes who can hear them, so the two positions are distinguishable.
    let found: { id: string; move: { x: number; y: number }; heardBefore: string[]; heardAfter: string[] } | undefined;
    for (const p of located(s)) {
      const ctx = observe(s, p.id, SECRET).context;
      const own = personBody(s, p);
      for (const move of ctx.legalMoves) {
        const near = (to: { x: number; y: number }) => located(s).filter((q) => q.id !== p.id && (() => { const b = personBody(s, q); return Math.abs(b.x - to.x) + Math.abs(b.y - to.y) <= range; })()).map((q) => q.id).sort();
        const heardBefore = near(own), heardAfter = near(move);
        if (JSON.stringify(heardBefore) !== JSON.stringify(heardAfter)) { found = { id: p.id, move, heardBefore, heardAfter }; break; }
      }
      if (found) break;
    }
    expect(found).toBeDefined();
    const { id, move, heardBefore } = found!;
    const r = stepParticipantState(s, [act(s, id, { move, communication: speech({ kind: 'room' }) })], [id]);
    const heardBy = r.state.world.lastProximityConversations.filter((e) => e.heard.speakerId === id).map((e) => e.listenerId).sort();
    expect(heardBy).toEqual(heardBefore);
    const body = personBody(r.state, r.state.registry.people.get(id)!);
    expect({ x: body.x, y: body.y }).toEqual(move);
    expect(r.effects).toContainEqual({ person: id, category: 'move' });
    // The next observation's hearing list is computed from the new position.
    const next = observe(r.state, id, SECRET).context.hearingRefs!.map((ref) => idOf(r.state, id, ref)!).sort();
    expect(next).toEqual(found!.heardAfter);
  });

  it('the request the model reads carries the same hearing list the validator enforces, or is refused', () => {
    const s = warm(103);
    const speaker = located(s).find((p) => observe(s, p.id, SECRET).context.hearingRefs!.length > 1)!;
    const honest = observe(s, speaker.id, SECRET) as unknown as AuthorizedObservation;
    const body = JSON.parse(buildResponsesRequest(honest, 'archived-test-model').body) as { input: { content: { text: string }[] }[] };
    const sent = JSON.parse(body.input[0]!.content[0]!.text) as { hearing?: string[]; observation?: { hearing: string[] } };
    expect(sent.hearing ?? sent.observation!.hearing).toEqual(honest.context.hearingRefs);
    const tampered = (edit: (o: { context: { hearingRefs?: string[] }; projection: { hearing?: string[] } }) => void) => {
      const o = structuredClone(honest) as unknown as { context: { hearingRefs?: string[] }; projection: { hearing?: string[] } };
      edit(o); return () => buildResponsesRequest(o as unknown as AuthorizedObservation, 'archived-test-model');
    };
    expect(tampered((o) => { o.projection.hearing = o.projection.hearing!.slice(1); })).toThrow('responses_observation_mismatch');
    expect(tampered((o) => { o.projection.hearing = [...o.projection.hearing!].reverse(); })).toThrow('responses_observation_mismatch');
    expect(tampered((o) => { delete o.projection.hearing; })).toThrow('responses_observation_mismatch');
    expect(tampered((o) => { o.context.hearingRefs = o.context.hearingRefs!.slice(1); })).toThrow('responses_observation_mismatch');
  });

  it('the context contract: v2 requires a unique hearing list drawn from those present, never self; v1 never carries one', () => {
    const base: DecisionContext = { tick: 1, selfRef: 'me', role: 'Courier', roleEpoch: 0, legalMoves: [], presentRefs: ['a', 'b'], knownSubjects: [] };
    expect(() => validateContext(base)).not.toThrow();
    expect(() => validateContext({ ...base, rules: 'v2', hearingRefs: ['a'] })).not.toThrow();
    expect(() => validateContext({ ...base, rules: 'v2', hearingRefs: [] })).not.toThrow();
    expect(() => validateContext({ ...base, rules: 'v2' })).toThrow('invalid_context');
    expect(() => validateContext({ ...base, hearingRefs: ['a'] })).toThrow('invalid_context');
    expect(() => validateContext({ ...base, rules: 'v2', hearingRefs: ['c'] })).toThrow('invalid_context');
    expect(() => validateContext({ ...base, rules: 'v2', hearingRefs: ['me'] })).toThrow('invalid_context');
    expect(() => validateContext({ ...base, rules: 'v2', hearingRefs: ['a', 'a'] })).toThrow('invalid_context');
    const v1 = createParticipantState(fixtureGenesis(103, DEFAULT_WORLD_CONFIG));
    const someone = located(v1)[0]!.id;
    const o = observe(v1, someone, SECRET);
    expect(Object.hasOwn(o.context, 'hearingRefs')).toBe(false);
    expect(Object.hasOwn(o.projection, 'hearing')).toBe(false);
    // v1 keeps addressing anyone present (unchanged rules).
    const far = o.context.presentRefs[o.context.presentRefs.length - 1]!;
    expect(validateDecision({ move: null, communication: speech({ kind: 'player', playerId: far }), diary: null, role: null }, o.context)).not.toBeNull();
  });
});
