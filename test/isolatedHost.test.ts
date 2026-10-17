import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { IsolatedParticipantHost, hostProcessEnvironment } from '../src/agent/isolatedHost.js';
import { buildResponsesRequest } from '../src/agent/responsesRequest.js';
import { ResponsesBroker } from '../src/agent/responsesBroker.js';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { evidenceHash, replay } from '../src/agent/replay.js';
import { setup, authorize, response, root } from './fixtures/accountingFixture.js';
import { listen, cleanupResponses } from './fixtures/responsesFixture.js';

const buildRoot = mkdtempSync(join(tmpdir(), 'node-isolated-host-build-')), build = join(buildRoot, 'compiled');
const entryFile = join(build, 'agent', 'isolatedHostChild.js'); const hosts: IsolatedParticipantHost[] = [];
const genesis = () => fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
async function create(checkpointDirectory?: string) {
  const g = genesis(), person = [...createParticipantState(g).registry.people.values()].find(p => p.role === 'baker')!;
  const host = await IsolatedParticipantHost.create({ entryFile, genesis: g, person: person.id, controllerToken: 'isolated-fixture-controller-token', checkpointDirectory });
  hosts.push(host); return { host, genesis: g };
}
beforeAll(() => {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--strict', '--skipLibCheck', '--types', 'node', '--typeRoots', resolve('node_modules/@types'), '--outDir', build, '--rootDir', resolve('src'), resolve('src/agent/isolatedHostChild.ts')]);
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
});
afterEach(async () => { for (const h of hosts.splice(0)) await h.close(); await cleanupResponses(); });
afterAll(() => rmSync(buildRoot, { recursive: true, force: true }));

describe('mechanical game host credential separation', () => {
  it('allowlists OS environment and excludes keys, unknown secrets, preload hooks and TLS overrides', () => {
    expect(hostProcessEnvironment({ PATH: '/safe', SystemRoot: 'system', TZ: 'UTC', OPENAI_API_KEY: 'fixture-key', NODE_AI_API_KEY: 'fixture-key',
      UNKNOWN_SECRET: 'fixture-secret', NODE_OPTIONS: '--require malicious', NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_PATH: '/unreviewed' }))
      .toEqual({ PATH: '/safe', SystemRoot: 'system', TZ: 'UTC' });
  });
  it.each(['OPENAI_API_KEY', 'NODE_AI_API_KEY', 'openai_api_key'])('rejects startup if %s is directly inherited', async name => {
    const env = { ...hostProcessEnvironment(process.env), [name]: 'fixture-key-not-a-provider-key' };
    const child = spawn(process.execPath, [entryFile], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], timeout: 10_000, windowsHide: true });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(code).toBe(78);
  });
  it('hosts a real world and returns authorized policy data without controller or observer secrets', async () => {
    const { host, genesis } = await create(), o = await host.read(), before = await host.evidence();
    const request = buildResponsesRequest(o, 'archived-test-model'); expect(o.projection.self.role).toBe('Baker');
    expect(request.body).not.toContain(o.observationId); expect(request.body).not.toContain(genesis.observerSecret); expect(request.body).not.toContain('isolated-fixture-controller-token');
    expect(await host.evidence()).toBe(before);
  });
  it('retains authenticated action authority, stale rejection and complete replay inside the child', async () => {
    const { host, genesis } = await create(), o = await host.read();
    await host.submitDecision(o, { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } });
    expect((await host.advance()).some(e => e.category === 'bakerPrice')).toBe(true);
    await expect(host.submitDecision(o, { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } })).rejects.toThrow('host_command_rejected');
    expect(evidenceHash(replay(await host.exportTape(), genesis.sourceRevision))).toBe(await host.evidence());
  });
  it('rejects overlapping IPC operations without advancing the world twice', async () => {
    const { host } = await create(); const first = host.advance(); await expect(host.advance()).rejects.toThrow('host_request_in_flight'); await first;
    expect((await host.read()).context.tick).toBe(1);
  });
  it('reopens durable game evidence without reconnecting to an old controller lease', async () => {
    const directory = join(root(), 'game'), first = await create(directory), old = await first.host.read(); await first.host.advance();
    const hash = await first.host.evidence(); await first.host.close();
    const next = await IsolatedParticipantHost.resume({ entryFile, checkpointDirectory: directory, sourceRevision: first.genesis.sourceRevision, controllerToken: 'new-isolated-controller-token' }); hosts.push(next);
    expect((await next.read()).context.tick).toBe(1); expect(await next.evidence()).toBe(hash);
    await expect(next.submitDecision(old, { move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } })).rejects.toThrow('host_command_rejected');
  });
  it('joins a real local Responses service, durable account, separate host and complete replay', async () => {
    const { ledger } = setup(), prices = authorize(ledger), { host, genesis } = await create(join(root(), 'game'));
    const observation = await host.read(), request = buildResponsesRequest(observation, prices.model), value = JSON.parse(response().toString());
    value.output[0].content[0].text = JSON.stringify({ move: null, communication: null, diary: null, role: { kind: 'bakerPrice', price: 0.75 } });
    const url = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }));
    const outcome = await new ResponsesBroker(ledger).evaluateLoopbackFixture(request, prices, url, async () => (await host.read()).context);
    if (outcome.kind !== 'validated_offline') throw Error('fixture decision rejected');
    await host.submitDecision(observation, outcome.decision); expect((await host.advance()).some(e => e.category === 'bakerPrice')).toBe(true);
    expect(ledger.view()).toMatchObject({ admissionsCharged: 10, bookedMicroUsd: 19_144n, heldMicroUsd: 100n });
    expect(evidenceHash(replay(await host.exportTape(), genesis.sourceRevision))).toBe(await host.evidence());
  });
  it('releases the mechanical child on explicit close and rejects further commands', async () => {
    const { host } = await create(); await host.close(); await expect(host.read()).rejects.toThrow('host_unavailable'); await host.close();
  });
  it('kills and reaps a mechanically stalled startup at the IPC deadline', async () => {
    const directory = root(), marker = join(directory, 'pid'), stall = join(directory, 'mechanical-stall.mjs');
    writeFileSync(stall, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},String(process.pid)); process.on('message',()=>{});`);
    const g = genesis(), person = [...createParticipantState(g).registry.people.values()].find(p => p.role === 'baker')!;
    await expect(IsolatedParticipantHost.create({ entryFile: stall, timeoutMs: 300, genesis: g, person: person.id, controllerToken: 'stall-fixture-controller-token' })).rejects.toThrow('host_deadline');
    const pid = Number(readFileSync(marker, 'utf8')); let dead = false;
    try { process.kill(pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; } expect(dead).toBe(true);
  });
  it('rejects mismatched IPC response identities and reaps that mechanical child', async () => {
    const entry = join(root(), 'mechanical-mismatch.mjs'); writeFileSync(entry, "process.on('message',m=>process.send({id:m.id+1,ok:true,value:null}));");
    const g = genesis(), person = [...createParticipantState(g).registry.people.values()].find(p => p.role === 'baker')!;
    await expect(IsolatedParticipantHost.create({ entryFile: entry, genesis: g, person: person.id, controllerToken: 'mismatch-fixture-controller-token' })).rejects.toThrow('host_protocol_invalid');
  });
});
