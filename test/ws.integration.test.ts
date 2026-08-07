import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type ServerHandle } from '../src/server/ws.js';
import { mulberry32 } from '../src/sim/rng.js';
import { initScenario, stepScenario, type ScenarioState } from '../src/mvp/scenario.js';

/**
 * Verifies the targeted-rumour-delivery fix (2026-08-07) actually works end to end, not
 * just that the code compiles — same "simulate before trusting" discipline as everywhere
 * else in this repo. Ground truth is computed independently by replaying the exact same
 * seeded scenario the server runs internally, then checked against what each connected
 * client actually received over the wire.
 */

let handle: ServerHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function waitUntil(check: () => boolean, timeoutMs = 8000, intervalMs = 10): Promise<void> {
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

function collectMessages(ws: WebSocket): unknown[] {
  const received: unknown[] = [];
  ws.on('message', (data) => {
    received.push(JSON.parse(data.toString()));
  });
  return received;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

describe('WS server — targeted rumour delivery', () => {
  it('each player receives only their own rumours; broadcast never leaks heardBy/heardFrom to others', async () => {
    const SEED = 42;
    const TICKS = 150;

    // Ground truth: replay the identical seeded scenario independently of the server.
    let state: ScenarioState = initScenario(mulberry32(SEED));
    const expectedCountByRecipient = new Map<string, number>();
    for (let day = 0; day < TICKS; day++) {
      const stepped = stepScenario(state);
      state = stepped.state;
      for (const r of stepped.result.rumours) {
        expectedCountByRecipient.set(r.heardBy, (expectedCountByRecipient.get(r.heardBy) ?? 0) + 1);
      }
    }
    const wrenExpected = expectedCountByRecipient.get('wren') ?? 0;
    const sableExpected = expectedCountByRecipient.get('sable') ?? 0;
    // Sanity check on the test setup itself: this seed must actually exercise the mill,
    // or the assertions below would pass vacuously.
    expect(wrenExpected + sableExpected).toBeGreaterThan(0);

    handle = await startServer({ port: 0, tickIntervalMs: 20, seed: SEED });
    const { port } = handle;

    const wrenWs = new WebSocket(`ws://127.0.0.1:${port}?player=wren`);
    const sableWs = new WebSocket(`ws://127.0.0.1:${port}?player=sable`);
    await Promise.all([waitForOpen(wrenWs), waitForOpen(sableWs)]);

    const wrenReceived = collectMessages(wrenWs);
    const sableReceived = collectMessages(sableWs);

    await waitUntil(
      () =>
        wrenReceived.some((m) => (m as { type?: string; day?: number }).type === 'tick' && (m as { day: number }).day >= TICKS) &&
        sableReceived.some((m) => (m as { type?: string; day?: number }).type === 'tick' && (m as { day: number }).day >= TICKS),
    );

    wrenWs.close();
    sableWs.close();

    // The interval keeps firing every tickIntervalMs regardless of when the poll above
    // notices day>=TICKS was reached, so a few extra ticks beyond TICKS may have already
    // been delivered by the time the sockets close. Filter to the exact window the
    // ground truth covers (day 1..TICKS) rather than racing to close sockets in time.
    const wrenRumours = wrenReceived.filter(
      (m) => (m as { type?: string; day?: number }).type === 'rumour' && (m as { day: number }).day <= TICKS,
    );
    const sableRumours = sableReceived.filter(
      (m) => (m as { type?: string; day?: number }).type === 'rumour' && (m as { day: number }).day <= TICKS,
    );

    expect(wrenRumours.length).toBe(wrenExpected);
    expect(sableRumours.length).toBe(sableExpected);

    // The protocol split itself: no tick message carries rumour data, and no rumour
    // message carries a heardBy field at all — delivery IS the addressing now, the
    // payload doesn't need to (and can't be made to) declare who it's for.
    for (const m of [...wrenReceived, ...sableReceived]) {
      const msg = m as Record<string, unknown>;
      if (msg.type === 'tick') expect(msg).not.toHaveProperty('rumours');
      if (msg.type === 'rumour') expect(msg).not.toHaveProperty('heardBy');
    }
  });

  it('an unidentified connection (no ?player=) gets the shared broadcast but zero targeted rumours', async () => {
    handle = await startServer({ port: 0, tickIntervalMs: 5, seed: 42 });
    const { port } = handle;

    const anonWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(anonWs);
    const received = collectMessages(anonWs);

    await waitUntil(() => received.some((m) => (m as { type?: string; day?: number }).type === 'tick' && (m as { day: number }).day >= 50));
    anonWs.close();

    expect(received.some((m) => (m as { type?: string }).type === 'tick')).toBe(true);
    expect(received.some((m) => (m as { type?: string }).type === 'rumour')).toBe(false);
  });
});
