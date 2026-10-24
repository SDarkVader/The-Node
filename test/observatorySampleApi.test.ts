import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { registration, stagedRun } from './fixtures/observatoryFixture.js';
import { API, startObservatoryServer, type ObservatoryServer } from '../src/observatory/server.js';
import { SAMPLE_EVALUATION_SCHEMA } from '../src/observatory/sampleEvaluations.js';

const handles: { close(): void }[] = [];
let server: ObservatoryServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; for (const h of handles.splice(0)) h.close(); cleanup(); });
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tokens = { researcher: 'TEST-ONLY-sample-researcher', renderer: 'TEST-ONLY-sample-renderer' };
const records = (body: unknown): unknown[] => {
  if (!body || typeof body !== 'object' || !('records' in body) || !Array.isArray(body.records)) throw Error('Expected an API records array');
  return body.records;
};

async function fixture() {
  const { stages } = await stagedRun(handles);
  const source = join(root(), 'source-results.json');
  writeFileSync(source, JSON.stringify({ schema: 'node-eval-results-v1', samples: [{ id: 'fixture', scores: { constraint_adherence: { value: 0.5 } } }] }));
  const row = { schema: SAMPLE_EVALUATION_SCHEMA, evaluationId: 'import:TEST-ONLY', collectionId: 'TEST-ONLY-separate-study', phase: 'evaluation',
    producer: { kind: 'framework', name: 'Inspect AI existing Node scorers', version: '0.3.282' },
    importer: { name: 'inspect_node.observatory_export', version: '1' },
    sourceArtifact: { sha256: sha(source), format: 'node-eval-results-v1', jsonPointer: '/samples/0/scores/constraint_adherence' },
    scope: { kind: 'sample', sampleId: 'fixture', subject: 'scripted' }, metricId: 'constraint_adherence', metricVersion: 'unversioned-scorer',
    definition: 'Admitted parseable proposals / parseable proposals.', status: 'scored', value: 0.5, createdAt: '2026-10-24T10:00:00Z' };
  const imported = join(root(), 'sample-results.jsonl');
  writeFileSync(imported, JSON.stringify(row) + '\n');
  const reg = registration(stages, { sampleEvaluations: [imported] });
  server = await startObservatoryServer([reg], { tokens, pollMs: 100_000 });
  const base = `${server.url}${API}/runs/${reg.experimentId}`;
  const get = async (route: string, token: string = tokens.researcher) => {
    const res = await fetch(base + route, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json() };
  };
  return { source, imported, row, stages, base, get };
}

describe('independent sample evaluation researcher API', () => {
  it('serves separate sample collections to researchers and does not label a world tick as scored', async () => {
    const { row, get } = await fixture();
    const response = await get('/sample-evaluations');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ scope: 'independent_sample_collections', records: [row], notAttachedToTimeline: true });
    expect((await get('/sample-evaluations', tokens.renderer)).status).toBe(403);
    const ledgerEvaluations = await get('/evaluations');
    expect(ledgerEvaluations.status).toBe(200);
    expect(records(ledgerEvaluations.body)).toEqual([]);
    expect(JSON.stringify(ledgerEvaluations.body)).not.toContain(row.collectionId);
  });
  it('changing the display and reading timelines preserves all source and imported bytes', async () => {
    const { source, imported, stages, base, get } = await fixture();
    const paths = [source, imported, ...stages.map(stage => stage.path)];
    const before = paths.map(sha);
    for (const tick of [0, 2, 4]) {
      const res = await fetch(base + '/display', { method: 'POST', headers: { authorization: `Bearer ${tokens.researcher}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'replay', tick }) });
      expect(res.status).toBe(200);
      expect((await get('/timeline')).status).toBe(200);
      expect(records((await get('/sample-evaluations')).body)).toHaveLength(1);
    }
    expect(paths.map(sha)).toEqual(before);
    expect(records((await get('/sample-evaluations')).body)[0]).not.toHaveProperty('evaluatedThroughTick');
  });
  it('fails closed with a fixed error and no partial rows or private path on malformed import', async () => {
    const { imported, row, get } = await fixture();
    writeFileSync(imported, JSON.stringify(row) + '\n{"partial":');
    const response = await get('/sample-evaluations');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'observatory_sample_evaluation_invalid' });
    expect(JSON.stringify(response.body)).not.toContain(imported);
    expect(response.body).not.toHaveProperty('records');
    expect((await get('/sample-evaluations', tokens.renderer)).status).toBe(403);
  });
});
