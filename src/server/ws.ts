/**
 * WebSocket server. Broadcasts a REAL `World` (2026-08-19) — or, on the legacy path, the §8
 * MVP scenario it carried since Phase 3. Still scaffolding: no auth, no persistence, in-memory
 * only.
 *
 * WHY BOTH PATHS EXIST. The MVP scenario (two Bakers and a price spread) proved the socket
 * worked and nothing more; it was never the game. `startWorldServer` streams the actual
 * simulation kernel instead — the last step of HANDOVER's "THE DIRECTION" before a Godot
 * client has something worth rendering. `startServer` is kept, unchanged, because the existing
 * Godot scaffold and its tests still speak that protocol, and breaking them to make a point
 * would cost more than the file it saves. New work should use `startWorldServer`.
 *
 * WHAT GOES ON THE WIRE IS NOT DECIDED HERE. `worldProtocol.ts` owns that, deliberately: it is
 * a privacy boundary (whose wealth, whose identity, which sabotage campaign) and it belongs in
 * a pure, testable module rather than tangled up with socket lifecycle. This file owns
 * connections, timers, and per-connection secrets — nothing about what a player may know.
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
import {
  BAKER_A,
  BAKER_B,
  initScenario,
  stepScenario,
  type DayResult,
  type PendingClientAction,
} from '../mvp/scenario.js';
import type { RumourEvent } from '../comms/rumourMill.js';
import type { PlayerId } from '../engine/player.js';
import { createWorld, stepWorld } from '../world/world.js';
import { helloMessage, tickMessage } from './worldProtocol.js';

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

/**
 * A message FROM a client (2026-08-19). The first inbound message type this server has ever
 * had — until now the socket was write-only, broadcasting ticks outward and reading nothing.
 *
 * `action` and `payload` are deliberately generic, and that is the whole point rather than a
 * placeholder to tidy up later. The action vocabulary has not been designed: it needs to be
 * settled by hand against the scenario mechanics, not invented by whoever happened to be
 * wiring up the transport. This type carries bytes and nothing else.
 *
 * The immediate use is recording and driving simulation runs — pulling data out of a live
 * world and feeding a data model — so what matters here is that the pipe is real, defensive,
 * and observable. What an action MEANS is a separate, later decision.
 */
export interface ClientActionMessage {
  type: 'action';
  action: string;
  payload: unknown;
}

/**
 * Parses an inbound frame, returning `null` for anything that is not a well-formed action.
 *
 * Deliberately total: a client is untrusted input, and a malformed frame must never take down
 * a connection or the server. Every rejection path returns null and is logged once by the
 * caller — bad JSON, a non-object, a missing or wrongly-typed `type`/`action`. `payload` is
 * NOT validated, because nothing here knows what a valid payload looks like yet.
 */
export function parseClientMessage(raw: string): ClientActionMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'action') return null;
  if (typeof obj.action !== 'string' || obj.action.length === 0) return null;
  return { type: 'action', action: obj.action, payload: obj.payload };
}

/** Caps the per-tick inbound queue. A client that floods must not grow server memory without
 *  bound; excess is dropped and counted rather than buffered forever. */
export const MAX_PENDING_ACTIONS = 256;

/**
 * Attaches the inbound handler. Shared by both server paths so they cannot drift in how they
 * treat untrusted input — the legacy MVP scenario and the live world get identical parsing,
 * identical rejection behaviour, and identical flood protection.
 */
function attachActionReceiver(
  socket: WebSocket,
  connectionId: string,
  queue: PendingClientAction[],
): void {
  socket.on('message', (data) => {
    const msg = parseClientMessage(data.toString());
    if (msg === null) {
      console.warn(`[ws] dropped malformed message from ${connectionId}`);
      return;
    }
    if (queue.length >= MAX_PENDING_ACTIONS) {
      console.warn(`[ws] inbound queue full (${MAX_PENDING_ACTIONS}), dropping from ${connectionId}`);
      return;
    }
    queue.push({ action: msg.action, payload: msg.payload, connectionId });
  });
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
  // Inbound actions received since the last tick. Drained, passed into stepScenario, and
  // echoed back on the DayResult — never interpreted here.
  let pendingActions: PendingClientAction[] = [];
  let nextConnectionId = 0;
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
    attachActionReceiver(socket, playerId ?? `anon-${nextConnectionId++}`, pendingActions);
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
    // Drain before stepping: everything that arrived during the previous tick belongs to this
    // one, and the queue must be empty again before the next batch lands.
    const drained = pendingActions;
    pendingActions = [];
    const stepped = stepScenario(scenarioState, drained);
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

export interface WorldServerOptions extends ServerOptions {
  /** Days advanced per broadcast. 1 keeps wall-clock and sim-time legible against each other. */
  daysPerTick?: number;
  /**
   * Called once per tick with whatever a client sent since the previous one, and the world tick
   * it landed on. Omitted entirely when nothing arrived.
   *
   * Exists so a recorder can capture inbound alongside outbound without this module having to
   * know what an action means. It is an observer, not a handler: returning nothing, changing
   * nothing, and unable to affect the simulation.
   */
  onActions?: (actions: readonly PendingClientAction[], tick: number) => void;
}

/**
 * Streams a real `World`. Each connection gets its own pseudonymity secret, so the handles one
 * client sees for a body cannot be matched against another client's — see `worldProtocol.ts`'s
 * header for why that matters (the Silhouette Shield has to survive the wire, not just the
 * simulation).
 *
 * The secret is per-CONNECTION, not per-player, and is generated here rather than derived from
 * anything the client sends: a client-supplied value would let two cooperating clients agree on
 * one and correlate their views, which is exactly the thing being prevented.
 */
export function startWorldServer(options: WorldServerOptions = {}): Promise<ServerHandle> {
  const tickIntervalMs = options.tickIntervalMs ?? 2500;
  const daysPerTick = options.daysPerTick ?? 1;
  const seed = options.seed ?? (Date.now() & 0xffffffff);

  let world = createWorld(seed);
  const secrets = new WeakMap<WebSocket, string>();
  let nextSecret = 0;
  // Inbound actions received since the last tick. `stepWorld` does NOT read them — the action
  // vocabulary is undesigned — but they are drained on the same cadence as the legacy path so
  // both behave identically, and handed to `onActions` so a recorder can capture what a client
  // sent alongside what the world did.
  let pendingActions: PendingClientAction[] = [];

  const wss = new WebSocketServer({ port: options.port ?? 0 });

  wss.on('connection', (socket: WebSocket) => {
    const secret = `c${nextSecret++}-${seed}-${Math.random().toString(36).slice(2)}`;
    secrets.set(socket, secret);
    attachActionReceiver(socket, secret, pendingActions);
    // Geometry first and once — it does not change tick to tick, and it is the largest payload
    // in the protocol. A client that joins mid-run still gets a complete picture: hello, then
    // the next tick fills in everyone's position.
    socket.send(JSON.stringify(helloMessage(world)));
    socket.send(JSON.stringify(tickMessage(world, secret)));
  });

  const interval = setInterval(() => {
    // Drain before stepping, same contract as the legacy path: whatever arrived during the
    // previous tick belongs to this one, and the queue is empty again before the next batch.
    const drained = pendingActions;
    pendingActions = [];
    for (let i = 0; i < daysPerTick; i++) world = stepWorld(world);
    // Reported, never interpreted. This is the seam a recorder hooks: it sees the world AND
    // what was sent at it, without this file deciding that any action means anything.
    if (drained.length > 0) options.onActions?.(drained, world.tick);
    for (const client of wss.clients) {
      if (client.readyState !== client.OPEN) continue;
      const secret = secrets.get(client);
      if (!secret) continue; // pre-handshake; it will get a full pair on connection
      client.send(JSON.stringify(tickMessage(world, secret)));
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
  // The real world is the default now; the MVP scenario is opt-in via NODE_LEGACY_MVP=1.
  const legacy = process.env.NODE_LEGACY_MVP === '1';
  const start = legacy ? startServer : startWorldServer;
  void start({ port: PORT, tickIntervalMs: TICK_INTERVAL_MS }).then(({ port }) => {
    console.log(
      `NODE ws server listening on :${port} (tick every ${TICK_INTERVAL_MS}ms, ${legacy ? 'legacy MVP scenario' : 'real world'})`,
    );
  });
}
