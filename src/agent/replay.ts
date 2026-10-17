import { createHash } from 'node:crypto';
import { createParticipantState, stepParticipantState, type Genesis, type CanonicalAction, type ParticipantState } from './participantWorld.js';

/** Ordered Map/Set contents remain ordered: their iteration can affect the kernel. */
export function canonical(value: unknown): string {
  const active = new Set<object>();
  const encode = (v: unknown, path: string): unknown => {
    if (v === undefined) return ['undefined'];
    if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v,-0) ? ['negative-zero'] : v) : ['number',String(v)];
    if (typeof v === 'bigint') return ['bigint',String(v)];
    if (typeof v === 'symbol') throw Error('unserializable_symbol');
    if (typeof v === 'function') throw Error('unserializable_function');
    if (v === null || typeof v !== 'object') return v;
    if (active.has(v)) throw Error('cyclic_evidence');
    active.add(v);
    let result: unknown;
    if (v instanceof Map) result = ['map',[...v].map(([k,x],i) => [encode(k,`${path}.k${i}`),encode(x,`${path}.v${i}`)])];
    else if (v instanceof Set) result = ['set',[...v].map((x,i) => encode(x,`${path}.${i}`))];
    else if (Array.isArray(v)) result = ['array',v.map((x,i) => encode(x,`${path}.${i}`))];
    else result = ['object',Object.keys(v).sort().filter(k => !(path === '$.world' && k === 'rng' && typeof (v as Record<string,unknown>)[k] === 'function')).map(k => [k,encode((v as Record<string,unknown>)[k],`${path}.${k}`)])];
    active.delete(v); return result;
  };
  return JSON.stringify(encode(value,'$'));
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const evidenceHash = (state: ParticipantState) => digest(state);
export interface TapeTick {tick:number;online:string[];actions:CanonicalAction[];stateHash:string;effectsHash:string}
export interface ReplayTape {genesis:Genesis;genesisHash:string;ticks:TapeTick[]}

export function newTape(state: ParticipantState): ReplayTape {
  if (state.world.tick !== 0) throw Error('genesis_required');
  return {genesis:structuredClone(state.genesis),genesisHash:evidenceHash(state),ticks:[]};
}
export function replay(tape: ReplayTape, expectedSourceRevision: string): ParticipantState {
  if (tape.genesis.sourceRevision !== expectedSourceRevision) throw Error('source_revision_mismatch');
  let state = createParticipantState(tape.genesis);
  if (evidenceHash(state) !== tape.genesisHash) throw Error('genesis_mismatch');
  for (const record of tape.ticks) {
    if (record.tick !== state.world.tick) throw Error(`replay_order:${state.world.tick}`);
    const result = stepParticipantState(state,record.actions,record.online);
    if (evidenceHash(result.state) !== record.stateHash || digest(result.effects) !== record.effectsHash) throw Error(`replay_divergence:${record.tick}`);
    state = result.state;
  }
  return state;
}
