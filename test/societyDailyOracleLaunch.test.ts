import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach,describe,expect,it} from 'vitest';
import {root,cleanup} from './fixtures/accountingFixture.js';
import {continuationBudget,continuationPlan} from './fixtures/continuationFixture.js';
import {Society} from '../src/society/runtime.js';
import {createSocietyPlan,societyPlanHash} from '../src/society/accounted.js';
import {parseSocietyEvidence,stringifySocietyEvidence} from '../src/society/codec.js';
import {prepareSocietyPlaytest,checkSocietyPlaytest,approveSocietyPlaytest,type PlaytestEnvironment} from '../scripts/prepare-society-playtest.js';

afterEach(cleanup);
const sourceRevision='a'.repeat(40);
const trial=()=>({format:'node-society-daily-oracle-config-v1' as const,funding:'declaredTrialEndowment' as const,treasuryMicro:100_000_000,
  catalogue:{format:'node-oracle-daily-config-v1' as const,revision:'TEST-ONLY-approved-trial',rewards:[
    {id:'common',amountMicro:50_000,logWeightAtFloor:Math.log(100),logWeightAtReference:Math.log(100)},
    {id:'uncommon',amountMicro:150_000,logWeightAtFloor:Math.log(5),logWeightAtReference:Math.log(10)},
    {id:'rare',amountMicro:300_000,logWeightAtFloor:Math.log(0.1),logWeightAtReference:Math.log(1)},
  ]}});
function fixture(){
  const directory=root(),repositoryRoot=join(directory,'repo');mkdirSync(repositoryRoot);
  const priorDirectory=join(directory,'TEST-ONLY-prior'),budget=continuationBudget(continuationPlan(),priorDirectory);
  try{for(let i=0;i<4;i++){
    budget.reserve({id:`TEST_ONLY_request_${i}`,episodeId:'TEST_ONLY_episode',actorId:'TEST_ONLY_actor',inputSha256:'a'.repeat(64),
      participant:{tick:i,selfRef:'TEST_ONLY_observer',role:'Baker',roleEpoch:0},model:'claude-haiku-5-5',maxInputTokens:100,maxOutputTokens:100});
    budget.recordUsage({requestId:`TEST_ONLY_request_${i}`,receiptId:`TEST_ONLY_receipt_${i}`,sourceSha256:'b'.repeat(64),
      model:'claude-haiku-5-5',inputTokens:20,outputTokens:20});
  }}finally{budget.close();}
  const priorJournal=join(priorDirectory,'accounting.journal.json'),credentialFile=join(directory,'TEST-ONLY-invalid-key.env');
  writeFileSync(credentialFile,'TEST ONLY INVALID KEY: review must never read this content',{mode:0o600});
  const oracleConfig=join(directory,'TEST-ONLY-oracle.json');writeFileSync(oracleConfig,JSON.stringify(trial()));
  const options={priorJournal,credentialFile,outputRoot:join(directory,'TEST-ONLY-playtest'),postcardRate:'2/1',ticks:3,seed:42,oracleConfig};
  const environment:PlaytestEnvironment={repositoryRoot,sourceRevision,verifySource:()=>{},prepareBundle:(path,o)=>{
    const society=new Society({seed:o.seed,sourceRevision,postcards:o.postcards,...(o.dailyOracle?{dailyOracle:o.dailyOracle}:{})});
    const tape=society.exportTape(),plan=createSocietyPlan(society,{ticks:o.ticks});
    writeFileSync(path,stringifySocietyEvidence({plan,genesis:tape.genesis,postcardConfig:o.postcards,
      ...(o.dailyOracle?{dailyOracleConfig:o.dailyOracle}:{}),planSha256:societyPlanHash(plan)}),{flag:'wx',mode:0o600});
  }};
  return {directory,options,environment};
}

describe('daily Oracle in the source-pinned human playtest launcher',()=>{
  it('pins exactly the configured catalogue and game treasury independently from the USD allowance',()=>{
    const f=fixture(),prior=readFileSync(f.options.priorJournal),key=readFileSync(f.options.credentialFile);
    const result=prepareSocietyPlaytest(f.options,f.environment),review=JSON.parse(readFileSync(result.review,'utf8'));
    const bundle=parseSocietyEvidence<any>(readFileSync(review.launch.bundle,'utf8'));
    expect(result).toMatchObject({ok:true,approved:false,dailyOracle:trial(),ticks:3,maxCalls:18,limitMicroUsd:1_000_000,providerCalls:0,allowanceCreated:false});
    expect(review.dailyOracle).toEqual(trial());expect(bundle.dailyOracleConfig).toEqual(trial());expect(bundle.plan.dailyOracle).toEqual(trial());
    expect(bundle.plan.schema).not.toBe('node-accounted-society-postcards-v2');
    expect(bundle.plan.schema).not.toBe('node-accounted-society-v1');
    expect(review.launch.instruction).toContain('100 game-wealth, separate from USD model spending');
    expect(review.launch.approved).toBe(false);expect(existsSync(review.launch.outputRoot)).toBe(false);
    expect(readFileSync(f.options.priorJournal)).toEqual(prior);expect(readFileSync(f.options.credentialFile)).toEqual(key);
    expect(checkSocietyPlaytest(result.review,f.environment)).toEqual(result);
  });
  it('uses the prepared immutable config snapshot when the original profile file later changes',()=>{
    const f=fixture(),result=prepareSocietyPlaytest(f.options,f.environment),before=readFileSync(result.review);
    writeFileSync(f.options.oracleConfig,'{"changed":"not the reviewed configuration"}');
    expect(checkSocietyPlaytest(result.review,f.environment).dailyOracle).toEqual(trial());
    expect(readFileSync(result.review)).toEqual(before);
  });
  it.each(['treasury','catalogue','extra']as const)('rejects review %s changes before writing approval',part=>{
    const f=fixture(),result=prepareSocietyPlaytest(f.options,f.environment),review=JSON.parse(readFileSync(result.review,'utf8'));
    if(part==='treasury')review.dailyOracle.treasuryMicro++;
    if(part==='catalogue')review.dailyOracle.catalogue.rewards[0].amountMicro++;
    if(part==='extra')review.dailyOracle.seed=1;
    writeFileSync(result.review,JSON.stringify(review));
    expect(()=>checkSocietyPlaytest(result.review,f.environment)).toThrow();
    expect(()=>approveSocietyPlaytest(result.review,true,f.environment)).toThrow();
    expect(existsSync(join(f.options.outputRoot,'launch.json'))).toBe(false);
  });
  it.each(['changed','missing','plan']as const)('rejects %s daily feature data in the bound bundle',part=>{
    const f=fixture(),result=prepareSocietyPlaytest(f.options,f.environment),review=JSON.parse(readFileSync(result.review,'utf8'));
    const bundle=parseSocietyEvidence<any>(readFileSync(review.launch.bundle,'utf8'));
    if(part==='changed')bundle.dailyOracleConfig.treasuryMicro++;
    if(part==='missing')delete bundle.dailyOracleConfig;
    if(part==='plan'){bundle.plan.dailyOracle.treasuryMicro++;bundle.planSha256=societyPlanHash(bundle.plan);}
    writeFileSync(review.launch.bundle,stringifySocietyEvidence(bundle));
    expect(()=>checkSocietyPlaytest(result.review,f.environment)).toThrow();
    expect(()=>approveSocietyPlaytest(result.review,true,f.environment)).toThrow();
    expect(existsSync(review.launch.outputRoot)).toBe(false);
  });
  it.each(['invalid-json','extra-field','oversized']as const)('refuses %s profile before creating the private run directory',part=>{
    const f=fixture();
    writeFileSync(f.options.oracleConfig,part==='invalid-json'?'{':part==='oversized'?' '.repeat(65537):JSON.stringify({...trial(),tools:[]}));
    expect(()=>prepareSocietyPlaytest(f.options,f.environment)).toThrow();
    expect(existsSync(f.options.outputRoot)).toBe(false);
  });
  it('requires human approval for only the reviewed source/config/history and creates no allowance itself',()=>{
    const f=fixture(),result=prepareSocietyPlaytest(f.options,f.environment),before=readFileSync(result.review);
    expect(()=>approveSocietyPlaytest(result.review,false,f.environment)).toThrow('society_playtest_explicit_approval_required');
    const approved=approveSocietyPlaytest(result.review,true,f.environment),launch=JSON.parse(readFileSync(approved.launch,'utf8'));
    expect(approved).toMatchObject({dailyOracle:trial(),maxCalls:18,providerCalls:0,allowanceCreated:false});
    expect(launch.planSha256).toBe(result.planSha256);expect(launch.approved).toBe(true);
    expect(existsSync(launch.outputRoot)).toBe(false);expect(readFileSync(result.review)).toEqual(before);
  });
  it('rejects prepare-only feature flags on recheck and keeps PowerShell feature selection in the prepare parameter set',()=>{
    expect(()=>execFileSync(process.execPath,['--import','tsx',resolve('scripts/prepare-society-playtest.ts'),'--check','--review','TEST_ONLY_MISSING',
      '--oracle-config','TEST_ONLY_CONFIG'],{encoding:'utf8',windowsHide:true,stdio:'pipe'})).toThrow();
    const script=readFileSync('scripts/start-society-playtest.ps1','utf8');
    expect(script).toContain("[Parameter(ParameterSetName = 'Prepare')][ValidateNotNullOrEmpty()][string]$OracleConfig");
    if(process.platform==='win32'){
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        "$errors=$null; $tokens=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/start-society-playtest.ps1'),[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){exit 1}"],{windowsHide:true,stdio:'pipe'});
      expect(()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('scripts/start-society-playtest.ps1'),
        '-Review','TEST_ONLY_MISSING','-CheckOnly','-OracleConfig','TEST_ONLY_CONFIG'],{windowsHide:true,stdio:'pipe'})).toThrow();
    }
  });
});
