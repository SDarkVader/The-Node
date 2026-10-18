import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResponsesBroker } from '../src/agent/responsesBroker.js';
import { AccountingLedger, usageCost } from '../src/agent/accountingLedger.js';
import { submitAccountedDecision } from '../src/agent/accountedBroker.js';
import { evidenceHash, replay } from '../src/agent/replay.js';
import { setup, rates, authorize, response, track } from './fixtures/accountingFixture.js';
import { participant, listen, cleanupResponses } from './fixtures/responsesFixture.js';
afterEach(cleanupResponses);
function jsonServer(bytes = response()) { return createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(bytes); }); }

describe('durable final-wire broker accounting with a real local service fixture', () => {
  it('persists the exact final wire hash/ceiling before the service sees bytes and retains count after settlement', async () => {
    const { ledger, directory } = setup(), prices = authorize(ledger), p = participant(); let calls = 0;
    const url = await listen(createServer((req, res) => {
      calls++; const q = ledger.view().requests[0]!;
      expect(q.request.inputSha256).toBe(p.request.sha256); expect(q.request.maxInputTokens).toBe(Buffer.byteLength(p.request.body) + 4096);
      expect(q.ceilingMicroUsd).toBe(usageCost(p.request.maxInputTokens, 2048, prices)); expect(q.bookedMicroUsd).toBeNull();
      const disk = JSON.parse(JSON.parse(readFileSync(join(directory, 'accounting.journal.json'), 'utf8')).payload);
      expect(disk.events.at(-1).kind).toBe('reservation'); expect(req.headers.authorization).toBe('Bearer fixture-only-no-provider-key');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response());
    }));
    const broker = new ResponsesBroker(ledger);
    expect((await broker.evaluateLoopbackFixture(p.request, prices, url, () => p.host.read(p.session).context)).kind).toBe('validated_offline');
    expect(ledger.view()).toMatchObject({ admissionsCharged: 10, bookedMicroUsd: 19_144n, heldMicroUsd: 100n }); expect(calls).toBe(1);
    await expect(broker.evaluateLoopbackFixture(p.request, prices, url, () => p.host.read(p.session).context)).rejects.toThrow('responses_request_duplicate'); expect(calls).toBe(1);
  });
  it('never opens live transport, reads a key, or reserves the real account while the protected gate is closed', async () => {
    const { ledger } = setup(), prices = rates(ledger), p = participant(); let reads = 0; const before = ledger.view().journalHash;
    await expect(new ResponsesBroker(ledger).evaluateLive(p.request, prices, () => { reads++; return 'must-not-read'; },
      { proxyUrl: 'http://not-contacted.invalid/', caPem: '' }, new AbortController().signal, () => p.host.read(p.session).context)).rejects.toThrow('recovery_accounting_unresolved');
    expect(reads).toBe(0); expect(ledger.view().journalHash).toBe(before); expect(ledger.view().admissionsCharged).toBe(9);
  });
  it('refuses unreconciled history and invalid configuration before the local service is contacted', async () => {
    const { ledger } = setup(), prices = rates(ledger), p = participant(); let calls = 0;
    const url = await listen(createServer((_req, res) => { calls++; res.end(); })); const broker = new ResponsesBroker(ledger);
    await expect(broker.evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context)).rejects.toThrow('operator_reconciliation_required');
    await expect(broker.evaluateLoopbackFixture(p.request, prices, 'https://api.openai.com/v1/responses', () => p.observation.context)).rejects.toThrow('responses_fixture_endpoint');
    expect(calls).toBe(0); expect(ledger.view().admissionsCharged).toBe(9);
  });
  it.each([401, 403, 429])('retains the entire reserve and never retries HTTP %s', async status => {
    const { ledger, directory } = setup(), prices = authorize(ledger), p = participant(); let calls = 0;
    const url = await listen(createServer((_req, res) => { calls++; res.writeHead(status); res.end('private-error-not-logged'); }));
    expect(await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context))
      .toEqual({ kind: 'rejected', code: 'provider_transport_failed_reservation_held' });
    const expected = ledger.view(); expect(expected.requests[0]).toMatchObject({ bookedMicroUsd: null, uncertain: true }); expect(calls).toBe(1);
    ledger.close(); expect(track(AccountingLedger.open(directory)).view()).toEqual(expected);
  });
  it('books known usage before rejecting a stale decision after actual HTTP', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant();
    const url = await listen(createServer((_req, res) => { p.host.advance(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response()); }));
    expect(await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.host.read(p.session).context)).toEqual({ kind: 'rejected', code: 'stale_context' });
    expect(ledger.view().bookedMicroUsd).toBe(19_144n); expect(p.host.exportTape().ticks[0]!.actions).toHaveLength(0);
  });
  it('keeps the reserve for malformed or incomplete wire bodies and books a known incomplete response', async () => {
    for (const bytes of [Buffer.from('{'), response({ status: 'incomplete' })]) {
      const { ledger } = setup(), prices = authorize(ledger), p = participant(), url = await listen(jsonServer(bytes));
      expect((await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context)).kind).toBe('rejected');
      expect(ledger.view().requests[0]!.bookedMicroUsd).toBe(bytes.toString() === '{' ? null : 30n);
    }
  });
  it('never reserves for a pre-aborted fixture', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant(), url = await listen(jsonServer()); const c = new AbortController(); c.abort();
    await expect(new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context, {}, c.signal)).rejects.toThrow('responses_aborted');
    expect(ledger.view().admissionsCharged).toBe(9);
  });
  it('retains cancellation and full unknown reserve on an in-flight socket', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant(), c = new AbortController();
    const url = await listen(createServer(() => c.abort()));
    expect((await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context, {}, c.signal)).kind).toBe('rejected');
    expect(ledger.view().requests[0]).toMatchObject({ cancelled: true, uncertain: true, bookedMicroUsd: null }); expect(ledger.view().admissionsCharged).toBe(10);
  });
  it('books cost but rejects an action when the deadline expires during asynchronous host validation', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant(), url = await listen(jsonServer());
    const result = await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, async () => {
      expect(ledger.view().bookedMicroUsd).toBe(19_144n); await new Promise(resolve => setTimeout(resolve, 500)); return p.observation.context;
    }, { deadlineMs: 300 });
    expect(result).toEqual({ kind: 'rejected', code: 'request_cancelled' }); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('enforces the deadline even when a synchronous host callback blocks timer delivery', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant(), url = await listen(jsonServer());
    const result = await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => {
      const stop = performance.now() + 500; while (performance.now() < stop) { /* Mechanical synchronous stall. */ }
      return p.observation.context;
    }, { deadlineMs: 300 });
    expect(result).toEqual({ kind: 'rejected', code: 'request_cancelled' }); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('does not dispatch on reservation failure and does not return an action on receipt write failure', async () => {
    for (const failure of [1, 2]) {
      let armed = false, writes = 0, calls = 0;
      const { ledger, directory } = setup({ fault: stage => { if (armed && stage === 'before_write' && ++writes === failure) throw Error('mechanical write failure'); } });
      const prices = authorize(ledger), p = participant(), url = await listen(createServer((_req, res) => { calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response()); })); armed = true;
      await expect(new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.observation.context)).rejects.toThrow('accounting_write_failed');
      expect(calls).toBe(failure === 1 ? 0 : 1); ledger.close(); const reopened = track(AccountingLedger.open(directory));
      expect(reopened.view().admissionsCharged).toBe(failure === 1 ? 9 : 10); expect(reopened.view().historicalActorBookedMicroUsd).toBe(19_114);
      if (failure === 2) expect(reopened.view().requests[0]!.bookedMicroUsd).toBeNull();
    }
  });
  it('joins actual wire transport, usage accounting, authenticated price effect and full replay', async () => {
    const { ledger } = setup(), prices = authorize(ledger), p = participant(); const value = JSON.parse(response().toString());
    value.output[0].content[0].text = JSON.stringify({ move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } });
    value.output.unshift({ type: 'reasoning', summary: [], content: [], encrypted_content: 'opaque-fixture-metadata' });
    const url = await listen(jsonServer(Buffer.from(JSON.stringify(value))));
    const result = await new ResponsesBroker(ledger).evaluateLoopbackFixture(p.request, prices, url, () => p.host.read(p.session).context);
    if (result.kind !== 'validated_offline') throw Error('fixture decision was not accepted');
    submitAccountedDecision(p.host, p.session, p.observation.observationId, p.observation.context.tick, result.decision);
    expect(p.host.advance().some(effect => effect.category === 'bakerPrice')).toBe(true);
    expect(evidenceHash(replay(p.host.exportTape(), p.genesis.sourceRevision))).toBe(p.host.evidence()); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
});
