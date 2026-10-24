/**
 * A7 — researcher stream/API (observatory handover, 2026-10-23).
 *
 * A loopback HTTP server: read-only JSON routes, a resumable Server-Sent Events stream with a
 * bounded per-client buffer, the Godot WebSocket bridge, the static web interface, and two
 * deliberately narrow writes: the shared display cursor and append-only annotations. Nothing
 * here can start, stop or step a run, reserve money or call a provider. Run ids are registered
 * server-side; no request names a file, and no response carries a path, a secret, a raw ledger
 * record or provider bytes.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { scopeOf, type Scope, type Tokens } from './auth.js';
import { appendAnnotation, readAnnotations } from './annotations.js';
import type { ExperimentRegistration, ObservatoryEvent } from './contracts.js';
import { createGodotBridge, GODOT_PATH, type GodotBridge } from './godotBridge.js';
import { actorObservation, decisionRecord } from './reasoning.js';
import { ObservatoryService } from './service.js';
import { telemetry } from './telemetryMetrics.js';
import { timeline } from './timeline.js';
import { buildThinkingHistory, exportThinkingCSV, filterThinkingHistory, formatForExternalModel, type ThinkingQuery } from './thinkingHistory.js';
import { frameMetadata } from './worldProjection.js';

export const API = '/observatory/v1';
const MAX_SSE_BUFFER = 1024 * 1024;
const MAX_BODY = 64 * 1024;
/** Measures this interface will not display as results until a framework produces them. */
export const NOT_EVALUATED = ['reasoning_quality', 'decision_quality', 'memory_benefit', 'honesty', 'deception', 'trustworthiness', 'intelligence'] as const;

const WEB = new URL('./web/', import.meta.url);
const STATIC: Record<string, [string, string]> = {
  '/observatory/': ['index.html', 'text/html; charset=utf-8'],
  '/observatory/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/observatory/thinkingViewer.js': ['thinkingViewer.js', 'text/javascript; charset=utf-8'],
  '/observatory/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export interface ObservatoryServer { server: Server; service: ObservatoryService; bridge: GodotBridge; url: string; close(): Promise<void> }
export interface ServerOptions { host?: string; port?: number; pollMs?: number; tokens: Tokens }

class HttpError extends Error { constructor(readonly status: number, code: string) { super(code); } }
const deny = (status: number, code: string): never => { throw new HttpError(status, code); };

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_BODY) deny(413, 'observatory_body_too_large'); chunks.push(chunk as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return deny(400, 'observatory_body_json'); }
}

export async function startObservatoryServer(registrations: readonly ExperimentRegistration[], options: ServerOptions): Promise<ObservatoryServer> {
  const service = new ObservatoryService(registrations);
  const bridge = createGodotBridge(service, options.tokens);
  const host = options.host ?? '127.0.0.1';

  const runSummary = (id: string) => {
    const r = service.run(id), segments = r.experiment.segments(), events = r.experiment.events();
    const live = segments.some(s => !s.sealed && s.events > 0) || segments.some(s => s.events === 0);
    return {
      experimentId: id, label: r.experiment.registration.label ?? id, synthetic: r.experiment.registration.synthetic === true,
      status: r.experiment.error ? 'error' : live ? 'live_prefix' : 'stopped',
      error: r.experiment.error, verifiedThroughTick: r.projection.latestTick(), latestCursor: r.experiment.latestCursor(),
      events: events.length, display: { ...r.display, tick: service.displayedTick(id) },
      segments: segments.map(s => ({ ...s })),
    };
  };
  const tickAtCursor = (id: string, cursor: string) => {
    const r = service.run(id), events = r.experiment.events(), i = events.findIndex(e => e.cursor === cursor);
    if (i < 0) deny(404, 'observatory_unknown_cursor');
    const committed = events.slice(0, i + 1).filter(e => e.type === 'transition');
    return committed.length ? (committed.at(-1)!.data as { nextTick: number }).nextTick : (events[0]!.sourceTick);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://observatory.invalid');
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname]!;
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:" });
      res.end(readFileSync(new URL(file, WEB)));
      return;
    }
    if (url.pathname === '/observatory') { res.writeHead(302, { location: '/observatory/' }); res.end(); return; }
    if (!url.pathname.startsWith(API + '/')) deny(404, 'observatory_not_found');
    const scope: Scope | null = scopeOf(options.tokens, req.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (!scope) deny(401, 'observatory_unauthorized');
    const need = (s: Scope) => { if (scope !== 'researcher' && s === 'researcher') deny(403, 'observatory_forbidden'); };
    const parts = url.pathname.slice(API.length + 1).split('/').map(decodeURIComponent);

    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'runs') return json(res, 200, { runs: [...service.runs.keys()].map(runSummary) });
    if (parts[0] !== 'runs' || !parts[1]) deny(404, 'observatory_not_found');
    const id = parts[1]!;
    if (!service.runs.has(id)) deny(404, 'observatory_unknown_run');
    const r = service.run(id), route = parts.slice(2).join('/');

    if (req.method === 'GET' && route === '') return json(res, 200, runSummary(id));
    if (req.method === 'GET' && route === 'hello') return json(res, 200, { ...r.projection.publicHello(), ...frameMetadata(r.projection, 0, r.display.mode) });
    if (req.method === 'GET' && parts[2] === 'frames' && parts[3] !== undefined) {
      const tick = Number(parts[3]);
      if (!Number.isSafeInteger(tick) || tick < 0 || tick > r.projection.latestTick()) deny(404, 'observatory_no_frame');
      return json(res, 200, { ...r.projection.publicTick(tick, 'observatory-web-' + id), ...frameMetadata(r.projection, tick, r.display.mode) });
    }
    if (route === 'display') {
      if (req.method === 'GET') return json(res, 200, { ...r.display, tick: service.displayedTick(id) });
      if (req.method === 'POST') {
        need('researcher');
        const body = await readBody(req) as { mode?: string; tick?: number };
        try { return json(res, 200, { ...service.setDisplay(id, body as never), tick: service.displayedTick(id) }); }
        catch (error) { return deny(400, (error as Error).message); }
      }
    }
    need('researcher');
    if (req.method === 'GET' && route === 'snapshot') {
      const cursor = url.searchParams.get('cursor'), tickParam = url.searchParams.get('tick');
      const tick = cursor ? tickAtCursor(id, cursor) : tickParam !== null ? Number(tickParam) : service.displayedTick(id);
      if (!Number.isSafeInteger(tick) || tick < 0 || tick > r.projection.latestTick()) deny(404, 'observatory_no_frame');
      return json(res, 200, { run: runSummary(id), frame: frameMetadata(r.projection, tick, r.display.mode),
        researcher: r.projection.researcherSnapshot(tick), public: r.projection.publicTick(tick, 'observatory-web-' + id) });
    }
    if (req.method === 'GET' && route === 'timeline') return json(res, 200, { ticks: timeline(r.experiment.events()) });
    if (req.method === 'GET' && route === 'thinking-history') {
      const q: ThinkingQuery = {};
      for (const key of ['actorId', 'status', 'summaryKeyword'] as const) {
        const value = url.searchParams.get(key);
        if (value) { if (value.length > 1000) deny(400, 'observatory_thinking_query'); q[key] = value; }
      }
      for (const key of ['tickFrom', 'tickTo'] as const) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) deny(400, 'observatory_thinking_tick_range');
          q[key] = Number(value);
        }
      }
      if (q.tickFrom !== undefined && q.tickTo !== undefined && q.tickFrom > q.tickTo) deny(400, 'observatory_thinking_tick_range');
      const format = url.searchParams.get('format') ?? 'json';
      if (!['json', 'csv', 'markdown'].includes(format)) deny(400, 'observatory_thinking_format');
      const ticks = timeline(r.experiment.events());
      const decisions = new Map(ticks.flatMap(t => t.calls.map(c => [c.requestId, decisionRecord(r.experiment, c.requestId)] as const)));
      const full = buildThinkingHistory(id, ticks, decisions);
      const history = Object.keys(q).length ? filterThinkingHistory(full, q) : full;
      if (format === 'json') return json(res, 200, history);
      return json(res, 200, { format, content: format === 'csv' ? exportThinkingCSV(history) : formatForExternalModel(history, 'markdown') });
    }
    if (req.method === 'GET' && route === 'telemetry') return json(res, 200, telemetry(r.experiment.events()));
    if (req.method === 'GET' && route === 'evaluations') {
      const { records, rejected } = service.evaluations(id);
      return json(res, 200, { records, rejected, notEvaluated: NOT_EVALUATED.filter(m => !records.some(x => x.metricId === m))
        .map(metricId => ({ metricId, status: 'not_evaluated', reason: 'No declared metric or framework result exists for this measure.' })) });
    }
    if (req.method === 'GET' && route === 'sample-evaluations') {
      try { return json(res, 200, { scope: 'independent_sample_collections', records: service.sampleEvaluations(id), notAttachedToTimeline: true }); }
      catch { return deny(409, 'observatory_sample_evaluation_invalid'); }
    }
    if (req.method === 'GET' && parts[2] === 'decisions' && parts[3]) {
      try { return json(res, 200, decisionRecord(r.experiment, parts[3])); } catch { return deny(404, 'observatory_unknown_request'); }
    }
    if (req.method === 'GET' && parts[2] === 'actors' && parts[3] && parts[4] === 'observations') {
      const tick = Number(url.searchParams.get('tick'));
      try { return json(res, 200, actorObservation(r.experiment, parts[3], tick)); }
      catch (error) { return deny((error as Error).message === 'observatory_observation_decode_mismatch' ? 409 : 404, (error as Error).message); }
    }
    if (route === 'annotations') {
      const path = r.experiment.registration.annotations;
      if (req.method === 'GET') return json(res, 200, { annotations: path ? readAnnotations(path, id) : [] });
      if (req.method === 'POST') {
        if (!path) deny(409, 'observatory_annotations_not_configured');
        const body = await readBody(req) as never;
        try { return json(res, 201, appendAnnotation(path!, id, body, r.experiment.events())); }
        catch (error) { return deny(400, (error as Error).message); }
      }
    }
    if (req.method === 'GET' && route === 'events') return events(req, res, id, url);
    deny(404, 'observatory_not_found');
  };

  /** JSON page by default; `text/event-stream` (or ?stream=1) follows new events from a cursor. */
  const events = (req: IncomingMessage, res: ServerResponse, id: string, url: URL) => {
    const r = service.run(id);
    const after = url.searchParams.get('after') ?? (req.headers['last-event-id'] as string | undefined) ?? null;
    let backlog: ObservatoryEvent[];
    try { backlog = r.experiment.events(after); } catch { return deny(410, 'observatory_unknown_cursor'); }
    const stream = url.searchParams.get('stream') === '1' || String(req.headers.accept ?? '').includes('text/event-stream');
    if (!stream) return json(res, 200, { events: backlog, latestCursor: r.experiment.latestCursor() });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    // Headers go out now: a client must not wait for the first event (or a heartbeat) to connect.
    res.flushHeaders();
    res.write(': connected\n\n');
    const write = (e: ObservatoryEvent) => res.write(`id: ${e.cursor}\nevent: observatory\ndata: ${JSON.stringify(e)}\n\n`);
    for (const e of backlog) write(e);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000); heartbeat.unref?.();
    const unsubscribe = service.subscribe(id, change => {
      // A slow client never blocks the poll: past its bound it is told to reconnect from its cursor.
      if (res.writableLength > MAX_SSE_BUFFER) { res.write('event: slow_client\ndata: {}\n\n'); res.end(); return; }
      if (change.kind === 'events') change.events.forEach(write);
      else if (change.kind === 'display') res.write(`event: display\ndata: ${JSON.stringify(change)}\n\n`);
      else res.write(`event: error\ndata: ${JSON.stringify({ error: change.error })}\n\n`);
    });
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else json(res, 500, { error: 'observatory_internal_error' }); // details stay in the backend
    });
  });
  server.on('upgrade', (req, socket, head) => { if (!bridge.handleUpgrade(req, socket, head)) socket.destroy(); });
  await new Promise<void>(resolve => server.listen(options.port ?? 0, host, resolve));
  service.start(options.pollMs ?? 1000);
  const port = (server.address() as AddressInfo).port;
  return {
    server, service, bridge, url: `http://${host}:${port}`,
    close: () => new Promise<void>(resolve => { service.stop(); bridge.close(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

export { GODOT_PATH };
