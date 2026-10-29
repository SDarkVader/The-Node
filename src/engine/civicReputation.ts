/**
 * Experimental, pure civic reputation projection. NOT wired to world, roles,
 * legacy reputationProgress, observation packets, provider calls or backstops.
 * Inputs MUST be independently authenticated/verified civic events: this reducer
 * cannot establish whether the underlying deed actually happened.
 *
 * Civic history is immutable externally; this function derives changing standings
 * without storing private trust dossiers or rewarding unverified rumours.
 */
export const CIVIC_REPUTATION_DOMAINS = ['service', 'cooperation', 'conduct'] as const;
export type CivicReputationDomain = (typeof CIVIC_REPUTATION_DOMAINS)[number];
export type CivicReputationValence = 'positive' | 'negative';
export interface CivicReputationEvent {
  readonly id: string;
  readonly subjectId: string;
  readonly day: number;
  readonly domain: CivicReputationDomain;
  readonly valence: CivicReputationValence;
  readonly weight: number;
}
export interface CivicReputationParams {
  readonly scale: number;
  readonly prior: number;
  readonly dailyCap: number;
}
export const DEFAULT_CIVIC_REPUTATION_PARAMS: Readonly<CivicReputationParams> = Object.freeze({
  scale: 10,
  prior: 5,
  dailyCap: 3,
});
export interface CivicReputationScore {
  readonly positive: number;
  readonly negative: number;
  readonly standing: number;
  readonly notoriety: number;
}
export interface CivicReputationProfile extends CivicReputationScore {
  readonly subjectId: string;
  readonly domains: Readonly<Record<CivicReputationDomain, CivicReputationScore>>;
}
function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
function validParams(params: CivicReputationParams): void {
  if (!finitePositive(params.scale) || !finitePositive(params.prior) || !finitePositive(params.dailyCap)) {
    throw Error('civic_reputation_invalid_params');
  }
}
export function civicReputationScore(positive: number, negative: number, params: CivicReputationParams = DEFAULT_CIVIC_REPUTATION_PARAMS): CivicReputationScore {
  validParams(params);
  if (!Number.isFinite(positive) || positive < 0 || !Number.isFinite(negative) || negative < 0) {
    throw Error('civic_reputation_invalid_evidence');
  }
  const standing = params.scale * (Math.log1p(positive / params.prior) - Math.log1p(negative / params.prior));
  const notoriety = params.scale * Math.log1p((positive + negative) / params.prior);
  if (!Number.isFinite(standing) || !Number.isFinite(notoriety)) throw Error('civic_reputation_numeric_overflow');
  return { positive, negative, standing, notoriety };
}
function validIdentity(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(s);
}
function validateEvent(e: CivicReputationEvent): void {
  if (!e || !validIdentity(e.id) || !validIdentity(e.subjectId) || !Number.isSafeInteger(e.day) || e.day < 0 ||
      !CIVIC_REPUTATION_DOMAINS.includes(e.domain) || (e.valence !== 'positive' && e.valence !== 'negative') ||
      !Number.isSafeInteger(e.weight) || e.weight < 1 || e.weight > 3) {
    throw Error('civic_reputation_invalid_event');
  }
}
/**
 * Order-independent, replayable reduction. A single event ID may appear only once;
 * witness count cannot multiply it. The same subject/day/domain/valence group may
 * contribute at most dailyCap units. Opposite valences have separate caps.
 *
 * The daily cap is an *experimental policy*, not an assertion about the live game.
 */
export function computeCivicReputation(
  events: readonly CivicReputationEvent[],
  params: CivicReputationParams = DEFAULT_CIVIC_REPUTATION_PARAMS,
): ReadonlyMap<string, CivicReputationProfile> {
  validParams(params);
  const ids = new Set<string>();
  const raw = new Map<string, Map<number, Map<CivicReputationDomain, { positive: number; negative: number }>>>();
  for (const event of events) {
    validateEvent(event);
    if (ids.has(event.id)) throw Error('civic_reputation_duplicate_event');
    ids.add(event.id);
    let days = raw.get(event.subjectId);
    if (!days) { days = new Map(); raw.set(event.subjectId, days); }
    let domains = days.get(event.day);
    if (!domains) { domains = new Map(); days.set(event.day, domains); }
    let cell = domains.get(event.domain);
    if (!cell) { cell = { positive: 0, negative: 0 }; domains.set(event.domain, cell); }
    cell[event.valence] += event.weight;
  }
  const profiles = new Map<string, CivicReputationProfile>();
  for (const subjectId of [...raw.keys()].sort()) {
    const domains: Record<CivicReputationDomain, CivicReputationScore> = {
      service: civicReputationScore(0, 0, params),
      cooperation: civicReputationScore(0, 0, params),
      conduct: civicReputationScore(0, 0, params),
    };
    const totals: Record<CivicReputationDomain, { positive: number; negative: number }> = {
      service: { positive: 0, negative: 0 },
      cooperation: { positive: 0, negative: 0 },
      conduct: { positive: 0, negative: 0 },
    };
    for (const day of raw.get(subjectId)!.values()) {
      for (const [domain, cell] of day) {
        totals[domain].positive += Math.min(params.dailyCap, cell.positive);
        totals[domain].negative += Math.min(params.dailyCap, cell.negative);
      }
    }
    let positive = 0, negative = 0;
    for (const domain of CIVIC_REPUTATION_DOMAINS) {
      const cell = totals[domain];
      positive += cell.positive; negative += cell.negative;
      domains[domain] = civicReputationScore(cell.positive, cell.negative, params);
    }
    profiles.set(subjectId, { subjectId, ...civicReputationScore(positive, negative, params), domains });
  }
  return profiles;
}
/** Relative-share index, not a win probability or action policy. */
export function civicRelativeShares(
  scores: readonly { readonly subjectId: string; readonly standing: number }[],
  temperature = 5,
): ReadonlyMap<string, number> {
  if (!finitePositive(temperature)) throw Error('civic_reputation_invalid_temperature');
  if (scores.length === 0) return new Map();
  const ids = new Set<string>();
  for (const { subjectId, standing } of scores) {
    if (!validIdentity(subjectId) || !Number.isFinite(standing) || ids.has(subjectId)) {
      throw Error('civic_reputation_invalid_competitors');
    }
    ids.add(subjectId);
  }
  let top = -Infinity;
  for (const score of scores) top = Math.max(top, score.standing / temperature);
  const weights = scores.map(s => Math.exp(s.standing / temperature - top));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const results = new Map<string, number>();
  for (let i = 0; i < scores.length; i += 1) {
    results.set(scores[i]!.subjectId, weights[i]! / total);
  }
  return results;
}
