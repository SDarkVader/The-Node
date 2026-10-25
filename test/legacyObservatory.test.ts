import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { OLD, NEW, registration, stagedRun, type Stage } from './fixtures/observatoryFixture.js';
import { recoverContinuation } from '../src/eval/continuationLedger.js';
import { replay, evidenceHash, digest } from '../src/agent/replay.js';
import { responsesObservation } from '../src/agent/responsesRequest.js';
import { tickMessage } from '../src/server/worldProtocol.js';
import { ObservatoryExperiment, readCompleteRecords } from '../src/observatory/legacy/ledgerTail.js';
import { WorldProjection, frameMetadata, METADATA_KEYS } from '../src/observatory/legacy/worldProjection.js';
import { actorObservation, decisionRecord } from '../src/observatory/legacy/reasoning.js';
import { telemetry } from '../src/observatory/legacy/telemetryMetrics.js';
import { timeline } from '../src/observatory/legacy/timeline.js';
import { appendAnnotation, readAnnotations } from '../src/observatory/legacy/annotations.js';
import { authorityApplicability, continuationDiaryRecord, diaryEvaluationRecords } from '../src/observatory/legacy/evaluations.js';
import { exportFrames } from '../src/observatory/legacy/frameExport.js';
import { startObservatoryServer, API } from '../src/observatory/legacy/server.js';
import { GODOT_PATH } from '../src/observatory/legacy/godotBridge.js';
import { validateEvaluationRecord, type ObservatoryEvent } from '../src/observatory/legacy/contracts.js';

const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const loaded = (stages: Stage[], over = {}) => { const e = new ObservatoryExperiment(registration(stages, over)); e.refresh(); return e; };
/** A copy of a ledger with only its first `lines` complete records, and optionally a torn tail. */
function prefix(path: string, lines: number, torn = '') {
  const dir = mkdtempSync(join(tmpdir(), 'node-observatory-prefix-'));
  const kept = readFileSync(path, 'utf8').split('\n').slice(0, lines);
  const text = (kept.length ? kept.join('\n') + '\n' : '') + torn;
  const out = join(dir, 'continuation.ledger.jsonl'); writeFileSync(out, text); return out;
}
const PRIVATE = [/"raw"\s*:/, /observerSecret/, /offline-fixture-observer-secret/, /TEST-ONLY-signature-/, /TEST-ONLY-opaque-redaction/, /signatureSha256/];

describe('A1 evidence reader', () => {
  it('joins a three-segment chain once: unique requests, ticks, roots and state hashes match the recorded evidence', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages), events = e.events();
    expect(e.error).toBeNull();
    const requests = events.filter(x => x.type === 'request');
    expect(new Set(requests.map(x => x.requestId)).size).toBe(8);
    expect(requests).toHaveLength(8); // embedded parents are not counted again
    expect(events.filter(x => x.type === 'start')).toHaveLength(3);
    expect(e.segments().map(s => [s.startTick, s.endTick, s.sealed, s.verification])).toEqual([[0, 1, true, 'replay_verified'], [1, 3, true, 'replay_verified'], [3, 4, true, 'replay_verified']]);
    for (const [i, s] of e.segments().entries()) expect(s.segmentRoot).toBe(recoverContinuation(stages[i]!.events, i ? NEW : OLD).ledgerRoot);
    expect(new Set(events.map(x => x.cursor)).size).toBe(events.length);
    expect(events.every(x => x.schema === 'node-observatory-event-v1' && x.phase === 'execution')).toBe(true);
    expect(events.at(-1)!.data).toMatchObject({ summary: { status: 'completed', ticks: 4, calls: 8 } });
  });

  it('allowlists every event: no raw bytes, signatures, observer secret, genesis or request body reaches a normalized event', async () => {
    const { stages } = await stagedRun(handles);
    const text = JSON.stringify(loaded(stages).events());
    for (const p of PRIVATE) expect(text, String(p)).not.toMatch(p);
    expect(text).not.toContain('"body"');
    expect(text).not.toContain(stages[0]!.path);
  });

  it('derives an embedded-only earlier segment from the next one, and refuses an embedded parent that differs', async () => {
    const { stages } = await stagedRun(handles);
    const reg = registration(stages);
    reg.segments[0] = { segmentId: 'stage-0', sourceRevision: OLD }; reg.segments[1] = { segmentId: 'stage-1', sourceRevision: NEW };
    const e = new ObservatoryExperiment(reg); e.refresh();
    expect(e.error).toBeNull();
    expect(e.segments().map(s => s.source)).toEqual(['embedded_parent', 'embedded_parent', 'file']);
    expect(e.events().filter(x => x.type === 'request')).toHaveLength(8);
    // A registered file that differs from what the next segment embeds is a divergence.
    const other = await stagedRun(handles, { receiptPrefix: 'other-' });
    const mixed = registration([other.stages[0]!, stages[1]!, stages[2]!]);
    const m = new ObservatoryExperiment(mixed); m.refresh();
    expect(m.error).toMatch(/^observatory_parent_link:stage-1$/);
    expect(m.events()).toEqual([]);
  });

  it('processes complete lines only: a torn tail is left alone and the live prefix stays hash_checked with no root', async () => {
    const { stages } = await stagedRun(handles);
    const last = stages[2]!, lines = last.events.length;
    const live = prefix(last.path, lines - 3, '{"seq":' + (lines - 3) + ',"previous":"');
    const e = loaded([stages[0]!, stages[1]!, { ...last, path: live }]);
    expect(e.error).toBeNull();
    const seg = e.segments()[2]!;
    expect(seg).toMatchObject({ sealed: false, partialTail: true, verification: 'hash_checked_prefix', segmentRoot: null, events: lines - 3 });
    expect(e.events().filter(x => x.segmentId === 'stage-2').every(x => x.verification === 'hash_checked_prefix' && x.segmentRoot === null)).toBe(true);
    expect(() => readCompleteRecords(live)).not.toThrow();
    // The same cursor keeps its meaning once the rest of the segment is written and sealed.
    const cursor = e.latestCursor()!;
    writeFileSync(live, readFileSync(last.path));
    const added = e.refresh();
    expect(added.map(x => x.cursor)).toEqual(Array.from({ length: 3 }, (_, i) => `stage-2:${lines - 3 + i}`));
    expect(e.events(cursor).map(x => x.cursor)).toEqual(added.map(x => x.cursor));
    expect(e.segments()[2]).toMatchObject({ sealed: true, verification: 'replay_verified' });
    expect(e.refresh()).toEqual([]); // no duplicates on a repeated poll
  });

  it('detects tampering, truncation and rewritten history and keeps what it had verified', async () => {
    const { stages } = await stagedRun(handles);
    const copy = prefix(stages[0]!.path, stages[0]!.events.length);
    const tampered = readFileSync(copy, 'utf8').replace('"kind":"request"', '"kind":"requesx"');
    const bad = prefix(stages[0]!.path, 0, tampered);
    const t = new ObservatoryExperiment(registration([{ ...stages[0]!, path: bad }])); t.refresh();
    expect(t.error).toMatch(/^observatory_chain:\d+:stage-0$/);
    const e = new ObservatoryExperiment(registration([{ ...stages[0]!, path: copy }])); e.refresh();
    const before = e.events().length;
    writeFileSync(copy, readFileSync(copy, 'utf8').split('\n').slice(0, 3).join('\n') + '\n');
    expect(e.refresh()).toEqual([]);
    expect(e.error).toBe('observatory_divergence:stage-0');
    expect(e.events()).toHaveLength(before);
  });
});

describe('A2 reasoning and observations', () => {
  it('shows exactly the returned summaries with status, withholds signatures and redacted payloads, and reports pending honestly', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages), receipt = e.events().find(x => x.type === 'receipt')!;
    const d = decisionRecord(e, receipt.requestId!);
    expect(d.reasoning).toEqual({ source: 'anthropic_thinking_summary', status: 'summary_returned',
      summaries: ['TEST ONLY: reconsider prior price using the evolved authorized observation.'], redactedBlocks: 1, signedBlocks: 1 });
    expect(d).toMatchObject({ actionable: true, executed: true });
    for (const p of PRIVATE) expect(JSON.stringify(d)).not.toMatch(p);
    // A request whose response has not arrived is pending, not a fabricated summary.
    const lines = stages[0]!.events.findIndex(x => x.kind === 'response');
    const live = prefix(stages[0]!.path, lines);
    const p = loaded([{ ...stages[0]!, path: live }]), req = p.events().find(x => x.type === 'request')!;
    expect(decisionRecord(p, req.requestId!).reasoning).toMatchObject({ status: 'pending', summaries: [] });
  });

  it('decodes the actor view from its own conversation and it agrees with the authorized observer record; history is labelled', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages);
    const view = actorObservation(e, 'baker-0', 3);
    const request = stages[2]!.events.find(x => x.kind === 'request' && x.data.actorId === 'baker-0' && x.data.tick === 3)!;
    expect(view.projection).toEqual(responsesObservation(request.data.observation));
    expect(view.history.map(h => [h.tick, h.label])).toEqual([[0, 'historical'], [1, 'historical'], [2, 'historical']]);
    expect(() => actorObservation(e, 'baker-0', 99)).toThrow('observatory_no_observation');
  });
});

describe('A3 world projection', () => {
  it('reconstructs every committed frame from evidence alone; hashes equal the transitions, the stop summaries and replay()', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages), w = new WorldProjection(e);
    const frames = w.frames();
    expect(frames.map(f => f.sourceTick)).toEqual([0, 1, 2, 3, 4]);
    const transitions = stages.flatMap(s => s.events.filter(x => x.kind === 'transition'));
    expect(frames.slice(1).map(f => f.worldHash)).toEqual(transitions.map(t => t.data.afterHash));
    expect(frames[0]!.worldHash).toBe(transitions[0]!.data.beforeHash);
    for (const s of stages) expect(frames[s.summary.ticks]!.worldHash).toBe(s.summary.finalStateHash);
    const tape = recoverContinuation(stages[2]!.events, NEW).recovery.tape;
    expect(evidenceHash(replay(tape, OLD))).toBe(frames.at(-1)!.worldHash);
  });

  it('refuses a live frame whose recorded hashes the kernel does not reproduce, even when the ledger chain is intact', async () => {
    const { stages } = await stagedRun(handles);
    const last = stages[2]!, cut = last.events.length - 1; // live: stop not yet written
    const events = JSON.parse(JSON.stringify(last.events.slice(0, cut))) as typeof last.events;
    const t = events.find(x => x.kind === 'transition')!;
    t.data.tapeTick.actions = []; // a forged transition, then a consistent re-chain of the file
    let previous = '0'.repeat(64);
    for (const e of events) { e.previous = previous; e.hash = digest([e.seq, previous, e.kind, e.data]); previous = e.hash; }
    const forged = prefix(last.path, 0, events.map(x => JSON.stringify(x)).join('\n') + '\n');
    const e = loaded([stages[0]!, stages[1]!, { ...last, path: forged }]);
    expect(e.error).toBeNull(); // the chain itself is consistent; only the kernel can tell
    expect(e.segments()[2]!.verification).toBe('hash_checked_prefix');
    expect(() => new WorldProjection(e).frames()).toThrow(/^observatory_frame_divergence:3$/);
  });

  it('public frames keep the Godot shape, hold no private field, use per-connection person handles and keep identity across ticks', async () => {
    const { stages } = await stagedRun(handles);
    const w = new WorldProjection(loaded(stages));
    const a = w.publicTick(4, 'conn-a'), b = w.publicTick(4, 'conn-b');
    const legacy = tickMessage(w.stateAt(4).world, 'conn-a');
    const bodies = (people: { x: number; y: number; role: unknown }[]) => people.map(p => `${p.x},${p.y},${p.role}`).sort();
    expect(bodies(a.people)).toEqual(bodies(legacy.people));
    expect(Object.keys(a).sort()).toEqual(Object.keys(legacy).sort());
    expect(a.people.map(p => p.handle)).not.toEqual(b.people.map(p => p.handle));
    const text = JSON.stringify([w.publicHello(), a]);
    for (const k of ['wealth', 'diary', 'observerSecret', 'reasoning', 'sabotage', 'person-', 'baker-0']) expect(text).not.toContain(k);
    // A controlled actor keeps one person, and so one handle, in every frame.
    const snap = (t: number) => w.researcherSnapshot(t).actors.find(x => x.actorId === 'baker-0')!;
    expect(new Set([0, 1, 2, 3, 4].map(t => snap(t).person)).size).toBe(1);
    expect(snap(4)).toMatchObject({ present: true, role: 'Baker' });
    expect(Object.keys(frameMetadata(w, 2, 'replay')).sort()).toEqual([...METADATA_KEYS].sort());
    // Both Godot clients read these metadata keys (and only through .get, so a plain world server stays compatible).
    for (const gd of ['client/scripts/WorldView.gd', 'client/scripts/IsoView.gd']) {
      const src = readFileSync(gd, 'utf8');
      for (const k of ['sourceTick', 'mode', 'worldHash', 'synthetic']) expect(src, gd).toContain(`msg.get("${k}"`);
      expect(src, gd).toContain('connect_to_url(_world_url())');
    }
  });
});

describe('A5 telemetry and the timeline', () => {
  it('counts and money reconcile to the ledger and the allowance; nothing is invented while live', async () => {
    const { stages, budget } = await stagedRun(handles);
    const t = telemetry(loaded(stages).events());
    expect(t).toMatchObject({ call_attempt_count: 8, known_usage_count: 8, executed_decision_count: 8, validator_admission_count: 8,
      completed_tick_count: 4, final_tick: 4, segment_count: 3, pending_request_count: 0, input_tokens: 8 * 1200, output_tokens: 8 * 100 });
    expect(t.booked_micro_usd_total).toBe(budget.view().booked.toString());
    expect(t.held_micro_usd_total).toBe('0');
    expect(t.estimated_list_usd.value).toBeCloseTo((8 * 1200 * 0.1 + 8 * 100 * 0.5) / 1e6, 10);
    const lines = stages[2]!.events.length - 3;
    const live = loaded([stages[0]!, stages[1]!, { ...stages[2]!, path: prefix(stages[2]!.path, lines) }]);
    const lt = telemetry(live.events());
    expect(lt.booked_micro_usd_total).toBeNull();
    expect(lt.unknown).toContain(`accounting:${lt.accounting[0]!.sourceRunId}`);
  });

  it('joins each decision to its committed transition; an uncommitted tick stays uncommitted', async () => {
    const { stages } = await stagedRun(handles);
    const ticks = timeline(loaded(stages).events());
    expect(ticks.map(t => [t.tick, t.committed, t.calls.length, t.calls.every(c => c.executed)])).toEqual([[0, true, 2, true], [1, true, 2, true], [2, true, 2, true], [3, true, 2, true]]);
    const cut = stages[2]!.events.findIndex(x => x.kind === 'tick_intent');
    const live = timeline(loaded([stages[0]!, stages[1]!, { ...stages[2]!, path: prefix(stages[2]!.path, cut) }]).events());
    expect(live.at(-1)).toMatchObject({ tick: 3, committed: false, worldHashAfter: null });
    expect(live.at(-1)!.calls.every(c => !c.executed)).toBe(true);
  });
});

describe('framework jobs and annotations', () => {
  it('runs the existing diary classifier through a contract-aware bridge and records not_applicable for authority attribution', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages);
    const bridge = continuationDiaryRecord(e);
    expect(bridge.rulesTextPresented).toBe(true);
    expect(bridge.record.tape.ticks).toHaveLength(4);
    // Field-for-field: the classifier reads the verdict code, the admitted decision, the candidate
    // and the actor's own kernel effect categories, exactly as MultiActorEpisode records them.
    const intent = stages[0]!.events.find(x => x.kind === 'tick_intent')!.data;
    const transition = stages[0]!.events.find(x => x.kind === 'transition')!.data;
    const verdict = bridge.record.events.find(x => x.kind === 'validator_verdict' && x.actor === 'baker-0' && x.tick === 0)!;
    expect(verdict.data).toEqual({ code: transition.verdicts['baker-0'].code, decision: transition.verdicts['baker-0'].decision, candidate: intent.proposals['baker-0'] });
    expect(bridge.record.events.find(x => x.kind === 'kernel_effects' && x.actor === 'baker-0' && x.tick === 0)!.data).toEqual(['bakerPrice']);
    expect(bridge.record.events.filter(x => x.kind === 'validator_verdict')).toHaveLength(8);
    const { records, result } = diaryEvaluationRecords(e, 'test');
    expect(result!.actors.map(a => a.actorId)).toEqual(['baker-0', 'baker-1']);
    for (const r of records) {
      expect(validateEvaluationRecord(r)).toBe(r);
      expect(r).toMatchObject({ phase: 'evaluation', producer: { kind: 'framework' }, evaluatedThroughTick: 4, inputLedgerRoot: e.segments()[2]!.segmentRoot });
      expect(r.contractHash).toMatch(/^[a-f0-9]{64}$/);
    }
    // No recognised subject in four synthetic ticks: the honest status is not_applicable, not zero.
    expect(records.filter(r => r.metricId === 'diary_adherence').map(r => [r.status, r.value, r.denominator])).toEqual([['not_applicable', null, 0], ['not_applicable', null, 0]]);
    expect(records[0]!.exclusions).toEqual({ not_applicable: 4 });
    expect(authorityApplicability(e)).toMatchObject({ status: 'not_applicable', value: null });
    expect(() => validateEvaluationRecord({ ...records[0]!, status: 'scored', value: 0.5, metricId: undefined })).toThrow('observatory_evaluation_invalid');
  });

  it('annotations are append-only, attributed, chained and refuse evidence that does not exist', async () => {
    const { stages } = await stagedRun(handles);
    const e = loaded(stages), path = join(root(), 'annotations.jsonl');
    const ev = e.events().find(x => x.type === 'receipt')!;
    const ref = { segmentId: ev.segmentId, segmentRoot: ev.segmentRoot, seq: ev.seq, eventHash: ev.eventHash };
    const a = appendAnnotation(path, 'TEST-ONLY-observatory', { author: 'Reviewer One', text: 'Summary mentions the prior price.', evidence: [ref] }, e.events());
    appendAnnotation(path, 'TEST-ONLY-observatory', { author: 'Reviewer One', text: 'Correction.', evidence: [ref], refersTo: a.annotationId }, e.events());
    expect(readAnnotations(path, 'TEST-ONLY-observatory').map(x => [x.seq, x.label, x.refersTo])).toEqual([[0, 'reviewer_interpretation_not_kernel_truth', null], [1, 'reviewer_interpretation_not_kernel_truth', a.annotationId]]);
    expect(() => appendAnnotation(path, 'TEST-ONLY-observatory', { author: 'R', text: 'x', evidence: [{ ...ref, eventHash: 'f'.repeat(64) }] }, e.events())).toThrow('observatory_annotation_unknown_evidence');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Correction.', 'Edited.'));
    expect(() => readAnnotations(path, 'TEST-ONLY-observatory')).toThrow('observatory_annotations_chain:1');
  });

  it('exports replay frames labelled replay, with per-export pseudonyms', async () => {
    const { stages } = await stagedRun(handles);
    const f = exportFrames(new WorldProjection(loaded(stages)));
    expect(f).toMatchObject({ schema: 'node-observatory-frames-v1', mode: 'replay', synthetic: true });
    expect(f.frames.map(x => [x.sourceTick, x.mode])).toEqual([0, 1, 2, 3, 4].map(t => [t, 'replay']));
    for (const p of PRIVATE) expect(JSON.stringify(f)).not.toMatch(p);
  });
});

describe('A4 + A7 server, stream and Godot bridge', () => {
  async function serve(stages: Stage[], extra = {}) {
    const annotations = join(root(), 'annotations.jsonl'), evaluations = join(root(), 'evaluations.jsonl');
    const reg = registration(stages, { annotations, evaluations: [evaluations], ...extra });
    const e = new ObservatoryExperiment(reg); e.refresh();
    writeFileSync(evaluations, [...diaryEvaluationRecords(e, 'test').records, authorityApplicability(e)].map(r => JSON.stringify(r)).join('\n') + '\n{"not":"a record"}\n');
    const tokens = { researcher: 'TEST-ONLY-researcher-token', renderer: 'TEST-ONLY-renderer-token' };
    const s = await startObservatoryServer([reg], { tokens, pollMs: 25 });
    handles.push({ close: () => { void s.close(); } });
    const get = async (path: string, token: string | null = tokens.researcher) => {
      const res = await fetch(s.url + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: res.status, body: await res.json() as any, text: '' };
    };
    return { s, tokens, get, reg };
  }

  it('serves read-only routes with scopes; no response carries a path, secret, raw bytes or signature', async () => {
    const { stages } = await stagedRun(handles);
    const before = stages.map(x => sha(x.path));
    const { s, get, tokens, reg } = await serve(stages);
    const id = 'TEST-ONLY-observatory', base = `${API}/runs/${id}`;
    expect((await get(`${API}/runs`, null)).status).toBe(401);
    expect((await get(`${API}/runs`, 'wrong')).status).toBe(401);
    const runs = await get(`${API}/runs`);
    expect(runs.body.runs[0]).toMatchObject({ experimentId: id, synthetic: true, status: 'stopped', verifiedThroughTick: 4 });
    expect((await get(`${base}/snapshot`, tokens.renderer)).status).toBe(403);
    expect((await get(`${base}/frames/4`, tokens.renderer)).body).toMatchObject({ type: 'tick', sourceTick: 4, experimentId: id });
    const bodies = await Promise.all([`${API}/runs`, base, `${base}/hello`, `${base}/frames/2`, `${base}/snapshot?tick=2`, `${base}/timeline`, `${base}/telemetry`,
      `${base}/evaluations`, `${base}/events`, `${base}/actors/baker-0/observations?tick=1`, `${base}/annotations`].map(p => get(p)));
    for (const b of bodies) expect(b.status).toBe(200);
    const text = JSON.stringify(bodies.map(b => b.body));
    for (const p of PRIVATE) expect(text, String(p)).not.toMatch(p);
    for (const seg of reg.segments) expect(text).not.toContain(seg.ledger!);
    expect(text).not.toContain(tmpdir());
    const evals = bodies[7]!.body;
    expect(evals.rejected).toBe(1);
    expect(evals.records.map((r: any) => r.status)).toContain('not_applicable');
    expect(evals.notEvaluated.map((m: any) => m.metricId)).toContain('reasoning_quality');
    const snap = (await get(`${base}/snapshot?cursor=stage-1:0`)).body;
    expect(snap.frame).toMatchObject({ sourceTick: 1, segmentId: 'stage-0' });
    expect(stages.map(x => sha(x.path))).toEqual(before); // serving changed no evidence
    await s.close();
  });

  it('streams events from a cursor and resumes on reconnect without repeats; annotations and display need the researcher scope', async () => {
    const { stages } = await stagedRun(handles);
    const last = stages[2]!, keep = last.events.length - 4;
    const live = prefix(last.path, keep);
    const { s, tokens, get } = await serve([stages[0]!, stages[1]!, { ...last, path: live }]);
    const base = `${API}/runs/TEST-ONLY-observatory`;
    const first = (await get(`${base}/events`)).body;
    const cursor = first.latestCursor as string;
    expect((await get(`${base}/events?after=nope`)).status).toBe(410);
    const controller = new AbortController();
    const res = await fetch(`${s.url}${base}/events?after=${encodeURIComponent(cursor)}&stream=1`, { headers: { authorization: `Bearer ${tokens.researcher}` }, signal: controller.signal });
    const reader = res.body!.getReader(), received: ObservatoryEvent[] = [];
    writeFileSync(live, readFileSync(last.path)); // the runner finishes the segment
    let buffer = '';
    while (received.length < 4) {
      const { value } = await reader.read(); buffer += Buffer.from(value!).toString('utf8');
      for (const block of buffer.split('\n\n').slice(0, -1)) { const data = block.split('\n').find(l => l.startsWith('data: ') && block.includes('event: observatory')); if (data) received.push(JSON.parse(data.slice(6))); }
      buffer = buffer.split('\n\n').at(-1)!;
    }
    controller.abort();
    expect(received.map(e => e.cursor)).toEqual(Array.from({ length: 4 }, (_, i) => `stage-2:${keep + i}`));
    const again = (await get(`${base}/events?after=${encodeURIComponent(cursor)}`)).body.events;
    expect(again.map((e: ObservatoryEvent) => e.cursor)).toEqual(received.map(e => e.cursor));
    const post = (path: string, body: unknown, token: string) => fetch(s.url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post(`${base}/display`, { mode: 'replay', tick: 2 }, tokens.renderer)).status).toBe(403);
    expect((await post(`${base}/display`, { mode: 'replay', tick: 2 }, tokens.researcher)).status).toBe(200);
    const ref = { segmentId: received[0]!.segmentId, segmentRoot: null, seq: received[0]!.seq, eventHash: received[0]!.eventHash };
    expect((await post(`${base}/annotations`, { author: 'Reviewer', text: 'note', evidence: [ref] }, tokens.renderer)).status).toBe(403);
    expect((await post(`${base}/annotations`, { author: 'Reviewer', text: 'note', evidence: [ref] }, tokens.researcher)).status).toBe(201);
    await s.close();
  });

  it('Godot receives the same run, tick and world hash as the web display; its messages are ignored and nothing changes', async () => {
    const { stages } = await stagedRun(handles);
    const before = stages.map(x => sha(x.path));
    const { s, tokens, get } = await serve(stages);
    const id = 'TEST-ONLY-observatory', ws = s.url.replace('http', 'ws') + `${GODOT_PATH}?run=${id}&token=`;
    await expect(new Promise((resolve, reject) => { const c = new WebSocket(ws + 'wrong'); c.on('open', () => reject(Error('opened'))); c.on('error', resolve); })).resolves.toBeDefined();
    const client = new WebSocket(ws + tokens.renderer), messages: any[] = [];
    client.on('message', m => messages.push(JSON.parse(String(m))));
    await new Promise(r => client.on('open', r));
    while (messages.length < 2) await new Promise(r => setTimeout(r, 10));
    expect(messages[0]).toMatchObject({ type: 'hello', experimentId: id, mode: 'live_following' });
    expect(messages[1]).toMatchObject({ type: 'tick', day: 4, sourceTick: 4 });
    client.send(JSON.stringify({ type: 'action', playerId: 'x', action: { kind: 'bakerPrice', value: 9 } }));
    await fetch(`${s.url}${API}/runs/${id}/display`, { method: 'POST', headers: { authorization: `Bearer ${tokens.researcher}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'replay', tick: 2 }) });
    while (messages.length < 3) await new Promise(r => setTimeout(r, 10));
    const snap = (await get(`${API}/runs/${id}/snapshot`)).body;
    expect(messages[2]).toMatchObject({ type: 'tick', day: 2, sourceTick: 2, worldHash: snap.frame.worldHash, cursor: snap.frame.cursor, mode: 'replay' });
    expect(snap.frame.sourceTick).toBe(2);
    expect(s.bridge.stats().inboundIgnored).toBe(1);
    expect(JSON.stringify(messages)).not.toMatch(/wealth|observerSecret|baker-0|person-/);
    client.close();
    expect(stages.map(x => sha(x.path))).toEqual(before);
    await s.close();
  });
});

describe('the observatory never acts on the experiment', () => {
  it('imports no provider transport, runner, budget writer or world server', () => {
    const files = ['ledgerTail', 'reasoning', 'worldProjection', 'telemetryMetrics', 'annotations', 'evaluations', 'service', 'server', 'godotBridge', 'frameExport', 'timeline', 'auth', 'contracts', 'cli', 'archiveAcceptance', 'acceptanceCli'];
    for (const f of files) {
      const src = readFileSync(`src/observatory/legacy/${f}.ts`, 'utf8');
      for (const banned of ['continuationRunner.js\'', 'runContinuation', 'responsesTransport', 'providerCredential', 'ExperimentBudget', 'startWorldServer', 'createWorld', 'stepWorld', '../server/ws.js', 'anthropic-request.ps1']) {
        expect(src.replace(/import type[^;]+;/g, ''), `${f}: ${banned}`).not.toContain(banned);
      }
    }
  });
});

void copyFileSync; void appendFileSync;
