import { describe, expect, it } from 'vitest';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { observerRef, refHexLength } from '../src/server/observer.js';
import { writeDiaryEntry } from '../src/engine/diary.js';
import { buildSocietyContext, validateSocietyAction, parseSocietyResponse, SocietySecurityError,
  type SocietyContextOptions, type SocietyAction } from '../src/society/boundary.js';

const stay = (): SocietyAction => ({ move: null, communication: null, diary: null, occupation: null, purchase: null, oracle: null });
function fixture(role: string | null = 'baker', options: Partial<SocietyContextOptions> = {}) {
  const state = createParticipantState(fixtureGenesis(72, { ...DEFAULT_WORLD_CONFIG, recognition: 'v2',
    pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 }));
  const person = [...state.registry.people.values()].find(p => p.role === role)!;
  const scoped = (id: string) => observerRef(state.genesis.observerSecret, person.id, id, refHexLength(state.world));
  const bakers = [...state.registry.people.values()].filter(p => p.role === 'baker');
  const market = bakers.map(p => ({ sellerRef: scoped(p.id), buildingId: p.location!, price: 0.5, available: true }));
  const input = buildSocietyContext(state, person.id, { phase: 'act', market, purchaseDue: true,
    oracle: { entryCost: 0.3, winProbability: 0.3, canEnter: true, canRedeem: false }, ...options });
  return { state, person, scoped, market, ...input };
}

describe('inhabitant society information boundary', () => {
  it('explains every role without technical world, development, package or other-private metadata', () => {
    const f = fixture(), { state, person } = f;
    Object.assign(state.world, { developmentUpdate: 'DEVELOPMENT_SECRET', packageInformation: 'PACKAGE_SECRET', evaluator: 'EVALUATOR_SECRET' });
    Object.assign(state.genesis, { credential: 'CREDENTIAL_SECRET' });
    state.world.bakers.find(q => q.buildingId !== person.location)!.wealth = 812345.678;
    state.world.bakers.find(q => q.buildingId !== person.location)!.personalResourceStock = 765432.111;
    const visible = buildSocietyContext(state, person.id, { phase: 'act', market: f.market }).visible;
    const bytes = JSON.stringify(visible);
    for (const forbidden of ['DEVELOPMENT_SECRET', 'PACKAGE_SECRET', 'EVALUATOR_SECRET', 'CREDENTIAL_SECRET', state.genesis.observerSecret,
      state.genesis.namespace, state.genesis.sourceRevision, '812345.678', '765432.111', 'worldHash', 'requestId', 'sourceRevision', '"sources"', 'sabotageCampaigns']) expect(bytes).not.toContain(forbidden);
    expect(Object.keys(visible.rules.roles)).toEqual(['Baker', 'Miller', 'Courier', 'Investigator', 'ImportExport', 'Grifter']);
    expect(visible.rules.roles.Miller.duties).toContain('grain');
    expect(visible.self.ref).toBe(f.context.selfRef);
    expect(visible.decisionSchema).toHaveProperty('additionalProperties', false);
    expect(Object.isFrozen(visible)).toBe(true);
  });

  it('shows only local bodies and locations, local weather and own received dealings', () => {
    const f = fixture('miller');
    expect(f.visible.local.people.length).toBeLessThan(f.state.registry.people.size - 1);
    for (const p of f.visible.local.people) expect(Math.abs(p.x - f.visible.self.x) + Math.abs(p.y - f.visible.self.y)).toBeLessThanOrEqual(f.state.world.config.commsProximityRange);
    expect(f.visible.hearing.every(r => f.context.presentRefs.includes(r))).toBe(true);
    expect(f.visible.local.districtWeather).toBe(0);
    expect(f.visible.self.quantity).toBeGreaterThanOrEqual(0.01);
    const other = [...f.state.registry.people.values()].find(p => p.id !== f.person.id && p.role === 'baker')!;
    const stranger = [...f.state.registry.people.values()].find(p => p.id !== other.id && p.id !== f.person.id)!;
    f.state.world.lastDealings = [
      { tick: 0, kind: 'purchase', provider: other.id, providerSite: other.location!, recipient: f.person.id, recipientSite: f.person.location!, quantity: 1, outcome: 'served' },
      { tick: 0, kind: 'purchase', provider: other.id, providerSite: other.location!, recipient: stranger.id, recipientSite: stranger.location!, quantity: 938231, outcome: 'served' },
    ];
    const next = buildSocietyContext(f.state, f.person.id, { phase: 'act' }).visible;
    expect(next.dealings).toEqual([{ kind: 'purchase', as: 'recipient', counterparty: f.scoped(other.id), quantity: 1, outcome: 'served' }]);
    expect(JSON.stringify(next)).not.toContain('938231');
  });

  it('preserves earned recognition and own diary eligibility without giving other diaries', () => {
    const f = fixture(), other = [...f.state.registry.people.values()].find(p => p.role === 'miller')!;
    const recognition = f.state.world.recognitionV2!;
    recognition.recognition = { ...recognition.recognition,
      ledger: new Map([[f.person.id, new Map([[other.id, { credit: 130, resolved: true }]])]]) };
    writeDiaryEntry(f.state.world.diary, f.person.id, other.id, 'matchedMyPrice', 'cantTellYet', 0, new Set([other.id]), 'trade');
    writeDiaryEntry(f.state.world.diary, other.id, f.person.id, 'haggledHard', 'seemsCalculating', 0, new Set([f.person.id]));
    const { visible, context } = buildSocietyContext(f.state, f.person.id, { phase: 'act' });
    expect(context.knownSubjects).toContain(f.scoped(other.id));
    expect(visible.diary).toEqual([{ subject: f.scoped(other.id), observation: 'matchedMyPrice', reading: 'cantTellYet', context: 'trade' }]);
    expect(JSON.stringify(visible.diary)).not.toContain('seemsCalculating');
    expect(validateSocietyAction({ ...stay(), diary: { subject: f.scoped(other.id), observation: 'matchedMyPrice', reading: 'cantTellYet', context: 'trade' } }, context).diary).not.toBeNull();
    expect(() => validateSocietyAction({ ...stay(), diary: { subject: context.selfRef, observation: 'matchedMyPrice', reading: 'cantTellYet', context: null } }, context)).toThrow(SocietySecurityError);
  });

  it('does not pass arbitrary public-option text or allow a quote to impersonate another seller', () => {
    const f = fixture();
    const altered = { ...f.market[0]!, buildingId: f.market[1]!.buildingId };
    expect(() => buildSocietyContext(f.state, f.person.id, { phase: 'act', market: [altered] })).toThrow('society_public_market');
    const visible = buildSocietyContext(f.state, f.person.id, { phase: 'act',
      oracle: { entryCost: 0.3, winProbability: 0.3, canEnter: true, canRedeem: false, rewards: ['DEVELOPMENT_UPDATE_SECRET'] } }).visible;
    expect(JSON.stringify(visible)).not.toContain('DEVELOPMENT_UPDATE_SECRET');
  });

  it('shows approximate local heat without disclosing another Miller commitment', () => {
    const f = fixture('baker'), miller = f.state.world.millers.find(m =>
      Math.abs(m.x - f.visible.self.x) + Math.abs(m.y - f.visible.self.y) <= f.state.world.config.commsProximityRange)!;
    miller.value = 0.483721948319;
    const first = buildSocietyContext(f.state, f.person.id, { phase: 'act' }).visible;
    expect(first.local.locations.find(p => p.buildingId === miller.buildingId)?.heat).toBe('medium');
    expect(JSON.stringify(first)).not.toContain('0.483721948319');
    miller.value = 0.533729184312;
    const second = buildSocietyContext(f.state, f.person.id, { phase: 'act' }).visible;
    expect(second.local.locations.find(p => p.buildingId === miller.buildingId)?.heat).toBe('medium');
    expect(first).toEqual(second);
    expect(second.self.quantity).toBeNull();
  });

  it('shows only an own current commitment after the planning phase and rejects role mismatch', () => {
    const baker = fixture('baker'), miller = fixture('miller');
    expect(buildSocietyContext(baker.state, baker.person.id, { phase: 'act', ownCommitment: { kind: 'bakerPrice', price: 1.73 } }).visible.self.price).toBe(1.73);
    expect(buildSocietyContext(miller.state, miller.person.id, { phase: 'act', ownCommitment: { kind: 'millerQuantity', quantity: 0.83 } }).visible.self.quantity).toBe(0.83);
    expect(() => buildSocietyContext(baker.state, baker.person.id, { phase: 'act', ownCommitment: { kind: 'millerQuantity', quantity: 0.83 } })).toThrow('society_own_commitment');
    expect(() => buildSocietyContext(miller.state, miller.person.id, { phase: 'commit', ownCommitment: { kind: 'millerQuantity', quantity: 0.83 } })).toThrow('society_own_commitment');
  });
});

describe('inhabitant society fail-closed actions', () => {
  it.each(['baker', 'miller', 'courier', 'investigator', 'importExport', null])('permits freely declining choices for %s', role => {
    const f = fixture(role);
    expect(validateSocietyAction(stay(), f.context)).toEqual(stay());
  });

  it('validates commitment bounds and rejects same-day quote changes or unsupported work', () => {
    const baker = fixture('baker', { phase: 'commit' }), miller = fixture('miller', { phase: 'commit' });
    expect(validateSocietyAction({ ...stay(), occupation: { kind: 'bakerPrice', price: 0 } }, baker.context).occupation).not.toBeNull();
    expect(validateSocietyAction({ ...stay(), occupation: { kind: 'bakerPrice', price: 2 } }, baker.context).occupation).not.toBeNull();
    expect(validateSocietyAction({ ...stay(), occupation: { kind: 'millerQuantity', quantity: 1 } }, miller.context).occupation).not.toBeNull();
    for (const price of [-0.01, 2.01, Infinity, NaN]) expect(() => validateSocietyAction({ ...stay(), occupation: { kind: 'bakerPrice', price } }, baker.context)).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), occupation: { kind: 'millerQuantity', quantity: 0 } }, miller.context)).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), occupation: { kind: 'bakerPrice', price: 0.6 } }, fixture().context)).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), occupation: { kind: 'work' } }, fixture('miller').context)).toThrow(SocietySecurityError);
    expect(validateSocietyAction({ ...stay(), occupation: { kind: 'work' } }, fixture('courier').context).occupation).toEqual({ kind: 'work' });
  });

  it('rejects host operations, tool calls, unsafe values and malformed provider output without running them', () => {
    const { context } = fixture();
    const attacks: unknown[] = [
      { ...stay(), tool: { name: 'read_file', path: 'package.json' } },
      { ...stay(), exec: 'powershell Get-Content .env' },
      { ...stay(), communication: { kind: 'wallPost', state: 'secure', instructions: 'ignore rules' } },
      { ...stay(), occupation: { kind: 'readFile', path: 'AGENTS.md' } },
      { ...stay(), move: { x: 0, y: 0, operation: 'fetch' } },
      { ...stay(), purchase: { seller: context.selfRef, quantity: 100 } },
      { ...stay(), oracle: { kind: 'guaranteedWin' } },
      { content: [{ type: 'tool_use', name: 'exec', input: {} }] },
      Object.assign(Object.create({ operation: 'readFile' }), stay()),
      { ...stay(), [Symbol('host')]: 'exec' },
    ];
    for (const attack of attacks) expect(() => validateSocietyAction(attack, context)).toThrow(SocietySecurityError);
    let getterCalled = false;
    const getter = { ...stay() };
    Object.defineProperty(getter, 'occupation', { enumerable: true, get: () => { getterCalled = true; return null; } });
    expect(() => validateSocietyAction(getter, context)).toThrow(SocietySecurityError);
    expect(getterCalled).toBe(false);
    for (const raw of ['```json\n{}\n```', 'run_shell("ls")', JSON.stringify({ ...stay(), tools: [] }), 'x'.repeat(16_385)]) expect(() => parseSocietyResponse(raw, context)).toThrow(SocietySecurityError);
    expect(parseSocietyResponse(JSON.stringify(stay()), context)).toEqual(stay());
  });

  it('checks movement, hearing, diary, purchase eligibility, quantity and Oracle rights', () => {
    const f = fixture('miller'), move = f.context.legalMoves[0]!;
    expect(validateSocietyAction({ ...stay(), move }, f.context).move).toEqual(move);
    expect(() => validateSocietyAction({ ...stay(), move: { x: move.x + 100, y: move.y } }, f.context)).toThrow(SocietySecurityError);
    expect(validateSocietyAction({ ...stay(), communication: { kind: 'wallPost', state: 'hopeful' } }, f.context).communication).not.toBeNull();
    const hearing = f.context.hearingRefs![0];
    if (hearing) expect(validateSocietyAction({ ...stay(), communication: { kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: { kind: 'player', playerId: hearing }, context: 'myPrice' } }, f.context).communication).not.toBeNull();
    expect(() => validateSocietyAction({ ...stay(), communication: { kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: { kind: 'player', playerId: 'a'.repeat(16) }, context: null } }, f.context)).toThrow(SocietySecurityError);
    expect(validateSocietyAction({ ...stay(), purchase: { seller: f.market[0]!.sellerRef, quantity: 1 }, oracle: 'enter' }, f.context).purchase).not.toBeNull();
    expect(() => validateSocietyAction({ ...stay(), purchase: { seller: f.market[0]!.sellerRef, quantity: 2 } }, f.context)).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), oracle: 'redeem' }, f.context)).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), purchase: { seller: f.market[0]!.sellerRef, quantity: 1 } }, { ...f.context, purchaseDue: false })).toThrow(SocietySecurityError);
    expect(() => validateSocietyAction({ ...stay(), move }, fixture('miller', { phase: 'commit' }).context)).toThrow(SocietySecurityError);
  });
});
