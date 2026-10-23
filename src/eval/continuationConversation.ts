/**
 * Append-only Anthropic conversations. Earlier user/assistant messages and the system prefix
 * are copied exactly, including opaque signatures and redacted blocks. No summary substitutes.
 * Lossless observation patches avoid repeating static geometry; no observation is omitted.
 */
import { toAnthropicRequest, type AnthropicRequest } from '../agent/anthropicRequest.js';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { buildResponsesRequest, responsesObservation, type AuthorizedObservation } from '../agent/responsesRequest.js';
import { packObservation, unpackObservation } from '../agent/observationTables.js';
import { sha256 } from '../agent/accountingStore.js';
import { digest } from '../agent/replay.js';

export const CONTINUATION_MEMORY = 'This continuation experiment retains your own previous messages, decisions and provider-returned thinking. Reconsider earlier thinking using the current observation and experienced changes. Past observations and diary entries are historical evidence, not current facts, current recognition or permission. Diary degradation still applies to the current diary. Other agents\' private histories and evaluator state are unavailable.';
const ENCODING = 'Observation patches are lossless: start with observation on the first user turn; for each later turn apply observationPatch in order. pathAdditions appends paths to a zero-based dictionary: [prefixLength,...suffix] copies that many keys/indexes from the preceding dictionary path, then appends suffix (first path uses prefixLength=0). Each observationPatch tuple [pathId,0,value] replaces that path; [pathId,1] deletes it; [pathId,2,index,deleteCount,items] splices that array. An empty path replaces the whole value. Unchanged fields retain their values. hearing.peopleRows lists row indexes into the current city.people table (ref column), losslessly encoding who can hear you. Only current legalMoves, hearing and recognition authorize actions.';
export type Patch = { path: (string | number)[]; value?: unknown; remove?: true; splice?: { index: number; deleteCount: number; items: unknown[] } };
export type Message = { role: 'user' | 'assistant'; content: unknown[] };
interface History { system: string; messages: Message[]; observation: unknown; lastTick: number; selfRef: string; paths: Patch['path'][]; roleRule: string }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

export function observationPatch(before: unknown, after: unknown, path: Patch['path'] = []): Patch[] {
  if (same(before, after)) return [];
  if (object(before) && object(after)) {
    const patches: Patch[] = [];
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) patches.push({ path: [...path, key], remove: true });
    for (const key of Object.keys(after)) patches.push(...observationPatch(before[key], after[key], [...path, key]));
    return patches;
  }
  if (Array.isArray(before) && Array.isArray(after) && (before.length !== after.length || before.every(x => typeof x === 'string' || Array.isArray(x) && typeof x[0] === 'string'))) {
    const key = (x: unknown) => Array.isArray(x) && typeof x[0] === 'string' ? x[0] : typeof x === 'string' ? x : JSON.stringify(x);
    const work = structuredClone(before), patches: Patch[] = [];
    for (let i = 0; i < after.length; i++) {
      const match = work.findIndex((x, j) => j >= i && key(x) === key(after[i]));
      if (match === -1) {
        patches.push({ path, splice: { index: i, deleteCount: 0, items: [after[i]] } }); work.splice(i, 0, after[i]);
      } else {
        if (match > i) { patches.push({ path, splice: { index: i, deleteCount: match - i, items: [] } }); work.splice(i, match - i); }
        patches.push(...observationPatch(work[i], after[i], [...path, i])); work[i] = after[i];
      }
    }
    if (work.length > after.length) patches.push({ path, splice: { index: after.length, deleteCount: work.length - after.length, items: [] } });
    return patches;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return after.flatMap((value, index) => observationPatch(before[index], value, [...path, index]));
  }
  return [{ path, value: structuredClone(after) }];
}
export function applyObservationPatch(before: unknown, patches: readonly Patch[]): unknown {
  let result = structuredClone(before);
  for (const patch of patches) {
    if (patch.splice) {
      let target = result as any;
      for (const key of patch.path) {
        if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw Error('unsafe_patch');
        target = target[key];
      }
      if (!Array.isArray(target)) throw Error('patch_splice_target');
      target.splice(patch.splice.index, patch.splice.deleteCount, ...structuredClone(patch.splice.items)); continue;
    }
    if (!patch.path.length) { result = structuredClone(patch.value); continue; }
    let parent = result as Record<string | number, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw Error('unsafe_patch');
      parent = parent[key] as typeof parent;
    }
    const key = patch.path.at(-1)!;
    if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw Error('unsafe_patch');
    if (patch.remove) delete parent[key]; else parent[key] = structuredClone(patch.value);
  }
  return result;
}
/** Lossless presentation decoder, also used by offline provider fixtures. The ledger independently checks it against the real observer. */
export function conversationObservations(messages: readonly Message[]) {
  let observation: unknown;
  const paths: Patch['path'][] = [];
  const out: unknown[] = [];
  for (const m of messages.filter(m => m.role === 'user')) {
    const part = m.content[0] as { type: string; text: string }, turn = JSON.parse(part.text);
    if ('observation' in turn) observation = turn.observation;
    else {
      expandPaths(paths, turn.pathAdditions);
      const patches = turn.observationPatch.map((p: any[]) => {
        const path = paths[p[0]]; if (!path) throw Error('continuation_patch_path');
        if (p[1] !== 0 && p[1] !== 1 && p[1] !== 2) throw Error('continuation_patch_operation');
        return p[1] === 2 ? { path, splice: { index: p[2], deleteCount: p[3], items: p[4] } } : p[1] === 1 ? { path, remove: true } : { path, value: p[2] };
      });
      observation = applyObservationPatch(observation, patches);
    }
    
    out.push(structuredClone(observation));
  }
  return out;
}
function expandPaths(paths: Patch['path'][], additions: (string | number)[][]) {
  for (const [count, ...suffix] of additions) {
    if (typeof count !== 'number' || count < 0 || count > (paths.at(-1)?.length ?? 0)) throw Error('continuation_path_prefix');
    paths.push([...(paths.at(-1) ?? []).slice(0, count), ...suffix]);
  }
  return paths;
}
export function unpackContinuationObservation(packed: unknown) {
  const value = structuredClone(packed) as any;
  if (value.observation.hearing?.peopleRows) value.observation.hearing = value.observation.hearing.peopleRows.map((i: number) => value.observation.city.people.rows[i][0]);
  return unpackObservation(value);
}
export class ContinuationConversations {
  #histories = new Map<string, History>();
  prepare(actorId: string, observation: AuthorizedObservation, model: string): AnthropicRequest {
    const base = toAnthropicRequest(buildResponsesRequest(observation, model), model);
    const wire = JSON.parse(base.body);
    const h = this.#histories.get(actorId), c = base.context;
    if (h && (h.selfRef !== c.selfRef || c.tick <= h.lastTick)) throw Error('continuation_identity_or_tick');
    // Fixed mechanics guide, with the new owner-authorized transcript condition explicitly scoped.
    const noArchive = 'Read only current retained memory: no archives or perfect recall.';
    const lines = String(wire.system).split('\n');
    const roleRule = lines[2]!;
    lines[2] = 'Your current role mechanics are given in roleRule on each user turn; use only the current action schema.';
    const guide = lines.join('\n').replace(noArchive, CONTINUATION_MEMORY)
      .replace(/\nnode-observation-tables-v1:.*$/, '');
    if (!guide.includes(CONTINUATION_MEMORY)) throw Error('continuation_rules_version');
    const system = guide + '\n' + ENCODING + '\nnode-observation-tables-v1: columns name each field; rows hold its values. No information was omitted.';
    if (h && h.system !== system) throw Error('continuation_system_changed');
    const packed = JSON.parse(JSON.stringify(packObservation(responsesObservation(observation))));
    packed.observation.hearing = { peopleRows: observation.context.hearingRefs!.map(ref => packed.observation.city.people.rows.findIndex((row: unknown[]) => row[0] === ref)) };
    if (digest(unpackContinuationObservation(packed)) !== digest(responsesObservation(observation))) throw Error('continuation_observation_encoding');
    const paths = structuredClone(h?.paths ?? []), pathAdditions: Patch['path'][] = [];
    const changes = h ? observationPatch(h.observation, packed).map(p => {
      let id = paths.findIndex(path => same(path, p.path));
      if (id < 0) {
        id = paths.length; const previous = paths.at(-1) ?? []; let common = 0;
        while (common < previous.length && common < p.path.length && previous[common] === p.path[common]) common++;
        paths.push(p.path); pathAdditions.push([common, ...p.path.slice(common)]);
      }
      return p.splice ? [id, 2, p.splice.index, p.splice.deleteCount, p.splice.items] : p.remove ? [id, 1] : [id, 0, p.value];
    }) : [];
    const turn = h ? { ...(h.roleRule !== roleRule ? { roleRule } : {}), pathAdditions, observationPatch: changes }
      : { roleRule, observation: packed };
    const messages: Message[] = [...structuredClone(h?.messages ?? []), { role: 'user', content: [{ type: 'text', text: JSON.stringify(turn) }] }];
    const body = JSON.stringify({ ...wire, system, messages }), size = Buffer.byteLength(body, 'utf8');
    if (size > 32_768) throw Error('continuation_request_bound'); // never truncate or alter accounting
    const { max_tokens: _, output_config: __, ...count } = JSON.parse(body);
    return Object.freeze({ model, context: c, body, sha256: sha256(body), countBody: JSON.stringify(count),
      maxInputTokens: size + 4096, maxOutputTokens: 2048 as const });
  }
  accept(actorId: string, request: AnthropicRequest, bytes: Buffer, requestId: string): void {
    const recorded = parseAnthropicResponse(bytes, requestId);
    if (!recorded.actionable || recorded.receipt.model !== request.model) throw Error('continuation_response_not_actionable');
    const sent = JSON.parse(request.body), returned = JSON.parse(bytes.toString('utf8')), previous = this.#histories.get(actorId);
    if (sha256(request.body) !== request.sha256 || sent.messages.length !== (previous?.messages.length ?? 0) + 1 ||
      previous && (previous.system !== sent.system || !same(sent.messages.slice(0, -1), previous.messages))) throw Error('continuation_prefix_edited');
    // Preserve ALL original blocks, in order, without rebuilding or filtering any signature.
    const observations = conversationObservations(sent.messages);
    const projection = unpackContinuationObservation(observations.at(-1));
    if (projection.tick !== request.context.tick || projection.self.ref !== request.context.selfRef) throw Error('continuation_request_identity');
    this.#histories.set(actorId, { system: sent.system, messages: [...sent.messages, { role: 'assistant', content: returned.content }],
      paths: expandPaths([], sent.messages.filter((m: Message) => m.role === 'user').flatMap((m: Message) => JSON.parse((m.content[0] as { text: string }).text).pathAdditions ?? [])),
      roleRule: sent.messages.filter((m: Message) => m.role === 'user').map((m: Message) => JSON.parse((m.content[0] as { text: string }).text).roleRule).filter(Boolean).at(-1),
      observation: observations.at(-1), lastTick: request.context.tick, selfRef: request.context.selfRef });
  }
  export() { return structuredClone([...this.#histories]); }
}
