import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { observe } from '../server/observer.js';
import { validateDecision, type Decision } from './protocol.js';
import { OfflineBroker, type FixtureResponse } from './broker.js';
import type { DecisionContext } from './protocol.js';
import { createParticipantState, stepParticipantState, type Genesis, type ParticipantState, type CanonicalAction } from './participantWorld.js';
import { newTape, evidenceHash, digest, type ReplayTape } from './replay.js';

const idle = (): Decision => ({move:null,communication:null,diary:null,role:null});
const object = (v: unknown): v is Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (o: Record<string,unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o,k));

/** In-memory authenticated host. No listener, provider, environment binding or live CLI. */
export class OfflineParticipantHost {
  #state: ParticipantState;
  #token: Buffer;
  #session: string | null = null;
  #closed = false;
  #person: string;
  #pending: Decision = idle();
  #used = new Set<string>();
  #broker = new OfflineBroker();
  #tape: ReplayTape;
  constructor(genesis: Genesis, existingPerson: string, controllerToken: string) {
    if (controllerToken.length < 16 || controllerToken.length > 256) throw Error('invalid_controller_token');
    this.#state = createParticipantState(genesis);
    if (this.#state.registry.people.get(existingPerson)?.location == null) throw Error('unknown_person');
    this.#person = existingPerson; this.#token = Buffer.from(controllerToken);
    this.#tape = newTape(this.#state);
  }
  authenticate(token: string): string {
    if (this.#closed || typeof token !== 'string' || token.length > 256) throw Error('authentication_failed');
    const supplied = Buffer.from(token);
    if (supplied.length !== this.#token.length || !timingSafeEqual(supplied,this.#token)) throw Error('authentication_failed');
    if (this.#session !== null) throw Error('controller_lease_taken');
    this.#session = randomBytes(32).toString('hex'); return this.#session;
  }
  #authorize(session: string): void {
    if (this.#closed || this.#session === null || session !== this.#session || this.#state.registry.people.get(this.#person)?.location == null) throw Error('invalid_session');
  }
  read(session: string) {
    this.#authorize(session);
    const observation = observe(this.#state,this.#person,this.#state.genesis.observerSecret);
    const observationId = createHmac('sha256',this.#token).update(JSON.stringify([session,observation.context])).digest('hex');
    return {...observation,observationId};
  }
  submit(session: string, frame: unknown): void {
    this.#authorize(session);
    if (!object(frame) || !exact(frame,['type','tick','observationId','action','payload']) || frame.type !== 'action') throw Error('invalid_frame');
    const current = this.read(session);
    if (frame.tick !== current.context.tick || frame.observationId !== current.observationId) throw Error('stale_observation');
    const proposed: Decision = idle();
    if (!object(frame.payload) || Object.hasOwn(frame.payload,'kind')) throw Error('invalid_payload');
    let category: keyof Decision;
    switch (frame.action) {
      case 'move': category='move'; proposed.move=frame.payload as Decision['move']; break;
      case 'bakerPrice': category='role'; proposed.role={kind:'bakerPrice',...frame.payload} as Decision['role']; break;
      case 'wallPost': category='communication'; proposed.communication={kind:frame.action,...frame.payload}; break;
      case 'proximityUtterance': category='communication'; proposed.communication={kind:frame.action,context:null,...frame.payload}; break;
      case 'diaryEntry': category='diary'; proposed.diary={context:null,...frame.payload}; break;
      default: throw Error('unknown_action');
    }
    if (this.#used.has(category)) throw Error('category_quota');
    const validated = validateDecision(proposed,current.context);
    if (!validated || validated[category] === null) throw Error('invalid_proposal');
    this.#pending = {...this.#pending,[category]:validated[category]}; this.#used.add(category);
  }
  async evaluateFixture(session: string, fixture: (input: DecisionContext, signal: AbortSignal) => Promise<FixtureResponse>) {
    const observation = this.read(session);
    if (this.#used.size) throw Error('decision_already_pending');
    const result = await this.#broker.evaluate(observation.context,fixture,() => this.read(session).context);
    if (result.kind !== 'validated_offline') return result;
    // Recheck session and observation after asynchronous fixture work before queueing.
    const now = this.read(session);
    if (now.observationId !== observation.observationId || this.#used.size) throw Error('observation_changed');
    this.#pending = result.decision;
    for (const category of ['move','communication','diary','role'] as const) if (result.decision[category] !== null) this.#used.add(category);
    return result;
  }
  advance() {
    if (this.#closed) throw Error('host_closed');
    const person = this.#state.registry.people.get(this.#person)!;
    const online = this.#session !== null && person.location !== null ? [person.id] : [];
    const actions: CanonicalAction[] = this.#used.size ? [{person:person.id,epoch:person.roleEpoch,tick:this.#state.world.tick,decision:structuredClone(this.#pending)}] : [];
    const tick = this.#state.world.tick;
    let result: ReturnType<typeof stepParticipantState>;
    try { result = stepParticipantState(this.#state,actions,online); }
    catch {
      // A failed step may already have advanced the mutable RNG lineage. Never retry
      // that partially executed lineage as though it were a clean pre-tick snapshot.
      this.close(); throw Error('kernel_execution_failed');
    }
    this.#state = result.state; this.#pending=idle(); this.#used.clear();
    this.#tape.ticks.push({tick,online,actions,stateHash:evidenceHash(this.#state),effectsHash:digest(result.effects)});
    if (this.#state.registry.people.get(this.#person)?.location == null) { this.#session=null; this.#closed=true; }
    return structuredClone(result.effects);
  }
  disconnect(session: string): void { this.#authorize(session); this.#session=null; this.#pending=idle(); this.#used.clear(); }
  close(): void { this.#closed=true;this.#session=null;this.#token.fill(0);this.#pending=idle();this.#used.clear(); }
  /** Trusted evaluator-only access; never included in read() or fixture input. */
  exportTape(): ReplayTape { return structuredClone(this.#tape); }
  evidence(): string { return evidenceHash(this.#state); }
}
