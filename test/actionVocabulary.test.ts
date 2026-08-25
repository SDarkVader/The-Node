import { describe, expect, it } from 'vitest';
import { parseGameAction, queueGameAction, applyClientAction } from '../src/server/actionVocabulary.js';
import { createWorld, DEFAULT_WORLD_CONFIG, isFilledRoleHolder } from '../src/world/world.js';

/**
 * The action vocabulary (2026-08-24) — the first three real, interpreted actions:
 * `wallPost`, `diaryEntry`, `proximityUtterance`. Pure-module tests for `parseGameAction`
 * (untrusted wire input, must never throw) and `queueGameAction`/`applyClientAction`
 * (real World wiring). The real-socket end-to-end path is `test/ws.actionVocabulary.test.ts`.
 */

const world0 = createWorld(1, DEFAULT_WORLD_CONFIG);
const millerId = world0.millers[0]!.buildingId;

describe('parseGameAction — untrusted input, total function', () => {
  it('accepts a well-formed wallPost', () => {
    expect(parseGameAction('wallPost', { state: 'hopeful' })).toEqual({ kind: 'wallPost', state: 'hopeful' });
  });

  it('accepts a well-formed diaryEntry, with and without optional context', () => {
    const withoutContext = parseGameAction('diaryEntry', { subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic' });
    expect(withoutContext).toEqual({ kind: 'diaryEntry', subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic', context: undefined });

    const withContext = parseGameAction('diaryEntry', { subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic', context: 'trade' });
    expect(withContext).toEqual({ kind: 'diaryEntry', subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic', context: 'trade' });
  });

  it('accepts a well-formed proximityUtterance, room and player referents', () => {
    const room = parseGameAction('proximityUtterance', { intent: 'inform', tone: 'warm', referent: { kind: 'room' } });
    expect(room).toEqual({ kind: 'proximityUtterance', intent: 'inform', tone: 'warm', referent: { kind: 'room' }, context: undefined });

    const player = parseGameAction('proximityUtterance', { intent: 'ask', tone: 'guarded', referent: { kind: 'player', playerId: 'p9' } });
    expect(player).toEqual({ kind: 'proximityUtterance', intent: 'ask', tone: 'guarded', referent: { kind: 'player', playerId: 'p9' }, context: undefined });
  });

  it('rejects an unknown action name', () => {
    expect(parseGameAction('doSomethingElse', { state: 'hopeful' })).toBeNull();
  });

  it('rejects every malformed shape rather than throwing, for each action kind', () => {
    const bad: [string, unknown][] = [
      ['wallPost', null],
      ['wallPost', 'hopeful'],
      ['wallPost', {}],
      ['wallPost', { state: 'not-a-real-state' }],
      ['wallPost', { state: 123 }],
      ['diaryEntry', {}],
      ['diaryEntry', { subject: '', observation: 'undercutMyPrice', reading: 'seemsOpportunistic' }],
      ['diaryEntry', { subject: 'p2', observation: 'notReal', reading: 'seemsOpportunistic' }],
      ['diaryEntry', { subject: 'p2', observation: 'undercutMyPrice', reading: 'notReal' }],
      ['diaryEntry', { subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic', context: 'notReal' }],
      ['proximityUtterance', {}],
      ['proximityUtterance', { intent: 'notReal', tone: 'warm', referent: { kind: 'room' } }],
      ['proximityUtterance', { intent: 'inform', tone: 'notReal', referent: { kind: 'room' } }],
      ['proximityUtterance', { intent: 'inform', tone: 'warm', referent: { kind: 'nonsense' } }],
      ['proximityUtterance', { intent: 'inform', tone: 'warm', referent: { kind: 'player' } }],
      ['proximityUtterance', { intent: 'inform', tone: 'warm', referent: null }],
    ];
    for (const [action, payload] of bad) {
      expect(() => parseGameAction(action, payload)).not.toThrow();
      expect(parseGameAction(action, payload)).toBeNull();
    }
  });
});

describe('queueGameAction — real World wiring', () => {
  it('a wallPost lands in pendingWallPosts with the given authorId, not from payload', () => {
    const world = queueGameAction(world0, millerId, { kind: 'wallPost', state: 'hopeful' });
    expect(world.pendingWallPosts).toHaveLength(1);
    expect(world.pendingWallPosts[0]).toMatchObject({ authorId: millerId, state: 'hopeful', day: world0.tick });
  });

  it('a diaryEntry lands in pendingDiaryEntries', () => {
    const world = queueGameAction(world0, millerId, { kind: 'diaryEntry', subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic' });
    expect(world.pendingDiaryEntries).toEqual([{ authorId: millerId, subject: 'p2', observation: 'undercutMyPrice', reading: 'seemsOpportunistic', context: undefined }]);
  });

  it('a proximityUtterance lands in pendingProximityUtterances with speakerId (not authorId)', () => {
    const world = queueGameAction(world0, millerId, { kind: 'proximityUtterance', intent: 'inform', tone: 'warm', referent: { kind: 'room' } });
    expect(world.pendingProximityUtterances).toEqual([{ speakerId: millerId, intent: 'inform', tone: 'warm', referent: { kind: 'room' }, context: undefined }]);
  });

  it('does not mutate the input world (immutable-snapshot convention)', () => {
    queueGameAction(world0, millerId, { kind: 'wallPost', state: 'hopeful' });
    expect(world0.pendingWallPosts).toHaveLength(0);
  });
});

describe('applyClientAction — the full gate', () => {
  it('queues a valid action from a real FILLED role holder', () => {
    const world = applyClientAction(world0, millerId, 'wallPost', { state: 'hopeful' });
    expect(world.pendingWallPosts).toHaveLength(1);
  });

  it('is a no-op when authorId is null (connection never bound an identity)', () => {
    const world = applyClientAction(world0, null, 'wallPost', { state: 'hopeful' });
    expect(world).toBe(world0);
  });

  it('is a no-op when the claimed buildingId is not a currently-FILLED role holder', () => {
    expect(isFilledRoleHolder(world0, 'not-a-real-building')).toBe(false);
    const world = applyClientAction(world0, 'not-a-real-building', 'wallPost', { state: 'hopeful' });
    expect(world).toBe(world0);
  });

  it('is a no-op when the payload is malformed, even for a real role holder', () => {
    const world = applyClientAction(world0, millerId, 'wallPost', { state: 'not-a-real-state' });
    expect(world).toBe(world0);
  });

  it('is a no-op for an unrecognized action, even for a real role holder', () => {
    const world = applyClientAction(world0, millerId, 'somethingUnrelated', { anything: true });
    expect(world).toBe(world0);
  });
});
