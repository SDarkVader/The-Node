import { expect, it } from 'vitest';
import { Society, societyConfig, verifySocietyTape } from '../src/society/runtime.js';
import { createSocietyPlan, validateSocietyPlan } from '../src/society/accounted.js';
import { autonomousPolicy } from '../src/society/policy.js';

it('binds the fourth controlled person and its extra calls into a reviewed plan', () => {
  const sourceRevision = 'a'.repeat(40);
  const legacy = new Society({ seed: 42, sourceRevision });
  const competitive = new Society({ seed: 42, sourceRevision, competitiveGrifter: true });
  const oldPlan = createSocietyPlan(legacy, { ticks: 2 });
  const plan = createSocietyPlan(competitive, { ticks: 2 });
  expect(oldPlan.maxCalls).toBe(12);
  expect(plan.maxCalls).toBe(14);
  expect(plan.controlled).toEqual(competitive.controlled);
  expect(() => validateSocietyPlan({ ...plan, competitiveGrifter: undefined })).toThrow();
  expect(() => validateSocietyPlan({ ...plan, maxCalls: 12, allowance: { ...plan.allowance, maxRequests: 12 } })).toThrow();
  expect(() => validateSocietyPlan({ ...plan, controlled: plan.controlled.slice(0, 3) })).toThrow();
});

it('preserves the selected person through an existing role transition and replay', () => {
  const society = new Society({ seed: 20261025, sourceRevision: 'offline-observation',
    config: {...societyConfig(), pMonthly: 0.9, conscriptionDelay: 3}, competitiveGrifter: true });
  const selected = society.controlled[3]!;
  expect(society.inspect().registry.people.get(selected)?.role).toBeNull();
  while(society.tick < 8) {
    for(const person of society.pendingPeople()) {
      society.submit(person, autonomousPolicy(society.view(person).visible));
    }
  }
  expect(society.inspect().registry.people.get(selected)?.role).toBe('baker');
  expect(society.controlled).toContain(selected);
  expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
});
