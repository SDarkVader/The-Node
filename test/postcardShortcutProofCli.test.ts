import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {afterEach,expect,it} from 'vitest';
import {createPostcardAccountTape} from '../src/engine/postcardAccountReplay.js';

const directories:string[]=[];
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function run(...args:string[]):string {
  return execFileSync(process.execPath,['--import','tsx',resolve('scripts/postcard-shortcut-proof.ts'),...args],
    {encoding:'utf8',stdio:'pipe',windowsHide:true,maxBuffer:4*1024*1024});
}
function fixture(){const root=mkdtempSync(join(tmpdir(),'TEST-ONLY-postcard-shortcut-proof-'));directories.push(root);
  const output=join(root,'proof.json');run('--output',output);return {output,root};}
it('cold-replays actual acquisitions, every same-tier stake, snapshots and atomic failures',()=>{
  const {output}=fixture(),bytes=readFileSync(output),result=JSON.parse(run('--verify',output));
  expect(result.verified).toBe(true);expect(result.providerCalls).toBe(0);expect(result.scenarios).toHaveLength(31);
  const scenarios=result.scenarios as any[],find=(name:string)=>scenarios.find(s=>s.name===name);
  for(const [tier,weight]of [['green',5],['blue',25],['purple',125]]as const){
    for(let stake=1;stake<=4;stake++){
      const success=find(`${tier}-stake-${stake}-success`),loss=find(`${tier}-stake-${stake}-loss`);
      expect(success).toMatchObject({issuedWhite:String((5-stake)*weight),burnedWhite:'0',drawCount:1});
      expect(loss).toMatchObject({issuedWhite:'0',burnedWhite:String(stake*weight),drawCount:1});
      expect(success.held[tier]).toBe(5-stake);expect(loss.held[tier]).toBe(5-stake);
    }
    expect(find(`${tier}-guaranteed-five-no-draw`)).toMatchObject({issuedWhite:'0',burnedWhite:'0',drawCount:0});
  }
  expect(find('v1-safe-orange-upgrade-and-held-year').held.orange).toBe(1);
  expect(find('fractional-claim-and-capped-overflow')).toMatchObject({held:{white:34},overflowUnits:'57600000',checkpointsReopened:2});
  expect(find('seeded-prefix-reopen-and-delayed-duplicate')).toMatchObject({events:7,receipts:6,duplicateRecords:1,drawCount:3,checkpointsReopened:2});
  expect(find('invalid-transactions-are-atomic').atomicFailures).toBe(10);
  expect(scenarios.reduce((n,s)=>n+s.checkpointsReopened,0)).toBe(9);
  expect(readFileSync(output).equals(bytes)).toBe(true);
},20_000);
it('creates byte-identical proofs in separate processes and refuses output reuse',()=>{
  const {output,root}=fixture(),bytes=readFileSync(output),repeat=join(root,'repeat.json');run('--output',repeat);
  expect(readFileSync(repeat).equals(bytes)).toBe(true);expect(()=>run('--output',output)).toThrow();
  expect(readFileSync(output).equals(bytes)).toBe(true);
},20_000);
it('rejects source changes, missing cases, altered checkpoints and self-consistent alternate fixtures',()=>{
  const {output,root}=fixture(),proof=JSON.parse(readFileSync(output,'utf8'));
  for(const [i,change]of [
    (q:any)=>{q.sourceFiles['src/engine/postcardAccount.ts']='0'.repeat(64);},
    (q:any)=>{q.scenarios.pop();},
    (q:any)=>{q.scenarios[0].checkpoints=[];},
    (q:any)=>{q.scenarios.at(-1).failures.pop();},
    (q:any)=>{const s=q.scenarios[1];s.tape=createPostcardAccountTape(s.tape.genesis.origin,123,s.tape.records.map((r:any)=>r.event));},
  ].entries()){
    const changed=structuredClone(proof);change(changed);const path=join(root,`invalid-${i}.json`);
    writeFileSync(path,JSON.stringify(changed));expect(()=>run('--verify',path)).toThrow();
  }
},30_000);
