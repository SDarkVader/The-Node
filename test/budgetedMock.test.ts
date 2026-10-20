import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyntheticBudgetLedger, type SyntheticBudgetOptions } from '../src/agent/syntheticBudget.js';
import { createBudgetedMockFixture, syntheticCost, type SyntheticPrices } from '../src/agent/budgetedMock.js';
import { OfflineParticipantHost } from '../src/agent/host.js';
import { createDurableHost, openDurableHost } from '../src/agent/durableHost.js';
import type { CheckpointOpenOptions } from '../src/agent/checkpoint.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { assertLiveAdmission, RECOVERY_HOLD } from '../src/agent/broker.js';
import type { DecisionContext } from '../src/agent/protocol.js';
import { evidenceHash, replay } from '../src/agent/replay.js';

const prices: SyntheticPrices = { kind: 'synthetic-price-fixture', model: 'offline-fixture', inputMicroUsdPerMillionTokens: 1_000_000, outputMicroUsdPerMillionTokens: 2_000_000 };
const context = (): DecisionContext => ({ tick: 0, roleEpoch: 0, selfRef: 'fixture-self', role: 'Baker', legalMoves: [], presentRefs: [], knownSubjects: [] });
const roots: string[] = []; const ledgers: SyntheticBudgetLedger[] = []; const hosts: OfflineParticipantHost[] = [];
const signal = () => new AbortController().signal;
const completion = () => ({ status: 'completed', model: 'offline-fixture', usage: { inputTokens: 10, outputTokens: 10 },
  decision: { move: null, communication: null, diary: null, role: null } });
const response = (value: unknown = completion(), status = 200) => ({ status, body: Readable.from([JSON.stringify(value)]) });
const setup = (options: SyntheticBudgetOptions = {}, maxRequests = 3) => {
  const root = mkdtempSync(join(tmpdir(), 'node-budgeted-mock-')); roots.push(root); const directory = join(root, 'journal');
  const ledger = SyntheticBudgetLedger.create(directory, 'fixture-mock-budget', { totalMicroUsd: 100_000, maxRequests }, options); ledgers.push(ledger);
  return { directory, ledger, root };
};
const host = (directory?: string, fault?: CheckpointOpenOptions['fault']) => {
  const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
  const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!;
  const value = directory ? createDurableHost(directory, genesis, person.id, 'budgeted-mock-controller-token', { fault })
    : new OfflineParticipantHost(genesis, person.id, 'budgeted-mock-controller-token'); hosts.push(value);
  return { host: value, session: value.authenticate('budgeted-mock-controller-token'), genesis };
};
afterEach(() => {
  for (const value of hosts.splice(0)) value.close();
  for (const ledger of ledgers.splice(0)) { try { ledger.close(); } catch {} }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('budgeted in-memory mock dispatch', () => {
  it('durably reserves the conservative ceiling before invoking the mock and settles before success', async () => {
    const { ledger, directory } = setup(); let calls = 0;
    const fixture = createBudgetedMockFixture(ledger, () => {
      calls++; expect(ledger.view()).toMatchObject({ requestCount: 1, heldMicroUsd: 40_960n, spentMicroUsd: 0n });
      const disk = JSON.parse(JSON.parse(readFileSync(join(directory, 'synthetic-budget.json'), 'utf8')).payload);
      expect(disk.events).toHaveLength(1); expect(disk.events[0].kind).toBe('reserve'); return response();
    }, prices);
    expect((await fixture(context(), signal())).status).toBe('completed');
    expect(ledger.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 30n, heldMicroUsd: 0n }); expect(calls).toBe(1);
  });
  it('never redispatches a duplicate person/tick even with a fresh adapter after restart', async () => {
    const first = setup(); let calls = 0;
    await createBudgetedMockFixture(first.ledger, () => { calls++; return response(); }, prices)(context(), signal()); first.ledger.close();
    const next = SyntheticBudgetLedger.open(first.directory, 'fixture-mock-budget'); ledgers.push(next);
    await expect(createBudgetedMockFixture(next, () => { calls++; return response(); }, prices)(context(), signal())).rejects.toThrow('synthetic_mock_duplicate');
    expect(calls).toBe(1); expect(next.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 30n });
  });
  it('retains an unknown HTTP-like failure in full and blocks another attempt', async () => {
    const { ledger } = setup(); let calls = 0;
    const fixture = createBudgetedMockFixture(ledger, () => { calls++; return response(completion(), 401); }, prices);
    await expect(fixture(context(), signal())).rejects.toThrow('synthetic_mock_uncertain');
    await expect(fixture({ ...context(), tick: 1 }, signal())).rejects.toThrow('synthetic_budget_outstanding');
    expect(ledger.view()).toMatchObject({ heldMicroUsd: 40_960n, requestCount: 1, spentMicroUsd: 0n });
    expect(ledger.view().requests[0]!.actualMicroUsd).toBeNull(); expect(calls).toBe(1);
  });
  it('does not dispatch overlapping work through another adapter', async () => {
    const { ledger } = setup(); const body = new Readable({ read() {} }); let calls = 0;
    const pending = createBudgetedMockFixture(ledger, () => { calls++; return { status: 200, body }; }, prices)(context(), signal());
    await expect(createBudgetedMockFixture(ledger, () => { calls++; return response(); }, prices)({ ...context(), selfRef: 'other-person' }, signal()))
      .rejects.toThrow('synthetic_budget_outstanding');
    body.push(JSON.stringify(completion())); body.push(null); await pending; expect(calls).toBe(1);
  });
  it('does not consume a request for pre-aborted or invalid context input', async () => {
    const { ledger } = setup(); let calls = 0;
    const fixture = createBudgetedMockFixture(ledger, () => { calls++; return response(); }, prices);
    const controller = new AbortController(); controller.abort();
    await expect(fixture(context(), controller.signal)).rejects.toThrow('synthetic_mock_aborted');
    await expect(fixture({ ...context(), tick: -1 }, signal())).rejects.toThrow('mock_request_invalid');
    expect(ledger.view().requestCount).toBe(0); expect(calls).toBe(0);
  });
  it('keeps the reservation when an active response is cancelled', async () => {
    const { ledger } = setup(); const body = new Readable({ read() {} }); const controller = new AbortController();
    const pending = createBudgetedMockFixture(ledger, () => ({ status: 200, body }), prices)(context(), controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow('synthetic_mock_uncertain');
    expect(ledger.view()).toMatchObject({ requestCount: 1, heldMicroUsd: 40_960n }); expect(body.destroyed).toBe(true);
  });
  it('does not dispatch if pre-request journal persistence fails', async () => {
    let writes = 0; const { ledger } = setup({ fault: stage => { if (stage === 'before_write' && ++writes === 2) throw Error('private fixture error'); } });
    let calls = 0;
    await expect(createBudgetedMockFixture(ledger, () => { calls++; return response(); }, prices)(context(), signal())).rejects.toThrow('synthetic_budget_write_failed');
    expect(calls).toBe(0);
  });
  it('publishes no successful completion if its settlement cannot be persisted', async () => {
    let writes = 0; const first = setup({ fault: stage => { if (stage === 'before_write' && ++writes === 3) throw Error('private fixture error'); } });
    await expect(createBudgetedMockFixture(first.ledger, () => response(), prices)(context(), signal())).rejects.toThrow('synthetic_budget_write_failed');
    first.ledger.close(); const next = SyntheticBudgetLedger.open(first.directory, 'fixture-mock-budget'); ledgers.push(next);
    expect(next.view()).toMatchObject({ requestCount: 1, heldMicroUsd: 40_960n, spentMicroUsd: 0n });
  });
  it('accounts a completed mock response even when the host rejects its stale game decision', async () => {
    const { ledger } = setup(); const participant = host(); const body = new Readable({ read() {} });
    const pending = participant.host.evaluateFixture(participant.session, createBudgetedMockFixture(ledger, () => ({ status: 200, body }), prices));
    participant.host.advance(); body.push(JSON.stringify(completion())); body.push(null);
    expect(await pending).toEqual({ kind: 'rejected', code: 'stale_context' });
    expect(ledger.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 30n, heldMicroUsd: 0n });
    participant.host.advance(); expect(participant.host.exportTape().ticks.every(tick => tick.actions.length === 0)).toBe(true);
  });
  it('bounds two actual host decisions cumulatively and preserves complete replay equality', async () => {
    const { ledger } = setup({}, 2); const participant = host(); let calls = 0;
    const fixture = createBudgetedMockFixture(ledger, () => {
      calls++; return response({ ...completion(), decision: { ...completion().decision, role: { kind: 'bakerPrice', price: 0.75 } } });
    }, prices);
    for (let tick = 0; tick < 2; tick++) {
      expect((await participant.host.evaluateFixture(participant.session, fixture)).kind).toBe('validated_offline');
      expect(participant.host.advance().some(effect => effect.category === 'bakerPrice')).toBe(true);
    }
    expect(await participant.host.evaluateFixture(participant.session, fixture)).toEqual({ kind: 'rejected', code: 'fixture_failure' });
    expect(calls).toBe(2); expect(ledger.view()).toMatchObject({ requestCount: 2, spentMicroUsd: 60n, heldMicroUsd: 0n });
    expect(evidenceHash(replay(participant.host.exportTape(), participant.genesis.sourceRevision))).toBe(participant.host.evidence());
  });
  it('pins synthetic prices and never changes the historical reminder or closed live gate', async () => {
    const { ledger } = setup(); const mutable = { ...prices };
    const fixture = createBudgetedMockFixture(ledger, () => response(), mutable); mutable.inputMicroUsdPerMillionTokens = 9_000_000;
    await fixture(context(), signal()); expect(ledger.view().spentMicroUsd).toBe(30n);
    expect(() => assertLiveAdmission()).toThrow('recovery_accounting_unresolved');
    expect(RECOVERY_HOLD.originalReservationMicroUsd).toBe(19_114); expect(RECOVERY_HOLD.accountingReconciled).toBe(false);
  });
  it('resumes both durable game state and cumulative synthetic cost without repeating the previous tick', async () => {
    const first = setup(); const gameDirectory = join(first.root, 'game'); const participant = host(gameDirectory); let calls = 0;
    const transport = () => { calls++; return response(); };
    await participant.host.evaluateFixture(participant.session, createBudgetedMockFixture(first.ledger, transport, prices));
    participant.host.advance(); participant.host.close(); first.ledger.close();
    const ledger = SyntheticBudgetLedger.open(first.directory, 'fixture-mock-budget'); ledgers.push(ledger);
    const game = openDurableHost(gameDirectory, participant.genesis.sourceRevision, 'budgeted-mock-controller-token', { resumeCleanShutdown: true }); hosts.push(game);
    const session = game.authenticate('budgeted-mock-controller-token');
    expect(game.read(session).context.tick).toBe(1);
    expect((await game.evaluateFixture(session, createBudgetedMockFixture(ledger, transport, prices))).kind).toBe('validated_offline');
    game.advance(); expect(calls).toBe(2); expect(ledger.view()).toMatchObject({ requestCount: 2, spentMicroUsd: 60n, heldMicroUsd: 0n });
    expect(evidenceHash(replay(game.exportTape(), participant.genesis.sourceRevision))).toBe(game.evidence());
  });
  it('never refunds known mock usage when game completion persistence fails', async () => {
    const first = setup(); const gameDirectory = join(first.root, 'game'); let writes = 0; let calls = 0;
    const participant = host(gameDirectory, stage => { if (stage === 'before_write' && ++writes === 3) throw Error('private game storage error'); });
    const transport = () => { calls++; return response(); };
    await expect(participant.host.evaluateFixture(participant.session, createBudgetedMockFixture(first.ledger, transport, prices)))
      .rejects.toThrow('checkpoint_write_failed');
    expect(first.ledger.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 30n, heldMicroUsd: 0n });
    first.ledger.close(); const ledger = SyntheticBudgetLedger.open(first.directory, 'fixture-mock-budget'); ledgers.push(ledger);
    const game = openDurableHost(gameDirectory, participant.genesis.sourceRevision, 'budgeted-mock-controller-token'); hosts.push(game);
    const session = game.authenticate('budgeted-mock-controller-token');
    expect(await game.evaluateFixture(session, createBudgetedMockFixture(ledger, transport, prices))).toEqual({ kind: 'rejected', code: 'fixture_halted' });
    expect(calls).toBe(1); expect(ledger.view().spentMicroUsd).toBe(30n); expect(game.exportTape().ticks).toHaveLength(0);
  });
});

describe('synthetic integer cost calculation', () => {
  it('rounds each category upward using integer arithmetic', () => {
    const tiny = { ...prices, inputMicroUsdPerMillionTokens: 1, outputMicroUsdPerMillionTokens: 1 };
    expect(syntheticCost(1, 1, tiny)).toBe(2); expect(syntheticCost(0, 0, tiny)).toBe(0);
    expect(syntheticCost(1_000_001, 0, tiny)).toBe(2);
  });
  it.each([-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid usage %s', amount => {
    expect(() => syntheticCost(amount, 1, prices)).toThrow('synthetic_price_invalid');
  });
  it('rejects real-provider labels, unbounded amounts and malformed pricing before admission', () => {
    expect(() => syntheticCost(1, 1, { ...prices, model: 'real-model' } as unknown as SyntheticPrices)).toThrow('synthetic_price_invalid');
    expect(() => syntheticCost(Number.MAX_SAFE_INTEGER, 1, { ...prices, inputMicroUsdPerMillionTokens: Number.MAX_SAFE_INTEGER })).toThrow('synthetic_price_overflow');
    const { ledger } = setup(); expect(() => createBudgetedMockFixture(ledger, () => response(), { ...prices, inputMicroUsdPerMillionTokens: 0 })).toThrow('synthetic_price_invalid');
    expect(ledger.view().requestCount).toBe(0);
  });
});
