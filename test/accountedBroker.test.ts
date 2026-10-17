import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { AccountingLedger } from '../src/agent/accountingLedger.js';
import { AccountedBroker, submitAccountedDecision } from '../src/agent/accountedBroker.js';
import { OfflineParticipantHost } from '../src/agent/host.js';
import { createDurableHost, openDurableHost } from '../src/agent/durableHost.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { evidenceHash, replay } from '../src/agent/replay.js';
import { assertLiveAdmission } from '../src/agent/broker.js';
import { setup, rates, authorize, context, response, root, track, cleanup } from './fixtures/accountingFixture.js';

const hosts: OfflineParticipantHost[] = [];
afterEach(() => { for (const h of hosts.splice(0)) { try { h.close(); } catch {} } cleanup(); });
function participant(directory?: string, fault?: (stage: string) => void) {
  const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
  const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!;
  const host = directory ? createDurableHost(directory, genesis, person.id, 'recorded-response-controller-token', { fault })
    : new OfflineParticipantHost(genesis, person.id, 'recorded-response-controller-token');
  hosts.push(host); return { host, genesis, session: host.authenticate('recorded-response-controller-token') };
}
function priceResponse(price = 0.75) {
  const value = JSON.parse(response().toString()); value.output[0].content[0].text = JSON.stringify({ move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price } });
  return Buffer.from(JSON.stringify(value));
}

describe('accounted broker request preparation', () => {
  it('denies the actual recovery state without transport, a new count, or zero initialization', () => {
    const { ledger } = setup(); const broker = new AccountedBroker(ledger), prices = rates(ledger);
    const before = ledger.view().journalHash;
    expect(() => broker.prepare(context(), prices)).toThrow('operator_reconciliation_required');
    expect(ledger.view().journalHash).toBe(before); expect(ledger.view().admissionsCharged).toBe(9);
  });
  it('commits a bounded input hash and full byte/framing ceiling before returning the policy document', () => {
    const { ledger, directory } = setup(); const broker = new AccountedBroker(ledger), prices = authorize(ledger);
    const prepared = broker.prepare(context(), prices); const request = ledger.view().requests[0]!.request;
    expect(prepared.dispatchAllowed).toBe(false); expect(prepared.inputSha256).toBe(request.inputSha256);
    expect(request.maxInputTokens).toBe(Buffer.byteLength(prepared.policyJson) + 4096);
    const disk = JSON.parse(JSON.parse(readFileSync(join(directory, 'accounting.journal.json'), 'utf8')).payload);
    expect(disk.events.at(-1).kind).toBe('reservation');
    expect(() => broker.prepare(context(), prices)).toThrow('accounted_request_duplicate');
    expect(() => assertLiveAdmission()).toThrow();
  });
  it('includes the full authorized host projection and excludes controller, observation and world secrets', () => {
    const { ledger } = setup(); const p = participant(); const before = p.host.evidence();
    const prepared = new AccountedBroker(ledger).prepareFromHost(p.host, p.session, authorize(ledger)); const policy = JSON.parse(prepared.policyJson);
    expect(Buffer.byteLength(prepared.policyJson)).toBeLessThanOrEqual(32_768); expect(policy).not.toHaveProperty('input');
    expect(policy.observation.self.wealth).toBeTypeOf('number'); expect(policy.observation.geometry.districts.length).toBeGreaterThan(0);
    expect(policy.observation).toHaveProperty('diary'); expect(policy.observation).toHaveProperty('rumours'); expect(policy.observation).toHaveProperty('proximity');
    for (const secret of [p.session, p.host.read(p.session).observationId, 'recorded-response-controller-token', p.genesis.observerSecret]) expect(prepared.policyJson).not.toContain(secret);
    expect(policy).not.toHaveProperty('seed'); expect(policy).not.toHaveProperty('World'); expect(p.host.evidence()).toBe(before);
  });
  it('rejects unauthenticated host reads and invalid inputs before a reservation', () => {
    const { ledger } = setup(); const p = participant(), prices = authorize(ledger), broker = new AccountedBroker(ledger);
    expect(() => broker.prepareFromHost(p.host, 'wrong session', prices)).toThrow('invalid_session');
    expect(() => broker.prepare({ ...context(), tick: -1 }, prices)).toThrow(); expect(ledger.view().admissionsCharged).toBe(9);
  });
});

describe('accounting before response acceptance', () => {
  it('books known usage before validating a whole decision, and consumes a response once across reopening', async () => {
    const { ledger, directory } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
    const result = await broker.complete(prepared.id, response(), () => { expect(ledger.view().bookedMicroUsd).toBe(19_144n); return context(); });
    expect(result.kind).toBe('validated_offline'); ledger.close(); const reopened = track(AccountingLedger.open(directory));
    expect(await new AccountedBroker(reopened).complete(prepared.id, response(), context)).toEqual({ kind: 'rejected', code: 'response_already_consumed' });
    expect(reopened.view().admissionsCharged).toBe(10); expect(reopened.view().bookedMicroUsd).toBe(19_144n);
  });
  it.each(['failed', 'incomplete', 'cancelled'])('books usage even for %s provider status', async status => {
    const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
    expect((await broker.complete(prepared.id, response({ status }), context)).kind).toBe('rejected');
    expect(ledger.view()).toMatchObject({ bookedMicroUsd: 19_144n, heldMicroUsd: 100n, admissionsCharged: 10 });
  });
  it('books known usage on malformed decision JSON, an unsupported tool, refusal and invalid action', async () => {
    for (const mutate of [(v: any) => v.output[0].content[0].text = 'bad JSON', (v: any) => v.output.push({ type: 'function_call', name: 'shell' }),
      (v: any) => v.output[0].content = [{ type: 'refusal', refusal: 'no' }], (v: any) => v.output[0].content[0].text = JSON.stringify({ role: { kind: 'bakerPrice', price: 999 } })]) {
      const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
      const value = JSON.parse(response().toString()); mutate(value);
      expect((await broker.complete(prepared.id, Buffer.from(JSON.stringify(value)), context)).kind).toBe('rejected');
      expect(ledger.view().bookedMicroUsd).toBe(19_144n); expect(ledger.view().admissionsCharged).toBe(10);
    }
  });
  it('retains cost when the context is stale, affordances change, or the current host is unavailable', async () => {
    for (const current of [() => ({ ...context(), tick: 1 }), () => ({ ...context(), roleEpoch: 1 }),
      () => ({ ...context(), presentRefs: ['new-person'] }), () => { throw Error('host unavailable'); }]) {
      const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
      expect((await broker.complete(prepared.id, response(), current)).kind).toBe('rejected'); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
    }
  });
  it('keeps malformed whole envelopes and missing/invalid usage at full reserve', async () => {
    for (const bytes of [Buffer.from('{'), response({ usage: null }), response({ model: 'wrong-model' }), response({ usage: { input_tokens: 10, output_tokens: -1, total_tokens: 9 } })]) {
      const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
      const held = ledger.view().heldMicroUsd; expect((await broker.complete(prepared.id, bytes, context)).kind).toBe('rejected');
      expect(ledger.view().heldMicroUsd).toBe(held); expect(ledger.view().requests[0]!.bookedMicroUsd).toBeNull();
    }
  });
  it('records over-limit usage honestly and rejects all actions', async () => {
    const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
    const result = await broker.complete(prepared.id, response({ usage: { input_tokens: 10_000_000, output_tokens: 0, total_tokens: 10_000_000 } }), context);
    expect(result).toEqual({ kind: 'rejected', code: 'usage_exceeded_reservation' }); expect(ledger.view().bookedMicroUsd).toBe(10_019_114n);
    expect(ledger.view().remainingMicroUsd! < 0n).toBe(true);
  });
  it('claims completion durably so concurrent adapters cannot return the same action twice', async () => {
    const { ledger } = setup(); const prices = authorize(ledger), first = new AccountedBroker(ledger), second = new AccountedBroker(ledger);
    const prepared = first.prepare(context(), prices);
    const results = await Promise.all([first.complete(prepared.id, response(), context), second.complete(prepared.id, response(), context)]);
    expect(results.filter(r => r.kind === 'validated_offline')).toHaveLength(1);
    expect(results).toContainEqual({ kind: 'rejected', code: 'response_already_consumed' }); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('never republishes a claimed response after an interrupted decision write', async () => {
    let armed = false, writes = 0;
    const { ledger, directory } = setup({ fault: stage => { if (armed && stage === 'before_write' && ++writes === 3) throw Error('decision persist failure'); } });
    const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger)); armed = true;
    await expect(broker.complete(prepared.id, response(), context)).rejects.toThrow('accounting_write_failed'); ledger.close();
    const reopened = track(AccountingLedger.open(directory)); expect(reopened.view().requests[0]).toMatchObject({ decisionClaimed: true, decision: null, bookedMicroUsd: 30n });
    expect(await new AccountedBroker(reopened).complete(prepared.id, response(), context)).toEqual({ kind: 'rejected', code: 'response_already_consumed' });
  });
  it('retains cancellation and late known billing without a dispatch retry', async () => {
    const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger)); broker.cancel(prepared.id);
    expect(ledger.view().requests[0]!.bookedMicroUsd).toBeNull();
    expect(await broker.complete(prepared.id, response(), context)).toEqual({ kind: 'rejected', code: 'request_previously_uncertain' });
    expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('honors cancellation during validation after usage has already been booked', async () => {
    const { ledger } = setup(); const broker = new AccountedBroker(ledger), prepared = broker.prepare(context(), authorize(ledger));
    const result = await broker.complete(prepared.id, response(), () => { broker.cancel(prepared.id); return context(); });
    expect(result).toEqual({ kind: 'rejected', code: 'request_cancelled' });
    expect(ledger.view()).toMatchObject({ bookedMicroUsd: 19_144n, heldMicroUsd: 100n, admissionsCharged: 10 });
  });
});

describe('accounted action admission and real-kernel replay', () => {
  it('executes a bounded own-price decision and reproduces complete state after both journals reopen', async () => {
    const { ledger, directory } = setup(); const gameDirectory = join(root(), 'game'); const p = participant(gameDirectory);
    const broker = new AccountedBroker(ledger), prepared = broker.prepareFromHost(p.host, p.session, authorize(ledger)); const observation = p.host.read(p.session);
    const result = await broker.complete(prepared.id, priceResponse(), () => p.host.read(p.session).context);
    expect(result.kind).toBe('validated_offline'); if (result.kind !== 'validated_offline') throw Error('test precondition');
    submitAccountedDecision(p.host, p.session, observation.observationId, observation.context.tick, result.decision);
    expect(p.host.advance().some(e => e.category === 'bakerPrice')).toBe(true);
    const stateHash = p.host.evidence(); const expectedLedger = ledger.view(); p.host.close(); ledger.close();
    const game = openDurableHost(gameDirectory, p.genesis.sourceRevision, 'recorded-response-controller-token', { resumeCleanShutdown: true }); hosts.push(game);
    const reopened = track(AccountingLedger.open(directory)); expect(reopened.view()).toEqual(expectedLedger); expect(game.evidence()).toBe(stateHash);
    expect(evidenceHash(replay(game.exportTape(), p.genesis.sourceRevision))).toBe(stateHash);
    expect(await new AccountedBroker(reopened).complete(prepared.id, priceResponse(), () => game.read(game.authenticate('recorded-response-controller-token')).context))
      .toEqual({ kind: 'rejected', code: 'response_already_consumed' });
  });
  it('preserves costs if the host advances after completion but before action submission', async () => {
    const { ledger } = setup(); const p = participant(), broker = new AccountedBroker(ledger), prepared = broker.prepareFromHost(p.host, p.session, authorize(ledger));
    const observation = p.host.read(p.session), result = await broker.complete(prepared.id, priceResponse(), () => p.host.read(p.session).context);
    if (result.kind !== 'validated_offline') throw Error('test precondition'); p.host.advance();
    expect(() => submitAccountedDecision(p.host, p.session, observation.observationId, observation.context.tick, result.decision)).toThrow('stale_observation');
    expect(p.host.exportTape().ticks[0]!.actions).toHaveLength(0); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
  });
  it('does not refund known costs after game-checkpoint persistence failure', async () => {
    let fail = false; const { ledger } = setup(); const p = participant(join(root(), 'game'), stage => { if (fail && stage === 'before_write') throw Error('mechanical checkpoint failure'); });
    const broker = new AccountedBroker(ledger), prepared = broker.prepareFromHost(p.host, p.session, authorize(ledger));
    const observation = p.host.read(p.session), result = await broker.complete(prepared.id, priceResponse(), () => p.host.read(p.session).context);
    if (result.kind !== 'validated_offline') throw Error('test precondition');
    submitAccountedDecision(p.host, p.session, observation.observationId, observation.context.tick, result.decision); fail = true;
    expect(() => p.host.advance()).toThrow('checkpoint_write_failed'); expect(ledger.view().bookedMicroUsd).toBe(19_144n);
    expect(p.host.exportTape().ticks).toHaveLength(0);
  });
});
