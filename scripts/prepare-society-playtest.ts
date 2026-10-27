/** Prepare/recheck a fresh real-agent playtest; never opens a credential or allowance.
 * A later explicit human --approve writes the config used by the existing paid launcher. */
import {existsSync,lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseArgs,isDeepStrictEqual} from 'node:util';
import {randomBytes} from 'node:crypto';
import {checkSocietyLaunch,validateSocietyLaunchConfig,verifySocietyLaunchSource,type SocietyLaunchConfig} from '../src/society/launch.js';
import {inspectSocietyFunding} from '../src/society/funding.js';
import {sha256} from '../src/agent/accountingStore.js';
import {parseSocietyEvidence} from '../src/society/codec.js';
import {societyPlanHash,validateSocietyPlan,type SocietyRunPlan} from '../src/society/accounted.js';
import {validateSocietyDailyOracleConfig,type SocietyDailyOracleConfig} from '../src/society/dailyOracle.js';
import {validateSocietyRoutineConfig,type SocietyRoutineConfig} from '../src/society/routine.js';

interface PostcardConfig {rate:{numerator:number;denominator:number};startAtMs:number;dayDurationMs:86400000}
interface PreparedBundle {plan:SocietyRunPlan & {postcards?:PostcardConfig};genesis:{config:{diarySubjectOptional?:true}};postcardConfig?:PostcardConfig;dailyOracleConfig?:SocietyDailyOracleConfig;routineConfig?:SocietyRoutineConfig;planSha256:string}
export interface PlaytestReview {
  schema:'node-society-playtest-review-v1';
  priorJournalSource:string;
  postcards:PostcardConfig;
  dailyOracle?:SocietyDailyOracleConfig;
  diarySubjectOptional?:true;
  routine?:SocietyRoutineConfig;
  launch:Omit<SocietyLaunchConfig,'approved'> & {approved:false};
}
export interface PreparePlaytestOptions {
  priorJournal:string;credentialFile:string;outputRoot:string;postcardRate:string;
  postcardStartMs?:number;ticks?:number;seed?:number;
  oracleConfig?:string;
  optionalDiarySubject?:boolean;
  dailyTurns?:number;
  inhabitantInformation?:boolean;
  dualNavigation?:boolean;godot?:string;
}
export interface PlaytestEnvironment {
  repositoryRoot:string;
  /** Unit tests only. The production CLI supplies no verifier or bundle-builder seam. */
  sourceRevision?:string;
  verifySource?:(root:string,expectedRevision:string)=>void;
  prepareBundle?:(output:string,options:{ticks:number;seed:number;postcards:PostcardConfig;dailyOracle?:SocietyDailyOracleConfig;optionalDiarySubject?:true;routine?:SocietyRoutineConfig})=>void;
}
const fail=(code:string):never=>{throw Error(code);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&!Object.is(v,-0);
function exact(v:unknown,keys:string[]):asserts v is Record<string,unknown>{
  if(!object(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>{
    const d=Object.getOwnPropertyDescriptor(v,k);return !d||!d.enumerable||!Object.hasOwn(d,'value');
  }))fail('society_playtest_review_shape');
}
function privatePath(path:string,root:string):string {
  if(typeof path!=='string'||!path)fail('society_playtest_private_path');
  const target=resolve(path);let ancestor=target;
  while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)fail('society_playtest_private_path');ancestor=parent;}
  const actual=resolve(realpathSync(ancestor),relative(ancestor,target)),rel=relative(realpathSync(root),actual);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))fail('society_playtest_private_path');
  return target;
}
function file(path:string,max:number):Buffer {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>max)fail('society_playtest_file');
  return readFileSync(path);
}
function credentialMetadata(path:string):void {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>65536)fail('society_playtest_credential_metadata');
}
function postcardConfig(rate:string,startAtMs:number):PostcardConfig {
  const match=/^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(rate);
  if(!match)return fail('society_playtest_rate');
  const numerator=Number(match[1]),denominator=Number(match[2]);
  let a=numerator,b=denominator;while(b){const remainder=a%b;a=b;b=remainder;}
  if(!integer(numerator)||numerator<1||!integer(denominator)||denominator<1||a!==1||!integer(startAtMs)||startAtMs>Number.MAX_SAFE_INTEGER-20*86400000)
    fail('society_playtest_rate_or_clock');
  return {rate:{numerator,denominator},startAtMs,dayDurationMs:86400000};
}
function readPrior(path:string):{bytes:Buffer;historyHash:string} {
  if(existsSync(join(dirname(path),'.accounting.lock'))||existsSync(join(dirname(path),'.accounting.next')))fail('society_playtest_prior_busy');
  const bytes=file(path,8*1024*1024),view=inspectSocietyFunding(bytes);
  if(view.held!==0n||view.overrun||!view.authorization||!view.closure&&view.requests.length<view.authorization.maxRequests||view.requests.some(q=>q.bookedMicroUsd===null))
    fail('society_playtest_prior_not_closed');
  return {bytes,historyHash:view.historyHash};
}
function readBundle(path:string):PreparedBundle {
  const bundle=parseSocietyEvidence<PreparedBundle>(file(path,128*1024*1024).toString('utf8'));
  validateSocietyPlan(bundle.plan);
  if(societyPlanHash(bundle.plan)!==bundle.planSha256)fail('society_playtest_bundle_hash');
  return bundle;
}
function validateReview(value:unknown):asserts value is PlaytestReview {
  const hasDailyOracle=object(value)&&Object.hasOwn(value,'dailyOracle');
  const hasOptionalSubject=object(value)&&Object.hasOwn(value,'diarySubjectOptional');
  const hasRoutine=object(value)&&Object.hasOwn(value,'routine');
  exact(value,['schema','priorJournalSource','postcards','launch',...(hasDailyOracle?['dailyOracle']:[]),...(hasOptionalSubject?['diarySubjectOptional']:[]),...(hasRoutine?['routine']:[])]);
  if(hasRoutine){validateSocietyRoutineConfig(value.routine);if(!hasOptionalSubject)fail('society_playtest_routine_diary');}
  if(hasOptionalSubject&&value.diarySubjectOptional!==true)fail('society_playtest_diary_contract');
  if(value.schema!=='node-society-playtest-review-v1'||typeof value.priorJournalSource!=='string'||!isAbsolute(value.priorJournalSource))fail('society_playtest_review');
  exact(value.launch,['schema','sourceRevision','bundle','planSha256','priorDirectory','priorJournalSha256','priorHistoryHash','credentialSource','outputRoot','instruction','approved','runId']);
  if(value.launch.approved!==false)fail('society_playtest_review_not_approval');
  validateSocietyLaunchConfig({...value.launch,approved:true});
  exact(value.postcards,['rate','startAtMs','dayDurationMs']);exact(value.postcards.rate,['numerator','denominator']);
  const p=value.postcards,r=p.rate as Record<string,unknown>;
  if(!isDeepStrictEqual(p,postcardConfig(`${r.numerator}/${r.denominator}`,p.startAtMs as number)))fail('society_playtest_clock');
  if(hasDailyOracle)validateSocietyDailyOracleConfig(value.dailyOracle);
}
function checkReview(path:string,environment:PlaytestEnvironment) {
  const root=resolve(environment.repositoryRoot),reviewPath=privatePath(path,root);
  const value:unknown=JSON.parse(file(reviewPath,65536).toString('utf8'));validateReview(value);
  const review=value;
  for(const p of [review.priorJournalSource,review.launch.bundle,review.launch.priorDirectory,review.launch.credentialSource,review.launch.outputRoot])privatePath(p,root);
  const prior=readPrior(review.priorJournalSource);
  if(sha256(prior.bytes)!==review.launch.priorJournalSha256||prior.historyHash!==review.launch.priorHistoryHash)fail('society_playtest_prior_changed');
  const checked=checkSocietyLaunch({...review.launch,approved:true},{repositoryRoot:root,verifySource:environment.verifySource});
  const bundle=readBundle(review.launch.bundle);
  if(!isDeepStrictEqual(bundle.postcardConfig,review.postcards)||!isDeepStrictEqual(bundle.plan.postcards,review.postcards))fail('society_playtest_feature_binding');
  if(!isDeepStrictEqual(bundle.dailyOracleConfig,review.dailyOracle)||!isDeepStrictEqual(bundle.plan.dailyOracle,review.dailyOracle))fail('society_playtest_daily_oracle_binding');
  if(bundle.genesis.config.diarySubjectOptional!==review.diarySubjectOptional)fail('society_playtest_diary_binding');
  if(!isDeepStrictEqual(bundle.routineConfig,review.routine)||!isDeepStrictEqual(bundle.plan.routine,review.routine))fail('society_playtest_routine_binding');
  return {review,checked};
}
export function checkSocietyPlaytest(reviewPath:string,environment:PlaytestEnvironment) {
  const {review,checked}=checkReview(reviewPath,environment);
  return {...checked,review:resolve(reviewPath),approved:false,postcards:review.postcards,...(review.dailyOracle?{dailyOracle:structuredClone(review.dailyOracle)}:{}),
    ...(review.diarySubjectOptional?{diarySubjectOptional:true}:{}),
    ...(review.routine?{routine:structuredClone(review.routine)}:{}),
    instruction:review.launch.instruction,outputRoot:review.launch.outputRoot};
}
/** A review contains approved:false. No authorization, key copy, allowance or inference is created. */
export function prepareSocietyPlaytest(options:PreparePlaytestOptions,environment:PlaytestEnvironment) {
  const root=resolve(environment.repositoryRoot),ticks=options.ticks??3,seed=options.seed??42;
  if(!Number.isSafeInteger(ticks)||ticks<1||ticks>20||!Number.isSafeInteger(seed))fail('society_playtest_bounds');
  if(options.optionalDiarySubject!==undefined&&typeof options.optionalDiarySubject!=='boolean')fail('society_playtest_diary_contract');
  if(options.inhabitantInformation!==undefined&&typeof options.inhabitantInformation!=='boolean'||options.inhabitantInformation&&options.dailyTurns===undefined)fail('society_playtest_information_contract');
  if(options.dualNavigation!==undefined&&typeof options.dualNavigation!=='boolean'||options.dualNavigation&&options.dailyTurns===undefined)fail('society_playtest_navigation_contract');
  const routine:SocietyRoutineConfig|undefined=options.dailyTurns===undefined?undefined:{maxTurnsPerDay:options.dailyTurns,...(options.inhabitantInformation||options.dualNavigation?{information:'inhabitant-v1' as const}:{}),...(options.dualNavigation?{navigation:'dual-v1' as const}:{})};
  if(routine)validateSocietyRoutineConfig(routine);
  const optionalDiarySubject=!!routine||options.optionalDiarySubject===true;
  const postcards=postcardConfig(options.postcardRate,options.postcardStartMs??0);
  let dailyOracle:SocietyDailyOracleConfig|undefined;
  if(options.oracleConfig!==undefined){
    const value:unknown=JSON.parse(file(resolve(options.oracleConfig),65536).toString('utf8'));
    validateSocietyDailyOracleConfig(value);dailyOracle=structuredClone(value);
  }
  const output=privatePath(options.outputRoot,root),priorSource=privatePath(options.priorJournal,root),credential=privatePath(options.credentialFile,root);
  if(existsSync(output)||!lstatSync(dirname(output)).isDirectory())fail('society_playtest_output_exists_or_parent_missing');
  credentialMetadata(credential);
  const prior=readPrior(priorSource),sourceRevision=environment.sourceRevision??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  (environment.verifySource??verifySocietyLaunchSource)(root,sourceRevision);
  const bundlePath=join(output,'plan.json'),priorDirectory=join(output,'prior'),reviewPath=join(output,'review.json');
  // Created once. Failures leave review artifacts for diagnosis and never retry automatically.
  mkdirSync(output,{mode:0o700});mkdirSync(priorDirectory,{mode:0o700});
  writeFileSync(join(priorDirectory,'accounting.journal.json'),prior.bytes,{flag:'wx',mode:0o600});
  if(environment.prepareBundle)environment.prepareBundle(bundlePath,{ticks,seed,postcards,...(dailyOracle?{dailyOracle}:{} ),...(optionalDiarySubject?{optionalDiarySubject:true}:{}),...(routine?{routine}:{})});
  else execFileSync(process.execPath,['--import','tsx',join(root,'scripts','run-society-live.ts'),'--prepare','--bundle',bundlePath,
    '--ticks',String(ticks),'--seed',String(seed),'--postcard-rate',options.postcardRate,'--postcard-start-ms',String(postcards.startAtMs),
    ...(options.oracleConfig!==undefined?['--oracle-config',resolve(options.oracleConfig)]:[]),...(optionalDiarySubject?['--optional-diary-subject']:[]),...(routine?['--daily-turns',String(routine.maxTurnsPerDay)]:[]),...(routine?.information?['--inhabitant-information']:[]),...(routine?.navigation?['--dual-navigation']:[]),...(options.godot?['--godot',options.godot]:[])],
    {cwd:root,windowsHide:true,stdio:'pipe',maxBuffer:4*1024*1024});
  const bundle=readBundle(bundlePath);
  if(bundle.plan.sourceRevision!==sourceRevision||bundle.plan.ticks!==ticks||!isDeepStrictEqual(bundle.postcardConfig,postcards)||!isDeepStrictEqual(bundle.plan.postcards,postcards))
    fail('society_playtest_prepared_bundle');
  if(!isDeepStrictEqual(bundle.dailyOracleConfig,dailyOracle)||!isDeepStrictEqual(bundle.plan.dailyOracle,dailyOracle))fail('society_playtest_prepared_daily_oracle');
  if(bundle.genesis.config.diarySubjectOptional!==(optionalDiarySubject?true:undefined))fail('society_playtest_prepared_diary_contract');
  if(!isDeepStrictEqual(bundle.routineConfig,routine)||!isDeepStrictEqual(bundle.plan.routine,routine))fail('society_playtest_prepared_routine');
  const instruction=`I approve this fresh postcard-enabled society playtest on source ${sourceRevision}: ${ticks} days, at most ${bundle.plan.maxCalls} model calls, at most USD ${(bundle.plan.allowance.limitMicroUsd/1_000_000).toFixed(6)}, carrying the pinned prior accounting unchanged.${routine?` Each day allows at most ${routine.maxTurnsPerDay} sequential action turns. The existing per-request ceiling remains USD ${(bundle.plan.allowance.perRequestMicroUsd/1_000_000).toFixed(6)}. A turn, call or spending limit stops and preserves an unfinished day; it never completes duties for an inhabitant. When the run ends with no held or unbooked usage and no overrun, append a terminal closure revoking unused allowance capacity so the next reviewed test can carry its exact history.`:''}${dailyOracle?` This includes the reviewed free daily Oracle catalogue and a declared one-off trial treasury of ${dailyOracle.treasuryMicro/1_000_000} game-wealth, separate from USD model spending.`:''} Stop on any boundary, accounting or transport failure; do not retry.`;
  const review:PlaytestReview={schema:'node-society-playtest-review-v1',priorJournalSource:priorSource,postcards,
    ...(optionalDiarySubject?{diarySubjectOptional:true}:{}),...(routine?{routine:structuredClone(routine)}:{}),
    ...(dailyOracle?{dailyOracle}:{}),
    launch:{schema:'node-society-launch-v1',sourceRevision,bundle:bundlePath,planSha256:bundle.planSha256,priorDirectory,
      priorJournalSha256:sha256(prior.bytes),priorHistoryHash:prior.historyHash,credentialSource:credential,
      outputRoot:join(output,'execution'),instruction,approved:false,runId:'society-playtest-'+randomBytes(12).toString('hex')}};
  writeFileSync(reviewPath,JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});
  return checkSocietyPlaytest(reviewPath,environment);
}
/** Called only after the human supplies --approve. Existing launcher owns all actual spending. */
export function approveSocietyPlaytest(reviewPath:string,explicitApproval:boolean,environment:PlaytestEnvironment) {
  if(explicitApproval!==true)fail('society_playtest_explicit_approval_required');
  const {review,checked}=checkReview(reviewPath,environment),launchPath=join(dirname(resolve(reviewPath)),'launch.json');
  writeFileSync(launchPath,JSON.stringify({...review.launch,approved:true},null,2)+'\n',{flag:'wx',mode:0o600});
  return {launch:launchPath,sourceRevision:checked.sourceRevision,planSha256:checked.planSha256,...(review.dailyOracle?{dailyOracle:structuredClone(review.dailyOracle)}:{}),
    ...(review.routine?{routine:structuredClone(review.routine)}:{}),
    ticks:checked.ticks,maxCalls:checked.maxCalls,limitMicroUsd:checked.limitMicroUsd,providerCalls:0,allowanceCreated:false};
}
function main(){
  const {values}=parseArgs({options:{prepare:{type:'boolean'},check:{type:'boolean'},approve:{type:'boolean'},review:{type:'string'},
    'prior-journal':{type:'string'},credential:{type:'string'},output:{type:'string'},ticks:{type:'string',default:'3'},seed:{type:'string',default:'42'},
    'postcard-rate':{type:'string'},'postcard-start-ms':{type:'string'},'oracle-config':{type:'string'},'optional-diary-subject':{type:'boolean'},'daily-turns':{type:'string'},'inhabitant-information':{type:'boolean'},'dual-navigation':{type:'boolean'},godot:{type:'string'}}});
  if([values.prepare,values.check,values.approve].filter(Boolean).length!==1)fail('society_playtest_explicit_mode');
  const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),environment={repositoryRoot};
  let result:unknown;
  if(values.prepare){
    if(!values['prior-journal']||!values.credential||!values.output||!values['postcard-rate']||values.review)return fail('society_playtest_prepare_inputs');
    result=prepareSocietyPlaytest({priorJournal:values['prior-journal'],credentialFile:values.credential,outputRoot:values.output,
      postcardRate:values['postcard-rate'],postcardStartMs:Number(values['postcard-start-ms']??0),ticks:Number(values.ticks),seed:Number(values.seed),
      ...(values['oracle-config']!==undefined?{oracleConfig:values['oracle-config']}:{}),...(values['optional-diary-subject']?{optionalDiarySubject:true}:{}),...(values['daily-turns']===undefined?{}:{dailyTurns:Number(values['daily-turns'])}),...(values['inhabitant-information']?{inhabitantInformation:true}:{}),...(values['dual-navigation']?{dualNavigation:true}:{}),...(values.godot?{godot:values.godot}:{})},environment);
  }else{
    if(!values.review||[values['prior-journal'],values.credential,values.output,values['postcard-rate'],values['postcard-start-ms'],values['oracle-config'],values['optional-diary-subject'],values['daily-turns'],values['inhabitant-information'],values['dual-navigation']].some(v=>v!==undefined))return fail('society_playtest_review_inputs');
    result=values.approve?approveSocietyPlaytest(values.review,true,environment):checkSocietyPlaytest(values.review,environment);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{main();}catch(error){const code=error instanceof Error&&/^[A-Za-z0-9_:.-]{1,128}$/.test(error.message)?error.message:'society_playtest_preparation_failed';
    process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;}
}
