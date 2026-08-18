import {
  patternStepDetectionProbability,
  PATTERN_STEPS_DEFAULT,
  PATTERN_STEP_CADENCE_DAYS_DEFAULT,
  PATTERN_P_PER_WITNESS_DEFAULT,
  PATTERN_DETECTIVE_BONUS_DEFAULT,
} from './ecosystem.js';

/**
 * Sabotage as PERSISTENT, MULTI-TICK STATE (2026-08-18) — the restructure
 * `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md` §4 identified as blocking, and the promotion of
 * pattern-based sabotage from "PROPOSAL, not shipped" to the live model.
 *
 * WHY THIS MODULE EXISTS AT ALL, stated plainly because it revises an earlier claim in this
 * project's own devlog. Promoting pattern sabotage was described as roughly swapping one
 * resolver for another. That was wrong. `ecosystem.ts`'s `patternSabotageAttempt()` runs an
 * ENTIRE campaign inside a single function call — a `for` loop over every step, returning
 * succeeded/caught — with `detectiveActive` fixed as a parameter at the moment of the call.
 * A campaign resolved that way has no "mid", so nothing can intervene partway through it:
 * not a Detective, not a player, not the world changing around it. Every mechanic the design
 * wants to hang off sabotage (the flashlight, the walk of shame, a saboteur who can be caught
 * and marked) needs a campaign that EXISTS ACROSS TICKS. That is what this provides.
 *
 * WHAT IS DELIBERATELY NOT DUPLICATED: the detection math. `patternStepDetectionProbability`
 * (and through it `patternLegibility`'s quadratic ramp and the Detective's separate linear
 * one) is imported and called unchanged. This module owns only the STATE MACHINE — when a step
 * falls due, what advancing does, when a campaign ends. `patternSabotageAttempt` itself is
 * kept and still exported by `ecosystem.ts`: it remains exactly the right shape for
 * `sabotagePatternHarness.ts`'s bulk sweeps, which resolve whole campaigns against a fixed
 * witness count on purpose. It simply stops being what the live world uses.
 *
 * THE CONSEQUENCE THIS MAKES POSSIBLE, AND WHY IT IS STILL NOT APPLIED HERE. `ecosystem.ts`
 * carries a KNOWN GAP for both resolvers: no consequence is defined for a CAUGHT saboteur.
 * Tracing it while building this turned up the real reason it was never closed — **the engine
 * has no saboteur identity to apply a consequence to.** `sabotageAttempt(saboteurCount, ...)`
 * takes an anonymous COUNT; nobody is ever named, so there has never been anyone to fine, mark,
 * or lock out of their abode. `SabotageCampaign.saboteurId` closes that structurally (null for
 * the ambient hazard that has no identified actor, which is the shipped kernel's only opener
 * today; a real id once a driver or player opens one). The consequence itself — abode lockout,
 * the Oracle unlock, the walk of shame at the Wall, the fine — is a design still being settled
 * and is NOT invented here. `caughtAtStep` and `saboteurId` are reported; what happens next is
 * left to whoever settles it.
 */

export interface SabotageCampaign {
  id: string;
  targetBuildingId: string;
  /**
   * Who is running this campaign, when that is knowable. Null for the ambient hazard the
   * shipped kernel opens — it models "someone, somewhere, is working on that slot" and names
   * nobody, exactly as the pre-restructure model did. A driver-opened or player-opened campaign
   * carries a real id, which is what makes a caught-saboteur consequence buildable at all.
   */
  saboteurId: string | null;
  stepsRequired: number;
  stepsCompleted: number;
  startedDay: number;
  /** The day the next step falls due. Steps are paced, not continuous — see `ecosystem.ts`'s
   *  `PATTERN_STEP_CADENCE_DAYS_DEFAULT` for why detection depends on steps, never calendar. */
  nextStepDay: number;
  /**
   * Who is actively investigating this specific campaign, or null. Today `world.ts` sets this
   * mechanically (is there a working Detective placed to notice), which is a real, observable
   * fact and not a modelled mind — constraint 3. The flashlight, when built, replaces the
   * ASSIGNMENT RULE that fills this field; it does not change the field or anything below.
   */
  investigatedBy: string | null;
}

export interface CampaignParams {
  stepsRequired: number;
  stepCadenceDays: number;
  pPerWitness: number;
  detectiveBonus: number;
}

export const DEFAULT_CAMPAIGN_PARAMS: CampaignParams = {
  stepsRequired: PATTERN_STEPS_DEFAULT,
  stepCadenceDays: PATTERN_STEP_CADENCE_DAYS_DEFAULT,
  pPerWitness: PATTERN_P_PER_WITNESS_DEFAULT,
  detectiveBonus: PATTERN_DETECTIVE_BONUS_DEFAULT,
};

export type CampaignOutcome =
  /** A step was taken undetected; the campaign continues. */
  | { type: 'advanced'; campaign: SabotageCampaign }
  /** The final step landed — the target should now be evicted by the caller. */
  | { type: 'succeeded'; campaign: SabotageCampaign }
  /** Detected partway through. `atStep` is the step that gave it away. */
  | { type: 'caught'; campaign: SabotageCampaign; atStep: number };

/** Opens a campaign against one target. Pure — the caller owns id allocation and scheduling. */
export function openCampaign(
  id: string,
  targetBuildingId: string,
  day: number,
  saboteurId: string | null = null,
  params: CampaignParams = DEFAULT_CAMPAIGN_PARAMS,
): SabotageCampaign {
  return {
    id,
    targetBuildingId,
    saboteurId,
    stepsRequired: params.stepsRequired,
    stepsCompleted: 0,
    startedDay: day,
    // The first step falls due one cadence after opening, not immediately — a campaign that
    // resolved a step on the same tick it began would compress its own timeline by one step.
    nextStepDay: day + params.stepCadenceDays,
    investigatedBy: null,
  };
}

export function isStepDue(campaign: SabotageCampaign, day: number): boolean {
  return day >= campaign.nextStepDay;
}

/**
 * Advances one campaign by a single step, rolling detection against the witness count that is
 * REAL RIGHT NOW rather than one frozen when the campaign opened. That difference is the whole
 * point of the restructure: a node that empties out mid-campaign genuinely becomes easier to
 * work in, and one that fills up genuinely becomes harder, which the one-shot resolver could
 * never express.
 *
 * Returns null when the step is not yet due. Never mutates the campaign passed in.
 */
export function stepCampaign(
  campaign: SabotageCampaign,
  day: number,
  witnesses: number,
  rand: () => number,
  params: CampaignParams = DEFAULT_CAMPAIGN_PARAMS,
): CampaignOutcome | null {
  if (!isStepDue(campaign, day)) return null;

  const nextStep = campaign.stepsCompleted + 1;
  const p = patternStepDetectionProbability(
    nextStep,
    campaign.stepsRequired,
    witnesses,
    campaign.investigatedBy !== null,
    params.pPerWitness,
    params.detectiveBonus,
  );

  if (rand() < p) {
    return { type: 'caught', campaign, atStep: nextStep };
  }

  const advanced: SabotageCampaign = {
    ...campaign,
    stepsCompleted: nextStep,
    nextStepDay: day + params.stepCadenceDays,
  };
  return nextStep >= campaign.stepsRequired
    ? { type: 'succeeded', campaign: advanced }
    : { type: 'advanced', campaign: advanced };
}

/** Real progress 0..1, for rendering and reporting. Not used by the detection math, which
 *  derives its own ramp from `stepsCompleted` directly. */
export function campaignProgress(campaign: SabotageCampaign): number {
  return campaign.stepsRequired === 0 ? 0 : Math.min(1, campaign.stepsCompleted / campaign.stepsRequired);
}
