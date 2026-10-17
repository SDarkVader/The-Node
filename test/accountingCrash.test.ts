import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AccountingLedger } from '../src/agent/accountingLedger.js';
import { setup, authorize, request, track, cleanup } from './fixtures/accountingFixture.js';

const buildRoot = mkdtempSync(join(tmpdir(), 'node-accounting-crash-build-')), build = join(buildRoot, 'compiled');
beforeAll(() => {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--strict', '--skipLibCheck', '--types', 'node', '--typeRoots', resolve('node_modules/@types'), '--outDir', build, '--rootDir', resolve('src'), resolve('src/agent/accountingLedger.ts')]);
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
});
afterEach(cleanup);
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));

describe('process crashes in the account journal', () => {
  for (const operation of ['reservation', 'receipt', 'decision_claim']) {
    it.each(['before_write', 'after_file_sync', 'after_rename'])(`preserves historical liabilities through ${operation} at %s`, stage => {
      const { ledger, directory } = setup(); const r = request(authorize(ledger));
      const receipt = { receiptId: 'resp_crash', requestId: r.id, sourceSha256: 'c'.repeat(64), model: r.prices.model,
        status: 'completed', usage: { inputTokens: 10, outputTokens: 10 } };
      if (operation !== 'reservation') ledger.reserve(r);
      if (operation === 'decision_claim') ledger.recordReceipt(receipt as never);
      ledger.close(); const inputPath = join(directory, 'test-input.json'); writeFileSync(inputPath, JSON.stringify({ request: r, receipt }));
      const child = spawnSync(process.execPath, [resolve('test/fixtures/accountingCrash.mjs'), build, directory, stage, operation, inputPath], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
      expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(73);
      expect(() => AccountingLedger.open(directory)).toThrow();
      const reopened = track(AccountingLedger.open(directory, { recoverStaleLock: true })); const view = reopened.view();
      expect(view).toMatchObject({ historicalActorBookedMicroUsd: 19_114, historicalDiagnosticHoldMicroUsd: 100, actualBilledMicroUsd: null });
      expect(view.admissionsCharged).toBe(operation === 'reservation' && stage !== 'after_rename' ? 9 : 10);
      const settled = operation === 'decision_claim' || operation === 'receipt' && stage === 'after_rename';
      expect(view.bookedMicroUsd).toBe(settled ? 19_144n : 19_114n);
      if (operation === 'decision_claim') expect(view.requests[0]!.decisionClaimed).toBe(stage === 'after_rename');
      if (stage === 'after_file_sync') expect(readdirSync(directory).some(name => name.startsWith('.accounting.orphan-'))).toBe(true);
      expect(existsSync(join(directory, '.accounting.next'))).toBe(false);
    });
  }
  it('does not silently reclaim a leftover recovery guard', () => {
    const { ledger, directory } = setup(); const r = request(authorize(ledger)); ledger.close();
    const inputPath = join(directory, 'test-input.json'); writeFileSync(inputPath, JSON.stringify({ request: r }));
    const child = spawnSync(process.execPath, [resolve('test/fixtures/accountingCrash.mjs'), build, directory, 'before_write', 'reservation', inputPath], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    expect(child.status, child.stderr).toBe(73); writeFileSync(join(directory, '.accounting.recovery.lock'), 'Unresolved recovery owner', { mode: 0o600 });
    expect(() => AccountingLedger.open(directory, { recoverStaleLock: true })).toThrow();
    expect(existsSync(join(directory, '.accounting.lock'))).toBe(true);
  });
});
