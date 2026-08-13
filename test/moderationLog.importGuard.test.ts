import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural enforcement for `docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`'s §3: the
 * simulation kernel must have zero dependency on or awareness of the moderation-logging
 * infra layer, so the game itself is unaffected if that service is ever offline. Same
 * pattern as `test/drivers.importGuard.test.ts` — the guardrail lives in a test, not just a
 * doc comment someone could miss.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const GUARDED_DIRS = ['src/engine', 'src/world', 'src/comms', 'src/server'];
const FORBIDDEN_PATTERN = /from\s+['"].*infra\/moderationLog/;

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('src/infra/moderationLog import guard', () => {
  it('nothing under src/engine/, src/world/, src/comms/, or src/server/ imports the moderation logger', () => {
    const violations: string[] = [];

    for (const dir of GUARDED_DIRS) {
      const fullDir = join(REPO_ROOT, dir);
      for (const file of listTsFiles(fullDir)) {
        const content = readFileSync(file, 'utf8');
        if (FORBIDDEN_PATTERN.test(content)) {
          violations.push(file);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('sanity check: the guard actually detects a real violation, not just always passing', () => {
    const fakeGuardedFileContent = `import { createInMemorySink } from '../infra/moderationLog.js';\n`;
    expect(FORBIDDEN_PATTERN.test(fakeGuardedFileContent)).toBe(true);
  });
});
