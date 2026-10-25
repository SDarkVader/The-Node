/** A6: existing Inspect/Study 1 samples are independent of continuation-ledger time.
 * The importer copies separately produced results; it does not run a scorer. Never attach
 * these records to a continuation cursor or display them as scores of the selected tick.
 */
import { lstatSync, readFileSync } from 'node:fs';

export const SAMPLE_EVALUATION_SCHEMA = 'node-observatory-sample-evaluation-v1' as const;
export interface SampleEvaluationRecord {
  schema: typeof SAMPLE_EVALUATION_SCHEMA;
  evaluationId: string; collectionId: string; phase: 'evaluation';
  producer: { kind: 'framework'; name: string; version: string };
  importer: { name: 'inspect_node.observatory_export'; version: '1' };
  sourceArtifact: { sha256: string; format: 'node-eval-results-v1' | 'node-accounted-study-results-unversioned'; jsonPointer: string; sourceRevisions?: string[] };
  scope: { kind: 'sample'; sampleId: string; scenario?: string; subject?: string; arm?: string; replicate?: number };
  metricId: string; metricVersion: string; definition: string;
  status: 'scored' | 'not_applicable' | 'not_scorable' | 'not_evaluated'; value: number | null;
  unit?: string; numerator?: number; denominator?: number; exclusions?: Record<string, number>;
  evidence?: { replayVerified?: boolean; finalStateHash?: string; eventsDigest?: string; genesisHash?: string };
  createdAt: string; reason?: string;
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x: unknown, keys: string[]) => object(x) && Object.keys(x).every(k => keys.includes(k));
const text = (x: unknown, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const id = (x: unknown, max = 128) => typeof x === 'string' && x.length <= max && /^[A-Za-z0-9._:-]+$/.test(x);
const label = (x: unknown) => text(x) && /^[A-Za-z0-9_.:@+ -]+$/.test(x as string);
const count = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const hash = (x: unknown, length = 64) => typeof x === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(x);

/** Strict allowlist: no ledger/tick fields, private paths, provider bytes or hidden payloads. */
export function validateSampleEvaluationRecord(value: unknown): SampleEvaluationRecord {
  const r = value as SampleEvaluationRecord;
  const ok = exact(r, ['schema', 'evaluationId', 'collectionId', 'phase', 'producer', 'importer', 'sourceArtifact', 'scope', 'metricId', 'metricVersion', 'definition', 'status', 'value', 'unit', 'numerator', 'denominator', 'exclusions', 'evidence', 'createdAt', 'reason']) &&
    r.schema === SAMPLE_EVALUATION_SCHEMA && id(r.evaluationId, 200) && id(r.collectionId) && r.phase === 'evaluation' &&
    exact(r.producer, ['kind', 'name', 'version']) && r.producer.kind === 'framework' && text(r.producer.name) && text(r.producer.version) &&
    exact(r.importer, ['name', 'version']) && r.importer.name === 'inspect_node.observatory_export' && r.importer.version === '1' &&
    exact(r.sourceArtifact, ['sha256', 'format', 'jsonPointer', 'sourceRevisions']) && hash(r.sourceArtifact.sha256) &&
    ['node-eval-results-v1', 'node-accounted-study-results-unversioned'].includes(r.sourceArtifact.format) &&
    text(r.sourceArtifact.jsonPointer, 512) && /^\/(?:samples|episodes)\/[0-9]+(?:\/scores\/[A-Za-z0-9_~.-]+)?$/.test(r.sourceArtifact.jsonPointer) &&
    (r.sourceArtifact.sourceRevisions === undefined || Array.isArray(r.sourceArtifact.sourceRevisions) && r.sourceArtifact.sourceRevisions.length <= 100 && r.sourceArtifact.sourceRevisions.every(x => hash(x, 40))) &&
    exact(r.scope, ['kind', 'sampleId', 'scenario', 'subject', 'arm', 'replicate']) && r.scope.kind === 'sample' && label(r.scope.sampleId) &&
    ['scenario', 'subject', 'arm'].every(k => (r.scope as Record<string, unknown>)[k] === undefined || label((r.scope as Record<string, unknown>)[k])) &&
    (r.scope.replicate === undefined || count(r.scope.replicate)) && id(r.metricId) && text(r.metricVersion) && text(r.definition, 2000) &&
    ['scored', 'not_applicable', 'not_scorable', 'not_evaluated'].includes(r.status) &&
    (r.status === 'scored' ? typeof r.value === 'number' && Number.isFinite(r.value) : r.value === null && text(r.reason, 2000)) &&
    (r.unit === undefined || text(r.unit)) && (r.numerator === undefined || count(r.numerator)) && (r.denominator === undefined || count(r.denominator)) &&
    (r.exclusions === undefined || object(r.exclusions) && Object.keys(r.exclusions).length <= 100 && Object.entries(r.exclusions).every(([k, v]) => id(k) && count(v))) &&
    (r.evidence === undefined || exact(r.evidence, ['replayVerified', 'finalStateHash', 'eventsDigest', 'genesisHash']) &&
      (r.evidence.replayVerified === undefined || typeof r.evidence.replayVerified === 'boolean') &&
      ['finalStateHash', 'eventsDigest', 'genesisHash'].every(k => (r.evidence as Record<string, unknown>)[k] === undefined || hash((r.evidence as Record<string, unknown>)[k]))) &&
    text(r.createdAt, 80) && /(?:Z|[+-]\d\d:\d\d)$/.test(r.createdAt) && Number.isFinite(Date.parse(r.createdAt)) &&
    (r.reason === undefined || text(r.reason, 2000));
  if (!ok) throw Error('observatory_sample_evaluation_invalid');
  return r;
}

/** Read trusted local configuration only, with bounded fail-closed parsing and ID collisions. */
export function readSampleEvaluations(files: readonly string[]): SampleEvaluationRecord[] {
  if (!Array.isArray(files) || files.length > 100) throw Error('observatory_sample_evaluation_invalid');
  const rows = new Map<string, SampleEvaluationRecord>();
  try {
    for (const file of files) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw Error();
      for (const line of readFileSync(file, 'utf8').split('\n').filter(line => line.trim().length > 0)) {
        if (line.length > 20_000) throw Error();
        const row = validateSampleEvaluationRecord(JSON.parse(line));
        const key = `${row.collectionId}:${row.evaluationId}`;
        const old = rows.get(key);
        if (old && JSON.stringify(old) !== JSON.stringify(row)) throw Error();
        rows.set(key, row);
        if (rows.size > 10_000) throw Error();
      }
    }
  } catch { throw Error('observatory_sample_evaluation_invalid'); }
  return [...rows.values()];
}
