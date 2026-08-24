import { shardCharacterFor, CANONICAL_ROLE_TITLES, isSpineRole, type RoleKey } from '../engine/shardIdentity.js';

/**
 * Prints how the six roles are framed on each shard. Presentation only — every shard runs
 * the identical economic model; see engine/shardIdentity.ts for why that is enforced
 * structurally rather than by convention.
 */
const ROLES: RoleKey[] = ['miller', 'baker', 'courier', 'investigator', 'importExport'];
const SHARDS = Number(process.argv[2] ?? 6);

console.log('Local role framing by shard — cosmetic only, mechanics are identical everywhere.\n');
console.log(`${'role'.padEnd(16)}${'canonical'.padEnd(16)}spine?`);
for (const r of ROLES) console.log(`${r.padEnd(16)}${CANONICAL_ROLE_TITLES[r].padEnd(16)}${isSpineRole(r) ? 'yes — stays findable' : 'no — reframed locally'}`);

for (let id = 0; id < SHARDS; id++) {
  const c = shardCharacterFor(id);
  console.log(`\n── shard ${id}: ${c.name} ──`);
  console.log(`   ${c.premise}`);
  console.log('   ' + ROLES.map((r) => `${CANONICAL_ROLE_TITLES[r]} → ${c.roleTitles[r]}`).join('\n   '));
}
console.log('\nA migrant carries knowledge of one shard into another where the same role wears a');
console.log('different name — asymmetric information across shards, at zero cost to the simulation.');
