import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, root } from './fixtures/accountingFixture.js';
// @ts-expect-error Standalone Node gate deliberately has no runtime or package dependency.
import { assertLegacyLiveDispatchClosed, LEGACY_LIVE_DISPATCH_ERROR } from '../scripts/legacy-live-gate.mjs';
// @ts-expect-error Plain Node credential worker retains its injected offline fixture interface.
import { runAnthropicWorker } from '../scripts/anthropic-request.mjs';

afterEach(cleanup);

const revision = 'a'.repeat(40);
function failure(script: string, args: string[]): string {
  try {
    execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    throw Error('Expected dispatch gate rejection');
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    return String(failure.stderr ?? failure.message);
  }
}

it('closes all historical real-dispatch CLIs before credential/budget/runtime work, despite old approval flags', () => {
  const directory = root(), output = join(directory, 'never-created');
  const base = ['NEVER-READ-RUNTIME', 'NEVER-READ-JOURNAL', output, 'NEVER-READ-CREDENTIAL'];
  const invocations: [string, string[]][] = [
    ['scripts/run-accounted-study.mjs', [...base, revision, 'NEVER-READ-MANIFEST']],
    ['scripts/run-initial-game-turn.mjs', [...base, revision]],
    ['scripts/run-continuation.mjs', [...base, 'NEVER-READ-PLAN', '--dispatch-authorized-pilot']],
    ['scripts/run-fresh-first-person-test.mjs', ['NEVER-READ-RUNTIME', 'NEVER-READ-PARENT', 'NEVER-READ-JOURNAL', output,
      'NEVER-READ-CREDENTIAL', 'NEVER-READ-APPROVAL', '--owner-approved-fresh-20-ticks']],
    ['scripts/run-perception-continuation.mjs', ['NEVER-READ-RUNTIME', 'NEVER-READ-PARENT', 'NEVER-READ-JOURNAL', output,
      'NEVER-READ-CREDENTIAL', 'NEVER-READ-PLAN', 'NEVER-READ-APPROVAL', '--dispatch-owner-authorized']],
    ['scripts/check-anthropic-connection.mjs', ['NEVER-READ-RUNTIME', output, 'NEVER-READ-CREDENTIAL']],
    ['scripts/check-anthropic-connection.mjs', ['NEVER-READ-RUNTIME', output, 'NEVER-READ-CREDENTIAL', '--send-one']],
    ['scripts/run-fresh-reasoning-test.mjs', ['NEVER-READ-RUNTIME', 'NEVER-READ-PARENT', 'NEVER-READ-JOURNAL', output,
      'NEVER-READ-CREDENTIAL', 'NEVER-READ-APPROVAL', '--owner-approved-fresh-20-ticks']],
  ];
  for (const [script, args] of invocations) expect(failure(script, args)).toContain(LEGACY_LIVE_DISPATCH_ERROR);
  expect(existsSync(output)).toBe(false);
  expect(readdirSync(directory)).toEqual([]);
});

it('preserves read-only preflight argument paths without opening the paid gate', () => {
  const output = join(root(), 'never-created');
  const fresh = failure('scripts/run-fresh-first-person-test.mjs', ['NEVER-READ-RUNTIME', 'NEVER-READ-PARENT', 'NEVER-READ-JOURNAL', output,
    'NEVER-READ-CREDENTIAL', 'NEVER-READ-APPROVAL', '--preflight-only']);
  const perception = failure('scripts/run-perception-continuation.mjs', ['NEVER-READ-RUNTIME', 'NEVER-READ-PARENT', 'NEVER-READ-JOURNAL', output,
    'NEVER-READ-CREDENTIAL', 'NEVER-READ-PLAN', 'NEVER-READ-APPROVAL', '--preflight-only']);
  expect(fresh).not.toContain(LEGACY_LIVE_DISPATCH_ERROR);
  expect(perception).not.toContain(LEGACY_LIVE_DISPATCH_ERROR);
  expect(existsSync(output)).toBe(false);
});

it('closes the direct real Node worker before credential or attempt-file access, with no env bypass', async () => {
  const directory = join(root(), 'never-created');
  await expect(runAnthropicWorker({ keyPath: 'NEVER-READ-CREDENTIAL', directory })).rejects.toThrow(LEGACY_LIVE_DISPATCH_ERROR);
  expect(existsSync(directory)).toBe(false);
  expect(() => assertLegacyLiveDispatchClosed()).toThrow(/society information boundary/);
  expect(readFileSync(new URL('../scripts/legacy-live-gate.mjs', import.meta.url), 'utf8')).not.toContain('process.env');
});

it('places a direct PowerShell worker stop before every credential read or network operation', () => {
  for (const path of ['anthropic-request.ps1', 'anthropic-perception-request.ps1', 'initial-test-request.ps1']) {
    const source = readFileSync(new URL(`../scripts/${path}`, import.meta.url), 'utf8');
    const stop = source.indexOf("throw '" + LEGACY_LIVE_DISPATCH_ERROR);
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(source.indexOf('Get-Item -LiteralPath'));
    expect(stop).toBeLessThan(source.indexOf('[IO.File]::ReadAllText'));
    expect(stop).toBeLessThan(source.indexOf('[Net.Http.HttpRequestMessage]::new'));
  }
});
