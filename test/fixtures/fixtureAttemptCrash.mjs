// Mechanical process-exit fixture: no agent, provider, network or spending activity.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const [build, directory, stage, writeNumber] = process.argv.slice(2);
const load = file => import(pathToFileURL(join(build, file)).href);
const { createDurableHost } = await load('agent/durableHost.js');
const { fixtureGenesis, createParticipantState } = await load('agent/participantWorld.js');
const { DEFAULT_WORLD_CONFIG } = await load('world/world.js');
const genesis = fixtureGenesis(32, { ...DEFAULT_WORLD_CONFIG, pMonthly: 0, arrivalPDaily: 0, migrationK: 0, saboteurCount: 0 });
const person = [...createParticipantState(genesis).registry.people.values()].find(p => p.role === 'baker');
let writes = 0;
const host = createDurableHost(directory, genesis, person.id, 'durable-fixture-test-controller', {
  fault: where => {
    if (where === 'before_write') writes++;
    if (writes === Number(writeNumber) && where === stage) process.exit(73);
  },
});
const session = host.authenticate('durable-fixture-test-controller');
await host.evaluateFixture(session, async () => {
  writeFileSync(join(directory, 'fixture-dispatched'), '1', { flag: 'wx', mode: 0o600 });
  return { status: 'completed', model: 'offline-fixture', inputTokens: 10, outputTokens: 10,
    decision: { move: null, communication: null, diary: null, role: null } };
});
process.exit(74); // A requested crash window must have exited with 73 before this point.
