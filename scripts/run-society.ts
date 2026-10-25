import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Society, verifySocietyTape, type SocietyTape } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';

const {values}=parseArgs({options:{ticks:{type:'string',default:'14'},seed:{type:'string',default:'42'},output:{type:'string'},interactive:{type:'boolean',default:false},verify:{type:'string'}}});
if(values.verify){
  console.log(JSON.stringify(verifySocietyTape(JSON.parse(readFileSync(resolve(values.verify),'utf8')) as SocietyTape),null,2));
}else{
  const ticks=Number(values.ticks),seed=Number(values.seed);
  if(!Number.isSafeInteger(ticks)||ticks<1||ticks>100||!Number.isSafeInteger(seed))throw Error('society_bounded_ticks_and_seed_required');
  const output=resolve(values.output??'.codex/session-recovery/society/latest-synthetic.json');
  if(existsSync(output))throw Error('society_output_exists_choose_new_path');
  mkdirSync(dirname(output),{recursive:true});
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const sourceRevision=head+(dirty?'-working-tree':'');
  const society=new Society({seed,sourceRevision});
  const terminal=values.interactive?createInterface({input:stdin,output:stdout}):null;
  let failure:unknown;
  try{
    while(society.tick<ticks){
      const people=society.pendingPeople();
      if(!people.length)throw Error('society_no_active_people');
      for(const person of people){
        const view=society.view(person),suggested=autonomousPolicy(view.visible);
        if(terminal&&society.controlled.includes(person)){
          stdout.write(JSON.stringify({inhabitant:person,visible:view.visible,suggested},null,2)+'\n');
          const answer=await terminal.question('Submit decision JSON (Enter accepts the shown deterministic suggestion; q stops): ');
          if(answer.trim()==='q')throw Error('supervised_stop');
          society.submit(person,answer.trim()||JSON.stringify(suggested));
        }else society.submit(person,JSON.stringify(suggested));
      }
    }
  }catch(error){failure=error;}finally{
    terminal?.close();
    writeFileSync(output,JSON.stringify(society.exportTape(),null,2)+'\n',{flag:'wx',mode:0o600});
  }
  if(failure)throw failure;
  const tape=society.exportTape(),verification=verifySocietyTape(tape);
  const decisions=tape.decisions, transitions=tape.transitions;
  console.log(JSON.stringify({mode:values.interactive?'supervised_json':'offline_deterministic_model_fixtures',paidCalls:0,
    evidence:output,sourceRevision,...verification,controlled:society.controlled,
    controlledDecisions:decisions.filter(d=>d.controlled).length,
    autonomousDecisions:decisions.filter(d=>!d.controlled).length,
    movement:transitions.reduce((s,t)=>s+t.effects.filter(e=>e.category==='move').length,0),
    heard:transitions.reduce((s,t)=>s+t.effects.filter(e=>e.category==='proximityHeard'||e.category==='wallHeard').length,0),
    diaryWrites:transitions.reduce((s,t)=>s+t.effects.filter(e=>e.category==='diary').length,0),
    breadSales:transitions.reduce((s,t)=>s+Object.values((t.economy as {breadSold:Record<string,number>}).breadSold).reduce((n,x)=>n+x,0),0),
    oracleEntries:transitions.reduce((s,t)=>s+t.oracle.filter(e=>e.result.status==='entered').length,0),
    oracleWins:transitions.reduce((s,t)=>s+t.oracle.filter(e=>e.result.won).length,0),
    voucherAwards:transitions.reduce((s,t)=>s+t.oracle.filter(e=>e.result.prize==='entryVoucher').length,0),
    voucherRedemptions:transitions.reduce((s,t)=>s+t.oracle.filter(e=>e.result.fundedBy==='voucher').length,0),
    maximumAccountingResidual:Math.max(...transitions.map(t=>Math.abs(t.accounting.residual))),
  },null,2));
}
