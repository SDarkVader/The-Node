import { describe, expect, it } from 'vitest';
import {
  openCampaign,
  stepCampaign,
  isStepDue,
  campaignProgress,
  DEFAULT_CAMPAIGN_PARAMS,
  type SabotageCampaign,
} from '../src/engine/sabotageCampaign.js';
import { patternStepDetectionProbability, PATTERN_STEPS_DEFAULT, PATTERN_STEP_CADENCE_DAYS_DEFAULT } from '../src/engine/ecosystem.js';
import { mulberry32 } from '../src/sim/rng.js';

/**
 * Pure-function tests for the 2026-08-18 campaign restructure (`engine/sabotageCampaign.ts`) —
 * sabotage as persistent multi-tick state rather than a whole campaign resolved in one call.
 * The property that matters most is the one the old resolver structurally could not have:
 * detection rolls against the witness count that is real AT EACH STEP.
 */

const NEVER = () => 1; // rand() === 1 never falls below any probability — never caught
const ALWAYS = () => 0; // rand() === 0 falls below any positive probability — always caught

describe('sabotage campaigns — opening and pacing', () => {
  it('opens with no progress and its first step one cadence out, not immediately', () => {
    const c = openCampaign('c1', 'b-1', 100);
    expect(c.stepsCompleted).toBe(0);
    expect(c.startedDay).toBe(100);
    expect(c.nextStepDay).toBe(100 + PATTERN_STEP_CADENCE_DAYS_DEFAULT);
    expect(isStepDue(c, 100)).toBe(false);
    expect(isStepDue(c, c.nextStepDay)).toBe(true);
  });

  it('returns null rather than acting when a step is not yet due', () => {
    const c = openCampaign('c1', 'b-1', 0);
    expect(stepCampaign(c, 1, 10, ALWAYS)).toBeNull();
  });

  it('never mutates the campaign it is given', () => {
    const c = openCampaign('c1', 'b-1', 0);
    const snapshot = JSON.stringify(c);
    stepCampaign(c, 999, 5, NEVER);
    stepCampaign(c, 999, 5, ALWAYS);
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it('carries a saboteurId when one is known, and null for the ambient hazard', () => {
    // The structural gap this closes: the pre-restructure model took an anonymous COUNT of
    // saboteurs, so a caught-saboteur consequence had nobody to apply to.
    expect(openCampaign('c1', 'b-1', 0).saboteurId).toBeNull();
    expect(openCampaign('c2', 'b-1', 0, 'core-0-b9').saboteurId).toBe('core-0-b9');
  });
});

describe('sabotage campaigns — advancing to completion', () => {
  it('reaches success in exactly stepsRequired steps when never detected', () => {
    let c: SabotageCampaign = openCampaign('c1', 'b-1', 0);
    let day = 0;
    let steps = 0;
    let succeeded = false;
    for (let i = 0; i < 200 && !succeeded; i++) {
      day += 1;
      const out = stepCampaign(c, day, 0, NEVER);
      if (!out) continue;
      steps += 1;
      if (out.type === 'succeeded') succeeded = true;
      c = out.campaign;
    }
    expect(succeeded).toBe(true);
    expect(steps).toBe(PATTERN_STEPS_DEFAULT);
  });

  it('takes stepsRequired x cadence days to complete — the calendar length the design asks about', () => {
    let c: SabotageCampaign = openCampaign('c1', 'b-1', 0);
    let day = 0;
    for (;;) {
      day += 1;
      const out = stepCampaign(c, day, 0, NEVER);
      if (!out) continue;
      c = out.campaign;
      if (out.type === 'succeeded') break;
    }
    expect(day).toBe(PATTERN_STEPS_DEFAULT * PATTERN_STEP_CADENCE_DAYS_DEFAULT);
    expect(day).toBeLessThan(100); // the user's own explicit ceiling: "it can't take over 100 days"
  });

  it('progress climbs monotonically and reports 1 only at completion', () => {
    let c: SabotageCampaign = openCampaign('c1', 'b-1', 0);
    let last = campaignProgress(c);
    expect(last).toBe(0);
    for (let day = 1; day <= PATTERN_STEPS_DEFAULT * PATTERN_STEP_CADENCE_DAYS_DEFAULT; day++) {
      const out = stepCampaign(c, day, 0, NEVER);
      if (!out) continue;
      c = out.campaign;
      const p = campaignProgress(c);
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect(last).toBe(1);
  });
});

describe('sabotage campaigns — detection reacts to the world as it is NOW', () => {
  it('a campaign is caught mid-run, reporting the step that gave it away', () => {
    const c = openCampaign('c1', 'b-1', 0);
    const out = stepCampaign(c, 999, 50, ALWAYS);
    expect(out?.type).toBe('caught');
    if (out?.type === 'caught') expect(out.atStep).toBe(1);
  });

  it('THE POINT OF THE RESTRUCTURE: the same campaign at the same step is riskier in a crowded node than an empty one', () => {
    // Structurally impossible under the old one-shot resolver, which froze one witness count
    // for a whole campaign. Compared directly rather than argued.
    const c = { ...openCampaign('c1', 'b-1', 0), stepsCompleted: 4 };
    const pEmpty = patternStepDetectionProbability(5, c.stepsRequired, 0, false);
    const pCrowded = patternStepDetectionProbability(5, c.stepsRequired, 40, false);
    expect(pCrowded).toBeGreaterThan(pEmpty);

    // And that difference shows up in real outcomes, not just in the probability.
    const runs = 400;
    const caughtIn = (witnesses: number) => {
      let caught = 0;
      for (let seed = 0; seed < runs; seed++) {
        const rand = mulberry32(seed);
        if (stepCampaign(c, 999, witnesses, rand)?.type === 'caught') caught += 1;
      }
      return caught;
    };
    expect(caughtIn(40)).toBeGreaterThan(caughtIn(0));
  });

  it('an early step is near-undetectable however crowded — the pattern is what incriminates, not the act', () => {
    const fresh = openCampaign('c1', 'b-1', 0);
    const pFirst = patternStepDetectionProbability(1, fresh.stepsRequired, 40, false);
    const pLast = patternStepDetectionProbability(fresh.stepsRequired, fresh.stepsRequired, 40, false);
    expect(pFirst).toBeLessThan(0.02);
    expect(pLast).toBeGreaterThan(pFirst * 10);
  });

  it('an investigated campaign is caught more often than an uninvestigated one at the same step', () => {
    const base = { ...openCampaign('c1', 'b-1', 0), stepsCompleted: 3 };
    const watched: SabotageCampaign = { ...base, investigatedBy: 'core-0-d1' };
    const runs = 400;
    const caught = (c: SabotageCampaign) => {
      let n = 0;
      for (let seed = 0; seed < runs; seed++) {
        if (stepCampaign(c, 999, 8, mulberry32(seed))?.type === 'caught') n += 1;
      }
      return n;
    };
    expect(caught(watched)).toBeGreaterThan(caught(base));
  });

  it('investigatedBy is the only thing that turns the Detective term on — presence alone is inert here', () => {
    // The field is set by whoever assigns investigation (mechanically today, the flashlight
    // later). This module never infers it.
    const c = openCampaign('c1', 'b-1', 0);
    expect(c.investigatedBy).toBeNull();
    const withoutDetective = patternStepDetectionProbability(3, c.stepsRequired, 8, false);
    const withDetective = patternStepDetectionProbability(3, c.stepsRequired, 8, true);
    expect(withDetective).toBeGreaterThan(withoutDetective);
  });
});

describe('sabotage campaigns — parameters stay adjustable', () => {
  it('a shorter campaign completes in fewer steps and fewer days', () => {
    const params = { ...DEFAULT_CAMPAIGN_PARAMS, stepsRequired: 3, stepCadenceDays: 2 };
    let c = openCampaign('c1', 'b-1', 0, null, params);
    let day = 0;
    let steps = 0;
    for (;;) {
      day += 1;
      const out = stepCampaign(c, day, 0, NEVER, params);
      if (!out) continue;
      steps += 1;
      c = out.campaign;
      if (out.type === 'succeeded') break;
    }
    expect(steps).toBe(3);
    expect(day).toBe(6);
  });
});
