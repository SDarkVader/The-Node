import { describe, expect, it } from 'vitest';
import { createParticipantState, fixtureGenesis, stepParticipantTurn } from '../src/agent/participantWorld.js';
import { buildSocietyContext, validateSocietyAction, type SocietyVisibleContext } from '../src/society/boundary.js';
import { emptySocietyAction } from '../src/society/policy.js';
import { societyConfig } from '../src/society/runtime.js';
import { planVisibleDestination, nextAuthorizedMovementStep, MovementContractError } from '../src/society/destinationMovement.js';
import { verifyOfflineMovementContract } from '../src/society/movementVerification.js';

function fixture() {
  const state = createParticipantState(fixtureGenesis(42, { ...societyConfig(), diarySubjectOptional: true }));
  const person = [...state.registry.people.values()].find(p => p.role === 'baker')!;
  const view = buildSocietyContext(state, person.id, { phase: 'act' });
  return { state, person, view };
}
const pointKey = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('destination movement: v4-preserving offline mechanics', () => {
  it('routes over the actual authorized public grid in stable adjacent steps', () => {
    const { view } = fixture();
    const candidates = view.visible.local.places.flatMap(plot => {
      try { return [planVisibleDestination(view.visible, { x: plot.x, y: plot.y })]; } catch { return []; }
    });
    const plan = candidates.sort((a, b) => b.steps.length - a.steps.length)[0]!;
    expect(plan.steps.length).toBeGreaterThan(1);
    expect(planVisibleDestination(view.visible, plan.destination)).toEqual(plan);
    const plotted = new Set(view.visible.local.places.map(pointKey));
    let previous = plan.start;
    for (const step of plan.steps) {
      expect(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y)).toBe(1);
      expect(plotted.has(pointKey(step))).toBe(true);
      previous = step;
    }
    expect(previous).toEqual(plan.destination);
    expect(view.visible.legalChoices.moves).toContainEqual(plan.steps[0]);
    expect(Object.isFrozen(plan.steps)).toBe(true);
    expect(Object.isFrozen(plan.steps[0])).toBe(true);
  });

  it('rejects hidden, malformed, disconnected and out-of-phase destinations', () => {
    const { view } = fixture();
    const visible = view.visible;
    expect(() => planVisibleDestination(visible, { x: 999999, y: 999999 }))
      .toThrow('movement_destination_not_visible');
    for (const invalid of [{ x: 1 }, { x: 1.1, y: 2 }, { x: 1, y: 2, role: 'admin' }, null]) {
      expect(() => planVisibleDestination(visible, invalid)).toThrow(MovementContractError);
    }
    const phase = structuredClone(visible) as any;
    phase.phase = 'commit';
    expect(() => planVisibleDestination(phase, { x: visible.self.x, y: visible.self.y }))
      .toThrow('movement_wrong_phase');
    const disconnected = structuredClone(visible) as any;
    disconnected.local.places = [
      { x: visible.self.x, y: visible.self.y, kind: 'building' },
      { x: visible.self.x + 2, y: visible.self.y, kind: 'street' },
    ];
    expect(() => planVisibleDestination(disconnected, { x: visible.self.x + 2, y: visible.self.y }))
      .toThrow('movement_destination_unreachable');
  });

  it('rechecks current permissions and identity before EVERY intermediate step', () => {
    const { view } = fixture();
    const dest = view.visible.legalChoices.moves[0]!;
    const plan = planVisibleDestination(view.visible, dest);
    expect(nextAuthorizedMovementStep(plan, 0, view.visible)).toEqual(dest);
    const revoke = structuredClone(view.visible) as any;
    revoke.legalChoices.moves = [];
    expect(() => nextAuthorizedMovementStep(plan, 0, revoke)).toThrow('movement_step_no_longer_legal');
    const displaced = structuredClone(view.visible) as any;
    displaced.self.x += 100;
    expect(() => nextAuthorizedMovementStep(plan, 0, displaced)).toThrow('movement_position_diverged');
    const switched = structuredClone(view.visible) as any;
    switched.self.role = 'Courier';
    expect(() => nextAuthorizedMovementStep(plan, 0, switched)).toThrow('movement_context_changed');
    const other = structuredClone(view.visible) as any;
    other.self.ref = 'f'.repeat(16);
    expect(() => nextAuthorizedMovementStep(plan, 0, other)).toThrow('movement_context_changed');
    expect(() => nextAuthorizedMovementStep(plan, 2, view.visible)).toThrow('movement_invalid_cursor');
  });

  it('preserves the kernel: a long-range coordinate is never accepted as one move', () => {
    const { state, person, view } = fixture();
    const plotted = view.visible.local.places.find(p =>
      Math.abs(p.x - view.visible.self.x) + Math.abs(p.y - view.visible.self.y) > 1)!;
    const illegal = { x: plotted.x, y: plotted.y };
    expect(() => validateSocietyAction({ ...emptySocietyAction(), move: illegal }, view.context)).toThrow();
    expect(() => stepParticipantTurn(state, [{
      person: person.id, epoch: person.roleEpoch, tick: state.world.tick,
      decision: { move: illegal, communication: null, diary: null, role: null },
    }], 1)).toThrow('invalid_decision_tape');
  });

  it('executes and replays actual multi-step kernel movement without models, exposes exact authorized views', () => {
    const record = verifyOfflineMovementContract();
    expect(record.repeatVerified).toBe(true);
    expect(record.modelCalls).toBe(0);
    expect(record.worldDaysAdvanced).toBe(0);
    expect(record.trace.length).toBeGreaterThan(1);
    expect(record.finalPosition).toEqual(record.route.destination);
    expect(record.finalWorldHash).not.toEqual(record.initialWorldHash);
    for (const step of record.trace) {
      expect(step.beforeAgentView).toHaveProperty('decisionSchema');
      expect(step.beforeAgentView).toHaveProperty('legalChoices.moves');
      expect(step.admittedAction.move).toEqual(step.move);
      expect(step.beforeWorldHash).not.toBe(step.afterWorldHash);
      expect(step.worldTickAfter).toBe(step.worldTickBefore);
      const transmitted = JSON.stringify(step.beforeAgentView);
      expect(transmitted).not.toContain('offline-fixture-observer-secret');
      expect(transmitted).not.toContain('observerSecret');
      expect(transmitted).not.toContain('worldHash');
      expect(transmitted).not.toContain('packageInformation');
    }
    expect(verifyOfflineMovementContract()).toEqual(record);
  });
});
