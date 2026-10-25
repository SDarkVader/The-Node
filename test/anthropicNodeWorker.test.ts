import { afterEach, expect, it } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, cleanup } from './fixtures/accountingFixture.js';
// Transport module is deliberately plain Node: independently runnable, no tsx or SDK in the key worker.
// @ts-expect-error plain mjs worker has no declaration file
import { runAnthropicWorker } from '../scripts/anthropic-request.mjs';
afterEach(cleanup);
const key='sk-ant-TEST_ONLY_no_real_credential';
function setup(){const directory=root(),keyPath=join(directory,'key.env'),call=join(directory,'call');mkdirSync(call);writeFileSync(keyPath,'ANTHROPIC_API_KEY='+key+'\n',{mode:0o600});writeFileSync(join(call,'request.json'),' {"exact":"request bytes"} ');return{directory:call,keyPath};}
it('sends exact bytes once with fixed endpoint, version, deadline, no redirects; preserves non-2xx body',async()=>{
  const args=setup(),seen: unknown[]=[];
  const fetcher=async(url:string,init:any)=>{seen.push({url,init});expect(init.headers['x-api-key']).toBe(key);expect(init.redirect).toBe('error');expect(init.body.toString()).toBe(' {"exact":"request bytes"} ');return new Response('{"type":"error"}',{status:429,headers:{'request-id':'req_TEST'}});};
  const result=await runAnthropicWorker(args,fetcher);
  expect(seen).toHaveLength(1);expect(result).toMatchObject({httpStatus:429,outcome:'response_archived',requestId:'req_TEST'});
  expect(readFileSync(join(args.directory,'response.json'),'utf8')).toBe('{"type":"error"}');
  expect(readFileSync(join(args.directory,'network.json'),'utf8')).not.toContain(key);
  await expect(runAnthropicWorker(args,fetcher)).rejects.toThrow('artifacts_exist');
});
it('never retries a transport failure and never writes credential-bearing response bytes',async()=>{
  for(const reflect of [false,true]){
    const args=setup();let calls=0;
    const result=await runAnthropicWorker(args,async()=>{calls++;if(!reflect)throw Error(key);return new Response(key);});
    expect(calls).toBe(1);expect(result.outcome).not.toBe('response_archived');expect(existsSync(join(args.directory,'response.json'))).toBe(false);
    expect(readFileSync(join(args.directory,'network.json'),'utf8')).not.toContain(key);
  }
});
it('refuses oversized requests/responses and invalid credential files before further dispatch',async()=>{
  const args=setup();writeFileSync(join(args.directory,'request.json'),'x'.repeat(32769));let calls=0;
  await runAnthropicWorker(args,async()=>{calls++;return new Response('ok');});expect(calls).toBe(0);
  const other=setup();await runAnthropicWorker(other,async()=>new Response('x'.repeat(262145)));expect(existsSync(join(other.directory,'response.json'))).toBe(false);
});
it('requires the explicit counted-input profile for larger bodies and free counts, with fixed URLs',async()=>{
  for(const endpoint of ['messages','count_tokens']){
    const args=setup();writeFileSync(join(args.directory,'request.json'),'x'.repeat(150000));let calls=0;
    const result=await runAnthropicWorker({...args,maxRequestBytes:200000,profile:'counted_100k_input_v1',endpoint},async(url:string)=>{
      calls++;expect(url).toBe(endpoint==='messages'?'https://api.anthropic.com/v1/messages':'https://api.anthropic.com/v1/messages/count_tokens');
      return new Response('{"input_tokens":1200}');
    });expect(calls).toBe(1);expect(result.outcome).toBe('response_archived');
  }
  for(const extra of [{maxRequestBytes:200000},{endpoint:'count_tokens'},{profile:'counted_100k_input_v1',endpoint:'https://invalid.example'}]){
    const args=setup();let calls=0;await runAnthropicWorker({...args,...extra},async()=>{calls++;return new Response('{}');});expect(calls).toBe(0);
  }
});
