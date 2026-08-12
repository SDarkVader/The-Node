/**
 * Wealth tracking and inequality metrics (2026-08-10, user-requested). Pure,
 * dependency-free, in the same style as every other `src/engine/` module.
 *
 * NODE's market layer (`millers.ts`/`bakers.ts`) has only ever tracked FLOW variables —
 * Cournot quantity, Bertrand price — converging via smoothed best-response dynamics. It
 * never tracked a STOCK variable (a player's accumulated personal wealth) before this
 * module. This is that missing primitive, plus the standard inequality metrics
 * (`giniCoefficient`, `topShare`) needed to actually check a real concern: does NODE's
 * economy concentrate wealth the way real-world and agent-based-model research says
 * unconstrained markets tend to?
 *
 * GROUNDING (see docs/BLUEPRINT.md's "Wealth inequality" entry for full citations): the
 * "yard-sale model" literature (Hayes; Boghosian et al., "Bounding the Approach to
 * Oligarchy in a Variant of the Yard-Sale Model," SIAM J. Appl. Math., 2024) shows that
 * *pairwise, proportional, zero-sum* wealth exchanges — a transaction sized relative to
 * the poorer party's own wealth — reliably condense toward oligarchy (one agent holding
 * everything) even when every rule is perfectly fair and every player starts equal. That
 * is a real, mathematically established result, not a guess. But it is NOT automatically
 * NODE's situation: before this module, there was no wealth transfer between players at
 * all — each role-holder earns independently from a shared market-clearing price, not
 * from a rival's pocket, so the specific condensation mechanism the yard-sale literature
 * describes doesn't mechanically apply just because wealth now accumulates. Whether
 * NODE's actual structure produces comparable concentration for OTHER reasons (asymmetric
 * role income, sabotage evicting specific earners, new arrivals starting at zero against
 * established veterans) is an empirical question — see the baseline-simulation findings
 * in `docs/BLUEPRINT.md`, not assumed here.
 *
 * The remediation literature (Guzmán-González et al., "Effects of taxes, redistribution
 * actions and fiscal evasion on wealth inequality," 2025; multiple nonlinear-taxation-
 * kernel studies) converges on progressive taxation + redistribution as the mechanism
 * that actually bounds concentration in these models — `taxAndRedistributeIncome()` and
 * `applyWealthCap()` below implement the two concrete forms the user asked for ("daily
 * resource allocation and limitations upon wealth"), as PROPOSALS to simulate and tune,
 * not shipped defaults — same pattern as this repo's existing pattern-based sabotage
 * proposal.
 */

/**
 * Baker demand model (2026-08-11, revised — the flat `BAKER_DAILY_VOLUME=1.0` constant
 * this replaced was a real gap, not just an illustrative placeholder: it assumed every
 * FILLED baker sold exactly 1 unit every single day regardless of population, rival count,
 * or price competitiveness, so total assumed demand scaled with *baker count*, not
 * population — adding more bakers manufactured more total income out of nowhere instead
 * of splitting a bounded customer pool. User-identified, user-specified the fix:
 * customers don't buy daily (they can store food and stay home — "hoard a little extra"),
 * a single baker has a realistic daily service ceiling ("can't serve 20-30 people daily"),
 * and demand should be population-bound, not baker-count-bound. All three constants below
 * are illustrative — chosen to be defensible and testable, not derived from the brief,
 * same as every other filled-in gap in this codebase.
 */

/**
 * Average days between one customer's purchases. [ILLUSTRATIVE] Tightened 2026-08-11
 * from the original "2-3 days" (2.5) to 7, per direct user instruction after sweeping the
 * effect first (`purchaseCycleDays` is a `WorldConfig` field precisely so this could be
 * swept without editing source). One important property, verified by the sweep, not
 * assumed: because `splitBakerDemand()`'s price-weighted shares are normalized regardless
 * of total demand, tightening this constant scales every baker's income down by the same
 * proportional factor — it narrows the *cross-role* Miller/Baker gap (Gini is scale-
 * invariant under a uniform multiplier) but does nothing whatsoever for inequality *among*
 * bakers themselves, which stayed at exactly the same Gini value across every cycle length
 * tested. See docs/BLUEPRINT.md's "Wealth inequality" entry for the full sweep and the
 * before/after ratio.
 */
export const PURCHASE_CYCLE_DAYS = 7;
/** A single baker's realistic daily service ceiling — kept comfortably under "20-30 people
 *  daily," not just short of it. [ILLUSTRATIVE] */
export const BAKER_MAX_DAILY_CUSTOMERS = 12;
/** Bread-demand units one served customer represents — kept at 1.0 so the resulting income
 *  scale is comparable to the model this replaced, not because it's independently derived. */
export const CUSTOMER_PURCHASE_UNIT = 1.0;

/** A Miller sells its whole competed-for quantity at the shared market-clearing flour price. */
export function millerDailyIncome(quantity: number, flourPrice: number): number {
  return Math.max(0, quantity * flourPrice);
}

/**
 * How many customers are actually due to buy bread *today*, out of the whole population —
 * population divided by the purchase cycle, not the whole population every day. Bakers
 * split this bounded pool; they do not each independently generate their own demand.
 */
export function dailyDueCustomers(population: number, purchaseCycleDays: number = PURCHASE_CYCLE_DAYS): number {
  if (purchaseCycleDays <= 0) return 0;
  return Math.max(0, population / purchaseCycleDays);
}

/**
 * Splits today's due-customer pool across FILLED bakers, weighted toward whoever's priced
 * lower — real Bertrand behavior (the cheaper competitor captures disproportionate share),
 * which `bakers.ts`'s own price dynamics never actually fed into anything before this.
 * Each baker's raw share is then capped at `maxDailyCustomers` — a single shop has a
 * realistic ceiling regardless of how much demand its price would otherwise pull in;
 * capped demand is NOT redistributed to other bakers (a customer turned away by a
 * maxed-out shop doesn't necessarily walk to the next one same-day — a simplification,
 * flagged rather than silently assumed away). Returns one served-customer count per input
 * price, same order, only for `prices` — callers pass just the FILLED bakers' prices.
 */
export function splitBakerDemand(
  prices: readonly number[],
  totalDueCustomers: number,
  maxDailyCustomers: number = BAKER_MAX_DAILY_CUSTOMERS,
): number[] {
  if (prices.length === 0 || totalDueCustomers <= 0) return prices.map(() => 0);
  const EPSILON = 1e-6; // floors price so a near-zero/zero price can't produce an infinite weight
  const weights = prices.map((p) => 1 / Math.max(p, EPSILON));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.min(maxDailyCustomers, totalDueCustomers * (w / totalWeight)));
}

/** A Baker's daily profit: margin over flour cost times however many customers it actually served today. */
export function bakerDailyIncome(price: number, flourPrice: number, servedCustomers: number, unit: number = CUSTOMER_PURCHASE_UNIT): number {
  return Math.max(0, price - flourPrice) * servedCustomers * unit;
}

/**
 * Daily downtime windows (2026-08-11, user-specified, then extended 2026-08-12 by the design
 * addendum's item 8, "economic throttle windows" — the two purposes turned out to be the same
 * mechanism, not two mechanisms to build). Originally one fixed 8-hour stretch every day, same
 * wall-clock hours, single shared timezone (not per-player-adjusted) — "account for RL," gives
 * real players an actual break. During it, trading activity dampens to 10% of normal rather
 * than stopping outright, "all round" (both roles) — the shard stays alive (constraint 2: no
 * permanent zero-state, at any scale, including a single day) rather than freezing dead for a
 * third of every day.
 *
 * ITEM 8, VERIFIED AGAINST THIS EXISTING MECHANIC RATHER THAN BUILT AS A SEPARATE ONE. Its own
 * text: "two windows per day... output drops to ~10%... economy only... implementation should
 * be a scheduled multiplier feeding existing market equations, not a new subsystem." Checked
 * point by point rather than assumed: ~10% during the window — already `DOWNTIME_DAMPENING`,
 * unchanged; economy-only — confirmed by grep, `DAILY_ACTIVITY_MULTIPLIER` is referenced
 * nowhere in `src/comms/` and nowhere in the comms stage of `world.ts`'s `stepWorld`, only in
 * the market/wage/resource-flow lines; public, predictable, deterministic — a compile-time
 * constant, never randomised; "removes the payoff, not the option" — dampens, never zeroes,
 * same as every other constraint-2 mechanism in this codebase; "a scheduled multiplier feeding
 * existing market equations, not a new subsystem" — is a verbatim description of what already
 * ships. The one literal mismatch was window COUNT (one vs two) — resolved below by splitting
 * the SAME total dampened hours into `THROTTLE_WINDOWS_PER_DAY` explicit windows, which is
 * mathematically inert at this kernel's granularity: `DAILY_ACTIVITY_MULTIPLIER` is one
 * blended scalar per day, so two 4-hour windows and one 8-hour window with identical total
 * dampened hours and the same dampening rate produce the exact same number — this kernel has
 * no finer time-of-day resolution to make "two windows" observably different from "one," the
 * same limitation `IMPLEMENTATION SCOPE` below already names for wall-clock scheduling. Making
 * the window count real code structure (rather than leaving it implicit in one constant) is
 * the honest, buildable resolution: zero behavioural change, zero risk to every wealth/Gini/
 * flourRatio number this whole session's history calibrated against the old single constant,
 * and item 8's explicit ask ("two windows," "a scheduled multiplier," "not a new subsystem")
 * is met by structure, not by prose alone — the same standard items 5/6/7 held themselves to.
 *
 * IMPLEMENTATION SCOPE, flagged not silently narrowed: this kernel's tick is one full day
 * (every existing calibration — churn probabilities, experience growth, sabotage cadence,
 * migration step size — is calibrated in days; subdividing ticks to hourly would invalidate
 * essentially all of it, a much larger and riskier change than what was asked for here).
 * At daily granularity there's no way to represent "quiet for part of the day" except as
 * the correct blended daily average of a fixed intra-day schedule — which is exactly what
 * these constants are, not an approximation of a bigger unbuilt mechanic. What this does NOT
 * do: literally block real player actions from arriving during specific UTC hours, or place
 * the two windows at any particular time of day — that's a real-time server-clock policy
 * (`src/server/ws.ts`, once real player actions exist to gate at all), a separate and later
 * concern from this deterministic kernel's own economics, and genuinely unbuildable here
 * until that server exists to have a wall clock at all.
 */
export const THROTTLE_WINDOWS_PER_DAY = 2;
export const THROTTLE_WINDOW_HOURS = 4;
export const DOWNTIME_HOURS = THROTTLE_WINDOWS_PER_DAY * THROTTLE_WINDOW_HOURS;
export const ACTIVE_HOURS = 24 - DOWNTIME_HOURS;
export const DOWNTIME_DAMPENING = 0.1;
/** The correct same-day blend of ACTIVE_HOURS at full rate and DOWNTIME_HOURS at DOWNTIME_DAMPENING. */
export const DAILY_ACTIVITY_MULTIPLIER = (ACTIVE_HOURS / 24) * 1 + (DOWNTIME_HOURS / 24) * DOWNTIME_DAMPENING;

/**
 * Standard Gini coefficient over a wealth distribution: 0 = perfect equality, approaching
 * 1 = total concentration in one holder. Returns 0 for an empty or all-zero distribution
 * (equality is the honest description of "nobody has anything yet," not undefined).
 */
export function giniCoefficient(wealths: readonly number[]): number {
  if (wealths.length === 0) return 0;
  const sorted = [...wealths].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let weightedSum = 0;
  for (let i = 0; i < n; i++) weightedSum += (i + 1) * sorted[i]!;
  return (2 * weightedSum) / (n * total) - (n + 1) / n;
}

/** Share of total wealth held by the richest `fraction` of the population (e.g. 0.1 = "top 10%"). */
export function topShare(wealths: readonly number[], fraction: number): number {
  if (wealths.length === 0) return 0;
  const sorted = [...wealths].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const topCount = Math.max(1, Math.round(sorted.length * fraction));
  const topSum = sorted.slice(0, topCount).reduce((a, b) => a + b, 0);
  return topSum / total;
}

/**
 * Support-role and grifter income (2026-08-11, user-specified 5-role roster + community-
 * player population). Courier, Journalist, and Detective have no competitive market
 * mechanic anywhere in this codebase — no lore or brief section specifies one — so unlike
 * Miller (Cournot) and Baker (Bertrand), their income can't be *derived* from a market
 * clearing process; it's a flat daily wage, explicitly flagged as an undifferentiated
 * placeholder standing in for three genuinely different unbuilt economies, same as every
 * other filled-in gap in this codebase.
 *
 * Calibrated off the current baseline (`docs/BLUEPRINT.md`'s purchase-cycle-tightening
 * sweep, `cycleDays=7`, the active default): meanMillerWealth ≈ 1.16/day, meanBakerWealth
 * ≈ 2.20/day. `SUPPORT_ROLE_DAILY_WAGE` is set between the two roles' current earnings, not
 * above or below both — a support role should be a genuine economic option, not strictly
 * dominant or dominated by either existing role. [ILLUSTRATIVE]
 *
 * `GRIFTER_DAILY_INCOME` is the "minimum income floor" the user specified for roleless
 * community players — deliberately below every role's wage (grifters haven't earned a
 * role slot yet) but strictly positive, because the user was explicit that grifters "still
 * must contribute to the economy," i.e. this is a floor a present, participating player
 * receives, not a zero-income holding state (constraint 2: no permanent zero-state).
 * [ILLUSTRATIVE]
 */
export const SUPPORT_ROLE_DAILY_WAGE = 1.5;
export const GRIFTER_DAILY_INCOME = 0.5;

/**
 * PROPOSAL, not shipped as default. Flat proportional tax on each player's daily INCOME
 * (the flow, not their accumulated stock), pooled and redistributed equally across every
 * tracked player the same day — an untargeted, unconditional daily allocation, matching
 * what the user asked for ("daily resource allocation"). `taxRate` in [0,1]; 0 is a no-op.
 */
export function taxAndRedistributeIncome(incomes: readonly number[], taxRate: number): number[] {
  if (incomes.length === 0) return [];
  if (taxRate <= 0) return [...incomes];
  const pool = incomes.reduce((sum, income) => sum + income * taxRate, 0);
  const share = pool / incomes.length;
  return incomes.map((income) => income * (1 - taxRate) + share);
}

/**
 * PROPOSAL, not shipped as default. Hard ceiling on accumulated wealth — anything above
 * `cap` is redirected into a pool split equally among every player currently under the
 * cap, instead of accruing to the earner ("limitations upon wealth"). `cap` undefined or
 * <= 0 is a no-op. Single-pass redistribution, not iterated to convergence: a share can
 * itself push a near-cap player slightly over, and that residual is simply re-capped
 * rather than redistributed again — a deliberate simplification (near-cap overflow is
 * small in practice at any reasonable cap), flagged rather than silently assumed exact.
 */
export function applyWealthCap(wealths: readonly number[], cap: number | undefined): number[] {
  if (cap === undefined || cap <= 0) return [...wealths];
  let pool = 0;
  const capped = wealths.map((w) => {
    if (w > cap) {
      pool += w - cap;
      return cap;
    }
    return w;
  });
  if (pool <= 0) return capped;
  const underCapIndices = capped.map((w, i) => (w < cap ? i : -1)).filter((i) => i >= 0);
  if (underCapIndices.length === 0) return capped; // everyone is exactly at the cap — pool has nowhere to go, discarded
  const share = pool / underCapIndices.length;
  return capped.map((w, i) => (underCapIndices.includes(i) ? Math.min(cap, w + share) : w));
}
