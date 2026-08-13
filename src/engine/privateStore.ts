import type { PlayerId } from './player.js';

/**
 * Generic per-player private state store with silent, rolling per-entry expiry (scoped
 * 2026-08-07, see docs/BLUEPRINT.md "Architecture scoped ahead of schedule").
 * Server-authoritative: the private diary's retention window and daily distortion
 * (docs/DESIGN_ADDENDUM_2026-08-06.md, corrected 2026-08-13) have to be enforced
 * somewhere a client can't just refuse to forget or refuse to blur, so entries live
 * here and both are applied on every read rather than trusted to the client.
 *
 * Deliberately generic, not diary-specific — the diary's exact slot contents
 * (SUBJECT/OBSERVATION/READING/CONTEXT) are still [OPEN] in the design addendum. This
 * only builds the storage/expiry/distortion shape every private-per-player mechanic
 * (diary first, Oracle draw-state later) will reuse: each entry ages out independently
 * on its own clock, oldest first, no warning at expiry — and, corrected 2026-08-13,
 * each entry that survives a server day-tick can be nudged toward a plausible-adjacent
 * value by a caller-supplied `distort` function (the diary's is expected to be
 * `applyDistortion` from ../comms/decay.js) rather than reading back exactly as
 * written. A store used for something that must NOT drift (e.g. a future ledger of
 * fact rather than impression) simply omits `distort` — expiry and distortion are
 * independent, opt-in per call.
 */

export interface PrivateEntry<T> {
  value: T;
  createdOnDay: number;
  lastTouchedOnDay: number;
}

export type PrivateStore<T> = Map<PlayerId, PrivateEntry<T>[]>;

export function createPrivateStore<T>(): PrivateStore<T> {
  return new Map();
}

export function addEntry<T>(store: PrivateStore<T>, owner: PlayerId, value: T, day: number): void {
  const list = store.get(owner) ?? [];
  list.push({ value, createdOnDay: day, lastTouchedOnDay: day });
  store.set(owner, list);
}

/**
 * Entries still alive as of `day` for `owner`, oldest first. Expired entries are dropped
 * from the store as a side effect of the read — silently, no trace kept, matching the
 * diary's "erodes into memory" design intent rather than a soft-delete/undo model.
 *
 * When `distort` and `rng` are both supplied, every surviving entry is also nudged one
 * step per server day elapsed since it was last touched (catching up in one read if
 * several days passed since the last one) — mutating the stored value in place, so a
 * re-read on the same day returns the same (already-distorted) value, but a read on a
 * later day may not match what was written. This is what makes the memory "mechanical":
 * it isn't the player's own recollection re-decaying each time they look, it's the
 * server's stored copy quietly drifting once per day whether or not anyone reads it.
 */
export function getAlive<T>(
  store: PrivateStore<T>,
  owner: PlayerId,
  day: number,
  ttlDays: number,
  distort?: (value: T, rng: () => number) => T,
  rng?: () => number,
): T[] {
  const list = store.get(owner) ?? [];
  const alive = list.filter((entry) => day - entry.createdOnDay < ttlDays);
  let changed = alive.length !== list.length;
  if (distort && rng) {
    for (const entry of alive) {
      while (entry.lastTouchedOnDay < day) {
        entry.value = distort(entry.value, rng);
        entry.lastTouchedOnDay += 1;
        changed = true;
      }
    }
  }
  if (changed) {
    store.set(owner, alive);
  }
  return alive.map((entry) => entry.value);
}
