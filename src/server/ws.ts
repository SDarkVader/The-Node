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
import { applyClientAction } from './actionVocabulary.js';

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
 * `action` and `payload` are still deliberately generic at THIS type's level — the frame is
 * parsed here without knowing what it means, same as always. What an action MEANS is decided
 * one layer up, in `actionVocabulary.ts` (2026-08-24): `wallPost`, `diaryEntry`, and
 * `proximityUtterance` are real, validated, and wired into `startWorldServer`'s tick loop —
 * the three mechanics that already had tested, `stepWorld`-consumed plumbing
 * (`pendingWallPosts`/`pendingDiaryEntries`/`pendingProximityUtterances`). Every other
 * mechanic (Miller/Baker's quantity/price, Courier/Investigator/Import-Export's occupancy
 * verbs, Shift Cover, Oracle entry) still has no player-input slot in the engine at all —
 * unknown `action` strings return `null` from `parseGameAction` and are silently ignored, not
 * an error. The legacy scenario path (`startServer`, below) still only echoes actions back —
 * this vocabulary was deliberately not extended to `mvp/scenario.ts`, which isn't the game.
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
   * Exists so a recorder can capture inbound alongside outbound. This callback itself still
   * cannot affect the simulation — but as of 2026-08-24 the actions it's handed MAY already
   * have (`actionVocabulary.ts` applies recognized ones to `world` before this fires, in the
   * same tick). `onActions` sees the raw drained batch either way, so a recorder can compare
   * what was sent against what actually changed.
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
 *
 * ACTION AUTHORSHIP IDENTITY (2026-08-24) is a SEPARATE thing from the pseudonymity secret
 * above and must not be confused with it: `?player=<buildingId>` binds a connection to a
 * `PlayerId` for the sole purpose of `actionVocabulary.ts` knowing who is asking to post to
 * the Wall, write a diary entry, or speak in proximity. Same "stand-in for real auth, not real
 * auth" caveat this file's header already puts on the legacy path's `?player=<id>` — nothing
 * here verifies the claim beyond `isFilledRoleHolder` (must currently occupy that buildingId's
 * role slot). Deliberately NOT reused for outbound pseudonymity: a real identity binding and
 * the anti-correlation secret solve opposite problems and must stay on separate maps.
 */
export function startWorldServer(options: WorldServerOptions = {}): Promise<ServerHandle> {
  const tickIntervalMs = options.tickIntervalMs ?? 2500;
  const daysPerTick = options.daysPerTick ?? 1;
  const seed = options.seed ?? (Date.now() & 0xffffffff);

  let world = createWorld(seed);
  const secrets = new WeakMap<WebSocket, string>();
  let nextSecret = 0;
  // secret -> claimed authorship identity, for actionVocabulary.ts only. Keyed by secret
  // (not the socket) because that's all a drained PendingClientAction carries as
  // `connectionId` — see attachActionReceiver below.
  const identities = new Map<string, PlayerId>();
  // Inbound actions received since the last tick. Resolved through actionVocabulary.ts and
  // applied to `world` before it steps (see the tick interval below), then handed to
  // `onActions` so a recorder can still capture what a client sent alongside what happened.
  let pendingActions: PendingClientAction[] = [];

  const wss = new WebSocketServer({ port: options.port ?? 0 });

  wss.on('connection', (socket: WebSocket, req) => {
    const secret = `c${nextSecret++}-${seed}-${Math.random().toString(36).slice(2)}`;
    secrets.set(socket, secret);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const playerId = url.searchParams.get('player');
    if (playerId) {
      identities.set(secret, playerId);
      socket.on('close', () => {
        identities.delete(secret);
      });
    }
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
    // Queue onto world.pendingX BEFORE stepping — the same "caller populates, stepWorld
    // consumes and clears" contract pendingWallPosts/pendingDiaryEntries/
    // pendingProximityUtterances already use everywhere else. Unresolved identity or a
    // malformed action is silently a no-op (see applyClientAction's header) — this file still
    // doesn't decide what a REJECTED action means, only what a VALID one does.
    for (const action of drained) {
      const authorId = action.connectionId ? (identities.get(action.connectionId) ?? null) : null;
      world = applyClientAction(world, authorId, action.action, action.payload);
    }
    // The presence/session primitive (2026-08-24) — `identities`' current values are exactly
    // "who is bound to a still-open connection right now" (entries are removed on close, see
    // the connection handler above), so this needs no separate bookkeeping. Set fresh each
    // tick BEFORE stepping, same "live snapshot the caller keeps current" contract
    // `World.currentlyOnline`'s own header describes — not drained/cleared like pendingX.
    world = { ...world, currentlyOnline: new Set(identities.values()) };
    for (let i = 0; i < daysPerTick; i++) world = stepWorld(world);
    // Reported alongside what happened. This is the seam a recorder hooks: it sees the world
    // AND what was sent at it.
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
