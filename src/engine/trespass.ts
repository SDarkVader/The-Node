/**
 * Trespass eligibility (`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.1-7.2) — the
 * absence-gate precondition only, same scope `arson.ts`'s `canAttemptArson` has for arson:
 * this file answers "is the target trespassable right now," not "what happens when someone
 * trespasses." The full act (spending a key, reading the diary's SUBJECT graph, witness-based
 * detection) needs the key-crafting item and a real per-tick witness pass, neither of which
 * exists yet — deliberately not attempted here, same staging arson.ts itself used before
 * `sabotagePatternHarness.ts` existed.
 *
 * THE RULE, user's own words: *"you can only trespass when the player is outside or
 * offline."* Two signals, either one alone is sufficient: OFFLINE (regardless of where their
 * abode "is" — an offline player cannot be present anywhere), or ONLINE-BUT-ELSEWHERE (present
 * in the world, just not at their own abode right now). §7.6 later generalizes the SAME
 * absence-gate shape to arson, which is why this mirrors `ArsonPresence`'s two-boolean shape
 * rather than inventing a different one — but the actual rule differs: arson requires BOTH
 * "not working" AND "not at abode"; trespass requires only "not at abode," and being offline
 * always satisfies that regardless of the second signal.
 *
 * WHAT THIS FILE DOES NOT KNOW, flagged rather than guessed at: whether a target is
 * physically AT their abode right now. No per-player abode-location tracking exists anywhere
 * in this engine — `space.ts`'s `HOUSING_FLOORS_PER_BUILDING`/`HOUSING_RESIDENTS_PER_FLOOR`
 * are DISTRICT-level capacity aggregates (does a district have housing headroom), not a
 * specific "this player's abode is building X" assignment, and nothing tracks a player's
 * current position relative to any such assignment. The design doc's own §7.1 claim
 * ("both already representable, nothing new to invent") turned out not to be checked against
 * the actual codebase — corrected here rather than silently built around: `targetAtAbode`
 * stays a required, externally-supplied input until that tracking exists, the same way
 * `ArsonPresence.targetPresentAtAbode` is already an opaque input `arson.ts` never resolves
 * itself.
 */

export interface TrespassEligibility {
  /** From `World.presence[targetId]?.online` — the one half of this gate that IS real,
   *  live data today. */
  targetOnline: boolean;
  /** Whether the target is physically at their own abode right now. Not yet resolvable from
   *  `World` — see this file's header. Irrelevant when `targetOnline` is false: an offline
   *  player is never "at" anywhere in the sense this gate cares about. */
  targetAtAbode: boolean;
}

/**
 * The absence-gate, exactly per §7.1: trespass is possible whenever the target is NOT present
 * at their abode — whether because they're offline, or because they're online somewhere else.
 * `targetAtAbode` only matters while `targetOnline` is true.
 */
export function canAttemptTrespass(eligibility: TrespassEligibility): boolean {
  return !eligibility.targetOnline || !eligibility.targetAtAbode;
}
