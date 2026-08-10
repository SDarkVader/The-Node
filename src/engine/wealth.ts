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

/** [ILLUSTRATIVE] — no per-baker demand/volume model exists anywhere in this repo yet;
 *  flagged the same way every other filled-in gap in this codebase is. */
export const BAKER_DAILY_VOLUME = 1.0;

/** A Miller sells its whole competed-for quantity at the shared market-clearing flour price. */
export function millerDailyIncome(quantity: number, flourPrice: number): number {
  return Math.max(0, quantity * flourPrice);
}

/** A Baker's daily profit: margin over flour cost times an illustrative fixed daily volume. */
export function bakerDailyIncome(price: number, flourPrice: number, volume: number = BAKER_DAILY_VOLUME): number {
  return Math.max(0, price - flourPrice) * volume;
}

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
