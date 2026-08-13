import { patternSabotageAttempt, PATTERN_DETECTIVE_BONUS_DEFAULT } from './ecosystem.js';

/**
 * Arson (`docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §3-4, `docs/DESIGN_HOUSING_REPUTATION_
 * 2026-08-13.md` §7.6) — explicitly the hardest of the three fines-ruleset crimes, harder
 * than sabotage, not easier. Reuses pattern-based sabotage's step-chain wholesale rather
 * than inventing new detection math (fines doc §4: "zero new detection logic to design,
 * test, or calibrate from scratch") — this file supplies only what's genuinely
 * arson-specific: the absence-gate precondition, target resolution, and constants
 * recalibrated to the user's own number.
 *
 * **Calibrated against `sim/sabotagePatternHarness.ts` directly** (8 seeds, 20,000 days,
 * 2,000-day burn-in, sweeping `pPerWitness` at the shipped 6-step count — see
 * `sim/arsonCli.ts` for the permanent report): `pPerWitness=0.02` lands no-Detective
 * success at 32.0% (mean 110 days between successes), with an active Detective 18.3%
 * (mean 171 days) — matching *"30% opportunity is enough to take a chance... otherwise
 * it's not worth obtaining"* read as a floor, clearly below sabotage's newly-recalibrated
 * 71.1%/40.2%, and a Detective still meaningfully harder (a ~43% relative reduction, the
 * same order of magnitude as sabotage's own Detective effect).
 *
 * **Deliberately NOT built in this pass**: the Firestarter crafting item (needs
 * `personalResourceStock`, a real prerequisite `docs/DESIGN_FINES_ECONOMY_2026-08-13.md`
 * §1 flags as still missing — this file assumes the item already exists and someone is
 * attempting the act) and wiring into `world.ts`'s tick loop (needs real per-tick
 * witness-count/absence data). This is deliberately the same stage pattern-sabotage itself
 * was at before `sabotagePatternHarness.ts` existed: a standalone, measurable mechanic,
 * not yet wired to a live world.
 */

export interface ArsonPresence {
  /** Is the target's role slot currently FILLED and actively worked right now? */
  targetActivelyWorkingRole: boolean;
  /** Is the target physically present at their own abode right now? */
  targetPresentAtAbode: boolean;
}

/**
 * The absence-gate, exactly per the housing doc's §7.6: BOTH signals must be absent — the
 * target neither actively working their role NOR present at their abode. Composes for free
 * with the "above bakeries" mixed-use housing model (§1.1): a target who lives above their
 * own shop needs only one real-world fact to change (are they in the building at all) for
 * both booleans to flip together — this function doesn't need to know that, it just needs
 * both checks true.
 */
export function canAttemptArson(presence: ArsonPresence): boolean {
  return !presence.targetActivelyWorkingRole && !presence.targetPresentAtAbode;
}

export type BuildingId = string;

export interface ArsonTargetInput {
  hasRole: boolean;
  workplaceBuildingId?: BuildingId;
  abodeBuildingId: BuildingId;
}

/**
 * Resolves WHICH building arson targets — flagged `[OPEN]` in both design docs, not decided
 * there. **Picked default, stated plainly rather than silently assumed**: a role-holder's
 * workplace, since arson reads as "destroying infrastructure" — matching
 * `ecosystem.ts`'s `applySabotageDamage`'s existing economic-output-damage semantics, not a
 * personal-vindictiveness mechanic; a grifter's abode, since a grifter has no workplace to
 * target at all. When workplace and abode are the same building (§1.1's mixed-use housing),
 * this returns that one building either way, so the ambiguity is moot in that common case.
 */
export function resolveArsonTarget(target: ArsonTargetInput): BuildingId {
  if (target.hasRole && target.workplaceBuildingId) {
    return target.workplaceBuildingId;
  }
  return target.abodeBuildingId;
}

/** [CALIBRATED — provisional, measured] see file header for the full measured numbers. */
export const ARSON_STEPS_DEFAULT = 6;
/** [CALIBRATED — provisional, measured] the lever that lands the ~30% floor. */
export const ARSON_P_PER_WITNESS_DEFAULT = 0.02;
export const ARSON_DETECTIVE_BONUS_DEFAULT = PATTERN_DETECTIVE_BONUS_DEFAULT;

/**
 * The act itself — a thin, arson-specific wrapper around `patternSabotageAttempt`, per the
 * fines doc's own explicit instruction to reuse sabotage's step-chain rather than build
 * parallel detection math. Only the calibration constants differ; the mechanic is identical.
 * Callers are expected to have already checked `canAttemptArson` — this function doesn't
 * re-check the absence-gate itself, matching `patternSabotageAttempt`'s own precondition-free
 * shape (the gate is a separate, composable concern, not baked into the detection math).
 */
export function attemptArson(
  witnesses: number,
  detectiveActive: boolean,
  rand: () => number,
  stepsRequired: number = ARSON_STEPS_DEFAULT,
  pPerWitness: number = ARSON_P_PER_WITNESS_DEFAULT,
  detectiveBonus: number = ARSON_DETECTIVE_BONUS_DEFAULT,
): { succeeded: boolean; caughtAtStep: number | null } {
  return patternSabotageAttempt(stepsRequired, witnesses, detectiveActive, rand, pPerWitness, detectiveBonus);
}
