import {afterEach,describe,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import * as rngModule from '../src/sim/rng.js';
import {oracleWinProbability} from '../src/engine/oracle.js';
import {applyOracleDailyAction,assertOracleDailyConfig,assertOracleDailyDay,closeOracleDailyDay,
  createOracleDailyDay,oracleDailyRules,sealOracleDailyDay,
  type OracleDailyConfig,type OracleDailyDay,type OracleDailyOrigin} from '../src/engine/oracleDaily.js';

// Explicit mathematical fixture only; these payouts/weights are never a production default.
const config:OracleDailyConfig={format:'node-oracle-daily-config-v1',revision:'TEST-ONLY-three-prizes',rewards:[
  {id:'common',amountMicro:1,logWeightAtFloor:0,logWeightAtReference:0},
  {id:'uncommon',amountMicro:3,logWeightAtFloor:-2,logWeightAtReference:-1},
  {id:'exceptional',amountMicro:9,logWeightAtFloor:-6,logWeightAtReference:-3},
]};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function origin(overrides:Partial<OracleDailyOrigin>={}):OracleDailyOrigin{
  return {day:1,health:0.96,personIds:['newcomer','veteran','roleless'],seed:0,treasuryMicro:100,config,...overrides};
}
const enter=(personId='newcomer',id='entry-1')=>({kind:'enter' as const,id,personId});
const decline=(personId='newcomer',id='decline-1')=>({kind:'decline' as const,id,personId});
function checkLedger(state:OracleDailyDay){
  expect(BigInt(state.availableMicro)+BigInt(state.reservedMicro)+BigInt(state.paidMicro)).toBe(BigInt(state.origin.treasuryMicro));
  expect(state.availableMicro).toBeGreaterThanOrEqual(0);expect(state.reservedMicro).toBeGreaterThanOrEqual(0);
  expect(state.paidMicro).toBe(state.receipts.reduce((sum,r)=>sum+r.effect.payoutMicro,0));
  expect(state.reservedMicro).toBe(state.closed?0:(state.origin.personIds.length-state.receipts.length)*9);
}
afterEach(()=>vi.restoreAllMocks());

describe('explicit daily Oracle probability contract',()=>{
  it('has no active default reward calibration and does not invent an entry fee',()=>{
    const rules=oracleDailyRules(null,0.77);
    expect(rules).toEqual({enabled:false,costMicro:0,winProbability:oracleWinProbability(0.77),qualityVersion:'log-weight-health-square-v1',rewards:[]});
    const day=createOracleDailyDay(origin({config:null,treasuryMicro:0}));
    expect(day).toMatchObject({availableMicro:0,reservedMicro:0,paidMicro:0,drawCount:0,receipts:[]});
    expect(()=>applyOracleDailyAction(day,enter())).toThrow('oracle_daily_unconfigured');
    expect(closeOracleDailyDay(day)).toMatchObject({closed:true,reservedMicro:0});
  });
  it.each([0,0.4,0.6,0.77,0.9,0.96,1])('preserves canonical health-linked win odds at health %s',health=>{
    expect(oracleDailyRules(config,health).winProbability).toBe(oracleWinProbability(health));
    expect(oracleDailyRules(config,health).costMicro).toBe(0);
  });
  it('normalizes the configured exponential rarity and applies the specified nonlinear health transform',()=>{
    const rules=oracleDailyRules(config,0.68),weights=[1,Math.exp(-1.75),Math.exp(-5.25)],sum=weights.reduce((a,b)=>a+b,0);
    expect(rules.rewards.map(r=>r.id)).toEqual(['common','uncommon','exceptional']);
    expect(rules.rewards.map(r=>r.amountMicro)).toEqual([1,3,9]);
    rules.rewards.forEach((r,i)=>expect(r.probability).toBeCloseTo(weights[i]!/sum,14));
    expect(Object.isFrozen(rules)).toBe(true);expect(Object.isFrozen(rules.rewards[0])).toBe(true);
    const floor=oracleDailyRules(config,0).rewards,reference=oracleDailyRules(config,1).rewards;
    expect(floor).toEqual(oracleDailyRules(config,0.4).rewards);
    expect(reference).toEqual(oracleDailyRules(config,0.96).rewards);
    expect(rules.rewards[2]!.probability).not.toBeCloseTo((floor[2]!.probability+reference[2]!.probability)/2,5);
  });
  it('has normalized positive mass, common dominance and no worse quality over an independent health sweep',()=>{
    let previous=[0,0];
    for(let i=0;i<=1000;i++){
      const entries=oracleDailyRules(config,i/1000).rewards,p=entries.map(r=>r.probability);
      expect(p.every(x=>Number.isFinite(x)&&x>0)).toBe(true);expect(p.reduce((a,b)=>a+b,0)).toBeCloseTo(1,14);
      expect(p[0]).toBeGreaterThan(p[1]!);expect(p[1]).toBeGreaterThan(p[2]!);
      const tails=[p[1]!+p[2]!,p[2]!];tails.forEach((x,j)=>expect(x+1e-15).toBeGreaterThanOrEqual(previous[j]!));previous=tails;
    }
  });
  it('treats a common log-weight offset as equivalent without overflowing exponential weights',()=>{
    const shifted={...config,rewards:config.rewards.map(r=>({...r,logWeightAtFloor:r.logWeightAtFloor+1000,logWeightAtReference:r.logWeightAtReference+1000}))};
    oracleDailyRules(config,0.77).rewards.forEach((r,i)=>expect(oracleDailyRules(shifted,0.77).rewards[i]!.probability).toBeCloseTo(r.probability,13));
  });
  it.each([NaN,Infinity,-Infinity,-0,-0.1,1.1])('refuses invalid health %s',health=>{
    expect(()=>oracleDailyRules(config,health)).toThrow('oracle_daily_health');
    expect(()=>createOracleDailyDay(origin({health}))).toThrow('oracle_daily_health');
  });
  it('rejects unsupported, flat or reversed reward contracts instead of making up fallback weights',()=>{
    const changes:((q:any)=>void)[]=[q=>q.rewards=[],q=>q.rewards=[q.rewards[0]],q=>q.extra=true,
      q=>q.format='other',q=>q.revision='',q=>q.rewards[1].id='common',q=>q.rewards[1].amountMicro=0,
      q=>q.rewards[1].amountMicro=1,q=>q.rewards[1].amountMicro=1.5,q=>q.rewards[1].logWeightAtFloor=0,
      q=>q.rewards[1].logWeightAtReference=1,q=>q.rewards[1].logWeightAtReference=-4,
      q=>q.rewards[2].logWeightAtFloor=-1000,q=>q.rewards[2].logWeightAtReference=NaN,
      q=>q.rewards[2].role='Baker',q=>q.rewards[2].grantRole='Miller'];
    for(const change of changes){const q:any=clone(config);change(q);expect(()=>assertOracleDailyConfig(q)).toThrow();}
    const decreasingSlope=clone(config);(decreasingSlope.rewards[2] as any).logWeightAtReference=-6;
    expect(()=>assertOracleDailyConfig(decreasingSlope)).toThrow('oracle_daily_reward_order');
    expect(()=>assertOracleDailyConfig({...config,rewards:[config.rewards[0]]})).toThrow('oracle_daily_config');
    expect(()=>assertOracleDailyConfig({...config,rewards:config.rewards.slice(0,2)})).not.toThrow();
  });
});

describe('fully reserved universal daily entry',()=>{
  it('reserves every resident’s maximum prize from real treasury before any draw, with zero personal wealth input',()=>{
    const day=createOracleDailyDay(origin());
    expect(day).toMatchObject({availableMicro:73,reservedMicro:27,paidMicro:0,drawCount:0,closed:false,receipts:[]});
    const exact=createOracleDailyDay(origin({treasuryMicro:27}));expect(exact.availableMicro).toBe(0);
    const draw=vi.spyOn(rngModule,'mulberry32');
    expect(()=>createOracleDailyDay(origin({treasuryMicro:26}))).toThrow('oracle_daily_unfunded');expect(draw).not.toHaveBeenCalled();
    expect(day.origin).toEqual(origin());checkLedger(day);
  });
  it('settles a real win from the reserved pool without charging any participant',()=>{
    const day=createOracleDailyDay(origin()),result=applyOracleDailyAction(day,enter());
    expect(result).toMatchObject({duplicate:false,effect:{kind:'enter',won:true,prizeId:'common',payoutMicro:1,wealthDeltaMicro:1,
      treasuryDeltaMicro:-1,availableDeltaMicro:8,reservedDeltaMicro:-9,draw:{index:0,count:2,winRoll:0.26642920868471265,prizeRoll:0.0003297457005828619}},
      state:{availableMicro:81,reservedMicro:18,paidMicro:1,drawCount:2}});
    expect(day.receipts).toHaveLength(0);checkLedger(result.state);
  });
  it.each([[0,'common',1],[9,'uncommon',3],[79,'exceptional',9]]as const)
    ('settles the configured prize at seeded fixture %s with no hidden issuance', (seed,prizeId,payoutMicro)=>{
      const result=applyOracleDailyAction(createOracleDailyDay(origin({seed,treasuryMicro:27})),enter());
      expect(result.effect).toMatchObject({won:true,prizeId,payoutMicro,wealthDeltaMicro:payoutMicro,treasuryDeltaMicro:-payoutMicro});
      expect(result.state.availableMicro+result.state.reservedMicro).toBe(27-payoutMicro);checkLedger(result.state);
    });
  it('permits several independent winners, zero winners and repeat winners on subsequent days',()=>{
    let multiple=createOracleDailyDay(origin());
    for(const person of multiple.origin.personIds)multiple=applyOracleDailyAction(multiple,enter(person,'entry-'+person)).state;
    expect(multiple.receipts.map(r=>r.effect.won)).toEqual([true,true,false]);expect(multiple.drawCount).toBe(5);checkLedger(multiple);
    let none=createOracleDailyDay(origin({health:0.4,seed:2}));
    for(const person of none.origin.personIds)none=applyOracleDailyAction(none,enter(person,'entry-'+person)).state;
    expect(none.receipts.every(r=>!r.effect.won)).toBe(true);expect(none.paidMicro).toBe(0);expect(none.drawCount).toBe(3);checkLedger(none);
    const day1=applyOracleDailyAction(createOracleDailyDay(origin({personIds:['same-person']})),enter('same-person'));
    const day2=applyOracleDailyAction(createOracleDailyDay(origin({day:2,personIds:['same-person'],seed:7})),enter('same-person'));
    expect(day1.effect.won&&day2.effect.won).toBe(true);
  });
  it('uses identical published odds and catalogue regardless of identity or position in the population',()=>{
    const first=applyOracleDailyAction(createOracleDailyDay(origin({personIds:['newcomer']})),enter('newcomer'));
    const veteran=applyOracleDailyAction(createOracleDailyDay(origin({personIds:['veteran']})),enter('veteran'));
    expect({...first.effect,personId:null}).toEqual({...veteran.effect,personId:null});
    expect(first.state.paidMicro).toBe(veteran.state.paidMicro);
    expect(()=>createOracleDailyDay({...origin(),role:'Baker',wealth:999}as any)).toThrow('oracle_daily_origin');
  });
  it('declines without a random draw, charge, prize or forced winner and releases only that person’s reserve',()=>{
    const day=createOracleDailyDay(origin()),draw=vi.spyOn(rngModule,'mulberry32'),result=applyOracleDailyAction(day,decline());
    expect(result.effect).toMatchObject({won:false,prizeId:null,payoutMicro:0,wealthDeltaMicro:0,treasuryDeltaMicro:0,
      reservedDeltaMicro:-9,availableDeltaMicro:9,draw:null});expect(draw).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({availableMicro:82,reservedMicro:18,paidMicro:0,drawCount:0});checkLedger(result.state);
    expect(()=>applyOracleDailyAction(result.state,enter('newcomer','new-id'))).toThrow('oracle_daily_already_decided');
  });
  it('closes untouched or partly claimed days and returns all remaining reserves without draw or expiry charge',()=>{
    const untouched=createOracleDailyDay(origin()),closed=closeOracleDailyDay(untouched);
    expect(closed).toMatchObject({availableMicro:100,reservedMicro:0,paidMicro:0,drawCount:0,closed:true});checkLedger(closed);
    const win=applyOracleDailyAction(untouched,enter()).state,partly=closeOracleDailyDay(win);
    expect(partly).toMatchObject({availableMicro:99,reservedMicro:0,paidMicro:1,drawCount:2,closed:true});checkLedger(partly);
    expect(closeOracleDailyDay(partly)).toBe(partly);expect(()=>applyOracleDailyAction(partly,enter('veteran','new'))).toThrow('oracle_daily_closed');
  });
  it('records exact integer money conservation over 2,000 seeded decisions and all unused-reserve settlements',()=>{
    const people=Array.from({length:10},(_,i)=>'person-'+i);
    for(let seed=0;seed<200;seed++){
      let day=createOracleDailyDay(origin({personIds:people,seed,health:seed/200,treasuryMicro:1000}));
      for(const [i,person]of people.entries()){
        const result=applyOracleDailyAction(day,i%4===0?decline(person,'action-'+i):enter(person,'action-'+i));
        expect(result.effect.wealthDeltaMicro+result.effect.treasuryDeltaMicro).toBe(0);day=result.state;checkLedger(day);
      }
      checkLedger(closeOracleDailyDay(day));
    }
  });
});

describe('daily Oracle idempotency, replay and strict boundary',()=>{
  it('retries a prior ID after later activity, closing and JSON recovery without consuming more wealth or draws',()=>{
    const original=enter(),first=applyOracleDailyAction(createOracleDailyDay(origin()),original);
    let current=applyOracleDailyAction(first.state,decline('veteran','second')).state;current=sealOracleDailyDay(clone(closeOracleDailyDay(current)));
    const before=JSON.stringify(current),draw=vi.spyOn(rngModule,'mulberry32');
    const duplicate=applyOracleDailyAction(current,clone(original));
    expect(duplicate.duplicate).toBe(true);expect(duplicate.state).toBe(current);expect(duplicate.effect).toEqual(first.effect);
    expect(JSON.stringify(current)).toBe(before);expect(draw).not.toHaveBeenCalled();
    expect(()=>applyOracleDailyAction(current,{...original,kind:'decline'})).toThrow('oracle_daily_transaction_conflict');
    expect(()=>applyOracleDailyAction(current,{...original,personId:'veteran'})).toThrow('oracle_daily_transaction_conflict');
  });
  it('resumes the exact PRNG cursor and returns the same final state after an independent JSON round trip',()=>{
    const start=createOracleDailyDay(origin()),first=applyOracleDailyAction(start,enter()).state;
    const restored=sealOracleDailyDay(clone(first));
    const continued=applyOracleDailyAction(restored,enter('veteran','second')).state;
    const uninterrupted=applyOracleDailyAction(first,enter('veteran','second')).state;
    expect(continued).toEqual(uninterrupted);expect(continued.drawCount).toBe(4);
    expect(sealOracleDailyDay(clone(continued))).toEqual(continued);
  });
  it('reopens the complete funded state and resumes a decision in a fresh Node process',()=>{
    const first=applyOracleDailyAction(createOracleDailyDay(origin()),enter()).state,action=enter('veteran','second');
    const script=["import {readFileSync} from 'node:fs';",
      "import {sealOracleDailyDay,applyOracleDailyAction,closeOracleDailyDay} from './src/engine/oracleDaily.ts';",
      "const {state,action}=JSON.parse(readFileSync(0,'utf8'));",
      'const result=applyOracleDailyAction(sealOracleDailyDay(state),action);',
      'process.stdout.write(JSON.stringify(closeOracleDailyDay(result.state)));'].join('\n');
    const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type','module','--eval',script],
      {input:JSON.stringify({state:first,action}),encoding:'utf8',windowsHide:true}));
    expect(result).toEqual(closeOracleDailyDay(applyOracleDailyAction(first,action).state));
    expect(sealOracleDailyDay(result)).toEqual(result);
  });
  it('rejects changed balances, seed-dependent receipts, coordinated ledger forgeries and duplicate personal entries',()=>{
    const day=applyOracleDailyAction(createOracleDailyDay(origin()),enter()).state;
    const changes:((q:any)=>void)[]=[q=>q.availableMicro++,q=>q.reservedMicro--,q=>q.paidMicro++,q=>q.drawCount++,
      q=>q.origin.seed=1,q=>q.receipts[0].effect.payoutMicro++,q=>q.receipts[0].effect.prizeId='exceptional',
      q=>q.receipts[0].effect.draw.winRoll=0.01,q=>q.receipts.push(clone(q.receipts[0])),
      q=>{q.availableMicro--;q.paidMicro++;q.receipts[0].effect.payoutMicro++;q.receipts[0].effect.wealthDeltaMicro++;q.receipts[0].effect.treasuryDeltaMicro--;},
      q=>q.extra='host'];
    for(const change of changes){const changed:any=clone(day);change(changed);expect(()=>assertOracleDailyDay(changed)).toThrow();}
    expect(()=>assertOracleDailyDay({...day,receipts:[{...day.receipts[0],action:{...day.receipts[0]!.action,id:'x'}},day.receipts[0]]})).toThrow('oracle_daily_already_decided');
  });
  it('keeps receipts and configured origin detached and deeply immutable',()=>{
    const mutable=clone(origin()),action=enter(),day=createOracleDailyDay(mutable),result=applyOracleDailyAction(day,action);
    (mutable.config!.rewards[0] as any).amountMicro=100;(mutable.personIds as string[]).push('injected');action.personId='changed';
    expect(result.state.origin.config).toEqual(config);expect(result.state.origin.personIds).toEqual(origin().personIds);
    expect(result.state.receipts[0]!.action.personId).toBe('newcomer');
    for(const v of [result.state,result.state.origin,result.state.origin.config,result.state.origin.config!.rewards,
      result.state.origin.config!.rewards[0],result.state.receipts,result.state.receipts[0],result.state.receipts[0]!.action,
      result.state.receipts[0]!.effect,result.state.receipts[0]!.effect.draw])expect(Object.isFrozen(v)).toBe(true);
  });
  it('rejects malformed actions, unsupported host operations and second entries atomically before draws',()=>{
    const state=applyOracleDailyAction(createOracleDailyDay(origin()),enter()).state,before=JSON.stringify(state);
    const draw=vi.spyOn(rngModule,'mulberry32');
    for(const bad of [null,[],{}, {...enter('veteran','new'),roll:0},{...enter('veteran','new'),kind:'exec'},
      {...enter('veteran','new'),shell:'whoami'},enter('unknown','new'),enter('newcomer','different'),
      {...enter('veteran','new'),id:''},{...enter('veteran','new'),personId:'../file'},
      {...enter('veteran','new'),prizeId:'exceptional'}])expect(()=>applyOracleDailyAction(state,bad as any)).toThrow();
    expect(draw).not.toHaveBeenCalled();expect(JSON.stringify(state)).toBe(before);
  });
  it('rejects invalid origins, identities and integer accounting without creating partial reserves',()=>{
    const changes:((q:any)=>void)[]=[q=>q.day=-1,q=>q.day=-0,q=>q.day=1.5,q=>q.seed=-1,q=>q.seed=2**32,
      q=>q.seed=NaN,q=>q.treasuryMicro=-1,q=>q.treasuryMicro=1.1,q=>q.personIds=['same','same'],q=>q.personIds=[''],
      q=>q.personIds=['../escape'],q=>q.seed=Number.MAX_SAFE_INTEGER+1,q=>q.admin=true];
    for(const change of changes){const changed:any=clone(origin());change(changed);expect(()=>createOracleDailyDay(changed)).toThrow();}
    expect(()=>createOracleDailyDay(origin({treasuryMicro:Number.MAX_SAFE_INTEGER,config:{...config,rewards:[config.rewards[0]!,
      {...config.rewards[2]!,amountMicro:Number.MAX_SAFE_INTEGER}]}}))).toThrow('oracle_daily_unfunded');
  });
  it('rejects accessor objects, inherited iterators and sparse arrays without executing their code',()=>{
    let called=false;const getter={...origin()};Object.defineProperty(getter,'health',{enumerable:true,get:()=>{called=true;return 1;}});
    expect(()=>createOracleDailyDay(getter)).toThrow();
    const reward=clone(config);Object.defineProperty(reward.rewards[0],'id',{enumerable:true,get:()=>{called=true;return 'x';}});
    expect(()=>oracleDailyRules(reward,1)).toThrow();
    const ids=['newcomer'];Object.setPrototypeOf(ids,{[Symbol.iterator]:()=>{called=true;return [][Symbol.iterator]();}});
    expect(()=>createOracleDailyDay(origin({personIds:ids}))).toThrow();
    const sparse=new Array(3);sparse[0]='newcomer';expect(()=>createOracleDailyDay(origin({personIds:sparse}))).toThrow();
    const state=createOracleDailyDay(origin()),bad=enter();Object.defineProperty(bad,'kind',{enumerable:true,get:()=>{called=true;return 'enter';}});
    expect(()=>applyOracleDailyAction(state,bad)).toThrow();
    expect(called).toBe(false);
  });
});
