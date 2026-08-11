/**
 * Shard identity and local role framing (2026-08-11, user-specified: "I can always change
 * roles in different shards, some essential very similar, but other just reframed under the
 * constraints ... so we can have diversity also"). Pure, dependency-free.
 *
 * TIER 1 ONLY, AND STRUCTURALLY SO. This is presentation, not mechanics. Every shard runs
 * the identical economic model with identical constants; only what the six roles are CALLED
 * and how a shard describes itself vary. That is deliberate and enforced by construction:
 *
 *   Nothing here is stored on `World`, and `world.ts` does not import this module.
 *
 * So a shard's identity cannot reach the tick even by accident — there is no field for it to
 * be read from. `test/shardIdentity.test.ts` additionally proves two worlds with different
 * identities produce byte-identical trajectories. If a future change needs framing to affect
 * behaviour, that is Tier 2 (per-shard config), a separate and much more expensive decision
 * — see `docs/RESEARCH_QUESTIONS.md` on migration preference before going there.
 *
 * WHY THIS IS WORTH HAVING AT ALL, given it changes no numbers: it reinforces the core
 * design tension. A player who migrates carries knowledge of shard A into shard B, where the
 * same underlying role wears a different name and a different local justification — so their
 * knowledge is *partially* wrong, in the specific way that is hard to notice. That is
 * asymmetric information operating across shards rather than only within one, at zero cost
 * to the simulation.
 *
 * ESSENTIAL VS REFRAMED, per the user's own distinction. Miller and Baker are the economic
 * spine — flour and bread are the same everywhere — so their local names stay close to
 * recognisable. Courier, Journalist, Detective and Import/Export are framed much more freely
 * by local conditions, because what they *mean* in a place varies more than what they do.
 */

export type RoleKey = 'miller' | 'baker' | 'courier' | 'journalist' | 'detective' | 'importExport';

export interface ShardCharacter {
  /** The shard's own name for itself. */
  name: string;
  /** One line of local character — what shapes this place. */
  premise: string;
  /** Local title for each role. */
  roleTitles: Readonly<Record<RoleKey, string>>;
}

/**
 * The available shard characters. Deliberately a small, fixed, hand-written set rather than
 * generated combinations: a name that reads as authored is worth more than one that reads as
 * assembled, and a player who has seen three shards should recognise a fourth as a *place*,
 * not as a permutation.
 *
 * Miller/Baker titles stay legible across all of them (the spine); the other four drift
 * further, because their local meaning is what actually differs.
 */
export const SHARD_CHARACTERS: readonly ShardCharacter[] = [
  {
    name: 'Longwater',
    premise: 'Built along a slow river; everything arrives late and everyone knows it.',
    roleTitles: {
      miller: 'Miller',
      baker: 'Baker',
      courier: 'Runner',
      journalist: 'Chronicler',
      detective: 'Asker',
      importExport: 'Factor',
    },
  },
  {
    name: 'The Foundry',
    premise: 'An old industrial quarter that never quite stopped working.',
    roleTitles: {
      miller: 'Grinder',
      baker: 'Oven-keeper',
      courier: 'Legman',
      journalist: 'Broadsheet',
      detective: 'Inspector',
      importExport: 'Consignor',
    },
  },
  {
    name: 'Saltmarket',
    premise: 'A trading town with long memories and short contracts.',
    roleTitles: {
      miller: 'Miller',
      baker: 'Breadwright',
      courier: 'Carrier',
      journalist: 'Crier',
      detective: 'Watch',
      importExport: 'Dockmaster',
    },
  },
  {
    name: 'Ashgate',
    premise: 'Rebuilt twice already; nobody here assumes anything is permanent.',
    roleTitles: {
      miller: 'Mill-hand',
      baker: 'Baker',
      courier: 'Courier',
      journalist: 'Recorder',
      detective: 'Questioner',
      importExport: 'Gatekeeper',
    },
  },
  {
    name: 'The Terraces',
    premise: 'Stacked and crowded; your neighbours hear most of what you do.',
    roleTitles: {
      miller: 'Miller',
      baker: 'Oven-keeper',
      courier: 'Stairrunner',
      journalist: 'Noticewright',
      detective: 'Overlook',
      importExport: 'Broker',
    },
  },
  {
    name: 'Coldharbour',
    premise: 'The last stop before nowhere; people arrive here on purpose or not at all.',
    roleTitles: {
      miller: 'Grinder',
      baker: 'Baker',
      courier: 'Ferryhand',
      journalist: 'Witness',
      detective: 'Reckoner',
      importExport: 'Harbourmaster',
    },
  },
];

/** Canonical role names, for when a shard-neutral term is needed (docs, tooling, logs). */
export const CANONICAL_ROLE_TITLES: Readonly<Record<RoleKey, string>> = {
  miller: 'Miller',
  baker: 'Baker',
  courier: 'Courier',
  journalist: 'Journalist',
  detective: 'Detective',
  importExport: 'Import/Export',
};

/**
 * The character for a given shard id — deterministic, stable for the life of that shard, and
 * derived from the id alone so it never needs storing. Shard ids only ever grow, so beyond
 * `SHARD_CHARACTERS.length` shards the set repeats; that is acceptable and honest (a
 * recurring name is a recognisable place), and preferable to generating filler.
 */
export function shardCharacterFor(shardId: number): ShardCharacter {
  const idx = ((shardId % SHARD_CHARACTERS.length) + SHARD_CHARACTERS.length) % SHARD_CHARACTERS.length;
  return SHARD_CHARACTERS[idx]!;
}

/** What a given role is called on a given shard. */
export function roleTitleOn(shardId: number, role: RoleKey): string {
  return shardCharacterFor(shardId).roleTitles[role];
}

/**
 * Whether a role keeps a recognisable name across shards. Miller and Baker are the economic
 * spine (flour and bread work identically everywhere), so a migrant can find them; the other
 * four are framed locally and genuinely need re-learning.
 */
export function isSpineRole(role: RoleKey): boolean {
  return role === 'miller' || role === 'baker';
}
