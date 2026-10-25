/**
 * A3 — world projection and actor mapping (observatory handover, 2026-10-23).
 *
 * The observatory never runs a world of its own. Each committed frame is reconstructed from the
 * experiment's own verified evidence: the original genesis in the first segment's start event,
 * then each recorded transition's tape tick, stepped through the same participant kernel that
 * `replay()` uses. Every reconstructed state must reproduce the recorded state and effects
 * hashes, and the transition's before/after hashes, or the frame is refused. This is a separate
 * read-only reconstruction: it draws no random number for, and cannot touch, a running host.
 *
 * Two outputs, kept apart:
 *   - public: the existing Godot `hello` / `tick` shapes. Handles are per-connection pseudonyms
 *     of the stable PERSON (the registry identity), so a body keeps its handle across a role
 *     change; real ids, wealth, diaries, reasoning and evaluator truth never appear.
 *   - researcher: a privileged snapshot mapping each controlled actor to its person and body.
 */
import { createParticipantState, stepParticipantState, type Genesis, type ParticipantState } from '../../agent/participantWorld.js';
import { digest, evidenceHash, type TapeTick } from '../../agent/replay.js';
import { personBody } from '../../server/observer.js';
import { helloMessage, personHandle, tickMessage, type WireRole, type WorldHelloMessage, type WorldTickMessage } from '../../server/worldProtocol.js';
import type { StartEvidence } from '../../eval/continuationRunner.js';
import type { ObservatoryExperiment } from './ledgerTail.js';

export interface FrameMeta {
  experimentId: string; segmentId: string; sourceTick: number; worldHash: string;
  /** The transition (or, for tick 0, the first start) that committed this frame. */
  cursor: string; segmentRoot: string | null;
  verification: 'replay_verified';
}
export interface ObservatoryMetadata extends FrameMeta { mode: 'replay' | 'live_following'; synthetic: boolean }
/** Keys the compatibility stream adds to hello/tick; the Godot clients read sourceTick, mode, worldHash and synthetic. */
export const METADATA_KEYS = ['experimentId', 'segmentId', 'sourceTick', 'worldHash', 'cursor', 'segmentRoot', 'verification', 'mode', 'synthetic'] as const satisfies readonly (keyof ObservatoryMetadata)[];

const WIRE_ROLE: Record<string, WireRole | null> = { Baker: 'baker', Miller: 'miller', Courier: 'courier', Investigator: 'investigator', ImportExport: 'importExport', Grifter: null };

export class WorldProjection {
  readonly experiment: ObservatoryExperiment;
  #genesis: Genesis | null = null;
  #states: ParticipantState[] = [];
  #meta: FrameMeta[] = [];
  #identities: { actorId: string; person: string }[] = [];
  #seen = -1;

  constructor(experiment: ObservatoryExperiment) { this.experiment = experiment; }

  /** Extend the frame list with every newly committed transition. Pending calls add nothing. */
  sync(): number {
    if (this.experiment.version === this.#seen) return this.#states.length;
    const raw = this.experiment.rawEvents();
    const segments = new Map(this.experiment.segments().map(s => [s.segmentId, s]));
    const first = raw[0];
    if (!first) return 0;
    const start = first.event.data as StartEvidence;
    if (!this.#genesis) {
      this.#genesis = start.genesis;
      const state = createParticipantState(start.genesis);
      this.#states = [state];
      this.#meta = [{ experimentId: this.experiment.registration.experimentId, segmentId: first.segmentId, sourceTick: 0,
        worldHash: evidenceHash(state), cursor: `${first.segmentId}:0`, segmentRoot: segments.get(first.segmentId)!.segmentRoot, verification: 'replay_verified' }];
    } else if (digest(this.#genesis) !== digest(start.genesis)) throw Error('observatory_genesis_changed');
    this.#identities = structuredClone(start.identities);
    const transitions = raw.filter(x => x.event.kind === 'transition');
    for (const t of transitions.slice(this.#states.length - 1)) {
      const d = t.event.data as { tick: number; nextTick: number; beforeHash: string; afterHash: string; tapeTick: TapeTick };
      const before = this.#states.at(-1)!;
      if (d.tick !== before.world.tick || d.beforeHash !== evidenceHash(before) || d.tapeTick.tick !== d.tick) throw Error(`observatory_frame_order:${d.tick}`);
      const result = stepParticipantState(before, d.tapeTick.actions, d.tapeTick.online);
      const hash = evidenceHash(result.state);
      if (hash !== d.tapeTick.stateHash || hash !== d.afterHash || digest(result.effects) !== d.tapeTick.effectsHash) throw Error(`observatory_frame_divergence:${d.tick}`);
      this.#states.push(result.state);
      this.#meta.push({ experimentId: this.experiment.registration.experimentId, segmentId: t.segmentId, sourceTick: d.nextTick,
        worldHash: hash, cursor: `${t.segmentId}:${t.event.seq}`, segmentRoot: segments.get(t.segmentId)!.segmentRoot, verification: 'replay_verified' });
    }
    // Roots arrive when a segment is sealed; the frame's meaning does not change.
    for (const m of this.#meta) m.segmentRoot = segments.get(m.segmentId)?.segmentRoot ?? null;
    this.#seen = this.experiment.version;
    return this.#states.length;
  }

  frames(): FrameMeta[] { this.sync(); return structuredClone(this.#meta); }
  latestTick(): number { this.sync(); return this.#states.length - 1; }
  #state(tick: number): ParticipantState {
    this.sync();
    const s = this.#states[tick];
    if (!s) throw Error('observatory_no_frame');
    return s;
  }
  meta(tick: number): FrameMeta { this.#state(tick); return structuredClone(this.#meta[tick]!); }

  /** The existing Godot hello: static public geometry. */
  publicHello(): WorldHelloMessage { return helloMessage(this.#state(0).world); }

  /** The existing Godot tick shape for one connection. People are keyed by the stable person. */
  publicTick(tick: number, connectionSecret: string): WorldTickMessage {
    const state = this.#state(tick);
    const legacy = tickMessage(state.world, connectionSecret);
    const people = [...state.registry.people.values()].filter(p => p.location !== null).sort((a, b) => a.id.localeCompare(b.id)).map(p => {
      const body = personBody(state, p);
      return { handle: personHandle(connectionSecret, p.id), x: body.x, y: body.y, role: WIRE_ROLE[body.role] ?? null };
    });
    if (people.length !== legacy.people.length) throw Error('observatory_population_mismatch');
    return { ...legacy, people };
  }

  /** Privileged researcher snapshot. Descriptive context, attributed to its producing function. */
  researcherSnapshot(tick: number) {
    const state = this.#state(tick);
    const actors = this.#identities.map(({ actorId, person }) => {
      const p = state.registry.people.get(person);
      if (!p || p.location === null) return { actorId, person, present: false as const };
      const body = personBody(state, p);
      return { actorId, person, present: true as const, role: body.role, roleEpoch: p.roleEpoch, workplace: body.workplace,
        x: body.x, y: body.y, wealth: body.wealth, price: body.price };
    });
    return {
      tick, worldHash: this.#meta[tick]!.worldHash, actors,
      world: { day: state.world.tick, economicHealth: state.world.economicHealth, wealthGini: state.world.wealthGini,
        population: [...state.registry.people.values()].filter(p => p.location !== null).length },
      attribution: { economicHealth: 'World.economicHealth (kernel)', wealthGini: 'World.wealthGini (kernel descriptive statistic)', actors: 'personBody(state, registry person)' },
    };
  }

  /** Backend only: the reconstructed state, for adapters that need the full kernel view. */
  stateAt(tick: number): ParticipantState { return this.#state(tick); }
}

/** Metadata the compatibility stream adds; the Godot client ignores keys it does not read. */
export function frameMetadata(projection: WorldProjection, tick: number, mode: ObservatoryMetadata['mode']): ObservatoryMetadata {
  return { ...projection.meta(tick), mode, synthetic: projection.experiment.registration.synthetic === true };
}
