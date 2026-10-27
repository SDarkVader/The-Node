/** Credential-separated, one-shot Messages worker. No tool execution, token-count call,
 * endpoint selection, retry, world access or environment-file loading. */
import { readFileSync, writeFileSync, lstatSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { societyInhabitantInstructions,societyOutputSchema } from '../src/society/request.js';
import { assertSerializedSocietyVisibleContext } from '../src/society/boundary.js';
import {anthropicSchema} from '../src/agent/anthropicRequest.js';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateSocietyWire(bytes:Buffer,expectedSha256:string,options:{historical?:boolean}={}): void {
  if(bytes.length<1||bytes.length>65_536||!/^[a-f0-9]{64}$/.test(expectedSha256)||hash(bytes)!==expectedSha256)throw Error('society_worker_request_binding');
  let q:any;try{q=JSON.parse(bytes.toString('utf8'));}catch{throw Error('society_worker_request_json');}
  if(!q||!exact(q,['model','max_tokens','system','messages','thinking','output_config'])||q.model!=='claude-haiku-5-5'||q.max_tokens!==2048||
    !Array.isArray(q.messages)||q.messages.length!==1||q.messages[0].role!=='user'||
    !exact(q.messages[0],['role','content'])||q.messages[0].content?.length!==1||q.messages[0].content[0].type!=='text'||
    !exact(q.messages[0].content[0],['type','text'])||!q.thinking||!exact(q.thinking,['type','display'])||q.thinking.type!=='adaptive'||q.thinking.display!=='summarized'||
    !q.output_config||!exact(q.output_config,['effort','format'])||q.output_config.effort!=='high'||q.output_config.format?.type!=='json_schema'||
    !exact(q.output_config.format,['type','schema']))throw Error('society_worker_wire');
  const observation=JSON.parse(q.messages[0].content[0].text);
  assertSerializedSocietyVisibleContext(observation);
  if(q.system!==societyInhabitantInstructions(observation))throw Error('society_worker_instructions');
  if(JSON.stringify(q.output_config.format.schema)!==JSON.stringify(societyOutputSchema(observation))&&
    !(options.historical&&[anthropicSchema(observation.decisionSchema),societyOutputSchema(observation,{legacyUnion:true})].some(s=>JSON.stringify(q.output_config.format.schema)===JSON.stringify(s))))throw Error('society_worker_schema');
  // These keys have no inhabitant meaning and were the original leak. Reject at the last
  // egress boundary as well as using a branded view in the parent request builder.
  const forbidden=new Set(['sourceRevision','observerSecret','worldHash','requestId','agentId','developmentUpdate','packageInformation','sources','profile','engine','genesis','credential','tools','tool_calls',
    'seed','drawCount','rngVersion','transactions','origin','issuedWhite','burnedWhite']);
  const walk=(v:unknown):void=>{if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(forbidden.has(k))throw Error('society_worker_metadata');walk(x);}};
  walk(observation);
}
function privateFile(path:string,max:number):Buffer {
  const file=lstatSync(path),parent=lstatSync(dirname(path));
  if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>max||!parent.isDirectory()||parent.isSymbolicLink()||
    realpathSync(path).toLowerCase()!==resolve(path).toLowerCase()||process.platform!=='win32'&&(file.mode&0o077)!==0)throw Error('society_worker_private_file');
  return readFileSync(path);
}
async function main(){
  const [keyArg,dirArg,sha]=process.argv.slice(2);
  if(!keyArg||!dirArg||!sha||process.argv.length!==5)throw Error('society_worker_arguments');
  const directory=resolve(dirArg),request=privateFile(join(directory,'request.json'),65_536);
  validateSocietyWire(request,sha);
  // This worker is spawned only after the parent's explicit approval, persisted request
  // and budget reservation. A malformed request cannot even trigger a credential read.
  const key=privateFile(resolve(keyArg),4096).toString('utf8').trim();
  if(!/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key))throw Error('society_worker_credential_format');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',redirect:'error',
      headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':key},body:request.toString('utf8'),signal:controller.signal});
    const reader=response.body?.getReader();if(!reader)throw Error('society_worker_response_body');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262_144){await reader.cancel();throw Error('society_worker_response_bounds');}chunks.push(part.value);}
    const raw=Buffer.concat(chunks),fd=openSync(join(directory,'response.json'),'wx',0o600);
    try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}
    writeFileSync(join(directory,'status.json'),JSON.stringify({status:response.status,bytes:raw.length})+'\n',{flag:'wx',mode:0o600});
    // Preserve even a non-2xx body for unknown-liability diagnosis; the parent never retries.
  }finally{clearTimeout(timer);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch(()=>{process.stderr.write('society_worker_failed_preserve_evidence\n');process.exitCode=1;});
}
