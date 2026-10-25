import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ObservatorySource, points } from './source.js';
import { readEvaluations } from './evaluations.js';
import { validateContinuationPlan, continuationPlanHash } from '../eval/continuationRunner.js';

interface Options { sources: ObservatorySource[]; researcherToken: string; worldToken: string; host?: string; port?: number; pollMs?: number; secureCookie?: boolean }
type Role = 'researcher' | 'world';
const equal = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export function startObservatory(options: Options) {
  if (options.researcherToken.length < 32 || options.worldToken.length < 32 || options.researcherToken === options.worldToken) throw Error('observatory_distinct_tokens_required');
  const sources = new Map(options.sources.map(s => [s.registration.id, s]));
  if (!sources.size || sources.size !== options.sources.length) throw Error('observatory_sources_required');
  const selected = new Map<string, string | null>(), failures = new Set<string>();
  const sockets = new Map<WebSocket, { source: ObservatorySource; secret: string; sent: string }>();
  const streams = new Map<ServerResponse, { source: ObservatorySource; secret: string; sent: string; after: string | null }>();
  const sessions = new Map<string, { role: Role; expires: number }>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const role = (req: IncomingMessage): Role | null => {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) return equal(bearer, options.researcherToken) ? 'researcher' : equal(bearer, options.worldToken) ? 'world' : null;
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('node_observatory='))?.slice(17);
    const session = cookie ? sessions.get(cookie) : undefined;
    return session && session.expires > Date.now() ? session.role : null;
  };
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    let bytes = '';
    for await (const chunk of req) { bytes += chunk; if (Buffer.byteLength(bytes) > 8192) throw Error('request_bounds'); }
    return JSON.parse(bytes);
  };
  const sourceFor = (id: string) => { const s = sources.get(id); if (!s || failures.has(id) || !s.latestCursor) throw Error('source_unavailable'); return s; };
  const selection = (s: ObservatorySource) => selected.get(s.registration.id) ?? null;
  const snapshot = (s: ObservatorySource, secret: string) => s.snapshot(selection(s), secret, true);
  const eventWrite = (res: ServerResponse, type: string, data: unknown, id?: string) => {
    if (res.writableLength > 1024 * 1024) { res.end(); streams.delete(res); return; }
    res.write(`${id ? 'id: ' + id + '\n' : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const publish = () => {
    for (const [ws, client] of sockets) {
      const id = client.source.registration.id;
      if (failures.has(id)) { ws.close(1011, 'evidence_unavailable'); continue; }
      const cursor = selection(client.source) ?? client.source.latestCursor;
      const display = `${cursor}:${selection(client.source) === null ? 'follow' : 'replay'}`;
      if (display === client.sent || !cursor) continue;
      if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, 'reconnect_for_snapshot'); continue; }
      const s = client.source.snapshot(selection(client.source), client.secret, false);
      ws.send(JSON.stringify(s.hello)); ws.send(JSON.stringify(s.frame)); client.sent = display;
    }
    for (const [res, client] of streams) {
      const id = client.source.registration.id;
      if (failures.has(id)) { eventWrite(res, 'source_error', { status: 'evidence_unavailable' }); res.end(); streams.delete(res); continue; }
      const cursor = selection(client.source) ?? client.source.latestCursor;
      const display = `${cursor}:${selection(client.source) === null ? 'follow' : 'replay'}`;
      if (display === client.sent || !cursor) continue;
      const all = client.source.list(), after = client.after ? all.findIndex(p => p.cursor === client.after) : all.length - 1;
      for (const p of all.slice(after + 1)) eventWrite(res, 'execution', p, p.cursor);
      eventWrite(res, 'snapshot', snapshot(client.source, client.secret));
      client.sent = display; client.after = client.source.latestCursor;
    }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Exact origin check for mutations; bearer CLI requests may omit Origin.
      if (!['GET', 'HEAD'].includes(req.method ?? '') && req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'origin_rejected' });
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
        return res.end(readFileSync(fileURLToPath(new URL(`../../observatory-web/${name}`, import.meta.url))));
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/session') return json(res, 200, { authenticated: role(req) === 'researcher' });
      if (req.method === 'POST' && url.pathname === '/session') {
        const token = (await body(req)).token;
        if (typeof token !== 'string' || !equal(token, options.researcherToken)) return json(res, 401, { error: 'unauthorized' });
        for (const [id,s] of sessions) if (s.expires <= Date.now()) sessions.delete(id);
        if (sessions.size >= 100) return json(res, 429, { error: 'session_limit' });
        const id = randomBytes(32).toString('hex'); sessions.set(id, { role: 'researcher', expires: Date.now() + 8 * 3600000 });
        res.setHeader('Set-Cookie', `node_observatory=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${options.secureCookie ? '; Secure' : ''}`);
        return json(res, 200, { role: 'researcher' });
      }
      if (role(req) !== 'researcher') return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'POST' && url.pathname === '/observatory/v1/configuration/validate') {
        const { plan } = await body(req); validateContinuationPlan(plan);
        return json(res, 200, { planSha256: continuationPlanHash(plan), spendingAuthorized: false });
      }
      if (req.method === 'DELETE' && url.pathname === '/session') {
        const cookie = req.headers.cookie?.match(/(?:^|;\s*)node_observatory=([^;]+)/)?.[1];
        if (cookie) sessions.delete(cookie);
        res.setHeader('Set-Cookie', 'node_observatory=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { signedOut: true });
      }
      if (req.method === 'GET' && url.pathname === '/observatory/v1/runs') return json(res, 200, options.sources.map(s => ({ id: s.registration.id,
        status: failures.has(s.registration.id) ? 'evidence_unavailable' : s.latestCursor ? 'available' : 'awaiting_evidence', latestCursor: s.latestCursor })));
      const match = url.pathname.match(/^\/observatory\/v1\/runs\/([A-Za-z0-9._-]+)\/(snapshot|events|timeline|evaluations|selection|configuration)$/);
      if (!match) return json(res, 404, { error: 'not_found' });
      const s = sourceFor(match[1]!), endpoint = match[2];
      if (req.method === 'GET' && endpoint === 'configuration') return json(res, 200, { plan: s.point().start.plan, spendingAuthorized: false });
      if (req.method === 'GET' && endpoint === 'snapshot') return json(res, 200, s.snapshot(url.searchParams.get('cursor') ?? selection(s), 'researcher-http', true));
      if (req.method === 'GET' && endpoint === 'timeline') return json(res, 200, s.list());
      if (req.method === 'GET' && endpoint === 'evaluations') {
        const cursor = url.searchParams.get('cursor') ?? selection(s) ?? s.latestCursor!; s.point(cursor);
        return json(res, 200, readEvaluations(s.registration.evaluations, s.registration.id, points(s.tail.read()), cursor));
      }
      if (req.method === 'PUT' && endpoint === 'selection') {
        const { cursor } = await body(req);
        if (cursor !== null && (typeof cursor !== 'string' || !s.has(cursor))) return json(res, 409, { error: 'cursor_unknown' });
        selected.set(s.registration.id, cursor); publish(); return json(res, 200, { cursor, following: cursor === null });
      }
      if (req.method === 'GET' && endpoint === 'events') {
        const after = req.headers['last-event-id'] ?? url.searchParams.get('after');
        if (after && (typeof after !== 'string' || !s.has(after))) return json(res, 409, { error: 'cursor_unknown' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        streams.set(res, { source: s, secret: randomBytes(32).toString('hex'), sent: '', after: typeof after === 'string' ? after : null });
        req.on('close', () => streams.delete(res)); publish(); return;
      }
      return json(res, 405, { error: 'method_not_allowed' });
    } catch { if (!res.headersSent) json(res, 409, { error: 'evidence_or_request_invalid' }); else res.end(); }
  });
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost'), match = url.pathname.match(/^\/observatory\/v1\/runs\/([A-Za-z0-9._-]+)\/world$/);
      if (!role(req) || !match || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw Error();
      const s = sourceFor(match[1]!);
      wss.handleUpgrade(req, socket, head, ws => {
        sockets.set(ws, { source: s, secret: randomBytes(32).toString('hex'), sent: '' });
        ws.on('close', () => sockets.delete(ws)); ws.on('error', () => sockets.delete(ws));
        ws.on('message', () => ws.close(1008, 'read_only')); publish();
      });
    } catch { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
  });
  const poll = () => {
    for (const s of options.sources) {
      try { s.refresh(); } catch { failures.add(s.registration.id); }
    }
    try { publish(); } catch { /* clients reconnect to a verified snapshot */ }
  };
  poll();
  const timer = setInterval(poll, options.pollMs ?? 1000);
  const heartbeat = setInterval(() => { for (const [res] of streams) res.write(': keepalive\n\n'); }, 15000);
  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject); server.listen(options.port ?? 8090, options.host ?? '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  return { server, ready, refresh: poll, close: async () => {
    clearInterval(timer); clearInterval(heartbeat);
    for (const [res] of streams) res.end(); for (const [ws] of sockets) ws.terminate();
    wss.close(); server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
