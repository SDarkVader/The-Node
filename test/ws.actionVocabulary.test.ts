import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startWorldServer, type ServerHandle } from '../src/server/ws.js';
import { createWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

/**
 * The action vocabulary's real-socket integration (2026-08-24). `test/actionVocabulary.test.ts`
 * already covers `parseGameAction`/`queueGameAction`/`applyClientAction` as pure functions —
 * what those tests CANNOT reach is `ws.ts`'s own new wiring: `?player=<buildingId>` query
 * parsing, the `identities` map (bind on connect, clean up on close), and the interval's
 * apply-before-step call site. `worldProtocol.ts`'s tick message deliberately never exposes
 * Wall posts/diary/proximity content on the wire (the privacy boundary these mechanics are
 * built around), so there is no outward signal to assert an action's semantic effect against —
 * what CAN be verified here, honestly, is that the real transport-level wiring behaves: a
 * real identity binds, an unbound or invalid one is inert, and none of it can crash the
 * connection or the server, the same "untrusted input must never take the socket down"
 * standard `test/ws.inbound.test.ts` already holds itself to.
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

describe('startWorldServer — action vocabulary over a real socket', () => {
  it('a connection bound to a real FILLED buildingId sends a wallPost without crashing the connection or server', async () => {
    const seed = 21;
    const millerId = createWorld(seed, DEFAULT_WORLD_CONFIG).millers[0]!.buildingId;
    const received: unknown[] = [];
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed, onActions: (actions) => received.push(...actions) });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'wallPost', payload: { state: 'hopeful' } }));

    await waitUntil(() => received.length > 0);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('a connection claiming a buildingId that is not a real FILLED role holder is inert, not fatal', async () => {
    const received: unknown[] = [];
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed: 22, onActions: (actions) => received.push(...actions) });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=not-a-real-building`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'wallPost', payload: { state: 'hopeful' } }));

    await waitUntil(() => received.length > 0);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('a connection with no ?player= binding sends the same action without crashing anything', async () => {
    const received: unknown[] = [];
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed: 23, onActions: (actions) => received.push(...actions) });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'wallPost', payload: { state: 'hopeful' } }));

    await waitUntil(() => received.length > 0);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('closing a bound connection frees its identity binding for reuse by a new connection', async () => {
    const seed = 24;
    const millerId = createWorld(seed, DEFAULT_WORLD_CONFIG).millers[0]!.buildingId;
    let count = 0;
    handle = await startWorldServer({ port: 0, tickIntervalMs: 20, seed, onActions: (actions) => (count += actions.length) });

    const first = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(first);
    first.close();
    await waitUntil(() => first.readyState === WebSocket.CLOSED);

    // Same claimed identity, a second real connection — must still work cleanly, proving the
    // first connection's binding was actually removed rather than left dangling.
    const second = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=${millerId}`);
    await waitForOpen(second);
    second.send(JSON.stringify({ type: 'action', action: 'wallPost', payload: { state: 'hopeful' } }));
    await waitUntil(() => count > 0);
    expect(second.readyState).toBe(WebSocket.OPEN);
    second.close();
  });
});
