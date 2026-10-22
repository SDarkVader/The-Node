// Shared preflight for the scripts that dispatch through a PowerShell worker. Every worker runs
// under PowerShell 7 (`pwsh`), not Windows PowerShell 5.1: they use `ConvertFrom-Json -Depth`,
// which 5.1 lacks. Without this check a missing `pwsh` only surfaced as calls with no network
// record (owner's PC, 2026-10-22: seven `httpStatus: null`). It runs before any reservation,
// credential read or dispatch, so a failure here costs nothing and leaves no hold.
import { execFileSync } from 'node:child_process';

export function assertPowerShell7(env) {
  let out;
  try {
    out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, env, maxBuffer: 4096 });
  } catch (error) {
    throw Error(error?.code === 'ENOENT' ? 'pwsh_not_found_install_powershell_7' : 'pwsh_preflight_failed');
  }
  const major = Number(String(out).trim().split(/\s+/).pop());
  if (!Number.isSafeInteger(major) || major < 7) throw Error('pwsh_version_below_7');
  return major;
}
