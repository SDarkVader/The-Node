import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { root,cleanup } from './fixtures/accountingFixture.js';
import { continuationBudget,continuationPlan } from './fixtures/continuationFixture.js';
import { ExperimentBudget } from '../src/agent/experimentBudget.js';
import { Society } from '../src/society/runtime.js';
import { createSocietyPlan,societyPlanHash } from '../src/society/accounted.js';
import { stringifySocietyEvidence } from '../src/society/codec.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { checkSocietyLaunch,prepareSocietyLaunch,parseSocietyLaunchCredential,validateSocietyLaunchConfig,
  type SocietyLaunchConfig } from '../src/society/launch.js';

afterEach(()=>{vi.restoreAllMocks();cleanup();});
const fakeKey='sk-ant-TEST_ONLY_not_a_real_credential_1234567890';
function fixture(priorState:'closed'|'open'|'hold'|'overrun'='closed'){
  const directory=root(),repositoryRoot=join(directory,'repo');mkdirSync(repositoryRoot);
  const priorDirectory=join(directory,'TEST-ONLY-prior'),prior=continuationBudget(continuationPlan(),priorDirectory);
  try{
    const count=priorState==='closed'?4:priorState==='open'?0:1;
    for(let i=0;i<count;i++){
      prior.reserve({id:'TEST_ONLY_request_'+i,episodeId:'TEST_ONLY_episode',actorId:'TEST_ONLY_actor',inputSha256:'a'.repeat(64),
        participant:{tick:i,selfRef:'TEST_ONLY_observer',role:'Baker',roleEpoch:0},model:'claude-haiku-5-5',maxInputTokens:100,maxOutputTokens:100});
      if(priorState!=='hold')prior.recordUsage({requestId:'TEST_ONLY_request_'+i,receiptId:'TEST_ONLY_receipt_'+i,sourceSha256:'b'.repeat(64),
        model:'claude-haiku-5-5',inputTokens:20,outputTokens:priorState==='overrun'?200:20});
    }
  }finally{prior.close();}
  const bytes=readFileSync(join(priorDirectory,'accounting.journal.json')),envelope=JSON.parse(bytes.toString());
  const previous=ExperimentBudget.inspect(JSON.parse(envelope.payload)),sourceRevision='a'.repeat(40);
  const society=new Society({seed:42,sourceRevision}),plan=createSocietyPlan(society,{ticks:20});
  const bundle=join(directory,'TEST-ONLY-bundle.json'),credentialSource=join(directory,'TEST-ONLY-Claude.env');
  writeFileSync(bundle,stringifySocietyEvidence({plan,genesis:society.exportTape().genesis,planSha256:societyPlanHash(plan)}),{mode:0o600});
  writeFileSync(credentialSource,`ANTHROPIC_API_KEY="${fakeKey}"\n`,{mode:0o600});
  const config:SocietyLaunchConfig={schema:'node-society-launch-v1',sourceRevision,bundle,planSha256:societyPlanHash(plan),priorDirectory,
    priorJournalSha256:sha256(bytes),priorHistoryHash:previous.historyHash,credentialSource,outputRoot:join(directory,'TEST-ONLY-execution'),
    instruction:'TEST ONLY synthetic launch approval. No actual model call, private account or financial authority.',approved:true,runId:'TEST-ONLY-society-launch'};
  const verified:string[]=[];
  const environment={repositoryRoot,verifySource:(path:string,revision:string)=>{expect(path).toBe(repositoryRoot);expect(revision).toBe(sourceRevision);verified.push(revision);}};
  return {directory,config,environment,bytes,verified};
}
describe('standalone society trusted preparation, synthetic files and journals only',()=>{
  it('performs a read-only check without parsing credentials, locking accounting or creating an allowance',()=>{
    const f=fixture();writeFileSync(f.config.credentialSource,'THIS IS NOT A CREDENTIAL');
    const result=checkSocietyLaunch(f.config,f.environment);
    expect(result).toMatchObject({ok:true,ticks:20,maxCalls:120,limitMicroUsd:1_000_000,providerCalls:0,allowanceCreated:false});
    expect(existsSync(f.config.outputRoot)).toBe(false);
    expect(existsSync(join(f.config.priorDirectory,'.accounting.lock'))).toBe(false);
    expect(readFileSync(join(f.config.priorDirectory,'accounting.journal.json'))).toEqual(f.bytes);
    expect(f.verified).toHaveLength(1);expect(JSON.stringify(result)).not.toContain(fakeKey);
  });

  it('creates one exact carried allowance and approval without dispatch or changing any prior journal bytes',()=>{
    const f=fixture(),execution=prepareSocietyLaunch(f.config,f.environment);
    expect(execution).toEqual({bundle:f.config.bundle,budget:join(f.config.outputRoot,'allowance'),carriedFingerprint:f.config.priorHistoryHash,
      approval:join(f.config.outputRoot,'approval.json'),credential:join(f.config.outputRoot,'key.raw'),output:join(f.config.outputRoot,'run'),sourceRevision:f.config.sourceRevision});
    expect(existsSync(execution.output)).toBe(false);expect(readFileSync(execution.credential,'utf8').trim()).toBe(fakeKey);
    expect(JSON.stringify(execution)).not.toContain(fakeKey);
    expect(JSON.parse(readFileSync(execution.approval,'utf8'))).toEqual({approved:true,planSha256:f.config.planSha256,instruction:f.config.instruction});
    expect(JSON.parse(readFileSync(join(f.config.outputRoot,'execution.json'),'utf8'))).toEqual(execution);
    const budget=ExperimentBudget.open(execution.budget);
    try{
      const view=budget.view();expect(view.requests).toHaveLength(0);expect(view.booked).toBe(0n);expect(view.held).toBe(0n);
      expect(budget.carriedFingerprint()).toBe(f.config.priorHistoryHash);
      expect(view.carried.requests).toBe(4);expect(BigInt(view.carried.bookedMicroUsd)).toBeGreaterThan(0n);
      expect(view.authorization).toMatchObject({runId:f.config.runId,manifestSha256:f.config.planSha256,model:'claude-haiku-5-5',maxRequests:120,limitMicroUsd:1_000_000});
      expect(Date.parse(view.authorization!.expiresAt)-Date.parse(view.authorization!.authorizedAt)).toBe(24*3600000);
    }finally{budget.close();}
    expect(readFileSync(join(f.config.priorDirectory,'accounting.journal.json'))).toEqual(f.bytes);
    expect(()=>prepareSocietyLaunch(f.config,f.environment)).toThrow('society_launch_output_exists_or_parent_missing');
  });

  it('rejects invalid credential syntax before creating any financial directory or journal',()=>{
    const f=fixture();writeFileSync(f.config.credentialSource,'ANTHROPIC_API_KEY=$(run_something)');
    expect(()=>prepareSocietyLaunch(f.config,f.environment)).toThrow('society_launch_credential_syntax');
    expect(existsSync(f.config.outputRoot)).toBe(false);
    expect(readFileSync(join(f.config.priorDirectory,'accounting.journal.json'))).toEqual(f.bytes);
  });

  it('deletes only its newly created raw key on preparation failure while preserving partial financial artifacts',()=>{
    const f=fixture();vi.spyOn(ExperimentBudget.prototype,'authorize').mockImplementation(()=>{throw Error('TEST_ONLY_authorize_failed');});
    expect(()=>prepareSocietyLaunch(f.config,f.environment)).toThrow('TEST_ONLY_authorize_failed');
    expect(existsSync(join(f.config.outputRoot,'key.raw'))).toBe(false);
    expect(existsSync(join(f.config.outputRoot,'allowance','accounting.journal.json'))).toBe(true);
    expect(existsSync(join(f.config.outputRoot,'execution.json'))).toBe(false);
    expect(readFileSync(join(f.config.priorDirectory,'accounting.journal.json'))).toEqual(f.bytes);
    expect(()=>prepareSocietyLaunch(f.config,f.environment)).toThrow('society_launch_output_exists_or_parent_missing');
  });

  it('never removes or overwrites a key or allowance from an earlier attempt',()=>{
    const f=fixture();mkdirSync(f.config.outputRoot);writeFileSync(join(f.config.outputRoot,'key.raw'),'EXISTING_PRIVATE_FILE');
    expect(()=>prepareSocietyLaunch(f.config,f.environment)).toThrow('society_launch_output_exists_or_parent_missing');
    expect(readFileSync(join(f.config.outputRoot,'key.raw'),'utf8')).toBe('EXISTING_PRIVATE_FILE');
  });

  it.each(['open','hold','overrun'] as const)('refuses an unsafe or non-count-closed prior allowance: %s',state=>{
    const f=fixture(state);expect(()=>checkSocietyLaunch(f.config,f.environment)).toThrow('society_launch_prior_not_closed');
    expect(existsSync(f.config.outputRoot)).toBe(false);
  });

  it('checks both exact prior bytes and its complete historical fingerprint',()=>{
    const f=fixture();
    expect(()=>checkSocietyLaunch({...f.config,priorJournalSha256:'0'.repeat(64)},f.environment)).toThrow('society_launch_prior_bytes');
    expect(()=>checkSocietyLaunch({...f.config,priorHistoryHash:'0'.repeat(64)},f.environment)).toThrow('society_launch_prior_not_closed');
    const path=join(f.config.priorDirectory,'accounting.journal.json'),changed=JSON.parse(f.bytes.toString());changed.sha256='0'.repeat(64);
    const changedBytes=Buffer.from(JSON.stringify(changed));writeFileSync(path,changedBytes);
    expect(()=>checkSocietyLaunch({...f.config,priorJournalSha256:sha256(changedBytes)},f.environment)).toThrow('society_launch_prior_checksum');
  });

  it('rejects unknown configuration, source proof failures, changed bundle hashes and repository-private destinations',()=>{
    const f=fixture();expect(()=>validateSocietyLaunchConfig({...f.config,extra:true})).toThrow('society_launch_config');
    expect(()=>checkSocietyLaunch(f.config,{...f.environment,verifySource:()=>{throw Error('TEST_ONLY_dirty_source');}})).toThrow('TEST_ONLY_dirty_source');
    expect(()=>checkSocietyLaunch({...f.config,planSha256:'0'.repeat(64)},f.environment)).toThrow('society_launch_bundle');
    expect(()=>checkSocietyLaunch({...f.config,outputRoot:join(f.environment.repositoryRoot,'private')},f.environment)).toThrow('society_launch_private_path');
  });

  it('parses only literal raw keys or one literal ANTHROPIC_API_KEY assignment',()=>{
    for(const value of [fakeKey,`ANTHROPIC_API_KEY=${fakeKey}`,`# comment\r\nANTHROPIC_API_KEY='${fakeKey}'\r\n`])expect(parseSocietyLaunchCredential(Buffer.from(value))).toBe(fakeKey);
    for(const value of ['export ANTHROPIC_API_KEY='+fakeKey,'ANTHROPIC_API_KEY='+fakeKey+'\nOTHER_TOKEN=anything','ANTHROPIC_API_KEY="'+fakeKey+'"; run()','not-a-key'])
      expect(()=>parseSocietyLaunchCredential(Buffer.from(value))).toThrow('society_launch_credential_syntax');
    expect(parseSocietyLaunchCredential(Buffer.from('sk-ant-'+'a'.repeat(4088)))).toHaveLength(4095);
    expect(()=>parseSocietyLaunchCredential(Buffer.from('sk-ant-'+'a'.repeat(4089)))).toThrow('society_launch_credential_syntax');
  });
});
