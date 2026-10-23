/**
 * Shared-world experiment host. Uses the same observer, validator, identity selection and
 * participant kernel as MultiActorEpisode, without invoking or changing Study 1's contract.
 * No network listener; provider code receives only requests built from the authorized view.
 */
import { createParticipantState, stepParticipantState, type Genesis, type CanonicalAction } from '../agent/participantWorld.js';
import { observe, personBody } from '../server/observer.js';
import { validateDecision } from '../agent/protocol.js';
import { evidenceHash, digest, newTape, type ReplayTape } from '../agent/replay.js';
import type { AuthorizedObservation } from '../agent/responsesRequest.js';
import type { ActorSpec } from './constructs/authorityAttribution.js';
import { rejectionReasons, type Verdict } from './episode.js';

export interface ActorView { actorId: string; observation: AuthorizedObservation }
export interface HostTransition {
  tick: number; nextTick: number; scheduledActors: string[]; beforeHash: string; afterHash: string;
  tapeTick: ReplayTape['ticks'][number];
  verdicts: Record<string, Verdict>;
  effects: ReturnType<typeof stepParticipantState>['effects'];
  before: ActorView[]; after: ActorView[];
}
/** Opaque actor ids route evaluator requests, never model knowledge. */
export class ContinuationHost {
  #state;
  #people: { actorId: string; person: string }[];
  #tape: ReplayTape;
  #halted = false;
  constructor(genesis: Genesis, actors: readonly ActorSpec[]) {
    this.#state = createParticipantState(genesis);
    const people = [...this.#state.registry.people.values()].filter(p => p.location !== null).sort((a, b) => a.id.localeCompare(b.id));
    this.#people = actors.map(spec => {
      const person = people.filter(p => personBody(this.#state, p).role === spec.role)[spec.ordinal];
      if (!person) throw Error('continuation_actor_unavailable');
      return { actorId: spec.actorId, person: person.id };
    });
    if (!actors.length || new Set(this.#people.map(p => p.actorId)).size !== actors.length ||
      new Set(this.#people.map(p => p.person)).size !== actors.length) throw Error('continuation_actor_collision');
    this.#tape = newTape(this.#state);
  }
  get tick() { return this.#state.world.tick; }
  get hash() { return evidenceHash(this.#state); }
  identities() { return structuredClone(this.#people); }
  tape() { return structuredClone(this.#tape); }
  views(): ActorView[] {
    if (this.#halted) throw Error('continuation_host_halted');
    return this.#people.filter(a => this.#state.registry.people.get(a.person)?.location != null).map(a => {
      const view = observe(this.#state, a.person, this.#state.genesis.observerSecret);
      return { actorId: a.actorId, observation: { ...view, observationId: digest([a.actorId, view.context, this.hash]) } as AuthorizedObservation };
    });
  }
  advance(views: readonly ActorView[], proposals: Record<string, unknown>, scheduledActors = views.map(v => v.actorId)): HostTransition {
    const before = this.views();
    if (digest(views) !== digest(before)) throw Error('continuation_stale_observation');
    if (!scheduledActors.length || new Set(scheduledActors).size !== scheduledActors.length || scheduledActors.some(id => !before.some(v => v.actorId === id)) || JSON.stringify(Object.keys(proposals).sort()) !== JSON.stringify([...scheduledActors].sort())) throw Error('continuation_actor_coverage');
    const actions: CanonicalAction[] = [], verdicts: Record<string, Verdict> = {};
    for (const { actorId, observation } of before.filter(v => scheduledActors.includes(v.actorId))) {
      const candidate = proposals[actorId], decision = validateDecision(candidate, observation.context);
      verdicts[actorId] = decision ? { code: 'admitted', decision, reasons: [] }
        : { code: 'rejected', decision: null, reasons: rejectionReasons(candidate, observation.context) };
      if (decision) {
        const person = this.#people.find(p => p.actorId === actorId)!.person;
        actions.push({ person, epoch: observation.context.roleEpoch, tick: this.tick, decision });
      }
    }
    const beforeHash = this.hash, tick = this.tick;
    const online = before.map(v => this.#people.find(p => p.actorId === v.actorId)!.person);
    let result: ReturnType<typeof stepParticipantState>;
    try { result = stepParticipantState(this.#state, actions, online); }
    catch (error) { this.#halted = true; throw error; } // mutable RNG lineage is never retried
    this.#state = result.state;
    const tapeTick = { tick, online, actions, stateHash: this.hash, effectsHash: digest(result.effects) };
    this.#tape.ticks.push(tapeTick);
    return { tick, nextTick: this.tick, scheduledActors, beforeHash, afterHash: this.hash, tapeTick,
      verdicts, effects: structuredClone(result.effects), before, after: this.views() };
  }
}
