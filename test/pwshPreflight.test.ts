import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// scripts/pwsh-preflight.mjs: every PowerShell worker needs PowerShell 7, and a missing one used to
// surface only as calls with no network record (owner's PC, 2026-10-22). The check must name it.
const preflight = async (): Promise<(env: NodeJS.ProcessEnv) => number> =>
  (await import(pathToFileURL(resolve('scripts/pwsh-preflight.mjs')).href)).assertPowerShell7;
/** A PATH holding only the given fake `pwsh` (a POSIX shell script), or nothing at all. */
function pathWith(script: string | null): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'node-pwsh-'));
  if (script !== null) { writeFileSync(join(dir, 'pwsh'), `#!/bin/sh\n${script}\n`); chmodSync(join(dir, 'pwsh'), 0o755); }
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
  return { ...env, PATH: dir };
}

describe('PowerShell 7 preflight', () => {
  it('names a missing pwsh instead of failing later as a null network record', async () => {
    const check = await preflight();
    expect(() => check(pathWith(null))).toThrow('pwsh_not_found_install_powershell_7');
  });

  it.skipIf(process.platform === 'win32')('accepts 7 or later and refuses older or unreadable versions', async () => {
    const check = await preflight();
    expect(check(pathWith('echo 7'))).toBe(7);
    expect(check(pathWith('printf "\\r\\n8\\r\\n"'))).toBe(8);
    expect(() => check(pathWith('echo 5'))).toThrow('pwsh_version_below_7');
    expect(() => check(pathWith('echo PowerShell'))).toThrow('pwsh_version_below_7');
    expect(() => check(pathWith('exit 1'))).toThrow('pwsh_preflight_failed');
  });
});
