import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  shardCharacterFor, roleTitleOn, isSpineRole, SHARD_CHARACTERS, CANONICAL_ROLE_TITLES,
  type RoleKey,
} from '../src/engine/shardIdentity.js';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';

const ROLES: RoleKey[] = ['miller', 'baker', 'courier', 'journalist', 'detective', 'importExport'];

describe('shardIdentity — Tier 1 is structurally inert', () => {
  it('the simulation never imports it — framing cannot reach the tick even by accident', () => {
    // The strongest guarantee available: there is no code path from identity to mechanics,
    // because the kernel does not reference this module at all. Mirrors the existing
    // drivers.importGuard pattern.
    const scan = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scan(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
      );
    const kernelFiles = [...scan('src/world'), ...scan('src/engine')].filter((f) => !f.endsWith('shardIdentity.ts'));
    const offenders = kernelFiles.filter((f) => /from\s+['"].*shardIdentity(\.js)?['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('worlds are byte-identical regardless of which shard identity is applied to them', () => {
    // Identity is derived from a shard id and never stored, so the same seed must produce
    // the same trajectory no matter what that shard is called.
    const trajectory = () => {
      let w = createWorld(21, DEFAULT_WORLD_CONFIG);
      const out: unknown[] = [];
      for (let i = 0; i < 150; i++) {
        w = stepWorld(w);
        out.push({ pop: w.population, health: w.economicHealth, gini: w.wealthGini, flour: w.flourPrice });
      }
      return JSON.stringify(out);
    };
    const a = trajectory();
    // Reading identities for every shard in between must change nothing.
    for (let id = 0; id < 20; id++) shardCharacterFor(id);
    expect(trajectory()).toBe(a);
  });
});

describe('shardIdentity — framing', () => {
  it('is deterministic and stable for a given shard id', () => {
    for (let id = 0; id < 30; id++) expect(shardCharacterFor(id)).toBe(shardCharacterFor(id));
  });

  it('handles ids beyond the character set by repeating, never by failing', () => {
    for (const id of [0, 5, 6, 99, 1000]) {
      expect(shardCharacterFor(id).name).toBeTruthy();
      for (const r of ROLES) expect(roleTitleOn(id, r)).toBeTruthy();
    }
  });

  it('every character names all six roles, and none are blank', () => {
    for (const c of SHARD_CHARACTERS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.premise.length).toBeGreaterThan(0);
      for (const r of ROLES) expect(c.roleTitles[r].length).toBeGreaterThan(0);
    }
  });

  it('shard names are unique — a repeated name would read as the same place', () => {
    const names = SHARD_CHARACTERS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the economic spine stays findable: Miller and Baker keep a recognisable title everywhere', () => {
    // A migrant must be able to locate flour and bread; those work identically on every
    // shard, so hiding them behind unrecognisable names would be a lie about the mechanics.
    for (const c of SHARD_CHARACTERS) {
      expect(/mill|grind/i.test(c.roleTitles.miller)).toBe(true);
      expect(/bak|bread|oven/i.test(c.roleTitles.baker)).toBe(true);
    }
    expect(isSpineRole('miller')).toBe(true);
    expect(isSpineRole('baker')).toBe(true);
    for (const r of ROLES.filter((x) => x !== 'miller' && x !== 'baker')) expect(isSpineRole(r)).toBe(false);
  });

  it('the four non-spine roles genuinely vary — otherwise there is nothing to re-learn', () => {
    for (const r of ROLES.filter((x) => !isSpineRole(x))) {
      const distinct = new Set(SHARD_CHARACTERS.map((c) => c.roleTitles[r]));
      expect(distinct.size).toBeGreaterThanOrEqual(SHARD_CHARACTERS.length - 1);
    }
  });

  it('canonical titles exist for shard-neutral contexts', () => {
    for (const r of ROLES) expect(CANONICAL_ROLE_TITLES[r].length).toBeGreaterThan(0);
  });
});
