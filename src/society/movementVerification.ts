/** No-provider, real-kernel movement rehearsal. Builds agent-visible snapshots with
 * the production Society boundary, admits each mechanical move through the same
 * Society action validator and executes it through stepParticipantTurn.
 * It does NOT run an autonomous policy or simulate a paid model choice.
 */
import { createParticipantState, fixtureGenesis, stepParticipantTurn } from '../agent/participantWorld.js';
import { evidenceHash, digest } from '../agent/replay.js';
import { personBody } from '../server/observer.js';
import { societyConfig } from './runtime.js';
import { buildSocietyContext, validateSocietyAction } from './boundary.js';
import { emptySocietyAction } from './policy.js';
import { planVisibleDestination, nextAuthorizedMovementStep, type DestinationMovementPlan } from './destinationMovement.js';

const requireContract = (ok: boolean, detail: string): void => {
  if (!ok) throw new Error(`offline_movement_contract:${detail}`);
};

function singleRehearsal(seed: number) {
  const genesis = fixtureGenesis(seed, { ...societyConfig(), diarySubjectOptional: true });
  let state = createParticipantState(genesis);
  const person = [...state.registry.people.values()].find(p => p.role === 'baker' && p.location !== null);
  if (!person) throw new Error('offline_movement_no_baker');
  const currentView = () => buildSocietyContext(state, person.id, { phase: 'act' });
  const original = currentView().visible;
  let plan: DestinationMovementPlan | null = null;
  // A real public same-district destination, chosen mechanically to exercise several steps.
  // This fixture selection is not an agent policy or an experimental destination decision.
  for (const plot of original.local.places) {
    try {
      const candidate = planVisibleDestination(original, { x: plot.x, y: plot.y });
      if (!plan || candidate.steps.length > plan.steps.length ||
          candidate.steps.length === plan.steps.length &&
          (candidate.destination.x < plan.destination.x ||
           candidate.destination.x === plan.destination.x && candidate.destination.y < plan.destination.y)) plan = candidate;
    } catch {
      // The generated map may contain disconnected plots; these are not valid targets.
    }
  }
  if (!plan || plan.steps.length < 2) throw new Error('offline_movement_no_multistep_route');

  const trace = [];
  const initialHash = evidenceHash(state);
  const originalTick = state.world.tick;
  for (let index = 0; index < plan.steps.length; index++) {
    const before = currentView();
    const move = nextAuthorizedMovementStep(plan, index, before.visible);
    requireContract(move !== null, 'missing_next_step');
    const admitted = validateSocietyAction({ ...emptySocietyAction(), move }, before.context);
    const beforeHash = evidenceHash(state);
    const result = stepParticipantTurn(state, [{
      person: person.id, tick: state.world.tick, epoch: person.roleEpoch,
      decision: { move: admitted.move, communication: null, diary: null, role: null },
    }], index + 1);
    requireContract(result.effects.some(e => e.person === person.id && e.category === 'move'), 'missing_kernel_move');
    state = result.state;
    const after = currentView();
    requireContract(after.visible.self.x === move!.x && after.visible.self.y === move!.y, 'position_mismatch');
    requireContract(state.world.tick === originalTick, 'movement_advanced_world_day');
    trace.push({
      index, move, beforeWorldHash: beforeHash, afterWorldHash: evidenceHash(state),
      worldTickBefore: originalTick, worldTickAfter: state.world.tick,
      admittedAction: admitted,
      // Exactly the authorised packet, not observer projection or researcher-only world data.
      beforeAgentView: before.visible, afterAgentView: after.visible,
      effects: result.effects,
    });
  }
  const finalView = currentView().visible;
  requireContract(nextAuthorizedMovementStep(plan, plan.steps.length, finalView) === null, 'unfinished_route');
  requireContract(finalView.self.x === plan.destination.x && finalView.self.y === plan.destination.y, 'destination_mismatch');
  requireContract(evidenceHash(state) !== initialHash, 'world_state_unchanged');

  return {
    format: 'node-offline-movement-contract-v1', seed, source: 'society-v4-authorized-visible-boundary',
    modelCalls: 0, providerRequests: 0, worldDaysAdvanced: state.world.tick - originalTick,
    observerRef: original.self.ref, role: original.self.role, district: original.local.district,
    initialWorldHash: initialHash, finalWorldHash: evidenceHash(state),
    initialPosition: { x: original.self.x, y: original.self.y },
    finalPosition: { x: finalView.self.x, y: finalView.self.y },
    route: plan, trace,
  };
}

/** A replay of the SAME deterministic fixture must reproduce every visible byte,
 * legal step, kernel effect and world hash. */
export function verifyOfflineMovementContract(seed = 42) {
  const first = singleRehearsal(seed);
  const second = singleRehearsal(seed);
  requireContract(digest(first) === digest(second), 'repeat_run_diverged');
  return { ...first, repeatVerified: true, evidenceDigest: digest(first) };
}
