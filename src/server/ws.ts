/**
 * Minimal WebSocket server broadcasting the §8 MVP scenario live, for the Godot
 * client to connect to. This is scaffolding to prove the client/server wire-up, not
 * a real game server — no auth, no persistence, one shared scenario for every
 * connection, in-memory only. Protocol is a single JSON message type per tick; see
 * TickMessage below.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { mulberry32 } from '../sim/rng.js';
import { BAKER_A, BAKER_B, initScenario, stepScenario, type DayResult } from '../mvp/scenario.js';

const PORT = Number(process.env.NODE_WS_PORT ?? 8080);
const TICK_INTERVAL_MS = Number(process.env.NODE_TICK_MS ?? 2500);

export interface TickMessage {
  type: 'tick';
  day: number;
  bakers: Array<{ id: string; price: number }>;
  spread: number;
  wallPost: { authorId: string; state: string } | null;
  rumours: Array<{ heardBy: string; heardFrom: string; state: string; distorted: boolean; hop: number; clarity: number }>;
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
    rumours: result.rumours.map((r) => ({
      heardBy: r.heardBy,
      heardFrom: r.heardFrom,
      state: r.state,
      distorted: r.distorted,
      hop: r.hop,
      clarity: r.clarity,
    })),
  };
}

let scenarioState = initScenario(mulberry32(Date.now() & 0xffffffff));
let lastTick: TickMessage | null = null;

const wss = new WebSocketServer({ port: PORT });
console.log(`NODE ws server listening on :${PORT} (tick every ${TICK_INTERVAL_MS}ms)`);

wss.on('connection', (socket: WebSocket) => {
  console.log('client connected');
  if (lastTick) {
    socket.send(JSON.stringify(lastTick));
  }
  socket.on('close', () => console.log('client disconnected'));
});

setInterval(() => {
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
}, TICK_INTERVAL_MS);
