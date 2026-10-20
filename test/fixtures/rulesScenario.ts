import { createParticipantState, fixtureGenesis, stepParticipantState, type CanonicalAction } from '../../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../../src/world/world.js';
import { observe, observerRef, personBody } from '../../src/server/observer.js';
import { newTape, evidenceHash, digest, replay } from '../../src/agent/replay.js';
import type { Decision } from '../../src/agent/protocol.js';
import type { RulesAwareContext } from '../../src/agent/rulesAwareContext.js';

export const idleDecision = (): Decision => ({ move: null, communication: null, diary: null, role: null });

/** Declared fixture policy: cautious inquiry, not inferred truth or a trained model. */
export function cautiousInquiry(packet: RulesAwareContext, retainedMemory = true): Decision {
  const known = packet.observation.recognition.map(x => String(x.ref)).sort();
  const remembered = retainedMemory ? packet.observation.diary.map(x => String(x.subject)).find(ref => known.includes(ref)) : undefined;
  const ref = remembered ?? known[0];
  return { ...idleDecision(), communication: ref ? { kind: 'proximityUtterance', intent: 'ask', tone: 'guarded', referent: { kind: 'player', playerId: ref }, context: null } : null };
}

/** Mechanical test instrumentation only: real public Wall hearings earn recognition;
 * one existing legacy diary action creates retained memory. No injected world/identity
 * records, new automatic memory mechanic, model call or persistent private scratchpad.
 */
export function memoryScenario(seed: number, targetIndex: 0 | 1) {
  const genesis = fixtureGenesis(seed, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
  let state = createParticipantState(genesis);
  const actor = [...state.registry.people.values()].find(p => p.role === 'baker')!;
  const own = personBody(state, actor);
  const sources = [...state.registry.people.values()].filter(p => p.role !== null && p.id !== actor.id)
    .sort((a, b) => {
      const x = personBody(state, a), y = personBody(state, b);
      return Math.abs(x.x - own.x) + Math.abs(x.y - own.y) - Math.abs(y.x - own.x) - Math.abs(y.y - own.y) || a.id.localeCompare(b.id);
    }).slice(0, 2);
  const tape = newTape(state), online = [actor.id, ...sources.map(p => p.id)];
  const observation = () => ({ ...observe(state, actor.id, genesis.observerSecret), observationId: 'TEST-only-current-view' });
  const advance = (actions: CanonicalAction[]) => {
    const tick = state.world.tick, result = stepParticipantState(state, actions, online); state = result.state;
    tape.ticks.push({ tick, online: [...online], actions: structuredClone(actions), stateHash: evidenceHash(state), effectsHash: digest(result.effects) });
    return result;
  };
  const refs = sources.map(p => observerRef(genesis.observerSecret, actor.id, p.id)).sort();
  for (let day = 0; day < 80 && !refs.every(ref => observation().context.knownSubjects.includes(ref)); day++) {
    advance(sources.map(p => ({ person: p.id, epoch: p.roleEpoch, tick: state.world.tick,
      decision: { ...idleDecision(), communication: { kind: 'wallPost', state: 'hopeful' } } })));
  }
  if (!refs.every(ref => observation().context.knownSubjects.includes(ref))) throw Error('fixture_real_recognition_not_earned');
  const target = refs[targetIndex]!;
  advance([{ person: actor.id, epoch: actor.roleEpoch, tick: state.world.tick, decision: { ...idleDecision(),
    diary: { subject: target, observation: 'sharedARumourFreely', reading: 'cantTellYet', context: 'rumourHeard' } } }]);
  if (observation().projection.diary.length !== 1) throw Error('fixture_memory_not_admitted');
  return {
    target, actor, genesis, observation, tape, state: () => state,
    advanceDecision: (decision: Decision) => advance([{ person: actor.id, epoch: actor.roleEpoch, tick: state.world.tick, decision }]),
    age: () => advance([]),
    // Preserve optional undefined config members exactly, as the existing tagged checkpoint codec does.
    restore: () => { state = replay(structuredClone(tape), genesis.sourceRevision); return observation(); },
  };
}
