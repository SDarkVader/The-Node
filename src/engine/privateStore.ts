import type { PlayerId } from './player.js';

/**
 * Generic per-player private state store with silent, rolling per-entry expiry (scoped
 * 2026-08-07, see docs/BLUEPRINT.md "Architecture scoped ahead of schedule").
 * Server-authoritative: the private diary's ~30-day silent expiry
 * (docs/DESIGN_ADDENDUM_2026-08-06.md) has to be enforced somewhere a client can't just
 * refuse to forget, so entries live here and expiry is applied on every read rather than
 * trusted to the client.
 *
 * Deliberately generic, not diary-specific — the diary's exact slot contents
 * (SUBJECT/OBSERVATION/READING/CONTEXT) are still [OPEN] in the design addendum. This
 * only builds the storage/expiry shape every private-per-player mechanic (diary first,
 * Oracle draw-state later) will reuse: each entry ages out independently on its own
 * clock, oldest first, no fade or blur before expiry, no warning at expiry.
 */

export interface PrivateEntry<T> {
  value: T;
  createdOnDay: number;
}

export type PrivateStore<T> = Map<PlayerId, PrivateEntry<T>[]>;

export function createPrivateStore<T>(): PrivateStore<T> {
  return new Map();
}

export function addEntry<T>(store: PrivateStore<T>, owner: PlayerId, value: T, day: number): void {
  const list = store.get(owner) ?? [];
  list.push({ value, createdOnDay: day });
  store.set(owner, list);
}

/**
 * Entries still alive as of `day` for `owner`, oldest first. Expired entries are dropped
 * from the store as a side effect of the read — silently, no trace kept, matching the
 * diary's "erodes into memory" design intent rather than a soft-delete/undo model.
 */
export function getAlive<T>(store: PrivateStore<T>, owner: PlayerId, day: number, ttlDays: number): T[] {
  const list = store.get(owner) ?? [];
  const alive = list.filter((entry) => day - entry.createdOnDay < ttlDays);
  if (alive.length !== list.length) {
    store.set(owner, alive);
  }
  return alive.map((entry) => entry.value);
}
