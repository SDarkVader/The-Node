/**
 * Recognition model v2 (2026-10-21). Opt-in via `WorldConfig.recognition = 'v2'`; with the
 * field absent the kernel keeps v1 (`identity.ts`, heard Wall posts) byte for byte, so study 1
 * and the archived G1 evidence are untouched.
 *
 * Calibrated in `docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md` (rules I1D/O-short and
 * the second pass) against the owner's decisions:
 * - recognition comes from DIRECTED interaction (being addressed) and REPEATED IDENTIFIABLE
 *   DEALINGS (trade, supply, delivery, inquiry), about 10-20 days of regular contact;
 * - passive presence, anonymous purchases, overheard or room speech and Wall posts never
 *   resolve anyone on their own (`PASSIVE_CEILING` sits below the threshold) — they only leave
 *   familiarity that real dealings build on;
 * - an explicit refusal is an addressed utterance, so it is an interaction; silence earns the
 *   silent person nothing in the speaker's ledger;
 * - resolution lapses about 60 days after contact stops ((CAP - LOSE_BELOW) / DECAY), while the
 *   residual credit below LOSE_BELOW is familiarity that makes re-resolution faster. The person
 *   reference itself never changes: only resolution is lost, never identity.
 *
 * Directional and per pair: `observer -> subject`. Integer units only, no RNG, deterministic
 * iteration (rows rebuilt in sorted order), so replay and hashing stay exact. Nothing here is
 * exposed to agents: they see only who they currently recognise, never credit or thresholds.
 */

export const RECOGNITION_THRESHOLD = 120;
/** Once resolved, resolution is lost only below this (hysteresis). */
export const RECOGNITION_LOSE_BELOW = 90;
export const RECOGNITION_CAP = 150;
export const RECOGNITION_DECAY_PER_DAY = 1;
/** Being directly addressed (by the speaker's intent), whatever the intent — refusal included. */
export const CREDIT_ADDRESS = 14;
/** A dealing credits in proportion to the days since the pair last dealt, up to one week's worth:
 *  identification comes from repeated occasions, not from volume on one day. */
export const CREDIT_DEALING_MAX = 45;
export const CREDIT_DEALING_PER_GAP_DAY = 7;
/** A dealing is identifiable only if the pair already dealt within this window; otherwise it is
 *  anonymous and counts as passive. */
export const DEALING_IDENTIFIABLE_WINDOW_DAYS = 30;
export const CREDIT_OVERHEARD = 1;
export const CREDIT_WALL = 2;
/** Passive credit never raises a pair above this, so passive channels can never resolve alone. */
export const PASSIVE_CEILING = 60;

export type InteractionKind = 'address' | 'dealing' | 'overheard' | 'wall';
/** One real event in which `observer` encountered `subject` today. */
export interface Interaction { observer: string; subject: string; kind: InteractionKind }

export interface RecognitionEntry { credit: number; resolved: boolean }
export type RecognitionLedger = ReadonlyMap<string, ReadonlyMap<string, RecognitionEntry>>;

export interface RecognitionState {
  ledger: RecognitionLedger;
  /** `observer>subject` -> last day they dealt, pruned past the identifiable window. */
  lastDealt: ReadonlyMap<string, number>;
}

export interface RecognitionTick {
  state: RecognitionState;
  gained: Array<[observer: string, subject: string]>;
  lost: Array<[observer: string, subject: string]>;
}

export const emptyRecognitionState = (): RecognitionState => ({ ledger: new Map(), lastDealt: new Map() });

const pairKey = (o: string, s: string) => `${o}>${s}`;
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Applies one day: decay, then today's active credit, then capped passive credit, then resolution and lapse. */
export function stepRecognition(state: RecognitionState, day: number, interactions: readonly Interaction[]): RecognitionTick {
  const work = new Map<string, Map<string, RecognitionEntry>>();
  for (const [o, row] of state.ledger) {
    const next = new Map<string, RecognitionEntry>();
    for (const [s, e] of row) next.set(s, { credit: Math.max(0, e.credit - RECOGNITION_DECAY_PER_DAY), resolved: e.resolved });
    work.set(o, next);
  }
  const lastDealt = new Map(state.lastDealt);
  const active = new Map<string, number>();
  const passive = new Map<string, number>();
  const seen = new Set<string>();
  for (const i of interactions) {
    if (i.observer === i.subject) continue;
    const key = pairKey(i.observer, i.subject);
    if (seen.has(`${key}|${i.kind}`)) continue; // one credit per pair, per kind, per day
    seen.add(`${key}|${i.kind}`);
    if (i.kind === 'address') active.set(key, (active.get(key) ?? 0) + CREDIT_ADDRESS);
    else if (i.kind === 'overheard') passive.set(key, (passive.get(key) ?? 0) + CREDIT_OVERHEARD);
    else if (i.kind === 'wall') passive.set(key, (passive.get(key) ?? 0) + CREDIT_WALL);
    else {
      const last = lastDealt.get(key);
      const gap = last === undefined ? Infinity : day - last;
      if (gap <= DEALING_IDENTIFIABLE_WINDOW_DAYS) active.set(key, (active.get(key) ?? 0) + Math.min(CREDIT_DEALING_MAX, CREDIT_DEALING_PER_GAP_DAY * gap));
      else passive.set(key, (passive.get(key) ?? 0) + CREDIT_DEALING_MAX);
      lastDealt.set(key, day);
    }
  }
  const entry = (key: string) => {
    const [o, s] = key.split('>') as [string, string];
    if (!work.has(o)) work.set(o, new Map());
    const row = work.get(o)!;
    if (!row.has(s)) row.set(s, { credit: 0, resolved: false });
    return row.get(s)!;
  };
  for (const [key, units] of active) { const e = entry(key); e.credit = Math.min(RECOGNITION_CAP, e.credit + units); }
  for (const [key, units] of passive) { const e = entry(key); e.credit = Math.max(e.credit, Math.min(PASSIVE_CEILING, e.credit + units)); }

  const gained: Array<[string, string]> = [];
  const lost: Array<[string, string]> = [];
  const ledger = new Map<string, Map<string, RecognitionEntry>>();
  for (const o of [...work.keys()].sort(byKey)) {
    const row = new Map<string, RecognitionEntry>();
    for (const s of [...work.get(o)!.keys()].sort(byKey)) {
      const e = work.get(o)!.get(s)!;
      if (!e.resolved && e.credit >= RECOGNITION_THRESHOLD) { e.resolved = true; gained.push([o, s]); }
      else if (e.resolved && e.credit < RECOGNITION_LOSE_BELOW) { e.resolved = false; lost.push([o, s]); }
      if (e.credit > 0 || e.resolved) row.set(s, e);
    }
    if (row.size) ledger.set(o, row);
  }
  const pruned = new Map([...lastDealt].filter(([, d]) => day - d <= DEALING_IDENTIFIABLE_WINDOW_DAYS).sort(([a], [b]) => byKey(a, b)));
  return { state: { ledger, lastDealt: pruned }, gained, lost };
}

/** Everyone `observer` currently resolves. */
export function resolvedBy(ledger: RecognitionLedger, observer: string): Set<string> {
  return new Set([...(ledger.get(observer) ?? [])].filter(([, e]) => e.resolved).map(([s]) => s));
}

// ---- Exposure, for pressure detection (decoupled from recognition) ----------------------

/** How long a day's Wall reach keeps counting toward an author's exposure. */
export const EXPOSURE_WINDOW_DAYS = 30;
export type WallReach = ReadonlyMap<string, ReadonlyArray<{ day: number; reach: number }>>;

/** Appends today's reach (share of the located population that heard the author today). */
export function recordWallReach(previous: WallReach, day: number, reachToday: ReadonlyMap<string, number>): WallReach {
  const next = new Map<string, Array<{ day: number; reach: number }>>();
  const authors = new Set([...previous.keys(), ...reachToday.keys()]);
  for (const a of [...authors].sort(byKey)) {
    const kept = (previous.get(a) ?? []).filter((r) => day - r.day < EXPOSURE_WINDOW_DAYS);
    const today = reachToday.get(a);
    const rows = today === undefined ? kept : [...kept, { day, reach: today }];
    if (rows.length) next.set(a, rows);
  }
  return next;
}

/** How widely an author's posts have been heard recently: 1 - prod(1 - reach), in [0, 1]. Built
 *  only from observable hearing events, never from who recognises whom. */
export function wallExposure(reach: WallReach, author: string): number {
  let unheard = 1;
  for (const r of reach.get(author) ?? []) unheard *= 1 - Math.max(0, Math.min(1, r.reach));
  return 1 - unheard;
}
