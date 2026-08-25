import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startWorldServer, type ServerHandle } from '../src/server/ws.js';
import { createWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * The presence/session primitive's real-socket integration (2026-08-24). `test/presence.test.ts`
 * and `test/world.presence.test.ts` already cover the pure/World-level logic — what those
 * cannot reach is `ws.ts`'s own new wiring: building `World.currentlyOnline` from the real
 * `identities` map each tick. `presence` is deliberately not exposed on the wire (WITHHELD,
 * same privacy-boundary reasoning as wealth/experience — see `docs/BLUEPRINT.md` §5), so, same
 * as `test/ws.actionVocabulary.test.ts`, there is no outward signal to assert presence content
 * against from a socket. What IS verified here: a real connect/disconnect cycle, with and
 * without a bound identity, never crashes the connection or the server.
 */

let handle: ServerHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitUntil(check: () => boolean, timeoutMs = 20000, intervalMs = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

describe('startWorldServer — presence over a real socket', () => {
  it('a bound connection stays open across several real ticks', async () => {
    const seed = 31;
    const millerId = createWorld(seed, DEFAULT_WORLD_CONFIG).millers[0]!.buildingId;
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(ws);
    let ticks = 0;
    ws.on('message', () => (ticks += 1));
    await waitUntil(() => ticks >= 3);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('multiple simultaneous bound connections for different real role holders never crash the server', async () => {
    const seed = 32;
    const world = createWorld(seed, DEFAULT_WORLD_CONFIG);
    const millerId = world.millers[0]!.buildingId;
    const bakerId = world.bakers[0]!.buildingId;
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed });

    const a = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    const b = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${bakerId}`);
    await Promise.all([waitForOpen(a), waitForOpen(b)]);
    let ticksA = 0;
    let ticksB = 0;
    a.on('message', () => (ticksA += 1));
    b.on('message', () => (ticksB += 1));
    await waitUntil(() => ticksA >= 2 && ticksB >= 2);
    expect(a.readyState).toBe(WebSocket.OPEN);
    expect(b.readyState).toBe(WebSocket.OPEN);
    a.close();
    b.close();
  });

  it('disconnecting and reconnecting the same claimed identity never crashes anything', async () => {
    const seed = 33;
    const millerId = createWorld(seed, DEFAULT_WORLD_CONFIG).millers[0]!.buildingId;
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed });

    const first = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(first);
    first.close();
    await waitUntil(() => first.readyState === WebSocket.CLOSED);

    const second = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(second);
    let ticks = 0;
    second.on('message', () => (ticks += 1));
    await waitUntil(() => ticks >= 2);
    expect(second.readyState).toBe(WebSocket.OPEN);
    second.close();
  });

  it('an unbound connection (no ?player=) also stays open across several ticks', async () => {
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed: 34 });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    let ticks = 0;
    ws.on('message', () => (ticks += 1));
    await waitUntil(() => ticks >= 3);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
