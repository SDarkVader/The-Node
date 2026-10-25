// Separate evaluation step. No execution, provider client or budget writer.
// Args: <private registration.json> <run id> <NEW private output directory>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { ObservatorySource, points, type Registration } from '../src/observatory/source.js';
import { evaluateContinuationDiary } from '../src/observatory/diaryEvaluation.js';
const [configPath,id,output]=process.argv.slice(2);
if(!configPath||!id||!output||process.argv.length!==5)throw Error('explicit_evaluation_arguments_required');
const config=JSON.parse(readFileSync(configPath,'utf8')) as {runs:Registration[]};
const registration=config.runs.find(r=>r.id===id);if(!registration)throw Error('registered_run_required');
const source=new ObservatorySource({...registration,ledger:resolve(dirname(configPath),registration.ledger),journal:undefined});source.refresh();
const events=source.tail.read(),diary=evaluateContinuationDiary(events,id),directory=resolve(output);
mkdirSync(directory,{mode:0o700});
const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
write('diary-results.json',diary.result);write('evaluations.json',diary.records);
write('inspect-input.json',{snapshot:source.snapshot(null,'evaluation-private',true),evidence:points(events).map(p=>({segmentId:p.segmentId,seq:p.event.seq,eventHash:p.event.hash}))});
console.log(JSON.stringify({producer:'NODE A01 classifyDiary',contractHash:diary.result.contract.hash,actors:diary.result.actors.length,
  eligibleDays:diary.result.actors.reduce((n,a)=>n+a.eligibleDays,0),writtenDays:diary.result.actors.reduce((n,a)=>n+a.writtenDays,0),modelCalls:0},null,2));
