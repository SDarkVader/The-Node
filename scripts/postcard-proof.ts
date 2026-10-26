/** Offline production-mechanism proof. Scripted clock/asset events, not agent behaviour.
 * The 2 White/hour fixture is the Aug7 illustration, never an activated world default. */
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createPostcardState,applyPostcardEvent,POSTCARD_TIERS,POSTCARD_HOUR_MS,postcardAccrualDenominator,
  type PostcardEvent,type PostcardState } from '../src/engine/postcards.js';
import { createPostcardTape,verifyPostcardTape,postcardStateHash,serializePostcardState,parsePostcardState,
  type PostcardTape } from '../src/engine/postcardReplay.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=['src/engine/postcards.ts','src/engine/postcardReplay.ts','scripts/postcard-proof.ts'];
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const currentFiles=()=>Object.fromEntries(files.map(file=>[file,sha(readFileSync(join(root,file)))]));
const HOUR=POSTCARD_HOUR_MS,rate={numerator:2,denominator:1},personId='postcard-offline-proof';
interface Scenario {name:string;tape:PostcardTape;checkpoints:{afterEvents:number;snapshot:string}[]}
interface Proof {format:'node-postcard-proof-v1';sourceRevision:string;sourceFiles:Record<string,string>;
  mode:'offline_explicit_clock_fixture';providerCalls:0;calibration:string;scenarios:Scenario[]}
const scenarioNames=['claim-after-12-hours','claim-after-24-hours','two-12-hour-claims',
  'fractional-save-and-reopen','safe-ladder-and-held-year'];
function scenario(name:string,events:PostcardEvent[],checkpointCounts:number[]=[]):Scenario {
  const tape=createPostcardTape(personId,rate,0,events),checkpoints=checkpointCounts.map(afterEvents=>{
    const prefix=createPostcardTape(personId,rate,0,events.slice(0,afterEvents));
    return {afterEvents,snapshot:serializePostcardState(verifyPostcardTape(prefix).state)};
  });
  return {name,tape,checkpoints};
}
function buildProof():Proof {
  let state=createPostcardState(personId,rate,0);const ladder:PostcardEvent[]=[];
  const submit=(event:PostcardEvent)=>{state=applyPostcardEvent(state,event).state;ladder.push(event);};
  // Collect real configured accrual, claiming before the cap; no inventory is fabricated.
  while(state.held.white<625){const quantity=Math.min(32,625-state.held.white);
    submit({kind:'claim',personId,atMs:state.clockMs+quantity*HOUR/2});}
  const beforeFusion=ladder.length;
  for(const tier of POSTCARD_TIERS.slice(0,-1))while(state.held[tier]>=5)
    submit({kind:'safeFusion',personId,atMs:state.clockMs,tier});
  const afterFusion=ladder.length;
  submit({kind:'clock',personId,atMs:state.clockMs+365*24*HOUR});
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const dirty=execFileSync('git',['status','--porcelain','--',...files],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  return {format:'node-postcard-proof-v1',sourceRevision:sourceRevision+(dirty?'-working-tree':''),sourceFiles:currentFiles(),
    mode:'offline_explicit_clock_fixture',providerCalls:0,
    calibration:'Explicit illustrative 2 White/hour from DESIGN_ADDENDUM_2026-08-07; no production rate or tick-to-hour mapping enabled.',
    scenarios:[
      scenario('claim-after-12-hours',[{kind:'claim',personId,atMs:12*HOUR}]),
      scenario('claim-after-24-hours',[{kind:'claim',personId,atMs:24*HOUR}]),
      scenario('two-12-hour-claims',[{kind:'claim',personId,atMs:12*HOUR},{kind:'claim',personId,atMs:24*HOUR}]),
      scenario('fractional-save-and-reopen',[{kind:'claim',personId,atMs:1},{kind:'claim',personId,atMs:HOUR}],[1]),
      scenario('safe-ladder-and-held-year',ladder,[beforeFusion,afterFusion]),
    ]};
}
function verify(proof:Proof) {
  const actualFiles=currentFiles();
  if(proof.format!=='node-postcard-proof-v1'||proof.mode!=='offline_explicit_clock_fixture'||proof.providerCalls!==0||
    !proof.sourceFiles||Object.keys(proof.sourceFiles).sort().join(',')!==[...files].sort().join(',')||
    files.some(file=>proof.sourceFiles[file]!==actualFiles[file])||!Array.isArray(proof.scenarios)||
    JSON.stringify(proof.scenarios.map(s=>s.name))!==JSON.stringify(scenarioNames))throw Error('postcard_proof_source_or_format');
  const results=proof.scenarios.map(item=>{
    const replay=verifyPostcardTape(item.tape);
    if(item.tape.genesis.personId!==personId||item.tape.genesis.createdAtMs!==0||
      item.tape.genesis.rate.numerator!==2||item.tape.genesis.rate.denominator!==1)throw Error('postcard_proof_fixture');
    for(const checkpoint of item.checkpoints){
      if(!Number.isSafeInteger(checkpoint.afterEvents)||checkpoint.afterEvents<0||checkpoint.afterEvents>item.tape.records.length)throw Error('postcard_checkpoint_index');
      let resumed=parsePostcardState(checkpoint.snapshot);
      const expected=checkpoint.afterEvents===0?item.tape.genesisHash:item.tape.records[checkpoint.afterEvents-1]!.afterHash;
      if(postcardStateHash(resumed)!==expected)throw Error('postcard_checkpoint_hash');
      for(const record of item.tape.records.slice(checkpoint.afterEvents))resumed=applyPostcardEvent(resumed,record.event).state;
      if(postcardStateHash(resumed)!==replay.finalHash)throw Error('postcard_checkpoint_resume');
    }
    const state:PostcardState=replay.state;
    const expectedWhite=[24,32,48,2,0][scenarioNames.indexOf(item.name)]!;
    const expectedTime=[12*HOUR,24*HOUR,24*HOUR,HOUR,(625/2+365*24)*HOUR][scenarioNames.indexOf(item.name)]!;
    if(state.held.white!==expectedWhite||state.clockMs!==expectedTime||
      state.held.orange!==(item.name==='safe-ladder-and-held-year'?1:0)||
      state.held.green!==0||state.held.blue!==0||state.held.purple!==0)throw Error('postcard_proof_result');
    return {name:item.name,events:replay.events,held:state.held,unclaimedUnits:state.unclaimedUnits,
      overflowUnits:state.overflowUnits,unitDenominator:postcardAccrualDenominator(state.rate).toString(),
      checkpointsReopened:item.checkpoints.length,finalHash:replay.finalHash};
  });
  return {verified:true,sourceRevision:proof.sourceRevision,providerCalls:0,scenarios:results};
}
const {values}=parseArgs({options:{output:{type:'string'},verify:{type:'string'}}});
if(Boolean(values.output)===Boolean(values.verify))throw Error('postcard_proof_output_or_verify_required');
if(values.verify){
  const path=resolve(values.verify),bytes=readFileSync(path);if(bytes.length>128*1024*1024)throw Error('postcard_proof_bounds');
  console.log(JSON.stringify(verify(JSON.parse(bytes.toString('utf8')) as Proof),null,2));
}else{
  const path=resolve(values.output!);if(existsSync(path))throw Error('postcard_proof_output_exists');
  const proof=buildProof(),verified=verify(proof);mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({...verified,output:path},null,2));
}
