import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  startWorldServer,
  startServer,
  parseClientMessage,
  MAX_PENDING_ACTIONS,
  type ServerHandle,
} from '../src/server/ws.js';
import type { PendingClientAction } from '../src/mvp/scenario.js';

/**
 * The inbound pipe (2026-08-19). Until this existed the socket was write-only: it broadcast
 * ticks outward and read nothing, so a connected client could not send the server anything at
 * all.
 *
 * WHAT THESE TESTS ASSERT, AND WHAT THEY DELIBERATELY DO NOT. They prove bytes travel from a
 * real client, over a real socket, into a real server, and come back out observable — nothing
 * more. **No test here asserts that any action MEANS anything**, because no action means
 * anything yet: the vocabulary is undesigned on purpose, to be settled by hand against the
 * scenario mechanics rather than invented by whoever wired the transport.
 *
 * The negative assertions matter as much as the positive ones. A malformed frame must be
 * dropped without killing the connection — a client is untrusted input, and a server that dies
 * on bad JSON is worse than one that cannot receive at all.
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

// 8000ms was too tight: this test spins up a real socket + a real server alongside 61 other
// test files running concurrently, several of them multi-thousand-day World simulations. Under
// full-suite CPU contention the round-trip occasionally starves past 8s even though nothing is
// actually broken — reproduced once, gone on immediate retry, confirmed by running in isolation
// (passes instantly) vs. the full suite (flaked once in several runs). Raised rather than
// ignored, same lesson `vitest.config.ts`'s own testTimeout note already recorded once.
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

describe('parseClientMessage — untrusted input, total function', () => {
  it('accepts a well-formed action and preserves the payload untouched', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'action', action: 'anything', payload: { a: [1, 2] } }));
    expect(msg).toEqual({ type: 'action', action: 'anything', payload: { a: [1, 2] } });
  });

  it('accepts any payload shape, because no payload shape is defined yet', () => {
    for (const payload of [null, 0, 'str', [], { nested: { deep: true } }, undefined]) {
      const msg = parseClientMessage(JSON.stringify({ type: 'action', action: 'x', payload }));
      expect(msg?.action).toBe('x');
    }
  });

  it('returns null for every malformed shape rather than throwing', () => {
    const bad = [
      'not json at all',
      '',
      '[]',
      'null',
      '"a string"',
      '42',
      JSON.stringify({ type: 'tick' }),
      JSON.stringify({ type: 'action' }),
      JSON.stringify({ type: 'action', action: 123 }),
      JSON.stringify({ type: 'action', action: '' }),
      JSON.stringify({ action: 'missing-type' }),
    ];
    for (const raw of bad) {
      expect(() => parseClientMessage(raw)).not.toThrow();
      expect(parseClientMessage(raw)).toBeNull();
    }
  });
});

describe('inbound pipe — real server, real socket, real message', () => {
  it('a client message reaches the world server and is reported back, uninterpreted', async () => {
    const received: PendingClientAction[] = [];
    handle = await startWorldServer({
      port: 0,
      tickIntervalMs: 20,
      seed: 7,
      onActions: (actions) => received.push(...actions),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'probe', payload: { n: 1 } }));

    await waitUntil(() => received.length > 0);
    ws.close();

    expect(received).toHaveLength(1);
    expect(received[0]!.action).toBe('probe');
    expect(received[0]!.payload).toEqual({ n: 1 });
    // Tagged with the connection it arrived on, so a recorder can tell two clients apart.
    expect(typeof received[0]!.connectionId).toBe('string');
  });

  it('carries the tick the actions landed on, so input can be recorded against output', async () => {
    const seen: { count: number; tick: number }[] = [];
    handle = await startWorldServer({
      port: 0,
      tickIntervalMs: 20,
      seed: 8,
      onActions: (actions, tick) => seen.push({ count: actions.length, tick }),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'a', payload: null }));
    await waitUntil(() => seen.length > 0);
    ws.close();

    expect(seen[0]!.count).toBeGreaterThan(0);
    expect(Number.isInteger(seen[0]!.tick)).toBe(true);
    expect(seen[0]!.tick).toBeGreaterThan(0);
  });

  it('drains between ticks — an action is reported once, not repeatedly', async () => {
    const batches: number[] = [];
    handle = await startWorldServer({
      port: 0,
      tickIntervalMs: 20,
      seed: 9,
      onActions: (actions) => batches.push(actions.length),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'action', action: 'once', payload: null }));
    await waitUntil(() => batches.length > 0);
    // Let several further ticks elapse; a queue that is not drained would report again.
    await new Promise((r) => setTimeout(r, 150));
    ws.close();

    expect(batches.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('drops malformed frames without killing the connection or the server', async () => {
    const received: PendingClientAction[] = [];
    handle = await startWorldServer({
      port: 0,
      tickIntervalMs: 20,
      seed: 10,
      onActions: (actions) => received.push(...actions),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);

    let closedUnexpectedly = false;
    ws.on('close', () => {
      closedUnexpectedly = true;
    });

    ws.send('{ this is not json');
    ws.send(JSON.stringify({ type: 'nonsense' }));
    ws.send(JSON.stringify({ type: 'action' }));
    // ...then a good one, which must still get through: the bad frames are dropped, not fatal.
    ws.send(JSON.stringify({ type: 'action', action: 'survivor', payload: 1 }));

    await waitUntil(() => received.length > 0);
    expect(closedUnexpectedly).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();

    expect(received).toHaveLength(1);
    expect(received[0]!.action).toBe('survivor');
  });

  it('caps the queue rather than buffering an unbounded flood', async () => {
    let total = 0;
    handle = await startWorldServer({
      port: 0,
      // Long tick so everything lands in one batch before a drain can occur.
      tickIntervalMs: 400,
      seed: 11,
      onActions: (actions) => {
        total += actions.length;
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/`);
    await waitForOpen(ws);
    for (let i = 0; i < MAX_PENDING_ACTIONS + 120; i++) {
      ws.send(JSON.stringify({ type: 'action', action: 'flood', payload: i }));
    }
    await waitUntil(() => total > 0, 9000);
    ws.close();

    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(MAX_PENDING_ACTIONS);
  });

  it('the legacy scenario path receives too — both servers share one receiver', async () => {
    handle = await startServer({ port: 0, tickIntervalMs: 20, seed: 12 });

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/?player=wren`);
    await waitForOpen(ws);

    let closed = false;
    ws.on('close', () => {
      closed = true;
    });

    ws.send(JSON.stringify({ type: 'action', action: 'legacy-probe', payload: null }));
    ws.send('garbage');
    // The legacy path has no observer hook; what is asserted is that it accepts the frames and
    // keeps serving. Its own DayResult echo is covered by the scenario unit tests.
    await new Promise((r) => setTimeout(r, 120));

    expect(closed).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
