import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World, type PendingProximityUtterance } from '../src/world/world.js';
import { stepRecognition, emptyRecognitionState, resolvedBy, wallExposure, RECOGNITION_THRESHOLD, PASSIVE_CEILING, type Interaction, type RecognitionState } from '../src/engine/recognition.js';
import { chooseRegular, dealingPairs, type DealingEvent } from '../src/engine/dealings.js';
import { FLOUR_PER_BREAD, GRAIN_PER_FLOUR, PARCELS_PER_COURIER_DAY } from '../src/engine/resources.js';
import { DAILY_ACTIVITY_MULTIPLIER } from '../src/engine/wealth.js';
import { createParticipantState, fixtureGenesis, stepParticipantState } from '../src/agent/participantWorld.js';
import { observe } from '../src/server/observer.js';
import { digest, evidenceHash, newTape, replay } from '../src/agent/replay.js';
import { identityTransitionMessages, personHandle } from '../src/server/worldProtocol.js';
import { PRESSURE_CLUSTER_STATES } from '../src/engine/pressureDetection.js';

/**
 * Recognition v2 and individual dealings (engine/recognition.ts, engine/dealings.ts), opt-in via
 * `config.recognition = 'v2'`. Plain-mode identities are slot ids (buildingId / grifter id);
 * participant-mode identities are person ids.
 */

const V2 = { ...DEFAULT_WORLD_CONFIG, recognition: 'v2' as const };
const ids = (w: World) => ({
  filled: [...w.millers, ...w.bakers, ...w.couriers, ...w.investigators, ...w.importExporters].filter((s) => s.slot.state === 'FILLED'),
});
const addr = (speakerId: string, to: string | null, intent: PendingProximityUtterance['intent'] = 'inform'): PendingProximityUtterance =>
  ({ speakerId, intent, tone: 'warm', referent: to === null ? { kind: 'room' } : { kind: 'player', playerId: to } });
const resolved = (w: World, o: string, s: string) => resolvedBy(w.recognitionV2!.recognition.ledger, o).has(s);

/** Steps a plain v2 world, queueing `talk(day)` utterances each day; records every dealing. */
function run(w: World, days: number, talk: (day: number) => PendingProximityUtterance[] = () => []) {
  const dealt: DealingEvent[] = [];
  const changes: Array<{ day: number; gained: [string, string][]; lost: [string, string][] }> = [];
  for (let d = 0; d < days; d++) {
    w = stepWorld({ ...w, pendingProximityUtterances: talk(w.tick) });
    dealt.push(...w.lastDealings!);
    changes.push({ day: w.tick - 1, ...w.lastRecognitionChanges! });
  }
  return { w, dealt, changes };
}

/** Three FILLED non-Baker role holders within speaking range of each other, none of whom deal with another. */
function trio(w: World) {
  const range = w.config.commsProximityRange;
  const pool = [...w.couriers, ...w.investigators].filter((s) => s.slot.state === 'FILLED');
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= range;
  for (const a of pool) for (const b of pool) for (const c of pool) {
    if (new Set([a.buildingId, b.buildingId, c.buildingId]).size === 3 && near(a, b) && near(a, c) && near(b, c)) return [a.buildingId, b.buildingId, c.buildingId] as const;
  }
  throw Error('no_trio');
}
const dealtBetween = (dealt: DealingEvent[], a: string, b: string) =>
  dealt.some((e) => [e.provider, e.recipient, e.sender].includes(a) && [e.provider, e.recipient, e.sender].includes(b));

describe('v1 stays untouched', () => {
  it('without the flag there is no v2 state on the world', () => {
    let w = createWorld(7);
    w = stepWorld(w);
    for (const k of ['recognitionV2', 'lastDealings', 'lastRecognitionChanges']) expect(Object.hasOwn(w, k)).toBe(false);
    expect('recognition' in DEFAULT_WORLD_CONFIG).toBe(false);
  });
});

describe('recognition ledger (pure)', () => {
  const S = (state: RecognitionState, day: number, xs: Interaction[]) => stepRecognition(state, day, xs).state;
  const deal = (o: string, s: string): Interaction => ({ observer: o, subject: s, kind: 'dealing' });

  it('an anonymous purchase, or one purchase at each of many shops, never resolves anyone', () => {
    let st = S(emptyRecognitionState(), 0, [deal('cust', 'bakerA')]);
    expect(resolvedBy(st.ledger, 'cust').size).toBe(0);
    expect(st.ledger.get('cust')!.get('bakerA')!.credit).toBeLessThanOrEqual(PASSIVE_CEILING);
    st = emptyRecognitionState();
    for (let d = 0; d < 60; d++) st = S(st, d, d % 7 === 0 ? [deal('cust', `baker${d}`)] : []);
    expect(resolvedBy(st.ledger, 'cust').size).toBe(0);
  });

  it('a regular weekly customer and their Baker recognise each other on the third visit', () => {
    let st = emptyRecognitionState();
    let day = -1;
    for (let d = 0; d < 30 && day < 0; d++) {
      const t = stepRecognition(st, d, d % 7 === 0 ? [deal('cust', 'baker'), deal('baker', 'cust')] : []);
      st = t.state;
      if (t.gained.length) day = d;
    }
    expect(day).toBe(14);
    expect(resolvedBy(st.ledger, 'baker').has('cust')).toBe(true);
  });

  it('passive channels (room speech, overheard talk, the Wall) never resolve on their own', () => {
    let st = emptyRecognitionState();
    for (let d = 0; d < 400; d++) st = S(st, d, [{ observer: 'o', subject: 's', kind: 'overheard' }, { observer: 'o', subject: 's', kind: 'wall' }]);
    expect(st.ledger.get('o')!.get('s')!.credit).toBeLessThan(RECOGNITION_THRESHOLD);
    expect(resolvedBy(st.ledger, 'o').size).toBe(0);
  });

  it('resolution lapses about 60 days after contact stops, and residual familiarity speeds re-resolution', () => {
    let st = emptyRecognitionState();
    const events: string[] = [];
    for (let d = 0; d < 160; d++) {
      const t = stepRecognition(st, d, d < 20 || d >= 140 ? [{ observer: 'b', subject: 'a', kind: 'address' }] : []);
      st = t.state;
      for (const g of t.gained) events.push(`gained@${d}:${g.join('>')}`);
      for (const l of t.lost) events.push(`lost@${d}:${l.join('>')}`);
    }
    // 14+13d >= 120 at d=9; 150 - 61 < 90 at d=80 (61 days after the last address on day 19); residual 29 + 14 + 13*6 at d=146.
    expect(events).toEqual(['gained@9:b>a', 'lost@80:b>a', 'gained@146:b>a']);
  });

  it('the regular chain keeps the current choice except on a switch, and always returns a live option', () => {
    const opts = [{ key: 'x', weight: 1 }, { key: 'y', weight: 3 }];
    expect(chooseRegular('x', opts, 0.9, 0.99)).toBe('x');
    expect(chooseRegular('x', opts, 0.1, 0.99)).toBe('y');
    expect(chooseRegular('gone', opts, 0.9, 0.0)).toBe('x');
    expect(chooseRegular(undefined, [{ key: 'z', weight: 0 }], 0.5, 0.5)).toBeNull();
  });
});

describe('directed interaction on the real kernel (plain mode)', () => {
  const w0 = createWorld(7, V2);
  const [A, B, C] = trio(w0);

  it('the addressee recognises the speaker; a silent bystander and the unanswered speaker do not', () => {
    const { w, dealt } = run(w0, 20, () => [addr(A, B)]);
    expect(dealtBetween(dealt, A, B) || dealtBetween(dealt, A, C) || dealtBetween(dealt, B, C)).toBe(false);
    expect(resolved(w, B, A)).toBe(true);
    expect(resolved(w, C, A)).toBe(false); // heard every word, never addressed
    expect(resolved(w, A, B)).toBe(false); // spoke daily, was never answered
  });

  it('an explicit refusal is an interaction: the refused speaker recognises the refuser', () => {
    const { w } = run(w0, 20, () => [addr(A, B), addr(B, A, 'refuse')]);
    expect(resolved(w, A, B)).toBe(true);
    expect(resolved(w, B, A)).toBe(true);
    expect(resolved(w, C, A) || resolved(w, C, B)).toBe(false);
  });

  it('general room speech resolves nobody', () => {
    const { w } = run(w0, 40, () => [addr(A, null), addr(B, null)]);
    expect(resolved(w, B, A) || resolved(w, A, B) || resolved(w, C, A)).toBe(false);
  });

  it('lapse after contact stops is reported, the person reference never changes, and contact restores it', () => {
    const first = run(w0, 20, () => [addr(A, B)]);
    const silent = run(first.w, 70);
    const lost = silent.changes.find((c) => c.lost.some(([o, s]) => o === B && s === A));
    expect(lost).toBeDefined();
    expect(resolved(silent.w, B, A)).toBe(false);
    expect(silent.w.recognitionV2!.recognition.ledger.get(B)!.get(A)!.credit).toBeGreaterThan(0); // residual familiarity
    const back = run(silent.w, 10, () => [addr(A, B)]);
    const regained = back.changes.find((c) => c.gained.some(([o, s]) => o === B && s === A))!;
    expect(regained.day - silent.w.tick).toBeLessThan(9); // faster than first contact (day 9)
  });
});

describe('Grifters take part in permitted encounters (plain mode)', () => {
  it('Grifters are addressable, can speak in the kernel, buy bread and hear their district Wall', () => {
    let w = createWorld(7, V2);
    w = run(w, 3).w; // housing assigns Grifter positions and districts
    const g = w.grifters.find((x) => x.districtId)!;
    const range = w.config.commsProximityRange;
    const r = ids(w).filled.find((s) => Math.abs(s.x - g.x) + Math.abs(s.y - g.y) <= range && s.buildingId !== g.id)!;
    const talk = run(w, 12, () => [addr(r.buildingId, g.id), addr(g.id, r.buildingId)]);
    expect(resolved(talk.w, g.id, r.buildingId)).toBe(true);
    expect(resolved(talk.w, r.buildingId, g.id)).toBe(true);
    expect(talk.w.lastProximityRejections).toEqual([]);
    expect(talk.dealt.some((e) => e.kind === 'purchase' && e.recipient === g.id)).toBe(true);
    const post = stepWorld({ ...talk.w, pendingWallPosts: [{ id: 'p1', authorId: r.buildingId, state: 'hopeful', day: talk.w.tick }] });
    expect(post.lastRumourEvents.some((e) => e.heardFrom === r.buildingId && post.grifters.some((x) => x.id === e.heardBy))).toBe(true);
  });
});

describe('individual dealings reuse existing flows (plain mode, 120 days)', () => {
  let w = createWorld(3, V2);
  const ticks: World[] = [];
  for (let d = 0; d < 120; d++) { w = stepWorld(w); ticks.push(w); }
  const all = ticks.flatMap((t) => t.lastDealings!);
  const sum = (xs: DealingEvent[]) => xs.reduce((a, e) => a + e.quantity, 0);
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9 * Math.max(1, Math.abs(b)));

  it('bread, flour and grain events sum exactly to the kernel resource flows every tick', () => {
    for (const t of ticks) {
      const today = t.lastDealings!;
      close(sum(today.filter((e) => e.kind === 'purchase')), t.resources.today.breadProduced);
      close(sum(today.filter((e) => e.kind === 'flourSupply')), t.resources.today.flourConsumed);
      close(sum(today.filter((e) => e.kind === 'grainSupply')), t.resources.today.grainConsumed);
    }
  });

  it("each Courier's deliveries split exactly its own parcels; money is still conserved", () => {
    for (const t of ticks) {
      const byCourier = new Map<string, number>();
      for (const e of t.lastDealings!.filter((x) => x.kind === 'delivery')) byCourier.set(e.provider!, (byCourier.get(e.provider!) ?? 0) + e.quantity);
      for (const [courier, parcels] of byCourier) {
        expect(t.couriers.some((c) => c.buildingId === courier)).toBe(true);
        expect(parcels).toBeLessThanOrEqual(PARCELS_PER_COURIER_DAY * DAILY_ACTIVITY_MULTIPLIER + 1e-9);
      }
      expect(Math.abs(t.lastSettlement.residual)).toBeLessThan(1e-6);
      close(t.resources.today.flourConsumed, t.resources.today.breadProduced * FLOUR_PER_BREAD);
      expect(GRAIN_PER_FLOUR).toBeGreaterThan(0);
    }
  });

  it('every occupational counterparty pairing occurs with real parties of the right roles', () => {
    const role = (t: World, id: string | null | undefined) => {
      if (!id) return null;
      for (const [k, arr] of [['miller', t.millers], ['baker', t.bakers], ['courier', t.couriers], ['investigator', t.investigators], ['importExport', t.importExporters]] as const) {
        if (arr.some((s) => s.buildingId === id)) return k;
      }
      return t.grifters.some((g) => g.id === id) ? 'grifter' : 'unknown';
    };
    const kinds = new Set(all.map((e) => e.kind));
    for (const k of ['purchase', 'flourSupply', 'grainSupply', 'delivery', 'evidence']) expect(kinds.has(k as DealingEvent['kind'])).toBe(true);
    ticks.forEach((t, i) => {
      const before = i === 0 ? t : ticks[i - 1]!;
      for (const e of t.lastDealings!) {
        if (e.kind === 'purchase') expect(role(before, e.provider) ?? role(t, e.provider)).toBe('baker');
        if (e.kind === 'flourSupply') { if (e.provider) expect(role(t, e.provider)).toBe('miller'); expect(role(t, e.recipient)).toBe('baker'); }
        if (e.kind === 'grainSupply') { if (e.provider) expect(role(t, e.provider)).toBe('importExport'); expect(role(t, e.recipient)).toBe('miller'); }
        if (e.kind === 'delivery') { expect(role(t, e.provider)).toBe('courier'); expect(role(t, e.recipient)).toBe('baker'); }
        if (e.kind === 'evidence') expect(role(before, e.provider) ?? role(t, e.provider)).toBe('investigator');
      }
    });
  });

  it('customers keep the purchase cycle and mostly return to a regular Baker; regulars resolve, one-off buyers do not', () => {
    const purchases = all.filter((e) => e.kind === 'purchase');
    const byCustomer = new Map<string, DealingEvent[]>();
    for (const e of purchases) byCustomer.set(e.recipient, [...(byCustomer.get(e.recipient) ?? []), e]);
    let repeats = 0, visits = 0;
    for (const list of byCustomer.values()) {
      for (let i = 1; i < list.length; i++) { visits++; if (list[i]!.provider === list[i - 1]!.provider) repeats++; expect((list[i]!.tick - list[i - 1]!.tick) % 7).toBe(0); }
    }
    // Memoryless price-share buying would repeat about 1/9 of the time (9 Bakers); the regular chain
    // keeps 75% + 25%/9 absent churn, and Baker or slot turnover pulls that down a little.
    expect(repeats / visits).toBeGreaterThan(0.5);
    const end = ticks.at(-1)!;
    const days = new Map<string, Set<number>>(); // distinct dealing days per directed pair, incl. a delivery's sender
    for (const e of all) for (const [o, s] of dealingPairs(e)) days.set(`${o}>${s}`, (days.get(`${o}>${s}`) ?? new Set()).add(e.tick));
    const ledger = end.recognitionV2!.recognition.ledger;
    let resolvedPairs = 0;
    for (const [o, row] of ledger) for (const [s, e] of row) if (e.resolved) {
      resolvedPairs++;
      expect(days.get(`${o}>${s}`)?.size ?? 0).toBeGreaterThanOrEqual(3); // only repeated dealings resolve in a world with no speech
    }
    expect(resolvedPairs).toBeGreaterThan(0);
  });

  it('is deterministic for a seed', () => {
    let a = createWorld(3, V2), b = createWorld(3, V2);
    for (let d = 0; d < 30; d++) { a = stepWorld(a); b = stepWorld(b); }
    expect(a.lastDealings).toEqual(b.lastDealings);
    expect(a.recognitionV2).toEqual(b.recognitionV2);
  });
});

describe('pressure detection is independent of the recognition ledger', () => {
  it('a pressure pattern raises district tension, identically whatever the recognition ledger holds', () => {
    let w = createWorld(7, V2);
    const author = w.bakers.find((b) => b.slot.state === 'FILLED')!.buildingId;
    const state = [...PRESSURE_CLUSTER_STATES][0]!;
    // Skew about 0.8 (every fifth post calm), so the contribution sits below its clamp of 1 and
    // the exposure amplification is actually visible in tension.
    for (let d = 0; d < 12; d++) w = stepWorld({ ...w, pendingWallPosts: [{ id: `p${d}`, authorId: author, state: d % 5 === 4 ? 'hopeful' : state, day: w.tick }] });
    const exposure = wallExposure(w.recognitionV2!.wallReach, author);
    expect(exposure).toBeGreaterThan(0.3);
    const post = { id: 'last', authorId: author, state, day: w.tick };
    const normal = stepWorld({ ...w, pendingWallPosts: [post] });
    const everyoneKnows = new Map([...w.millers, ...w.bakers, ...w.couriers].map((s) => [s.buildingId, new Map([[author, { credit: 150, resolved: true }]])]));
    const tampered = stepWorld({ ...w, pendingWallPosts: [post], recognitionV2: { ...w.recognitionV2!, recognition: { ledger: everyoneKnows, lastDealt: new Map() } } });
    const tension = (x: World) => x.shard.districts.map((d) => d.weatherHistory.at(-1)!.tension);
    expect(tension(tampered)).toEqual(tension(normal));
    expect(Math.max(...tension(normal))).toBeGreaterThan(0);
    // Exposure is what amplifies it: with no one having heard the author, tension is lower.
    const unheard = stepWorld({ ...w, pendingWallPosts: [post], recognitionV2: { ...w.recognitionV2!, wallReach: new Map() } });
    expect(Math.max(...tension(unheard))).toBeLessThan(Math.max(...tension(normal)));
  });
});

describe('participant mode: stable persons, own dealings only, gain and loss on the wire', () => {
  const genesis = fixtureGenesis(103, V2);
  let s = createParticipantState(genesis);
  const tape = newTape(s);
  for (let d = 0; d < 30; d++) {
    const online = [...s.registry.people.values()].filter((p) => p.location !== null).slice(0, 3).map((p) => p.id);
    const r = stepParticipantState(s, [], online);
    tape.ticks.push({ tick: s.world.tick, online, actions: [], stateHash: evidenceHash(r.state), effectsHash: digest(r.effects) });
    s = r.state;
  }

  it('dealings name persons, replay exactly, and each person sees only their own', () => {
    expect(replay(tape, genesis.sourceRevision).world.recognitionV2).toEqual(s.world.recognitionV2);
    const people = new Set(s.registry.people.keys());
    for (const e of s.world.lastDealings!) {
      expect(people.has(e.recipient)).toBe(true);
      if (e.provider) expect(people.has(e.provider)).toBe(true);
    }
    const e = s.world.lastDealings!.find((x) => x.kind === 'purchase' && x.outcome === 'served')!;
    const customer = observe(s, e.recipient, genesis.observerSecret).projection as { dealings: { kind: string; as: string; counterparty: string | null }[]; city: { people: { ref: string }[] } };
    expect(customer.dealings).toContainEqual(expect.objectContaining({ kind: 'purchase', as: 'recipient' }));
    const stranger = [...people].find((p) => s.registry.people.get(p)!.location !== null && !s.world.lastDealings!.some((x) => [x.provider, x.recipient, x.sender].includes(p)))!;
    expect((observe(s, stranger, genesis.observerSecret).projection as { dealings: unknown[] }).dealings).toEqual([]);
    expect(JSON.stringify(customer)).not.toMatch(/credit|threshold|resolved/);
  });

  it('a lapse removes the face and the known subject but keeps the same reference, and the wire mirrors it', () => {
    const observer = s.world.lastDealings!.find((x) => x.kind === 'purchase')!.recipient;
    const subject = [...s.registry.people.values()].find((p) => p.location !== null && p.id !== observer && !s.world.lastDealings!.some((x) => [x.provider, x.recipient].includes(p.id)))!.id;
    const ledger = new Map(s.world.recognitionV2!.recognition.ledger);
    ledger.set(observer, new Map([...(ledger.get(observer) ?? []), [subject, { credit: 90, resolved: true }]]));
    const primed = { ...s, world: { ...s.world, recognitionV2: { ...s.world.recognitionV2!, recognition: { ...s.world.recognitionV2!.recognition, ledger } } } };
    const before = observe(primed, observer, genesis.observerSecret);
    const after = observe(stepParticipantState(primed, [], []).state, observer, genesis.observerSecret);
    const ref = before.context.presentRefs.find((x) => before.context.knownSubjects.includes(x))!;
    expect(ref).toBeDefined();
    expect(after.context.knownSubjects).not.toContain(ref);
    expect(after.context.presentRefs).toContain(ref);
    const msgs = identityTransitionMessages('secret', new Set([subject]), new Set());
    expect(msgs).toEqual([{ type: 'identityLapsed', handle: personHandle('secret', subject) }]);
    const back = identityTransitionMessages('secret', new Set(), new Set([subject]));
    expect(back[0]).toMatchObject({ type: 'identityResolved', handle: personHandle('secret', subject) });
  });
});

describe('v2 data blockers closed: Grifter gate, rules text, courier pay', () => {
  it('the validator lets a Grifter speak and write only under the v2 rules marker; never a role action', async () => {
    const { validateDecision, policyInput, validateContext } = await import('../src/agent/protocol.js');
    const base = { tick: 1, selfRef: 'me', role: 'Grifter', roleEpoch: 0, legalMoves: [], presentRefs: ['you'], knownSubjects: ['you'] };
    const say = { move: null, communication: { kind: 'wallPost', state: 'hopeful' }, diary: null, role: null };
    const write = { move: null, communication: null, diary: { subject: 'you', observation: 'soughtMeOut', reading: 'cantTellYet', context: null }, role: null };
    expect(validateDecision(say, base)).toBeNull();
    expect(validateDecision(write, base)).toBeNull();
    const v2 = { ...base, rules: 'v2' as const, hearingRefs: ['you'] };
    expect(validateDecision(say, v2)).not.toBeNull();
    expect(validateDecision(write, v2)).not.toBeNull();
    expect(validateDecision({ ...say, communication: null, role: { kind: 'bakerPrice', price: 1 } }, v2)).toBeNull();
    expect(Object.hasOwn(policyInput(base), 'rules')).toBe(false); // v1 request bytes unchanged
    expect(Object.hasOwn(policyInput(base), 'hearingRefs')).toBe(false);
    expect(policyInput(v2).rules).toBe('v2');
    expect(() => validateContext({ ...v2, rules: 'v3' as 'v2' })).toThrow('invalid_context');
  });

  it('a Grifter agent speaks through the participant pipeline in a v2 world and is heard', () => {
    const genesis = fixtureGenesis(103, V2);
    let s = createParticipantState(genesis);
    for (let d = 0; d < 3; d++) s = stepParticipantState(s, [], []).state; // housing places Grifters
    const grifter = [...s.registry.people.values()].find((p) => p.location !== null && p.role === null)!;
    const ctx = observe(s, grifter.id, genesis.observerSecret).context;
    expect(ctx.rules).toBe('v2');
    const decision = { move: null, communication: { kind: 'proximityUtterance', intent: 'inform', tone: 'warm', referent: { kind: 'room' }, context: null }, diary: null, role: null };
    const r = stepParticipantState(s, [{ person: grifter.id, epoch: grifter.roleEpoch, tick: s.world.tick, decision }], [grifter.id]);
    expect(r.state.world.lastProximityRejections).toEqual([]);
    expect(r.effects).toContainEqual({ person: grifter.id, category: 'proximityHeard' });
  });

  it('a Grifter who recognises someone writes the diary, and the kernel keeps it', () => {
    const genesis = fixtureGenesis(103, V2);
    let s = createParticipantState(genesis);
    for (let d = 0; d < 3; d++) s = stepParticipantState(s, [], []).state;
    const grifter = [...s.registry.people.values()].find((p) => p.location !== null && p.role === null)!;
    const subject = [...s.registry.people.values()].find((p) => p.location !== null && p.role !== null)!;
    const ledger = new Map(s.world.recognitionV2!.recognition.ledger);
    ledger.set(grifter.id, new Map([[subject.id, { credit: 150, resolved: true }]]));
    s = { ...s, world: { ...s.world, recognitionV2: { ...s.world.recognitionV2!, recognition: { ...s.world.recognitionV2!.recognition, ledger } } } };
    const ctx = observe(s, grifter.id, genesis.observerSecret).context;
    expect(ctx.knownSubjects.length).toBe(1);
    const decision = { move: null, communication: null, role: null, diary: { subject: ctx.knownSubjects[0], observation: 'soughtMeOut', reading: 'cantTellYet', context: null } };
    const r = stepParticipantState(s, [{ person: grifter.id, epoch: grifter.roleEpoch, tick: s.world.tick, decision }], [grifter.id]);
    expect(r.effects).toContainEqual({ person: grifter.id, category: 'diary' });
    expect(r.state.world.diary.get(grifter.id)!.some((e) => e.value.subject === subject.id)).toBe(true);
  });

  it('the v2 rules text replaces the v1 diary, recognition and Grifter lines, and matches the A01 contract text', async () => {
    const { buildResponsesRequest } = await import('../src/agent/responsesRequest.js');
    const { DIARY_RULES_TEXT_V2, RULES_CONTEXT_VERSION_V2 } = await import('../src/agent/rulesContext.js');
    const { DIARY_CONTRACT } = await import('../src/eval/constructs/diaryContract.js');
    expect(DIARY_RULES_TEXT_V2).toBe(DIARY_CONTRACT.rulesTextV2);
    const request = (cfg: typeof DEFAULT_WORLD_CONFIG) => {
      const g = fixtureGenesis(103, cfg);
      const st = createParticipantState(g);
      const baker = [...st.registry.people.values()].find((p) => p.role === 'baker')!;
      return buildResponsesRequest({ observationId: 'rules-text-test', ...observe(st, baker.id, g.observerSecret) }, 'gpt-5.4-nano-2026-03-17').body;
    };
    const v2 = request(V2), v1 = request(DEFAULT_WORLD_CONFIG);
    expect(v2).toContain(RULES_CONTEXT_VERSION_V2);
    expect(v2).toContain(DIARY_RULES_TEXT_V2.slice(0, 60));
    expect(v2).not.toContain('Use diary=null');
    expect(v2).not.toMatch(/credit|threshold|lose below|ledger/i); // no hidden mechanics
    expect(v1).toContain('Use diary=null');
    expect(v1).not.toContain(RULES_CONTEXT_VERSION_V2);
  });

  it('a v2 Courier is paid by its workplace route, whether it walks or not', () => {
    const genesis = fixtureGenesis(103, V2);
    const wealthAfter = (walk: boolean) => {
      let s = createParticipantState(genesis);
      const courier = [...s.registry.people.values()].find((p) => p.role === 'courier')!;
      for (let d = 0; d < 5; d++) {
        const o = observe(s, courier.id, genesis.observerSecret);
        const hub = s.world.shard.hubPlot;
        const away = [...o.context.legalMoves].sort((a, b) => (Math.abs(b.x - hub.x) + Math.abs(b.y - hub.y)) - (Math.abs(a.x - hub.x) + Math.abs(a.y - hub.y)))[0];
        const decision = { move: walk && away ? away : null, communication: null, diary: null, role: null };
        s = stepParticipantState(s, [{ person: courier.id, epoch: courier.roleEpoch, tick: s.world.tick, decision }], [courier.id]).state;
      }
      return s.world.couriers.find((c) => c.buildingId === s.registry.people.get(courier.id)!.location)!.wealth;
    };
    expect(wealthAfter(true)).toBeCloseTo(wealthAfter(false), 9);
  });
});

describe('v2 requests stay well under the 32 KB fail-closed ceiling', () => {
  it('active play (speech, posts, diary, dealings) keeps at least 10% headroom; references are 64-bit in v2 only', async () => {
    const { MultiActorEpisode, multiScenarioById } = await import('../src/eval/multiActorEpisode.js');
    const { unpackObservation } = await import('../src/agent/observationTables.js');
    const ep = new MultiActorEpisode({ ...multiScenarioById('authority_attribution_council'), ticks: 20 }, 'size-guard');
    let max = 0;
    while (!ep.done) {
      const ps = ep.prompts({ model: 'gpt-5.4-nano-2026-03-17' });
      for (const p of ps) max = Math.max(max, Buffer.byteLength(p.request!.body, 'utf8'));
      ep.act(Object.fromEntries(ps.map((p) => {
        const o = JSON.parse(p.prompt.observation); const v = (o.encoding ? unpackObservation(o) : o) as { tick: number; self: { role: string }; hearing: string[]; recognition: { ref: string }[] };
        const referent = v.hearing.length ? { kind: 'player', playerId: v.hearing[0] } : { kind: 'room' };
        const communication = v.tick % 2 ? { kind: 'proximityUtterance', intent: 'inform', tone: 'warm', referent, context: null } : { kind: 'wallPost', state: 'hopeful' };
        const diary = v.recognition.length ? { subject: v.recognition[0]!.ref, observation: 'soughtMeOut', reading: 'cantTellYet', context: null } : null;
        return [p.actorId, JSON.stringify({ move: null, communication, diary, role: v.self.role === 'Baker' ? { kind: 'bakerPrice', price: 0.9 } : null })];
      })));
    }
    expect(max).toBeLessThan(32_768 * 0.9);
    const st = createParticipantState(fixtureGenesis(103, V2)), v1 = createParticipantState(fixtureGenesis(103, DEFAULT_WORLD_CONFIG));
    const someone = [...st.registry.people.keys()][0]!;
    expect(observe(st, someone, 'offline-fixture-observer-secret').context.presentRefs[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(observe(v1, someone, 'offline-fixture-observer-secret').context.presentRefs[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
