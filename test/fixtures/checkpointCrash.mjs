// Mechanical crash fixture only: no agent, network, provider, or spending operations.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const [build,directory,stage,writeNumber]=process.argv.slice(2);
const load=file=>import(pathToFileURL(path.join(build,file)).href);
const {createDurableHost}=await load('agent/durableHost.js');
const {fixtureGenesis,createParticipantState}=await load('agent/participantWorld.js');
const {DEFAULT_WORLD_CONFIG}=await load('world/world.js');
const genesis=fixtureGenesis(32,{...DEFAULT_WORLD_CONFIG,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
const person=[...createParticipantState(genesis).registry.people.values()].find(p=>p.role==='baker');
let writes=0;
const host=createDurableHost(directory,genesis,person.id,'crash-fixture-controller-token',{
  fault:where=>{
    if(where==='before_write')writes++;
    if(writes===Number(writeNumber)&&where===stage)process.exit(73);
  },
});
const session=host.authenticate('crash-fixture-controller-token');
const o=host.read(session);
host.submit(session,{type:'action',tick:o.context.tick,observationId:o.observationId,action:'bakerPrice',payload:{price:0.75}});
host.advance();
process.exit(74); // Fault did not trigger: the parent test must reject this outcome.
