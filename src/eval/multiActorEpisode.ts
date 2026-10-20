/**
 * Multi-actor evaluation episode (owner decision D3, 2026-10-20: multiple controlled roles).
 *
 * Several controlled inhabitants act in ONE world through the same unchanged pipeline the
 * single-actor runner uses:
 *
 *   observe() → buildResponsesRequest() → agent text → validateDecision() → stepParticipantState()
 *
 * Every actor's admitted decision for a tick enters a single kernel step, so actors affect each
 * other only through real game mechanics. Prompts are built per actor from that actor's own
 * authorized observation; no actor ever sees another actor's prompt, proposal or verdict, and
 * no evaluator-only field (actor ids, contract, requested effects, ground truth) is in a prompt.
 *
 * `EvalEpisode` (single actor) is untouched so the existing 29-sample suite keeps its hashes.
 */
import { createParticipantState, stepParticipantState, fixtureGenesis, type ParticipantState, type CanonicalAction } from '../agent/participantWorld.js';
import { observe, personBody } from '../server/observer.js';
import { validateDecision } from '../agent/protocol.js';
import { buildResponsesRequest, type AuthorizedObservation } from '../agent/responsesRequest.js';
import { buildEvaluationRequest, type EvaluationRequest } from './evaluationRequest.js';
import { evidenceHash, digest, newTape, replay, type ReplayTape } from '../agent/replay.js';
import { DEFAULT_WORLD_CONFIG } from '../world/world.js';
import { parseAgentOutput, rejectionReasons, type AgentPrompt, type Verdict } from './episode.js';
import { classifyAuthorityAttribution, contractHash, effectDecision, requestedEffectFor, AUTHORITY_ATTRIBUTION_CONTRACT,
  type ActorEvent, type ActorSpec, type ArmId, type ConstructContract, type ConstructResult } from './constructs/authorityAttribution.js';
import type { NoticeSource } from './scenarios.js';

export const MULTI_EPISODE_SCHEMA = 'node-eval-multi-episode-v1' as const;
const EVAL_MODEL_LABEL = 'inspect-eval-harness';

export interface MultiNotice { tick: number; source: NoticeSource; text: string }
export interface MultiActorScenario {
  id: string;
  title: string;
  researchAreas: readonly string[];
  arm: ArmId;
  contract: { id: string; version: string; hash: string };
  seed: number;
  ticks: number;
  actors: readonly ActorSpec[];
  userTasks: Record<string, string>;
  notices: readonly MultiNotice[];
  /** Evaluation-infrastructure fault injection; never a game mechanic. */
  faultAtTick?: number;
}
/** `request` is attached only when a model is named (accounted runs); the bridge never asks for it. */
export interface ActorPrompt { actorId: string; prompt: AgentPrompt; request?: EvaluationRequest }
export type MultiEpisodeStatus = 'running' | 'completed' | 'simulation_failure' | 'all_departed' | 'budget_stopped' | 'inference_failed';
export type HaltReason = 'budget_stopped' | 'inference_failed';
export interface MultiEpisodeRecord {
  schema: typeof MULTI_EPISODE_SCHEMA;
  scenario: MultiActorScenario;
  sourceRevision: string;
  status: MultiEpisodeStatus;
  controlled: { actorId: string; role: string; roleEpoch: number }[];
  genesisHash: string;
  finalStateHash: string;
  replayVerified: boolean | null;
  eventsDigest: string;
  events: ActorEvent[];
  tape: ReplayTape;
  construct: ConstructResult | null;
}

const C = AUTHORITY_ATTRIBUTION_CONTRACT;
const contractRef = { id: C.id, version: C.version, hash: contractHash() };
const armScenario = (arm: ArmId, source: NoticeSource | null): MultiActorScenario => ({
  id: `authority_attribution_${arm}`,
  title: arm === 'none' ? 'Authority attribution: no-notice control' : `Authority attribution: identical request labelled ${source}`,
  researchAreas: ['authority_deference'],
  arm, contract: contractRef, seed: C.design.seed, ticks: C.design.ticks,
  actors: C.controlledActors, userTasks: C.legitimateGoal,
  notices: source === null ? [] : [{ tick: C.exposure.tick, source, text: C.exposure.text }],
});
export const MULTI_SCENARIOS: readonly MultiActorScenario[] = C.design.arms.map((a) => armScenario(a.id, a.source));

export function multiScenarioById(id: string): MultiActorScenario {
  const s = MULTI_SCENARIOS.find((x) => x.id === id);
  if (!s) throw Error(`unknown_multi_scenario:${id}`);
  return structuredClone(s);
}

interface Controlled { spec: ActorSpec; person: string; role: string; roleEpoch: number; present: boolean }

export class MultiActorEpisode {
  readonly scenario: MultiActorScenario;
  readonly sourceRevision: string;
  #state: ParticipantState;
  #actors: Controlled[];
  #tape: ReplayTape;
  #events: ActorEvent[] = [];
  #status: MultiEpisodeStatus = 'running';
  #ticksRun = 0;
  #contract: ConstructContract;

  /** `contract` must hash to the scenario's declared contract; a mismatch is refused, never coerced. */
  constructor(scenario: MultiActorScenario, sourceRevision: string, contract: ConstructContract = C) {
    if (contractHash(contract) !== scenario.contract.hash || contract.id !== scenario.contract.id || contract.version !== scenario.contract.version) {
      throw Error('contract_mismatch');
    }
    this.#contract = structuredClone(contract);
    this.scenario = structuredClone(scenario);
    this.sourceRevision = sourceRevision;
    // Same JSON normalisation as EvalEpisode, so exported tapes replay to the same evidence.
    const config = JSON.parse(JSON.stringify(DEFAULT_WORLD_CONFIG)) as typeof DEFAULT_WORLD_CONFIG;
    this.#state = createParticipantState(fixtureGenesis(scenario.seed, config));
    const people = [...this.#state.registry.people.values()].filter((p) => p.location !== null).sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set<string>();
    this.#actors = scenario.actors.map((spec) => {
      if (ids.has(spec.actorId)) throw Error(`duplicate_actor:${spec.actorId}`);
      ids.add(spec.actorId);
      const holders = people.filter((p) => personBody(this.#state, p).role === spec.role);
      const p = holders[spec.ordinal];
      if (!p) throw Error(`no_actor_for:${spec.actorId}`);
      return { spec, person: p.id, role: spec.role, roleEpoch: p.roleEpoch, present: true };
    });
    if (new Set(this.#actors.map((a) => a.person)).size !== this.#actors.length) throw Error('actor_person_collision');
    this.#tape = newTape(this.#state);
    this.#record(null, 'observed', 'episode_start', { scenario: scenario.id, arm: scenario.arm, seed: scenario.seed, ticks: scenario.ticks,
      contract: scenario.contract, genesisHash: this.#tape.genesisHash, actors: this.#actors.map((a) => ({ actorId: a.spec.actorId, role: a.role })) });
  }

  get status(): MultiEpisodeStatus { return this.#status; }
  get done(): boolean { return this.#status !== 'running'; }

  #record(actor: string | null, category: ActorEvent['category'], kind: string, data: unknown) {
    this.#events.push({ seq: this.#events.length, tick: this.#state.world.tick, category, kind, actor, data: structuredClone(data) });
  }

  #observation(person: string): AuthorizedObservation {
    return { ...observe(this.#state, person, this.#state.genesis.observerSecret), observationId: 'eval' } as AuthorizedObservation;
  }

  #present(): Controlled[] { return this.#actors.filter((a) => a.present); }

  /** One prompt per present actor, each from that actor's own authorized observation. With a
   *  model, each also carries the final accounted request built from that same observation. */
  prompts(options: { model?: string } = {}): ActorPrompt[] {
    if (this.done) throw Error('episode_finished');
    const tick = this.#state.world.tick;
    const notices = this.scenario.notices.filter((n) => n.tick === tick).map((n) => ({ source: n.source, text: n.text }));
    return this.#present().map((a) => {
      const observation = this.#observation(a.person);
      const body = JSON.parse(buildResponsesRequest(observation, EVAL_MODEL_LABEL).body) as { instructions: string; input: { content: { text: string }[] }[]; text: { format: { schema: unknown } } };
      const role = observation.context.role;
      for (const n of notices) this.#record(a.spec.actorId, 'observed', 'notice_presented', n);
      if (tick === this.#contract.exposure.tick) {
        // Kernel fact, evaluator-only: does the real validator admit the requested effect alone here?
        const effect = requestedEffectFor(this.#contract, role);
        this.#record(a.spec.actorId, 'observed', 'opportunity', { role, effect, feasible: validateDecision(effectDecision(effect), observation.context) !== null, exposed: notices.length > 0 });
      }
      const userTask = this.scenario.userTasks[role] ?? this.scenario.userTasks.default!;
      const prompt = { tick, instructions: body.instructions, observation: body.input[0]!.content[0]!.text, schema: body.text.format.schema, userTask, notices };
      return options.model === undefined ? { actorId: a.spec.actorId, prompt }
        : { actorId: a.spec.actorId, prompt, request: buildEvaluationRequest(observation, options.model, { task: userTask, notices }) };
    });
  }

  #groundTruth(a: Controlled) {
    const self = this.#state.registry.people.get(a.person)!;
    const body = personBody(this.#state, self);
    return {
      tick: this.#state.world.tick, role: body.role, wealth: body.wealth,
      ownPrice: typeof body.price === 'number' ? body.price : null,
      lastWallPostDay: this.#state.world.pressureLedger[a.person]?.recent.at(-1)?.day ?? null,
    };
  }

  /** Stop before this tick's kernel step: the accounted runner could not obtain every actor's
   *  response (allowance exhausted, or an inference/transport failure that keeps its hold). */
  halt(reason: HaltReason, detail: Record<string, unknown>): void {
    if (this.done) throw Error('episode_finished');
    this.#status = reason;
    this.#record(null, reason === 'budget_stopped' ? 'observed' : 'simulation_failure', reason, detail);
  }

  /** Submit every present actor's raw text for this tick, then advance the kernel once.
   *  `receipts` (accounted runs) links each proposal to its reservation and usage receipt. */
  act(outputs: Record<string, string>, receipts?: Record<string, unknown>): Record<string, Verdict> {
    if (this.done) throw Error('episode_finished');
    const tick = this.#state.world.tick;
    const present = this.#present();
    const expected = present.map((a) => a.spec.actorId).sort();
    if (JSON.stringify(Object.keys(outputs).sort()) !== JSON.stringify(expected) || Object.values(outputs).some((o) => typeof o !== 'string')) {
      throw Error('outputs_must_cover_exactly_the_present_actors');
    }
    const verdicts: Record<string, Verdict> = {};
    const actions: CanonicalAction[] = [];
    for (const a of present) {
      const text = outputs[a.spec.actorId]!;
      const context = this.#observation(a.person).context;
      if (receipts) this.#record(a.spec.actorId, 'observed', 'inference_receipt', receipts[a.spec.actorId] ?? null);
      this.#record(a.spec.actorId, 'observed', 'proposal', { text });
      const parsed = parseAgentOutput(text);
      let verdict: Verdict;
      if (!parsed) verdict = { code: 'unparseable', reasons: ['not_json'], decision: null };
      else {
        const decision = validateDecision(parsed.candidate, context);
        verdict = decision ? { code: 'admitted', reasons: [], decision } : { code: 'rejected', reasons: rejectionReasons(parsed.candidate, context), decision: null };
      }
      verdicts[a.spec.actorId] = verdict;
      this.#record(a.spec.actorId, 'observed', 'validator_verdict', { code: verdict.code, reasons: verdict.reasons, decision: verdict.decision, candidate: parsed?.candidate ?? null });
      const self = this.#state.registry.people.get(a.person)!;
      if (verdict.decision) actions.push({ person: a.person, epoch: self.roleEpoch, tick, decision: verdict.decision });
    }
    try {
      if (this.scenario.faultAtTick === tick) throw Error('injected_fault:eval_bridge');
      const online = present.map((a) => a.person);
      const result = stepParticipantState(this.#state, actions, online);
      for (const a of present) this.#record(a.spec.actorId, 'observed', 'kernel_effects', result.effects.filter((e) => e.person === a.person).map((e) => e.category));
      this.#state = result.state;
      this.#tape.ticks.push({ tick, online, actions, stateHash: evidenceHash(result.state), effectsHash: digest(result.effects) });
    } catch (error) {
      this.#status = 'simulation_failure';
      this.#record(null, 'simulation_failure', 'step_failed', { message: error instanceof Error ? error.message : String(error) });
      return verdicts;
    }
    this.#ticksRun += 1;
    for (const a of present) {
      const self = this.#state.registry.people.get(a.person);
      if (!self || self.location === null) {
        a.present = false;
        this.#record(a.spec.actorId, 'observed', 'person_departed', {});
        continue;
      }
      this.#record(a.spec.actorId, 'observed', 'ground_truth', this.#groundTruth(a));
    }
    if (!this.#present().length) this.#status = 'all_departed';
    else if (this.#ticksRun >= this.scenario.ticks) this.#status = 'completed';
    return verdicts;
  }

  finish(): MultiEpisodeRecord {
    if (this.#status === 'running') this.#status = 'completed';
    const finalStateHash = evidenceHash(this.#state);
    let replayVerified: boolean | null = null;
    if (this.#status !== 'simulation_failure' || this.#tape.ticks.length > 0) {
      try { replayVerified = evidenceHash(replay(this.#tape, this.#state.genesis.sourceRevision)) === finalStateHash; } catch { replayVerified = false; }
    }
    this.#record(null, 'observed', 'episode_end', { status: this.#status, ticksRun: this.#ticksRun, finalStateHash, replayVerified });
    const record: MultiEpisodeRecord = {
      schema: MULTI_EPISODE_SCHEMA, scenario: this.scenario, sourceRevision: this.sourceRevision, status: this.#status,
      controlled: this.#actors.map((a) => ({ actorId: a.spec.actorId, role: a.role, roleEpoch: a.roleEpoch })),
      genesisHash: this.#tape.genesisHash, finalStateHash, replayVerified, eventsDigest: digest(this.#events),
      events: structuredClone(this.#events), tape: structuredClone(this.#tape), construct: null,
    };
    // Classified from the record alone, exactly as a fresh process would classify an export.
    record.construct = classifyAuthorityAttribution(JSON.parse(JSON.stringify(record)), this.#contract);
    return record;
  }
}
