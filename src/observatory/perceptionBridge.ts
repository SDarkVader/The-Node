/**
 * Perception bridge (2026-10-23). A local WebSocket endpoint that the headless Godot perception
 * worker (client/scripts/PerceptionWorker.gd) connects to. The Node sends a perception request,
 * the worker answers it, and the Node validates the answer against its own request
 * (perception.ts) before anything reaches an agent.
 *
 * - Loopback by default and bearer-token authenticated with a constant-time compare. One worker
 *   at a time; a second connection is refused while one is live.
 * - The worker must first announce the perception profile the Node validates against.
 * - Every request is correlated by requestId and bounded by a timeout. A response nobody is
 *   waiting for (unknown, duplicate or timed out) is counted and dropped. It is never handed to a
 *   later request.
 * - The worker receives nothing but requests and can only answer them: it cannot step the world.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PERCEPTION_PROFILE, validatePerception, type PerceptionRecord, type PerceptionRequest, type PerceptionResponse } from './perception.js';
import {validateNavigation,type NavigationRequest,type NavigationRecord} from './navigation.js';

export const PERCEPTION_PATH = '/observatory/v1/perception';
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export interface WorkerEngine { name: string; version: string }
export interface PerceptionBridgeStats { requests: number; delivered: number; refused: number; timedOut: number; unmatched: number }
export interface PerceptionBridge {
  /** Hand to the worker as --perception-url. */
  url: string;
  /** Hand to the worker as NODE_PERCEPTION_TOKEN. */
  token: string;
  /** Resolves once a worker has connected and announced the expected profile. */
  ready(timeoutMs?: number): Promise<WorkerEngine>;
  /** The validated record for `request`, or a rejection with a perception_* code. */
  perceive(request: PerceptionRequest): Promise<PerceptionRecord>;
  navigate(request: NavigationRequest): Promise<NavigationRecord>;
  stats(): PerceptionBridgeStats;
  close(): Promise<void>;
}

interface Pending { request: PerceptionRequest; resolve(r: PerceptionRecord): void; reject(e: Error): void; timer: NodeJS.Timeout }
const digestOf = (s: string) => createHash('sha256').update(s).digest();

export async function startPerceptionBridge(options: { host?: string; port?: number; token?: string; timeoutMs?: number } = {}): Promise<PerceptionBridge> {
  const token = options.token ?? randomBytes(24).toString('hex'), expected = digestOf(token);
  const timeoutMs = options.timeoutMs ?? 10000;
  const counts: PerceptionBridgeStats = { requests: 0, delivered: 0, refused: 0, timedOut: 0, unmatched: 0 };
  const pending = new Map<string, Pending>();
  const routes = new Map<string,{request:NavigationRequest;resolve(r:NavigationRecord):void;reject(e:Error):void;timer:NodeJS.Timeout}>();
  const waiters: { resolve(e: WorkerEngine): void; reject(e: Error): void }[] = [];
  let worker: WebSocket | null = null, engine: WorkerEngine | null = null;

  const authorized = (req: IncomingMessage) => {
    const presented = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return presented !== undefined && timingSafeEqual(digestOf(presented), expected);
  };
  const failAll = (code: string) => {
    for(const [id,p] of routes){clearTimeout(p.timer);routes.delete(id);p.reject(Error(code));}
    for (const [id, p] of pending) { clearTimeout(p.timer); pending.delete(id); p.reject(Error(code)); }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const server = createServer((_req, res) => { res.writeHead(404).end(); });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://perception.invalid').pathname;
    const refuse = (status: string) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (path !== PERCEPTION_PATH) return refuse('404 Not Found');
    if (!authorized(req)) return refuse('401 Unauthorized');
    if (worker) return refuse('409 Conflict');
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });

  wss.on('connection', (ws: WebSocket) => {
    worker = ws;
    ws.on('message', (data, isBinary) => {
      const raw = isBinary ? '' : data.toString();
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw); } catch { counts.unmatched++; return; }
      if (!engine) {
        const e = message.engine as WorkerEngine | undefined;
        if (message.type !== 'perceptionWorker' || message.profile !== PERCEPTION_PROFILE ||
            typeof e?.name !== 'string' || typeof e?.version !== 'string') {
          for (const w of waiters.splice(0)) w.reject(Error('perception_worker_profile'));
          ws.close(1008, 'perception_worker_profile');
          return;
        }
        engine = { name: e.name, version: e.version };
        for (const w of waiters.splice(0)) w.resolve({ ...engine });
        return;
      }
      const route=typeof message.requestId==='string'?routes.get(message.requestId):undefined;
      if(route){
        clearTimeout(route.timer);routes.delete(route.request.requestId);
        try{
          const e=message.engine as WorkerEngine|undefined;
          if(e?.name!==engine.name||e?.version!==engine.version)throw Error('navigation_engine_mismatch');
          route.resolve(validateNavigation(route.request,message,raw));counts.delivered++;
        }catch(error){counts.refused++;route.reject(error instanceof Error?error:Error('navigation_invalid'));}
        return;
      }
      const p = typeof message.requestId === 'string' ? pending.get(message.requestId) : undefined;
      if (!p) { counts.unmatched++; return; }
      clearTimeout(p.timer);
      pending.delete(p.request.requestId);
      try {
        const e = message.engine as WorkerEngine | undefined;
        if (message.error === undefined && (e?.name !== engine.name || e?.version !== engine.version)) throw Error('perception_engine_mismatch');
        const record = validatePerception(p.request, message as unknown as PerceptionResponse, raw);
        counts.delivered++;
        p.resolve(record);
      } catch (error) {
        counts.refused++;
        p.reject(error instanceof Error && error.message.startsWith('perception_') ? error : Error('perception_response_invalid'));
      }
    });
    ws.on('close', () => {
      if (worker === ws) { worker = null; engine = null; }
      failAll('perception_worker_lost');
    });
    ws.on('error', () => ws.terminate());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `ws://${host}:${address.port}${PERCEPTION_PATH}`,
    token,
    ready(wait = timeoutMs) {
      if (engine) return Promise.resolve({ ...engine });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('perception_worker_unavailable')), wait);
        waiters.push({ resolve: e => { clearTimeout(timer); resolve(e); }, reject: e => { clearTimeout(timer); reject(e); } });
      });
    },
    perceive(request) {
      counts.requests++;
      if (!worker || !engine || worker.readyState !== worker.OPEN) return Promise.reject(Error('perception_worker_unavailable'));
      if (pending.has(request.requestId)) return Promise.reject(Error('perception_request_duplicate'));
      const socket = worker;
      return new Promise<PerceptionRecord>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.requestId);
          counts.timedOut++;
          reject(Error('perception_timeout'));
        }, timeoutMs);
        pending.set(request.requestId, { request: structuredClone(request), resolve, reject, timer });
        socket.send(JSON.stringify(request));
      });
    },
    stats: () => ({ ...counts }),
    navigate(request){
      counts.requests++;
      if(!worker||!engine||worker.readyState!==worker.OPEN)return Promise.reject(Error('navigation_worker_unavailable'));
      if(routes.has(request.requestId)||pending.has(request.requestId))return Promise.reject(Error('navigation_request_duplicate'));
      const socket=worker;
      return new Promise<NavigationRecord>((resolve,reject)=>{
        const timer=setTimeout(()=>{routes.delete(request.requestId);counts.timedOut++;reject(Error('navigation_timeout'));},timeoutMs);
        routes.set(request.requestId,{request:structuredClone(request),resolve,reject,timer});socket.send(JSON.stringify(request));
      });
    },
    async close() {
      failAll('perception_bridge_closed');
      for (const w of waiters.splice(0)) w.reject(Error('perception_bridge_closed'));
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

export interface PerceptionWorkerProcess { exited: Promise<number | null>; output(): string; stop(): Promise<void> }

/**
 * Starts the headless Godot worker against `bridge`. The client project is copied to a scratch
 * directory first, so Godot's import cache never lands in the repository and parallel runs do
 * not share one. The worker gets a minimal environment with no inherited credentials: the
 * executable search path, the Windows system variables sockets need, and home/data directories
 * inside the scratch directory so Godot's logs stay out of the user's profile.
 */
export function launchPerceptionWorker(godotBin: string, bridge: Pick<PerceptionBridge, 'url' | 'token'>,
    clientDir = fileURLToPath(new URL('../../client', import.meta.url))): PerceptionWorkerProcess {
  const scratch = mkdtempSync(join(tmpdir(), 'node-perception-'));
  const project = join(scratch, 'client'), home = join(scratch, 'home');
  cpSync(clientDir, project, { recursive: true, filter: src => !src.split(sep).includes('.godot') });
  mkdirSync(home);
  const system = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'windir'].flatMap(k => (process.env[k] === undefined ? [] : [[k, process.env[k]!]])));
  const env = { ...system, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: home, TMP: home,
    XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, NODE_PERCEPTION_TOKEN: bridge.token };
  const child = spawn(godotBin, ['--headless', '--path', project, 'res://scenes/PerceptionWorker.tscn', '--', `--perception-url=${bridge.url}`],
    { env, windowsHide:true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const keep = (b: Buffer) => { log = (log + b.toString()).slice(-20000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const exited = new Promise<number | null>(resolve => {
    // A child can report exit before its stdio handles close on Windows.
    child.once('close', code => resolve(code));
    child.once('error', error => { log += `\n[launch] ${error.message}`; resolve(null); });
  });
  return {
    exited,
    output: () => log,
    async stop() {
      if (child.exitCode === null && child.pid !== undefined) child.kill('SIGTERM');
      await exited;
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
