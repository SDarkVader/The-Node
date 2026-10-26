/** Manual deterministic preview or verified saved runs. No provider or budget is opened. */
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {Society,societyConfig} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';
import {createSocietyPlan,type SocietyRunEvent} from '../src/society/accounted.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {buildSocietyResultsReport,writeSocietyRawResults} from '../src/society/report.js';
import {stringifySocietyEvidence} from '../src/society/codec.js';
import {openSocietyPanel} from '../src/observatory/societyPanel.js';
const {values}=parseArgs({options:{history:{type:'string'},'web-world':{type:'string'},port:{type:'string',default:'8090'},
  ticks:{type:'string',default:'3'},output:{type:'string'}}});
const days=Number(values.ticks);if(!Number.isSafeInteger(days)||days<1||days>20)throw Error('society_preview_days');
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const society=new Society({seed:42,sourceRevision,config:{...societyConfig(),diarySubjectOptional:true},postcards:{rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000},
  routine:{maxTurnsPerDay:128},
  dailyOracle:JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8'))});
const output=values.output?resolve(values.output):join(mkdtempSync(join(tmpdir(),'node-society-preview-')),'run');
mkdirSync(output,{recursive:true});
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
const panel=await openSocietyPanel({society,id:'deterministic-preview',mode:'synthetic',manual:true,stop,port:Number(values.port),
  ...(values.history?{history:values.history}:{}),...(values['web-world']?{webWorldDirectory:values['web-world']}:{})});
const events:SocietyRunEvent[]=[],emit=(e:SocietyRunEvent)=>{events.push(e);panel.event(e);};
emit({kind:'start',data:{plan:createSocietyPlan(society,{ticks:days}),runId:'deterministic-preview'}});
console.log(JSON.stringify({event:'observatory_ready',url:panel.url,loginToken:panel.researcherToken,
  mode:'deterministic_preview',providerCalls:0,output}));
let index=0,status='completed';
try{
  while(society.tick<days){await panel.gate!.wait(society.tick+1,controller.signal);
    const day=society.tick+1;
    while(society.tick<day)for(const person of society.pendingPeople()){
      const view=society.view(person),action=autonomousPolicy(view.visible),controlled=society.controlled.includes(person);
      const binding={requestId:`preview-${index}`,index,actorId:person,person,tick:society.tick,phase:society.phase,turn:society.turn};
      if(controlled){const request=buildSocietyRequest(view.visible);emit({kind:'request',data:{...binding,body:request.body,sha256:request.sha256}});}
      society.submit(person,action);
      if(controlled){emit({kind:'decision',data:{...binding,status:'validated',action}});index++;}
    }
  }
}catch(error){status='stopped';society.halt();if(!controller.signal.aborted)console.error(error);}
finally{
  const tape=society.exportTape(),eventsText=events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')+'\n';
  writeFileSync(join(output,'society.json'),stringifySocietyEvidence(tape),{flag:'wx'});
  writeFileSync(join(output,'events.jsonl'),eventsText,{flag:'wx'});
  writeSocietyRawResults(buildSocietyResultsReport({tape,eventsText}),join(output,'results'));
  panel.finish({status});console.log(JSON.stringify({event:'preview_complete',status,ticks:society.tick,providerCalls:0,output}));
}
if(!controller.signal.aborted)await new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}));
await panel.close();
