import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { OfflineParticipantHost } from '../../src/agent/host.js';
import { createParticipantState, fixtureGenesis } from '../../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../../src/world/world.js';
import { buildResponsesRequest } from '../../src/agent/responsesRequest.js';
import { cleanup } from './accountingFixture.js';

const hosts: OfflineParticipantHost[] = [], servers: Server[] = [], sockets = new Set<Socket>();
export function participant() {
  const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
  const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker')!;
  const host = new OfflineParticipantHost(genesis, person.id, 'wire-fixture-controller-token'); hosts.push(host);
  const session = host.authenticate('wire-fixture-controller-token');
  return { host, genesis, session, observation: host.read(session), request: buildResponsesRequest(host.read(session), 'archived-test-model') };
}
export async function listen(server: Server, secure = false) {
  servers.push(server); server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture listener address');
  return `${secure ? 'https' : 'http'}://127.0.0.1:${address.port}/v1/responses`;
}
export async function cleanupResponses() {
  for (const h of hosts.splice(0)) h.close();
  for (const s of sockets) s.destroy(); sockets.clear();
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  cleanup();
}
