import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POSTCARD_TIERS,
  createPostcardState,
  applyPostcardEvent,
  assertPostcardState,
  postcardWhiteEquivalent,
} from '../src/engine/postcards.js';

const HOUR = 3_600_000;
const CAP = 16 * HOUR;
type State = ReturnType<typeof createPostcardState>;
type Tier = (typeof POSTCARD_TIERS)[number];
const values = { white: 1n, green: 5n, blue: 25n, purple: 125n, orange: 625n } as const;
const fresh = (personId = 'TEST-person') => createPostcardState(personId, { numerator: 2, denominator: 1 }, 0);
const clock = (state: State, atMs: number): State => applyPostcardEvent(state, { kind: 'clock', personId: state.personId, atMs }).state;
const claim = (state: State, atMs: number): State => applyPostcardEvent(state, { kind: 'claim', personId: state.personId, atMs }).state;
const fuse = (state: State, tier: Tier, atMs = state.clockMs): State =>
  applyPostcardEvent(state, { kind: 'safeFusion', personId: state.personId, atMs, tier }).state;

function independentValue(state: State): bigint {
  return POSTCARD_TIERS.reduce((sum, tier) => sum + BigInt(state.held[tier]) * values[tier], 0n);
}
function conserved(state: State): void {
  const denominator = BigInt(state.rate.denominator) * BigInt(HOUR);
  const generated = BigInt(state.clockMs - state.createdAtMs) * BigInt(state.rate.numerator);
  expect(independentValue(state) * denominator + BigInt(state.unclaimedUnits) + BigInt(state.overflowUnits)).toBe(generated);
  expect(postcardWhiteEquivalent(state)).toBe(independentValue(state));
  expect(() => assertPostcardState(state)).not.toThrow();
  for (const tier of POSTCARD_TIERS) expect(Number.isSafeInteger(state.held[tier]) && state.held[tier] >= 0).toBe(true);
}

/** Build inventory only through the explicit illustrative 2 White/hour accrual and claims.
 * No direct mint, fabricated holdings, daily-tick grant or random fixture is involved. */
function collectWhite(quantity: number): State {
  let state = fresh();
  while (state.held.white < quantity) {
    const nextQuantity = Math.min(32, quantity - state.held.white);
    state = claim(state, state.clockMs + nextQuantity * HOUR / 2);
    conserved(state);
  }
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe('postcard state and explicit hourly time', () => {
  it('starts an empty personal wallet with the canonical five-tier ladder and no implicit clock read', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('Ambient time must not be consulted'); });
    const state = createPostcardState('TEST-new-person', { numerator: 2, denominator: 1 }, 1000);
    expect(POSTCARD_TIERS).toEqual(['white', 'green', 'blue', 'purple', 'orange']);
    expect(state).toMatchObject({ format: 'node-postcard-state-v1', personId: 'TEST-new-person', createdAtMs: 1000,
      clockMs: 1000, lastClaimAtMs: null, unclaimedUnits: '0', overflowUnits: '0',
      held: { white: 0, green: 0, blue: 0, purple: 0, orange: 0 } });
    conserved(claim(state, 1000 + 12 * HOUR));
  });

  it.each([
    ['12 hours', 12 * HOUR, 24, 0],
    ['16 hours', CAP, 32, 0],
    ['24 hours', 24 * HOUR, 32, 16],
  ] as const)('claims the specified whole White amount after %s', (_label, atMs, held, lostWhite) => {
    const before = fresh(), original = structuredClone(before), after = claim(before, atMs);
    expect(after.held).toEqual({ white: held, green: 0, blue: 0, purple: 0, orange: 0 });
    expect(after.unclaimedUnits).toBe('0');
    expect(after.overflowUnits).toBe(String(BigInt(lostWhite) * BigInt(HOUR)));
    expect(after.clockMs).toBe(atMs); expect(after.lastClaimAtMs).toBe(atMs);
    expect(before).toEqual(original); conserved(after);
  });

  it.each([-1, 0, 1])('applies the 16-hour boundary exactly at an offset of %i millisecond', offset => {
    const atMs = CAP + offset, beforeClaim = clock(fresh(), atMs);
    expect(BigInt(beforeClaim.unclaimedUnits)).toBe(BigInt(Math.min(atMs, CAP)) * 2n);
    expect(BigInt(beforeClaim.overflowUnits)).toBe(BigInt(Math.max(0, offset)) * 2n);
    const afterClaim = claim(beforeClaim, atMs);
    expect(afterClaim.held.white).toBe(offset < 0 ? 31 : 32);
    expect(afterClaim.unclaimedUnits).toBe(offset < 0 ? String(HOUR - 2) : '0');
    conserved(beforeClaim); conserved(afterClaim);
  });

  it('collects 48 White from two 12-hour claims while one daily claim collects 32', () => {
    const twice = claim(claim(fresh(), 12 * HOUR), 24 * HOUR), once = claim(fresh(), 24 * HOUR);
    expect(twice.held.white).toBe(48); expect(twice.overflowUnits).toBe('0');
    expect(once.held.white).toBe(32); expect(BigInt(once.overflowUnits) / BigInt(HOUR)).toBe(16n);
    conserved(twice); conserved(once);
  });

  it('records overflow permanently, advances the cursor and never recovers discarded hours later', () => {
    const delayed = clock(fresh(), 24 * HOUR), original = structuredClone(delayed);
    expect(delayed.clockMs).toBe(24 * HOUR);
    const collected = claim(delayed, 24 * HOUR), oneHourLater = claim(collected, 25 * HOUR);
    expect(collected.held.white).toBe(32); expect(oneHourLater.held.white).toBe(34);
    expect(oneHourLater.overflowUnits).toBe(String(16 * HOUR));
    expect(delayed).toEqual(original); conserved(oneHourLater);
  });

  it('never decays cards already held, even after a long explicit absence', () => {
    const held = claim(fresh(), 12 * HOUR), later = clock(held, 1000 * 24 * HOUR);
    expect(later.held).toEqual(held.held); expect(later.lastClaimAtMs).toBe(12 * HOUR);
    expect(later.unclaimedUnits).toBe(String(CAP * 2));
    conserved(later);
  });

  it('is independent of clock-update frequency, including updates after saturation', () => {
    let split = fresh();
    for (const atMs of [1, CAP - 1, CAP, CAP + 1, 24 * HOUR]) split = clock(split, atMs);
    expect(split).toEqual(clock(fresh(), 24 * HOUR)); conserved(split);
  });

  it('retains one-third White fractional credit through repeated claims and JSON reopening', () => {
    let state = createPostcardState('TEST-fraction', { numerator: 1, denominator: 3 }, 0);
    state = claim(state, HOUR);
    expect(state.held.white).toBe(0); expect(state.unclaimedUnits).toBe(String(HOUR));
    state = JSON.parse(JSON.stringify(state)) as State;
    expect(() => assertPostcardState(state)).not.toThrow();
    state = claim(state, 2 * HOUR);
    expect(state.held.white).toBe(0); expect(state.unclaimedUnits).toBe(String(2 * HOUR));
    state = claim(state, 3 * HOUR);
    expect(state.held.white).toBe(1); expect(state.unclaimedUnits).toBe('0'); conserved(state);
  });

  it('retains sub-millisecond-card credit at 7/hour instead of rounding it away on each claim', () => {
    const initial = createPostcardState('TEST-seven-per-hour', { numerator: 7, denominator: 1 }, 0);
    const beforeFirst = claim(initial, 514285), afterFirst = claim(beforeFirst, 514286);
    expect(beforeFirst.held.white).toBe(0); expect(beforeFirst.unclaimedUnits).toBe('3599995');
    expect(afterFirst.held.white).toBe(1); expect(afterFirst.unclaimedUnits).toBe('2');
    let split = initial;
    for (const atMs of [1, 514285, 514286, 1234567, HOUR]) split = claim(split, atMs);
    expect(split).toEqual(claim(initial, HOUR)); expect(split.held.white).toBe(7); conserved(split);
  });

  it('cannot claim the same interval twice at an unchanged timestamp', () => {
    const once = claim(fresh(), 12 * HOUR), again = claim(once, 12 * HOUR);
    expect(again).toEqual(once); conserved(again);
  });

  it.each(['TEST-baker', 'TEST-miller', 'TEST-courier', 'TEST-investigator', 'TEST-import-export', 'TEST-roleless'])
    ('uses the same explicit asset rules for the ordinary person ID %s', personId => {
      const state = claim(fresh(personId), 24 * HOUR);
      expect(state.personId).toBe(personId); expect(state.held.white).toBe(32); conserved(state);
    });
});

describe('guaranteed same-tier safe fusion', () => {
  it('consumes five same-tier pieces for one next-tier piece at every eligible tier', () => {
    let state = collectWhite(625);
    for (let index = 0; index < POSTCARD_TIERS.length - 1; index++) {
      const tier = POSTCARD_TIERS[index]!, nextTier = POSTCARD_TIERS[index + 1]!;
      while (state.held[tier] >= 5) {
        const before = state, saved = structuredClone(before), beforeValue = independentValue(before);
        state = fuse(before, tier);
        const expected = { ...before.held, [tier]: before.held[tier] - 5, [nextTier]: before.held[nextTier] + 1 };
        expect(state.held).toEqual(expected); expect(independentValue(state)).toBe(beforeValue);
        expect(state.unclaimedUnits).toBe(before.unclaimedUnits); expect(state.overflowUnits).toBe(before.overflowUnits);
        expect(state.clockMs).toBe(before.clockMs); expect(state.lastClaimAtMs).toBe(before.lastClaimAtMs);
        expect(before).toEqual(saved); conserved(state);
      }
    }
    expect(state.held).toEqual({ white: 0, green: 0, blue: 0, purple: 0, orange: 1 });
    expect(independentValue(state)).toBe(625n);
    const terminal = state;
    expect(() => fuse(terminal, 'orange')).toThrow();
    expect(terminal.held.orange).toBe(1);
  });

  it('cannot spend unclaimed White directly as a fusion ingredient', () => {
    const pending = clock(fresh(), 5 * HOUR / 2), original = structuredClone(pending);
    expect(pending.held.white).toBe(0);
    expect(() => fuse(pending, 'white')).toThrow(); expect(pending).toEqual(original);
    const claimed = claim(pending, pending.clockMs), fused = fuse(claimed, 'white');
    expect(fused.held.green).toBe(1); expect(fused.held.white).toBe(0); conserved(fused);
  });
});

describe('atomic postcard transaction and saved-state validation', () => {
  it.each([
    { numerator: 0, denominator: 1 }, { numerator: -1, denominator: 1 },
    { numerator: 1, denominator: 0 }, { numerator: 1, denominator: -1 },
    { numerator: 0.5, denominator: 1 }, { numerator: 1, denominator: 0.5 },
    { numerator: NaN, denominator: 1 }, { numerator: Infinity, denominator: 1 },
    { numerator: 1, denominator: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects a nonpositive, fractional or unsafe rational rate %o', rate => {
    expect(() => createPostcardState('TEST-person', rate, 0)).toThrow();
  });

  it('requires a real configured rate and an explicit valid initial timestamp', () => {
    expect(() => createPostcardState('TEST-person', undefined as never, 0)).toThrow();
    for (const atMs of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => createPostcardState('TEST-person', { numerator: 2, denominator: 1 }, atMs)).toThrow();
  });

  it('rejects forbidden recipes, malformed payloads and other-owner actions without changing any prior field', () => {
    const state = collectWhite(5), original = structuredClone(state), atMs = state.clockMs + HOUR;
    const invalid: unknown[] = [
      { kind: 'safeFusion', personId: state.personId, atMs, tier: 'orange' },
      { kind: 'safeFusion', personId: state.personId, atMs, tier: 'green' },
      { kind: 'safeFusion', personId: state.personId, atMs, tier: ['white', 'green'] },
      { kind: 'safeFusion', personId: state.personId, atMs, tier: 'white', target: 'orange' },
      { kind: 'safeFusion', personId: state.personId, atMs, tier: 'white', count: 4 },
      { kind: 'shortcutFusion', personId: state.personId, atMs, tier: 'white', count: 4 },
      { kind: 'claim', personId: 'TEST-other-person', atMs },
      { kind: 'clock', personId: state.personId, atMs, issue: 100 },
      { kind: 'claim', personId: state.personId, atMs, hostOperation: 'exec' },
      null, [], { kind: 'claim' },
    ];
    for (const event of invalid) {
      expect(() => applyPostcardEvent(state, event as never)).toThrow(); expect(state).toEqual(original); conserved(state);
    }
  });

  it('rejects time reversal, non-integer timestamps and unsafe arithmetic atomically', () => {
    const state = claim(fresh(), HOUR), original = structuredClone(state);
    for (const atMs of [HOUR - 1, -1, NaN, Infinity, HOUR + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => claim(state, atMs)).toThrow(); expect(state).toEqual(original);
    }
    const huge = createPostcardState('TEST-huge-rate', { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 }, 0);
    const saved = structuredClone(huge);
    expect(() => claim(huge, CAP)).toThrow(); expect(huge).toEqual(saved); conserved(huge);
  });

  it('rejects corrupted inventory, fractional counters, unknown state fields and resource imbalance', () => {
    const state = claim(fresh(), 12 * HOUR);
    const corruptions: unknown[] = [
      { ...state, held: { ...state.held, white: -1 } },
      { ...state, held: { ...state.held, white: 24.5 } },
      { ...state, held: { ...state.held, white: Number.MAX_SAFE_INTEGER + 1 } },
      { ...state, held: { ...state.held, white: 25 } },
      { ...state, unclaimedUnits: '-1' }, { ...state, unclaimedUnits: '00' },
      { ...state, unclaimedUnits: '1.5' }, { ...state, overflowUnits: '1' },
      { ...state, lastClaimAtMs: state.clockMs + 1 }, { ...state, clockMs: -1 },
      { ...state, format: 'invented-postcards' }, { ...state, technicalSecret: 'not a postcard field' },
    ];
    for (const value of corruptions) expect(() => assertPostcardState(value)).toThrow();
    conserved(state);
  });

  it('rejects executable properties in transaction data without invoking a getter', () => {
    const state = fresh(), saved = structuredClone(state); let read = false;
    const event = { kind: 'claim', personId: state.personId, atMs: 12 * HOUR };
    Object.defineProperty(event, 'atMs', { enumerable: true, get: () => { read = true; return 12 * HOUR; } });
    expect(() => applyPostcardEvent(state, event as never)).toThrow(); expect(read).toBe(false); expect(state).toEqual(saved);
  });
});
