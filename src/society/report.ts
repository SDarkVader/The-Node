/** Factual, operator-only export of already recorded society evidence. No dispatch, journal,
 * credential, policy execution or interpretation of reasoning belongs in this module. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAnthropicResponse } from '../agent/anthropicResponse.js';
import { digest } from '../agent/replay.js';
import { parseSocietyEvidence, stringifySocietyEvidence } from './codec.js';
import type { SocietyTape, SocietyDecisionRecord, SocietyTransition } from './runtime.js';

type Data = Record<string, any>;
interface ReportEvent {
  line: number; kind: string; data: Data;
  provenance?: 'events.jsonl' | 'finish.undeliveredEvents' | 'finish.results'; recoveryIndex?: number;
}
export interface SocietyCallArchive { index: number; requestBody?: string; responseBase64?: string; status?: unknown }
export interface SocietyReportInput {
  eventsText: string; tape?: SocietyTape; summary?: unknown; errors?: unknown;
  runStart?: unknown; finalization?: unknown;
  archives?: readonly SocietyCallArchive[]; inputIssues?: readonly SocietyReportIssue[];
}
export interface SocietyReportIssue { code: string; eventLine?: number; requestId?: string; detail?: string }
export interface SocietyCallReport {
  sequence: number; person: string | null; initialRole: string | null; day: number | null; phase: string | null;
  requestId: string | null; requestIndex: number | null;
  request: { eventLine: number | null; body: string | null; archiveBody: string | null; recordedSha256: string | null;
    actualSha256: string | null; model: string | null; exactVisibleText: string | null; wire: unknown };
  visible: unknown; legalChoices: unknown; authorizedVisible: unknown;
  response: { source: 'event' | 'archive' | 'event_and_archive' | 'unavailable'; rawBase64: string | null;
    archiveRawBase64: string | null; rawText: string | null; sha256: string | null; parsed: unknown; archiveStatus: unknown };
  reasoning: { source: 'provider_returned_summary'; status: string; summaries: string[]; signatureSha256: string[]; redactedBlocks: number | null };
  proposedAction: unknown; validatedAction: unknown; submittedAction: unknown;
  admission: 'recorded_in_tape' | 'controller_submitted_without_tape_record' | 'validated_without_tape_record' | 'not_recorded';
  worldTransition: SocietyTransition | null;
  transitionStatus: 'daily_transition_recorded' | 'not_recorded';
  events: { line: number; kind: string; data: unknown; provenance?: string; recoveryIndex?: number }[];
  outcomes: unknown[]; issues: SocietyReportIssue[];
}
export interface SocietyResultsReport {
  format: 'node-society-results-v1'; sourceRevision: string | null; model: string | null;
  controlled: string[]; summary: unknown; recordedErrors: unknown;
  runStart: unknown; finalization: unknown;
  counts: { recordedCalls: number; responsesAvailable: number; tapeAdmissions: number; dailyTransitions: number; integrityIssues: number };
  integrityIssues: SocietyReportIssue[];
  agents: { person: string; initialRole: string | null; filename: string; records: SocietyCallReport[] }[];
  unassignedRecords: SocietyCallReport[];
  evidence: { eventsSha256: string; tapeDigest: string | null; archives: { index: number; requestSha256: string | null; responseSha256: string | null }[] };
  notes: string[];
}
const obj = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
const json = (v: unknown) => JSON.stringify(v, null, 2) ?? 'undefined';
/** Choose a fence longer than anything in verbatim content, including malicious Markdown. */
export function societyReportFence(text: string, language = ''): string {
  let width = 3;
  for (const match of text.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1);
  const fence = '`'.repeat(width);
  return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
}

export function buildSocietyResultsReport(input: SocietyReportInput): SocietyResultsReport {
  const issues: SocietyReportIssue[] = [...input.inputIssues ?? []];
  const events: ReportEvent[] = [];
  for (const [index, line] of input.eventsText.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = parseSocietyEvidence<unknown>(line);
      if (!obj(event) || typeof event.kind !== 'string' || !obj(event.data)) throw Error('event_shape');
      events.push({ line: index + 1, kind: event.kind, data: event.data, provenance: 'events.jsonl' });
    } catch (error) { issues.push({ code: 'event_unreadable', eventLine: index + 1,
      detail: error instanceof Error ? error.message : 'unknown' }); }
  }
  const finishEvent = [...events].reverse().find(e => e.kind === 'finish');
  const finish = finishEvent?.data;
  if (Array.isArray(finish?.undeliveredEvents)) for (const [index, recovered] of finish!.undeliveredEvents.entries()) {
    if (!obj(recovered) || typeof recovered.kind !== 'string' || !obj(recovered.data)) {
      issues.push({ code: 'undelivered_event_shape', eventLine: finishEvent!.line, detail: `finish.undeliveredEvents[${index}]` }); continue;
    }
    const duplicate = events.some(e => e.kind === recovered.kind && digest(e.data) === digest(recovered.data));
    issues.push({ code: 'sink_write_failure_preserved', eventLine: finishEvent!.line,
      ...(typeof recovered.data.requestId === 'string' ? { requestId: recovered.data.requestId } : {}),
      detail: `finish.undeliveredEvents[${index}]${duplicate ? ': exact event already persisted' : ': recovered original event data'}` });
    if (!duplicate) events.push({ line: finishEvent!.line, kind: recovered.kind, data: recovered.data,
      provenance: 'finish.undeliveredEvents', recoveryIndex: index });
  }
  const start = events.find(e => e.kind === 'start')?.data;
  let tape = input.tape ?? (obj(finish?.tape) ? finish!.tape as SocietyTape : undefined);
  if (input.tape && finish?.tape && digest(input.tape) !== digest(finish.tape)) issues.push({ code: 'tape_finish_conflict' });
  if (tape && (!Array.isArray(tape.controlled) || !Array.isArray(tape.decisions) || !Array.isArray(tape.transitions))) {
    issues.push({ code: 'tape_shape' }); tape = undefined;
  }
  const runStart = obj(input.runStart) ? input.runStart : null;
  const controlled: string[] = [...(Array.isArray(start?.plan?.controlled) ? start!.plan.controlled
    : Array.isArray(runStart?.controlled) ? runStart!.controlled : tape?.controlled ?? [])];
  if (controlled.some(p => typeof p !== 'string') || new Set(controlled).size !== controlled.length) throw Error('society_report_controlled');
  if (tape && digest(controlled) !== digest(tape.controlled)) issues.push({ code: 'controlled_identity_conflict' });
  if (runStart?.controlled && digest(controlled) !== digest(runStart.controlled)) issues.push({ code: 'run_start_identity_conflict' });
  const summary = input.summary ?? finish?.summary ?? null;
  const summaryValue = obj(summary) && obj(summary.summary) ? summary.summary : summary;
  if (input.summary && finish?.summary && digest(summaryValue) !== digest(finish.summary)) issues.push({ code: 'summary_finish_conflict' });
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const requestId = str(event.data.requestId);
    if (requestId === null) continue;
    const list = groups.get(requestId) ?? []; list.push(event); groups.set(requestId, list);
  }
  // A failed sink can leave a terminal per-call result only inside the final recovery event.
  if (Array.isArray(finish?.results)) for (const result of finish!.results) {
    if (!obj(result) || typeof result.requestId !== 'string') continue;
    const group = groups.get(result.requestId) ?? [];
    if (!group.some(e => e.kind === 'outcome')) group.push({ line: finishEvent!.line, kind: 'outcome_recovered', data: result, provenance: 'finish.results' });
    groups.set(result.requestId, group);
  }
  const archives = input.archives ?? [];
  for (const archive of archives) {
    if (![...groups.values()].some(es => es.some(e => e.data.index === archive.index))) {
      const key = `archive-only-${archive.index}`;
      groups.set(key, [{ line: 0, kind: 'archive_only', data: { index: archive.index } }]);
    }
  }
  const usedDecisions = new Set<SocietyDecisionRecord>();
  const records: SocietyCallReport[] = [];
  for (const [groupId, es] of groups) {
    const local: SocietyReportIssue[] = [];
    const requestEvent = es.find(e => e.kind === 'request');
    const first = requestEvent ?? es[0]!;
    const meta = Object.assign({}, ...es.map(e => e.data), requestEvent?.data ?? {});
    const requestId = groupId.startsWith('archive-only-') ? null : groupId;
    const problem = (code: string, detail?: string) => local.push({ code, ...(requestId ? { requestId } : {}), ...(detail ? { detail } : {}) });
    for (const key of ['index', 'actorId', 'tick', 'phase']) {
      const values = es.map(e => e.data[key]).filter(v => v !== undefined);
      if (new Set(values.map(v => JSON.stringify(v))).size > 1) problem('event_metadata_conflict', key);
    }
    const index = integer(meta.index) ? meta.index : null;
    const archiveMatches = archives.filter(a => a.index === index);
    if (archiveMatches.length > 1) problem('duplicate_call_archive');
    const archive = archiveMatches[0];
    const body = str(requestEvent?.data.body) ?? archive?.requestBody ?? null;
    if (requestEvent && es.filter(e => e.kind === 'request').length > 1) problem('duplicate_request_event');
    if (requestEvent?.data.body !== undefined && typeof requestEvent.data.body !== 'string') problem('request_body_shape');
    if (requestEvent?.data.body && archive?.requestBody !== undefined && requestEvent.data.body !== archive.requestBody) problem('request_archive_conflict');
    const actualSha = body === null ? null : hash(body), recordedSha = str(requestEvent?.data.sha256);
    if (recordedSha !== null && recordedSha !== actualSha) problem('request_hash_conflict');
    let wire: unknown = null, visible: any = null, exactVisibleText: string | null = null;
    if (body !== null) try {
      wire = JSON.parse(body);
      if (!obj(wire) || typeof wire.messages?.[0]?.content?.[0]?.text !== 'string') throw Error('missing_observation');
      exactVisibleText = wire.messages[0].content[0].text; visible = JSON.parse(exactVisibleText!);
    } catch { problem('request_decode_failed'); }
    let person = str(meta.actorId) ?? str(meta.person);
    const callDay = integer(meta.tick) ? meta.tick + 1 : integer(visible?.day) ? visible.day : null;
    const phase = str(meta.phase) ?? str(visible?.phase);
    if (person === null && exactVisibleText !== null && tape) {
      const exactContexts = tape.decisions.filter(d => d.day === callDay && d.phase === phase && JSON.stringify(d.visible) === exactVisibleText);
      if (exactContexts.length === 1) person = exactContexts[0]!.person;
      else if (exactContexts.length > 1) problem('archive_identity_ambiguous');
    }
    const candidates = tape?.decisions.filter(d => d.person === person && d.day === callDay && d.phase === phase) ?? [];
    if (candidates.length > 1) problem('duplicate_tape_decision');
    const admitted = candidates[0];
    if (admitted) {
      usedDecisions.add(admitted);
      if (exactVisibleText !== null && exactVisibleText !== JSON.stringify(admitted.visible)) problem('visible_context_conflict');
    }
    const responseEvents = es.filter(e => e.kind === 'response');
    if (responseEvents.length > 1) problem('duplicate_response_event');
    const responseEvent = responseEvents[0];
    const eventRaw = str(responseEvent?.data.rawBase64), archiveRaw = archive?.responseBase64 ?? null;
    if (eventRaw !== null && archiveRaw !== null && eventRaw !== archiveRaw) problem('response_archive_conflict');
    const raw = eventRaw ?? archiveRaw;
    let rawText: string | null = null, parsed: ReturnType<typeof parseAnthropicResponse> | null = null;
    if (raw !== null) {
      const bytes = Buffer.from(raw, 'base64'); rawText = bytes.toString('utf8');
      if (bytes.toString('base64') !== raw) problem('response_base64_invalid');
      try { parsed = parseAnthropicResponse(bytes, requestId ?? hash(`archive-${index}`)); }
      catch { problem('response_decode_failed'); }
      if (parsed && responseEvent?.data.parsed && digest(parsed) !== digest(responseEvent.data.parsed)) problem('response_parse_conflict');
    }
    const decisionEvents = es.filter(e => e.kind === 'decision');
    if (decisionEvents.length > 1) problem('duplicate_validated_action');
    const validatedAction = decisionEvents[0]?.data.action ?? null;
    if (admitted && validatedAction !== null && digest(validatedAction) !== digest(admitted.action)) problem('admitted_action_conflict');
    if (admitted && parsed?.actionable && digest(parsed.decision) !== digest(admitted.action)) problem('response_action_conflict');
    const transitions = tape?.transitions.filter(t => t.day === callDay) ?? [];
    if (transitions.length > 1) problem('duplicate_day_transition');
    const outcomes = es.filter(e => e.kind === 'outcome' || e.kind === 'outcome_recovered').map(e => e.data);
    const submitted = outcomes.some(o => o.status === 'submitted');
    const reasoning = parsed?.reasoning;
    const record: SocietyCallReport = {
      sequence: first.line || Number.MAX_SAFE_INTEGER - 10000 + (index ?? 0), person,
      initialRole: str(tape?.decisions.find(d => d.person === person)?.visible.self.role) ?? str(visible?.self?.role),
      day: callDay, phase, requestId, requestIndex: index,
      request: { eventLine: requestEvent?.line ?? null, body, archiveBody: archive?.requestBody ?? null, recordedSha256: recordedSha,
        actualSha256: actualSha, model: obj(wire) ? str(wire.model) : null, exactVisibleText, wire },
      visible, authorizedVisible: admitted?.visible ?? null,
      legalChoices: visible === null ? admitted?.legalChoices ?? null : { menu: visible.legalChoices ?? null, schema: visible.decisionSchema ?? null },
      response: { source: eventRaw !== null ? archiveRaw !== null ? 'event_and_archive' : 'event' : archiveRaw !== null ? 'archive' : 'unavailable',
        rawBase64: raw, archiveRawBase64: archiveRaw, rawText, sha256: raw === null ? null : hash(Buffer.from(raw, 'base64')),
        parsed, archiveStatus: archive?.status ?? null },
      reasoning: { source: 'provider_returned_summary', status: reasoning?.status ?? (raw === null ? 'response_unavailable' : 'response_unreadable'),
        summaries: reasoning?.summaries ?? [], signatureSha256: reasoning?.signatureSha256 ?? [], redactedBlocks: reasoning?.redactedBlocks ?? null },
      proposedAction: parsed?.decision ?? null, validatedAction, submittedAction: admitted?.action ?? null,
      admission: admitted ? 'recorded_in_tape' : submitted ? 'controller_submitted_without_tape_record' : validatedAction !== null ? 'validated_without_tape_record' : 'not_recorded',
      worldTransition: admitted ? transitions[0] ?? null : null,
      transitionStatus: admitted && transitions.length ? 'daily_transition_recorded' : 'not_recorded',
      events: es, outcomes, issues: local,
    };
    records.push(record); issues.push(...local);
  }
  for (const d of tape?.decisions ?? []) if (d.controlled && !usedDecisions.has(d)) {
    issues.push({ code: 'tape_decision_without_request', detail: `${d.person}:day${d.day}:${d.phase}` });
    records.push({ sequence: Number.MAX_SAFE_INTEGER - 1000 + d.day * 2 + (d.phase === 'act' ? 1 : 0), person: d.person,
      initialRole: str(d.visible.self.role), day: d.day, phase: d.phase, requestId: null, requestIndex: null,
      request: { eventLine: null, body: null, archiveBody: null, recordedSha256: null, actualSha256: null, model: null, exactVisibleText: null, wire: null },
      visible: null, authorizedVisible: d.visible, legalChoices: d.legalChoices,
      response: { source: 'unavailable', rawBase64: null, archiveRawBase64: null, rawText: null, sha256: null, parsed: null, archiveStatus: null },
      reasoning: { source: 'provider_returned_summary', status: 'response_unavailable', summaries: [], signatureSha256: [], redactedBlocks: null },
      proposedAction: null, validatedAction: null, submittedAction: d.action, admission: 'recorded_in_tape',
      worldTransition: tape!.transitions.find(t => t.day === d.day) ?? null,
      transitionStatus: tape!.transitions.some(t => t.day === d.day) ? 'daily_transition_recorded' : 'not_recorded',
      events: [], outcomes: [], issues: [{ code: 'tape_decision_without_request' }] });
  }
  records.sort((a, b) => (a.day ?? Number.MAX_SAFE_INTEGER) - (b.day ?? Number.MAX_SAFE_INTEGER) ||
    (a.phase === 'commit' ? 0 : 1) - (b.phase === 'commit' ? 0 : 1) || a.sequence - b.sequence);
  return { format: 'node-society-results-v1', sourceRevision: str(start?.plan?.sourceRevision) ?? str(runStart?.sourceRevision) ?? tape?.genesis.sourceRevision ?? null,
    model: str(start?.plan?.model), controlled, summary, runStart: input.runStart ?? null, finalization: input.finalization ?? null,
    recordedErrors: { explicit: input.errors ?? null, summaryError: obj(summary) ? summary.error ?? null : null,
      summaryErrors: obj(summary) ? summary.errors ?? null : null,
      finalization: obj(input.finalization) ? input.finalization.errors ?? null : null },
    counts: { recordedCalls: records.length, responsesAvailable: records.filter(r => r.response.rawBase64 !== null).length,
      tapeAdmissions: records.filter(r => r.admission === 'recorded_in_tape').length,
      dailyTransitions: tape?.transitions.length ?? 0, integrityIssues: issues.length },
    integrityIssues: issues,
    agents: controlled.map((person, i) => ({ person, initialRole: records.find(r => r.person === person)?.initialRole ?? null,
      filename: `controlled-${i}`, records: records.filter(r => r.person === person) })),
    unassignedRecords: records.filter(r => r.person === null || !controlled.includes(r.person)),
    evidence: { eventsSha256: hash(input.eventsText), tapeDigest: tape ? digest(tape) : null,
      archives: archives.map(a => ({ index: a.index, requestSha256: a.requestBody === undefined ? null : hash(a.requestBody),
        responseSha256: a.responseBase64 === undefined ? null : hash(Buffer.from(a.responseBase64, 'base64')) })) },
    notes: [
      'Provider-returned thinking summaries are reproduced verbatim. Missing, empty and redacted summaries remain explicitly identified; no hidden reasoning is reconstructed.',
      'A request event records preparation; reserved/dispatched events and archived worker responses provide their separate evidence. A dispatched event does not prove provider receipt.',
      'A decision event is validation before submission. Tape admission records acceptance; a shared daily transition occurs only when the complete day resolves.',
      'Daily transitions are joint world results, not an attribution of causality to any single action. This report contains recorded facts and integrity checks, without a reasoning-quality score or behavioral interpretation.',
    ] };
}

function callMarkdown(r: SocietyCallReport): string {
  const archive = r.requestIndex === null ? 'Unavailable call archive index.' : `Original run archives: calls/${String(r.requestIndex).padStart(5, '0')}/request.json and response.json (when present).`;
  const chronology = r.events.map(e => ({ line: e.line, kind: e.kind, provenance: e.provenance ?? null, recoveryIndex: e.recoveryIndex ?? null,
    ...Object.fromEntries(Object.entries(obj(e.data) ? e.data : {}).filter(([key]) =>
      ['requestId', 'index', 'actorId', 'person', 'tick', 'phase', 'status', 'stage', 'reason', 'elapsedMs', 'bookingError'].includes(key))) }));
  const parts = [`## Request ${r.requestIndex ?? 'unavailable'} — day ${r.day ?? 'unavailable'}, ${r.phase ?? 'unavailable'}`,
    `Request ID: ${r.requestId ?? 'unavailable'}. Admission: ${r.admission}. Transition: ${r.transitionStatus}.`,
    '### Exact visible context sent', societyReportFence(r.request.exactVisibleText ?? 'Unavailable: no decodable request observation.', 'json'),
    ...(r.request.exactVisibleText === null && r.authorizedVisible !== null
      ? ['### Authorized context recorded in tape (sent request unavailable)', societyReportFence(json(r.authorizedVisible), 'json')] : []),
    '### Legal choices and schema', societyReportFence(json(r.legalChoices), 'json'),
    '### Request and response byte evidence', archive,
    `Request SHA-256: ${r.request.actualSha256 ?? 'unavailable'}. Response SHA-256: ${r.response.sha256 ?? 'unavailable'}. Exact wire bytes are retained in the JSONL record and original call archives.`,
    '### Returned reasoning summary', `Recorded status: ${r.reasoning.status}.`];
  r.reasoning.summaries.forEach((text, i) => parts.push(`Summary block ${i + 1}:`, societyReportFence(text)));
  if (!r.reasoning.summaries.length) parts.push('No readable summary text is recorded for this request.');
  parts.push('### Proposed, validated and submitted actions', societyReportFence(json({ proposed: r.proposedAction, validated: r.validatedAction,
    submitted: r.submittedAction, admission: r.admission }), 'json'),
    '### Recorded outcomes and event chronology', societyReportFence(json({ responseSource: r.response.source, archiveStatus: r.response.archiveStatus,
      outcomes: r.outcomes, events: chronology }), 'json'),
    '### Shared daily world transition', societyReportFence(r.worldTransition === null ? 'Unavailable: no proven transition for this request.' : json(r.worldTransition), 'json'),
    '### Integrity findings', societyReportFence(json(r.issues), 'json'));
  return parts.join('\n\n');
}

export function societyResultsMarkdown(report: SocietyResultsReport): string {
  return ['# Recorded society results', `Source revision: ${report.sourceRevision ?? 'unavailable'}. Model: ${report.model ?? 'unavailable'}.`,
    ...report.notes, '## Recorded run summary', societyReportFence(json(report.summary), 'json'),
    '## Run start and finalization', societyReportFence(json({ start: report.runStart, finalization: report.finalization }), 'json'),
    '## Evidence counts', societyReportFence(json(report.counts), 'json'),
    '## Controlled inhabitant records', ...report.agents.map(a => `- [${a.person} (${a.initialRole ?? 'role unavailable'})](${a.filename}.md): ${a.records.length} recorded requests.`),
    '## Recorded errors and integrity findings', societyReportFence(json({ recordedErrors: report.recordedErrors, integrityIssues: report.integrityIssues }), 'json'),
    '## Evidence hashes', societyReportFence(json(report.evidence), 'json')].join('\n\n') + '\n';
}

/** Reads only named run artifacts and numeric call directories. It never opens an allowance
 * or credential, follows no paths from event content, and performs no provider operation. */
export function readSocietyResults(inputDirectory: string): SocietyResultsReport {
  const directory = resolve(inputDirectory), inputIssues: SocietyReportIssue[] = [];
  const read = (name: string): string | undefined => {
    const path = join(directory, name); if (!existsSync(path)) return undefined;
    try { return readFileSync(path, 'utf8'); } catch { inputIssues.push({ code: 'artifact_unreadable', detail: name }); return undefined; }
  };
  const eventsText = read('events.jsonl') ?? '';
  if (!existsSync(join(directory, 'events.jsonl'))) inputIssues.push({ code: 'events_file_missing' });
  let tape: SocietyTape | undefined;
  const tapeText = read('society.json');
  if (tapeText !== undefined) try { tape = parseSocietyEvidence<SocietyTape>(tapeText); } catch { inputIssues.push({ code: 'tape_file_unreadable' }); }
  const document = (name: string): unknown => {
    const text = read(name); if (text === undefined) return undefined;
    try { const plain = JSON.parse(text); return plain?.format === 'node-society-evidence-v1' ? parseSocietyEvidence(text) : plain; }
    catch { inputIssues.push({ code: 'document_unreadable', detail: name }); return { rawText: text }; }
  };
  const archives: SocietyCallArchive[] = [], calls = join(directory, 'calls');
  if (existsSync(calls)) for (const entry of readdirSync(calls, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{1,10}$/.test(entry.name)) continue;
    const index = Number(entry.name), archive: SocietyCallArchive = { index };
    for (const [name, key] of [['request.json', 'requestBody'], ['response.json', 'responseBase64']] as const) {
      const path = join(calls, entry.name, name); if (!existsSync(path)) continue;
      try { const bytes = readFileSync(path); archive[key] = bytes.toString(key === 'responseBase64' ? 'base64' : 'utf8'); }
      catch { inputIssues.push({ code: 'call_archive_unreadable', detail: `${entry.name}/${name}` }); }
    }
    const status: { http?: unknown; transport?: unknown } = {};
    for (const [name, key] of [['status.json', 'http'], ['transport.json', 'transport']] as const) {
      const path = join(calls, entry.name, name); if (!existsSync(path)) continue;
      try { status[key] = JSON.parse(readFileSync(path, 'utf8')); }
      catch { inputIssues.push({ code: 'call_status_unreadable', detail: `${entry.name}/${name}` }); }
    }
    if (Object.keys(status).length) archive.status = status;
    archives.push(archive);
  }
  return buildSocietyResultsReport({ eventsText, tape, summary: document('summary.json'), errors: document('errors.json'),
    runStart: document('run-start.json'), finalization: document('finalization.json'), archives, inputIssues });
}

/** Fresh-directory-only exports keep the original evidence and earlier reports intact. */
export interface SocietyReportPaths {
  outputDirectory: string; reportJson: string; reportMarkdown: string; indexJson: string;
  agents: { person: string; jsonl: string; markdown: string }[];
}
export function writeSocietyResults(report: SocietyResultsReport, outputDirectory: string): SocietyReportPaths {
  const directory = resolve(outputDirectory); if (existsSync(directory)) throw Error('society_report_output_exists');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const write = (name: string, text: string) => writeFileSync(join(directory, name), text, { flag: 'wx', mode: 0o600 });
  write('report.json', stringifySocietyEvidence(report)); write('report.md', societyResultsMarkdown(report));
  write('index.json', stringifySocietyEvidence({ format: report.format, counts: report.counts,
    agents: report.agents.map(({ records, ...agent }) => ({ ...agent, requests: records.length, jsonl: `${agent.filename}.jsonl`, markdown: `${agent.filename}.md` })),
    unassignedRecords: report.unassignedRecords.length, integrityIssues: report.integrityIssues, evidence: report.evidence }));
  for (const agent of report.agents) {
    write(`${agent.filename}.jsonl`, agent.records.map(r => JSON.stringify(JSON.parse(stringifySocietyEvidence(r)))).join('\n') + (agent.records.length ? '\n' : ''));
    write(`${agent.filename}.md`, [`# ${agent.person} — recorded chronology`, `Initial recorded role: ${agent.initialRole ?? 'unavailable'}.`,
      ...report.notes, ...agent.records.map(callMarkdown)].join('\n\n') + '\n');
  }
  return { outputDirectory: directory, reportJson: join(directory, 'report.json'), reportMarkdown: join(directory, 'report.md'), indexJson: join(directory, 'index.json'),
    agents: report.agents.map(a => ({ person: a.person, jsonl: join(directory, `${a.filename}.jsonl`), markdown: join(directory, `${a.filename}.md`) })) };
}

export interface SocietyRawReportPaths {
  outputDirectory: string; reportJson: string; indexJson: string;
  agents: { person: string; jsonl: string }[];
}
/** Raw-only alternative requested for fast delivery. Existing readable exports remain available. */
export function writeSocietyRawResults(report: SocietyResultsReport, outputDirectory: string): SocietyRawReportPaths {
  const directory = resolve(outputDirectory); if (existsSync(directory)) throw Error('society_report_output_exists');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const write = (name: string, text: string) => writeFileSync(join(directory, name), text, { flag: 'wx', mode: 0o600 });
  write('report.json', stringifySocietyEvidence(report));
  write('index.json', stringifySocietyEvidence({ format: report.format, counts: report.counts,
    agents: report.agents.map(({ records, ...agent }) => ({ ...agent, requests: records.length, jsonl: `${agent.filename}.jsonl` })),
    unassignedRecords: report.unassignedRecords.length, integrityIssues: report.integrityIssues, evidence: report.evidence }));
  for (const agent of report.agents) write(`${agent.filename}.jsonl`,
    agent.records.map(r => JSON.stringify(JSON.parse(stringifySocietyEvidence(r)))).join('\n') + (agent.records.length ? '\n' : ''));
  return { outputDirectory: directory, reportJson: join(directory, 'report.json'), indexJson: join(directory, 'index.json'),
    agents: report.agents.map(a => ({ person: a.person, jsonl: join(directory, `${a.filename}.jsonl`) })) };
}
