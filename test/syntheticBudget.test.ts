import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, linkSync, unlinkSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { SyntheticBudgetLedger, type SyntheticBudgetOptions, type SyntheticWriteStage } from '../src/agent/syntheticBudget.js';

const fixtureId = 'fixture-budget-regression';
const limits = { totalMicroUsd: 1_000, maxRequests: 3 };
const roots: string[] = [];
const ledgers: SyntheticBudgetLedger[] = [];
const buildRoot = mkdtempSync(join(tmpdir(), 'node-synthetic-budget-build-'));
const build = join(buildRoot, 'compiled');
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), 'node-synthetic-budget-')); roots.push(root); return join(root, 'journal');
};
const create = (options: SyntheticBudgetOptions = {}, config = limits) => {
  const path = directory(); const ledger = SyntheticBudgetLedger.create(path, fixtureId, config, options); ledgers.push(ledger);
  return { path, ledger };
};
const open = (path: string, options: SyntheticBudgetOptions = {}) => {
  const ledger = SyntheticBudgetLedger.open(path, fixtureId, options); ledgers.push(ledger); return ledger;
};
const raw = (path: string) => readFileSync(join(path, 'synthetic-budget.json'), 'utf8');
const rewrite = (path: string, mutate: (document: any) => void) => {
  const envelope = JSON.parse(raw(path)); const document = JSON.parse(envelope.payload); mutate(document);
  envelope.payload = JSON.stringify(document); envelope.checksum = createHash('sha256').update(envelope.payload).digest('hex');
  writeFileSync(join(path, 'synthetic-budget.json'), JSON.stringify(envelope), { mode: 0o600 });
};
beforeAll(() => {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', '--types', 'node', '--typeRoots', resolve('node_modules/@types'),
    '--outDir', build, resolve('src/agent/syntheticBudget.ts')]);
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
});
afterEach(() => {
  for (const ledger of ledgers.splice(0)) { try { ledger.close(); } catch {} }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));

describe('synthetic cumulative accounting invariants', () => {
  it('retains cumulative costs, holds and request counts across repeated reopening', () => {
    const first = create(); first.ledger.reserve('one', 100); first.ledger.settle('one', 25); first.ledger.reserve('two', 200);
    const expected = first.ledger.view(); first.ledger.close();
    for (let count = 0; count < 3; count++) { const next = open(first.path); expect(next.view()).toEqual(expected); next.close(); }
    expect(expected).toMatchObject({ scope: 'synthetic-only', requestCount: 2, spentMicroUsd: 25n, heldMicroUsd: 200n, remainingMicroUsd: 775n });
  });
  it('holds an uncertain outcome in full and blocks another reservation after restart', () => {
    const first = create(); first.ledger.reserve('one', 100); first.ledger.markUncertain('one'); first.ledger.close();
    const next = open(first.path); expect(next.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 0n, heldMicroUsd: 100n });
    expect(next.view().requests[0]!.actualMicroUsd).toBeNull();
    expect(() => next.reserve('two', 10)).toThrow('synthetic_budget_outstanding');
    expect(next.reserve('one', 100)).toBe('duplicate'); expect(next.view().requestCount).toBe(1);
  });
  it('supports idempotent operations without refunding a consumed request count', () => {
    const { ledger, path } = create(); ledger.reserve('one', 100); const before = raw(path);
    expect(ledger.reserve('one', 100)).toBe('duplicate'); expect(raw(path)).toBe(before);
    ledger.markUncertain('one'); const uncertain = raw(path); ledger.markUncertain('one'); expect(raw(path)).toBe(uncertain);
    ledger.settle('one', 0); const settled = raw(path); ledger.settle('one', 0); expect(raw(path)).toBe(settled);
    expect(ledger.view()).toMatchObject({ requestCount: 1, spentMicroUsd: 0n, heldMicroUsd: 0n });
  });
  it('refuses conflicting duplicates and immutable settlement changes', () => {
    const { ledger } = create(); ledger.reserve('one', 100);
    expect(() => ledger.reserve('one', 99)).toThrow('synthetic_budget_duplicate_mismatch');
    ledger.settle('one', 25); expect(() => ledger.settle('one', 26)).toThrow('synthetic_budget_settlement_conflict');
    expect(() => ledger.markUncertain('one')).toThrow('synthetic_budget_request');
    expect(ledger.view().spentMicroUsd).toBe(25n);
  });
  it('enforces request and cost limits before appending an admission', () => {
    const { ledger, path } = create({}, { totalMicroUsd: 100, maxRequests: 1 });
    const initial = raw(path); expect(() => ledger.reserve('too-costly', 101)).toThrow('synthetic_budget_cost_limit'); expect(raw(path)).toBe(initial);
    ledger.reserve('one', 100); ledger.settle('one', 1); const prior = raw(path);
    expect(() => ledger.reserve('two', 1)).toThrow('synthetic_budget_request_limit'); expect(raw(path)).toBe(prior);
  });
  it('records true over-reservation usage and preserves a permanent halt after restart', () => {
    const first = create(); first.ledger.reserve('one', 100);
    expect(first.ledger.settle('one', 1_200)).toMatchObject({ spentMicroUsd: 1_200n, remainingMicroUsd: -200n, halt: 'over_reservation' });
    first.ledger.close(); const next = open(first.path);
    expect(() => next.reserve('two', 1)).toThrow('synthetic_budget_halted');
    expect(next.settle('one', 1_200).spentMicroUsd).toBe(1_200n);
  });
  it('does not lose integer precision when cumulative settled usage exceeds safe Number totals', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const { ledger } = create({}, { totalMicroUsd: max, maxRequests: 3 });
    ledger.reserve('one', max - 1); ledger.settle('one', max - 1); ledger.reserve('two', 1);
    const view = ledger.settle('two', max);
    expect(view.spentMicroUsd).toBe(BigInt(max - 1) + BigInt(max)); expect(view.halt).toBe('over_reservation');
  });
  it('returns detached views that cannot widen stored limits or erase records', () => {
    const { ledger } = create(); ledger.reserve('one', 100); const view = ledger.view();
    view.limits.totalMicroUsd = 999_999; view.requests[0]!.ceilingMicroUsd = 1; view.requests.length = 0;
    expect(ledger.view()).toMatchObject({ limits, heldMicroUsd: 100n, requestCount: 1 });
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe reservation and settlement amount %s', amount => {
    const { ledger, path } = create(); const initial = raw(path);
    expect(() => ledger.reserve('one', amount)).toThrow('synthetic_budget_reservation'); expect(raw(path)).toBe(initial);
    ledger.reserve('one', 100); expect(() => ledger.settle('one', amount)).toThrow('synthetic_budget_settlement');
    expect(ledger.view().heldMicroUsd).toBe(100n);
  });
  it('refuses real-account names and malformed initial limits without creating a directory', () => {
    const path = directory(); expect(() => SyntheticBudgetLedger.create(path, 'production-account', limits)).toThrow('synthetic_budget_schema');
    expect(existsSync(path)).toBe(false);
    expect(() => SyntheticBudgetLedger.create(path, fixtureId, { ...limits, maxRequests: 0 })).toThrow('synthetic_budget_schema');
    expect(existsSync(path)).toBe(false);
  });
});

describe('synthetic journal integrity and writer ownership', () => {
  it('never initializes missing state or overwrites any existing directory', () => {
    const missing = directory(); expect(() => open(missing)).toThrow(); expect(existsSync(missing)).toBe(false);
    const empty = directory(); mkdirSync(empty, { mode: 0o700 }); expect(() => open(empty)).toThrow(); expect(existsSync(join(empty, 'synthetic-budget.json'))).toBe(false);
    expect(() => SyntheticBudgetLedger.create(empty, fixtureId, limits)).toThrow();
    const first = create(); const prior = raw(first.path); expect(() => SyntheticBudgetLedger.create(first.path, fixtureId, limits)).toThrow(); expect(raw(first.path)).toBe(prior);
  });
  it('refuses a second live writer even if stale recovery is requested', () => {
    const { path } = create(); expect(() => open(path)).toThrow(); expect(() => open(path, { recoverStaleLock: true })).toThrow('synthetic_budget_locked');
  });
  it('does not steal a dead-owner lock while another recovery guard owns its inspection', () => {
    const path = directory();
    const child = spawnSync(process.execPath, [resolve('test/fixtures/syntheticBudgetCrash.mjs'), build, path, 'after_rename', '2'], { encoding: 'utf8', timeout: 10_000 });
    expect(child.status, child.stderr).toBe(73);
    const before = readFileSync(join(path, '.synthetic-budget.lock'), 'utf8');
    const guard = join(path, '.synthetic-budget.recovery.lock'); writeFileSync(guard, 'other-recovery-owner', { mode: 0o600 });
    expect(() => open(path, { recoverStaleLock: true })).toThrow();
    expect(readFileSync(join(path, '.synthetic-budget.lock'), 'utf8')).toBe(before);
    expect(readFileSync(guard, 'utf8')).toBe('other-recovery-owner');
    unlinkSync(guard); expect(open(path, { recoverStaleLock: true }).view().heldMicroUsd).toBe(100n);
  });
  it('requires the exact fixture identity and refuses non-synthetic or corrupt authoritative evidence', () => {
    const first = create(); first.ledger.close(); const prior = raw(first.path);
    expect(() => SyntheticBudgetLedger.open(first.path, 'fixture-other')).toThrow('synthetic_budget_fixture_mismatch');
    rewrite(first.path, document => { document.scope = 'real-account'; }); expect(() => open(first.path)).toThrow('synthetic_budget_schema');
    writeFileSync(join(first.path, 'synthetic-budget.json'), prior, { mode: 0o600 });
    const envelope = JSON.parse(prior); envelope.checksum = '0'.repeat(64);
    writeFileSync(join(first.path, 'synthetic-budget.json'), JSON.stringify(envelope), { mode: 0o600 });
    writeFileSync(join(first.path, '.synthetic-budget.next'), prior, { mode: 0o600 });
    expect(() => open(first.path)).toThrow('synthetic_budget_checksum'); expect(existsSync(join(first.path, '.synthetic-budget.next'))).toBe(true);
  });
  it('rejects logically impossible journals even with a recomputed checksum', () => {
    const first = create(); first.ledger.reserve('one', 100); first.ledger.close(); const good = raw(first.path);
    const changes = [
      (document: any) => { document.events.push({ kind: 'reserve', id: 'two', ceilingMicroUsd: 100 }); },
      (document: any) => { document.events.push({ ...document.events[0] }); },
      (document: any) => { document.events.push({ kind: 'settle', id: 'absent', actualMicroUsd: 0 }); },
      (document: any) => { document.events[0].hiddenAllowance = 100; },
    ];
    for (const change of changes) {
      writeFileSync(join(first.path, 'synthetic-budget.json'), good, { mode: 0o600 }); rewrite(first.path, change);
      expect(() => open(first.path)).toThrow('synthetic_budget_event');
    }
  });
  it('does not overwrite unexpected changed bytes under its writer lock', () => {
    const { ledger, path } = create(); writeFileSync(join(path, 'synthetic-budget.json'), '{changed}', { mode: 0o600 });
    expect(() => ledger.reserve('one', 100)).toThrow('synthetic_budget_write_failed');
    expect(raw(path)).toBe('{changed}'); expect(() => ledger.view()).toThrow('synthetic_budget_unavailable');
  });
  it('refuses oversized, hard-linked and linked-directory evidence', () => {
    const first = create(); first.ledger.close(); const file = join(first.path, 'synthetic-budget.json');
    const link = join(first.path, 'extra-link'); linkSync(file, link); expect(() => open(first.path)).toThrow('synthetic_budget_file'); unlinkSync(link);
    const alias = join(first.path, '..', 'directory-alias'); symlinkSync(first.path, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => open(alias)).toThrow('synthetic_budget_directory'); unlinkSync(alias);
    truncateSync(file, 4 * 1024 * 1024 + 1); expect(() => open(first.path)).toThrow('synthetic_budget_file');
  });
  it('refuses a hard-linked writer-lock path before reading or writing it', () => {
    const first = create(); const lock = join(first.path, '.synthetic-budget.lock'); const target = join(first.path, 'lock-copy');
    linkSync(lock, target);
    expect(() => first.ledger.reserve('one', 100)).toThrow('synthetic_budget_write_failed'); unlinkSync(target);
  });
  for (const stage of ['before_write', 'after_file_sync', 'after_rename'] as SyntheticWriteStage[]) {
    it(`stops a writer after a storage error at ${stage} and keeps authoritative state`, () => {
      let writes = 0;
      const first = create({ fault: where => { if (where === 'before_write') writes++; if (writes === 2 && where === stage) throw Error('private fixture failure'); } });
      expect(() => first.ledger.reserve('one', 100)).toThrow('synthetic_budget_write_failed');
      expect(() => first.ledger.reserve('two', 1)).toThrow('synthetic_budget_unavailable'); first.ledger.close();
      const next = open(first.path); expect(next.view().requestCount).toBe(stage === 'after_rename' ? 1 : 0);
      if (stage === 'after_file_sync') expect(readdirSync(first.path).some(name => name.startsWith('.synthetic-budget.orphan-'))).toBe(true);
    });
    for (const writeNumber of [2, 3]) {
      it(`process crash at ${stage}, write ${writeNumber}: never invents a refund or new request history`, () => {
        const path = directory(); const child = spawnSync(process.execPath, [resolve('test/fixtures/syntheticBudgetCrash.mjs'), build, path, stage, String(writeNumber)], { encoding: 'utf8', timeout: 10_000 });
        expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(73);
        expect(existsSync(join(path, 'mock-dispatched'))).toBe(writeNumber === 3);
        expect(() => open(path)).toThrow();
        const ledger = open(path, { recoverStaleLock: true }); const view = ledger.view();
        const reserved = writeNumber === 3 || stage === 'after_rename'; const settled = writeNumber === 3 && stage === 'after_rename';
        expect(view).toMatchObject({ requestCount: reserved ? 1 : 0, spentMicroUsd: settled ? 25n : 0n, heldMicroUsd: reserved && !settled ? 100n : 0n });
        if (reserved) { expect(ledger.reserve('one', 100)).toBe('duplicate'); if (!settled) expect(() => ledger.reserve('two', 1)).toThrow('synthetic_budget_outstanding'); }
        ledger.close(); const again = open(path); expect(again.view()).toEqual(view);
      });
    }
  }
});
