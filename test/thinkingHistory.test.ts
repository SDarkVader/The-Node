import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup } from './fixtures/accountingFixture.js';
import { registration, stagedRun } from './fixtures/observatoryFixture.js';
import { ObservatoryExperiment } from '../src/observatory/ledgerTail.js';
import { decisionRecord } from '../src/observatory/reasoning.js';
import { timeline } from '../src/observatory/timeline.js';
import { buildExternalModelPayload, buildThinkingHistory, exportThinkingCSV, exportThinkingJSON, filterThinkingHistory, formatForExternalModel, searchThinking, type ThinkingHistory } from '../src/observatory/thinkingHistory.js';
import { API, startObservatoryServer, type ObservatoryServer } from '../src/observatory/server.js';

const handles: { close(): void }[] = [];
let server: ObservatoryServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; for (const h of handles.splice(0)) h.close(); cleanup(); });
const tokens = { researcher: 'TEST-ONLY-thinking-researcher', renderer: 'TEST-ONLY-thinking-renderer' };
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function fixture() {
  const { stages } = await stagedRun(handles);
  const reg = registration(stages);
  const experiment = new ObservatoryExperiment(reg); experiment.refresh();
  const ticks = timeline(experiment.events());
  const decisions = new Map(ticks.flatMap(t => t.calls.map(c => [c.requestId, decisionRecord(experiment, c.requestId)] as const)));
  return { stages, reg, ticks, decisions, history: buildThinkingHistory(reg.experimentId, ticks, decisions) };
}

/** Independent RFC 4180 reader, including quoted newlines/commas and escaped quotes. */
function parseCSV(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\r' && input[i + 1] === '\n' && !quoted) { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (quoted) throw Error('unclosed CSV quote');
  return rows;
}

describe('longitudinal thinking history evidence', () => {
  it('joins a parent-linked run once in tick order with exact IDs, hashes, summaries and full actions', async () => {
    const { ticks, decisions, history } = await fixture();
    expect(history.stats).toMatchObject({ totalDecisions: 8, totalTicks: 4, admitted: 8, rejected: 0, pendingAdmission: 0, executed: 8 });
    expect(history.ticks.map(t => t.tick)).toEqual([0, 1, 2, 3]);
    for (const [i, t] of history.ticks.entries()) {
      expect(t.worldHash).toBe(ticks[i]!.worldHashBefore);
      expect(t.nextWorldHash).toBe(ticks[i]!.worldHashAfter);
      for (const d of t.decisions) {
        const source = decisions.get(d.requestId)!;
        expect(d.reasoning).toEqual(source.reasoning);
        expect(d.summaries).toEqual(source.reasoning.summaries);
        expect(d.proposed).toEqual(source.proposed); expect(d.admitted).toEqual(source.admitted);
        expect(d.status).toBe(source.reasoning.status); expect(d.status).not.toBe('accepted');
      }
    }
    const serialized = exportThinkingJSON(history);
    for (const marker of ['TEST-ONLY-signature-', 'TEST-ONLY-opaque-redaction', 'signatureSha256', 'observerSecret', '"raw":']) expect(serialized).not.toContain(marker);
  });
  it('refuses missing, misidentified and duplicated decisions rather than silently dropping rows', async () => {
    const { reg, ticks, decisions } = await fixture();
    const first = ticks[0]!.calls[0]!;
    const missing = new Map(decisions); missing.delete(first.requestId);
    expect(() => buildThinkingHistory(reg.experimentId, ticks, missing)).toThrow('join_mismatch');
    const wrong = new Map(decisions); wrong.set(first.requestId, { ...wrong.get(first.requestId)!, actorId: 'OTHER' });
    expect(() => buildThinkingHistory(reg.experimentId, ticks, wrong)).toThrow('join_mismatch');
    expect(() => buildThinkingHistory(reg.experimentId, [...ticks, ticks[0]!], decisions)).toThrow('join_mismatch');
  });
  it('keeps pending, rejection and returned-summary status independent, preserving uncommitted null hashes and zero latency', async () => {
    const { reg, ticks, decisions } = await fixture();
    const t = structuredClone(ticks[0]!); t.committed = false; t.worldHashAfter = null; t.transitionCursor = null;
    t.calls[0]!.stage = 'rejected'; t.calls[1]!.stage = 'requested';
    for (const [i, c] of t.calls.entries()) {
      const d = decisions.get(c.requestId)!;
      decisions.set(c.requestId, { ...d, admitted: null, executed: false, latencyMs: 0,
        reasoning: { ...d.reasoning, status: i ? 'pending' : 'not_returned', summaries: [] } });
    }
    const history = buildThinkingHistory(reg.experimentId, [t], decisions);
    expect(history.stats).toMatchObject({ totalDecisions: 2, admitted: 0, rejected: 1, pendingAdmission: 1, executed: 0, avgLatencyMs: 0 });
    expect(history.ticks[0]!.nextWorldHash).toBeNull();
    expect(history.ticks[0]!.decisions.map(d => [d.status, d.admissionStatus])).toEqual([['not_returned', 'rejected'], ['pending', 'pending']]);
  });
  it('combines actor/status/keyword/tick filters and recalculates selected statistics without altering full history', async () => {
    const { history } = await fixture();
    const d = history.ticks[1]!.decisions[0]!;
    const before = JSON.stringify(history);
    const query = { actorId: d.actorId, status: d.status, tickFrom: 1, tickTo: 2, summaryKeyword: d.requestId.toUpperCase() };
    expect(searchThinking(history, query).map(r => r.requestId)).toEqual([d.requestId]);
    const filtered = filterThinkingHistory(history, query);
    expect(filtered.stats.totalDecisions).toBe(1); expect(filtered.stats.totalTicks).toBe(1);
    expect(filtered.selection).toEqual(query);
    expect(filterThinkingHistory(history, { summaryKeyword: 'NO-SUCH-SUMMARY' }).stats.totalDecisions).toBe(0);
    expect(() => filterThinkingHistory(history, { tickFrom: 3, tickTo: 1 })).toThrow('tick_range');
    expect(() => filterThinkingHistory(history, { tickFrom: NaN })).toThrow('tick_range');
    expect(JSON.stringify(history)).toBe(before);
    expect(JSON.parse(exportThinkingJSON(history, { from: 1, to: 1 })).stats.totalDecisions).toBe(2);
  });
  it('CSV round-trips multiline quoted text and full action objects; neutralizes spreadsheet formulas only in CSV', async () => {
    const { history } = await fixture();
    const d = history.ticks[0]!.decisions[0]!;
    d.actorId = '=HYPERLINK("https://example.invalid","test")';
    d.summaries = ['A "quoted", first line\nsecond line']; d.reasoning.summaries = [...d.summaries]; d.latencyMs = 0;
    const rows = parseCSV(exportThinkingCSV(history));
    const columns = rows[0]!; const row = rows[1]!;
    expect(row.length).toBe(columns.length);
    expect(row[columns.indexOf('actorId')]).toBe("'" + d.actorId);
    expect(row[columns.indexOf('summaries')]).toBe(d.summaries[0]);
    expect(row[columns.indexOf('latencyMs')]).toBe('0');
    expect(JSON.parse(row[columns.indexOf('proposed')]!)).toEqual(d.proposed);
    expect(JSON.parse(exportThinkingJSON(history)).ticks[0].decisions[0].actorId).toBe(d.actorId);
  });
  it('offline external payload selection actually excludes unselected ticks/actors and never performs network activity', async () => {
    const { history } = await fixture(); const actor = history.ticks[0]!.decisions[0]!.actorId;
    const payload = buildExternalModelPayload(history, { type: 'analyze', tickRange: { from: 1, to: 2 }, actorIds: [actor], query: 'TEST ONLY' });
    expect(payload.thinkingHistory.stats.totalDecisions).toBe(2);
    expect(payload.thinkingHistory.ticks.every(t => t.tick >= 1 && t.tick <= 2 && t.decisions.every(d => d.actorId === actor))).toBe(true);
    expect(formatForExternalModel(payload.thinkingHistory, 'markdown')).toContain('No inferred internal thoughts or evaluation scores');
  });
});

describe('thinking history API wiring and privacy scopes', () => {
  it('serves the script and researcher history/filtered exports; denies renderer, anonymous and invalid requests; preserves source bytes', async () => {
    const { stages, reg, history } = await fixture(); const before = stages.map(s => sha(s.path));
    server = await startObservatoryServer([reg], { tokens, pollMs: 100_000 });
    const base = `${server.url}${API}/runs/${reg.experimentId}/thinking-history`;
    const get = (query = '', token = tokens.researcher) => fetch(base + query, { headers: { authorization: `Bearer ${token}` } });
    expect(await (await get()).json()).toEqual(history);
    expect((await get('', tokens.renderer)).status).toBe(403);
    expect((await fetch(base)).status).toBe(401);
    for (const query of ['?tickFrom=2&tickTo=1', '?tickFrom=-1', '?tickTo=abc', '?tickFrom=', '?format=stream']) expect((await get(query)).status).toBe(400);
    const d = history.ticks[0]!.decisions[0]!;
    const query = `?actorId=${encodeURIComponent(d.actorId)}&tickFrom=1&tickTo=1`;
    const selected = await (await get(query)).json() as ThinkingHistory; expect(selected.stats.totalDecisions).toBe(1);
    const exported = await (await get(query + '&format=csv')).json() as { content: string }; expect(parseCSV(exported.content)).toHaveLength(2);
    expect((await (await get('?format=markdown')).json() as { content: string }).content).toContain(d.requestId);
    const script = await fetch(server.url + '/observatory/thinkingViewer.js'); expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
    expect(script.headers.get('content-security-policy')).toContain("connect-src 'self'");
    const text = await script.text(); expect(text).not.toMatch(/innerHTML|fetch\(|externalModelEndpoint|localStorage/);
    const html = await (await fetch(server.url + '/observatory/')).text();
    expect(html.indexOf('src="thinkingViewer.js"')).toBeLessThan(html.indexOf('src="app.js"'));
    expect(stages.map(s => sha(s.path))).toEqual(before);
  });
});
