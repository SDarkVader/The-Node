import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural enforcement for the Observatory build spec's Phase C boundary: synthetic
 * drivers (`src/sim/drivers/`) are test instrumentation, never game content, and nothing
 * under `src/engine/`, `src/world/`, or `src/server/` may import from them — the guardrail
 * that stops test scaffolding from quietly becoming a shipped NPC. See
 * `src/sim/drivers/README.md` for the full reasoning.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const GUARDED_DIRS = ['src/engine', 'src/world', 'src/server'];
const FORBIDDEN_PATTERN = /from\s+['"].*sim\/drivers/;

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

describe('src/sim/drivers/ import guard', () => {
  it('nothing under src/engine/, src/world/, or src/server/ imports from sim/drivers', () => {
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
    // A synthetic in-memory check, not a real file — proves FORBIDDEN_PATTERN matches the
    // kind of import statement it's meant to catch, so an empty `violations` array above
    // means "genuinely clean," not "the regex never matches anything."
    const fakeGuardedFileContent = `import { honestDriver } from '../sim/drivers/index.js';\n`;
    expect(FORBIDDEN_PATTERN.test(fakeGuardedFileContent)).toBe(true);
  });
});
