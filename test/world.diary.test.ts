import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { recordEncounter, emptyIdentityLedger, IDENTITY_RESOLUTION_THRESHOLD } from '../src/engine/identity.js';
import { readDiary } from '../src/engine/diary.js';

/**
 * Real, wired integration for `engine/diary.ts` inside `stepWorld` (2026-08-13). Verifies
 * the queue-in/consume-and-clear pattern (`pendingDiaryEntries`, mirroring `pendingWallPosts`)
 * actually works against a real `World`, not just the standalone unit tests in
 * `test/diary.test.ts`.
 */

function resolvedLedger(observer: string, subject: string) {
  let ledger = emptyIdentityLedger();
  for (let i = 0; i < IDENTITY_RESOLUTION_THRESHOLD; i++) {
    ledger = recordEncounter(ledger, observer, subject);
  }
  return ledger;
}

describe('diary wired into stepWorld', () => {
  it('a queued entry about a resolved subject writes successfully and is readable back', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const author = world.millers[0]!.buildingId;
    const subject = world.bakers[0]!.buildingId;
    world = { ...world, identityLedger: resolvedLedger(author, subject) };
    world = {
      ...world,
      pendingDiaryEntries: [{ authorId: author, subject, observation: 'undercutMyPrice', reading: 'seemsCalculating', context: 'trade' }],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastDiaryWrites).toEqual([author]);
    expect(stepped.lastDiaryRejections).toEqual([]);
    const entries = readDiary(stepped.diary, author, stepped.tick, () => 0.99);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.subject).toBe(subject);
  });

  it('a queued entry about an unresolved subject is rejected, not silently dropped, and does not crash the tick', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    const author = world.millers[0]!.buildingId;
    const subject = world.bakers[0]!.buildingId;
    // identityLedger stays empty — subject is never resolved for author.
    world = {
      ...world,
      pendingDiaryEntries: [{ authorId: author, subject, observation: 'undercutMyPrice', reading: 'seemsCalculating' }],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastDiaryWrites).toEqual([]);
    expect(stepped.lastDiaryRejections).toHaveLength(1);
    expect(stepped.lastDiaryRejections[0]!.authorId).toBe(author);
    expect(readDiary(stepped.diary, author, stepped.tick, () => 0.99)).toEqual([]);
  });

  it('a self-entry is rejected the same way', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    const author = world.millers[0]!.buildingId;
    world = { ...world, identityLedger: resolvedLedger(author, author) };
    world = {
      ...world,
      pendingDiaryEntries: [{ authorId: author, subject: author, observation: 'soughtMeOut', reading: 'cantTellYet' }],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastDiaryWrites).toEqual([]);
    expect(stepped.lastDiaryRejections).toHaveLength(1);
  });

  it('pendingDiaryEntries is consumed and cleared every tick, same as pendingWallPosts', () => {
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    const author = world.millers[0]!.buildingId;
    const subject = world.bakers[0]!.buildingId;
    world = { ...world, identityLedger: resolvedLedger(author, subject) };
    world = {
      ...world,
      pendingDiaryEntries: [{ authorId: author, subject, observation: 'undercutMyPrice', reading: 'seemsCalculating' }],
    };

    const stepped = stepWorld(world);
    expect(stepped.pendingDiaryEntries).toEqual([]);

    // A second step with nothing newly queued writes nothing new.
    const steppedAgain = stepWorld(stepped);
    expect(steppedAgain.lastDiaryWrites).toEqual([]);
  });

  it('one entry rejected does not block a different valid entry the same tick', () => {
    let world = createWorld(5, DEFAULT_WORLD_CONFIG);
    const goodAuthor = world.millers[0]!.buildingId;
    const goodSubject = world.bakers[0]!.buildingId;
    const badAuthor = world.couriers[0]!.buildingId;
    const badSubject = world.journalists[0]!.buildingId; // never resolved for badAuthor
    world = { ...world, identityLedger: resolvedLedger(goodAuthor, goodSubject) };
    world = {
      ...world,
      pendingDiaryEntries: [
        { authorId: badAuthor, subject: badSubject, observation: 'avoidedMe', reading: 'seemsScared' },
        { authorId: goodAuthor, subject: goodSubject, observation: 'undercutMyPrice', reading: 'seemsCalculating' },
      ],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastDiaryWrites).toEqual([goodAuthor]);
    expect(stepped.lastDiaryRejections.map((r) => r.authorId)).toEqual([badAuthor]);
  });

  it('the diary store is the SAME mutable reference across ticks — the documented deliberate exception', () => {
    const world = createWorld(6, DEFAULT_WORLD_CONFIG);
    const stepped = stepWorld(world);
    expect(stepped.diary).toBe(world.diary);
  });
});
