import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POSTCARD_TIERS,
  applyPostcardEvent,
  assertPostcardState,
  createPostcardState,
  type PostcardState,
  type PostcardTier,
} from '../src/engine/postcards.js';
import {
  applyPostcardTransaction,
  assertPostcardAccount,
  createPostcardAccount,
  postcardAccountWhiteEquivalent,
  postcardRawWord,
  postcardShortcutBucket,
  postcardShortcutProbability,
  sealPostcardAccount,
  upgradePostcardState,
} from '../src/engine/postcardAccount.js';
import * as rng from '../src/sim/rng.js';

const HOUR = 3_600_000;
const MAX_UINT32 = 0xffff_ffff;
const weights = { white: 1n, green: 5n, blue: 25n, purple: 125n, orange: 625n } as const;
const eligible = ['green', 'blue', 'purple'] as const;
type EligibleTier = (typeof eligible)[number];
type Account = ReturnType<typeof createPostcardAccount>;
type Transaction = Parameters<typeof applyPostcardTransaction>[1];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Inventory is obtained from the unchanged v1 reducer at its explicitly configured
 * illustrative 2/hour rate, with claims no farther than 16 hours apart. */
function legacyWallet(tier: PostcardTier, quantity: number): PostcardState {
  let state = createPostcardState('TEST-shortcut-person', { numerator: 2, denominator: 1 }, 0);
  const white = Number(weights[tier]) * quantity;
  while (state.held.white < white) {
    const count = Math.min(32, white - state.held.white);
    state = applyPostcardEvent(state, { kind: 'claim', personId: state.personId,
      atMs: state.clockMs + count * HOUR / 2 }).state;
  }
  for (const lower of POSTCARD_TIERS) {
    if (lower === tier) break;
    while (state.held[lower] >= 5)
      state = applyPostcardEvent(state, { kind: 'safeFusion', personId: state.personId,
        atMs: state.clockMs, tier: lower }).state;
  }
  expect(state.held[tier]).toBe(quantity);
  assertPostcardState(state);
  return state;
}

const wallets = Object.fromEntries(eligible.map(tier => [tier, legacyWallet(tier, 5)])) as
  Record<EligibleTier, PostcardState>;
const fresh = (seed = 0): Account => createPostcardAccount('TEST-shortcut-person', { numerator: 2, denominator: 1 }, 0, seed);
const wallet = (tier: EligibleTier, seed = 0): Account => upgradePostcardState(wallets[tier], seed);
function transaction(account: Account, id: string, kind: 'clock' | 'claim', atMs = account.clockMs): Transaction {
  return { id, personId: account.personId, atMs, kind };
}
function shortcut(account: Account, tier: EligibleTier, stake: number, id = 'attempt', atMs = account.clockMs): Transaction {
  return { id, personId: account.personId, atMs, kind: 'shortcutFusion', tier, stake };
}
function value(account: Pick<Account, 'held'>): bigint {
  return POSTCARD_TIERS.reduce((sum, tier) => sum + BigInt(account.held[tier]) * weights[tier], 0n);
}
function conserved(account: Account): void {
  const denominator = BigInt(account.rate.denominator) * BigInt(HOUR);
  const gross = (BigInt(account.clockMs) - BigInt(account.createdAtMs)) * BigInt(account.rate.numerator);
  expect((value(account) + BigInt(account.burnedWhite)) * denominator +
    BigInt(account.unclaimedUnits) + BigInt(account.overflowUnits)).toBe(gross + BigInt(account.issuedWhite) * denominator);
  expect(() => assertPostcardAccount(account)).not.toThrow();
  expect(postcardAccountWhiteEquivalent(account)).toBe(value(account));
}

/** Separate arithmetic reference for the established mulberry32 stream. This does not
 * import or stub the production RNG, choose desired outcomes, or use Math.random. */
function expectedDraw(seed: number, priorDraws = 0): { bucket: number; draws: number } {
  let draws = priorDraws;
  for (;;) {
    let a = (seed + Math.imul(draws + 1, 0x6d2b79f5)) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const word = (t ^ (t >>> 14)) >>> 0;
    draws++;
    if (word !== MAX_UINT32) return { bucket: word % 5, draws };
  }
}

afterEach(() => vi.restoreAllMocks());

describe('explicit v2 postcard account upgrade', () => {
  it('starts a configured account and retains its original v1 snapshot without ambient time or randomness', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('ambient clock'); });
    vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('ambient randomness'); });
    const account = createPostcardAccount('TEST-new', { numerator: 6, denominator: 3 }, 123, MAX_UINT32);
    expect(account).toMatchObject({ format: 'node-postcard-state-v2', personId: 'TEST-new',
      rate: { numerator: 2, denominator: 1 }, createdAtMs: 123, clockMs: 123,
      seed: MAX_UINT32, drawCount: 0, issuedWhite: '0', burnedWhite: '0', transactions: [] });
    expect(account.origin).toEqual(createPostcardState('TEST-new', { numerator: 2, denominator: 1 }, 123));
    conserved(account);
  });

  it('preserves every legacy field and defensively retains the upgrade origin', () => {
    const legacy = clone(wallets.purple), original = clone(legacy), upgraded = upgradePostcardState(legacy, 13);
    expect(upgraded.origin).toEqual(original);
    for (const field of ['personId', 'rate', 'createdAtMs', 'clockMs', 'lastClaimAtMs', 'held', 'unclaimedUnits', 'overflowUnits'] as const)
      expect(upgraded[field]).toEqual(original[field]);
    Object.assign(legacy, { held: { ...legacy.held, purple: 0 }, rate: { numerator: 999, denominator: 1 } });
    expect(upgraded.origin).toEqual(original);
    expect(upgraded.held.purple).toBe(5);
    expect(Object.isFrozen(upgraded)).toBe(true);
    expect(Object.isFrozen(upgraded.held)).toBe(true);
    expect(Object.isFrozen(upgraded.origin.held)).toBe(true);
    expect(Object.isFrozen(upgraded.transactions)).toBe(true);
    conserved(upgraded);
  });

  it('requires explicit upgrade and leaves v1 event validation and resource semantics unchanged', () => {
    const legacy = wallets.green, saved = clone(legacy), upgraded = upgradePostcardState(legacy, 0);
    expect(() => applyPostcardTransaction(legacy as never, shortcut(upgraded, 'green', 1))).toThrow();
    expect(() => upgradePostcardState(upgraded as never, 0)).toThrow();
    expect(() => assertPostcardState(upgraded)).toThrow();
    expect(() => applyPostcardEvent(legacy, { kind: 'shortcutFusion', personId: legacy.personId,
      atMs: legacy.clockMs, tier: 'green', stake: 1 } as never)).toThrow();
    expect(legacy).toEqual(saved);
    assertPostcardState(legacy);
  });

  it('seals a fully verified JSON account with independent nested copies', () => {
    const initial = wallet('green', 13);
    const parsed = clone(applyPostcardTransaction(initial, shortcut(initial, 'green', 2)).state);
    const saved = clone(parsed), sealed = sealPostcardAccount(parsed);
    expect(sealed).toEqual(saved);
    Object.assign(parsed.held, { green: 0 });
    Object.assign(parsed.transactions[0]!.event, { stake: 5 });
    expect(sealed).toEqual(saved);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.transactions[0]!.effect.fusion?.draw)).toBe(true);
    conserved(sealed);
  });

  it.each([-1, -0, 0.5, NaN, Infinity, MAX_UINT32 + 1, Number.MAX_SAFE_INTEGER, undefined, '0'])
    ('rejects a seed outside canonical uint32: %s', seed => {
      expect(() => createPostcardAccount('TEST-seed', { numerator: 2, denominator: 1 }, 0, seed as never)).toThrow();
      expect(() => upgradePostcardState(wallets.green, seed as never)).toThrow();
    });

  it('requires an owner, explicit safe timestamp and valid configured rational rate', () => {
    for (const personId of ['', 'space is invalid', 'x'.repeat(129), undefined])
      expect(() => createPostcardAccount(personId as never, { numerator: 2, denominator: 1 }, 0, 0)).toThrow();
    for (const atMs of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined])
      expect(() => createPostcardAccount('TEST-new', { numerator: 2, denominator: 1 }, atMs as never, 0)).toThrow();
    for (const rate of [undefined, null, { numerator: 0, denominator: 1 }, { numerator: 1, denominator: 0 },
      { numerator: 1, denominator: 0.5 }, { numerator: Infinity, denominator: 1 },
      { numerator: 1, denominator: Number.MAX_SAFE_INTEGER + 1 }, { numerator: 2, denominator: 1, boost: 1 }])
      expect(() => createPostcardAccount('TEST-new', rate as never, 0, 0)).toThrow();
  });
});

describe('exact five-way rejection sampling', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 0x7fff_fffe, 0x7fff_ffff, 0x8000_0000, MAX_UINT32 - 5, MAX_UINT32 - 1])
    ('maps accepted raw word %i to its exact residue', word => {
      expect(postcardShortcutBucket(word)).toBe(word % 5);
    });

  it('rejects the sole excess uint32 word, giving five exactly equal-size buckets', () => {
    expect(postcardShortcutBucket(MAX_UINT32)).toBeNull();
    const acceptedWords = BigInt(MAX_UINT32), wordsPerBucket = acceptedWords / 5n;
    expect(acceptedWords % 5n).toBe(0n);
    expect(wordsPerBucket).toBe(858_993_459n);
    for (let bucket = 0; bucket < 5; bucket++) {
      expect(postcardShortcutBucket(bucket)).toBe(bucket);
      expect(postcardShortcutBucket(Number(BigInt(bucket) + (wordsPerBucket - 1n) * 5n))).toBe(bucket);
    }
    for (let stake = 1; stake <= 5; stake++) {
      expect(postcardShortcutProbability(stake)).toEqual({ numerator: stake, denominator: 5 });
      const outcomes = [0, 1, 2, 3, 4].map(word => postcardShortcutBucket(word)! < stake);
      expect(outcomes.filter(Boolean)).toHaveLength(stake);
      const winningWords = wordsPerBucket * BigInt(stake);
      expect(winningWords * 5n).toBe(acceptedWords * BigInt(stake));
    }
  });

  it.each([-1, -0, 0.5, NaN, Infinity, MAX_UINT32 + 1, '1', undefined])
    ('refuses a noncanonical raw word: %s', word => {
      expect(() => postcardShortcutBucket(word as never)).toThrow();
    });

  it.each([0, -0, -1, 0.5, 6, NaN, Infinity, '1', undefined])
    ('refuses an invalid probability stake: %s', stake => {
      expect(() => postcardShortcutProbability(stake as never)).toThrow();
    });

  it('uses the established PRNG stream at the supplied physical index', () => {
    for (const seed of [0, 1, 0x7fff_ffff, 0x8000_0000, MAX_UINT32]) {
      const source = rng.mulberry32(seed);
      for (let index = 0; index < 20; index++)
        expect(postcardRawWord(seed, index)).toBe(source() * 0x1_0000_0000);
    }
  });

  it('addresses large safe physical indices exactly and refuses malformed seed/index arguments', () => {
    const modulus = 1n << 32n;
    for (const index of [0xffff_ffff, 0x1_0000_0000, Number.MAX_SAFE_INTEGER]) {
      const offset = Number((BigInt(MAX_UINT32) + BigInt(index) * 0x6d2b79f5n) % modulus);
      const expected = rng.mulberry32(offset)() * 0x1_0000_0000;
      expect(postcardRawWord(MAX_UINT32, index)).toBe(expected);
    }
    for (const invalid of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '0'])
      expect(() => postcardRawWord(0, invalid as never)).toThrow();
    for (const invalid of [-1, -0, 0.5, NaN, Infinity, MAX_UINT32 + 1, undefined, '0'])
      expect(() => postcardRawWord(invalid as never, 0)).toThrow();
  });

  it('counts rejected raw draws and resumes after them without exposing injected randomness in the event API', () => {
    const seed = 123, firstOffset = (seed + 0x6d2b79f5) >>> 0, secondOffset = (seed + Math.imul(2, 0x6d2b79f5)) >>> 0;
    const realMulberry = rng.mulberry32;
    // Deterministic seed-addressed instrumentation makes the otherwise 1-in-2^32
    // rejection reachable. Both application and full journal replay see the same tape.
    vi.spyOn(rng, 'mulberry32').mockImplementation(input => {
      if ((input >>> 0) === seed) return () => MAX_UINT32 / 0x1_0000_0000;
      if ((input >>> 0) === firstOffset) return () => 4 / 0x1_0000_0000;
      if ((input >>> 0) === secondOffset) return () => 0;
      return realMulberry(input);
    });
    const before = wallet('green', seed);
    const first = applyPostcardTransaction(before, shortcut(before, 'green', 1, 'rejected-then-loss')).state;
    expect(first.drawCount).toBe(2);
    expect(first.held.green).toBe(4); expect(first.held.blue).toBe(0);
    const reopened = clone(first);
    assertPostcardAccount(reopened);
    const event = shortcut(reopened, 'green', 1, 'next-physical-word');
    const after = applyPostcardTransaction(reopened, event).state;
    expect(after.drawCount).toBe(3);
    expect(after.held.green).toBe(3); expect(after.held.blue).toBe(1);
    expect(applyPostcardTransaction(after, first.transactions[0]!.event).state).toBe(after);
    conserved(after);
  });
});

describe('same-tier weighted shortcut fusion', () => {
  it.each(eligible.flatMap(tier => [1, 2, 3, 4, 5].map(stake => [tier, stake] as const)))
    ('consumes precisely %s tier stake %i with independent issuance and burn conservation', (tier, stake) => {
      const before = wallet(tier), saved = clone(before);
      const { state: after, effect, duplicate } = applyPostcardTransaction(before, shortcut(before, tier, stake));
      const target = POSTCARD_TIERS[POSTCARD_TIERS.indexOf(tier) + 1]!;
      const expected = expectedDraw(before.seed), won = stake === 5 || expected.bucket < stake;
      expect(duplicate).toBe(false);
      expect(after.held).toEqual({ ...before.held, [tier]: 5 - stake, [target]: won ? 1 : 0 });
      expect(after.drawCount).toBe(stake === 5 ? 0 : expected.draws);
      expect(after.issuedWhite).toBe(won ? String(BigInt(5 - stake) * weights[tier]) : '0');
      expect(after.burnedWhite).toBe(won ? '0' : String(BigInt(stake) * weights[tier]));
      expect(value(after) - value(before)).toBe(won ? BigInt(5 - stake) * weights[tier] : -BigInt(stake) * weights[tier]);
      expect(after.transactions).toHaveLength(1);
      expect(after.transactions[0]!.event).toEqual(shortcut(before, tier, stake));
      expect(after.transactions[0]!.effect).toEqual(effect);
      expect(effect).toMatchObject({ kind: 'shortcutFusion', atMs: before.clockMs, acceptedUnits: '0', overflowUnits: '0',
        claimedWhite: 0, issuedWhite: after.issuedWhite, burnedWhite: after.burnedWhite,
        fusion: { from: tier, to: target, consumed: stake, produced: won ? 1 : 0, success: won,
          probabilityNumerator: stake, probabilityDenominator: 5,
          draw: stake === 5 ? null : { index: 0, count: expected.draws, bucket: expected.bucket } } });
      expect(before).toEqual(saved);
      expect(after.origin).toEqual(before.origin);
      conserved(after);
    });

  it.each(eligible)('makes a five-%s shortcut identical in holdings to safe fusion without consuming a draw', tier => {
    vi.spyOn(rng, 'mulberry32').mockImplementation(() => { throw Error('guaranteed fusion must not draw'); });
    const before = wallet(tier, 0x1234_5678);
    const shortcutResult = applyPostcardTransaction(before, shortcut(before, tier, 5)).state;
    const safeResult = applyPostcardTransaction(before, { id: 'safe', kind: 'safeFusion', personId: before.personId,
      atMs: before.clockMs, tier }).state;
    expect(shortcutResult.held).toEqual(safeResult.held);
    expect(shortcutResult.drawCount).toBe(0);
    expect(safeResult.drawCount).toBe(0);
    expect(shortcutResult.issuedWhite).toBe('0');
    expect(shortcutResult.burnedWhite).toBe('0');
    conserved(shortcutResult); conserved(safeResult);
  });

  it('consumes a known losing stake completely while accruing only to the pending buffer', () => {
    const before = wallet('green', 0), saved = clone(before), atMs = before.clockMs + HOUR;
    expect(expectedDraw(0).bucket).toBe(3);
    const after = applyPostcardTransaction(before, shortcut(before, 'green', 3, 'known-loss', atMs)).state;
    expect(after.held).toEqual({ white: 0, green: 2, blue: 0, purple: 0, orange: 0 });
    expect(after.burnedWhite).toBe('15');
    expect(after.issuedWhite).toBe('0');
    expect(after.unclaimedUnits).toBe(String(2 * HOUR));
    expect(after.lastClaimAtMs).toBe(before.lastClaimAtMs);
    expect(after.clockMs).toBe(atMs);
    expect(before).toEqual(saved);
    conserved(after);
  });

  it.each(eligible)('matches every actual PRNG result across 1,000 seeds at all stakes for %s', tier => {
    const winCounts = [0, 0, 0, 0, 0];
    for (let seed = 0; seed < 1_000; seed++) {
      const before = wallet(tier, seed), expected = expectedDraw(seed);
      for (let stake = 1; stake <= 5; stake++) {
        const after = applyPostcardTransaction(before, shortcut(before, tier, stake)).state;
        const target = POSTCARD_TIERS[POSTCARD_TIERS.indexOf(tier) + 1]!;
        const won = stake === 5 || expected.bucket < stake;
        expect(after.held[target]).toBe(won ? 1 : 0);
        expect(after.held[tier]).toBe(5 - stake);
        expect(after.drawCount).toBe(stake === 5 ? 0 : expected.draws);
        expect(after.issuedWhite).toBe(won ? String(BigInt(5 - stake) * weights[tier]) : '0');
        expect(after.burnedWhite).toBe(won ? '0' : String(BigInt(stake) * weights[tier]));
        expect(BigInt(after.issuedWhite) - BigInt(after.burnedWhite)).toBe(value(after) - value(before));
        if (won) winCounts[stake - 1]!++;
      }
    }
    // Finite-seed observations are compared to the deterministic reference, not forced
    // to equal ideal 20/40/60/80% population fractions or interpreted as model behaviour.
    expect(winCounts).toEqual([182, 367, 557, 777, 1_000]);
  });
});

describe('seeded replay and idempotent transaction identity', () => {
  it('repeats exact output and resumes the stream from a JSON checkpoint', () => {
    const initial = wallet('purple', 0xdead_beef);
    const events = Array.from({ length: 5 }, (_, index) => shortcut(initial, 'purple', 1, `roll-${index}`,
      initial.clockMs + index * HOUR));
    const run = (start: Account, sequence: readonly Transaction[]) => {
      let state = start;
      const effects = [];
      for (const event of sequence) {
        const result = applyPostcardTransaction(state, event);
        state = result.state; effects.push(result.effect); conserved(state);
      }
      return { state, effects };
    };
    const full = run(initial, events), repeated = run(wallet('purple', 0xdead_beef), events);
    const prefix = run(initial, events.slice(0, 2)), reopened = clone(prefix.state);
    assertPostcardAccount(reopened);
    const resumed = run(reopened, events.slice(2));
    expect(full).toEqual(repeated);
    expect(JSON.stringify(full)).toBe(JSON.stringify(repeated));
    expect(resumed.state).toEqual(full.state);
    expect([...prefix.effects, ...resumed.effects]).toEqual(full.effects);
    expect(full.state.drawCount).toBe(5);
    let draws = 0, oranges = 0;
    for (let index = 0; index < 5; index++) {
      const draw = expectedDraw(initial.seed, draws);
      draws = draw.draws; if (draw.bucket < 1) oranges++;
    }
    expect(full.state.held.orange).toBe(oranges);
  });

  it('returns the original effect and unchanged current state for a duplicate after later clock advancement', () => {
    const before = wallet('green', 1), event = shortcut(before, 'green', 2, 'stable-id');
    const first = applyPostcardTransaction(before, event);
    const later = applyPostcardTransaction(first.state, transaction(first.state, 'later-clock', 'clock', before.clockMs + 24 * HOUR)).state;
    const saved = clone(later), result = applyPostcardTransaction(later, clone(event));
    expect(result.duplicate).toBe(true);
    expect(result.state).toBe(later);
    expect(result.state).toEqual(saved);
    expect(result.effect).toEqual(first.effect);
    expect(result.state.transactions).toHaveLength(2);
    expect(result.state.drawCount).toBe(first.state.drawCount);
    const reordered = { stake: 2, tier: 'green', kind: 'shortcutFusion', atMs: before.clockMs,
      personId: before.personId, id: 'stable-id' } as const;
    expect(applyPostcardTransaction(later, reordered).duplicate).toBe(true);
    conserved(result.state);
  });

  it('rejects reuse of an id with any changed payload, including after saving and reopening', () => {
    const before = wallet('green'), event = shortcut(before, 'green', 1, 'identity');
    const current = clone(applyPostcardTransaction(before, event).state), saved = clone(current);
    const conflicts = [
      { ...event, stake: 2 }, { ...event, tier: 'blue' }, { ...event, atMs: event.atMs + 1 },
      { ...event, personId: 'TEST-other' }, { id: event.id, personId: event.personId, atMs: event.atMs, kind: 'claim' },
    ];
    for (const conflict of conflicts) {
      expect(() => applyPostcardTransaction(current, conflict as never)).toThrow();
      expect(current).toEqual(saved);
    }
    expect(applyPostcardTransaction(current, event).duplicate).toBe(true);
    conserved(current);
  });

  it('retains immutable copies of successful event and effect payloads', () => {
    const before = wallet('blue'), event = shortcut(before, 'blue', 4, 'copied-event');
    const result = applyPostcardTransaction(before, event), originalEvent = clone(event), originalEffect = clone(result.effect);
    Object.assign(event, { stake: 1, atMs: event.atMs + HOUR });
    expect(result.state.transactions[0]!.event).toEqual(originalEvent);
    expect(result.state.transactions[0]!.effect).toEqual(originalEffect);
    expect(Object.isFrozen(result.effect)).toBe(true);
    expect(Object.isFrozen(result.effect.fusion)).toBe(true);
    expect(Object.isFrozen(result.state.transactions[0])).toBe(true);
    expect(Object.isFrozen(result.state.transactions[0]!.event)).toBe(true);
    conserved(result.state);
  });

  it('records clock and claim transactions idempotently while preserving fractional credit and permanent overflow', () => {
    let state = createPostcardAccount('TEST-fractional', { numerator: 1, denominator: 3 }, 0, 9);
    const first = transaction(state, 'first-claim', 'claim', HOUR);
    state = applyPostcardTransaction(state, first).state;
    expect(state.held.white).toBe(0); expect(state.unclaimedUnits).toBe(String(HOUR));
    state = applyPostcardTransaction(state, transaction(state, 'second-claim', 'claim', 3 * HOUR)).state;
    expect(state.held.white).toBe(1); expect(state.unclaimedUnits).toBe('0');
    state = applyPostcardTransaction(state, transaction(state, 'long-clock', 'clock', 27 * HOUR)).state;
    expect(state.unclaimedUnits).toBe(String(16 * HOUR));
    expect(state.overflowUnits).toBe(String(8 * HOUR));
    const duplicate = applyPostcardTransaction(state, first);
    expect(duplicate.state).toBe(state); expect(duplicate.duplicate).toBe(true);
    expect(state.drawCount).toBe(0); conserved(state);
  });
});

describe('strict atomic validation of postcard account transactions', () => {
  it('rejects forbidden recipes, malformed events and inadequate held inventory without clock advancement or RNG consumption', () => {
    const state = wallet('green'), saved = clone(state), atMs = state.clockMs + HOUR;
    const good = shortcut(state, 'green', 1, 'valid-after-errors', atMs);
    const invalid: unknown[] = [
      { ...good, tier: 'white' }, { ...good, tier: 'orange' }, { ...good, tier: 'red' },
      { ...good, tier: ['green', 'blue'] }, { ...good, tier: 'blue' }, { ...good, stake: 0 },
      { ...good, stake: -0 }, { ...good, stake: -1 }, { ...good, stake: 1.5 }, { ...good, stake: 6 },
      { ...good, stake: NaN }, { ...good, stake: Infinity }, { ...good, stake: '1' },
      { ...good, weights: [3, 8] }, { ...good, target: 'orange' }, { ...good, purchasedOdds: 1 },
      { ...good, personId: 'TEST-other' }, { ...good, atMs: state.clockMs - 1 },
      { ...good, atMs: -1 }, { ...good, atMs: Infinity }, { ...good, atMs: atMs + 0.5 },
      { ...good, atMs: Number.MAX_SAFE_INTEGER + 1 }, { ...good, id: '' }, { ...good, id: 1 },
      { ...good, kind: 'mixedFusion' }, { ...good, kind: 'safeFusion' },
      { ...transaction(state, 'bad-clock', 'clock', atMs), stake: 1 },
      { ...transaction(state, 'bad-claim', 'claim', atMs), tier: 'green' },
      null, [], {}, Object.assign(Object.create({ kind: 'shortcutFusion' }), good),
    ];
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('ambient clock'); });
    vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('ambient randomness'); });
    const draw = vi.spyOn(rng, 'mulberry32');
    for (const event of invalid) {
      expect(() => applyPostcardTransaction(state, event as never)).toThrow();
      expect(state).toEqual(saved);
    }
    expect(draw).not.toHaveBeenCalled();
    const valid = applyPostcardTransaction(state, good);
    expect(valid.duplicate).toBe(false);
    expect(valid.state.drawCount).toBe(expectedDraw(state.seed).draws);
    expect(valid.state.clockMs).toBe(atMs);
    expect(valid.state.transactions).toHaveLength(1);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(() => applyPostcardTransaction(valid.state, { ...good, id: 'bad-after-history', stake: 6 } as never)).toThrow();
    expect(draw).toHaveBeenCalledTimes(1);
    conserved(valid.state);
  });

  it('does not spend pending credit or claim new White to make an otherwise insufficient recipe valid', () => {
    let state = fresh(2);
    state = applyPostcardTransaction(state, transaction(state, 'buffer', 'clock', 16 * HOUR)).state;
    const saved = clone(state);
    expect(() => applyPostcardTransaction(state, shortcut(state, 'green', 1, 'missing-green', 32 * HOUR))).toThrow();
    expect(() => applyPostcardTransaction(state, { id: 'unclaimed', kind: 'safeFusion', personId: state.personId,
      atMs: 32 * HOUR, tier: 'white' })).toThrow();
    expect(state).toEqual(saved); conserved(state);
  });

  it.each(['white', 'orange'] as const)('rejects shortcut fusion from held %s inventory', tier => {
    const before = upgradePostcardState(legacyWallet(tier, 1), 3), saved = clone(before);
    expect(before.held[tier]).toBe(1);
    const event = { id: `forbidden-${tier}`, kind: 'shortcutFusion', personId: before.personId,
      atMs: before.clockMs + HOUR, tier, stake: 1 };
    expect(() => applyPostcardTransaction(before, event as never)).toThrow();
    expect(before).toEqual(saved); conserved(before);
  });

  it('keeps White-to-Green safe fusion available through the upgraded account', () => {
    const before = upgradePostcardState(legacyWallet('white', 5), 0);
    const result = applyPostcardTransaction(before, { id: 'white-safe', kind: 'safeFusion', personId: before.personId,
      atMs: before.clockMs, tier: 'white' }).state;
    expect(result.held).toEqual({ white: 0, green: 1, blue: 0, purple: 0, orange: 0 });
    expect(result.drawCount).toBe(0); expect(result.issuedWhite).toBe('0'); expect(result.burnedWhite).toBe('0');
    conserved(result);
  });

  it('retains exact huge overflow and leaves a subsequent overflowing claim atomic', () => {
    const before = createPostcardAccount('TEST-huge', { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 }, 0, 17);
    const state = applyPostcardTransaction(before, transaction(before, 'huge-clock', 'clock', Number.MAX_SAFE_INTEGER)).state;
    const capacity = 16n * BigInt(HOUR) * BigInt(Number.MAX_SAFE_INTEGER);
    const gross = BigInt(Number.MAX_SAFE_INTEGER) ** 2n;
    expect(state.unclaimedUnits).toBe(String(capacity));
    expect(state.overflowUnits).toBe(String(gross - capacity));
    const saved = clone(state);
    expect(() => applyPostcardTransaction(state, transaction(state, 'oversized-claim', 'claim'))).toThrow();
    expect(state).toEqual(saved); expect(state.drawCount).toBe(0); conserved(state);
  });

  it('rejects executable properties at every retained data boundary without invoking getters', () => {
    const state = wallet('green'), event = shortcut(state, 'green', 1), saved = clone(state);
    let reads = 0;
    const accessor = <T extends object>(object: T, key: keyof T): T => {
      const copy = clone(object);
      Object.defineProperty(copy, key, { enumerable: true, get: () => { reads++; throw Error('getter executed'); } });
      return copy;
    };
    expect(() => applyPostcardTransaction(state, accessor(event, 'atMs'))).toThrow();
    expect(() => assertPostcardAccount(accessor(state, 'seed'))).toThrow();
    expect(() => assertPostcardAccount({ ...state, held: accessor(state.held, 'green') })).toThrow();
    expect(() => assertPostcardAccount({ ...state, rate: accessor(state.rate, 'numerator') })).toThrow();
    expect(() => assertPostcardAccount({ ...state, origin: accessor(state.origin, 'clockMs') })).toThrow();
    const committed = applyPostcardTransaction(state, event).state;
    const entry = committed.transactions[0]!;
    expect(() => assertPostcardAccount({ ...committed, transactions: [accessor(entry, 'event')] })).toThrow();
    expect(() => assertPostcardAccount({ ...committed, transactions: [{ ...entry, effect: accessor(entry.effect, 'atMs') }] })).toThrow();
    const badArray = [entry];
    Object.defineProperty(badArray, '0', { enumerable: true, get: () => { reads++; throw Error('array getter executed'); } });
    expect(() => assertPostcardAccount({ ...committed, transactions: badArray })).toThrow();
    expect(reads).toBe(0);
    expect(state).toEqual(saved); conserved(state);
  });

  it('rejects malformed saved accounting, inventories, origins and journal entries', () => {
    const state = applyPostcardTransaction(wallet('green'), shortcut(wallet('green'), 'green', 1)).state;
    const corruptions: unknown[] = [
      { ...state, format: 'node-postcard-state-v1' }, { ...state, rngVersion: 'unversioned-rng' },
      { ...state, seed: -1 }, { ...state, seed: 1 },
      { ...state, drawCount: -1 }, { ...state, drawCount: 0 },
      { ...state, drawCount: 0.5 }, { ...state, drawCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...state, issuedWhite: '-1' }, { ...state, burnedWhite: '00' }, { ...state, burnedWhite: '1.5' },
      { ...state, issuedWhite: '1' }, { ...state, burnedWhite: '0' },
      { ...state, held: { ...state.held, green: -1 } }, { ...state, held: { ...state.held, green: 1.5 } },
      { ...state, held: { ...state.held, green: Number.MAX_SAFE_INTEGER + 1 } },
      // This coordinated forgery satisfies the aggregate conservation equation;
      // retaining the original origin and transaction journal must still expose it.
      { ...state, held: { ...state.held, blue: 1 }, issuedWhite: '25' },
      { ...state, origin: { ...state.origin, overflowUnits: '1' } },
      { ...state, origin: { ...state.origin, personId: 'TEST-other' } },
      { ...state, transactions: [] }, { ...state, transactions: [state.transactions[0], state.transactions[0]] },
      { ...state, transactions: [{ ...state.transactions[0], effect: {} }] },
      { ...state, transactions: [{ ...state.transactions[0], event: { ...state.transactions[0]!.event, stake: 2 } }] },
      { ...state, unknown: true }, null, [], new Date(0),
    ];
    for (const corrupted of corruptions) expect(() => assertPostcardAccount(corrupted)).toThrow();
    const symbolPayload = { ...state, [Symbol('hidden')]: true };
    expect(() => assertPostcardAccount(symbolPayload)).toThrow();
    conserved(state);
  });
});
