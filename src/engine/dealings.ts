/**
 * Individual dealings (recognition v2, 2026-10-21). Opt-in with `WorldConfig.recognition = 'v2'`.
 *
 * Every event here is an attribution of an economic flow the kernel ALREADY computes, so nothing
 * is counted twice:
 * - purchase:    bread demand made individual. Each person is due once per purchase cycle on a
 *                stable weekday. Their Baker is a regular, kept or redrawn by the existing
 *                inverse-price share (`splitBakerDemand`'s weights) — a chain whose stationary
 *                distribution is exactly that share. Served counts replace the fractional split;
 *                income and bread still come from `bakerDailyIncome`/`stepResourceFlows`.
 * - flourSupply: each Baker's flour use (bread x FLOUR_PER_BREAD) attributed to a regular Miller,
 *                drawn by realised supply share. Miller income is unchanged (pooled market).
 * - grainSupply: each Miller's grain use attributed to a regular Import/Export slot, drawn by
 *                intake share (FILLED 1, BACKSTOPPED 0.4, as `nodulesReceivedToday`).
 * - delivery:    a Courier carries each flour supply; the Courier's existing parcels for the day are
 *                split over the deliveries it made. Courier pay is unchanged.
 * - evidence:    an Investigator covering a sabotage campaign questions the target's occupant; the
 *                Investigator's existing leads for the day are split over its inquiries.
 * A BACKSTOPPED (mechanically covered) slot provides with `provider: null`: the goods move, but
 * nobody is there to meet.
 *
 * Randomness comes from `hashUnit` (seed, day, purpose, key), never `world.rng`, so v2 leaves
 * every other subsystem's random stream where it was.
 */

import { mulberry32 } from '../sim/rng.js';

export type DealingKind = 'purchase' | 'flourSupply' | 'grainSupply' | 'delivery' | 'evidence';
export type DealingOutcome = 'served' | 'turnedAway' | 'supplied' | 'delivered' | 'questioned';

export interface DealingEvent {
  tick: number;
  kind: DealingKind;
  /** Person (participant mode) or slot id providing the good or service; null for a mechanical slot. */
  provider: string | null;
  providerSite: string;
  recipient: string;
  recipientSite: string;
  /** Delivery only: the supplier the Courier collected from (null if mechanical). */
  sender?: string | null;
  quantity: number;
  outcome: DealingOutcome;
}

/** Deterministic uniform [0,1) from the given parts (FNV-1a seeded mulberry32). */
export function hashUnit(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('\u0000');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return mulberry32(h >>> 0)();
}

/** Chance per occasion that a party re-chooses (possibly the same) counterparty by share. */
export const REGULAR_SWITCH_CHANCE = 0.25;

export interface Option { key: string; weight: number }

/** Keeps `current` unless it is gone or a switch occurs (probability `switchChance`), then draws by
 *  weight. Stationary distribution = the weights' shares. */
export function chooseRegular(current: string | undefined, options: readonly Option[], uSwitch: number, uDraw: number, switchChance = REGULAR_SWITCH_CHANCE): string | null {
  const live = options.filter((o) => o.weight > 0);
  if (!live.length) return null;
  if (current !== undefined && live.some((o) => o.key === current) && uSwitch >= switchChance) return current;
  const total = live.reduce((a, o) => a + o.weight, 0);
  let u = uDraw * total;
  for (const o of live) { u -= o.weight; if (u < 0) return o.key; }
  return live[live.length - 1]!.key;
}

export interface Party { identity: string; site: string }

export interface PurchaseInput {
  seed: number; day: number; cycleDays: number; maxPerBaker: number; unitQuantity: number;
  /** Everyone who may buy bread today (located people), any order. */
  customers: readonly Party[];
  /** FILLED Bakers in `world.bakers` order, with their price. */
  bakers: readonly (Party & { price: number })[];
  regulars: ReadonlyMap<string, string>;
}

/** Individual bread demand. Returns served counts in `bakers` order, the events and new regulars. */
export function allocatePurchases(input: PurchaseInput): { served: number[]; events: DealingEvent[]; regulars: Map<string, string> } {
  const { seed, day, bakers } = input;
  const cycle = Math.max(1, Math.round(input.cycleDays));
  const regulars = new Map(input.regulars);
  const queue = new Map<string, Party[]>(bakers.map((b) => [b.identity, []]));
  const customers = [...input.customers].sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  for (const c of customers) {
    if (Math.floor(hashUnit(seed, 'purchase-day', c.identity) * cycle) !== day % cycle) continue;
    const options = bakers.filter((b) => b.identity !== c.identity).map((b) => ({ key: b.identity, weight: 1 / Math.max(b.price, 1e-6) }));
    const pick = chooseRegular(regulars.get(c.identity), options, hashUnit(seed, day, 'baker-switch', c.identity), hashUnit(seed, day, 'baker-draw', c.identity));
    if (pick === null) continue;
    regulars.set(c.identity, pick);
    queue.get(pick)!.push(c);
  }
  const events: DealingEvent[] = [];
  const served = bakers.map((b) => {
    const q = queue.get(b.identity)!;
    q.forEach((c, i) => events.push({ tick: day, kind: 'purchase', provider: b.identity, providerSite: b.site, recipient: c.identity, recipientSite: c.site,
      quantity: i < input.maxPerBaker ? input.unitQuantity : 0, outcome: i < input.maxPerBaker ? 'served' : 'turnedAway' }));
    return Math.min(q.length, input.maxPerBaker);
  });
  for (const k of [...regulars.keys()]) if (!input.customers.some((c) => c.identity === k)) regulars.delete(k);
  return { served, events, regulars: new Map([...regulars].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export interface Provider { identity: string | null; site: string; weight: number }

/**
 * Attributes each recipient's quantity to one provider chosen by `chooseRegular`. Option keys are
 * `site#identity`, so a regular is dropped when the slot changes hands. Returns events in
 * recipient order and the new regulars (keyed by recipient identity).
 */
export function attributeSupply(
  seed: number, day: number, kind: 'flourSupply' | 'grainSupply',
  recipients: readonly (Party & { quantity: number })[], providers: readonly Provider[], regularsIn: ReadonlyMap<string, string>,
): { events: DealingEvent[]; regulars: Map<string, string> } {
  const regulars = new Map(regularsIn);
  const keyOf = (p: Provider) => `${p.site}#${p.identity ?? 'mechanical'}`;
  const byKey = new Map(providers.map((p) => [keyOf(p), p]));
  const events: DealingEvent[] = [];
  for (const r of recipients) {
    if (!(r.quantity > 0)) continue;
    const pick = chooseRegular(regulars.get(r.identity), providers.map((p) => ({ key: keyOf(p), weight: p.weight })),
      hashUnit(seed, day, `${kind}-switch`, r.identity), hashUnit(seed, day, `${kind}-draw`, r.identity));
    if (pick === null) continue;
    regulars.set(r.identity, pick);
    const p = byKey.get(pick)!;
    events.push({ tick: day, kind, provider: p.identity, providerSite: p.site, recipient: r.identity, recipientSite: r.site, quantity: r.quantity, outcome: 'supplied' });
  }
  for (const k of [...regulars.keys()]) if (!recipients.some((r) => r.identity === k)) regulars.delete(k);
  return { events, regulars: new Map([...regulars].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/**
 * Assigns each flour supply to a Courier (a regular per receiving Baker, drawn by the Couriers'
 * friction weights) and splits each Courier's existing parcels for the day equally over the
 * deliveries it made. With no FILLED Courier, supplies move without a delivery event.
 */
export function attributeDeliveries(
  seed: number, day: number, supplies: readonly DealingEvent[],
  couriers: readonly (Party & { parcels: number; weight: number })[], regularsIn: ReadonlyMap<string, string>,
): { events: DealingEvent[]; regulars: Map<string, string> } {
  const regulars = new Map(regularsIn);
  const assigned: { courier: Party & { parcels: number }; supply: DealingEvent }[] = [];
  for (const s of supplies) {
    const pick = chooseRegular(regulars.get(s.recipient), couriers.map((c) => ({ key: c.identity, weight: c.weight })),
      hashUnit(seed, day, 'courier-switch', s.recipient), hashUnit(seed, day, 'courier-draw', s.recipient));
    if (pick === null) continue;
    regulars.set(s.recipient, pick);
    assigned.push({ courier: couriers.find((c) => c.identity === pick)!, supply: s });
  }
  const count = new Map<string, number>();
  for (const a of assigned) count.set(a.courier.identity, (count.get(a.courier.identity) ?? 0) + 1);
  const events = assigned.map(({ courier, supply }) => ({
    tick: day, kind: 'delivery' as const, provider: courier.identity, providerSite: courier.site, recipient: supply.recipient,
    recipientSite: supply.recipientSite, sender: supply.provider, quantity: courier.parcels / count.get(courier.identity)!, outcome: 'delivered' as const,
  }));
  for (const k of [...regulars.keys()]) if (!supplies.some((s) => s.recipient === k)) regulars.delete(k);
  return { events, regulars: new Map([...regulars].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/** Two-party interactions a dealing creates (both directions; a delivery also meets the sender). */
export function dealingPairs(e: DealingEvent): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const meet = (a: string | null | undefined, b: string | null | undefined) => {
    if (a && b && a !== b) pairs.push([a, b], [b, a]);
  };
  meet(e.provider, e.recipient);
  if (e.kind === 'delivery') meet(e.provider, e.sender);
  return pairs;
}
