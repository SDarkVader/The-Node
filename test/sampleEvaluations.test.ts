import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SAMPLE_EVALUATION_SCHEMA, readSampleEvaluations, validateSampleEvaluationRecord } from '../src/observatory/sampleEvaluations.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const valid = () => ({ schema: SAMPLE_EVALUATION_SCHEMA, evaluationId: 'import:test', collectionId: 'TEST-ONLY-collection', phase: 'evaluation',
  producer: { kind: 'framework', name: 'Inspect AI existing Node scorers', version: '0.3.282' },
  importer: { name: 'inspect_node.observatory_export', version: '1' },
  sourceArtifact: { sha256: 'a'.repeat(64), format: 'node-eval-results-v1', jsonPointer: '/samples/0/scores/constraint_adherence', sourceRevisions: ['b'.repeat(40)] },
  scope: { kind: 'sample', sampleId: 'fixture__scripted', scenario: 'fixture', subject: 'scripted' },
  metricId: 'constraint_adherence', metricVersion: 'inspect-node-scorers-v1', definition: 'Admitted / parseable proposals.',
  status: 'scored', value: 0.5, createdAt: '2026-10-24T10:00:00Z' });
const file = (contents: string) => { const dir = mkdtempSync(join(tmpdir(), 'node-sample-evals-')); dirs.push(dir); const path = join(dir, 'samples.jsonl'); writeFileSync(path, contents); return path; };

describe('separate imported framework samples', () => {
  it('accepts stated sample provenance without a ledger/tick attachment', () => {
    const r = validateSampleEvaluationRecord(valid());
    expect(r.scope.kind).toBe('sample');
    expect(r).not.toHaveProperty('evaluatedThroughTick');
  });
  it('refuses invented ledger scope, unknown payload fields and private path identifiers', () => {
    for (const change of [{ evaluatedThroughTick: 28 }, { inputLedgerRoot: 'a'.repeat(64) }, { rawResponse: 'private' },
      { scope: { kind: 'sample', sampleId: 'C:\\private\\episode.json' } },
      { sourceArtifact: { ...valid().sourceArtifact, path: 'C:\\private\\results.json' } }]) {
      expect(() => validateSampleEvaluationRecord({ ...valid(), ...change })).toThrow('observatory_sample_evaluation_invalid');
    }
  });
  it('keeps inapplicability and infrastructure failure separate from zero', () => {
    for (const status of ['not_applicable', 'not_scorable', 'not_evaluated']) {
      expect(validateSampleEvaluationRecord({ ...valid(), status, value: null, reason: 'Source outcome.' }).value).toBeNull();
      expect(() => validateSampleEvaluationRecord({ ...valid(), status, value: 0 })).toThrow();
    }
    for (const value of [null, NaN, Infinity, 'N', true]) expect(() => validateSampleEvaluationRecord({ ...valid(), value })).toThrow();
  });
  it('rejects invalid count, source hash, timestamp and pointer metadata', () => {
    for (const change of [{ denominator: -1 }, { numerator: 1.2 }, { exclusions: { skipped: true } }, { createdAt: '2026-10-24' },
      { sourceArtifact: { ...valid().sourceArtifact, sha256: 'not-a-hash' } },
      { sourceArtifact: { ...valid().sourceArtifact, jsonPointer: '/private/path' } }]) {
      expect(() => validateSampleEvaluationRecord({ ...valid(), ...change })).toThrow();
    }
  });
  it('deduplicates repeated exact rows but refuses collisions, malformed/partial data and missing files', () => {
    const line = JSON.stringify(valid());
    expect(readSampleEvaluations([file(`${line}\n${line}\n`)])).toHaveLength(1);
    expect(() => readSampleEvaluations([file(`${line}\n${JSON.stringify({ ...valid(), value: 1 })}\n`)])).toThrow('observatory_sample_evaluation_invalid');
    for (const input of ['{"schema":', 'null\n', `${line}\n{"partial":`]) expect(() => readSampleEvaluations([file(input)])).toThrow();
    expect(() => readSampleEvaluations(['TEST-ONLY-does-not-exist'])).toThrow('observatory_sample_evaluation_invalid');
  });
  it('enforces per-record limits rather than accepting a hidden oversized payload', () => {
    const oversized = file(JSON.stringify({ ...valid(), definition: 'x'.repeat(25_000) }));
    expect(() => readSampleEvaluations([oversized])).toThrow();
  });
});
