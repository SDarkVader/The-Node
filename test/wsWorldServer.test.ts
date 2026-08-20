/**
 * End-to-end test of the real-world stream (2026-08-19): a genuine socket, a genuine
 * `stepWorld`, and the messages a client actually receives. The pure-transform tests live in
 * `worldProtocol.test.ts`; this one exists because the parts that break here are the ones
 * those cannot see — handshake ordering, per-connection secrets, and whether the timer
 * actually advances the world.
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startWorldServer } from '../src/server/ws.js';
import type { WorldMessage, WorldTickMessage, WorldHelloMessage } from '../src/server/worldProtocol.js';

const openHandles: { close: () => void }[] = [];
afterEach(() => {
  while (openHandles.length > 0) openHandles.pop()!.close();
});

/** Collects messages until `predicate` is satisfied, or rejects on timeout. */
function collectUntil(
  url: string,
  predicate: (msgs: WorldMessage[]) => boolean,
  timeoutMs = 15_000,
): Promise<{ messages: WorldMessage[]; socket: WebSocket }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: WorldMessage[] = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out with ${messages.length} messages: ${messages.map((m) => m.type).join(',')}`));
    }, timeoutMs);

    socket.on('message', (raw) => {
      messages.push(JSON.parse(String(raw)) as WorldMessage);
      if (predicate(messages)) {
        clearTimeout(timer);
        resolve({ messages, socket });
      }
    });
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe('startWorldServer — streaming a real World', () => {
  it('sends geometry first, then a tick, on connection', async () => {
    const handle = await startWorldServer({ tickIntervalMs: 200, seed: 11 });
    openHandles.push(handle);

    const { messages, socket } = await collectUntil(`ws://127.0.0.1:${handle.port}`, (m) => m.length >= 2);
    socket.close();

    expect(messages[0]!.type).toBe('hello');
    expect(messages[1]!.type).toBe('tick');

    const hello = messages[0] as WorldHelloMessage;
    expect(hello.buildings.length).toBeGreaterThan(0);
    expect(hello.plots.length).toBeGreaterThan(0);
    // The Wall sits in the middle of the town as of 2026-08-19 — a client can rely on that.
    expect(hello.hub).toEqual({ x: 0, y: 0 });
  });

  it('advances the world on its timer — day increases, and people are really there', async () => {
    const handle = await startWorldServer({ tickIntervalMs: 150, seed: 12 });
    openHandles.push(handle);

    const { messages, socket } = await collectUntil(
      `ws://127.0.0.1:${handle.port}`,
      (m) => m.filter((x) => x.type === 'tick').length >= 3,
    );
    socket.close();

    const ticks = messages.filter((m): m is WorldTickMessage => m.type === 'tick');
    expect(ticks[ticks.length - 1]!.day).toBeGreaterThan(ticks[0]!.day);
    expect(ticks[0]!.people.length).toBeGreaterThan(0);
    expect(ticks[0]!.stations.length).toBeGreaterThan(0);
  });

  it('gives two connections different handles for the same population — no cross-client correlation', async () => {
    const handle = await startWorldServer({ tickIntervalMs: 200, seed: 13 });
    openHandles.push(handle);

    const url = `ws://127.0.0.1:${handle.port}`;
    const [a, b] = await Promise.all([
      collectUntil(url, (m) => m.length >= 2),
      collectUntil(url, (m) => m.length >= 2),
    ]);
    a.socket.close();
    b.socket.close();

    const tickA = a.messages.find((m): m is WorldTickMessage => m.type === 'tick')!;
    const tickB = b.messages.find((m): m is WorldTickMessage => m.type === 'tick')!;
    expect(tickA.people.length).toBeGreaterThan(0);

    const handlesA = new Set(tickA.people.map((p) => p.handle));
    const shared = tickB.people.filter((p) => handlesA.has(p.handle));
    // The two clients see the SAME town and the SAME number of bodies...
    expect(tickB.people.length).toBe(tickA.people.length);
    // ...under completely disjoint handles.
    expect(shared.length).toBe(0);
  });

  it('never puts private state on a real socket, not just in a unit test', async () => {
    const handle = await startWorldServer({ tickIntervalMs: 150, seed: 14 });
    openHandles.push(handle);

    const { messages, socket } = await collectUntil(
      `ws://127.0.0.1:${handle.port}`,
      (m) => m.filter((x) => x.type === 'tick').length >= 2,
    );
    socket.close();

    const wire = JSON.stringify(messages).toLowerCase();
    for (const key of ['wealth', 'gini', 'experience', 'diary', 'saboteur', 'campaign']) {
      expect(wire).not.toContain(key);
    }
  });
});
