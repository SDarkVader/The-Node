import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * Real, wired integration for `comms/proximityConversation.ts` inside `stepWorld`
 * (2026-08-18) — verifies the queue-in/consume-and-clear pattern (`pendingProximityUtterances`,
 * mirroring `pendingWallPosts`/`pendingDiaryEntries`) actually works against a real `World`
 * and its real spatial layout, not just the standalone pure-function tests in
 * `test/proximityConversation.test.ts`. Listener resolution reuses the SAME
 * `buildProximityGraph`/`config.commsProximityRange` machinery `pendingWallPosts` already
 * uses — see `world.ts`'s Stage 5 comment for why this is one shared graph, not two.
 */

describe('proximity conversation wired into stepWorld', () => {
  it('a self-addressed turn is rejected, not silently dropped, and does not crash the tick', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    const speaker = world.millers[0]!.buildingId;
    world = {
      ...world,
      pendingProximityUtterances: [
        { speakerId: speaker, intent: 'inform', tone: 'warm', referent: { kind: 'player', playerId: speaker } },
      ],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastProximityConversations).toEqual([]);
    expect(stepped.lastProximityRejections).toHaveLength(1);
    expect(stepped.lastProximityRejections[0]!.speakerId).toBe(speaker);
  });

  it('a turn addressed to someone not actually in proximity range is rejected the same way', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    const speaker = world.millers[0]!.buildingId;
    world = {
      ...world,
      pendingProximityUtterances: [
        { speakerId: speaker, intent: 'ask', tone: 'cold', referent: { kind: 'player', playerId: 'nobody-really-here' } },
      ],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastProximityConversations).toEqual([]);
    expect(stepped.lastProximityRejections).toHaveLength(1);
  });

  it('pendingProximityUtterances is always cleared after a tick, whether or not anything was heard', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    const speaker = world.millers[0]!.buildingId;
    world = {
      ...world,
      pendingProximityUtterances: [{ speakerId: speaker, intent: 'inform', tone: 'warm', referent: { kind: 'room' } }],
    };

    const stepped = stepWorld(world);

    expect(stepped.pendingProximityUtterances).toEqual([]);
  });

  it('no pending utterances means no heard events, no rejections, and the stage is a true no-op', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    world = stepWorld(world);
    expect(world.lastProximityConversations).toEqual([]);
    expect(world.lastProximityRejections).toEqual([]);
  });

  it('a real, positive signal: a room-directed turn from an occupant with a real neighbor is actually heard', () => {
    // Same "not guaranteed on every seed, real across a few" discipline
    // `test/world.regression.test.ts`'s matching pendingWallPosts test already established —
    // whether any two occupants land within `commsProximityRange` depends on the real
    // generated layout, so this tries a few seeds rather than assuming one.
    let heardAtLeastOnce = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let world = createWorld(seed, DEFAULT_WORLD_CONFIG);
      const speaker = world.millers[0]!.buildingId;
      world = {
        ...world,
        pendingProximityUtterances: [{ speakerId: speaker, intent: 'inform', tone: 'warm', referent: { kind: 'room' } }],
      };
      world = stepWorld(world);
      expect(world.lastProximityRejections).toEqual([]); // a room-referent from a real occupant never rejects
      if (world.lastProximityConversations.length > 0) {
        heardAtLeastOnce = true;
        for (const event of world.lastProximityConversations) {
          expect(event.heard.speakerId).toBe(speaker);
          expect(event.heard.clarity).toBeGreaterThan(0);
        }
        break;
      }
    }
    expect(heardAtLeastOnce).toBe(true);
  });

  it('one rejected turn does not block a different, valid turn the same tick', () => {
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    const badSpeaker = world.millers[0]!.buildingId;
    const goodSpeaker = world.bakers[0]!.buildingId;
    world = {
      ...world,
      pendingProximityUtterances: [
        { speakerId: badSpeaker, intent: 'inform', tone: 'warm', referent: { kind: 'player', playerId: badSpeaker } },
        { speakerId: goodSpeaker, intent: 'affirm', tone: 'playful', referent: { kind: 'room' } },
      ],
    };

    const stepped = stepWorld(world);

    expect(stepped.lastProximityRejections.map((r) => r.speakerId)).toEqual([badSpeaker]);
  });

  it('is ephemeral, not a store — a second tick with nothing newly queued reports nothing heard', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    const speaker = world.millers[0]!.buildingId;
    world = {
      ...world,
      pendingProximityUtterances: [{ speakerId: speaker, intent: 'inform', tone: 'warm', referent: { kind: 'room' } }],
    };
    world = stepWorld(world);

    const steppedAgain = stepWorld(world);

    expect(steppedAgain.lastProximityConversations).toEqual([]);
  });
});
