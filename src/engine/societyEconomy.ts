/**
 * Explicit inhabitant economy. Only the opt-in society driver supplies this plan; old
 * simulations retain their exact market/RNG path. Prices and quantities commit before
 * the day's customer decisions. This module has no I/O, model access, or host capability.
 *
 * Wealth remains the established scoreboard: customer payments fund the district pool,
 * which settles the existing Baker margin and Miller unit-income claims, then completion
 * and support wages. A receipt's payment is consequently not a second seller credit.
 */
import { hashUnit, type DealingEvent } from './dealings.js';
import { FLOUR_PER_BREAD } from './resources.js';
import { BAKER_MAX_DAILY_CUSTOMERS, DAILY_ACTIVITY_MULTIPLIER, PURCHASE_CYCLE_DAYS } from './wealth.js';

export interface SocietyEconomyPlan {
  /** FILLED workplace IDs; the submitted quote locks for the whole day. */
  bakerPrices: ReadonlyMap<string, number>;
  millerQuantities: ReadonlyMap<string, number>;
  /** Stable inhabitant ID -> Baker workplace ID; null means voluntarily defer. */
  breadChoices: ReadonlyMap<string, string | null>;
  /** Workplaces that actually perform their duty today. Empty means no work. */
  working?: ReadonlySet<string>;
  /** Opt-in routine: competitive role production requires a recorded work choice. */
  attendanceRequired?: boolean;
  /** Backstop-assisted workplaces selected by the opt-in reputation overlay. */
  assisted?: ReadonlySet<string>;
  /** Customers explicitly choosing an anonymous mechanical bakery offer. */
  mechanicalChoices?: ReadonlySet<string>;
}

export interface SocietyPurchaseReceipt {
  customer: string;
  customerSite: string;
  bakerSite: string | null;
  quantity: number;
  paid: number;
  outcome: 'served' | 'deferred' | 'notDue' | 'unaffordable' | 'unavailable' | 'noFlour' | 'capacity';
}

export interface SocietyEconomyDay {
  day: number;
  prices: Record<string, number>;
  /** Quotes of anonymous mechanical bakeries, separate from an occupant's quote. */
  mechanicalPrices?: Record<string, number>;
  /** Actual flour allocation to anonymous bakeries; never a synthetic person. */
  mechanicalFlourSupplies?: SocietyMechanicalFlourSupply[];
  quantities: Record<string, number>;
  receipts: SocietyPurchaseReceipt[];
  flourSold: Record<string, number>;
  breadSold: Record<string, number>;
  grainAvailable: number;
  grainConsumed: number;
  flourProduced: number;
  flourConsumed: number;
  customerPayments: number;
}

/** Same stable weekly purchase occasion as recognition-v2, including stable person identity. */
export function societyPurchaseDue(seed: number, day: number, person: string, cycleDays = PURCHASE_CYCLE_DAYS): boolean {
  const cycle = Math.max(1, Math.round(cycleDays));
  return Math.floor(hashUnit(seed, 'purchase-day', person) * cycle) === day % cycle;
}

/** Reject malformed plans before the world's RNG, diaries, registry, or wealth can change. */
export function validateSocietyEconomyPlan(plan: SocietyEconomyPlan): void {
  if (!(plan.bakerPrices instanceof Map) || !(plan.millerQuantities instanceof Map) || !(plan.breadChoices instanceof Map) ||
    (plan.working !== undefined && !(plan.working instanceof Set)) ||
    (plan.attendanceRequired !== undefined && typeof plan.attendanceRequired !== 'boolean') ||
    (plan.assisted !== undefined && !(plan.assisted instanceof Set)) ||
    (plan.mechanicalChoices !== undefined && !(plan.mechanicalChoices instanceof Set))) throw Error('invalid_society_economy_plan');
  for (const [site, price] of plan.bakerPrices) {
    if (typeof site !== 'string' || !Number.isFinite(price) || price < 0 || price > 2) throw Error('invalid_society_price');
  }
  for (const [site, quantity] of plan.millerQuantities) {
    if (typeof site !== 'string' || !Number.isFinite(quantity) || quantity < 0.01 || quantity > 1) throw Error('invalid_society_quantity');
  }
  for (const [person, choice] of plan.breadChoices) {
    if (typeof person !== 'string' || (choice !== null && typeof choice !== 'string')) throw Error('invalid_society_purchase');
  }
  for (const site of plan.working ?? []) if (typeof site !== 'string') throw Error('invalid_society_work');
  for (const site of plan.assisted ?? []) if (typeof site !== 'string') throw Error('invalid_society_assisted');
  for (const person of plan.mechanicalChoices ?? []) if (typeof person !== 'string' || !plan.breadChoices.get(person)) throw Error('invalid_society_mechanical_choice');
}

interface Customer { identity: string; site: string; wealth: number }
interface Bakery { identity: string | null; site: string; price: number; available?: boolean; capacityMultiplier?: number }
interface FlourProvider { identity: string | null; site: string; quantity: number }
export interface SocietyMechanicalFlourSupply { provider:string|null; providerSite:string; recipientSite:string; quantity:number }

/** Exact capacity-bounded physical attribution, including mechanical providers with no person.
 * The aggregate gate has already limited recipients. No one supplier can be attributed more
 * grain/flour than it actually delivered merely because a regular-counterparty draw picked it.
 */
export function allocateSocietySupply(
  tick: number, kind: 'grainSupply' | 'flourSupply',
  recipients: readonly { identity: string; site: string; quantity: number }[], providers: readonly FlourProvider[],
): DealingEvent[] {
  const remaining = providers.map((p) => {
    if (!Number.isFinite(p.quantity) || p.quantity < 0) throw Error('invalid_society_supply');
    return { ...p, quantity: p.quantity };
  });
  const events: DealingEvent[] = [];
  for (const recipient of recipients) {
    if (!Number.isFinite(recipient.quantity) || recipient.quantity < 0) throw Error('invalid_society_supply');
    if (recipient.quantity === 0) continue;
    const available = remaining.reduce((sum, p) => sum + p.quantity, 0);
    if (!(available > 0) || recipient.quantity > available + 1e-10) throw Error('society_supply_exhausted');
    let last = -1;
    for (let i = 0; i < remaining.length; i++) if (remaining[i]!.quantity > 0) last = i;
    let need = recipient.quantity;
    for (let i = 0; i < remaining.length; i++) {
      const provider = remaining[i]!;
      const amount = Math.min(provider.quantity, i === last ? need : recipient.quantity * provider.quantity / available);
      if (!(amount > 0)) continue;
      provider.quantity -= amount; need -= amount;
      events.push({ tick, kind, provider: provider.identity, providerSite: provider.site,
        recipient: recipient.identity, recipientSite: recipient.site, quantity: amount, outcome: 'supplied' });
    }
    if (need > 1e-10) throw Error('society_supply_exhausted');
  }
  return events;
}

export interface SocietyMarketInput {
  seed: number;
  day: number;
  /** Kernel evidence remains zero-based even when the public day is one-based. */
  eventTick?: number;
  cycleDays?: number;
  customers: readonly Customer[];
  bakers: readonly Bakery[];
  /** Grain-limited, activity-adjusted real flour, including mechanical backstops. */
  flour: readonly FlourProvider[];
  choices: ReadonlyMap<string, string | null>;
  mechanicalChoices?: ReadonlySet<string>;
}

export interface SocietyMarketResult {
  served: number[];
  receipts: SocietyPurchaseReceipt[];
  customerDebits: Map<string, number>;
  millerSold: Map<string, number>;
  flourEvents: DealingEvent[];
  mechanicalFlourSupplies: SocietyMechanicalFlourSupply[];
  purchaseEvents: DealingEvent[];
  flourConsumed: number;
  totalPayments: number;
}

/**
 * Actual explicit choices clear against finite flour and wealth. Customers are ordered by
 * a public-seed deterministic daily fair permutation, never map insertion or model order.
 * There is no fallback purchase from another shop when a chosen offer cannot be filled.
 */
export function clearSocietyMarket(input: SocietyMarketInput): SocietyMarketResult {
  const served = input.bakers.map(() => 0);
  const customerDebits = new Map<string, number>();
  const millerSold = new Map<string, number>();
  const purchaseEvents: DealingEvent[] = [];
  const flourEvents: DealingEvent[] = [];
  const mechanicalFlourSupplies:SocietyMechanicalFlourSupply[]=[];
  const receipts: SocietyPurchaseReceipt[] = [];
  const supply = input.flour.map((p) => ({ ...p, remaining: Math.max(0, p.quantity) }));
  let flourRemaining = supply.reduce((sum, p) => sum + p.remaining, 0);
  let flourConsumed = 0;
  let totalPayments = 0;
  const customers = [...input.customers].sort((a, b) =>
    hashUnit(input.seed, input.day, 'society-customer-order', a.identity) - hashUnit(input.seed, input.day, 'society-customer-order', b.identity) ||
    a.identity.localeCompare(b.identity, 'en'));
  for (const customer of customers) {
    const choice = input.choices.get(customer.identity) ?? null;
    const receipt: SocietyPurchaseReceipt = { customer: customer.identity, customerSite: customer.site,
      bakerSite: choice, quantity: 0, paid: 0, outcome: 'deferred' };
    receipts.push(receipt);
    if (!societyPurchaseDue(input.seed, input.day, customer.identity, input.cycleDays)) { receipt.outcome = 'notDue'; continue; }
    if (choice === null) continue;
    const mechanical=input.mechanicalChoices?.has(customer.identity)===true;
    const bakerIndex = input.bakers.findIndex((b) => b.site === choice && (b.identity===null)===mechanical && b.identity !== customer.identity && b.available !== false);
    const baker = input.bakers[bakerIndex];
    if (!baker) { receipt.outcome = 'unavailable'; continue; }
    const quantity = DAILY_ACTIVITY_MULTIPLIER;
    const payment = baker.price * quantity;
    const flourNeed = quantity * FLOUR_PER_BREAD;
    if (customer.wealth < payment) { receipt.outcome = 'unaffordable'; }
    else if (served[bakerIndex]! >= Math.floor(BAKER_MAX_DAILY_CUSTOMERS * (baker.capacityMultiplier ?? 1))) { receipt.outcome = 'capacity'; }
    else if (flourRemaining + 1e-12 < flourNeed) { receipt.outcome = 'noFlour'; }
    else {
      receipt.outcome = 'served'; receipt.quantity = quantity; receipt.paid = payment;
      served[bakerIndex] = served[bakerIndex]! + 1;
      customerDebits.set(customer.identity, payment);
      totalPayments += payment;
      flourConsumed += flourNeed;
      const availableBefore = flourRemaining;
      let outstanding = flourNeed;
      // Proportional real supplier allocation; unlike an attributed regular, no provider
      // can sell more flour than it actually produced. Backstops have no payee identity.
      for (let i = 0; i < supply.length; i++) {
        const provider = supply[i]!;
        const amount = Math.min(provider.remaining, i === supply.length - 1 ? outstanding : flourNeed * provider.remaining / availableBefore);
        if (amount <= 0) continue;
        provider.remaining -= amount; outstanding -= amount;
        millerSold.set(provider.site, (millerSold.get(provider.site) ?? 0) + amount);
        // A mechanical bakery is not a person. Record the actual supplier
        // separately so legitimate human flour supply retains its credit.
        if(baker.identity===null)mechanicalFlourSupplies.push({provider:provider.identity,providerSite:provider.site,recipientSite:baker.site,quantity:amount});
        else flourEvents.push({ tick: input.eventTick ?? input.day, kind: 'flourSupply', provider: provider.identity, providerSite: provider.site,
          recipient: baker.identity, recipientSite: baker.site, quantity: amount, outcome: 'supplied' });
      }
      flourRemaining = Math.max(0, flourRemaining - flourNeed);
    }
    purchaseEvents.push({ tick: input.eventTick ?? input.day, kind: 'purchase', provider: baker.identity, providerSite: baker.site,
      recipient: customer.identity, recipientSite: customer.site, quantity: receipt.quantity, outcome: receipt.outcome === 'served' ? 'served' : 'turnedAway' });
  }
  return { served, receipts, customerDebits, millerSold, flourEvents, mechanicalFlourSupplies, purchaseEvents, flourConsumed, totalPayments };
}
