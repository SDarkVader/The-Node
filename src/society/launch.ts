/** Trusted launch preparation. No provider client, endpoint, inference worker or dispatch. */
import { existsSync, lstatSync, realpathSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ExperimentBudget } from '../agent/experimentBudget.js';
import { PRICED_MODELS } from '../agent/modelPricing.js';
import { sha256 } from '../agent/accountingStore.js';
import { Society } from './runtime.js';
import { societyPlanHash, validateSocietyPlan, type SocietyRunPlan } from './accounted.js';
import { parseSocietyEvidence } from './codec.js';
import { digest } from '../agent/replay.js';
import type { Genesis } from '../agent/participantWorld.js';

export interface SocietyLaunchConfig {
  schema:'node-society-launch-v1'; sourceRevision:string; bundle:string; planSha256:string;
  priorDirectory:string; priorJournalSha256:string; priorHistoryHash:string; credentialSource:string;
  outputRoot:string; instruction:string; approved:true; runId:string;
}
export interface SocietyLaunchEnvironment {
  repositoryRoot:string;
  /** Trusted unit-test seam. The production CLI always uses the real Git verifier. */
  verifySource?:(root:string,expectedRevision:string)=>void;
}
export interface SocietyLaunchExecution {
  bundle:string; budget:string; carriedFingerprint:string; approval:string; credential:string;
  output:string; sourceRevision:string;
}
const fail=(code:string):never=>{throw new Error(code);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateSocietyLaunchConfig(value:unknown):asserts value is SocietyLaunchConfig {
  const keys=['schema','sourceRevision','bundle','planSha256','priorDirectory','priorJournalSha256','priorHistoryHash','credentialSource','outputRoot','instruction','approved','runId'];
  if(!object(value)||Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.schema!=='node-society-launch-v1'||
    typeof value.sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(value.sourceRevision)||!hash(value.planSha256)||!hash(value.priorJournalSha256)||!hash(value.priorHistoryHash)||
    value.approved!==true||typeof value.instruction!=='string'||!value.instruction.trim()||value.instruction.length>8192||
    typeof value.runId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.runId)||
    !['bundle','priorDirectory','credentialSource','outputRoot'].every(k=>typeof value[k]==='string'&&isAbsolute(value[k] as string)))fail('society_launch_config');
}
export function verifySocietyLaunchSource(root:string,expectedRevision:string):void {
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  if(revision!==expectedRevision)fail('society_launch_source_revision');
  execFileSync('git',['diff','--quiet','HEAD'],{cwd:root,windowsHide:true,stdio:'ignore'});
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','--','src','scripts','client','experiments','package.json','package-lock.json'],
    {cwd:root,encoding:'utf8',windowsHide:true}).trim();
  if(untracked)fail('society_launch_source_untracked');
}
function privatePath(path:string,root:string):string {
  const target=resolve(path);let ancestor=target;
  while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)fail('society_launch_private_path');ancestor=parent;}
  const actual=resolve(realpathSync(ancestor),relative(ancestor,target)),rel=relative(realpathSync(root),actual);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))fail('society_launch_private_path');
  return target;
}
function file(path:string,maxBytes:number):Buffer {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>maxBytes)fail('society_launch_file');
  return readFileSync(path);
}
function derived(config:SocietyLaunchConfig):SocietyLaunchExecution {
  return {bundle:resolve(config.bundle),budget:join(resolve(config.outputRoot),'allowance'),carriedFingerprint:config.priorHistoryHash,
    approval:join(resolve(config.outputRoot),'approval.json'),credential:join(resolve(config.outputRoot),'key.raw'),
    output:join(resolve(config.outputRoot),'run'),sourceRevision:config.sourceRevision};
}
interface Bundle {plan:SocietyRunPlan;genesis:Genesis;planSha256:string}
function inspect(config:SocietyLaunchConfig,environment:SocietyLaunchEnvironment) {
  validateSocietyLaunchConfig(config);
  const root=resolve(environment.repositoryRoot);
  (environment.verifySource??verifySocietyLaunchSource)(root,config.sourceRevision);
  for(const path of [config.bundle,config.priorDirectory,config.credentialSource,config.outputRoot])privatePath(path,root);
  if(existsSync(config.outputRoot)||!lstatSync(dirname(config.outputRoot)).isDirectory())fail('society_launch_output_exists_or_parent_missing');
  // Existence/metadata only: --check never opens or parses the credential source.
  const credentialStat=lstatSync(config.credentialSource);
  if(!credentialStat.isFile()||credentialStat.isSymbolicLink()||credentialStat.nlink!==1)fail('society_launch_credential_source');
  const execution=derived(config);
  for(const path of [execution.budget,execution.credential,execution.output,execution.approval,join(config.outputRoot,'execution.json')])if(existsSync(path))fail('society_launch_output_exists');
  const bundle=parseSocietyEvidence<Bundle>(file(config.bundle,128*1024*1024).toString('utf8'));validateSocietyPlan(bundle.plan);
  if(bundle.planSha256!==config.planSha256||societyPlanHash(bundle.plan)!==config.planSha256||
    bundle.genesis.sourceRevision!==config.sourceRevision||bundle.plan.sourceRevision!==config.sourceRevision||
    bundle.plan.ticks>20||bundle.plan.maxCalls>120||bundle.plan.allowance.limitMicroUsd>1_000_000)fail('society_launch_bundle');
  const society=new Society({seed:bundle.genesis.seed,sourceRevision:config.sourceRevision,config:bundle.genesis.config,observerSecret:bundle.genesis.observerSecret});
  if(society.hash!==bundle.plan.initialHash||digest(society.exportTape().genesis)!==digest(bundle.genesis)||digest(society.controlled)!==digest(bundle.plan.controlled))fail('society_launch_genesis');
  const priorPath=join(config.priorDirectory,'accounting.journal.json'),priorBytes=file(priorPath,8*1024*1024);
  if(sha256(priorBytes)!==config.priorJournalSha256)fail('society_launch_prior_bytes');
  const envelope:unknown=JSON.parse(priorBytes.toString('utf8'));
  if(!object(envelope)||Object.keys(envelope).sort().join(',')!=='format,payload,sha256'||envelope.format!=='node-accounting-journal-v1'||
    typeof envelope.payload!=='string'||sha256(envelope.payload)!==envelope.sha256)fail('society_launch_prior_checksum');
  const prior=ExperimentBudget.inspect(JSON.parse((envelope as {payload:string}).payload));
  if(existsSync(join(config.priorDirectory,'.accounting.lock'))||existsSync(join(config.priorDirectory,'.accounting.next')))fail('society_launch_prior_busy');
  if(prior.historyHash!==config.priorHistoryHash||prior.held!==0n||prior.overrun||!prior.authorization||
    prior.requests.length<prior.authorization.maxRequests||prior.requests.some(q=>q.bookedMicroUsd===null))fail('society_launch_prior_not_closed');
  return {bundle,execution,priorPath,priorBytes};
}
/** Read-only preflight, including no credential-content read and no accounting lock/write. */
export function checkSocietyLaunch(config:SocietyLaunchConfig,environment:SocietyLaunchEnvironment) {
  const checked=inspect(config,environment);
  return {ok:true as const,sourceRevision:config.sourceRevision,planSha256:config.planSha256,priorHistoryHash:config.priorHistoryHash,
    ticks:checked.bundle.plan.ticks,maxCalls:checked.bundle.plan.maxCalls,limitMicroUsd:checked.bundle.plan.allowance.limitMicroUsd,
    credentialSourceExists:true,priorCountClosed:true,execution:checked.execution,providerCalls:0,allowanceCreated:false};
}
/** Parse data only: no shell sourcing, expansion, evaluation, credential output or other env loading. */
export function parseSocietyLaunchCredential(bytes:Buffer):string {
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>65536)fail('society_launch_credential_syntax');
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();
  const valid=(v:string)=>v.length<=4095&&/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(v);
  if(valid(text))return text;
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  if(lines.length!==1)fail('society_launch_credential_syntax');
  const match=/^ANTHROPIC_API_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))\s*$/.exec(lines[0]!);
  const key=match?.[1]??match?.[2]??match?.[3];
  if(!key||!valid(key))return fail('society_launch_credential_syntax');return key;
}
function writeNew(path:string,contents:string,created?:()=>void):void {
  const fd=openSync(path,'wx',0o600);created?.();try{writeFileSync(fd,contents);fsyncSync(fd);}finally{closeSync(fd);}
}
/** Invoked only when the human starts the standalone launcher. Creates one fresh approved
 * allowance by carrying the complete pinned prior history. It performs zero provider calls. */
export function prepareSocietyLaunch(config:SocietyLaunchConfig,environment:SocietyLaunchEnvironment):SocietyLaunchExecution {
  const initial=inspect(config,environment);
  // Validate the existing credential syntax before any new financial artifact is created.
  const key=parseSocietyLaunchCredential(file(config.credentialSource,65536));
  const checked=inspect(config,environment);
  if(!checked.priorBytes.equals(initial.priorBytes))fail('society_launch_prior_changed');
  let keyCreated=false,budget:ExperimentBudget|undefined;
  try{
    mkdirSync(config.outputRoot,{mode:0o700});
    writeNew(checked.execution.credential,key+'\n',()=>{keyCreated=true;});
    budget=ExperimentBudget.carryFromExperiment(checked.execution.budget,config.priorDirectory);
    if(budget.carriedFingerprint()!==config.priorHistoryHash)fail('society_launch_carried_mismatch');
    const now=Date.now(),plan=checked.bundle.plan;
    budget.authorize({runId:config.runId,authorizedAt:new Date(now).toISOString(),expiresAt:new Date(now+24*3600000).toISOString(),
      expectedCarriedFingerprint:config.priorHistoryHash,instruction:config.instruction,scope:'accounted_experiment_spending_only',
      manifestSha256:config.planSha256,model:plan.model,maxRequests:plan.maxCalls,limitMicroUsd:plan.allowance.limitMicroUsd,
      perRequestMicroUsd:plan.allowance.perRequestMicroUsd,prices:PRICED_MODELS[plan.model]!});
    budget.close();budget=undefined;
    if(!file(checked.priorPath,8*1024*1024).equals(initial.priorBytes))fail('society_launch_prior_changed');
    writeNew(checked.execution.approval,JSON.stringify({approved:true,planSha256:config.planSha256,instruction:config.instruction},null,2)+'\n');
    writeNew(join(config.outputRoot,'execution.json'),JSON.stringify(checked.execution,null,2)+'\n');
    return checked.execution;
  }catch(error){
    // Remove only this invocation's raw-key copy. All financial/failure artifacts remain,
    // and an existing output directory prevents an automatic retry or duplicate allowance.
    if(keyCreated)try{unlinkSync(checked.execution.credential);}catch{/* The launcher also owns cleanup. */}
    throw error;
  }finally{budget?.close();}
}
