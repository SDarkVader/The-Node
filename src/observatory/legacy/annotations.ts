/**
 * A8 — human annotation (observatory handover, 2026-10-23).
 *
 * Append-only, hash-chained reviewer annotations linked to verified evidence. An annotation is
 * the named reviewer's interpretation, recorded with its author, time and tool version. It never
 * edits the world, the original reasoning, the ledger or any evaluation, and it is never a score.
 * There is no update or delete: a correction is a new annotation that names the earlier one.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { digest } from '../../agent/replay.js';
import type { EvidenceRef, ObservatoryEvent } from './contracts.js';

export const ANNOTATION_SCHEMA = 'node-observatory-annotation-v1' as const;
export const ANNOTATION_TOOL_VERSION = 'observatory-annotations-1' as const;
const ROOT = '0'.repeat(64);

export interface AnnotationInput {
  author: string;
  text: string;
  evidence: EvidenceRef[];
  kind?: 'interpretation' | 'comment';
  /** An earlier annotation this one corrects or replies to; the earlier one is not changed. */
  refersTo?: string;
}
export interface AnnotationRecord {
  schema: typeof ANNOTATION_SCHEMA;
  seq: number; previous: string; hash: string;
  annotationId: string; experimentId: string;
  author: string; createdAt: string; toolVersion: typeof ANNOTATION_TOOL_VERSION;
  kind: 'interpretation' | 'comment';
  label: 'reviewer_interpretation_not_kernel_truth';
  text: string; evidence: EvidenceRef[]; refersTo: string | null;
}

const hashOf = (r: Omit<AnnotationRecord, 'hash'>) => digest(r);

export function readAnnotations(path: string, experimentId: string): AnnotationRecord[] {
  if (!existsSync(path)) return [];
  if (!lstatSync(path).isFile()) throw Error('observatory_annotations_not_file');
  const text = readFileSync(path, 'utf8');
  if (text && !text.endsWith('\n')) throw Error('observatory_annotations_torn_tail');
  const records = text ? text.trimEnd().split('\n').map(l => JSON.parse(l) as AnnotationRecord) : [];
  let previous = ROOT;
  records.forEach((r, i) => {
    const { hash, ...rest } = r;
    if (r.schema !== ANNOTATION_SCHEMA || r.seq !== i || r.previous !== previous || hash !== hashOf(rest) || r.experimentId !== experimentId) throw Error(`observatory_annotations_chain:${i}`);
    previous = hash;
  });
  return records;
}

/** Append one annotation after checking that every evidence reference names a real event. */
export function appendAnnotation(path: string, experimentId: string, input: AnnotationInput, events: readonly ObservatoryEvent[], now = new Date()): AnnotationRecord {
  const author = String(input.author ?? '').trim(), text = String(input.text ?? '');
  if (!/^[A-Za-z0-9 ._@'-]{1,80}$/.test(author)) throw Error('observatory_annotation_author');
  if (!text.trim() || text.length > 8000) throw Error('observatory_annotation_text');
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 50) throw Error('observatory_annotation_evidence');
  const byCursor = new Map(events.map(e => [`${e.segmentId}:${e.seq}`, e]));
  const evidence = input.evidence.map(ref => {
    const e = byCursor.get(`${ref.segmentId}:${ref.seq}`);
    if (!e || e.eventHash !== ref.eventHash) throw Error('observatory_annotation_unknown_evidence');
    return { segmentId: e.segmentId, segmentRoot: e.segmentRoot, seq: e.seq, eventHash: e.eventHash,
      ...(e.requestId ? { requestId: e.requestId } : {}), ...(e.actorId ? { actorId: e.actorId } : {}) };
  });
  const existing = readAnnotations(path, experimentId);
  if (input.refersTo !== undefined && !existing.some(a => a.annotationId === input.refersTo)) throw Error('observatory_annotation_refers_to');
  const previous = existing.at(-1)?.hash ?? ROOT, seq = existing.length;
  const body: Omit<AnnotationRecord, 'hash'> = {
    schema: ANNOTATION_SCHEMA, seq, previous, annotationId: `${experimentId}:annotation:${seq}`, experimentId,
    author, createdAt: now.toISOString(), toolVersion: ANNOTATION_TOOL_VERSION, kind: input.kind === 'comment' ? 'comment' : 'interpretation',
    label: 'reviewer_interpretation_not_kernel_truth', text, evidence, refersTo: input.refersTo ?? null,
  };
  const record: AnnotationRecord = { ...body, hash: hashOf(body) };
  const line = JSON.stringify(record) + '\n';
  if (!existsSync(path)) {
    const fd = openSync(path, 'wx', 0o600);
    try { writeSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
  } else {
    appendFileSync(path, line, { mode: 0o600 });
    const fd = openSync(path, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  return record;
}
