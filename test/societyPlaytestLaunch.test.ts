import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach,describe,expect,it} from 'vitest';
import {root,cleanup} from './fixtures/accountingFixture.js';
import {continuationBudget,continuationPlan} from './fixtures/continuationFixture.js';
import {Society,type SocietyOptions} from '../src/society/runtime.js';
import {createSocietyPlan,societyPlanHash} from '../src/society/accounted.js';
import {parseSocietyEvidence,stringifySocietyEvidence} from '../src/society/codec.js';
import {prepareSocietyPlaytest,checkSocietyPlaytest,approveSocietyPlaytest,type PlaytestEnvironment} from '../scripts/prepare-society-playtest.js';

afterEach(cleanup);
const sourceRevision='a'.repeat(40);
function fixture(state:'closed'|'open'|'held'='closed'){
  const directory=root(),repositoryRoot=join(directory,'repo');mkdirSync(repositoryRoot);
  const priorDirectory=join(directory,'TEST-ONLY-prior'),budget=continuationBudget(continuationPlan(),priorDirectory);
  try{
    for(let i=0;i<(state==='closed'?4:state==='open'?0:1);i++){
      budget.reserve({id:'TEST_ONLY_request_'+i,episodeId:'TEST_ONLY_episode',actorId:'TEST_ONLY_actor',inputSha256:'a'.repeat(64),
        participant:{tick:i,selfRef:'TEST_ONLY_observer',role:'Baker',roleEpoch:0},model:'claude-haiku-5-5',maxInputTokens:100,maxOutputTokens:100});
      if(state!=='held')budget.recordUsage({requestId:'TEST_ONLY_request_'+i,receiptId:'TEST_ONLY_receipt_'+i,sourceSha256:'b'.repeat(64),
        model:'claude-haiku-5-5',inputTokens:20,outputTokens:20});
    }
  }finally{budget.close();}
  const priorJournal=join(priorDirectory,'accounting.journal.json'),bytes=readFileSync(priorJournal);
  const credentialFile=join(directory,'TEST-ONLY-credential.env');
  // Deliberately not parseable: review/check/approve must never read credential contents.
  writeFileSync(credentialFile,'NOT A CREDENTIAL, DO NOT PARSE',{mode:0o600});
  const outputRoot=join(directory,'TEST-ONLY-new-playtest');
  const environment:PlaytestEnvironment={repositoryRoot,sourceRevision,verifySource:(path,revision)=>{
    expect(path).toBe(repositoryRoot);expect(revision).toBe(sourceRevision);
  },prepareBundle:(path,options)=>{
    const society=new Society({seed:options.seed,sourceRevision,postcards:options.postcards} as SocietyOptions),tape=society.exportTape();
    const plan=createSocietyPlan(society,{ticks:options.ticks});
    writeFileSync(path,stringifySocietyEvidence({plan,genesis:tape.genesis,postcardConfig:options.postcards,planSha256:societyPlanHash(plan)}),{flag:'wx',mode:0o600});
  }};
  const options={priorJournal,credentialFile,outputRoot,postcardRate:'2/1',ticks:3,seed:42};
  return {directory,environment,options,bytes};
}
describe('human-started postcard playtest review and approval preparation',()=>{
  it('prepares a private pinned review with no approval, credential parsing, allowance or provider operation',()=>{
    const f=fixture(),result=prepareSocietyPlaytest(f.options,f.environment),review=JSON.parse(readFileSync(result.review,'utf8'));
    expect(result).toMatchObject({ok:true,approved:false,ticks:3,maxCalls:18,limitMicroUsd:1_000_000,providerCalls:0,allowanceCreated:false,
      postcards:{rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000}});
    expect(review.launch.approved).toBe(false);
    expect(readFileSync(join(review.launch.priorDirectory,'accounting.journal.json'))).toEqual(f.bytes);
    expect(readFileSync(f.options.priorJournal)).toEqual(f.bytes);
    expect(existsSync(review.launch.outputRoot)).toBe(false);
    expect(existsSync(join(f.options.outputRoot,'launch.json'))).toBe(false);
    expect(existsSync(join(review.launch.priorDirectory,'.accounting.lock'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('NOT A CREDENTIAL');
    expect(checkSocietyPlaytest(result.review,f.environment)).toEqual(result);
  });
  it('requires a separate explicit approval and writes only a new launcher config',()=>{
    const f=fixture(),prepared=prepareSocietyPlaytest(f.options,f.environment),before=readFileSync(prepared.review);
    expect(()=>approveSocietyPlaytest(prepared.review,false,f.environment)).toThrow('society_playtest_explicit_approval_required');
    const approved=approveSocietyPlaytest(prepared.review,true,f.environment),launch=JSON.parse(readFileSync(approved.launch,'utf8'));
    expect(launch.approved).toBe(true);expect(launch.planSha256).toBe(prepared.planSha256);
    expect(approved).toMatchObject({providerCalls:0,allowanceCreated:false,maxCalls:18});
    expect(existsSync(launch.outputRoot)).toBe(false);expect(readFileSync(prepared.review)).toEqual(before);
    expect(readFileSync(f.options.priorJournal)).toEqual(f.bytes);
    expect(()=>approveSocietyPlaytest(prepared.review,true,f.environment)).toThrow();
  });
  it('refuses reused preparation directories and retains the entire earlier review',()=>{
    const f=fixture(),prepared=prepareSocietyPlaytest(f.options,f.environment),before=readFileSync(prepared.review);
    expect(()=>prepareSocietyPlaytest(f.options,f.environment)).toThrow('society_playtest_output_exists_or_parent_missing');
    expect(readFileSync(prepared.review)).toEqual(before);
  });
  it.each(['open','held']as const)('refuses a %s prior before creating any review directory',state=>{
    const f=fixture(state);expect(()=>prepareSocietyPlaytest(f.options,f.environment)).toThrow('society_playtest_prior_not_closed');
    expect(existsSync(f.options.outputRoot)).toBe(false);
  });
  it('pins the supplied latest original journal as well as its exact carried copy',()=>{
    const f=fixture(),prepared=prepareSocietyPlaytest(f.options,f.environment);
    writeFileSync(f.options.priorJournal,Buffer.concat([f.bytes,Buffer.from(' ')]));
    expect(()=>checkSocietyPlaytest(prepared.review,f.environment)).toThrow('society_playtest_prior_changed');
    expect(()=>approveSocietyPlaytest(prepared.review,true,f.environment)).toThrow('society_playtest_prior_changed');
    expect(existsSync(join(f.options.outputRoot,'launch.json'))).toBe(false);
  });
  it('rejects source drift, altered feature parameters, draft approval and unsupported review fields',()=>{
    const f=fixture(),prepared=prepareSocietyPlaytest(f.options,f.environment),original=readFileSync(prepared.review,'utf8');
    expect(()=>checkSocietyPlaytest(prepared.review,{...f.environment,verifySource:()=>{throw Error('TEST_ONLY_dirty_source');}})).toThrow('TEST_ONLY_dirty_source');
    for(const change of [(q:any)=>{q.postcards.rate.numerator=3;},(q:any)=>{q.launch.approved=true;},(q:any)=>{q.extra='unsupported';}]){
      const q=JSON.parse(original);change(q);writeFileSync(prepared.review,JSON.stringify(q));
      expect(()=>checkSocietyPlaytest(prepared.review,f.environment)).toThrow();
    }
    writeFileSync(prepared.review,original);expect(checkSocietyPlaytest(prepared.review,f.environment).ok).toBe(true);
  });
  it('rejects changed feature data in the source-pinned live bundle',()=>{
    const f=fixture(),prepared=prepareSocietyPlaytest(f.options,f.environment),review=JSON.parse(readFileSync(prepared.review,'utf8'));
    const original=readFileSync(review.launch.bundle,'utf8'),bundle=parseSocietyEvidence<any>(original);
    bundle.postcardConfig.rate.numerator=3;
    writeFileSync(review.launch.bundle,stringifySocietyEvidence(bundle));
    expect(()=>checkSocietyPlaytest(prepared.review,f.environment)).toThrow();
    expect(()=>approveSocietyPlaytest(prepared.review,true,f.environment)).toThrow();
    expect(existsSync(join(f.options.outputRoot,'launch.json'))).toBe(false);
    writeFileSync(review.launch.bundle,original);expect(checkSocietyPlaytest(prepared.review,f.environment).ok).toBe(true);
  });
  it('rejects invalid call/day/clock inputs before creating any review directory',()=>{
    const f=fixture();
    for(const change of [{ticks:0},{ticks:21},{ticks:1.5},{seed:0.5},{postcardStartMs:-1},{postcardStartMs:Number.MAX_SAFE_INTEGER}])
      expect(()=>prepareSocietyPlaytest({...f.options,...change},f.environment)).toThrow();
    expect(existsSync(f.options.outputRoot)).toBe(false);
  });
  it.each(['0/1','2/2','1/0','0.5','2','01/1','9007199254740992/1'])('rejects unsupported explicit rate %s before creating output',postcardRate=>{
    const f=fixture();expect(()=>prepareSocietyPlaytest({...f.options,postcardRate},f.environment)).toThrow();
    expect(existsSync(f.options.outputRoot)).toBe(false);
  });
  it('rejects in-repository private inputs/output and busy original journals',()=>{
    const f=fixture();expect(()=>prepareSocietyPlaytest({...f.options,outputRoot:join(f.environment.repositoryRoot,'private')},f.environment)).toThrow('society_playtest_private_path');
    writeFileSync(join(f.directory,'TEST-ONLY-prior','.accounting.lock'),'TEST ONLY');
    expect(()=>prepareSocietyPlaytest(f.options,f.environment)).toThrow('society_playtest_prior_busy');
    expect(existsSync(f.options.outputRoot)).toBe(false);
  });
  it('parses the Windows PowerShell launcher and keeps real dispatch behind the approval branch',()=>{
    const script=readFileSync('scripts/start-society-playtest.ps1','utf8');
    expect(script).toContain("DefaultParameterSetName = 'Prepare'");expect(script).toContain('if (-not $ApprovePaidRun)');
    expect(script.indexOf('--approve --review')).toBeGreaterThan(script.indexOf('if (-not $ApprovePaidRun)'));
    expect(script).toContain("'start-society-live.ps1'");
    if(process.platform==='win32'){
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        "$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/start-society-playtest.ps1'), [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { exit 1 }"],{windowsHide:true,stdio:'pipe'});
      expect(()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('scripts/start-society-playtest.ps1'),
        '-Review','TEST_ONLY_MISSING_REVIEW','-CheckOnly','-ApprovePaidRun'],{windowsHide:true,stdio:'pipe'})).toThrow();
    }
  });
});
