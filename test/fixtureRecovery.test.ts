import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createDurableHost, openDurableHost } from '../src/agent/durableHost.js';
import { inspectParticipantCheckpoint, type CheckpointRecord, type WriteStage } from '../src/agent/checkpoint.js';
import { canonical, digest } from '../src/agent/replay.js';
import { fixtureGenesis, createParticipantState } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import type { OfflineParticipantHost } from '../src/agent/host.js';
import type { FixtureResponse } from '../src/agent/broker.js';

const token = 'durable-fixture-test-controller';
const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!.id;
const roots: string[] = [];
const hosts: OfflineParticipantHost[] = [];
const buildRoot = mkdtempSync(join(tmpdir(), 'node-fixture-recovery-build-'));
const build = join(buildRoot, 'compiled');
const response = (): FixtureResponse => ({ status: 'completed', model: 'offline-fixture', inputTokens: 10, outputTokens: 10,
  decision: { move: null, communication: null, diary: null, role: null } });
const create = (fault?: (stage: WriteStage) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'node-fixture-recovery-')); roots.push(root);
  const directory = join(root, 'checkpoint');
  const host = createDurableHost(directory, genesis, person, token, { fault }); hosts.push(host);
  return { directory, host, session: host.authenticate(token) };
};
const reopen = (directory: string) => {
  const host = openDurableHost(directory, genesis.sourceRevision, token, { resumeCleanShutdown: true }); hosts.push(host);
  return { host, session: host.authenticate(token) };
};
const inspect = (directory: string) => inspectParticipantCheckpoint(directory, genesis.sourceRevision);
const writeRecord = (directory: string, record: CheckpointRecord, format = `node-participant-checkpoint-v${record.version}`) => {
  const payload = canonical(record);
  writeFileSync(join(directory, 'participant.checkpoint.json'), JSON.stringify({
    format, payload, checksum: createHash('sha256').update(payload).digest('hex'),
  }), { mode: 0o600 });
};
beforeAll(() => {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--types', 'node',
    '--typeRoots', resolve('node_modules/@types'), '--outDir', build, resolve('src/agent/durableHost.ts')]);
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
});
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));
afterEach(() => {
  for (const host of hosts.splice(0)) { try { host.close(); } catch {} }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('durable fixture admission across restart', () => {
  it('does not admit a second fixture while an earlier pre-shutdown callback is unresolved', async () => {
    const first = create(); let finish!: (value: FixtureResponse) => void;
    const pending = first.host.evaluateFixture(first.session, () => new Promise(resolve => { finish = resolve; }));
    first.host.close(); const second = reopen(first.directory); let calls = 0;
    try {
      expect(await second.host.evaluateFixture(second.session, async () => { calls++; return response(); }))
        .toEqual({ kind: 'rejected', code: 'fixture_halted' });
      expect(calls).toBe(0);
    } finally { finish(response()); await pending.catch(() => undefined); }
  });

  it('retains a consumed same-tick fixture across clean close and repeated reopening', async () => {
    const first = create();
    expect((await first.host.evaluateFixture(first.session, async () => response())).kind).toBe('validated_offline');
    first.host.close();
    for (let index = 0; index < 2; index++) {
      const next = reopen(first.directory); let calls = 0;
      expect(await next.host.evaluateFixture(next.session, async () => { calls++; return response(); }))
        .toEqual({ kind: 'rejected', code: 'tick_already_attempted' });
      expect(calls).toBe(0); next.host.close();
    }
  });

  it('preserves a callback-failure halt after tick advancement and process reopening', async () => {
    const first = create();
    expect(await first.host.evaluateFixture(first.session, async () => { throw Error('private callback error'); }))
      .toEqual({ kind: 'rejected', code: 'fixture_failure' });
    first.host.advance(); first.host.close(); const next = reopen(first.directory); let calls = 0;
    expect(await next.host.evaluateFixture(next.session, async () => { calls++; return response(); }))
      .toEqual({ kind: 'rejected', code: 'fixture_halted' });
    expect(calls).toBe(0);
  });

  it('persists the exact execution fence before invoking the fixture without storing its input or tokens', async () => {
    const first = create(); const observation = first.host.read(first.session);
    expect(inspect(first.directory).version).toBe(2);
    await first.host.evaluateFixture(first.session, async input => {
      const record = inspect(first.directory);
      expect(record.fixtureAttempt).toMatchObject({ tick: 0, epoch: input.roleEpoch, status: 'pending', contextHash: digest(input) });
      const stored = readFileSync(join(first.directory, 'participant.checkpoint.json'), 'utf8');
      expect(stored).not.toContain(first.session); expect(stored).not.toContain(token); expect(stored).not.toContain(observation.observationId);
      return response();
    });
    expect(inspect(first.directory).fixtureAttempt!.status).toBe('consumed');
  });

  it('allows the next tick after a completed fixture while retaining its predecessor across restart', async () => {
    const first = create(); await first.host.evaluateFixture(first.session, async () => response());
    first.host.advance(); first.host.close(); const next = reopen(first.directory);
    expect((await next.host.evaluateFixture(next.session, async () => response())).kind).toBe('validated_offline');
    expect(inspect(first.directory).fixtureAttempt).toMatchObject({ tick: 1, status: 'consumed' });
  });

  it('rejects overlapping evaluation but releases a resolved stale attempt for the next tick', async () => {
    const first = create(); let finish!: (value: FixtureResponse) => void;
    const pending = first.host.evaluateFixture(first.session, () => new Promise(resolve => { finish = resolve; }));
    expect(await first.host.evaluateFixture(first.session, async () => response())).toEqual({ kind: 'rejected', code: 'in_flight' });
    first.host.advance(); finish(response());
    expect(await pending).toEqual({ kind: 'rejected', code: 'stale_context' });
    expect((await first.host.evaluateFixture(first.session, async () => response())).kind).toBe('validated_offline');
  });

  it('retains an interrupted fixture fence while manual game ticks continue and reopen', async () => {
    const first = create(); let finish!: (value: FixtureResponse) => void;
    const pending = first.host.evaluateFixture(first.session, () => new Promise(resolve => { finish = resolve; }));
    first.host.close(); const next = reopen(first.directory);
    finish(response()); await pending.catch(() => undefined);
    next.host.advance(); next.host.close(); const again = reopen(first.directory); let calls = 0;
    expect(await again.host.evaluateFixture(again.session, async () => { calls++; return response(); })).toEqual({ kind: 'rejected', code: 'fixture_halted' });
    expect(again.host.read(again.session).context.tick).toBe(1); expect(calls).toBe(0);
  });

  it('preserves legacy v1 game evidence without inventing an unused fixture allowance', async () => {
    const first = create(); first.host.advance(); const state = first.host.evidence(); first.host.close();
    const record = inspect(first.directory); delete record.fixtureAttempt; record.version = 1; writeRecord(first.directory, record);
    const next = reopen(first.directory); let calls = 0;
    expect(next.host.evidence()).toBe(state);
    expect(await next.host.evaluateFixture(next.session, async () => { calls++; return response(); })).toEqual({ kind: 'rejected', code: 'fixture_halted' });
    expect(calls).toBe(0); next.host.advance();
    expect(inspect(first.directory).version).toBe(1); expect(inspect(first.directory).fixtureAttempt).toBeUndefined();
  });

  it('does not persist admission for a non-callable fixture', async () => {
    const first = create(); const before = inspect(first.directory);
    expect(await first.host.evaluateFixture(first.session, null as unknown as Parameters<OfflineParticipantHost['evaluateFixture']>[1]))
      .toEqual({ kind: 'rejected', code: 'invalid_callback' });
    expect(inspect(first.directory)).toEqual(before);
    expect((await first.host.evaluateFixture(first.session, async () => response())).kind).toBe('validated_offline');
  });

  it('never invokes a fixture if its pre-dispatch checkpoint cannot be persisted', async () => {
    let writes = 0;
    const first = create(stage => { if (stage === 'before_write' && ++writes === 2) throw Error('private storage detail'); });
    let calls = 0;
    await expect(first.host.evaluateFixture(first.session, async () => { calls++; return response(); })).rejects.toThrow('checkpoint_write_failed');
    expect(calls).toBe(0); expect(() => first.host.read(first.session)).toThrow('invalid_session');
    expect(inspect(first.directory).fixtureAttempt).toBeNull();
  });

  for (const stage of ['before_write', 'after_file_sync', 'after_rename'] as WriteStage[]) {
    it(`publishes no successful fixture result if completion persistence fails at ${stage}`, async () => {
      let writes = 0;
      const first = create(where => { if (where === 'before_write') writes++; if (writes === 3 && where === stage) throw Error('private storage detail'); });
      let calls = 0;
      await expect(first.host.evaluateFixture(first.session, async () => { calls++; return response(); })).rejects.toThrow('checkpoint_write_failed');
      const next = reopen(first.directory);
      expect(await next.host.evaluateFixture(next.session, async () => { calls++; return response(); }))
        .toEqual({ kind: 'rejected', code: stage === 'after_rename' ? 'tick_already_attempted' : 'fixture_halted' });
      expect(calls).toBe(1); expect(next.host.exportTape().ticks).toHaveLength(0);
    });
    for (const writeNumber of [2, 3]) {
      it(`process crash at ${stage}, fixture write ${writeNumber}: retains the authoritative admission fence`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'node-fixture-recovery-')); roots.push(root); const directory = join(root, 'checkpoint');
        const child = spawnSync(process.execPath, [resolve('test/fixtures/fixtureAttemptCrash.mjs'), build, directory, stage, String(writeNumber)], { encoding: 'utf8', timeout: 10_000 });
        expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(73);
        expect(existsSync(join(directory, 'fixture-dispatched'))).toBe(writeNumber === 3);
        const host = openDurableHost(directory, genesis.sourceRevision, token, { recoverStaleLock: true }); hosts.push(host);
        const session = host.authenticate(token); let calls = 0;
        const result = await host.evaluateFixture(session, async () => { calls++; return response(); });
        const admitted = writeNumber === 2 && stage !== 'after_rename';
        expect(calls).toBe(admitted ? 1 : 0);
        if (admitted) expect(result.kind).toBe('validated_offline');
        else expect(result).toEqual({ kind: 'rejected', code: writeNumber === 3 && stage === 'after_rename' ? 'tick_already_attempted' : 'fixture_halted' });
        host.close(); const again = reopen(directory);
        expect(await again.host.evaluateFixture(again.session, async () => { calls++; return response(); }))
          .toEqual({ kind: 'rejected', code: admitted || writeNumber === 3 && stage === 'after_rename' ? 'tick_already_attempted' : 'fixture_halted' });
        expect(calls).toBe(admitted ? 1 : 0);
      });
    }
  }

  it('rejects corrupt fixture metadata even with a recomputed envelope checksum', async () => {
    const first = create(); await first.host.evaluateFixture(first.session, async () => response()); first.host.close();
    const good = inspect(first.directory);
    for (const changed of [{ tick: 1 }, { epoch: -1 }, { id: 'wrong' }, { contextHash: 'wrong' }, { status: 'unknown' }]) {
      const corrupt = structuredClone(good); Object.assign(corrupt.fixtureAttempt!, changed); writeRecord(first.directory, corrupt);
      expect(() => reopen(first.directory)).toThrow('checkpoint_fixture');
    }
    writeRecord(first.directory, good, 'node-participant-checkpoint-v1');
    expect(() => reopen(first.directory)).toThrow('checkpoint_version');
    const missing = structuredClone(good); delete missing.fixtureAttempt; writeRecord(first.directory, missing);
    expect(() => reopen(first.directory)).toThrow('checkpoint_schema');
  });
});
