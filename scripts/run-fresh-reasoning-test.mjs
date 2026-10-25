// Deliberately separate owner approval gate for the prepared fresh 20-tick test.
// No --resume option is accepted. Existing run-continuation enforces the actual budget too.
// Args: <runtime> <approved allowance> <NEW private artifacts> <approved credential file>
//       --owner-approved-fresh-20-ticks
import{readFileSync}from'node:fs';
import{resolve,join}from'node:path';
import{fileURLToPath,pathToFileURL}from'node:url';
import{spawnSync}from'node:child_process';
const args=process.argv.slice(2);
if(args.length!==5||args[4]!=='--owner-approved-fresh-20-ticks')throw Error('explicit_owner_approval_required_do_not_start');
const[runtime,allowance,artifacts,credential]=args.slice(0,4).map(p=>resolve(p));
const planPath=fileURLToPath(new URL('../experiments/two-baker-reasoning-20-ticks.json',import.meta.url));
const plan=JSON.parse(readFileSync(planPath,'utf8'));
const{validateContinuationPlan}=await import(pathToFileURL(join(runtime,'eval/continuationRunner.js')).href);validateContinuationPlan(plan);
if(plan.maxTicks!==20||plan.maxCalls!==40||plan.reasoningProfile!=='per_turn_deliberation_v1'||JSON.stringify(plan.actors)!==JSON.stringify([{actorId:'baker-0',role:'Baker',ordinal:0},{actorId:'baker-1',role:'Baker',ordinal:1}]))throw Error('approved_fresh_test_configuration_mismatch');
// Fail before opening a budget if a stale runtime ignores the new opt-in profile.
const load=file=>import(pathToFileURL(join(runtime,file)).href);
const[{ContinuationHost},{ContinuationConversations},{fixtureGenesis},{DEFAULT_WORLD_CONFIG},policy]=await Promise.all([
  load('eval/continuationHost.js'),load('eval/continuationConversation.js'),load('agent/participantWorld.js'),load('world/world.js'),load('eval/continuationReasoning.js')]);
const revision=readFileSync(join(runtime,'REVISION'),'utf8').trim();if(!/^[a-f0-9]{40}$/.test(revision))throw Error('compiled_runtime_revision_required');
const genesis={...fixtureGenesis(plan.seed,JSON.parse(JSON.stringify({...DEFAULT_WORLD_CONFIG,recognition:'v2'}))),sourceRevision:revision};
const host=new ContinuationHost(genesis,plan.actors),history=new ContinuationConversations(plan.maxRequestBytes,plan.reasoningProfile);
const bodies=host.views().map(v=>JSON.parse(history.prepare(v.actorId,v.observation,plan.model).body));
if(bodies.length!==2||new Set(bodies.map(b=>b.system)).size!==1||bodies.some(b=>b.output_config.effort!=='high'||b.max_tokens!==2048||
  !b.system.includes(policy.DELIBERATION_SYSTEM)||JSON.parse(b.messages[0].content[0].text).reasoningInstruction!==policy.DELIBERATION_TURN))throw Error('compiled_runtime_reasoning_parity_failed');
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./run-continuation.mjs',import.meta.url)),runtime,allowance,artifacts,credential,planPath,
  '--dispatch-authorized-pilot','--transport','node'],{stdio:'inherit',env:process.env,windowsHide:true});
process.exitCode=result.error?1:result.status??1;
