// New reconstruction, not recovered source. Context must come from a trusted host.
import { SELF_STATES } from '../comms/grammar.js';
import { INTENTS, TONES, CONTEXT_TAGS as SPEECH_CONTEXTS } from '../comms/proximityConversation.js';
import { OBSERVATIONS, READINGS, CONTEXT_TAGS as DIARY_CONTEXTS } from '../engine/diary.js';

export interface DecisionContext {
  tick: number;
  selfRef: string;
  role: string;
  roleEpoch: number;
  legalMoves: readonly { x: number; y: number }[];
  presentRefs: readonly string[];
  knownSubjects: readonly string[];
}
export type JsonObject = Record<string, unknown>;
export interface Decision {
  move: { x: number; y: number } | null;
  communication: JsonObject | null;
  diary: JsonObject | null;
  role: { kind: 'bakerPrice'; price: number } | null;
}
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: JsonObject, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const member = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateContext(c: DecisionContext): void {
  if (!Number.isSafeInteger(c.tick) || c.tick < 0 || !Number.isSafeInteger(c.roleEpoch) || c.roleEpoch < 0 ||
      typeof c.selfRef !== 'string' || !c.selfRef || typeof c.role !== 'string' || !c.role ||
      !Array.isArray(c.legalMoves) || !c.legalMoves.every(p => object(p) && exact(p, ['x', 'y']) && finite(p.x) && finite(p.y)) ||
      !Array.isArray(c.presentRefs) || !c.presentRefs.every(r => typeof r === 'string' && r.length > 0) ||
      !Array.isArray(c.knownSubjects) || !c.knownSubjects.every(r => typeof r === 'string' && r.length > 0)) {
    throw new Error('invalid_context');
  }
}

// Explicit projection: no World, observation token, private evidence, or extra fields.
export function policyInput(c: DecisionContext): DecisionContext {
  validateContext(c);
  return {
    tick: c.tick, selfRef: c.selfRef, role: c.role, roleEpoch: c.roleEpoch,
    legalMoves: c.legalMoves.map(p => ({ x: p.x, y: p.y })),
    presentRefs: [...c.presentRefs], knownSubjects: [...c.knownSubjects],
  };
}

export function validateDecision(value: unknown, c: DecisionContext): Decision | null {
  validateContext(c);
  if (!object(value) || !exact(value, ['move', 'communication', 'diary', 'role'])) return null;
  const { move, communication, diary, role } = value;
  if (move !== null && (!object(move) || !exact(move, ['x', 'y']) || !finite(move.x) || !finite(move.y) ||
      !c.legalMoves.some(p => p.x === move.x && p.y === move.y))) return null;
  if (c.role === 'Grifter' && (communication !== null || diary !== null || role !== null)) return null;
  if (communication !== null) {
    if (!object(communication)) return null;
    if (communication.kind === 'wallPost') {
      if (!exact(communication, ['kind', 'state']) || !member(communication.state, SELF_STATES)) return null;
    } else if (communication.kind === 'proximityUtterance') {
      if (!exact(communication, ['kind', 'intent', 'tone', 'referent', 'context']) ||
          !member(communication.intent, INTENTS) || !member(communication.tone, TONES) ||
          (communication.context !== null && !member(communication.context, SPEECH_CONTEXTS))) return null;
      const r = communication.referent;
      if (!object(r)) return null;
      if (r.kind === 'room') { if (!exact(r, ['kind'])) return null; }
      else if (r.kind === 'player') {
        if (!exact(r, ['kind', 'playerId']) || r.playerId === c.selfRef || !member(r.playerId, c.presentRefs)) return null;
      } else return null;
    } else return null;
  }
  if (diary !== null && (!object(diary) || !exact(diary, ['subject', 'observation', 'reading', 'context']) ||
      diary.subject === c.selfRef || !member(diary.subject, c.knownSubjects) || !member(diary.observation, OBSERVATIONS) ||
      !member(diary.reading, READINGS) || (diary.context !== null && !member(diary.context, DIARY_CONTEXTS)))) return null;
  if (role !== null && (!object(role) || !exact(role, ['kind', 'price']) || role.kind !== 'bakerPrice' ||
      c.role !== 'Baker' || !finite(role.price) || role.price < 0 || role.price > 2)) return null;
  // Detach from the caller; later mutation cannot change an admitted decision.
  return structuredClone(value) as unknown as Decision;
}
