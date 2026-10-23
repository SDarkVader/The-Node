/**
 * A4 — Godot stream bridge (observatory handover, 2026-10-23).
 *
 * An authenticated, read-only WebSocket endpoint that streams the verified projection in the
 * existing Godot `hello` / `tick` shapes, plus metadata keys the client may ignore:
 * experimentId, segmentId, sourceTick, worldHash, cursor, segmentRoot, mode, synthetic.
 *
 * - It sends the frame the shared display cursor selects, so Godot and the web panels show the
 *   same experiment, segment, tick and world hash.
 * - Inbound messages are counted and discarded: a renderer cannot submit an experiment action,
 *   step the world or move the cursor.
 * - Each connection gets its own random pseudonym secret (worldProtocol's per-connection policy).
 * - A slow client is disconnected rather than allowed to queue without bound; it can reconnect.
 * This is not the standalone `npm run server` world: nothing here creates or advances a world.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { scopeOf, type Tokens } from './auth.js';
import type { ObservatoryService } from './service.js';
import { frameMetadata } from './worldProjection.js';

export const GODOT_PATH = '/observatory/v1/godot';
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface GodotBridge { handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean; close(): void; stats(): { connections: number; inboundIgnored: number } }

export function createGodotBridge(service: ObservatoryService, tokens: Tokens): GodotBridge {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let inboundIgnored = 0;

  wss.on('connection', (ws: WebSocket, runId: string) => {
    const secret = randomBytes(16).toString('hex');
    const send = (tick: number) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { ws.terminate(); return; }
      const run = service.run(runId);
      const meta = frameMetadata(run.projection, tick, run.display.mode);
      ws.send(JSON.stringify({ ...run.projection.publicTick(tick, secret), ...meta }));
    };
    const run = service.run(runId), tick = service.displayedTick(runId);
    ws.send(JSON.stringify({ ...run.projection.publicHello(), ...frameMetadata(run.projection, tick, run.display.mode) }));
    send(tick);
    const unsubscribe = service.subscribe(runId, change => { if (change.kind === 'display') send(change.tick); });
    ws.on('message', () => { inboundIgnored++; }); // renderers are display-only
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });

  return {
    handleUpgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://observatory.invalid');
      if (url.pathname !== GODOT_PATH && url.pathname !== GODOT_PATH + '/') return false;
      const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const scope = scopeOf(tokens, header ?? url.searchParams.get('token'));
      const runId = url.searchParams.get('run') ?? '';
      if (!scope || !service.runs.has(runId)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return true;
      }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, runId));
      return true;
    },
    close() { for (const c of wss.clients) c.terminate(); wss.close(); },
    stats() { return { connections: wss.clients.size, inboundIgnored }; },
  };
}
