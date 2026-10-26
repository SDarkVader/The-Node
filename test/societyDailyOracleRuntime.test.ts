import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Society,societyConfig,verifySocietyTape,type SocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';
import {SocietyDailyOracleBook,type SocietyDailyOracleConfig} from '../src/society/dailyOracle.js';
import {parseSocietyEvidence,stringifySocietyEvidence} from '../src/society/codec.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
const dailyOracle=JSON.parse(readFileSync('experiments/oracle/daily-oracle-trial-2026-10-26.json','utf8')) as SocietyDailyOracleConfig;
const postcards={rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86400000 as const};
const sourceRevision='c'.repeat(40);
function run(days:number,cap?:number,decline=false){
  const society=new Society({seed:42,sourceRevision,dailyOracle,postcards,
    config:{...societyConfig(),...(cap===undefined?{}:{wealthCap:cap})}});
  while(society.tick<days)for(const p of society.pendingPeople()){
    const v=society.view(p).visible,a=autonomousPolicy(v);if(decline)a.dailyOracle=null;society.submit(p,a);
  }
  return society;
}
describe('daily Oracle production society integration',()=>{
  it('offers identical zero-cost chances to every role and validates actual eight-field worker packets',()=>{
    const society=new Society({seed:42,sourceRevision,dailyOracle,postcards});
    for(const p of society.pendingPeople())society.submit(p,autonomousPolicy(society.view(p).visible));
    const views=society.pendingPeople().map(p=>society.view(p).visible);
    expect(new Set(views.map(v=>v.self.role)).size).toBe(6);
    expect(views.every(v=>v.dailyOracle?.canEnter&&v.dailyOracle.entryCost===0)).toBe(true);
    expect(views.some(v=>v.self.wealth===0)).toBe(true);
    expect(new Set(views.map(v=>JSON.stringify(v.dailyOracle))).size).toBe(1);
    for(const view of views){const q=buildSocietyRequest(view);expect(()=>validateSocietyWire(Buffer.from(q.body),q.sha256)).not.toThrow();
      expect(Object.keys(autonomousPolicy(view))).toHaveLength(8);expect(JSON.stringify(view)).not.toContain('treasuryMicro');}
  });
  it('replays real daily payouts, autonomous choices and personal next-day outcomes exactly',()=>{
    const society=run(8),tape=society.exportTape(),again=run(8).exportTape();
    expect(tape).toEqual(again);expect(tape.format).toBe('node-society-daily-oracle-v3');
    expect(verifySocietyTape(parseSocietyEvidence<SocietyTape>(stringifySocietyEvidence(tape)))).toMatchObject({verified:true,ticks:8});
    const days=tape.transitions.map(t=>t.dailyOracle!);expect(days.every(d=>d.payouts.every(p=>p.entered))).toBe(true);
    expect(days.flatMap(d=>d.payouts).some(p=>p.won)).toBe(true);
    const paid=days.flatMap(d=>d.payouts).reduce((n,p)=>n+p.grossMicro,0);
    expect(tape.dailyOracleState!.treasuryMicro+paid).toBe(dailyOracle.treasuryMicro);
    expect(tape.transitions.every(t=>Math.abs(t.accounting.residual)<1e-7)).toBe(true);
    const own=tape.decisions.find(d=>d.day===2&&d.phase==='act')!;
    expect(own.visible.dailyOracle!.lastResult).toMatchObject({day:1,entered:true});
    expect(tape.decisions.some(d=>d.action.oracle&&d.action.dailyOracle==='enter')).toBe(true);
  },20_000);
  it('allows everyone to decline without charging, drawing or depleting the declared treasury',()=>{
    const tape=run(3,undefined,true).exportTape();
    expect(tape.dailyOracleState!.treasuryMicro).toBe(100_000_000);
    expect(tape.transitions.every(t=>t.dailyOracle!.draw.drawCount===0&&t.dailyOracle!.payouts.every(p=>!p.entered&&p.grossMicro===0))).toBe(true);
  });
  it('applies configured Baker/Miller caps and routes their payout overflow into accounted funds',()=>{
    const tape=run(10,0.01).exportTape();
    expect(tape.transitions.flatMap(t=>t.dailyOracle!.payouts).some(p=>p.capOverflowMicro>0)).toBe(true);
    for(const t of tape.transitions){expect(Math.abs(t.accounting.residual)).toBeLessThan(1e-7);
      for(const p of t.dailyOracle!.payouts)expect(p.receivedMicro+p.capOverflowMicro).toBe(p.grossMicro);}
    expect(verifySocietyTape(tape).verified).toBe(true);
  },20_000);
  it('rejects an unfunded whole-roster menu without consuming treasury or creating a draw',()=>{
    const book=new SocietyDailyOracleBook({...dailyOracle,treasuryMicro:0},42),before=book.snapshot();
    expect(()=>book.observation('a',1,0.96,['a','b'])).toThrow('oracle_daily_unfunded');expect(book.snapshot()).toEqual(before);
  });
  it('uses roster order rather than submission-map order for fair deterministic allocation',()=>{
    const first=new SocietyDailyOracleBook(dailyOracle,42),second=new SocietyDailyOracleBook(dailyOracle,42);
    const people=['a','b','c'].map(person=>({person,wealth:0}));
    expect(first.settle(1,0.96,people,new Map([['a','enter'],['b','enter'],['c','enter']]))).
      toEqual(second.settle(1,0.96,people,new Map([['c','enter'],['a','enter'],['b','enter']])));
  });
  it('halts on an invalid daily action with no payout or world transition',()=>{
    const s=new Society({seed:42,sourceRevision,dailyOracle,postcards});
    for(const p of s.pendingPeople())s.submit(p,autonomousPolicy(s.view(p).visible));
    const person=s.pendingPeople()[0]!,hash=s.hash;
    expect(()=>s.submit(person,{...emptySocietyAction(),postcards:null,dailyOracle:{enter:true,hostOperation:'exec'}})).toThrow();
    expect(s.halted).toBe(true);expect(s.tick).toBe(0);expect(s.hash).toBe(hash);expect(s.exportTape().dailyOracleState!.days).toHaveLength(0);
  });
});
