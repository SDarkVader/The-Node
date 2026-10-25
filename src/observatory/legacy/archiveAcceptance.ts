/** Offline archive acceptance. Reads evidence/journal bytes; never opens an accounting writer.
 * The optional loopback exercise changes only the server's in-memory display cursor.
 * Results contain check names and counts, never paths, observations or provider content.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { newTokens } from './auth.js';
import type { ExperimentRegistration } from './contracts.js';
import { ObservatoryExperiment } from './ledgerTail.js';
import { startObservatoryServer, API, GODOT_PATH } from './server.js';
import { telemetry } from './telemetryMetrics.js';
import { WorldProjection } from './worldProjection.js';

export interface ArchiveExpectations {
  uniqueRequests: number; executedDecisions: number; completedTicks: number; finalTick: number;
  finalWorldHash: string; bookedMicroUsd: string; heldMicroUsd: string;
  requestsPerSegment: Record<string, number>; segmentRoots?: Record<string, string>;
}
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
// Same canonical form as the experiment allowance's historyHash(), without opening its store.
const canonical = (v: unknown) => JSON.stringify(v, (_key, item: unknown) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const requireCheck = (ok: unknown, code: string): void => { if (!ok) throw Error(`observatory_acceptance_${code}`); };
const read = (file: string) => {
  const stat = lstatSync(file);
  requireCheck(stat.isFile() && !stat.isSymbolicLink(), 'regular_file_required');
  return readFileSync(file);
};

/** Exact checksum and latest-stop binding, not invoice reconciliation or new spending authority. */
export function verifyArchiveJournal(experiment: ObservatoryExperiment, journalPath: string): void {
  const envelope = JSON.parse(read(journalPath).toString('utf8'));
  requireCheck(envelope.format === 'node-accounting-journal-v1' && typeof envelope.payload === 'string' &&
    hash(envelope.payload) === envelope.sha256, 'journal_checksum');
  const document = JSON.parse(envelope.payload);
  const raw = experiment.rawEvents(), start = raw.filter(x => x.event.kind === 'start').at(-1)?.event.data;
  const stop = raw.at(-1)?.event;
  requireCheck(stop?.kind === 'stop' && hash(canonical(document)) === stop.data.budgetHistoryHash, 'journal_history');
  const grants = document.events?.filter((e: any) => e.kind === 'authorization');
  requireCheck(grants?.length === 1 && grants[0].value.runId === start?.runId, 'journal_grant');
}

/** Exercise the existing web API and Godot wire protocol; does not launch a renderer or a model. */
async function exerciseServer(registration: ExperimentRegistration, checks: string[]) {
  const tokens = newTokens(), s = await startObservatoryServer([registration], { tokens, host: '127.0.0.1', pollMs: 1000 });
  const base = `${API}/runs/${encodeURIComponent(registration.experimentId)}`;
  const get = (route: string, token = tokens.researcher, init: RequestInit = {}) => fetch(s.url + route,
    { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  try {
    requireCheck((await get(API + '/runs', 'invalid')).status === 401, 'http_auth');
    for (const route of ['/snapshot', '/events', '/telemetry'])
      requireCheck((await get(base + route, tokens.renderer)).status === 403, 'renderer_scope');
    requireCheck((await get(base + '/display', tokens.renderer, { method: 'POST', body: JSON.stringify({ mode: 'replay', tick: 0 }) })).status === 403, 'renderer_write_scope');
    checks.push('http_authentication_and_scopes');
    const page = await fetch(s.url + '/observatory/', { signal: AbortSignal.timeout(15000) });
    requireCheck(page.ok && (await page.text()).includes('Node Observatory'), 'web_assets');
    const before = await (await get(base + '/telemetry')).json();
    const r = s.service.run(registration.experimentId), cursor = r.experiment.latestCursor();
    const finalTick = r.projection.latestTick();
    for (const tick of [...new Set([0, Math.floor(finalTick / 2), finalTick])]) {
      requireCheck((await get(base + '/display', tokens.researcher, { method: 'POST', body: JSON.stringify({ mode: 'replay', tick }) })).ok, 'display');
      type Frame = { sourceTick: number; worldHash: string; cursor: string };
      const snapshot = await (await get(base + '/snapshot')).json() as { frame: Frame };
      const frame = await (await get(base + `/frames/${tick}`, tokens.renderer)).json() as Frame;
      requireCheck(snapshot.frame.sourceTick === tick && frame.worldHash === snapshot.frame.worldHash && frame.cursor === snapshot.frame.cursor, 'web_frame_binding');
      const ws = new WebSocket(s.url.replace(/^http/, 'ws') + GODOT_PATH + '?run=' + encodeURIComponent(registration.experimentId),
        { headers: { authorization: `Bearer ${tokens.renderer}` }, handshakeTimeout: 15000 });
      try {
        const wire = await new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('observatory_acceptance_godot_timeout')), 15000);
          const done = (error: Error | null, value?: unknown) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
          ws.once('error', () => done(Error('observatory_acceptance_godot_connection')));
          ws.on('message', bytes => {
            try { const v = JSON.parse(bytes.toString()); if (v.type === 'tick') done(null, v); }
            catch { done(Error('observatory_acceptance_godot_json')); }
          });
        });
        requireCheck(wire.sourceTick === tick && wire.worldHash === frame.worldHash && wire.cursor === frame.cursor &&
          wire.experimentId === registration.experimentId, 'godot_frame_binding');
        const ignored = s.bridge.stats().inboundIgnored;
        await new Promise<void>((resolve, reject) => ws.send(JSON.stringify({ type: 'action', TEST_ONLY: 'renderer-must-not-act' }),
          error => error ? reject(Error('observatory_acceptance_renderer_send')) : resolve()));
        const deadline = Date.now() + 3000;
        while (s.bridge.stats().inboundIgnored === ignored && Date.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 10));
        requireCheck(s.bridge.stats().inboundIgnored === ignored + 1, 'renderer_input_discarded');
      } finally { ws.terminate(); }
    }
    checks.push('web_and_godot_same_frame_on_scrub_and_reconnect');
    // A sealed archive still supports SSE backlog and Last-Event-ID resumption.
    const events = r.experiment.events(), after = events.at(-3)!;
    const expected = events.slice(-2).map(e => e.cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const stream = await fetch(s.url + base + '/events?stream=1', {
        headers: { authorization: `Bearer ${tokens.researcher}`, 'last-event-id': after.cursor }, signal: controller.signal });
      requireCheck(stream.ok && stream.body, 'sse_connection');
      const reader = stream.body!.getReader(), received: string[] = [];
      let buffer = '';
      try {
        while (received.length < expected.length) {
          const chunk = await reader.read(); requireCheck(!chunk.done, 'sse_end');
          buffer += Buffer.from(chunk.value!).toString('utf8');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (block.includes('event: observatory')) received.push(block.split('\n').find(l => l.startsWith('id: '))!.slice(4));
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      requireCheck(canonical(received) === canonical(expected), 'sse_cursor_sequence');
      const resumed = await (await get(base + '/events?after=' + encodeURIComponent(received[0]!))).json() as { events: { cursor: string }[] };
      requireCheck(canonical(resumed.events.map(e => e.cursor)) === canonical(received.slice(1)), 'cursor_resume');
    } finally { clearTimeout(timeout); controller.abort(); }
    checks.push('sse_and_cursor_resume_without_duplicates');
    s.service.refresh(registration.experimentId);
    const afterTelemetry = await (await get(base + '/telemetry')).json();
    requireCheck(canonical(before) === canonical(afterTelemetry) && cursor === r.experiment.latestCursor() &&
      finalTick === r.projection.latestTick(), 'serving_changed_execution');
    checks.push('refresh_and_renderer_input_do_not_change_execution');
  } finally { await s.close(); }
}

export async function acceptArchive(registration: ExperimentRegistration, journalPath: string, expected: ArchiveExpectations,
    options: { serve?: boolean } = {}) {
  const paths = [...new Set([...registration.segments.flatMap(s => s.ledger ? [s.ledger] : []), journalPath])];
  const before = paths.map(file => hash(read(file))), checks: string[] = [];
  try {
    requireCheck(registration.segments.every(s => !!s.sourceRevision), 'source_revisions_required');
    const experiment = new ObservatoryExperiment(registration); experiment.refresh();
    requireCheck(!experiment.error && experiment.segments().every(s => s.sealed && s.verification === 'replay_verified'), 'sealed_replay');
    const projection = new WorldProjection(experiment), frames = projection.frames(), t = telemetry(experiment.events());
    requireCheck(t.call_attempt_count === expected.uniqueRequests && t.executed_decision_count === expected.executedDecisions &&
      t.completed_tick_count === expected.completedTicks && t.final_tick === expected.finalTick, 'counts');
    const perSegment = Object.fromEntries(experiment.segments().map(s => [s.segmentId,
      experiment.events().filter(e => e.segmentId === s.segmentId && e.type === 'request').length]));
    requireCheck(canonical(perSegment) === canonical(expected.requestsPerSegment), 'deduplicated_segment_counts');
    requireCheck(Object.entries(expected.segmentRoots ?? {}).every(([id, root]) => experiment.segments().find(s => s.segmentId === id)?.segmentRoot === root), 'segment_roots');
    requireCheck(frames.length === expected.finalTick + 1 && frames.at(-1)?.worldHash === expected.finalWorldHash, 'world_frames');
    requireCheck(experiment.rawEvents().filter(x => x.event.kind === 'stop').every(x =>
      frames[x.event.data.summary.ticks]?.worldHash === x.event.data.summary.finalStateHash), 'stop_hashes');
    checks.push('pinned_sealed_replay', 'parent_deduplication_and_counts', 'committed_frames_and_stop_hashes');
    verifyArchiveJournal(experiment, journalPath);
    requireCheck(t.booked_micro_usd_total === expected.bookedMicroUsd && t.held_micro_usd_total === expected.heldMicroUsd, 'accounting_totals');
    checks.push('latest_journal_checksum_grant_and_history_binding', 'accounting_totals_once_per_grant');
    if (options.serve !== false) await exerciseServer(registration, checks);
    checks.push('source_files_unchanged');
    return { schema: 'node-observatory-acceptance-v1', passed: true, checks, counts: {
      segments: experiment.segments().length, requests: t.call_attempt_count, decisions: t.executed_decision_count,
      ticks: t.final_tick, frames: frames.length }, evaluationPerformed: false, modelCalls: 0 };
  } finally {
    requireCheck(paths.every((file, i) => hash(read(file)) === before[i]), 'evidence_changed');
  }
}
