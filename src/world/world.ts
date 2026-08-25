/**
 * Unified deterministic world kernel (Observatory build spec, Phase B). Composes the
 * three previously-separate models — Phase 1 market (`millers.ts`/`bakers.ts`), Phase 2
 * vacancy/conscription (`vacancy.ts`, `sim/multiRoleConscription.ts`), and the ecosystem
 * layer (`ecosystem.ts`) — into one `World` object and one `stepWorld()` tick, now sited
 * on real geography via Phase A's `space.ts`. Existing engine modules are called, not
 * reimplemented.
 *
 * TICK ORDER (pinned by `test/world.regression.test.ts`'s determinism/order test — do not
 * reorder without updating both): space/occupancy -> vacancy and conscription -> market
 * (Miller then Baker, then support-role and grifter income) -> ecosystem (sabotage,
 * arrivals, migration, health, experience) -> comms (rumour propagation). Matches the
 * Observatory spec's given order exactly. Within the ecosystem stage, sabotage is applied
 * BEFORE arrivals, per `design/tick_order_check.py`'s own validated finding ("shock BEFORE
 * arrival" — the prior art the spec explicitly said to check before choosing an order) —
 * checked, not reinvented.
 *
 * DETERMINISM: `World.rng` is a single `mulberry32` closure created once in `createWorld`
 * and threaded through every `stepWorld` call via the returned `World`'s own field —
 * identical to how every existing harness in this repo (`vacancyHarness.ts`,
 * `ecosystemHarness.ts`) already threads one `rng` through a whole run. This means `World`
 * is not literally a plain JSON value (it carries a function) — `stepWorld` is still
 * deterministic given the same starting `World` (no `Math.random()`, no external mutable
 * state), but it is NOT the same thing as `structuredClone(world)` producing an
 * independently-steppable fork; two `World`s only diverge by calling `createWorld` with a
 * new seed. Phase D's snapshot contract will need its own explicit projection from `World`
 * to a serializable schema — deliberately not attempted here.
 *
 * ROLE ROSTER (2026-08-11, user-specified, replacing the earlier 2-role-only scope; Journalist
 * and Detective MERGED into Investigator 2026-08-22, see below).
 * Miller and Baker keep their existing competitive (Cournot/Bertrand) market mechanics,
 * unchanged. Investigator gets a flat `SUPPORT_ROLE_DAILY_WAGE` (`wealth.ts`) like the other
 * two undifferentiated-economy support roles, PLUS the one real mechanic that survived the
 * merge: a FILLED Investigator sets `investigatedBy` for sabotage campaigns in its own
 * district, a genuine detection-bonus lever the former Journalist never had. Courier is the
 * other support role the addendum differentiates (item 6, 2026-08-11): pay is distance-indexed,
 * not the flat wage — see `engine/courierPay.ts`.
 *
 * INVESTIGATOR MERGE (2026-08-22, user directive): Journalist and Detective had converged to
 * functionally identical roles for wage/completion purposes — both reduced to
 * `districtFriction >= bar`, same as Courier and Import/Export, with Journalist carrying no
 * differentiator of its own. Merged into one `investigators: SupportRoleSlot[]` array,
 * inheriting Detective's real mechanic (see above) rather than losing it. `rInvestigator`
 * defaults to the sum of the old `rJournalist`+`rDetective` — sum-preserving, not re-derived;
 * see `DEFAULT_WORLD_CONFIG`'s own comment. The 6-role roster this file's history describes
 * below (the joint grid search, `M9 B9 C7 J7 D8 IE6`) is now a 5-role roster; S stays 46.
 *
 * "Grifters" (2026-08-11, user's own term) are roleless community players — individually
 * tracked (`GrifterSlot`, unlike the prior "gossip layer," which was only ever an aggregate
 * count), earning `GRIFTER_DAILY_INCOME` (below every role's wage — constraint 2's "no
 * permanent zero-state" still applies, so it is a real positive floor, not zero) until
 * drafted or self-selected into any open role. Role-vacancy handling for all 5 roles now
 * runs through `sim/multiRoleConscription.ts`'s `stepMultiRoleConscriptionDay` — a NEW,
 * separate N-role generalization of the original 2-role `conscriptionHarness.ts`, which is
 * left untouched and still covers its own tests. A departing role-holder (churn, or a
 * sabotage eviction) falls back into the grifter pool rather than leaving the population —
 * they are still present, just roleless, until re-drafted; only true emigration
 * (`migrationValveStep`) removes someone from `population` entirely.
 *
 * WEALTH-INEQUALITY SCOPE (widened 2026-08-11): `wealthGini`/`wealthTop10Share` previously
 * covered Miller+Baker only, because the gossip layer had no individually-tracked wealth to
 * include. Grifters now do — this task's whole point — so these two fields now span every
 * identity-bearing player in the shard (all 5 roles' FILLED slots + every grifter), which is
 * what the original "90%/10%" concern in docs/BLUEPRINT.md was actually asking about.
 * `wealthTaxRate`/`wealthCap` remediation stays scoped to Miller+Baker only, deliberately
 * NOT widened in this pass — flagged as an open scoping question, not silently decided;
 * both remain off by default (`wealthTaxRate: 0`, `wealthCap: undefined`) regardless.
 *
 * Comms only propagates `pendingWallPosts` from role-holders with a fixed building position
 * (Miller/Baker/Courier/Investigator); grifters have no fixed BUILDING position in
 * this model (same simplification `space.ts`'s own `placeArrival()` already left unused) and
 * are not part of the proximity graph. Grifters DO have a coarse housing DISTRICT now
 * (2026-08-13, `GrifterSlot.districtId` — see below) — that's a housing-capacity concern, not
 * a precise coordinate, so it doesn't put them back into the proximity graph.
 */

import { mulberry32, gaussian } from '../sim/rng.js';
import {
  generateShardLayout,
  occupantsWithin,
  proximityCloseness,
  chooseHousingDistrict,
  type Shard,
  type Building,
  type PlayerPosition,
  type ShardLayoutConfig,
  type PlayerId,
  type DistrictId,
  DEFAULT_SHARD_CONFIG,
} from '../engine/space.js';
import { dailyChurnFromMonthly, type RoleSlot, type VacancyParams } from '../engine/vacancy.js';
import { DEFAULTS as VACANCY_DEFAULTS } from '../sim/vacancyHarness.js';
import { reputationLevelForProgress, minLevelForRole } from '../engine/reputation.js';
import { stepMultiRoleConscriptionDay, ESTABLISHED_TENURE_DAYS, type RoleGroupState } from '../sim/multiRoleConscription.js';
import {
  stepDistrictHealth,
  initialDistrictHealth,
  districtFilledFraction,
  consolidationFrictionMultiplier,
  CONSOLIDATION_GRACE_DAYS,
  type DistrictHealth,
} from '../engine/districtConsolidation.js';
import { localDistrictTension, districtTensionField, stepDistrictWeather } from '../engine/districtWeather.js';
import { emptyIdentityLedger, recordEncounter, resolvedSubjects, type IdentityLedger } from '../engine/identity.js';
import {
  emptyPressureRecord,
  recordPost,
  pressureContribution,
  knownFraction,
  type PressureRecord,
} from '../engine/pressureDetection.js';
import {
  emptyCompletionStats,
  recordAttempt,
  completionRatio,
  averageRivalValue,
  millerTaskCompleted,
  bakerTaskCompleted,
  supportTaskCompleted,
  COMPLETION_REWARD,
  TYPICAL_COMPLETION_RATIO,
  type CompletionStats,
} from '../engine/roleCompletion.js';
import { stepMillers, flourPrice as computeFlourPrice } from '../engine/millers.js';
import { stepBakers } from '../engine/bakers.js';
import {
  economicHealth,
  economicHealthWithExperience,
  growExperience,
  opportunityAdjustedMigrationStep,
  detectionProbability,
  sabotageAttempt,
  applySabotageDamage,
  BACKSTOP_PRODUCTIVITY,
  EXPERIENCE_CAP,
} from '../engine/ecosystem.js';
import { emptyLedger, accumulate, stepResourceFlows, GRAIN_PER_FLOUR, type ResourceLedger } from '../engine/resources.js';
import { grainDeliveredToday, nodulesReceivedToday, millingCapacityFactor } from '../engine/importExport.js';
import { importExportWindowEvents, type ImportExportWindowEvent } from '../engine/dayCycle.js';
import { stepPresenceLedger, type PresenceRecord } from '../engine/presence.js';
import { courierDailyPay, courierRouteDistance } from '../engine/courierPay.js';
import { shiftCoverPay, shiftCoverNoticedIndices, orderGrifterCandidatesForNotice } from '../engine/shiftCover.js';
import { stepClarity, applyDistortion } from '../comms/decay.js';
import { ConnectionGraph } from '../comms/connections.js';
import type { WallPost, SelfState } from '../comms/grammar.js';
import { createDiaryStore, writeDiaryEntry, type DiaryEntry, type Observation, type Reading, type ContextTag } from '../engine/diary.js';
import {
  composeUtterance,
  degradeForListener,
  type Intent as ProximityIntent,
  type Tone as ProximityTone,
  type Referent as ProximityReferent,
  type ContextTag as ProximityContextTag,
  type HeardUtterance,
} from '../comms/proximityConversation.js';
import type { PrivateStore } from '../engine/privateStore.js';
import { emptyPersonalStock, stepPersonalStock, PERSONAL_RESOURCE_CAP } from '../engine/personalResourceStock.js';
import { openCampaign, stepCampaign, type SabotageCampaign } from '../engine/sabotageCampaign.js';
import {
  oracleWinProbability,
  pickPrizeType,
  ORACLE_ENTRY_COST,
  ORACLE_PARTICIPATION_PROBABILITY,
  ORACLE_WEALTH_PRIZE_AMOUNT,
  ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT,
  ORACLE_TIME_NUDGE_DAYS,
  type OraclePrizeType,
} from '../engine/oracle.js';
import { experienceFloorFromShiftsCovered } from '../engine/experienceFloor.js';

/** Adapts `stepPersonalStock`'s `{stock, daysSinceRestock}` shape to a slot's own
 *  `personalResourceStock`/`daysSinceRestock` field names. */
function stepSlotStock<T extends { personalResourceStock: number; daysSinceRestock: number }>(
  s: T,
): Pick<T, 'personalResourceStock' | 'daysSinceRestock'> {
  const next = stepPersonalStock({ stock: s.personalResourceStock, daysSinceRestock: s.daysSinceRestock });
  return { personalResourceStock: next.stock, daysSinceRestock: next.daysSinceRestock } as Pick<
    T,
    'personalResourceStock' | 'daysSinceRestock'
  >;
}

/** Same field-name adapter as `stepSlotStock`, for a slot's initial/reset state. */
function emptySlotStock(): { personalResourceStock: number; daysSinceRestock: number } {
  const empty = emptyPersonalStock();
  return { personalResourceStock: empty.stock, daysSinceRestock: empty.daysSinceRestock };
}
import {
  millerDailyIncome,
  bakerDailyIncome,
  dailyDueCustomers,
  splitBakerDemand,
  giniCoefficient,
  topShare,
  taxAndRedistributeIncome,
  applyWealthCap,
  DAILY_ACTIVITY_MULTIPLIER,
  SUPPORT_ROLE_DAILY_WAGE,
  GRIFTER_DAILY_INCOME,
} from '../engine/wealth.js';

export type RoleType = 'miller' | 'baker' | 'courier' | 'investigator' | 'importExport';
export const ROLE_TYPES: readonly RoleType[] = ['miller', 'baker', 'courier', 'investigator', 'importExport'];

export interface WorldConfig {
  shardConfig: ShardLayoutConfig;
  rMiller: number;
  rBaker: number;
  /** Support role, no competitive market mechanic. Pay is distance-indexed (see
   *  engine/courierPay.ts), not the flat SUPPORT_ROLE_DAILY_WAGE the other two support roles
   *  use — 2026-08-11 addendum item 6. [ILLUSTRATIVE] */
  rCourier: number;
  /** Support role — flat SUPPORT_ROLE_DAILY_WAGE, PLUS the one differentiated support-role
   *  mechanic that exists: a FILLED Investigator in a district sets `investigatedBy` for any
   *  sabotage campaign targeting that district, feeding a real linear detection bonus
   *  (`engine/ecosystem.ts`'s `PATTERN_DETECTIVE_BONUS_DEFAULT` — the constant name itself was
   *  deliberately NOT renamed; it lives in the role-agnostic math layer, which never knew role
   *  names to begin with). Merged from the former separate Journalist and Detective roles
   *  (2026-08-22, user directive — the two had grown functionally identical for
   *  wage/completion purposes; Journalist carried no differentiated mechanic of its own, so
   *  nothing was lost merging them, only Detective's real lever survives under the new name).
   *  [ILLUSTRATIVE — the merged slot COUNT below is a sum-preserving placeholder, not
   *  re-derived; see the DEFAULT_WORLD_CONFIG comment.] */
  rInvestigator: number;
  /** Import/Export — receives nodules daily, converts to grain for Millers, and controls
   *  cross-shard movement. See engine/importExport.ts. */
  rImportExport: number;
  targetPopulation: number;
  pMonthly: number;
  conscriptionDelay: number;
  gamma: number;
  noiseSigma: number;
  vacancy?: Partial<Pick<VacancyParams, 'beta' | 'tPain' | 'vBoost' | 'tFlag' | 'tHard' | 'backstoppedRecoveryHazard'>>;
  sabotageCadenceDays: number;
  saboteurCount: number;
  acquireDays: number;
  damagePerSuccess: number;
  /** Flagged unresolved by Phase A's spatial-witness report — no canonical value exists.
   *  Exposed as config rather than hardcoded so it stays visible as an open question. */
  witnessRadius: number;
  /** [ILLUSTRATIVE] — matches design/tick_order_check.py's own test scenario (0.10), not a
   *  brief-specified or calibrated arrival rate. */
  arrivalPDaily: number;
  migrationTheta: number;
  migrationK: number;
  /** Weight on economic opportunity (open role-slots per roleless player) in damping
   *  emigration — see ecosystem.ts's `opportunityAdjustedMigrationStep`. 0 reproduces the
   *  old unmodulated valve exactly. Exposed as config so it stays sweepable. */
  opportunityWeight?: number;
  /** Radius used to build the proximity-based connection graph for Wall-post propagation. */
  commsProximityRange: number;
  /** PROPOSAL, not shipped as default (0). Flat daily income tax, redistributed equally
   *  across all currently-FILLED Miller+Baker role-holders — see wealth.ts's
   *  taxAndRedistributeIncome(). Deliberately NOT widened to the other 3 roles or grifters
   *  in this pass — see this file's header "WEALTH-INEQUALITY SCOPE" note. */
  wealthTaxRate: number;
  /** PROPOSAL, not shipped as default (undefined = no cap). Hard ceiling on accumulated
   *  Miller+Baker wealth only — see wealth.ts's applyWealthCap() and the scoping note above. */
  wealthCap?: number;
  /** Average days between one customer's bread purchases — feeds dailyDueCustomers().
   *  Defaults to wealth.ts's own PURCHASE_CYCLE_DAYS; exposed here so it's a real,
   *  sweepable knob rather than requiring a source edit to test different values. */
  purchaseCycleDays?: number;
}

// Six-role split, from a JOINT grid search over allocation x district layout
// (2026-08-11, sim/jointGridSearch.ts). Supersedes the hand-picked-candidates sweep.
// Coarse-to-fine: 560 allocations screened, 154 (27.5%) discarded outright as INCOHERENT
// (Bakers consuming more flour than Millers mill), then 8 finalists — top 2 per total, to
// guard against a screening bias toward small totals — re-run jointly against 3/6/11
// districts at full fidelity (1500 days, 2 seeds).
//
// What only a JOINT search could show: coherence depends on district count as well as
// allocation. Three finalists coherent at 3-6 districts go incoherent at 11 (flourRatio
// 1.000-1.027), because more districts means more consolidation and less milling. Separate
// sweeps of each axis structurally cannot surface that interaction.
//
// Chosen: M5 B5 C5 J5 D5 IE3 at 6 districts. Full-fidelity numbers vs. the previous
// shipped M5 B6 C6 J6 D5 IE4:
//   equality   gini 0.486 (best of ANY allocation at 6 districts) vs 0.514
//   grifters   22.0 mean days waiting vs 23.2
//   shards     3.0, the most bounded in the grid, vs 4.0
//   coherence  flourRatio 0.875 / 0.966 / 0.976 — the only near-even split that stays
//              coherent at EVERY district count, so the choice is not layout-dependent
//   cost       population 56.1 vs 59.3 and health 0.860 vs 0.873 — both real, both small,
//              and 56.1 sits comfortably inside the brief's own 50-80 band
// "Cleanest and fairest" is read as equitable AND coherent AND bounded, with population
// anywhere in-band treated as in spec rather than maximized. Miller stays deliberately
// scarce at 5 of 28. M7-based candidates scored well on coherence margin purely by adding
// Millers, and were rejected for undermining that design pillar.
//
// RE-CONFIRMED 2026-08-11 after the district-consolidation defect was fixed, with this
// allocation re-entered into the grid as an explicit incumbent baseline. It lost the
// "coherent at every district count" property it was originally chosen for (1.000 at 11
// districts), and the natural replacement bought that property back only by adding a
// Miller — the same scarcity trade already rejected for M7 candidates. Resolved by moving
// FLOUR_PER_BREAD 0.23 -> 0.20 instead: the allocation is chosen on design grounds, the
// flour ratio is the free parameter. Margin is now ~15% at 6 districts and coherent at 11.
//
// 11 districts remains a live alternative, not a rejected one: post-fix it trades 2.4%
// health and 1.2% population for 1.7% better equality and 5.0% shorter grifter waits — a
// real but modest trade, materially weaker than the pre-fix numbers suggested.
//
// RAISED TO targetPopulation=100 (2026-08-13, user-specified — the design addendum's "a
// hundred is enough as a tipping point to then open up a new [shard]" framing). NOT the
// addendum's own cited role numbers (M3/B7/IE2/C6/J5/D3=26), which trace back to a pre-port
// Python toy model and a pre-Import/Export sweep, both already superseded in this repo — see
// docs/BLUEPRINT.md's "2026-08-13 addendum received" entry for the full trail. Instead,
// `jointGridSearch.ts` was extended to take a population argument and re-run properly: 555
// candidates screened, 8 finalists confirmed at full fidelity across all three district
// layouts, every one passing the flourRatio<=1.0 hard filter. `M9 B9 C7 J7 D8 IE6` (S=46) at
// 6 districts won on the same judgement the pop=65 choice used — balance over extremes: near-
// top health (0.937), tied-lowest gini among the strong-health candidates (0.629), a
// comfortable flourRatio margin (0.616, not just-under-1.0), shard count holding at 2.5
// rather than inflating toward 3-4 like the S=52 candidates, and a real-but-modest grifter
// wait increase (26.9 vs ~22 days) — not a floor breach, matching the earlier real-engine
// verification (`sim/populationCapacitySweep.ts`) that the addendum's grifter-floor-breach
// concern doesn't reproduce once slot count and population scale together properly.
// 2026-08-22: Journalist and Detective merged into Investigator (see WorldConfig's own
// comment on rInvestigator for why). rInvestigator=15 is SUM-PRESERVING (old rJournalist=7 +
// rDetective=8), a deliberate least-invented choice — NOT a re-derivation. Whether 15 is the
// right count for a 5-role-plus-grifter roster is an open question for
// `sim/districtRoleSweep.ts`-style tooling, same as every other role/district allocation
// question this repo has actually measured rather than assumed. S stays 46 either way.
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  shardConfig: DEFAULT_SHARD_CONFIG,
  rMiller: 9,
  rBaker: 9,
  rCourier: 7,
  rInvestigator: 15,
  rImportExport: 6,
  targetPopulation: 100,
  pMonthly: 0.2,
  conscriptionDelay: 14,
  gamma: 1.0,
  noiseSigma: 0.01,
  sabotageCadenceDays: 20,
  saboteurCount: 3,
  acquireDays: 5,
  damagePerSuccess: 4,
  witnessRadius: 6,
  arrivalPDaily: 0.1,
  migrationTheta: 0.3,
  migrationK: 0.08,
  commsProximityRange: 10,
  wealthTaxRate: 0, // PROPOSAL disabled by default — see docs/BLUEPRINT.md's "Wealth inequality" entry
  wealthCap: undefined,
  purchaseCycleDays: undefined, // undefined = wealth.ts's own PURCHASE_CYCLE_DAYS default
};

export interface RoleEconomicSlot {
  slot: RoleSlot;
  buildingId: string;
  /** Miller: Cournot quantity. Baker: Bertrand price. Frozen while not FILLED. */
  value: number;
  /** Resets to 0 the moment a slot transitions into FILLED; frozen while VACANT/BACKSTOPPED. */
  experience: number;
  /** Accumulated personal earnings. Resets to 0 the moment a slot transitions into FILLED
   *  (a new occupant starts with nothing — no inherited wealth from whoever held the slot
   *  before); frozen while VACANT/BACKSTOPPED (nobody there to earn or lose anything). */
  wealth: number;
  /** Personal crafting-resource stock (`engine/personalResourceStock.ts`, 2026-08-13) — the
   *  gap `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §1 flagged. Same reset-on-new-occupant,
   *  frozen-while-not-FILLED convention as `wealth`. */
  personalResourceStock: number;
  /** Days since this slot's last +1 restock — internal counter for `stepPersonalStock`,
   *  resets alongside `personalResourceStock` on a new occupant. */
  daysSinceRestock: number;
  /** Consecutive days the CURRENT occupant has held this slot — 0 the moment it transitions
   *  into FILLED, +1 every subsequent day it stays FILLED, frozen while VACANT/BACKSTOPPED.
   *  Deliberately uncapped, unlike `experience` (capped at EXPERIENCE_CAP=0.5 and therefore
   *  useless past saturation for ranking "how established" two long-tenured occupants are
   *  relative to each other). Sole purpose (2026-08-18): feeds `occupantTenure` into
   *  `stepMultiRoleConscriptionDay`, the buildable preference-not-immunity alternative to the
   *  rejected `V_i` shield — see `multiRoleConscription.ts`'s `occupantTenure`/
   *  `ESTABLISHED_TENURE_DAYS` doc comments and docs/DEVLOG.md's matching entry. */
  daysInRole: number;
  /** Where this slot's occupant actually IS (2026-08-19) — see `SlotPosition` below. */
  x: number;
  y: number;
}

/**
 * Position decoupled from occupancy (2026-08-19) — item 2 of HANDOVER's "THE DIRECTION",
 * the blocker everything else in the Godot chain stacks behind.
 *
 * Until now a role-holder WAS their building's plot: those were the same fact, so movement
 * was not merely unimplemented, it was unrepresentable. `x`/`y` make where-someone-is a
 * separate fact from which-slot-they-hold, exactly as `GrifterSlot.x`/`y` already did for
 * the roleless pool (2026-08-19, the same work one step earlier).
 *
 * **Initialized to the occupant's own building plot, and nothing moves them yet.** That is
 * deliberate and load-bearing: witness counts (sabotage detection), identity resolution and
 * District Weather are all calibrated against the current all-at-their-building layout, so
 * this step changes the REPRESENTATION only and is provably behaviour-identical. Whatever
 * eventually moves a role-holder has to be measured against those three, per the standing
 * "simulate before trusting" constraint — it is not a free change.
 *
 * Reset convention matches `wealth`/`daysInRole`: a new occupant starts AT their workplace
 * (a fresh arrival hasn't wandered off yet), frozen while VACANT/BACKSTOPPED — an empty
 * slot has nobody to have a position.
 */

/** Courier/Investigator/ImportExport — same slot/wealth reset convention as
 *  RoleEconomicSlot, minus `value`/`experience` since none of the three have a competitive
 *  market mechanic. */
export interface SupportRoleSlot {
  slot: RoleSlot;
  buildingId: string;
  wealth: number;
  personalResourceStock: number;
  daysSinceRestock: number;
  /** Same meaning and reset convention as `RoleEconomicSlot.daysInRole` above. */
  daysInRole: number;
  /** Same meaning and reset convention as `RoleEconomicSlot.x`/`y` above. */
  x: number;
  y: number;
}

/** A roleless community player ("grifter" — user's own term). Individually tracked, unlike
 *  the aggregate-only gossip-layer population this replaces for identity purposes. */
export interface GrifterSlot {
  id: string;
  /** Accumulated personal earnings at GRIFTER_DAILY_INCOME/day. Resets to 0 on creation
   *  (churn, sabotage eviction, or a fresh arrival never inherits anyone's balance). */
  wealth: number;
  /** Consecutive days spent roleless so far. Reset to 0 on creation; the identity is popped
   *  from the pool (not decremented) the moment it fills or is drafted into an open role.
   *  This is the direct measurement of "the effect of grifters being under the minimum
   *  income floor until they obtain a role." */
  daysAsGrifter: number;
  /** Set only for grifters displaced by a district MERGE (see `stepWorld`'s district-health
   *  stage) — the day index by which they must be placed into an open role, "2 weeks to
   *  gain a role or be drafted." undefined for ordinary churn/sabotage/arrival grifters,
   *  who have no such deadline and wait on the ordinary conscription timers instead. */
  consolidationDeadline?: number;
  /** Which district this grifter is housed in — undefined until the housing-assignment pass
   *  at the end of the tick they were created in runs (same lazy-fill pattern
   *  `District.population` itself uses: never blocks creation, always resolved by the end of
   *  the same `stepWorld` call). Stable once assigned — a grifter isn't reshuffled between
   *  districts on later ticks just because a NEWER grifter arrived, only newly-unhoused
   *  grifters get placed. See `space.ts`'s `chooseHousingDistrict` and
   *  `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.3. */
  districtId?: DistrictId;
  /**
   * Real, independent world position (2026-08-19 — the first case in this engine of a
   * position that is NOT the same fact as a role slot; every role-holder's position is still
   * derived from their building, this is the actual primitive movement needs). Always a real
   * number, never `undefined` — unlike `districtId`, which genuinely has no answer until
   * housing resolves, a grifter needs SOMEWHERE to stand from the moment they exist. Defaults
   * to `Shard.hubPlot` at creation (same "not yet placed" convention `districtId` already
   * uses, just with a real coordinate instead of a missing one) and is corrected to their
   * housing district's plaza in the SAME lazy-fill pass that assigns `districtId`, so both
   * resolve together, by the end of the same tick, every time.
   *
   * Deliberately NOT fed into `buildProximityGraph`/witness counts here — grifters have
   * always been out of scope for spatial mechanics (see this file's header note), and
   * bringing them into witness-counted proximity is a real, separate calibration decision,
   * not a side effect of giving them a coordinate to render.
   */
  x: number;
  y: number;
  /** Accumulated reputation progress-ticks — undefined/0 for a freshly-created grifter, never
   *  set directly at construction (avoids touching every one of the 6+ places a `GrifterSlot`
   *  literal gets built; reads as `?? 0` everywhere, same convention `districtId` established).
   *  One tick per successfully-covered Shift Cover slot per day (`stepWorld`'s existing
   *  once-per-BACKSTOPPED-slot-per-day cap IS the anti-grind limiter — no new one needed, per
   *  §3.3). Level is derived from this via `reputation.ts`'s `reputationLevelForProgress`,
   *  never stored separately. Resets to 0 if this grifter identity ever fills a role and later
   *  becomes a NEW grifter — see `reputation.ts`'s own header for why that's a real, known
   *  limitation, not a bug in this field. */
  reputationProgress?: number;
  /** Per-role breakdown of successful Shift Cover completions (2026-08-13,
   *  `engine/experienceFloor.ts`) — real, role-specific practice, tracked separately from
   *  the flat `reputationProgress` counter above because the experience head-start a
   *  conscripted grifter starts a role with is keyed to practice in THAT role specifically,
   *  not overall reputation level (grifters essentially never reach level 2 — the "level-2
   *  trap" — so a level-based floor would almost never have anything to draw from). Missing
   *  entries read as 0, same `?? 0` convention as `reputationProgress`. Same known
   *  limitation as `reputationProgress`: resets if this identity later becomes a new
   *  grifter after filling a role. */
  shiftsCoveredByRole?: Partial<Record<RoleType, number>>;
}

export interface SabotageLogEntry {
  tick: number;
  targetBuildingId: string;
  witnesses: number;
  successfulSaboteurs: number;
  evicted: number;
}

/**
 * One thing that happened to a sabotage campaign this tick (2026-08-18 restructure). Richer
 * than `SabotageLogEntry`, which only ever described a resolved attempt and is kept for the
 * consumers already reading it — a campaign now has a life (`opened` -> `caught` | `succeeded`)
 * worth reporting at each stage, not just an outcome.
 */
export interface SabotageCampaignEvent {
  tick: number;
  type: 'opened' | 'caught' | 'succeeded' | 'abandoned';
  campaignId: string;
  targetBuildingId: string;
  /** Null for the ambient hazard, which names nobody. See `engine/sabotageCampaign.ts`. */
  saboteurId: string | null;
  /** Steps completed at this point — the step that gave it away, for `caught`. */
  atStep: number;
  witnesses: number;
}

export interface RumourEventLite {
  heardBy: PlayerId;
  heardFrom: PlayerId;
  state: SelfState;
  distorted: boolean;
  clarity: number;
}

/** A queued diary-write request — same "caller populates, `stepWorld` consumes and clears"
 *  shape as `pendingWallPosts`. Diary entries are unprompted-only (`diary.ts`'s own rule),
 *  so `stepWorld` never generates one on its own; this is the only way one enters `World`. */
export interface PendingDiaryEntry {
  authorId: PlayerId;
  subject: PlayerId;
  observation: Observation;
  reading: Reading;
  context?: ContextTag;
}

/** A queued proximity-conversation turn — same "caller populates, `stepWorld` consumes and
 *  clears" shape as `pendingWallPosts`/`pendingDiaryEntries`. `speakerId` is a buildingId
 *  (a currently-FILLED role slot), the same identity convention `WallPost.authorId` already
 *  uses — see this file's header note on why grifters are out of scope for any spatial comms
 *  mechanic today. */
export interface PendingProximityUtterance {
  speakerId: PlayerId;
  intent: ProximityIntent;
  tone: ProximityTone;
  referent: ProximityReferent;
  context?: ProximityContextTag;
}

/** One listener's degraded hearing of one proximity-conversation turn, reported for exactly
 *  the tick it happened — see `World.lastProximityConversations`. */
export interface ProximityConversationHeardEvent {
  listenerId: PlayerId;
  heard: HeardUtterance;
}

export interface World {
  seed: number;
  tick: number;
  rng: () => number;
  config: WorldConfig;
  shard: Shard;
  millers: RoleEconomicSlot[];
  bakers: RoleEconomicSlot[];
  couriers: SupportRoleSlot[];
  investigators: SupportRoleSlot[];
  /** Import/Export role-holders — nodule intake and grain supply. See engine/importExport.ts. */
  importExporters: SupportRoleSlot[];
  grifters: GrifterSlot[];
  /** Monotonic counter for grifter ids — deterministic, not time-based. */
  nextGrifterId: number;
  flourPrice: number;
  population: number;
  economicHealth: number;
  /** Scoped to Miller+Baker only — the only two roles with a tracked `experience` field
   *  (support roles have no differentiated productivity mechanic to grow experience in). */
  economicHealthWithExperience: number;
  /** Gini coefficient over every identity-bearing player's wealth: all 5 roles' FILLED
   *  slots plus every grifter. Widened 2026-08-11 — see this file's header note. 0 when
   *  fewer than 2 people are tracked (nothing meaningful to compare). */
  wealthGini: number;
  /** Share of total tracked wealth held by the richest 10% of all tracked players, same scope. */
  wealthTop10Share: number;
  /** Per-district consolidation state, keyed by `District.id`. Every district starts ACTIVE;
   *  see `engine/districtConsolidation.ts`. A MERGED district's record stays in this map
   *  forever (constraint: shard ids/records only ever grow, nothing is ever deleted) — its
   *  buildings are logically, not physically, excluded from role assignment from then on. */
  districtHealth: Record<string, DistrictHealth>;
  /** Real emigrants this tick — exposed (rather than silently absorbed into `population`)
   *  so a multi-shard orchestrator can route them to an actual destination shard instead of
   *  having them vanish. See `sim/multiShardHarness.ts`. */
  lastEmigrants: number;
  /** Whether the flat brand-new-player arrival channel (`config.arrivalPDaily`) fired this
   *  tick (0 or 1) — kept distinct from cross-shard migration inflow, which arrives via
   *  `receiveMigrants()` instead. */
  lastNewArrivals: number;
  /** Named per-role resource flows (today) and cumulative totals since creation — see
   *  `engine/resources.ts`. grain/flour/bread/parcels/stories/leads. */
  resources: ResourceLedger;
  pendingWallPosts: WallPost[];
  lastRumourEvents: RumourEventLite[];
  lastSabotage: SabotageLogEntry | null;
  /** Design Addendum item 1 (2026-08-11) — the Silhouette Shield's real trigger condition.
   *  Directional, per-observer encounter counts fed from real rumour-hearing events (see
   *  engine/identity.ts's header for why that signal, not a fabricated one). Never touched
   *  by `player.ts`'s `isKnown()` directly — derive an observer's known-set via
   *  `identity.ts`'s `resolvedSubjects()` first. */
  identityLedger: IdentityLedger;
  /** Design Addendum item 4 (2026-08-11) — uniform role-completion career stats, keyed by
   *  buildingId (the same identity granularity every other per-slot map in this file
   *  already uses). Reset to empty the moment a slot is freshly (re)FILLED — see
   *  engine/roleCompletion.ts's header. */
  completionStats: Readonly<Record<string, CompletionStats>>;
  /** Design Addendum 2026-08-12, §4 — pressure detection. Per-author (buildingId-keyed, same
   *  convention as everything else here) rolling record of Wall-post content, feeding
   *  `districtWeather.ts`'s ambient `tension` — never a name, never a per-player identifier
   *  exposed to any other player. See engine/pressureDetection.ts's header. */
  pressureLedger: Readonly<Record<string, PressureRecord>>;
  /** The diary's real storage — `engine/diary.ts`'s `PrivateStore<DiaryEntry>`, keyed by
   *  owner `PlayerId`. Reads (`readDiary`) apply the daily distortion/expiry lazily on
   *  access — `stepWorld` doesn't need its own maintenance pass for that, only for writes.
   *
   *  DELIBERATE EXCEPTION to this file's otherwise-immutable-snapshot convention (see the
   *  file header's "DETERMINISM" note): `PrivateStore` is a mutable `Map`, by design —
   *  `privateStore.ts`'s own header calls it "server-authoritative... the canonical copy,"
   *  meaning there is meant to be exactly ONE live store, not a fresh clone every tick. This
   *  field is the same `Map` reference across every `stepWorld` call for a given `World`
   *  lineage, mutated in place by `writeDiaryEntry`/`getAlive`'s distortion — NOT
   *  recreated. Two `World` snapshots (e.g. one kept for comparison, one stepped forward)
   *  therefore SHARE and both observe this store's mutations, unlike every other field on
   *  `World`. Flagged here explicitly rather than silently diverging from the file's own
   *  stated contract. */
  diary: PrivateStore<DiaryEntry>;
  /** Queued diary-write requests — consumed and cleared every `stepWorld` call, same
   *  pattern as `pendingWallPosts`. */
  pendingDiaryEntries: PendingDiaryEntry[];
  /** Authors whose queued entry actually wrote this tick. */
  lastDiaryWrites: PlayerId[];
  /** Queued entries rejected this tick (self-entry, or SUBJECT not yet resolved for that
   *  author) — `writeDiaryEntry` throws on these rather than silently dropping them, so
   *  `stepWorld` catches and reports them here instead of crashing the tick. */
  lastDiaryRejections: Array<{ authorId: PlayerId; reason: string }>;
  /** Real, observed counts from this tick's Oracle draw (`engine/oracle.ts`) — entirely a
   *  side-channel for measurement (the sim harness's win-rate/prize-mix validation against
   *  `oracleWinProbability`'s theoretical curve), never read by any selection or economic
   *  logic itself. Same "report what actually happened, don't make the caller infer it from
   *  field deltas" convention as `lastDiaryRejections`. */
  lastOracleStats: OracleTickStats;
  /** The basic day (2026-08-24) — this tick's Import/Export nodule/grain supply, split into
   *  `engine/dayCycle.ts`'s two real UTC-anchored windows instead of one blended daily
   *  number. Byte-identical total to the pre-existing single figure; only the reporting
   *  granularity is new. Same "report what actually happened this tick" convention as
   *  `lastOracleStats`/`lastSabotage`. */
  lastImportExportWindows: ImportExportWindowEvent[];
  /** The presence/session primitive (2026-08-24) — who the caller reports as currently
   *  connected, e.g. `ws.ts` populating this from real open connections each tick. UNLIKE
   *  `pendingX` fields, this is NOT drained/cleared by `stepWorld` — it's a live snapshot the
   *  caller keeps current, read fresh every tick, the same "persistent field the caller
   *  updates between calls" convention `rng`/`config` already use. Defaults to an empty set
   *  (nobody reported online) for every sim/test context that never sets it, matching this
   *  field's honest neutral default. See `engine/presence.ts`'s header for scope (role-holders
   *  only, daily-tick granularity, no wire exposure — presence is WITHHELD, not broadcast). */
  currentlyOnline: ReadonlySet<PlayerId>;
  /** This tick's reconciled presence ledger, keyed by buildingId — see `engine/presence.ts`.
   *  Rebuilt fresh from the FINAL post-tick FILLED role-slot set each tick, so a vacated slot
   *  simply has no entry rather than a stale one. */
  presence: Readonly<Record<PlayerId, PresenceRecord>>;
  /** Queued proximity-conversation turns — consumed and cleared every `stepWorld` call, same
   *  pattern as `pendingWallPosts`/`pendingDiaryEntries`. */
  pendingProximityUtterances: PendingProximityUtterance[];
  /** Every listener's degraded hearing of a proximity-conversation turn THIS tick only —
   *  ephemeral by the mechanic's own design (`comms/proximityConversation.ts`'s header:
   *  no store, nothing to persist), never accumulated across ticks, same "report what
   *  actually happened" shape as `lastRumourEvents`. */
  lastProximityConversations: ProximityConversationHeardEvent[];
  /** Queued turns rejected this tick (self-address, or REFERENT naming someone not actually
   *  in proximity range) — `composeUtterance` throws on these rather than silently dropping
   *  them, same convention as `lastDiaryRejections`. */
  lastProximityRejections: Array<{ speakerId: PlayerId; reason: string }>;
  /** Sabotage campaigns currently in flight (2026-08-18 restructure). Real multi-tick state —
   *  this is what makes a campaign something a Investigator, or eventually a player, can act on
   *  partway through. See `engine/sabotageCampaign.ts`. */
  sabotageCampaigns: SabotageCampaign[];
  /** Monotonic campaign id counter — ids only ever grow, same convention as `nextGrifterId`
   *  and `shardRegistry.ts`'s own shard ids. */
  nextCampaignId: number;
  /** Everything that happened to a campaign this tick, `opened` included — so the hazard's own
   *  timing stays observable now that opening and resolving are days apart. */
  lastSabotageCampaignEvents: SabotageCampaignEvent[];
}

/** See `World.lastOracleStats`. `entrants` chose to participate (before affordability is
 *  even checked); `entered` could also afford `ORACLE_ENTRY_COST` and actually paid it —
 *  `wins`/`winsByPrize` are counted only among `entered`. */
export interface OracleTickStats {
  entrants: number;
  entered: number;
  wins: number;
  winsByPrize: Record<OraclePrizeType, number>;
}

/**
 * `population` here is intentionally the LIVE `world.population`, not the static
 * `config.targetPopulation` — a real, previously-flagged simplification (see HANDOVER.md's
 * "Things to know" history) fixed as part of this session's population-collapse work:
 * `fillHazard`'s `N-R` candidate-pool exponent should track how many people are actually
 * in the shard right now, not a fixed target that stays wrong for as long as real
 * population sits away from it (which is precisely the collapsed/recovering state this
 * whole mechanism now spends most of its time in).
 */
/** Total role slots across all 5 roles — the shard's full staffing capacity. */
function totalRoleSlotsFor(config: WorldConfig): number {
  return config.rMiller + config.rBaker + config.rCourier + config.rInvestigator + config.rImportExport;
}

function vacancyParamsFor(R: number, population: number, pMonthly: number, config: WorldConfig): VacancyParams {
  return {
    N: population,
    R,
    pDaily: dailyChurnFromMonthly(pMonthly),
    beta: config.vacancy?.beta ?? VACANCY_DEFAULTS.beta,
    tPain: config.vacancy?.tPain ?? VACANCY_DEFAULTS.tPain,
    vBoost: config.vacancy?.vBoost ?? VACANCY_DEFAULTS.vBoost,
    tFlag: config.vacancy?.tFlag ?? VACANCY_DEFAULTS.tFlag,
    tHard: config.vacancy?.tHard ?? VACANCY_DEFAULTS.tHard,
    backstoppedRecoveryHazard: config.vacancy?.backstoppedRecoveryHazard,
  };
}

/**
 * District-aware assignment across all 5 roles (2026-08-11, replacing the old "first
 * rMiller+rBaker buildings in generation order" approach, which wasn't district-aware at
 * all — every role clustered into whichever districts happened to be generated first).
 * Walks every building in shard-generation (district-by-district) order, round-robining a
 * cursor across `ROLE_TYPES` so each role's slots are spread across the district sequence
 * roughly in proportion to its share of the total — "roles required locally," not just
 * globally. A deterministic, simple, testable policy; not claimed to be the only possible
 * one — see docs/BLUEPRINT.md's "5-role roster" entry.
 */
function assignRoleBuildings(shard: Shard, roleCounts: Record<RoleType, number>): Record<RoleType, Building[]> {
  const totalRoles = ROLE_TYPES.reduce((sum, r) => sum + roleCounts[r], 0);
  const totalBuildings = shard.districts.reduce((sum, d) => sum + d.buildings.length, 0);
  if (totalBuildings < totalRoles) {
    throw new Error(
      `shard has ${totalBuildings} buildings, but ${ROLE_TYPES.map((r) => `${r}=${roleCounts[r]}`).join('+')} = ${totalRoles} role slots requested — increase the shard config's building counts or lower the role counts`,
    );
  }

  // Round-robins ACROSS districts, one building at a time, rather than exhausting one
  // district's whole building list before moving to the next (real bug found 2026-08-13,
  // probing the district-topology question after fixing District.population tracking):
  // walking buildings strictly in district-then-building order starves whichever districts
  // land last in that order once totalRoles < totalBuildings (routine — a district needs
  // Home-only buildings too, `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.1). At the
  // shipped 6-district/46-role config this left 2 of 4 periphery districts with LITERALLY
  // ZERO role-holders, ever, deterministically, not a statistical fluke.
  //
  // Processes one ROLE at a time (not interleaved role-then-district cycling in a single
  // loop) — a first attempt at this interleaved both cursors in lockstep and hit a real
  // resonance bug: with exactly 6 roles and 6 districts, a role index and a district index
  // both advancing by 1 per iteration keep a CONSTANT offset mod 6 forever, so every slot of
  // a given role landed in the same single district every time (caught by a courier-pay test
  // expecting distance variance — all 7 couriers landed in one periphery district with
  // identical wealth). Assigning role-by-role with a district cursor that keeps advancing
  // ACROSS roles (not reset per role, so no single district gets first pick every time)
  // avoids that coupling entirely and is simpler to reason about besides.
  const buildingQueues = shard.districts.map((d) => [...d.buildings]);
  const result: Record<RoleType, Building[]> = { miller: [], baker: [], courier: [], investigator: [], importExport: [] };

  let di = 0;
  for (const role of ROLE_TYPES) {
    let need = roleCounts[role];
    while (need > 0) {
      let scanned = 0;
      while (buildingQueues[di % buildingQueues.length]!.length === 0 && scanned < buildingQueues.length) {
        di += 1;
        scanned += 1;
      }
      if (scanned >= buildingQueues.length) break; // no buildings left anywhere — totalBuildings check above rules this out
      const building = buildingQueues[di % buildingQueues.length]!.shift()!;
      result[role].push(building);
      need -= 1;
      di += 1;
    }
  }

  return result;
}

export function createWorld(seed: number, config: WorldConfig = DEFAULT_WORLD_CONFIG): World {
  const rng = mulberry32(seed);
  const shard = generateShardLayout(seed, config.shardConfig);
  const roleCounts: Record<RoleType, number> = {
    miller: config.rMiller,
    baker: config.rBaker,
    courier: config.rCourier,
    investigator: config.rInvestigator,
    importExport: config.rImportExport,
  };
  const assigned = assignRoleBuildings(shard, roleCounts);

  // Bind buildings to their role slot — space.ts's own building.roleSlotRef, resolved here.
  // Mutates the just-generated shard's building objects in place — acceptable only
  // because this shard isn't shared with anything yet at construction time; stepWorld()
  // below never mutates an already-returned world's shard the same way.
  for (const shardDistrict of shard.districts) {
    for (const building of shardDistrict.buildings) {
      for (const role of ROLE_TYPES) {
        const idx = assigned[role].indexOf(building);
        if (idx >= 0) building.roleSlotRef = `${role}-${idx}`;
      }
    }
  }

  const millers: RoleEconomicSlot[] = assigned.miller.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.3 + rng() * 0.2, // matches initMarket's own initial-quantity draw
    experience: EXPERIENCE_CAP, // "start maxed, established shard" — matches ecosystemHarness's convention
    wealth: 0,
    ...emptySlotStock(),
    daysInRole: ESTABLISHED_TENURE_DAYS, // same "start maxed, established shard" convention
    x: b.x,
    y: b.y,
  }));
  const bakers: RoleEconomicSlot[] = assigned.baker.map((b) => ({
    slot: { state: 'FILLED', vacantSince: null },
    buildingId: b.id,
    value: 0.5 + rng() * 0.2, // matches initMarket's own initial-price draw
    experience: EXPERIENCE_CAP,
    wealth: 0,
    ...emptySlotStock(),
    daysInRole: ESTABLISHED_TENURE_DAYS,
    x: b.x,
    y: b.y,
  }));
  const couriers: SupportRoleSlot[] = assigned.courier.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0, ...emptySlotStock(), daysInRole: ESTABLISHED_TENURE_DAYS, x: b.x, y: b.y }));
  const investigators: SupportRoleSlot[] = assigned.investigator.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0, ...emptySlotStock(), daysInRole: ESTABLISHED_TENURE_DAYS, x: b.x, y: b.y }));
  const importExporters: SupportRoleSlot[] = assigned.importExport.map((b) => ({ slot: { state: 'FILLED', vacantSince: null }, buildingId: b.id, wealth: 0, ...emptySlotStock(), daysInRole: ESTABLISHED_TENURE_DAYS, x: b.x, y: b.y }));

  const supply = millers.reduce((a, m) => a + m.value, 0);
  const flourPriceValue = computeFlourPrice(supply);
  const totalRoleSlots = totalRoleSlotsFor(config);
  const avgExp = EXPERIENCE_CAP;

  const grifterCount = Math.max(0, config.targetPopulation - totalRoleSlots);
  const grifters: GrifterSlot[] = Array.from({ length: grifterCount }, (_, i) => ({
    id: `grifter-${i}`,
    wealth: 0,
    daysAsGrifter: 0,
    x: shard.hubPlot.x,
    y: shard.hubPlot.y,
  }));

  const districtHealth: Record<string, DistrictHealth> = {};
  for (const d of shard.districts) districtHealth[d.id] = initialDistrictHealth();

  return {
    seed,
    tick: 0,
    rng,
    config,
    shard,
    millers,
    bakers,
    couriers,
    investigators,
    importExporters,
    grifters,
    nextGrifterId: grifterCount,
    flourPrice: flourPriceValue,
    population: config.targetPopulation,
    economicHealth: economicHealth(totalRoleSlots, totalRoleSlots), // all FILLED at creation
    economicHealthWithExperience: economicHealthWithExperience(millers.length + bakers.length, avgExp, config.rMiller + config.rBaker),
    wealthGini: 0, // everyone starts at 0 wealth — perfect equality, honestly
    wealthTop10Share: 0,
    districtHealth,
    resources: emptyLedger(),
    lastEmigrants: 0,
    lastNewArrivals: 0,
    pendingWallPosts: [],
    lastRumourEvents: [],
    lastSabotage: null,
    identityLedger: emptyIdentityLedger(),
    completionStats: {},
    pressureLedger: {},
    diary: createDiaryStore(),
    pendingDiaryEntries: [],
    lastDiaryWrites: [],
    lastDiaryRejections: [],
    lastOracleStats: { entrants: 0, entered: 0, wins: 0, winsByPrize: { wealth: 0, resourceStock: 0, time: 0 } },
    lastImportExportWindows: [],
    currentlyOnline: new Set(),
    presence: {},
    pendingProximityUtterances: [],
    lastProximityConversations: [],
    lastProximityRejections: [],
    sabotageCampaigns: [],
    nextCampaignId: 0,
    lastSabotageCampaignEvents: [],
  };
}

/**
 * A newly-opened shard with no world yet — "everything else on your second empty shard
 * goes into automated economic stability until a new player lands." Reuses `createWorld`'s
 * geography/role-slot layout, then vacates every role slot and clears population/grifters —
 * no new "dormant mode" is needed inside `stepWorld` itself: a world with 0 population and
 * every slot VACANT already behaves as mechanically stable (BACKSTOPPED coverage kicks in
 * via the ordinary vacancy timers, <2 FILLED already freezes the competitive layer) for
 * free, from behavior that was already correct. See `sim/multiShardHarness.ts`.
 */
export function createDormantWorld(seed: number, config: WorldConfig): World {
  const w = createWorld(seed, config);
  const vacantizeRole = <T extends { slot: RoleSlot }>(arr: T[]): T[] =>
    arr.map((s) => ({ ...s, slot: { state: 'VACANT' as const, vacantSince: 0 } }));
  const totalRoleSlots = config.rMiller + config.rBaker + config.rCourier + config.rInvestigator;
  return {
    ...w,
    millers: vacantizeRole(w.millers),
    bakers: vacantizeRole(w.bakers),
    couriers: vacantizeRole(w.couriers),
    investigators: vacantizeRole(w.investigators),
    grifters: [],
    nextGrifterId: 0,
    population: 0,
    economicHealth: economicHealth(0, totalRoleSlots),
    economicHealthWithExperience: 0,
    wealthGini: 0,
    wealthTop10Share: 0,
  };
}

/**
 * Injects `count` real migrants (from another shard, via a multi-shard orchestrator) as
 * new grifters — they arrive roleless, same as any other fresh arrival, and take their
 * place in the ordinary vacancy/conscription cycle from the next tick on.
 */
export function receiveMigrants(world: World, count: number): World {
  if (count <= 0) return world;
  let grifters = world.grifters;
  let nextGrifterId = world.nextGrifterId;
  for (let i = 0; i < count; i++) {
    grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0, x: world.shard.hubPlot.x, y: world.shard.hubPlot.y }];
    nextGrifterId += 1;
  }
  return { ...world, grifters, nextGrifterId, population: world.population + count };
}

/**
 * Whether `playerId` (a `buildingId`, the same identity convention every role-holder-authored
 * mechanic already uses — `WallPost.authorId`, `PendingProximityUtterance.speakerId`, diary
 * `authorId`) is a currently-FILLED role slot in this world. The action vocabulary's server-
 * side gate (2026-08-24): before a connection's claimed identity can author anything, it must
 * actually be someone real in the world right now — VACANT/BACKSTOPPED slots and grifters have
 * no standing to act. Cheap and pure; not memoized, since this only runs once per inbound
 * action, not in a hot per-tick loop.
 */
export function isFilledRoleHolder(world: World, playerId: PlayerId): boolean {
  const allSlots: { buildingId: string; slot: RoleSlot }[] = [
    ...world.millers,
    ...world.bakers,
    ...world.couriers,
    ...world.investigators,
    ...world.importExporters,
  ];
  return allSlots.some((s) => s.buildingId === playerId && s.slot.state === 'FILLED');
}

/**
 * Runs Cournot/Bertrand competition among only the currently-FILLED slots, freezing every
 * other slot's `value`. A real, found contradiction (documented in docs/BLUEPRINT.md's
 * "Phase B" entry, not silently papered over): `stepMillers`/`stepBakers` both require at
 * least 2 array entries — vacancy.ts's semi-Markov process makes zero or one FILLED slot
 * a perfectly ordinary outcome, especially at small role counts, with no natural
 * "who do they compete against" answer below 2. Resolved here as: fewer than 2 FILLED
 * slots means no competition happens that day (every slot's value freezes, same as a
 * VACANT/BACKSTOPPED slot already does) — reads naturally as "no rival, no Cournot/
 * Bertrand step," not as an error, and never throws regardless of role-slot configuration.
 */
function stepCompetitiveLayer(
  slots: RoleEconomicSlot[],
  justFilled: Set<string>,
  competitor: (values: number[]) => number[],
  freshDraw: () => number,
  experienceFloorByBuildingId?: ReadonlyMap<string, number>,
  buildingPositionById?: ReadonlyMap<string, { x: number; y: number }>,
): RoleEconomicSlot[] {
  const filledIndices = slots.map((s, i) => (s.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
  const filledValues = filledIndices.map((i) => slots[i]!.value);
  const nextFilledValues = filledValues.length >= 2 ? competitor(filledValues) : filledValues;

  return slots.map((s, i) => {
    const wasJustFilled = justFilled.has(s.buildingId);
    if (wasJustFilled) {
      // wealth resets too — a new occupant inherits nothing from whoever held this slot
      // before. Income for this same day still accrues afterward, in stepWorld's market
      // stage, once flourPrice is known. `experience` defaults to 0 (the common case — a
      // green grifter) unless a real experience floor was earned via role-specific Shift
      // Cover practice — see `engine/experienceFloor.ts`.
      // Position resets alongside wealth: a new occupant starts AT their workplace, having
      // just arrived. Falls back to the slot's existing position when no building map was
      // supplied — which is the same value, since nothing moves a role-holder yet.
      const arrival = buildingPositionById?.get(s.buildingId);
      return {
        ...s,
        value: freshDraw(),
        experience: experienceFloorByBuildingId?.get(s.buildingId) ?? 0,
        wealth: 0,
        ...emptySlotStock(),
        daysInRole: 0,
        x: arrival?.x ?? s.x,
        y: arrival?.y ?? s.y,
      };
    }
    const filledPos = filledIndices.indexOf(i);
    if (filledPos >= 0) {
      return { ...s, value: nextFilledValues[filledPos]!, experience: growExperience(s.experience), daysInRole: s.daysInRole + 1 };
    }
    return s; // VACANT or BACKSTOPPED and not newly filled: value, experience, wealth, daysInRole all frozen
  });
}

/**
 * Aggregate Miller supply feeding `flourPrice()` — FILLED slots contribute their own
 * competed-for `value`; BACKSTOPPED slots contribute `BACKSTOP_PRODUCTIVITY` mechanically
 * (reusing ecosystem.ts's own constant, not a separate invented one — see the doc comment
 * at its call site in `stepWorld`); VACANT slots contribute nothing. This is the specific
 * "a BACKSTOPPED or conscripted Miller must actually participate in pricing" requirement
 * the Observatory spec names — exported standalone so it's directly testable without
 * needing to reverse-engineer it from a full `stepWorld` tick.
 */
export function computeMillerSupply(millers: RoleEconomicSlot[]): number {
  return millers.reduce((total, m) => {
    if (m.slot.state === 'FILLED') return total + m.value;
    if (m.slot.state === 'BACKSTOPPED') return total + BACKSTOP_PRODUCTIVITY;
    return total;
  }, 0);
}

function buildProximityGraph(occupants: PlayerPosition[], maxRange: number): ConnectionGraph {
  const graph = new ConnectionGraph();
  for (let i = 0; i < occupants.length; i++) {
    for (let j = i + 1; j < occupants.length; j++) {
      const a = occupants[i]!;
      const b = occupants[j]!;
      const closeness = proximityCloseness(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), maxRange);
      if (closeness !== null) graph.connect(a.playerId, b.playerId, closeness);
    }
  }
  return graph;
}

interface RoleArrays {
  millers: RoleEconomicSlot[];
  bakers: RoleEconomicSlot[];
  couriers: SupportRoleSlot[];
  investigators: SupportRoleSlot[];
  importExporters: SupportRoleSlot[];
}

/** Every currently-FILLED slot across all roles, with enough to identify and evict it. */
function filledEntries(arrays: RoleArrays): { role: RoleType; index: number; buildingId: string }[] {
  const out: { role: RoleType; index: number; buildingId: string }[] = [];
  arrays.millers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'miller', index: i, buildingId: s.buildingId });
  });
  arrays.bakers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'baker', index: i, buildingId: s.buildingId });
  });
  arrays.couriers.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'courier', index: i, buildingId: s.buildingId });
  });
  arrays.investigators.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'investigator', index: i, buildingId: s.buildingId });
  });
  arrays.importExporters.forEach((s, i) => {
    if (s.slot.state === 'FILLED') out.push({ role: 'importExport', index: i, buildingId: s.buildingId });
  });
  return out;
}

/** One deterministic tick. See this file's header comment for the pinned stage order. */
export function stepWorld(world: World): World {
  const { rng, config } = world;
  const day = world.tick;

  // ---- Stage 1: space/occupancy -----------------------------------------------------
  // A pure derivation from current role-slot state, not a stateful process of its own —
  // no synthetic drivers exist yet (Phase C) to actually move anyone. Recomputes each
  // building's occupant position (its own plot, static) and feeds district population.
  const allBuildingsById = new Map(world.shard.districts.flatMap((d) => d.buildings).map((b) => [b.id, b]));
  // Reads the occupant's OWN position (2026-08-19), not their building's plot. Identical
  // output today — every role-holder is initialized to their building and nothing moves
  // them yet — but the source of truth is now the person, not the address, which is the
  // whole point of decoupling position from occupancy.
  const occupantsOf = (slots: { slot: RoleSlot; buildingId: string; x: number; y: number }[]): PlayerPosition[] =>
    slots
      .filter((s) => s.slot.state === 'FILLED')
      .map((s) => ({ playerId: s.buildingId, x: s.x, y: s.y }));

  /** Where a new occupant of `buildingId` starts: at their workplace, having just arrived. */
  const arriveAt = (buildingId: string): { x: number; y: number } => {
    const b = allBuildingsById.get(buildingId);
    return b ? { x: b.x, y: b.y } : { x: world.shard.hubPlot.x, y: world.shard.hubPlot.y };
  };

  // ---- Stage 1b: district health (2026-08-11) ----------------------------------------
  // Underpopulation-triggered, irreversible per district — see districtConsolidation.ts's
  // header for the full reasoning. Stepped from the INCOMING (pre-tick) role-slot state,
  // so a district that flips to MERGED today already excludes its slots from today's own
  // conscription pass below, same same-day-cascading discipline as everything else here.
  const buildingDistrictId = new Map<string, string>();
  for (const d of world.shard.districts) {
    for (const b of d.buildings) buildingDistrictId.set(b.id, d.id);
  }
  const allRoleSlotsForHealth: { buildingId: string; slot: RoleSlot }[] = [
    ...world.millers,
    ...world.bakers,
    ...world.couriers,
    ...world.investigators,
  ];
  const districtHealth: Record<string, DistrictHealth> = {};
  const newlyMergedDistrictIds: string[] = [];
  // Captured alongside districtHealth so District Weather (below) reads the identical
  // filled-fraction signal districtConsolidation.ts computed, rather than measuring it a
  // second time — see districtWeather.ts's header.
  const districtFilledFractionById: Record<string, number> = {};
  for (const d of world.shard.districts) {
    const districtSlots = allRoleSlotsForHealth.filter((s) => buildingDistrictId.get(s.buildingId) === d.id);
    const filledCount = districtSlots.filter((s) => s.slot.state === 'FILLED').length;
    const fraction = districtFilledFraction(filledCount, districtSlots.length);
    districtFilledFractionById[d.id] = fraction;
    const prevHealth = world.districtHealth[d.id] ?? initialDistrictHealth();
    const nextHealth = stepDistrictHealth(prevHealth, fraction, day);
    districtHealth[d.id] = nextHealth;
    if (prevHealth.state !== 'MERGED' && nextHealth.state === 'MERGED') newlyMergedDistrictIds.push(d.id);
  }

  // ---- Stage 2: vacancy and conscription (all 5 roles + grifter pool) ----------------
  let millers = world.millers;
  let bakers = world.bakers;
  let couriers = world.couriers;
  let investigators = world.investigators;
  let importExporters = world.importExporters;
  let grifters = world.grifters;
  let nextGrifterId = world.nextGrifterId;

  // A district crossing into MERGED today evicts every role-holder physically in it —
  // "excess players" pushed into the grifter pool with a hard consolidationDeadline (the
  // district's own grace period, so "2 weeks to gain a role or be drafted" lands on the
  // same calendar the district itself just finished counting down). Their buildings are
  // logically excluded from every future conscription pass below (never physically
  // spliced from shard.districts — see districtConsolidation.ts's header).
  if (newlyMergedDistrictIds.length > 0) {
    const isInMergedDistrict = (buildingId: string) => newlyMergedDistrictIds.includes(buildingDistrictId.get(buildingId)!);
    const evictWithDeadline = <T extends { slot: RoleSlot; buildingId: string }>(arr: T[]): T[] =>
      arr.map((s) => {
        if (s.slot.state === 'FILLED' && isInMergedDistrict(s.buildingId)) {
          // A same-tick INTERIM value, same as every other grifter's hub default — this
          // grifter has no `districtId` either, so the housing-assignment pass at the end of
          // this same tick will immediately re-house and reposition them regardless. Set from
          // their own building anyway rather than the hub: it is the more honest value for the
          // (rare) case housing assignment finds nowhere to place them, and for anything that
          // might read mid-tick state before that pass runs.
          const evictedFrom = allBuildingsById.get(s.buildingId);
          grifters = [
            ...grifters,
            {
              id: `grifter-${nextGrifterId}`,
              wealth: 0,
              daysAsGrifter: 0,
              consolidationDeadline: day + CONSOLIDATION_GRACE_DAYS,
              x: evictedFrom?.x ?? world.shard.hubPlot.x,
              y: evictedFrom?.y ?? world.shard.hubPlot.y,
            },
          ];
          nextGrifterId += 1;
          return { ...s, slot: { state: 'VACANT' as const, vacantSince: day } };
        }
        return s;
      });
    importExporters = evictWithDeadline(importExporters);
    millers = evictWithDeadline(millers);
    bakers = evictWithDeadline(bakers);
    couriers = evictWithDeadline(couriers);
    investigators = evictWithDeadline(investigators);
  }

  // A MERGED district's slots are NOT permanently excluded from ordinary refilling —
  // deliberately reverted from an earlier version of this change that did exclude them,
  // once testing showed it over a long enough run collapses every role slot toward zero
  // with nowhere for that capacity to go (contradicts "combine into half the shard,"
  // which concentrates capacity, not deletes it; also contradicts constraint 2, no
  // permanent zero-state, applied to the whole shard's economy). A MERGED district's
  // buildings stay part of the ordinary vacancy/conscription pool going forward — the
  // real, lasting consequence of a merge is the one-time eviction above plus the
  // permanent friction floor on income (Stage 3 below), not a capacity cliff. Physically
  // relocating a merged district's buildings into a surviving district's geography is a
  // larger change (real building reassignment, not just a state flag) deliberately left
  // for a later pass — flagged in docs/BLUEPRINT.md, not silently narrowed.
  function justFilledSet(before: { slot: RoleSlot; buildingId: string }[], afterSlots: RoleSlot[]): Set<string> {
    const s = new Set<string>();
    before.forEach((b, i) => {
      if (b.slot.state !== 'FILLED' && afterSlots[i]!.state === 'FILLED') s.add(b.buildingId);
    });
    return s;
  }

  // Reputation gate (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.5): a real
  // per-level breakdown of the CURRENT grifter pool, computed once here from real
  // `reputationProgress` state, and each role group's real minimum level requirement
  // (`minLevelForRole` — 1 for the four cooperative roles, 2 for Miller/Baker). Passed to
  // `stepMultiRoleConscriptionDay`, which gates only `genuineFill`; conscription/backstop
  // below are entirely unaffected, same as every day before this gate existed.
  const grifterLevelCounts: Record<number, number> = {};
  for (const g of grifters) {
    const level = reputationLevelForProgress(g.reputationProgress ?? 0);
    grifterLevelCounts[level] = (grifterLevelCounts[level] ?? 0) + 1;
  }
  // occupantTenure (2026-08-18): each role group's CURRENT pre-tick daysInRole, parallel to
  // its slots array — feeds conscriptionFromOtherRole's eviction-preference bias (see
  // multiRoleConscription.ts's occupantTenure/ESTABLISHED_TENURE_DAYS doc comments). Built
  // from today's real state, same convention as grifterLevelCounts above.
  //
  // occupantPerformance (2026-08-18, "grinders should have greater upward mobility than lazy
  // players... activity is the fastest path to reward"): each slot's REAL career
  // `completionRatio` (world.completionStats, item 4's own signal), normalized against that
  // role's own typical rate so a Miller's ~55% and a Courier's ~97% are comparable on the
  // same scale (1.0 = exactly typical). Fresh/never-attempted slots read as 0 — no track
  // record yet reads as "not established," matching daysInRole also being 0 on a fresh fill.
  function occupantPerformanceFor(buildingId: string, role: keyof typeof TYPICAL_COMPLETION_RATIO): number {
    return completionRatio(world.completionStats[buildingId] ?? emptyCompletionStats()) / TYPICAL_COMPLETION_RATIO[role];
  }
  const roleGroupsIn: RoleGroupState[] = [
    { roleId: 'miller', slots: millers.map((m) => m.slot), params: vacancyParamsFor(config.rMiller, world.population, config.pMonthly, config), minReputationLevelForFill: minLevelForRole('miller'), occupantTenure: millers.map((m) => m.daysInRole), occupantPerformance: millers.map((m) => occupantPerformanceFor(m.buildingId, 'miller')) },
    { roleId: 'baker', slots: bakers.map((b) => b.slot), params: vacancyParamsFor(config.rBaker, world.population, config.pMonthly, config), minReputationLevelForFill: minLevelForRole('baker'), occupantTenure: bakers.map((b) => b.daysInRole), occupantPerformance: bakers.map((b) => occupantPerformanceFor(b.buildingId, 'baker')) },
    { roleId: 'courier', slots: couriers.map((c) => c.slot), params: vacancyParamsFor(config.rCourier, world.population, config.pMonthly, config), minReputationLevelForFill: minLevelForRole('courier'), occupantTenure: couriers.map((c) => c.daysInRole), occupantPerformance: couriers.map((c) => occupantPerformanceFor(c.buildingId, 'courier')) },
    { roleId: 'investigator', slots: investigators.map((d) => d.slot), params: vacancyParamsFor(config.rInvestigator, world.population, config.pMonthly, config), minReputationLevelForFill: minLevelForRole('investigator'), occupantTenure: investigators.map((d) => d.daysInRole), occupantPerformance: investigators.map((d) => occupantPerformanceFor(d.buildingId, 'investigator')) },
    { roleId: 'importExport', slots: importExporters.map((x) => x.slot), params: vacancyParamsFor(config.rImportExport, world.population, config.pMonthly, config), minReputationLevelForFill: minLevelForRole('importExport'), occupantTenure: importExporters.map((x) => x.daysInRole), occupantPerformance: importExporters.map((x) => occupantPerformanceFor(x.buildingId, 'importExport')) },
  ];
  const conscriptionResult = stepMultiRoleConscriptionDay(
    roleGroupsIn,
    grifters.length,
    day,
    config.conscriptionDelay,
    rng,
    grifterLevelCounts,
  );
  const byRole = new Map(conscriptionResult.roleGroups.map((g) => [g.roleId, g.slots] as const));

  const millerJustFilled = justFilledSet(millers, byRole.get('miller')!);
  const bakerJustFilled = justFilledSet(bakers, byRole.get('baker')!);
  const courierJustFilled = justFilledSet(couriers, byRole.get('courier')!);
  const investigatorJustFilled = justFilledSet(investigators, byRole.get('investigator')!);
  const importExportJustFilled = justFilledSet(importExporters, byRole.get('importExport')!);

  millers = millers.map((m, i) => ({ ...m, slot: byRole.get('miller')![i]! }));
  bakers = bakers.map((b, i) => ({ ...b, slot: byRole.get('baker')![i]! }));
  couriers = couriers.map((c, i) => {
    const slot = byRole.get('courier')![i]!;
    return courierJustFilled.has(c.buildingId) ? { ...c, slot, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(c.buildingId) } : { ...c, slot };
  });
  investigators = investigators.map((d, i) => {
    const slot = byRole.get('investigator')![i]!;
    return investigatorJustFilled.has(d.buildingId) ? { ...d, slot, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(d.buildingId) } : { ...d, slot };
  });
  importExporters = importExporters.map((x, i) => {
    const slot = byRole.get('importExport')![i]!;
    return importExportJustFilled.has(x.buildingId) ? { ...x, slot, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(x.buildingId) } : { ...x, slot };
  });

  // Grifter pool bookkeeping: age everyone still waiting by one day, then apply today's
  // events in the exact order stepMultiRoleConscriptionDay produced them. A fill or
  // grifter-sourced conscription pops whoever has waited LONGEST — a real, simulate-able
  // policy (not left unspecified) that directly answers "the effect of grifters being
  // under the floor until they obtain a role."
  grifters = grifters.map((g) => ({ ...g, daysAsGrifter: g.daysAsGrifter + 1 }));
  // Experience-floor queues (2026-08-13, engine/experienceFloor.ts): for each Miller/Baker
  // fill this tick, capture the REMOVED grifter's real role-specific Shift Cover history
  // BEFORE they're popped from the pool, in event order. Zipped against millerJustFilled/
  // bakerJustFilled (in slot-array order) below — the same order-based pairing discipline
  // `justFilledSet` itself already relies on, not a new kind of assumption.
  const millerFloorQueue: number[] = [];
  const bakerFloorQueue: number[] = [];
  for (const event of conscriptionResult.events) {
    if (event.type === 'churn') {
      grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0, x: world.shard.hubPlot.x, y: world.shard.hubPlot.y }];
      nextGrifterId += 1;
    } else if (event.type === 'genuineFill') {
      // Reputation-gated (2026-08-13): pick a real eligible grifter (level >= this role's
      // requirement). Prefers the LOWEST eligible level first (longest-wait within that
      // level), exactly matching stepMultiRoleConscriptionDay's own internal
      // `consumeFromLowestLevel` assumption for THIS event type too — the same "the two
      // views of the pool must agree by construction" fix already applied to
      // `conscriptionFromGrifters` below (found as a real 15-vs-14 conservation bug there;
      // this branch had the identical latent mismatch, caught by inspection while measuring
      // the level-2 reachability numbers, not by a second reproduced failure — fixed
      // proactively rather than waiting for it to surface). This also does real, useful
      // work beyond correctness: a level-1-gated fill no longer risks spending a rare
      // level-2 grifter when a level-1 grifter was equally eligible, reserving scarce
      // higher-level grifters for the roles that actually need them.
      // `eligible.length === 0` should never happen given the above — the `> 0` guard stays
      // as a defensive fallback regardless (fails safe: skips the removal rather than
      // crashing or picking an ineligible grifter, not a silent zero-state for any player).
      const minLevel = minLevelForRole(event.roleId);
      const eligible = grifters
        .map((g, i) => ({ i, level: reputationLevelForProgress(g.reputationProgress ?? 0), days: g.daysAsGrifter }))
        .filter((o) => o.level >= minLevel);
      if (eligible.length > 0) {
        const lowestEligibleLevel = Math.min(...eligible.map((o) => o.level));
        const atLowestLevel = eligible.filter((o) => o.level === lowestEligibleLevel);
        let longest = atLowestLevel[0]!;
        for (const o of atLowestLevel) if (o.days > longest.days) longest = o;
        if (event.roleId === 'miller') millerFloorQueue.push(grifters[longest.i]!.shiftsCoveredByRole?.miller ?? 0);
        else if (event.roleId === 'baker') bakerFloorQueue.push(grifters[longest.i]!.shiftsCoveredByRole?.baker ?? 0);
        grifters = grifters.filter((_, i) => i !== longest.i);
      }
    } else if (event.type === 'conscriptionFromGrifters') {
      // Bypasses the reputation GATE (never blocked by it — constraint 2,
      // docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.5), but WHICH grifter it picks must
      // still prefer the LOWEST reputation level first (longest-wait within that level),
      // exactly matching stepMultiRoleConscriptionDay's own internal `consumeFromLowestLevel`
      // assumption for this same event type. Real bug found and fixed 2026-08-13: picking
      // pure longest-wait across the WHOLE pool (ignoring level) could consume the one
      // real grifter a LATER role group's gated `genuineFill` was internally counted as
      // still available, silently filling a role's slot with no real grifter left to remove
      // (caught by the population-conservation test — a real 15-vs-14 mismatch). Keeping the
      // two views of the pool (this real selection, and the internal per-level bookkeeping)
      // in exact agreement is what fixes it, not a looser approximation.
      if (grifters.length > 0) {
        const lowestLevel = Math.min(...grifters.map((g) => reputationLevelForProgress(g.reputationProgress ?? 0)));
        let longestIdx = -1;
        for (let i = 0; i < grifters.length; i++) {
          if (reputationLevelForProgress(grifters[i]!.reputationProgress ?? 0) !== lowestLevel) continue;
          if (longestIdx === -1 || grifters[i]!.daysAsGrifter > grifters[longestIdx]!.daysAsGrifter) longestIdx = i;
        }
        if (longestIdx >= 0) {
          if (event.roleId === 'miller') millerFloorQueue.push(grifters[longestIdx]!.shiftsCoveredByRole?.miller ?? 0);
          else if (event.roleId === 'baker') bakerFloorQueue.push(grifters[longestIdx]!.shiftsCoveredByRole?.baker ?? 0);
        }
        grifters = grifters.filter((_, i) => i !== longestIdx);
      }
    }
    // conscriptionFromOtherRole / backstopFires: no grifter-pool change — that player
    // moves directly between roles, or the slot stays mechanically covered.
  }

  // Zip the floor queues (event order) against the actual newly-FILLED buildingIds (slot-
  // array order, from justFilledSet above) — cardinality matches by construction, since
  // every genuineFill/conscriptionFromGrifters event for a role corresponds to exactly one
  // newly-FILLED slot in that role's array this same tick.
  const millerExperienceFloor = new Map<string, number>();
  [...millerJustFilled].forEach((buildingId, i) => {
    if (millerFloorQueue[i] !== undefined) millerExperienceFloor.set(buildingId, experienceFloorFromShiftsCovered(millerFloorQueue[i]!));
  });
  const bakerExperienceFloor = new Map<string, number>();
  [...bakerJustFilled].forEach((buildingId, i) => {
    if (bakerFloorQueue[i] !== undefined) bakerExperienceFloor.set(buildingId, experienceFloorFromShiftsCovered(bakerFloorQueue[i]!));
  });

  // Forced 2-week deadline draft (2026-08-11): any grifter whose consolidation window has
  // expired must be placed into an open role today if one exists anywhere — "2 weeks to
  // gain a role or be drafted." Runs AFTER ordinary conscription above (so a
  // self-selected voluntary fill during the 2 weeks always takes priority) and bypasses
  // the ordinary probabilistic machinery entirely — this is a hard deadline, not another
  // hazard roll. Excess overdue grifters beyond however many slots are open simply stay
  // overdue (their deadline has already passed, so they claim the very next slot that
  // opens, on any future tick, with no re-arming needed) — not a permanent-zero-state
  // violation, since GRIFTER_DAILY_INCOME keeps accruing to them meanwhile.
  const overdue = grifters.filter((g) => g.consolidationDeadline !== undefined && day >= g.consolidationDeadline);
  if (overdue.length > 0) {
    const openSlots: { role: RoleType; index: number }[] = [];
    millers.forEach((m, i) => {
      if (m.slot.state === 'VACANT') openSlots.push({ role: 'miller', index: i });
    });
    bakers.forEach((b, i) => {
      if (b.slot.state === 'VACANT') openSlots.push({ role: 'baker', index: i });
    });
    couriers.forEach((c, i) => {
      if (c.slot.state === 'VACANT') openSlots.push({ role: 'courier', index: i });
    });
    investigators.forEach((d, i) => {
      if (d.slot.state === 'VACANT') openSlots.push({ role: 'investigator', index: i });
    });
    importExporters.forEach((x, i) => {
      if (x.slot.state === 'VACANT') openSlots.push({ role: 'importExport', index: i });
    });

    const placedGrifterIds = new Set<string>();
    const placeCount = Math.min(overdue.length, openSlots.length);
    for (let k = 0; k < placeCount; k++) {
      const grifter = overdue[k]!;
      const target = openSlots[k]!;
      placedGrifterIds.add(grifter.id);
      const fill = { state: 'FILLED' as const, vacantSince: null };
      if (target.role === 'miller') {
        millers = millers.map((m, i) => (i === target.index ? { ...m, slot: fill, value: 0.3 + rng() * 0.2, experience: 0, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(m.buildingId) } : m));
      } else if (target.role === 'baker') {
        bakers = bakers.map((b, i) => (i === target.index ? { ...b, slot: fill, value: 0.5 + rng() * 0.2, experience: 0, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(b.buildingId) } : b));
      } else if (target.role === 'courier') {
        couriers = couriers.map((c, i) => (i === target.index ? { ...c, slot: fill, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(c.buildingId) } : c));
      } else if (target.role === 'investigator') {
        investigators = investigators.map((d, i) => (i === target.index ? { ...d, slot: fill, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(d.buildingId) } : d));
      } else {
        importExporters = importExporters.map((x, i) => (i === target.index ? { ...x, slot: fill, wealth: 0, ...emptySlotStock(), daysInRole: 0, ...arriveAt(x.buildingId) } : x));
      }
    }
    if (placedGrifterIds.size > 0) grifters = grifters.filter((g) => !placedGrifterIds.has(g.id));
  }

  // ---- Stage 3: market (Miller then Baker, then support-role wage + grifter floor) ---
  const noise = () => gaussian(rng, config.noiseSigma);
  millers = stepCompetitiveLayer(
    millers,
    millerJustFilled,
    (values) => stepMillers(values, noise),
    () => 0.3 + rng() * 0.2,
    millerExperienceFloor,
    allBuildingsById,
  );

  // BACKSTOPPED millers participate mechanically, not competitively — this is the
  // specific unwired gap the spec named. See computeMillerSupply()'s doc comment.
  // ---- Grain supply gate (2026-08-11) — Millers finally have a raw-material input -----
  // Import/Export receives nodules daily and automatically (no player action required —
  // "automated to the miller if offline"), converting them to grain. Millers can only
  // realize as much flour as grain allows. Deliberate split: the grain factor constrains
  // REALIZED output, not the Cournot best-response dynamics themselves, so millers.ts's
  // validated convergence behaviour is untouched while grain becomes a real bite. A
  // BACKSTOPPED Import/Export still supplies a reduced-but-real share (constraint 2 — an
  // unstaffed Import/Export squeezes the shard, it can never mill it to a dead stop).
  const ieFilled = importExporters.filter((x) => x.slot.state === 'FILLED').length;
  const ieBackstopped = importExporters.filter((x) => x.slot.state === 'BACKSTOPPED').length;
  const nodulesReceived = nodulesReceivedToday(ieFilled, ieBackstopped, DAILY_ACTIVITY_MULTIPLIER);
  const grainAvailable = grainDeliveredToday(ieFilled, ieBackstopped, DAILY_ACTIVITY_MULTIPLIER);
  // The basic day (2026-08-24) — same total nodules/grain as above, now reported as two real
  // UTC-anchored window events instead of one blended daily number. See dayCycle.ts's header.
  const importExportWindows = importExportWindowEvents(nodulesReceived, grainAvailable);
  const intendedMillerSupply = computeMillerSupply(millers);
  const grainDemanded = intendedMillerSupply * DAILY_ACTIVITY_MULTIPLIER * GRAIN_PER_FLOUR;
  const grainFactor = millingCapacityFactor(grainAvailable, grainDemanded);

  const millerSupply = intendedMillerSupply * grainFactor;
  const flourPriceValue = computeFlourPrice(millerSupply);

  bakers = stepCompetitiveLayer(
    bakers,
    bakerJustFilled,
    (values) => stepBakers(values, flourPriceValue, config.gamma, noise),
    () => 0.5 + rng() * 0.2,
    bakerExperienceFloor,
    allBuildingsById,
  );

  // Wealth accrual (2026-08-10, user-requested; demand model + downtime window revised
  // 2026-08-11; support-role wage + grifter floor added 2026-08-11) — the stock variable
  // wealth.ts adds on top of the market's existing flow variables. A Miller sells its whole
  // quantity at the market-clearing flour price. A Baker earns margin-over-flour-cost times
  // however many customers it actually served today — served-customer counts come from
  // splitBakerDemand(), which bounds total daily demand by population (not baker count),
  // dilutes it by a multi-day purchase cycle, splits it toward whoever's priced lower, and
  // caps any one baker's daily customers at a realistic ceiling. BACKSTOPPED slots earn
  // nothing — nobody is there to receive it. Every income stream is scaled by
  // DAILY_ACTIVITY_MULTIPLIER — the daily blended consequence of two 4-hour throttle windows
  // every day (2026-08-11 downtime + 2026-08-12 addendum item 8, one mechanism), "all round."
  // See wealth.ts's header for the full reasoning.
  //
  // Trade-route friction (2026-08-11) — "underpopulated areas can't access certain
  // services without greater effort": a role-holder physically in a CONSOLIDATING or
  // MERGED district earns proportionally less, ramping down across the district's own
  // grace period. This is the "cracks forming" made felt, not just visible — real pressure
  // to relocate into the consolidated half before being forced to, and grifters have no
  // fixed position in this model (same flagged simplification as everywhere else in this
  // file) so friction only applies to role-holders with a building, not the grifter floor.
  const frictionFor = (buildingId: string): number => {
    const districtId = buildingDistrictId.get(buildingId);
    if (!districtId) return 1;
    return consolidationFrictionMultiplier(districtHealth[districtId]!, day);
  };

  const millerIncomes = millers.map((m) =>
    m.slot.state === 'FILLED'
      ? millerDailyIncome(m.value * grainFactor, flourPriceValue) * DAILY_ACTIVITY_MULTIPLIER * frictionFor(m.buildingId)
      : 0,
  );

  const bakerFilledForDemand = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
  const dueCustomers =
    config.purchaseCycleDays !== undefined
      ? dailyDueCustomers(world.population, config.purchaseCycleDays)
      : dailyDueCustomers(world.population);
  const servedCustomers = splitBakerDemand(
    bakerFilledForDemand.map((i) => bakers[i]!.value),
    dueCustomers,
  );
  const bakerIncomes = bakers.map((b, i) => {
    const pos = bakerFilledForDemand.indexOf(i);
    if (pos < 0) return 0;
    return bakerDailyIncome(b.value, flourPriceValue, servedCustomers[pos]!) * DAILY_ACTIVITY_MULTIPLIER * frictionFor(b.buildingId);
  });

  // ---- Stage 3a-2: role completion, Miller/Baker half (2026-08-11, item 4) -------------
  // Folded into the income FLOW here (not applied to wealth directly further down), so a
  // completion bonus is taxed/redistributed and wealth-capped exactly like every other
  // wealth increment — applying it after either step would silently poke a hole through a
  // supposedly hard bound, or dodge a tax every other unit of income pays. See
  // roleCompletion.ts's header for why each role's completion condition is what it is; the
  // support-role half of this same stats object is completed further down (Stage 3c), after
  // their own wage accrual, since wealthCap/tax never apply to those four roles anyway.
  const completionStatsWorking: Record<string, CompletionStats> = { ...world.completionStats };
  const resetCompletionIfJustFilled = (buildingId: string, justFilled: Set<string>) => {
    if (justFilled.has(buildingId)) completionStatsWorking[buildingId] = emptyCompletionStats();
  };

  const millerValuesForCompletion = millers.map((m) => m.value);
  const millerCompleted = millers.map((m, i) => {
    if (m.slot.state !== 'FILLED') return false;
    resetCompletionIfJustFilled(m.buildingId, millerJustFilled);
    const completed = millerTaskCompleted(m.value, averageRivalValue(millerValuesForCompletion, i));
    completionStatsWorking[m.buildingId] = recordAttempt(completionStatsWorking[m.buildingId] ?? emptyCompletionStats(), completed);
    return completed;
  });
  const bakerValuesForCompletion = bakers.map((b) => b.value);
  const bakerCompleted = bakers.map((b, i) => {
    if (b.slot.state !== 'FILLED') return false;
    resetCompletionIfJustFilled(b.buildingId, bakerJustFilled);
    const completed = bakerTaskCompleted(b.value, averageRivalValue(bakerValuesForCompletion, i));
    completionStatsWorking[b.buildingId] = recordAttempt(completionStatsWorking[b.buildingId] ?? emptyCompletionStats(), completed);
    return completed;
  });
  const millerIncomesWithCompletion = millerIncomes.map((inc, i) => (millerCompleted[i] ? inc + COMPLETION_REWARD.miller : inc));
  const bakerIncomesWithCompletion = bakerIncomes.map((inc, i) => (bakerCompleted[i] ? inc + COMPLETION_REWARD.baker : inc));

  // Income is computed as a flow first (0 for non-FILLED slots), optionally taxed and
  // redistributed across the combined Miller+Baker FILLED pool (one shared pool, not two
  // separate ones — matches "daily resource allocation" as untargeted and unconditional),
  // THEN accrued onto wealth. The wealth cap, if enabled, then bounds the resulting stock.
  // Both are PROPOSALS, simulated and reported in docs/BLUEPRINT.md, neither shipped as a
  // default, and deliberately scoped to Miller+Baker only — see this file's header note.
  let finalMillerIncomes = millerIncomesWithCompletion;
  let finalBakerIncomes = bakerIncomesWithCompletion;
  if (config.wealthTaxRate > 0) {
    const millerFilledIdx = millers.map((m, i) => (m.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const bakerFilledIdx = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const combinedIncomes = [
      ...millerFilledIdx.map((i) => millerIncomesWithCompletion[i]!),
      ...bakerFilledIdx.map((i) => bakerIncomesWithCompletion[i]!),
    ];
    if (combinedIncomes.length > 0) {
      const afterTax = taxAndRedistributeIncome(combinedIncomes, config.wealthTaxRate);
      finalMillerIncomes = [...millerIncomesWithCompletion];
      finalBakerIncomes = [...bakerIncomesWithCompletion];
      millerFilledIdx.forEach((idx, k) => {
        finalMillerIncomes[idx] = afterTax[k]!;
      });
      bakerFilledIdx.forEach((idx, k) => {
        finalBakerIncomes[idx] = afterTax[millerFilledIdx.length + k]!;
      });
    }
  }

  millers = millers.map((m, i) => (m.slot.state === 'FILLED' ? { ...m, wealth: m.wealth + finalMillerIncomes[i]!, ...stepSlotStock(m) } : m));
  bakers = bakers.map((b, i) => (b.slot.state === 'FILLED' ? { ...b, wealth: b.wealth + finalBakerIncomes[i]!, ...stepSlotStock(b) } : b));

  if (config.wealthCap !== undefined) {
    const millerFilledIdx = millers.map((m, i) => (m.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const bakerFilledIdx = bakers.map((b, i) => (b.slot.state === 'FILLED' ? i : -1)).filter((i) => i >= 0);
    const combinedWealth = [...millerFilledIdx.map((i) => millers[i]!.wealth), ...bakerFilledIdx.map((i) => bakers[i]!.wealth)];
    if (combinedWealth.length > 0) {
      const capped = applyWealthCap(combinedWealth, config.wealthCap);
      millers = millers.map((m, i) => {
        const pos = millerFilledIdx.indexOf(i);
        return pos >= 0 ? { ...m, wealth: capped[pos]! } : m;
      });
      bakers = bakers.map((b, i) => {
        const pos = bakerFilledIdx.indexOf(i);
        return pos >= 0 ? { ...b, wealth: capped[millerFilledIdx.length + pos]! } : b;
      });
    }
  }

  // Support-role wage and grifter floor — uncapped, untaxed (see header scoping note).
  // Support wages get the same trade-route friction as Miller/Baker; the grifter floor
  // doesn't (grifters have no fixed position — see frictionFor's own comment above).
  const supportDaily = SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_MULTIPLIER;
  // Courier pay (2026-08-11 addendum item 6) is distance-indexed, not the flat support wage
  // — see engine/courierPay.ts's header for the full reasoning, including why a literal
  // commissioner-debit was measured and deliberately NOT built at this scale.
  couriers = couriers.map((c) =>
    c.slot.state === 'FILLED'
      ? {
          ...c,
          wealth:
            c.wealth +
            courierDailyPay(courierRouteDistance({ x: c.x, y: c.y }, world.shard.hubPlot), DAILY_ACTIVITY_MULTIPLIER, frictionFor(c.buildingId)),
          ...stepSlotStock(c),
          daysInRole: c.daysInRole + 1,
        }
      : c,
  );
  investigators = investigators.map((d) => (d.slot.state === 'FILLED' ? { ...d, wealth: d.wealth + supportDaily * frictionFor(d.buildingId), ...stepSlotStock(d), daysInRole: d.daysInRole + 1 } : d));
  importExporters = importExporters.map((x) => (x.slot.state === 'FILLED' ? { ...x, wealth: x.wealth + supportDaily * frictionFor(x.buildingId), ...stepSlotStock(x), daysInRole: x.daysInRole + 1 } : x));
  grifters = grifters.map((g) => ({ ...g, wealth: g.wealth + GRIFTER_DAILY_INCOME * DAILY_ACTIVITY_MULTIPLIER }));

  // Shift Cover (2026-08-11 addendum item 7) — every BACKSTOPPED slot across all six roles is
  // a real opportunity for a grifter to notice and cover for the day, at
  // SHIFT_COVER_FRACTION of what that exact slot would have earned genuinely FILLED that
  // exact day. See engine/shiftCover.ts's header for why this is the honest reshaping of the
  // brief's session-based §2.6, and why "worse than holding the role properly" is structural
  // (fraction < 1) rather than a separately-measured constant.
  const meanOf = (vals: readonly number[]) => {
    const positive = vals.filter((v) => v > 0);
    return positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : 0;
  };
  const meanFilledMillerIncome = meanOf(millerIncomes);
  const meanFilledBakerIncome = meanOf(bakerIncomes);
  // Each opportunity now carries which role it's covering (2026-08-13,
  // engine/experienceFloor.ts) — needed so a successful cover can credit that SPECIFIC
  // role in the grifter's `shiftsCoveredByRole`, not just the flat `reputationProgress`
  // counter. Payout math is completely unchanged; only the role tag is new.
  const shiftCoverOpportunities: Array<{ role: RoleType; payout: number }> = [];
  millers.forEach((m) => {
    if (m.slot.state === 'BACKSTOPPED') shiftCoverOpportunities.push({ role: 'miller', payout: meanFilledMillerIncome });
  });
  bakers.forEach((b) => {
    if (b.slot.state === 'BACKSTOPPED') shiftCoverOpportunities.push({ role: 'baker', payout: meanFilledBakerIncome });
  });
  couriers.forEach((c) => {
    if (c.slot.state === 'BACKSTOPPED') {
      const dist = courierRouteDistance({ x: c.x, y: c.y }, world.shard.hubPlot);
      shiftCoverOpportunities.push({ role: 'courier', payout: courierDailyPay(dist, DAILY_ACTIVITY_MULTIPLIER, frictionFor(c.buildingId)) });
    }
  });
  investigators.forEach((d) => {
    if (d.slot.state === 'BACKSTOPPED') shiftCoverOpportunities.push({ role: 'investigator', payout: supportDaily * frictionFor(d.buildingId) });
  });
  importExporters.forEach((x) => {
    if (x.slot.state === 'BACKSTOPPED') shiftCoverOpportunities.push({ role: 'importExport', payout: supportDaily * frictionFor(x.buildingId) });
  });
  const noticedIdx = shiftCoverNoticedIndices(shiftCoverOpportunities.length, grifters.length, rng);
  if (noticedIdx.length > 0) {
    // Grifters racing toward level 2 (exactly level 1) get first pick, closest-to-the-
    // threshold first; everyone else falls back to the original "neediest (lowest wealth)
    // first" rule — deterministic, no scheduler, no per-grifter notice draw beyond the
    // aggregate noticedIdx above. See `engine/shiftCover.ts`'s
    // `orderGrifterCandidatesForNotice` doc comment for the full reasoning (2026-08-18,
    // tackles the level-2 reputation gate).
    const grifterOrder = orderGrifterCandidatesForNotice(grifters).slice(0, noticedIdx.length);
    const payouts = noticedIdx.map((idx) => shiftCoverPay(shiftCoverOpportunities[idx]!.payout));
    grifters = grifters.map((g, i) => {
      const pos = grifterOrder.indexOf(i);
      if (pos < 0) return g;
      // A successful cover also earns one reputation progress-tick (2026-08-13,
      // docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §3.3/§2.1) — the SAME once-per-
      // BACKSTOPPED-slot-per-day cap that already governs the pay itself IS the anti-grind
      // limiter here; no separate reputation-specific rate limit needed. It also now credits
      // the SPECIFIC role covered (engine/experienceFloor.ts) — real practice this grifter
      // can draw an experience head-start from if they later take over that same role.
      const role = shiftCoverOpportunities[noticedIdx[pos]!]!.role;
      const shiftsCoveredByRole = { ...g.shiftsCoveredByRole, [role]: (g.shiftsCoveredByRole?.[role] ?? 0) + 1 };
      return { ...g, wealth: g.wealth + payouts[pos]!, reputationProgress: (g.reputationProgress ?? 0) + 1, shiftsCoveredByRole };
    });
  }

  // The Oracle (2026-08-18, docs/DESIGN_ORACLE_2026-08-13.md) — first code for a mechanic
  // specified since 2026-08-06 but never built. A daily, flat-odds draw for every grifter and
  // every FILLED role slot: independent Bernoulli "did they choose to enter" (no real
  // per-player session to read, same modeling convention Shift Cover's own "noticing" already
  // uses), then — only if they can afford ORACLE_ENTRY_COST — an independent win roll at
  // odds tied to YESTERDAY's real economicHealthWithExperience (today's isn't computed yet at
  // this point in the tick). A win grants exactly one prize, drawn only from what this exact
  // candidate already has real access to (see engine/oracle.ts's header for why that's what
  // keeps this from ever being a route to a role, a reputation level, or a solo-assembled
  // crafting recipe).
  const oracleStats: OracleTickStats = { entrants: 0, entered: 0, wins: 0, winsByPrize: { wealth: 0, resourceStock: 0, time: 0 } };
  {
    const winProbability = oracleWinProbability(world.economicHealthWithExperience);
    const applyOracleRoll = <T extends { wealth: number }>(entrant: T, isGrifter: boolean): T => {
      if (rng() >= ORACLE_PARTICIPATION_PROBABILITY) return entrant;
      oracleStats.entrants++;
      if (entrant.wealth < ORACLE_ENTRY_COST) return entrant;
      oracleStats.entered++;
      const afterEntry = { ...entrant, wealth: entrant.wealth - ORACLE_ENTRY_COST };
      if (rng() >= winProbability) return afterEntry;
      oracleStats.wins++;
      const prize = pickPrizeType(isGrifter, rng);
      oracleStats.winsByPrize[prize]++;
      if (prize === 'wealth') return { ...afterEntry, wealth: afterEntry.wealth + ORACLE_WEALTH_PRIZE_AMOUNT };
      if (prize === 'resourceStock' && 'personalResourceStock' in afterEntry) {
        const s = afterEntry as unknown as { personalResourceStock: number };
        return { ...afterEntry, personalResourceStock: Math.min(PERSONAL_RESOURCE_CAP, s.personalResourceStock + ORACLE_RESOURCE_STOCK_PRIZE_AMOUNT) };
      }
      if (prize === 'time') {
        if (isGrifter && 'daysAsGrifter' in afterEntry) {
          const g = afterEntry as unknown as { daysAsGrifter: number };
          return { ...afterEntry, daysAsGrifter: g.daysAsGrifter + ORACLE_TIME_NUDGE_DAYS };
        }
        if (!isGrifter && 'daysInRole' in afterEntry) {
          const s = afterEntry as unknown as { daysInRole: number };
          return { ...afterEntry, daysInRole: s.daysInRole + ORACLE_TIME_NUDGE_DAYS };
        }
      }
      return afterEntry; // ineligible prize type rolled for this candidate shape — entry cost still applies, no prize wasted on nobody
    };
    grifters = grifters.map((g) => applyOracleRoll(g, true));
    const rollRole = <T extends { slot: RoleSlot; wealth: number }>(s: T): T => (s.slot.state === 'FILLED' ? applyOracleRoll(s, false) : s);
    millers = millers.map(rollRole);
    bakers = bakers.map(rollRole);
    couriers = couriers.map(rollRole);
    investigators = investigators.map(rollRole);
    importExporters = importExporters.map(rollRole);
  }

  // Named per-role resource flows (2026-08-11). Miller/Baker figures are the quantities
  // those layers ALREADY computed above (Cournot quantity, served customers) — named and
  // recorded here, never recomputed or second-guessed. Support roles contribute their own
  // trade-route friction, so a Courier in a declining district really does move fewer
  // parcels, the same consequence their income already takes. See engine/resources.ts.
  const supportFriction = (arr: SupportRoleSlot[]) =>
    arr.filter((s2) => s2.slot.state === 'FILLED').map((s2) => frictionFor(s2.buildingId));
  const resources = accumulate(
    world.resources,
    stepResourceFlows(
      millers.filter((m) => m.slot.state === 'FILLED').map((m) => m.value * grainFactor),
      servedCustomers,
      supportFriction(couriers),
      supportFriction(investigators),
      DAILY_ACTIVITY_MULTIPLIER,
      grainAvailable,
      nodulesReceived,
    ),
  );

  // ---- Stage 3c: role completion, support-role half (2026-08-11, item 4) ---------------
  // Same completionStatsWorking object the Miller/Baker half above already started —
  // continues it rather than keeping two separate ledgers. Placed after the support wage
  // accrual above (Stage 3), since wealthCap never applies to these four roles — no
  // ordering hazard to guard against here the way there was for Miller/Baker.
  {
    // No tax/cap system touches these four roles at all (see header scoping note above),
    // so — unlike the Miller/Baker half — applying the reward straight to wealth here,
    // rather than folding it into a taxed/capped income flow, is not a hole through
    // anything: there is no bound here for it to poke through.
    const grantIfTaskCompleted = <T extends { wealth: number }>(slot: T, completed: boolean, reward: number): T =>
      completed ? { ...slot, wealth: slot.wealth + reward } : slot;
    const supportRoleCompletion = <T extends { slot: RoleSlot; buildingId: string; wealth: number }>(
      arr: T[],
      justFilled: Set<string>,
      reward: number,
    ): T[] =>
      arr.map((s) => {
        if (s.slot.state !== 'FILLED') return s;
        resetCompletionIfJustFilled(s.buildingId, justFilled);
        const completed = supportTaskCompleted(frictionFor(s.buildingId));
        completionStatsWorking[s.buildingId] = recordAttempt(completionStatsWorking[s.buildingId] ?? emptyCompletionStats(), completed);
        return grantIfTaskCompleted(s, completed, reward);
      });
    couriers = supportRoleCompletion(couriers, courierJustFilled, COMPLETION_REWARD.courier);
    investigators = supportRoleCompletion(investigators, investigatorJustFilled, COMPLETION_REWARD.investigator);
    importExporters = supportRoleCompletion(importExporters, importExportJustFilled, COMPLETION_REWARD.importExport);
  }
  const completionStats: Readonly<Record<string, CompletionStats>> = completionStatsWorking;

  // ---- Stage 4: ecosystem (sabotage -> arrivals -> migration, then health/experience) --
  // Sabotage-before-arrival order matches design/tick_order_check.py's own validated
  // finding — checked before choosing this order, not reinvented.
  let population = world.population;
  let lastSabotage: SabotageLogEntry | null = null;
  let sabotageCampaigns: SabotageCampaign[] = world.sabotageCampaigns;
  let nextCampaignId = world.nextCampaignId;

  // Sabotage opportunity arrives as a HAZARD, not on a clock (2026-08-11). It previously
  // fired on `day % sabotageCadenceDays === 0` — a covert mechanic running on a public
  // timetable, which any player tracking dates would learn within a couple of cycles and
  // could then plan around or exploit. That directly contradicts the treatment already
  // given to interception in `importExport.ts` (stateless, jittered, "no pattern to learn
  // because nothing persistent generates one"); this is the same principle applied to
  // timing rather than to probability. Expected frequency is unchanged — a 1/cadence daily
  // hazard has the same mean interval as a fixed cadence — so no calibration moves; only
  // predictability is removed.
  // SABOTAGE AS PERSISTENT CAMPAIGNS (restructured 2026-08-18). Pattern-based sabotage is now
  // the shipped model, replacing `sabotageAttempt`'s one-shot resolve. See
  // `engine/sabotageCampaign.ts` for why this had to become multi-tick state rather than a
  // swap of one resolver for another: a campaign resolved inside a single call has no "mid",
  // so nothing — Investigator, player, or the node emptying out around it — can intervene partway.
  //
  // `config.acquireDays` and `config.damagePerSuccess` are no longer read here. They still
  // describe the legacy resolver, which `sim/ecosystemHarness.ts` continues to exercise, so
  // they stay on `WorldConfig` rather than being deleted out from under it.
  const sabotageEvents: SabotageCampaignEvent[] = [];
  {
    const occupantsForWitness = [
      ...occupantsOf(millers),
      ...occupantsOf(bakers),
      ...occupantsOf(couriers),
      ...occupantsOf(investigators),
    ];
    const witnessesAround = (buildingId: string): number => {
      const b = allBuildingsById.get(buildingId);
      if (!b) return 0;
      return occupantsWithin(world.shard, occupantsForWitness.filter((o) => o.playerId !== buildingId), b, config.witnessRadius).length;
    };

    // Who, if anyone, is investigating each campaign. Mechanical and re-evaluated every tick:
    // a FILLED Investigator in the target's own district. That is a real, observable fact — not a
    // modelled intent (constraint 3) — and it is deliberately a REPLACEABLE ASSIGNMENT RULE:
    // the flashlight, when built, changes who fills `investigatedBy`, nothing downstream of it.
    const filledInvestigatorByDistrict = new Map<string, string>();
    for (const d of investigators) {
      if (d.slot.state !== 'FILLED') continue;
      const districtId = buildingDistrictId.get(d.buildingId);
      if (districtId && !filledInvestigatorByDistrict.has(districtId)) filledInvestigatorByDistrict.set(districtId, d.buildingId);
    }

    const currentlyFilled = new Set(
      filledEntries({ millers, bakers, couriers, investigators, importExporters }).map((e) => e.buildingId),
    );

    const stillRunning: SabotageCampaign[] = [];
    for (const existing of world.sabotageCampaigns) {
      // ABANDON a campaign whose target already left. Found by watching a real run: a campaign
      // opened on day 2 was still grinding away on day ~45 at a slot whose occupant had churned
      // out on day 13 — burning six weeks and one of only `saboteurCount` campaign slots to
      // force out somebody who had already gone. The mechanic is "force a role-holder out of
      // their own shop"; with nobody in the shop there is nothing to force.
      if (!currentlyFilled.has(existing.targetBuildingId)) {
        sabotageEvents.push({
          tick: day,
          type: 'abandoned',
          campaignId: existing.id,
          targetBuildingId: existing.targetBuildingId,
          saboteurId: existing.saboteurId,
          atStep: existing.stepsCompleted,
          witnesses: witnessesAround(existing.targetBuildingId),
        });
        continue;
      }
      const targetDistrict = buildingDistrictId.get(existing.targetBuildingId);
      const campaign: SabotageCampaign = {
        ...existing,
        investigatedBy: (targetDistrict ? filledInvestigatorByDistrict.get(targetDistrict) : undefined) ?? null,
      };

      const outcome = stepCampaign(campaign, day, witnessesAround(campaign.targetBuildingId), rng);
      if (!outcome) {
        stillRunning.push(campaign); // not due this tick
        continue;
      }

      if (outcome.type === 'caught') {
        sabotageEvents.push({
          tick: day,
          type: 'caught',
          campaignId: campaign.id,
          targetBuildingId: campaign.targetBuildingId,
          saboteurId: campaign.saboteurId,
          atStep: outcome.atStep,
          witnesses: witnessesAround(campaign.targetBuildingId),
        });
        // NO CONSEQUENCE IS APPLIED TO A CAUGHT SABOTEUR — `ecosystem.ts` has carried that as a
        // KNOWN GAP for both resolvers, and it stays open deliberately rather than being
        // invented here. What this restructure DOES change is that there is now a `saboteurId`
        // to apply one to; the consequence itself (abode lockout, the Oracle unlock, the walk
        // of shame at the Wall, the fine) is a design still being settled.
        continue;
      }

      if (outcome.type === 'advanced') {
        stillRunning.push(outcome.campaign);
        continue;
      }

      // Succeeded: the target itself is evicted — unlike the legacy resolver, which counted
      // successes and then evicted a RANDOM set of slots that need not have included the slot
      // it rolled witnesses against. A campaign now costs the slot it was actually run against.
      const target = filledEntries({ millers, bakers, couriers, investigators, importExporters }).find(
        (e) => e.buildingId === outcome.campaign.targetBuildingId,
      );
      if (target) {
        grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0, x: world.shard.hubPlot.x, y: world.shard.hubPlot.y }];
        nextGrifterId += 1;
        const evict = { state: 'BACKSTOPPED' as const, vacantSince: day };
        if (target.role === 'miller') millers = millers.map((m, i) => (i === target.index ? { ...m, slot: evict } : m));
        else if (target.role === 'baker') bakers = bakers.map((b, i) => (i === target.index ? { ...b, slot: evict } : b));
        else if (target.role === 'courier') couriers = couriers.map((c, i) => (i === target.index ? { ...c, slot: evict } : c));
        else if (target.role === 'investigator') investigators = investigators.map((d, i) => (i === target.index ? { ...d, slot: evict } : d));
        else importExporters = importExporters.map((x, i) => (i === target.index ? { ...x, slot: evict } : x));
      }
      const witnesses = witnessesAround(outcome.campaign.targetBuildingId);
      sabotageEvents.push({
        tick: day,
        type: 'succeeded',
        campaignId: outcome.campaign.id,
        targetBuildingId: outcome.campaign.targetBuildingId,
        saboteurId: outcome.campaign.saboteurId,
        atStep: outcome.campaign.stepsCompleted,
        witnesses,
      });
      lastSabotage = {
        tick: day,
        targetBuildingId: outcome.campaign.targetBuildingId,
        witnesses,
        successfulSaboteurs: 1, // a campaign is one saboteur's work, not a count of attackers
        evicted: target ? 1 : 0,
      };
    }

    // OPENING is where the hazard now lives — the same daily 1/cadence roll, and the same
    // reasoning as before (2026-08-11: a covert mechanic must not run on a public timetable).
    // What it produces changed: a campaign that will take real days, not an instant resolution.
    // `config.saboteurCount` caps how many run at once — that is exactly what "how many
    // saboteurs are active" already meant, so it is reused rather than a new constant added.
    if (day > 0 && stillRunning.length < config.saboteurCount && rng() < 1 / config.sabotageCadenceDays) {
      const filled = filledEntries({ millers, bakers, couriers, investigators, importExporters }).filter(
        (e) => !stillRunning.some((c) => c.targetBuildingId === e.buildingId),
      );
      if (filled.length > 0) {
        const target = filled[Math.floor(rng() * filled.length)]!;
        const campaign = openCampaign(`sab-${day}-${nextCampaignId}`, target.buildingId, day, null);
        nextCampaignId += 1;
        stillRunning.push(campaign);
        sabotageEvents.push({
          tick: day,
          type: 'opened',
          campaignId: campaign.id,
          targetBuildingId: campaign.targetBuildingId,
          saboteurId: null,
          atStep: 0,
          witnesses: witnessesAround(campaign.targetBuildingId),
        });
      }
    }

    sabotageCampaigns = stillRunning;
  }

  let lastNewArrivals = 0;
  if (rng() < config.arrivalPDaily) {
    population += 1;
    lastNewArrivals = 1;
    grifters = [...grifters, { id: `grifter-${nextGrifterId}`, wealth: 0, daysAsGrifter: 0, x: world.shard.hubPlot.x, y: world.shard.hubPlot.y }];
    nextGrifterId += 1;
  }

  const preEmigrationFilledCount = filledEntries({ millers, bakers, couriers, investigators, importExporters }).length;
  // Opportunity-adjusted (2026-08-11): open role-slots damp emigration, so a thinning
  // shard becomes genuinely worth staying in and recovers — the negative feedback the
  // plain roleless-fraction valve never had. See ecosystem.ts's own doc comment.
  const emigrants = opportunityAdjustedMigrationStep(
    population,
    preEmigrationFilledCount,
    totalRoleSlotsFor(config),
    rng,
    config.migrationTheta,
    config.migrationK,
    config.opportunityWeight,
  );
  const actualEmigrants = Math.min(emigrants, population);
  for (let k = 0; k < actualEmigrants; k++) {
    if (grifters.length > 0) {
      // Emigration draws from the grifter pool first — someone with no role yet is the
      // least invested, and this is what keeps population exactly conserved without ever
      // touching a role-holder's slot unless there's truly nobody roleless left to leave.
      const idx = Math.floor(rng() * grifters.length);
      grifters = grifters.filter((_, i) => i !== idx);
    } else {
      const filled = filledEntries({ millers, bakers, couriers, investigators, importExporters });
      if (filled.length > 0) {
        const pick = filled[Math.floor(rng() * filled.length)]!;
        const vacate = { state: 'VACANT' as const, vacantSince: day };
        if (pick.role === 'miller') millers = millers.map((m, i) => (i === pick.index ? { ...m, slot: vacate } : m));
        else if (pick.role === 'baker') bakers = bakers.map((b, i) => (i === pick.index ? { ...b, slot: vacate } : b));
        else if (pick.role === 'courier') couriers = couriers.map((c, i) => (i === pick.index ? { ...c, slot: vacate } : c));
        else if (pick.role === 'investigator') investigators = investigators.map((d, i) => (i === pick.index ? { ...d, slot: vacate } : d));
        else importExporters = importExporters.map((x, i) => (i === pick.index ? { ...x, slot: vacate } : x));
      }
    }
  }
  population = Math.max(0, population - actualEmigrants);

  const totalRoleSlots = totalRoleSlotsFor(config);
  const finalFilledCount = filledEntries({ millers, bakers, couriers, investigators, importExporters }).length;
  const filledExpValues = [...millers, ...bakers].filter((x) => x.slot.state === 'FILLED').map((x) => x.experience);
  const avgExp = filledExpValues.length > 0 ? filledExpValues.reduce((a, b) => a + b, 0) / filledExpValues.length : 0;

  // Wealth-inequality scope widened (2026-08-11) — see this file's header note.
  const allWealthValues = [
    ...millers.filter((m) => m.slot.state === 'FILLED').map((m) => m.wealth),
    ...bakers.filter((b) => b.slot.state === 'FILLED').map((b) => b.wealth),
    ...couriers.filter((c) => c.slot.state === 'FILLED').map((c) => c.wealth),
    ...investigators.filter((d) => d.slot.state === 'FILLED').map((d) => d.wealth),
    ...importExporters.filter((x) => x.slot.state === 'FILLED').map((x) => x.wealth),
    ...grifters.map((g) => g.wealth),
  ];

  // ---- Stage 5: comms (rumour propagation + proximity conversation) ------------------
  // Both share the same real spatial graph — buildingId-keyed occupant positions for every
  // currently-FILLED role slot (see this file's header note on why grifters, with no fixed
  // building position, are out of scope for either). Built unconditionally (cheap, pure, no
  // rng) rather than duplicated per-mechanic.
  const occupants = [
    ...occupantsOf(millers),
    ...occupantsOf(bakers),
    ...occupantsOf(couriers),
    ...occupantsOf(investigators),
    ...occupantsOf(importExporters),
  ];
  const occupantPositionById = new Map(occupants.map((o) => [o.playerId, { x: o.x, y: o.y }]));
  const proximityGraph = buildProximityGraph(occupants, config.commsProximityRange);

  let lastRumourEvents: RumourEventLite[] = [];
  for (const post of world.pendingWallPosts) {
    for (const { id: neighborId, weight } of proximityGraph.neighbors(post.authorId)) {
      const step = stepClarity(1, weight, { baseSuccessChance: 0.6, decayPerStep: 0.3, clarityFloor: 0.15 }, rng);
      if (!step.passed) continue;
      const { value: state, distorted } = applyDistortion(
        post.state,
        {
          distortionRate: 0.25,
          neighbors: {
            isolated: ['distrustful', 'overwhelmed'],
            manipulated: ['exploited', 'suspicious'],
            distrustful: ['suspicious', 'isolated'],
            exploited: ['manipulated', 'overwhelmed'],
            suspicious: ['distrustful', 'manipulated'],
            uneasy: ['suspicious', 'overwhelmed'],
            overwhelmed: ['uneasy', 'isolated'],
            hopeful: ['secure', 'grateful'],
            secure: ['hopeful', 'grateful'],
            grateful: ['hopeful', 'secure'],
          },
        },
        rng,
      );
      lastRumourEvents.push({ heardBy: neighborId, heardFrom: post.authorId, state, distorted, clarity: step.nextClarity });
    }
  }

  // Proximity conversation (`comms/proximityConversation.ts`, wired 2026-08-18). Unprompted-
  // only per `pendingWallPosts`/`pendingDiaryEntries`'s own convention — never generated by
  // `stepWorld` itself. `speakerId` reuses the SAME buildingId-as-identity convention Wall
  // posts already use (`post.authorId`), so "who's present" resolves off the identical
  // `proximityGraph` rather than a second listener-resolution mechanism. Deliberately does
  // NOT touch `identityLedger`, `diary`, or `pressureLedger` — the module's own header is
  // explicit that this channel has no relay path of its own; a player who wants to keep what
  // they heard has to route it back through Wall/Envelope by hand. Ephemeral by the module's
  // own design (no store, nothing to persist) — `lastProximityConversations` reports exactly
  // what happened this tick and nothing accumulates across ticks, same shape as
  // `lastRumourEvents`.
  const lastProximityConversations: ProximityConversationHeardEvent[] = [];
  const lastProximityRejections: Array<{ speakerId: PlayerId; reason: string }> = [];
  for (const pending of world.pendingProximityUtterances) {
    const neighbors = proximityGraph.neighbors(pending.speakerId);
    const presentPlayerIds = new Set(neighbors.map((n) => n.id));
    try {
      const utterance = composeUtterance(
        pending.speakerId,
        pending.intent,
        pending.tone,
        pending.referent,
        day,
        presentPlayerIds,
        pending.context,
      );
      const speakerPos = occupantPositionById.get(pending.speakerId);
      for (const { id: listenerId } of neighbors) {
        const listenerPos = occupantPositionById.get(listenerId);
        if (!speakerPos || !listenerPos) continue; // defensive only — every neighbor came from occupantPositionById's own keys
        const distanceToListener = Math.abs(speakerPos.x - listenerPos.x) + Math.abs(speakerPos.y - listenerPos.y);
        const heard = degradeForListener(utterance, distanceToListener, config.commsProximityRange, [...presentPlayerIds], rng);
        if (heard) lastProximityConversations.push({ listenerId, heard });
      }
    } catch (err) {
      lastProximityRejections.push({ speakerId: pending.speakerId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Design Addendum item 1 (2026-08-11) — the Silhouette Shield's real trigger. Each rumour
  // heard is a real, directional event: neighborId (the hearer) becomes one real encounter
  // closer to resolving post.authorId's (the source's) full identity. The source's own
  // ledger is untouched by this — see identity.ts's header for why this signal, and why it's
  // asymmetric by construction rather than by extra bookkeeping.
  let identityLedger = world.identityLedger;
  for (const event of lastRumourEvents) {
    identityLedger = recordEncounter(identityLedger, event.heardBy, event.heardFrom);
  }

  // Diary writes (wired 2026-08-13, retention model corrected the same day). Unprompted-only
  // per diary.ts's own rule — this only ever processes what a real player queued via
  // `pendingDiaryEntries`, never generates an entry itself. Uses THIS tick's just-updated
  // identityLedger (immediately above) so a SUBJECT resolved by today's own rumour-hearing is
  // writable the same day, not lagged a tick. `diary` is the one mutable exception to this
  // file's snapshot convention — see the `World.diary` field's own doc comment.
  const diary = world.diary;
  const lastDiaryWrites: PlayerId[] = [];
  const lastDiaryRejections: Array<{ authorId: PlayerId; reason: string }> = [];
  for (const entry of world.pendingDiaryEntries) {
    try {
      writeDiaryEntry(diary, entry.authorId, entry.subject, entry.observation, entry.reading, day, resolvedSubjects(identityLedger, entry.authorId), entry.context);
      lastDiaryWrites.push(entry.authorId);
    } catch (err) {
      lastDiaryRejections.push({ authorId: entry.authorId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Design Addendum 2026-08-12, §4/§4.1 — pressure detection. Every Wall post posted today
  // (regardless of whether it propagated to anyone — the pattern being detected is the
  // AUTHOR's own posting behaviour, not who heard it) updates that author's rolling
  // pressure-skew record. Real per-tick state, never a name — see pressureDetection.ts.
  let pressureLedger: Readonly<Record<string, PressureRecord>> = world.pressureLedger;
  for (const post of world.pendingWallPosts) {
    const existing = pressureLedger[post.authorId] ?? emptyPressureRecord();
    pressureLedger = { ...pressureLedger, [post.authorId]: recordPost(existing, day, post.state) };
  }

  // ---- District Weather (2026-08-11 item 0/3; extended 2026-08-12 with the pressure
  // signal above) --------------------------------------------------------------------
  // Reads the SAME fraction/health Stage 1b already computed, whether sabotage landed in a
  // district this tick, and now whether today's UPDATED pressureLedger clears the detection
  // bar for anyone whose building is in that district — no second measurement, no invented
  // signal. Moved to run here (after Stage 5, not right after sabotage as item 0/3 originally
  // had it) specifically so the pressure signal reflects TODAY's posts rather than lagging a
  // full tick; the sabotage/consolidation/vacancy signals are unaffected by the move since
  // none of them change between the old and new position in the tick. Applied to
  // `world.shard` below, which Stage 1's own comment describes as "static geography... Phase
  // B doesn't move anyone" — weather is the one thing that now changes on it every tick.
  const sabotagedDistrictId = lastSabotage ? buildingDistrictId.get(lastSabotage.targetBuildingId) : undefined;
  const pressureContributionByDistrict: Record<string, number> = {};
  for (const [authorId, record] of Object.entries(pressureLedger)) {
    const districtId = buildingDistrictId.get(authorId);
    if (!districtId) continue; // grifters and anyone without a building have no district to register in
    const contribution = pressureContribution(record, knownFraction(identityLedger, authorId));
    if (contribution > (pressureContributionByDistrict[districtId] ?? 0)) {
      pressureContributionByDistrict[districtId] = contribution;
    }
  }
  const localTensions: Record<string, number> = {};
  for (const d of world.shard.districts) {
    localTensions[d.id] = localDistrictTension(
      districtFilledFractionById[d.id] ?? 1,
      districtHealth[d.id]!.state,
      d.id === sabotagedDistrictId,
      pressureContributionByDistrict[d.id] ?? 0,
    );
  }
  const weatherField = districtTensionField(world.shard, localTensions);
  const shardWithWeather = stepDistrictWeather(world.shard, weatherField, day);

  // Stage 1's own header comment already claimed occupancy "feeds district population" —
  // it never actually did; District.population sat at its generation-time 0 forever (real bug,
  // found 2026-08-13 probing the district-topology question: every district read population 0
  // at day 800 across 3 seeds despite world.population tracking correctly). Fixed here, at the
  // same point weatherHistory is finalized, from the FINAL post-tick role-slot state (all six
  // roles, not just the five `allRoleSlotsForHealth` above uses for health/consolidation).
  const allRoleSlotsFinal: { buildingId: string; slot: RoleSlot }[] = [
    ...millers,
    ...bakers,
    ...couriers,
    ...investigators,
    ...importExporters,
  ];
  const districtPopulationById: Record<string, number> = {};
  const filledPlayerIds = new Set<PlayerId>();
  for (const s of allRoleSlotsFinal) {
    if (s.slot.state !== 'FILLED') continue;
    filledPlayerIds.add(s.buildingId);
    const districtId = buildingDistrictId.get(s.buildingId);
    if (!districtId) continue;
    districtPopulationById[districtId] = (districtPopulationById[districtId] ?? 0) + 1;
  }
  // The presence/session primitive (2026-08-24) — reconciled from the SAME final post-tick
  // FILLED set districtPopulationById above just built, against whatever `world.currentlyOnline`
  // the caller reported. See presence.ts's header for why this is a live snapshot, not a
  // pendingX queue.
  const presence = stepPresenceLedger(world.presence, filledPlayerIds, world.currentlyOnline);

  // Grifter housing (2026-08-13, docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md §1.3): a
  // role-holder is already housed in the same district as their workplace — counted above via
  // FILLED role-slot state, doubling as their housing count, no separate pass needed. Grifters
  // have no workplace building, so they need their own assignment. Already-housed grifters are
  // counted first (stable — nobody already housed gets reshuffled), then any grifter still
  // unhoused (freshly created this tick, or from before this feature existed) is placed into
  // whichever district currently has the most housing headroom (`chooseHousingDistrict`) —
  // resolved by the end of THIS tick, every tick, same lazy-fill-by-end-of-tick pattern
  // District.population's own fix above uses.
  for (const g of grifters) {
    if (g.districtId) districtPopulationById[g.districtId] = (districtPopulationById[g.districtId] ?? 0) + 1;
  }
  const districtById = new Map(shardWithWeather.districts.map((d) => [d.id, d]));
  grifters = grifters.map((g) => {
    if (g.districtId) return g;
    const districtId = chooseHousingDistrict(world.shard, districtPopulationById);
    if (!districtId) return g; // empty shard — nothing to assign to, shouldn't happen in practice
    districtPopulationById[districtId] = (districtPopulationById[districtId] ?? 0) + 1;
    // Position resolves in the SAME pass as districtId, same tick, every time — a grifter is
    // never housed without also having a real place to stand.
    //
    // SPREAD ACROSS REAL PLOTS, not stacked on the plaza (2026-08-19). This used to place
    // every grifter on `plazaPlot`, which put the shard's entire roleless population — ~40
    // people, about a third of everyone — on one cell. Centring the district (the Wall fix)
    // then made `plazaPlot === hubPlot` in all 20 seeds checked, so that single cell became
    // the Wall itself, and the renderer draws the hub BEFORE people: every grifter went
    // invisible at once. The pile-up was a pre-existing wart; centring turned it into a
    // disappearance.
    //
    // Placement is a deterministic hash of the grifter's own stable id into the district's
    // plot list, NOT an rng draw: it consumes nothing from `world.rng`, so adding it does not
    // shift any downstream tick's trajectory. The hub cell is excluded — a person stands in
    // the plaza beside the Wall, never inside it.
    const district = districtById.get(districtId);
    if (!district) return { ...g, districtId };
    const standable = district.plots.filter(
      (p) => !(p.x === shardWithWeather.hubPlot.x && p.y === shardWithWeather.hubPlot.y),
    );
    if (standable.length === 0) return { ...g, districtId };
    let hash = 0;
    for (let i = 0; i < g.id.length; i++) hash = (Math.imul(hash, 31) + g.id.charCodeAt(i)) >>> 0;
    const spot = standable[hash % standable.length]!;
    return { ...g, districtId, x: spot.x, y: spot.y };
  });

  const shardWithPopulation: Shard = {
    ...shardWithWeather,
    districts: shardWithWeather.districts.map((d) => ({ ...d, population: districtPopulationById[d.id] ?? 0 })),
  };

  return {
    ...world,
    tick: world.tick + 1,
    // Geography (plots/buildings/coordinates) is still static — Phase B doesn't move
    // anyone — but weatherHistory is per-district climate, not geometry, and now updates
    // every tick (see District Weather above).
    shard: shardWithPopulation,
    millers,
    bakers,
    couriers,
    investigators,
    importExporters,
    grifters,
    nextGrifterId,
    flourPrice: flourPriceValue,
    population,
    economicHealth: economicHealth(finalFilledCount, totalRoleSlots),
    economicHealthWithExperience: economicHealthWithExperience(
      millers.filter((m) => m.slot.state === 'FILLED').length + bakers.filter((b) => b.slot.state === 'FILLED').length,
      avgExp,
      config.rMiller + config.rBaker,
    ),
    // giniCoefficient/topShare both return 0 for an empty array — 0 tracked players reads
    // as "no meaningful comparison," not an error.
    wealthGini: giniCoefficient(allWealthValues),
    wealthTop10Share: topShare(allWealthValues, 0.1),
    districtHealth,
    resources,
    lastEmigrants: actualEmigrants,
    lastNewArrivals,
    pendingWallPosts: [],
    lastRumourEvents,
    lastSabotage,
    identityLedger,
    completionStats,
    pressureLedger,
    diary,
    pendingDiaryEntries: [],
    lastDiaryWrites,
    lastDiaryRejections,
    lastOracleStats: oracleStats,
    lastImportExportWindows: importExportWindows,
    currentlyOnline: world.currentlyOnline,
    presence,
    pendingProximityUtterances: [],
    lastProximityConversations,
    lastProximityRejections,
    sabotageCampaigns,
    nextCampaignId,
    lastSabotageCampaignEvents: sabotageEvents,
  };
}
