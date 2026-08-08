/**
 * NODE core mechanics — TypeScript port of node_core_reference.py
 *
 * This is the buildable artifact: every constant and function here was validated
 * against the Python reference implementation (node_core_reference.py, same
 * output directory), which itself was checked against a 6-assertion acceptance
 * suite. Run the test file at the bottom of this module before wiring these
 * functions into src/engine/ — do not hand-port without re-running the tests.
 *
 * KNOWN GAP (surfaced while building this, not previously caught): two
 * economic-health formulas exist with different denominators —
 * economicHealth() (baseline, validated against the sabotage/floor tests) and
 * economicHealthWithExperience() (validated separately against the migration/
 * districting tests). They have NOT been run together in one simulation.
 * Unifying them is real, unstarted work — do not silently merge without
 * re-validating.
 */

// ---- Canonical constants ------------------------------------------------------

export const S_DEFAULT = 24;                 // role slots per shard
export const NPC_PRODUCTIVITY = 0.4;         // output multiplier, BACKSTOPPED slot
export const PLAYER_PRODUCTIVITY_BASE = 1.0; // output multiplier, player-held slot
export const EXPERIENCE_CAP = 0.5;           // max experience bonus (caps at 1.5x)
export const EXPERIENCE_GAIN_PER_DAY = 0.01; // growth rate while actively in-role
export const MIGRATION_THETA = 0.30;         // roleless-fraction threshold
export const MIGRATION_K = 0.08;             // emigration rate coefficient
export const TRAVEL_DAYS_TARGET = 168;       // ~6 months, corrected commitment window
export const TRAVEL_DECAY_PER_DAY = 0.0010;  // experience decay/day while traveling
export const DETECTION_P_PER_WITNESS = 0.05; // per-witness, per-day detection prob.

// ---- Simple seedable RNG (mulberry32) — deterministic for reproducible tests --

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- LAYER 1 — the NPC economic floor ------------------------------------------

/**
 * Baseline economic health, 0..1, NO experience factored in.
 * Validated by the sabotage/floor simulations: floors at exactly
 * NPC_PRODUCTIVITY (0.4) when filledByPlayer === 0, because a vacated slot
 * always reverts to NPC-run output, never to zero.
 */
export function economicHealth(filledByPlayer: number, s: number = S_DEFAULT): number {
  const npcSlots = s - filledByPlayer;
  const total = filledByPlayer * PLAYER_PRODUCTIVITY_BASE + npcSlots * NPC_PRODUCTIVITY;
  return total / (s * PLAYER_PRODUCTIVITY_BASE);
}

/**
 * Extended variant incorporating experience bonus. Validated separately from
 * economicHealth() above — see KNOWN GAP note at the top of this file.
 */
export function economicHealthWithExperience(
  filledByPlayer: number,
  avgExperience: number,
  s: number = S_DEFAULT
): number {
  const npcSlots = s - filledByPlayer;
  const playerOutput = filledByPlayer * (PLAYER_PRODUCTIVITY_BASE + avgExperience);
  const npcOutput = npcSlots * NPC_PRODUCTIVITY;
  const maxPossible = s * (PLAYER_PRODUCTIVITY_BASE + EXPERIENCE_CAP);
  return (playerOutput + npcOutput) / maxPossible;
}

// ---- LAYER 2 — occupancy: detection, experience, districting ------------------

/** P(at least one witness sees a given action), given n other role-holders present. */
export function detectionProbability(
  otherRoleHolders: number,
  pPerWitness: number = DETECTION_P_PER_WITNESS
): number {
  return 1 - Math.pow(1 - pPerWitness, Math.max(0, otherRoleHolders));
}

export function growExperience(
  current: number,
  gainPerDay: number = EXPERIENCE_GAIN_PER_DAY,
  cap: number = EXPERIENCE_CAP
): number {
  return Math.min(cap, current + gainPerDay);
}

export function decayExperienceTraveling(
  current: number,
  decayPerDay: number = TRAVEL_DECAY_PER_DAY
): number {
  return Math.max(0.0, current - decayPerDay);
}

/**
 * coreBias: weight ratio favoring core when both districts are open (e.g. 2.0 =
 * 2x more likely to choose core over periphery). Validated defensible range
 * without emptying periphery: 2.0–3.0. Beyond ~10, periphery starts to empty.
 */
export function districtArrivalChoice(
  coreOpen: boolean,
  peripheryOpen: boolean,
  coreBias: number,
  rand: () => number
): "core" | "periphery" | null {
  if (coreOpen && peripheryOpen) {
    return rand() < coreBias / (coreBias + 1) ? "core" : "periphery";
  }
  if (coreOpen) return "core";
  if (peripheryOpen) return "periphery";
  return null;
}

// ---- LAYER 3 — migration valve --------------------------------------------------

/**
 * Returns emigrants for this step (stochastic rounding). f = roleless fraction
 * = R/N. No emigration below theta (the "comfortable" cutoff). Above theta,
 * rate scales with (f - theta) — negative feedback making this self-stabilizing
 * at any density. Validated: equilibrium f* rises smoothly from ~0.29 to a
 * ceiling of ~0.615 across arrival pressure from near-zero to unbounded; it
 * never diverges.
 */
export function migrationValveStep(
  n: number,
  filled: number,
  rand: () => number,
  theta: number = MIGRATION_THETA,
  k: number = MIGRATION_K
): number {
  const r = n - filled;
  if (r <= 0 || n <= 0) return 0;
  const f = r / n;
  if (f <= theta) return 0;
  const rate = k * (f - theta);
  const expected = r * rate;
  const emigrants = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
  return Math.min(emigrants, r);
}

// ---- LAYER 3 — sabotage ----------------------------------------------------------

/** Returns number of saboteurs who reach the acquisition deadline undetected. */
export function sabotageAttempt(
  saboteurCount: number,
  timeToAcquireDays: number,
  detectionPPerDay: number,
  rand: () => number
): number {
  let successful = 0;
  for (let i = 0; i < saboteurCount; i++) {
    let caught = false;
    for (let t = 0; t < timeToAcquireDays; t++) {
      if (rand() < detectionPPerDay) { caught = true; break; }
    }
    if (!caught) successful++;
  }
  return successful;
}

/** Slots evicted revert to NPC (BACKSTOPPED), never to zero — see Layer 1. */
export function applySabotageDamage(
  filledByPlayer: number,
  successfulSaboteurs: number,
  damagePerSuccess: number
): number {
  return Math.max(0, filledByPlayer - successfulSaboteurs * damagePerSuccess);
}

// =================================================================================
// ACCEPTANCE TESTS — run with: npx ts-node node_core.ts
// Every case below mirrors node_core_reference.py's run_acceptance_tests().
// Do not merge into src/engine/ until all six pass.
// =================================================================================

function runAcceptanceTests(): void {
  const results: [string, number | string, number | string, boolean][] = [];

  // T1 — NPC floor at zero players
  const eh = economicHealth(0, 24);
  results.push(["T1_npc_floor_at_zero_players", Number(eh.toFixed(4)), 0.4, Math.abs(eh - 0.4) < 1e-9]);

  // T2 — full veteran occupancy hits 1.0
  const ehFull = economicHealthWithExperience(24, 0.5, 24);
  results.push(["T2_full_veteran_occupancy", ehFull, 1.0, Math.abs(ehFull - 1.0) < 1e-9]);

  // T3 — detection probability at 23 witnesses ≈ 0.693
  const dp = detectionProbability(23);
  results.push(["T3_detection_full_shard", Number(dp.toFixed(3)), 0.693, Math.abs(dp - 0.693) < 0.005]);

  // T4 — migration valve ceiling holds under saturating arrival pressure
  {
    const rand = makeRng(1);
    let n = 0, filled = 0;
    const S = 24;
    for (let day = 0; day < 6000; day++) {
      if (rand() < 0.95) { n++; if (filled < S) filled++; }
      const emigrants = migrationValveStep(n, filled, rand);
      n -= emigrants;
    }
    const fFinal = n > 0 ? (n - filled) / n : 0;
    results.push(["T4_migration_ceiling_holds", Number(fFinal.toFixed(3)), "0.55-0.68", fFinal >= 0.55 && fFinal <= 0.68]);
  }

  // T5 — sustained forced-damage attack at BASELINE arrival pressure (0.10, not
  // the saturating 0.95 used in T4) permanently suppresses the shard to a
  // long-run AVERAGE near 40% — must be averaged over many post-transient days,
  // not a single snapshot, since the system oscillates between shocks.
  {
    const rand = makeRng(1);
    let n = 40, filled = 24;
    const S = 24;
    const econTail: number[] = [];
    for (let day = 1; day < 900; day++) {
      if (day % 20 === 0) filled = applySabotageDamage(filled, 3, 4);
      if (rand() < 0.10) { n++; if (filled < S) filled++; }
      const emigrants = migrationValveStep(n, filled, rand);
      n -= emigrants;
      if (day >= 400) econTail.push(economicHealth(filled, S));
    }
    const ehAvg = econTail.reduce((a, b) => a + b, 0) / econTail.length;
    results.push(["T5_sustained_attack_floor_avg", Number(ehAvg.toFixed(3)), "0.35-0.50", ehAvg >= 0.35 && ehAvg <= 0.50]);
  }

  // T6 — six-month travel decay lands in the 25-60% loss band
  {
    let exp = EXPERIENCE_CAP;
    for (let i = 0; i < TRAVEL_DAYS_TARGET; i++) exp = decayExperienceTraveling(exp);
    const pctLost = ((EXPERIENCE_CAP - exp) / EXPERIENCE_CAP) * 100;
    results.push(["T6_six_month_travel_decay_pct", Number(pctLost.toFixed(1)), "25-60%", pctLost >= 25 && pctLost <= 60]);
  }

  let allPass = true;
  for (const [name, actual, expected, passed] of results) {
    if (!passed) allPass = false;
    console.log(`[${passed ? "PASS" : "FAIL"}] ${name}: actual=${actual}  expected=${expected}`);
  }
  console.log(allPass ? "\nALL TESTS PASS" : "\nSOME TESTS FAILED — DO NOT SHIP");
}

// Only run when executed directly (ts-node), not when imported as a module.
if (require.main === module) {
  runAcceptanceTests();
}
