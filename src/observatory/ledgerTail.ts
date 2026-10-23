/**
 * A1 — evidence reader and tailer (observatory handover, 2026-10-23).
 *
 * Reads a registered chain of private continuation ledger segments, read-only, and produces
 * ordered, normalized execution events. It never opens a ledger for writing, never calls a
 * provider and never advances the experiment's host.
 *
 * - Only complete, newline-terminated records are processed. A half-written last line is left
 *   for the next poll; it is never repaired and never handed to the sealed reader.
 * - Every record's seq / previous / hash is checked. A previously seen record that changes, or a
 *   file that shrinks, is a divergence: the tailer keeps what it had verified and reports it.
 * - Each later segment's start event must embed the previous segment, with the recorded root.
 *   Embedded parents are compared, not counted again: one event = segmentId + seq + hash.
 * - A sealed segment (ending in `stop`) is re-verified through the existing
 *   `recoverContinuation`, which replays its world and conversations. Its events then read
 *   `replay_verified`; an unsealed live prefix reads `hash_checked_prefix` and has no root yet.
 */
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { digest } from '../agent/replay.js';
import { recoverContinuation, type ContinuationEvent } from '../eval/continuationLedger.js';
import type { StartEvidence } from '../eval/continuationRunner.js';
import {
  OBSERVATORY_EVENT_SCHEMA, validateRegistration, type Access, type EventType, type ExperimentRegistration,
  type ObservatoryEvent, type Verification,
} from './contracts.js';
import { presentReasoning } from './reasoning.js';

const ROOT = '0'.repeat(64);
const MAX_LEDGER_BYTES = 128 * 1024 * 1024;

export interface SegmentStatus {
  segmentId: string; source: 'file' | 'embedded_parent';
  events: number; sealed: boolean; partialTail: boolean;
  verification: Verification; segmentRoot: string | null; lastEventHash: string | null;
  sourceRunId: string | null; sourceRevision: string | null; revisionPinned: boolean;
  startTick: number | null; endTick: number | null; stopStatus: string | null;
  error: string | null;
}
interface Segment {
  reg: ExperimentRegistration['segments'][number];
  raw: ContinuationEvent[];
  partialTail: boolean;
  sealed: boolean;
  verification: Verification;
  root: string | null;
  error: string | null;
  fileSignature: string | null;
  source: 'file' | 'embedded_parent';
}

/** Complete newline-terminated records of a file, without touching a half-written tail. */
export function readCompleteRecords(path: string): { records: ContinuationEvent[]; partialTail: boolean; signature: string } {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('observatory_ledger_not_file');
  if (stat.size > MAX_LEDGER_BYTES) throw Error('observatory_ledger_bounds');
  const fd = openSync(path, 'r'); // read-only: the runner owns the only writer
  let bytes: Buffer;
  try {
    const size = fstatSync(fd).size;
    bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) { const n = readSync(fd, bytes, read, size - read, read); if (n === 0) break; read += n; }
    bytes = bytes.subarray(0, read);
  } finally { closeSync(fd); }
  const text = bytes.toString('utf8');
  const end = text.lastIndexOf('\n');
  const complete = end < 0 ? '' : text.slice(0, end);
  const records = complete.length ? complete.split('\n').map((line, i) => {
    try { return JSON.parse(line) as ContinuationEvent; } catch { throw Error(`observatory_record_unparseable:${i}`); }
  }) : [];
  return { records, partialTail: end + 1 < text.length, signature: `${stat.size}:${stat.mtimeMs}` };
}

/** seq / previous / hash for one segment, from its own first record. */
export function checkChain(events: readonly ContinuationEvent[]): string | null {
  let previous = ROOT;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.seq !== i || e.previous !== previous || e.hash !== digest([e.seq, e.previous, e.kind, e.data])) return `observatory_chain:${i}`;
    previous = e.hash;
  }
  return null;
}

const sameEvents = (a: readonly ContinuationEvent[], b: readonly ContinuationEvent[]) =>
  a.length === b.length && a.every((e, i) => e.hash === b[i]!.hash);

export class ObservatoryExperiment {
  readonly registration: ExperimentRegistration;
  #segments: Segment[];
  #normalized: ObservatoryEvent[] = [];
  #rawByCursor = new Map<string, ContinuationEvent>();
  #verifiedRoots = new Set<string>();
  #error: string | null = null;
  #version = 0;

  constructor(registration: ExperimentRegistration) {
    this.registration = validateRegistration(structuredClone(registration));
    this.#segments = this.registration.segments.map(reg => ({ reg, raw: [], partialTail: false, sealed: false,
      verification: 'unverified', root: null, error: null, fileSignature: null, source: reg.ledger ? 'file' : 'embedded_parent' }));
  }

  get error() { return this.#error; }
  /** Changes whenever the verified event list changes; clients compare it to skip work. */
  get version() { return this.#version; }

  /** Re-read the registered files. Returns only events not previously published. */
  refresh(): ObservatoryEvent[] {
    if (this.#error) return [];
    const reads: ({ records: ContinuationEvent[]; partialTail: boolean; signature: string } | null)[] = this.#segments.map(s => {
      if (!s.reg.ledger) return null;
      try { return readCompleteRecords(s.reg.ledger); } catch (error) {
        // Never carry a filesystem message (it contains the private path) beyond the backend.
        const code = (error as NodeJS.ErrnoException).code;
        s.error = code ? `observatory_ledger_unreadable:${code}` : (error as Error).message;
        return null;
      }
    });
    if (this.#segments.some(s => s.error)) { this.#error = this.#segments.find(s => s.error)!.error; return []; }
    if (this.#segments.every((s, i) => !reads[i] || reads[i]!.signature === s.fileSignature) && this.#normalized.length) return [];
    // Embedded-only segments are taken from the next segment's start, newest first.
    const next: ContinuationEvent[][] = this.#segments.map((_, i) => reads[i]?.records ?? []);
    for (let i = this.#segments.length - 2; i >= 0; i--) {
      const parent = next[i + 1]![0]?.data?.parent as StartEvidence['parent'] | undefined;
      if (!this.#segments[i]!.reg.ledger) next[i] = parent ? structuredClone(parent.events) : [];
    }
    try {
      for (let i = 0; i < this.#segments.length; i++) this.#accept(i, next[i]!, reads[i]?.partialTail ?? false, reads[i]?.signature ?? null);
    } catch (error) {
      this.#error = (error as Error).message;
      return [];
    }
    return this.#publish();
  }

  #accept(i: number, records: ContinuationEvent[], partialTail: boolean, signature: string | null) {
    const s = this.#segments[i]!;
    // Divergence: anything already seen must still be there, unchanged.
    if (records.length < s.raw.length || !s.raw.every((e, k) => records[k]!.hash === e.hash)) throw Error(`observatory_divergence:${s.reg.segmentId}`);
    const chain = checkChain(records);
    if (chain) throw Error(`${chain}:${s.reg.segmentId}`);
    const start = records[0];
    if (start && start.kind !== 'start') throw Error(`observatory_start_required:${s.reg.segmentId}`);
    if (start) {
      const parent = start.data.parent as StartEvidence['parent'] | undefined;
      if (i === 0 && parent) throw Error('observatory_unregistered_parent');
      if (i > 0) {
        const previous = this.#segments[i - 1]!;
        if (!parent || !previous.sealed || parent.ledgerRoot !== previous.root || !sameEvents(parent.events, previous.raw)) throw Error(`observatory_parent_link:${s.reg.segmentId}`);
      }
    }
    const stop = records.findIndex(e => e.kind === 'stop');
    if (stop >= 0 && stop !== records.length - 1) throw Error(`observatory_after_stop:${s.reg.segmentId}`);
    s.raw = records; s.partialTail = partialTail; s.fileSignature = signature;
    s.sealed = stop >= 0 && !partialTail;
    if (s.sealed) {
      const root = records.at(-1)!.hash;
      if (!this.#verifiedRoots.has(root)) {
        const expected = s.reg.sourceRevision ?? start!.data.sourceRevision;
        const recovered = recoverContinuation(records, expected); // throws on any inconsistency
        if (recovered.ledgerRoot !== root || !recovered.complete) throw Error(`observatory_seal_mismatch:${s.reg.segmentId}`);
        this.#verifiedRoots.add(root);
      }
      s.root = root; s.verification = 'replay_verified';
    } else {
      s.root = null; s.verification = records.length ? 'hash_checked_prefix' : 'unverified';
    }
  }

  #publish(): ObservatoryEvent[] {
    const added: ObservatoryEvent[] = [];
    const known = new Map(this.#normalized.map(e => [e.cursor, e]));
    const next: ObservatoryEvent[] = [];
    const identityOf = new Map<string, string>(); // person -> actorId
    let genesisSourceRevision = '', parentLedgerRoot: string | null = null;
    for (const s of this.#segments) {
      if (!s.raw.length) continue;
      const start = s.raw[0]!.data as StartEvidence;
      if (!genesisSourceRevision) genesisSourceRevision = start.genesis.sourceRevision;
      for (const { actorId, person } of start.identities) identityOf.set(person, actorId);
      parentLedgerRoot = start.parent?.ledgerRoot ?? null;
      let tick = start.parent ? (start.parent.events.at(-1)!.data.summary.ticks as number) : 0;
      for (const raw of s.raw) {
        const cursor = `${s.reg.segmentId}:${raw.seq}`;
        const event = normalize(raw, {
          experimentId: this.registration.experimentId, segmentId: s.reg.segmentId, cursor, sourceRunId: start.runId,
          sourceRevision: start.sourceRevision, genesisSourceRevision, segmentRoot: s.root, parentLedgerRoot,
          verification: s.verification, tick, identityOf,
        });
        if (raw.kind === 'transition') tick = raw.data.nextTick;
        const prior = known.get(cursor);
        if (!prior) added.push(event);
        this.#rawByCursor.set(cursor, raw);
        next.push(event);
      }
    }
    const changed = added.length || next.length !== this.#normalized.length ||
      next.some((e, i) => this.#normalized[i]?.verification !== e.verification || this.#normalized[i]?.segmentRoot !== e.segmentRoot);
    this.#normalized = next;
    if (changed) this.#version++;
    return added;
  }

  /** Events strictly after `cursor` in timeline order (all of them when absent). */
  events(after?: string | null): ObservatoryEvent[] {
    if (!after) return [...this.#normalized];
    const i = this.#normalized.findIndex(e => e.cursor === after);
    if (i < 0) throw Error('observatory_unknown_cursor');
    return this.#normalized.slice(i + 1);
  }
  latestCursor(): string | null { return this.#normalized.at(-1)?.cursor ?? null; }
  segments(): SegmentStatus[] {
    return this.#segments.map(s => {
      const start = s.raw[0]?.data as StartEvidence | undefined;
      const stop = s.raw.at(-1)?.kind === 'stop' ? s.raw.at(-1)!.data.summary : null;
      const transitions = s.raw.filter(e => e.kind === 'transition');
      const startTick = start ? (start.parent ? start.parent.events.at(-1)!.data.summary.ticks : 0) : null;
      return {
        segmentId: s.reg.segmentId, source: s.source, events: s.raw.length, sealed: s.sealed, partialTail: s.partialTail,
        verification: s.verification, segmentRoot: s.root, lastEventHash: s.raw.at(-1)?.hash ?? null,
        sourceRunId: start?.runId ?? null, sourceRevision: start?.sourceRevision ?? null, revisionPinned: !!s.reg.sourceRevision,
        startTick, endTick: transitions.length ? transitions.at(-1)!.data.nextTick : startTick, stopStatus: stop?.status ?? null, error: s.error,
      };
    });
  }
  /** Backend-only access to the original record behind a cursor. Never serialized to a client. */
  raw(cursor: string): ContinuationEvent | undefined { return this.#rawByCursor.get(cursor); }
  /** Backend-only: every original record, timeline order. */
  rawEvents(): { segmentId: string; event: ContinuationEvent }[] {
    return this.#segments.flatMap(s => s.raw.map(event => ({ segmentId: s.reg.segmentId, event })));
  }
}

interface Context {
  experimentId: string; segmentId: string; cursor: string; sourceRunId: string; sourceRevision: string;
  genesisSourceRevision: string; segmentRoot: string | null; parentLedgerRoot: string | null;
  verification: Verification; tick: number; identityOf: Map<string, string>;
}

/** The allowlist. Anything not named here — raw response bytes, request bodies, signatures,
 *  observer secrets, genesis, parent copies, tapes — stays in the backend. */
function normalize(raw: ContinuationEvent, c: Context): ObservatoryEvent {
  const d = raw.data;
  const base = {
    schema: OBSERVATORY_EVENT_SCHEMA, experimentId: c.experimentId, sourceRunId: c.sourceRunId, segmentId: c.segmentId,
    sourceRevision: c.sourceRevision, genesisSourceRevision: c.genesisSourceRevision, cursor: c.cursor,
    segmentRoot: c.segmentRoot, parentLedgerRoot: c.parentLedgerRoot, seq: raw.seq, eventHash: raw.hash,
    type: raw.kind as EventType, phase: 'execution' as const, sourceTick: c.tick, access: 'researcher' as Access,
    verification: c.verification,
  };
  const actor = (person: string) => c.identityOf.get(person) ?? 'uncontrolled';
  switch (raw.kind) {
    case 'start': {
      const s = d as StartEvidence;
      return { ...base, data: {
        mode: s.mode, runId: s.runId, planId: s.plan.id, model: s.plan.model, seed: s.plan.seed, memory: s.plan.memory,
        actors: s.plan.actors.map(a => ({ actorId: a.actorId, role: a.role, ordinal: a.ordinal })),
        maxTicks: s.plan.maxTicks, maxCalls: s.plan.maxCalls, deadlineMs: s.plan.deadlineMs, maxRequestBytes: s.plan.maxRequestBytes ?? null,
        allowance: s.plan.allowance, stopAtTick: s.stopAtTick ?? null, baseline: s.baseline ?? null,
        parentLedgerRoot: s.parent?.ledgerRoot ?? null, genesisSourceRevision: s.genesis.sourceRevision, sourceRevision: s.sourceRevision,
      } };
    }
    case 'request':
      return { ...base, actorId: d.actorId, requestId: d.requestId, worldHashBefore: d.worldHash, data: {
        requestId: d.requestId, actorId: d.actorId, tick: d.tick, worldHash: d.worldHash, requestSha256: d.sha256,
        requestBytes: Buffer.byteLength(d.body, 'utf8'), ceilingMicroUsd: d.ceilingMicroUsd,
        role: d.reservation.participant.role, roleEpoch: d.reservation.participant.roleEpoch,
      } };
    case 'response':
      return { ...base, actorId: d.actorId, requestId: d.requestId, elapsedMs: d.latencyMs, data: {
        requestId: d.requestId, actorId: d.actorId, tick: d.tick, responseSha256: d.sha256, latencyMs: d.latencyMs,
        responseBytes: Buffer.from(d.raw, 'base64').length,
      } };
    case 'receipt':
      return { ...base, actorId: d.actorId, requestId: d.requestId, data: {
        requestId: d.requestId, actorId: d.actorId, receiptId: d.receipt.receiptId, model: d.receipt.model,
        inputTokens: d.receipt.inputTokens, outputTokens: d.receipt.outputTokens, status: d.status, stopReason: d.stopReason,
        reasoning: presentReasoning(d.reasoning), proposed: d.proposed, actionable: d.actionable, bookedMicroUsd: d.bookedMicroUsd,
      } };
    case 'validation':
      return { ...base, actorId: d.actorId, requestId: d.requestId, data: {
        requestId: d.requestId, actorId: d.actorId, tick: d.tick, proposed: d.proposed, admitted: d.admitted,
      } };
    case 'tick_intent':
      return { ...base, worldHashBefore: d.beforeHash, data: {
        tick: d.tick, beforeHash: d.beforeHash, scheduledActors: d.scheduledActors, requests: d.requests, proposals: d.proposals,
      } };
    case 'transition':
      return { ...base, nextTick: d.nextTick, worldHashBefore: d.beforeHash, worldHashAfter: d.afterHash, data: {
        tick: d.tick, nextTick: d.nextTick, scheduledActors: d.scheduledActors, beforeHash: d.beforeHash, afterHash: d.afterHash,
        requests: d.requests, verdicts: d.verdicts, historyHash: d.historyHash,
        effects: (d.effects as { person: string; category: string }[]).map(e => ({ actorId: actor(e.person), category: e.category })),
      } };
    case 'failure':
      return { ...base, actorId: d.actorId, requestId: d.requestId, data: {
        requestId: d.requestId, actorId: d.actorId, tick: d.tick, outcome: d.outcome, held: d.held,
      } };
    case 'stop':
      return { ...base, data: { summary: d.summary } };
    default:
      return { ...base, access: 'researcher', verification: 'unverified', data: { unknownKind: raw.kind } };
  }
}

/** Digest of a list of public events: two clients holding the same list hold the same timeline. */
export const timelineDigest = (events: readonly ObservatoryEvent[]) => digest(events.map(e => [e.cursor, e.eventHash, e.verification]));
