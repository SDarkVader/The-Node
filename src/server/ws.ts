/**
 * WebSocket server broadcasting the §8 MVP scenario live, for the Godot client to
 * connect to. This is scaffolding to prove the client/server wire-up, not a real game
 * server — no auth, no persistence, in-memory only.
 *
 * Two channels, not one (2026-08-07, see docs/BLUEPRINT.md "Architecture scoped ahead
 * of schedule"): shared state (Baker prices, spread, Wall posts) still broadcasts
 * identically to every connection, but rumours are targeted — sent only to the
 * connection identified as the rumour's `heardBy` player. This closes a real leak: the
 * old single-broadcast protocol sent every player's `heardBy`/`heardFrom` pair to every
 * connected client regardless of who they were, which defeats the entire point of the
 * rumour mill (information asymmetry, §0/§3.2). A connection identifies itself via
 * `?player=<id>` on the WS URL — a stand-in for real auth, not real auth; an
 * unidentified connection still receives the shared broadcast but no targeted rumours.
 */
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { mulberry32 } from '../sim/rng.js';
import { BAKER_A, BAKER_B, initScenario, stepScenario, type DayResult } from '../mvp/scenario.js';
import type { RumourEvent } from '../comms/rumourMill.js';
import type { PlayerId } from '../engine/player.js';

export interface TickMessage {
  type: 'tick';
  day: number;
  bakers: Array<{ id: string; price: number }>;
  spread: number;
  wallPost: { authorId: string; state: string } | null;
}

export interface RumourMessage {
  type: 'rumour';
  day: number;
  heardFrom: string;
  state: string;
  distorted: boolean;
  hop: number;
  clarity: number;
}

function toTickMessage(result: DayResult): TickMessage {
  return {
    type: 'tick',
    day: result.day,
    bakers: [
      { id: BAKER_A, price: result.bakerP[0] },
      { id: BAKER_B, price: result.bakerP[1] },
    ],
    spread: result.spread,
    wallPost: result.wallPost ? { authorId: result.wallPost.authorId, state: result.wallPost.state } : null,
  };
}

function toRumourMessage(day: number, rumour: RumourEvent): RumourMessage {
  return {
    type: 'rumour',
    day,
    heardFrom: rumour.heardFrom,
    state: rumour.state,
    distorted: rumour.distorted,
    hop: rumour.hop,
    clarity: rumour.clarity,
  };
}

export interface ServerOptions {
  port?: number;
  tickIntervalMs?: number;
  seed?: number;
}

export interface ServerHandle {
  port: number;
  close: () => void;
}

export function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const tickIntervalMs = options.tickIntervalMs ?? 2500;
  const seed = options.seed ?? (Date.now() & 0xffffffff);

  let scenarioState = initScenario(mulberry32(seed));
  let lastTick: TickMessage | null = null;
  const players = new Map<PlayerId, WebSocket>();

  const wss = new WebSocketServer({ port: options.port ?? 0 });

  function sendTo(playerId: PlayerId, message: unknown): void {
    const socket = players.get(playerId);
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  wss.on('connection', (socket: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const playerId = url.searchParams.get('player');
    if (playerId) {
      players.set(playerId, socket);
      socket.on('close', () => {
        if (players.get(playerId) === socket) players.delete(playerId);
      });
    }
    if (lastTick) {
      socket.send(JSON.stringify(lastTick));
    }
  });

  const interval = setInterval(() => {
    const stepped = stepScenario(scenarioState);
    scenarioState = stepped.state;
    const message = toTickMessage(stepped.result);
    lastTick = message;

    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }

    for (const rumour of stepped.result.rumours) {
      sendTo(rumour.heardBy, toRumourMessage(stepped.result.day, rumour));
    }
  }, tickIntervalMs);

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : (options.port ?? 0);
      resolve({
        port,
        close: () => {
          clearInterval(interval);
          wss.close();
        },
      });
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.NODE_WS_PORT ?? 8080);
  const TICK_INTERVAL_MS = Number(process.env.NODE_TICK_MS ?? 2500);
  void startServer({ port: PORT, tickIntervalMs: TICK_INTERVAL_MS }).then(({ port }) => {
    console.log(`NODE ws server listening on :${port} (tick every ${TICK_INTERVAL_MS}ms)`);
  });
}
