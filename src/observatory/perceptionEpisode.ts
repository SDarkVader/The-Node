/**
 * Perception episode (2026-10-23). Runs agents through the real kernel where each agent, at each
 * tick, receives only what Godot derived it could perceive from its current perspective, plus its
 * own position, role and legal moves. Nothing else from the authorized observation reaches the
 * policy: no people list, references, rumours, diary or dealings.
 *
 * It reuses the continuation experiment's host (ContinuationHost: the same observer, validator,
 * identity selection and participant kernel) without changing it, and keeps a mirror of the
 * committed state, stepped from each tape tick and checked against the host's evidence hash, to
 * build the perception requests. Study 1 and the continuation runner are untouched.
 *
 * Every record is bound to its agent, tick, perspective, request and the world hash of the state
 * it was derived from; a mirror that disagrees with the host stops the episode.
 */
import { createParticipantState, stepParticipantState, type Genesis, type ParticipantState } from '../agent/participantWorld.js';
import { evidenceHash } from '../agent/replay.js';
import { ContinuationHost, type HostTransition } from '../eval/continuationHost.js';
import type { ActorSpec } from '../eval/constructs/authorityAttribution.js';
import { perceptionRequest, type PerceptionCondition, type PerceptionRecord, type PerceptionRequest, type Perspective } from './perception.js';

export interface PerceptionAgentInput {
  agentId: string; tick: number; worldHash: string; requestId: string; perspective: Perspective;
  perception: PerceptionRecord['observation'];
  self: { role: string; roleEpoch: number; x: number; y: number };
  legalMoves: { x: number; y: number }[];
}
/** Returns a decision candidate; the host's validator admits or rejects it as in the experiment. */
export type PerceptionPolicy = (input: PerceptionAgentInput) => unknown | Promise<unknown>;
export interface PerceptionEpisodePlan {
  episodeId: string; genesis: Genesis; actors: ActorSpec[]; ticks: number;
  condition: PerceptionCondition;
  perspective(agentId: string, tick: number): Perspective;
}
export interface PerceptionEpisodeTick {
  tick: number; worldHash: string; nextWorldHash: string;
  records: PerceptionRecord[];
  verdicts: HostTransition['verdicts'];
  effects: HostTransition['effects'];
}

export async function runPerceptionEpisode(plan: PerceptionEpisodePlan, policies: Record<string, PerceptionPolicy>,
    perceive: (request: PerceptionRequest) => Promise<PerceptionRecord>) {
  const host = new ContinuationHost(plan.genesis, plan.actors);
  const identities = host.identities();
  let mirror: ParticipantState = createParticipantState(plan.genesis);
  const ticks: PerceptionEpisodeTick[] = [];
  for (let i = 0; i < plan.ticks; i++) {
    if (evidenceHash(mirror) !== host.hash) throw Error('perception_mirror_divergence');
    const views = host.views(), worldHash = host.hash, proposals: Record<string, unknown> = {}, records: PerceptionRecord[] = [];
    for (const view of views) {
      const person = identities.find(p => p.actorId === view.actorId)!.person;
      const perspective = plan.perspective(view.actorId, host.tick);
      const request = perceptionRequest(mirror, { agentId: view.actorId, person }, perspective, plan.condition, { episodeId: plan.episodeId, worldHash });
      const record = await perceive(request);
      if (record.requestId !== request.requestId || record.agentId !== view.actorId || record.tick !== host.tick || record.worldHash !== worldHash)
        throw Error('perception_record_binding');
      records.push(record);
      const policy = policies[view.actorId];
      if (!policy) throw Error('perception_policy_missing');
      const { context, projection } = view.observation as unknown as {
        context: { role: string; roleEpoch: number; legalMoves: { x: number; y: number }[] }; projection: { self: { x: number; y: number } } };
      proposals[view.actorId] = await policy(structuredClone({
        agentId: view.actorId, tick: record.tick, worldHash, requestId: record.requestId, perspective,
        perception: record.observation,
        self: { role: context.role, roleEpoch: context.roleEpoch, x: projection.self.x, y: projection.self.y },
        legalMoves: context.legalMoves,
      }));
    }
    const t = host.advance(views, proposals);
    mirror = stepParticipantState(mirror, t.tapeTick.actions, t.tapeTick.online).state;
    if (evidenceHash(mirror) !== t.afterHash) throw Error('perception_mirror_divergence');
    ticks.push({ tick: t.tick, worldHash, nextWorldHash: t.afterHash, records, verdicts: t.verdicts, effects: t.effects });
  }
  return { identities, ticks, finalHash: host.hash, tape: host.tape() };
}
