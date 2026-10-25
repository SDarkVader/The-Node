/** Offline, synthetic readiness evidence for interface/adapter work. Never a live experiment. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fixtureGenesis } from '../src/agent/participantWorld.js';
import { evidenceHash, replay } from '../src/agent/replay.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { DEFAULT_PERCEPTION_CONDITION } from '../src/observatory/perception.js';
import { launchPerceptionWorker, startPerceptionBridge, type PerceptionBridge, type PerceptionWorkerProcess } from '../src/observatory/perceptionBridge.js';
import { runAuditedPerceptionEpisode } from '../src/observatory/perceptionEpisode.js';
import { perceptionPolicyPacket, type PerceptionAgentInput } from '../src/observatory/perceptionContext.js';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.length !== 2 && args.length !== 4 || args.some((a, i) => i % 2 === 0 && !['--out', '--godot'].includes(a)) ||
    new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2 || !option('--out'))
  throw Error('perception_readiness_usage: --out <NEW directory> [--godot <binary>]');
const binary = option('--godot') ?? process.env.NODE_GODOT_BIN;
if (!binary) throw Error('perception_readiness_godot_required');
const out = resolve(option('--out')!);
if (existsSync(out)) throw Error('perception_readiness_output_exists');
mkdirSync(out, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const bridges: PerceptionBridge[] = [], workers: PerceptionWorkerProcess[] = [];
try {
  for (let i = 0; i < 2; i++) {
    const bridge = await startPerceptionBridge({ timeoutMs: 15000 });
    bridges.push(bridge);
    workers.push(launchPerceptionWorker(binary, bridge));
  }
  const engines = await Promise.all(bridges.map(bridge => bridge.ready(30000)));
  const genesis = { ...fixtureGenesis(103, { ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }), sourceRevision: 'TEST-ONLY-perception-readiness-v1' };
  const packets: ReturnType<typeof perceptionPolicyPacket>[] = [];
  const inputs: PerceptionAgentInput[] = [];
  const stay = () => ({ move: null, communication: null, diary: null, role: null });
  const result = await runAuditedPerceptionEpisode({ episodeId: 'TEST-ONLY-perception-readiness-v1', genesis,
    actors: [{ actorId: 'baker-0', role: 'Baker', ordinal: 0 }, { actorId: 'grifter-0', role: 'Grifter', ordinal: 0 }],
    ticks: 4, condition: DEFAULT_PERCEPTION_CONDITION,
    perspective: (id, tick) => id === 'baker-0' && tick < 3 ? 'first_person' : 'isometric' }, {
    'baker-0': input => { inputs.push(input); packets.push(perceptionPolicyPacket(input));
      return input.tick === 1 ? { ...stay(), move: input.legalMoves[0] ?? null } : stay(); },
    'grifter-0': input => { inputs.push(input); packets.push(perceptionPolicyPacket(input)); return stay(); },
  }, { workerId: 'fresh-primary-process', perceive: r => bridges[0]!.perceive(r) },
  { workerId: 'fresh-comparison-process', perceive: r => bridges[1]!.perceive(r) });
  const moved = result.ticks[1]!.effects.some(e => e.category === 'move' && e.person === result.identities[0]!.person);
  const before = inputs.find(i => i.agentId === 'baker-0' && i.tick === 1)!;
  const after = inputs.find(i => i.agentId === 'baker-0' && i.tick === 2)!;
  const submittedMove = (result.ticks[1]!.proposals['baker-0'] as { move: { x: number; y: number } | null }).move;
  const nextPositionMatches = submittedMove !== null && submittedMove.x === after.self.x && submittedMove.y === after.self.y &&
    (before.self.x !== after.self.x || before.self.y !== after.self.y);
  const replayMatches = evidenceHash(replay(result.tape, genesis.sourceRevision)) === result.finalHash;
  const admitted = result.ticks.every(t => Object.values(t.verdicts).every(v => v.code === 'admitted'));
  if (!moved || !nextPositionMatches || !replayMatches || !admitted) throw Error('perception_readiness_assertion');
  const summary = { schema: 'node-perception-readiness-v1', synthetic: true, policies: 'scripted', engines,
    ticks: 4, decisions: packets.length, independentAgreements: result.audits.length, moved, nextPositionMatches, replayMatches,
    allAdmitted: admitted, modelCalls: 0, evaluationsRun: 0, finalWorldHash: result.finalHash };
  write('readiness.json', summary);
  write('perception-evidence.json', { schema: 'node-perception-readiness-evidence-v1', synthetic: true,
    condition: DEFAULT_PERCEPTION_CONDITION, packets, episode: result });
  process.stdout.write(JSON.stringify(summary) + '\n');
} finally {
  await Promise.allSettled([...bridges.map(bridge => bridge.close()), ...workers.map(worker => worker.stop())]);
}
