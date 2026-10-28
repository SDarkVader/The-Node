/** Executable native-Godot proof. Two scripted decisions, zero provider calls or budgets. */
import {parseArgs} from 'node:util';
import {mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Society,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from './society-request-worker.js';
import {validateSocietyAction} from '../src/society/boundary.js';
import {openSocietySenses} from '../src/society/senses.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {SocietyObservatorySource} from '../src/observatory/societySource.js';

const {values}=parseArgs({options:{godot:{type:'string'},output:{type:'string'}}});
if(!values.output)throw Error('navigation_proof_output_required');
const output=resolve(values.output),root=fileURLToPath(new URL('..',import.meta.url));
let ancestor=output;while(!existsSync(ancestor))ancestor=dirname(ancestor);
const rel=relative(realpathSync(root),resolve(realpathSync(ancestor),relative(ancestor,output)));
if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)||existsSync(output))throw Error('navigation_proof_fresh_private_output_required');
mkdirSync(output,{recursive:true,mode:0o700});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const dirty=execFileSync('git',['status','--porcelain','--','src','scripts','client','test'],{encoding:'utf8',windowsHide:true}).trim();
const sourceRevision=head+(dirty?'-working-tree':'');
const society=new Society({seed:42,sourceRevision,routine:{maxTurnsPerDay:64,information:'inhabitant-v1',navigation:'dual-v1'}});
const senses=await openSocietySenses(values.godot);
const write=(name:string,data:unknown)=>writeFileSync(join(output,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
try{
  for(const p of society.pendingPeople()){const v=await society.prepareView(p,senses.perceive);society.submit(p,autonomousPolicy(v.visible));}
  const actor=society.pendingPeople().find(p=>society.inspect().registry.people.get(p)!.role==='miller')!;
  const from=await society.prepareView(actor,senses.perceive);
  const work=from.visible.dual!.overhead.districts.flatMap(d=>d.locations).find(b=>b.buildingId===from.visible.self.workplace)!;
  const to={x:work.x,y:work.y};
  check(Math.abs(to.x-from.visible.self.x)+Math.abs(to.y-from.visible.self.y)>1,'proof_requires_nonadjacent_trip');
  check(!from.visible.routine!.can.work,'proof_work_before_arrival');
  const startRequest=buildSocietyRequest(from.visible);validateSocietyWire(Buffer.from(startRequest.body),startRequest.sha256);
  writeFileSync(join(output,'departure-request.json'),startRequest.body,{flag:'wx',mode:0o600});
  // This is a declared deterministic response fixture, not a claim about model reasoning.
  const response={...emptySocietyAction(),move:to};write('departure-response.json',{source:'scripted-policy-fixture',action:response});
  const action=validateSocietyAction(response,from.context),beforeRoute=senses.stats();
  await society.prepareTravel(actor,action,senses.navigate);
  const route=society.decisionEvidence(actor).navigation!;write('navigation.json',route);
  const afterRoute=senses.stats();check(afterRoute.requests===beforeRoute.requests+1,'proof_one_route_request');
  society.submit(actor,action);
  for(const p of society.pendingPeople()){await society.prepareView(p,senses.perceive);society.submit(p,emptySocietyAction());}
  const arrival=await society.prepareView(actor,senses.perceive);
  check(arrival.visible.self.x===to.x&&arrival.visible.self.y===to.y,'proof_wrong_arrival');
  check(arrival.visible.routine!.can.work,'proof_missing_arrival_work');
  check(arrival.visible.dual!.firstPerson.locations.some(l=>l.buildingId===work.buildingId),'proof_missing_arrival_sight');
  const arrivalRequest=buildSocietyRequest(arrival.visible);validateSocietyWire(Buffer.from(arrivalRequest.body),arrivalRequest.sha256);
  writeFileSync(join(output,'arrival-request.json'),arrivalRequest.body,{flag:'wx',mode:0o600});write('arrival-perception.json',society.decisionEvidence(actor).perception);
  const workAction={...emptySocietyAction(),occupation:{kind:'work' as const}};
  write('arrival-response.json',{source:'scripted-policy-fixture',action:workAction});society.submit(actor,workAction);
  for(const p of society.pendingPeople()){await society.prepareView(p,senses.perceive);society.submit(p,emptySocietyAction());}
  const next=await society.prepareView(actor,senses.perceive);check(next.visible.routine!.tasks.work,'proof_work_not_recorded');
  const tape=society.exportTape(),replay=verifySocietyTape(tape,sourceRevision,{allowPartial:true});
  const source=new SocietyObservatorySource({id:'navigation-proof',directory:output,kind:'society',mode:'synthetic'},
    {read:()=>({tape,eventsText:''}),stop:()=>{throw Error('proof_observatory_rejected');}});
  check(source.refresh(),'proof_observatory_failed');
  writeFileSync(join(output,'society.json'),stringifySocietyEvidence(tape),{flag:'wx',mode:0o600});writeFileSync(join(output,'events.jsonl'),'',{flag:'wx',mode:0o600});
  write('registration.json',{runs:[{id:'navigation-proof',directory:output,kind:'society',mode:'synthetic'}]});
  // An empty journal lets the normal saved-run viewer inspect this model-free proof.
  // The two exact policy packets above remain separate named artifacts.
  const summary={sourceRevision,mode:'scripted-policy-with-native-Godot',providerCalls:0,scriptedAgentDecisions:2,
    actor,departure:{x:from.visible.self.x,y:from.visible.self.y},destination:{buildingId:work.buildingId,...to},
    route:route.path,steps:route.path.length,workBeforeArrival:from.visible.routine!.can.work,
    workAtArrival:arrival.visible.routine!.can.work,workRecorded:next.visible.routine!.tasks.work,
    firstPerson:arrival.visible.dual!.firstPerson,worker:senses.stats(),replay,observatoryVerified:true};
  write('summary.json',summary);console.log(JSON.stringify({output,...summary},null,2));
}finally{await senses.close();}
