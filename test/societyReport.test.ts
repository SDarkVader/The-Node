import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Society, societyConfig, type SocietyTape } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { parseAnthropicResponse } from '../src/agent/anthropicResponse.js';
import { digest } from '../src/agent/replay.js';
import { parseSocietyEvidence, stringifySocietyEvidence } from '../src/society/codec.js';
import { buildSocietyResultsReport, readSocietyResults, societyReportFence, writeSocietyResults, writeSocietyRawResults,
  type SocietyCallReport, type SocietyCallArchive } from '../src/society/report.js';

type Event = { kind: string; data: Record<string, any> };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const encode = (events: Event[]) => events.map(e => JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n') + '\n';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

/** Original boundary views and real deterministic transitions; responses below are labelled
 * synthetic provider fixtures. No sender, allowance, credential or network is constructed. */
function fixture(partial = false) {
  const society = new Society({ seed: 42, sourceRevision: 'TEST_ONLY_society_report',
    config: { ...societyConfig(), pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 } });
  const events: Event[] = [{ kind: 'start', data: { plan: { controlled: society.controlled, sourceRevision: 'TEST_ONLY_society_report', model: 'claude-haiku-5-5' } } }];
  const archives: SocietyCallArchive[] = [];
  let index = 0;
  outer: while (society.tick < 1) for (const person of society.pendingPeople()) {
    const view = society.view(person), action = autonomousPolicy(view.visible);
    if (!society.controlled.includes(person)) { society.submit(person, action); continue; }
    const wire = buildSocietyRequest(view.visible), requestId = sha(`TEST_ONLY_request_${index}`);
    const common = { requestId, index, actorId: person, tick: society.tick, phase: society.phase, episodeId: `TEST_ONLY:${society.phase}` };
    events.push({ kind: 'request', data: { ...common, body: wire.body, sha256: wire.sha256 } });
    events.push({ kind: 'reserved', data: { ...common, ceilingMicroUsd: '100' } });
    events.push({ kind: 'dispatched', data: { ...common, runtimeRevision: 'TEST_ONLY_society_report' } });
    const text = JSON.stringify({ type: 'message', role: 'assistant', id: `msg_TEST_ONLY_${index}`, model: 'claude-haiku-5-5',
      stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'TEST ONLY returned summary.\nSecond line with ``` fenced text.', signature: `TEST_ONLY_signature_${index}` },
        { type: 'text', text: JSON.stringify(action) }], usage: { input_tokens: 1200, output_tokens: 80 } });
    const parsed = parseAnthropicResponse(Buffer.from(text), requestId);
    events.push({ kind: 'response', data: { ...common, rawBase64: Buffer.from(text).toString('base64'), parsed, elapsedMs: 10 } });
    events.push({ kind: 'decision', data: { ...common, person, status: 'validated', action } });
    society.submit(person, action);
    events.push({ kind: 'outcome', data: { ...common, status: 'submitted', reason: null, stage: 'submitted' } });
    archives.push({ index, requestBody: wire.body, responseBase64: Buffer.from(text).toString('base64'), status: { status: 200, bytes: Buffer.byteLength(text) } });
    index++;
    if (partial) break outer;
  }
  const tape = society.exportTape(), summary = { status: partial ? 'stopped' : 'completed', stoppedReason: partial ? 'TEST_ONLY_stop' : null, calls: index, finalTick: society.tick };
  events.push({ kind: 'finish', data: { summary, tape } });
  return { events, archives, tape, summary };
}

describe('factual society evidence exporter', () => {
  it('joins exact context, menus, returned summaries, actions and joint transitions in per-inhabitant chronology', () => {
    const f = fixture(), report = buildSocietyResultsReport({ ...f, eventsText: encode(f.events) });
    expect(report.counts).toEqual({ recordedCalls: 6, responsesAvailable: 6, tapeAdmissions: 6, dailyTransitions: 1, integrityIssues: 0 });
    expect(report.agents).toHaveLength(3);
    for (const agent of report.agents) {
      expect(agent.records.map(r => r.phase)).toEqual(['commit', 'act']);
      expect(agent.records[0]!.sequence).toBeLessThan(agent.records[1]!.sequence);
      for (const r of agent.records) {
        expect(r.request.exactVisibleText).toBe(JSON.stringify(r.authorizedVisible));
        expect(r.submittedAction).toEqual(r.proposedAction);
        expect(r.reasoning.summaries).toEqual(['TEST ONLY returned summary.\nSecond line with ``` fenced text.']);
        expect(r.response.source).toBe('event_and_archive'); expect(r.worldTransition!.day).toBe(1);
      }
    }
  });

  it('a validated proposal alone does not become an admitted action or an executed day', () => {
    const f = fixture(true);
    f.tape.decisions = []; f.tape.transitions = [];
    const outcome = f.events.find(e => e.kind === 'outcome')!; outcome.data.status = 'execution_failed';
    f.events.find(e => e.kind === 'finish')!.data.tape = f.tape;
    const report = buildSocietyResultsReport({ ...f, eventsText: encode(f.events) }), r = report.agents[0]!.records[0]!;
    expect(r.admission).toBe('validated_without_tape_record'); expect(r.submittedAction).toBeNull();
    expect(r.worldTransition).toBeNull(); expect(r.outcomes[0]).toMatchObject({ status: 'execution_failed' });
  });

  it('records an admitted pending action in a partial day without inventing a world transition', () => {
    const f = fixture(true), report = buildSocietyResultsReport({ ...f, eventsText: encode(f.events) });
    const r = report.agents[0]!.records[0]!;
    expect(r.admission).toBe('recorded_in_tape'); expect(r.transitionStatus).toBe('not_recorded');
    expect(r.worldTransition).toBeNull(); expect(report.summary).toMatchObject({ status: 'stopped', finalTick: 0 });
  });

  it('keeps missing responses, transport outcomes and stopped-run errors explicit', () => {
    const f = fixture(true); f.tape.decisions = [];
    f.events = f.events.filter(e => !['response', 'decision'].includes(e.kind));
    f.events.find(e => e.kind === 'outcome')!.data = { ...f.events.find(e => e.kind === 'outcome')!.data, status: 'transport_failed', stage: 'dispatched', reason: 'TEST_ONLY_failure' };
    const report = buildSocietyResultsReport({ ...f, archives: [], eventsText: encode(f.events), errors: ['TEST_ONLY_failure'] });
    const r = report.agents[0]!.records[0]!;
    expect(r.response.source).toBe('unavailable'); expect(r.reasoning.status).toBe('response_unavailable');
    expect(r.reasoning.summaries).toEqual([]); expect(r.admission).toBe('not_recorded'); expect(report.recordedErrors).toMatchObject({ explicit: ['TEST_ONLY_failure'] });
  });

  it('recovers an archived response and terminal recovery result when their event writes are missing', () => {
    const f = fixture(true), outcome = f.events.find(e => e.kind === 'outcome')!.data;
    f.events = f.events.filter(e => !['response', 'outcome'].includes(e.kind));
    f.events.find(e => e.kind === 'finish')!.data.results = [outcome];
    const report = buildSocietyResultsReport({ ...f, eventsText: encode(f.events) }), r = report.agents[0]!.records[0]!;
    expect(r.response.source).toBe('archive'); expect(r.reasoning.status).toBe('summary_returned');
    expect(r.events.some(e => e.kind === 'outcome_recovered')).toBe(true); expect(r.outcomes).toHaveLength(1);
  });

  it('preserves a request sink failure from finish recovery without inventing a dispatch or response', () => {
    const f = fixture(true), request = f.events.find(e => e.kind === 'request')!;
    f.tape.decisions = [];
    const finish = f.events.find(e => e.kind === 'finish')!;
    finish.data.undeliveredEvents = [request]; finish.data.summary.calls = 0;
    f.events = [f.events[0]!, finish];
    const report = buildSocietyResultsReport({ ...f, archives: [], eventsText: encode(f.events) }), r = report.agents[0]!.records[0]!;
    expect(r.request.body).toBe(request.data.body); expect(r.response.source).toBe('unavailable'); expect(r.admission).toBe('not_recorded');
    expect(r.events).toHaveLength(1); expect(r.events[0]).toMatchObject({ line: 2, kind: 'request', provenance: 'finish.undeliveredEvents', recoveryIndex: 0 });
    expect(report.integrityIssues.some(i => i.code === 'sink_write_failure_preserved')).toBe(true);
  });

  it('recovers verbatim response bytes and parsed summaries from undelivered events without archives, deduplicating exact copies', () => {
    const f = fixture(true), response = f.events.find(e => e.kind === 'response')!, request = f.events.find(e => e.kind === 'request')!;
    f.events = f.events.filter(e => e.kind !== 'response');
    f.events.find(e => e.kind === 'finish')!.data.undeliveredEvents = [request, response];
    const report = buildSocietyResultsReport({ ...f, archives: [], eventsText: encode(f.events) }), r = report.agents[0]!.records[0]!;
    expect(r.response.rawBase64).toBe(response.data.rawBase64); expect(r.reasoning.summaries[0]).toContain('Second line with ``` fenced text.');
    expect(r.events.filter(e => e.kind === 'request')).toHaveLength(1);
    expect(r.events.find(e => e.kind === 'response')).toMatchObject({ provenance: 'finish.undeliveredEvents', recoveryIndex: 1 });
    expect(report.integrityIssues.filter(i => i.code === 'sink_write_failure_preserved')).toHaveLength(2);
  });

  it('retains rejected tool/refusal response facts without fabricating admitted actions', () => {
    const f = fixture(true), response = f.events.find(e => e.kind === 'response')!;
    const raw = JSON.parse(Buffer.from(response.data.rawBase64, 'base64').toString());
    raw.stop_reason = 'refusal'; raw.content = [{ type: 'redacted_thinking', data: 'TEST_ONLY_opaque' }, { type: 'tool_use', name: 'exec', input: {} }];
    response.data.rawBase64 = Buffer.from(JSON.stringify(raw)).toString('base64');
    response.data.parsed = parseAnthropicResponse(Buffer.from(JSON.stringify(raw)), response.data.requestId);
    f.tape.decisions = []; f.events = f.events.filter(e => e.kind !== 'decision');
    f.events.find(e => e.kind === 'outcome')!.data.status = 'response_rejected';
    const report = buildSocietyResultsReport({ ...f, archives: [], eventsText: encode(f.events) }), r = report.agents[0]!.records[0]!;
    expect(r.reasoning.status).toBe('redacted_only'); expect(r.reasoning.redactedBlocks).toBe(1);
    expect(r.reasoning.summaries).toEqual([]); expect(r.proposedAction).toBeNull(); expect(r.submittedAction).toBeNull();
    expect(r.response.parsed).toMatchObject({ actionable: false, receipt: { status: 'refused' } });
  });

  it('reports hash/archive conflicts and a truncated event line instead of discarding failure evidence', () => {
    const f = fixture(true); f.events.find(e => e.kind === 'request')!.data.sha256 = 'f'.repeat(64);
    f.archives[0]!.requestBody += ' ';
    f.archives[0]!.responseBase64 = Buffer.from('TEST ONLY malformed archived bytes').toString('base64');
    const report = buildSocietyResultsReport({ ...f, eventsText: encode(f.events) + '{"format":' });
    expect(report.integrityIssues.map(i => i.code)).toEqual(expect.arrayContaining(['request_hash_conflict', 'request_archive_conflict', 'response_archive_conflict', 'event_unreadable']));
    expect(report.agents[0]!.records[0]!.response.archiveRawBase64).toBe(f.archives[0]!.responseBase64);
    expect(report.counts.recordedCalls).toBe(1);
  });

  it('preserves empty versus not-returned summary statuses', () => {
    for (const thinking of [true, false]) {
      const f = fixture(true), response = f.events.find(e => e.kind === 'response')!;
      const raw = JSON.parse(Buffer.from(response.data.rawBase64, 'base64').toString());
      raw.content = raw.content.filter((b: any) => b.type !== 'thinking');
      if (thinking) raw.content.unshift({ type: 'thinking', thinking: '', signature: 'TEST_ONLY_empty_signature' });
      response.data.rawBase64 = Buffer.from(JSON.stringify(raw)).toString('base64');
      response.data.parsed = parseAnthropicResponse(Buffer.from(JSON.stringify(raw)), response.data.requestId);
      const report = buildSocietyResultsReport({ ...f, archives: [], eventsText: encode(f.events) });
      expect(report.agents[0]!.records[0]!.reasoning.status).toBe(thinking ? 'summary_empty' : 'not_returned');
    }
  });

  it('writes lossless JSONL and readable escaped Markdown to fresh outputs and reopens named run files only', () => {
    const root = mkdtempSync(join(tmpdir(), 'TEST-ONLY-society-report-')); roots.push(root);
    const f = fixture(), run = join(root, 'run'); mkdirSync(run);
    writeFileSync(join(run, 'events.jsonl'), encode(f.events)); writeFileSync(join(run, 'society.json'), stringifySocietyEvidence(f.tape));
    writeFileSync(join(run, 'summary.json'), JSON.stringify({ summary: f.summary, errors: ['TEST_ONLY_reported_error'] }));
    writeFileSync(join(run, 'finalization.json'), JSON.stringify({ errors: ['TEST_ONLY_late_close_error'], halted: true }));
    mkdirSync(join(run, 'calls', '00000'), { recursive: true });
    writeFileSync(join(run, 'calls', '00000', 'transport.json'), JSON.stringify({ requestId: f.events.find(e => e.kind === 'request')!.data.requestId,
      index: 0, responsePresent: false, transportError: 'TEST_ONLY_late_transport_fact', aborted: true }));
    writeFileSync(join(run, 'accounting.journal.json'), 'INVALID: MUST NEVER READ THIS FILE');
    writeFileSync(join(run, 'credential'), 'INVALID: MUST NEVER READ THIS FILE');
    const report = readSocietyResults(run), paths = writeSocietyResults(report, join(root, 'export'));
    expect(report.recordedErrors).toMatchObject({ summaryErrors: ['TEST_ONLY_reported_error'], finalization: ['TEST_ONLY_late_close_error'] }); expect(paths.agents).toHaveLength(3);
    expect(report.agents[0]!.records[0]!.response.archiveStatus).toMatchObject({ transport: { transportError: 'TEST_ONLY_late_transport_fact' } });
    for (const [i, agent] of paths.agents.entries()) {
      const restored = readFileSync(agent.jsonl, 'utf8').trim().split('\n').map(line => parseSocietyEvidence<SocietyCallReport>(line));
      expect(digest(restored)).toBe(digest(report.agents[i]!.records));
      const md = readFileSync(agent.markdown, 'utf8');
      expect(md).toContain('TEST ONLY returned summary.\nSecond line with ``` fenced text.');
      expect(md).not.toContain('rawBase64'); expect(md).toContain('Exact visible context sent');
    }
    expect(() => writeSocietyResults(report, paths.outputDirectory)).toThrow('society_report_output_exists');
    const rawPaths = writeSocietyRawResults(report, join(root, 'raw-export'));
    expect(rawPaths.agents).toHaveLength(3); expect(existsSync(join(rawPaths.outputDirectory, 'report.md'))).toBe(false);
    expect(rawPaths.agents.every(a => existsSync(a.jsonl) && !existsSync(a.jsonl.replace(/jsonl$/, 'md')))).toBe(true);
    expect(societyReportFence('```\nverbatim')).toBe('````\n```\nverbatim\n````');
    expect(parseSocietyEvidence<SocietyTape>(readFileSync(join(run, 'society.json'), 'utf8'))).toEqual(f.tape);
  });

  it('keeps archive-only unknown inhabitants as unassigned evidence rather than inventing identity', () => {
    const report = buildSocietyResultsReport({ eventsText: '', archives: [{ index: 3, requestBody: '{}' }] });
    expect(report.agents).toEqual([]); expect(report.unassignedRecords).toHaveLength(1);
    expect(report.unassignedRecords[0]!.person).toBeNull(); expect(report.unassignedRecords[0]!.requestIndex).toBe(3);
  });

  it('binds an archive-only call to an inhabitant only when the complete exact tape context agrees', () => {
    const f = fixture(true), report = buildSocietyResultsReport({ eventsText: '', tape: f.tape, archives: f.archives });
    expect(report.unassignedRecords).toEqual([]); expect(report.counts.recordedCalls).toBe(1);
    expect(report.agents[0]!.records[0]!.admission).toBe('recorded_in_tape');
    expect(report.agents[0]!.records[0]!.requestId).toBeNull();
  });

  it('retains three empty controlled-agent files when approval fails before any runner event', () => {
    const report = buildSocietyResultsReport({ eventsText: '', runStart: { controlled: ['resident0', 'resident1', 'resident2'], sourceRevision: 'TEST_ONLY' },
      finalization: { errors: ['TEST_ONLY_precondition_failure'], halted: true } });
    expect(report.controlled).toHaveLength(3); expect(report.agents.every(a => a.records.length === 0)).toBe(true);
    expect(report.recordedErrors).toMatchObject({ finalization: ['TEST_ONLY_precondition_failure'] }); expect(report.model).toBeNull();
  });
});
