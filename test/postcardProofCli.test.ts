import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach,expect,it} from 'vitest';

const directories:string[]=[];
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function run(...args:string[]):string {
  return execFileSync(process.execPath,['--import','tsx',resolve('scripts/postcard-proof.ts'),...args],
    {encoding:'utf8',stdio:'pipe',windowsHide:true});
}
function fixture(){const root=mkdtempSync(join(tmpdir(),'TEST-ONLY-postcard-proof-'));directories.push(root);
  const output=join(root,'proof.json');run('--output',output);return {output,root};}
it('reopens actual saved production-event tapes and fractional checkpoints in a fresh process',()=>{
  const {output}=fixture(),before=readFileSync(output),result=JSON.parse(run('--verify',output));
  expect(result.verified).toBe(true);expect(result.providerCalls).toBe(0);expect(result.scenarios).toHaveLength(5);
  expect(result.scenarios.map((s:any)=>s.held.white)).toEqual([24,32,48,2,0]);
  expect(result.scenarios[4].held.orange).toBe(1);
  expect(result.scenarios.map((s:any)=>s.checkpointsReopened)).toEqual([0,0,0,1,2]);
  expect(readFileSync(output)).toEqual(before);
});
it('refuses output reuse and retains the previous proof byte-for-byte',()=>{
  const {output}=fixture(),bytes=readFileSync(output);
  expect(()=>run('--output',output)).toThrow();expect(readFileSync(output)).toEqual(bytes);
});
it('rejects missing scenarios, mismatched source hashes and changed checkpoints',()=>{
  const {output,root}=fixture(),proof=JSON.parse(readFileSync(output,'utf8'));
  for(const [i,change]of [
    (q:any)=>{q.scenarios=[];},
    (q:any)=>{q.sourceFiles['src/engine/postcards.ts']='0'.repeat(64);},
    (q:any)=>{q.scenarios[3].checkpoints[0].snapshot=q.scenarios[4].checkpoints[0].snapshot;},
  ].entries()){
    const changed=structuredClone(proof);change(changed);const path=join(root,`invalid-${i}.json`);
    writeFileSync(path,JSON.stringify(changed));expect(()=>run('--verify',path)).toThrow();
  }
});
