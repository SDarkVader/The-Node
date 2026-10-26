import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {Society,societyConfig,verifySocietyTape,type SocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';
import {SocietySecurityError,type SocietyAction} from '../src/society/boundary.js';
import {parseSocietyEvidence,stringifySocietyEvidence} from '../src/society/codec.js';
import {assertPostcardAccount,type PostcardAccount} from '../src/engine/postcardAccount.js';
import {digest} from '../src/agent/replay.js';

const sourceRevision='b'.repeat(40),DAY=86_400_000,HOUR=3_600_000;
const postcards={rate:{numerator:2,denominator:1},startAtMs:0,dayDurationMs:86_400_000 as const};
const action=(postcardChoice:SocietyAction['postcards']=null):SocietyAction=>({...emptySocietyAction(),postcards:postcardChoice});
function toAct(society:Society){
  if(society.phase==='commit')for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
  expect(society.phase).toBe('act');
}
function run(days=20,seed=20261025,config=societyConfig()){
  const society=new Society({seed,sourceRevision,config,postcards});
  while(society.tick<days)for(const person of society.pendingPeople())society.submit(person,JSON.stringify(autonomousPolicy(society.view(person).visible)));
  return {society,tape:society.exportTape()};
}
function accounts(tape:SocietyTape){return new Map(tape.postcardAccounts!);}
function mass(state:PostcardAccount){
  assertPostcardAccount(state);
  const value=BigInt(state.held.white)+5n*BigInt(state.held.green)+25n*BigInt(state.held.blue)+125n*BigInt(state.held.purple)+625n*BigInt(state.held.orange);
  const denominator=BigInt(state.rate.denominator)*BigInt(HOUR);
  expect((value+BigInt(state.burnedWhite))*denominator+BigInt(state.unclaimedUnits)+BigInt(state.overflowUnits))
    .toBe((BigInt(state.clockMs)-BigInt(state.createdAtMs))*BigInt(state.rate.numerator)+BigInt(state.issuedWhite)*denominator);
}
function keys(value:unknown):string[]{
  if(value===null||typeof value!=='object')return [];
  return [...Object.keys(value),...Object.values(value).flatMap(keys)];
}

describe('opt-in postcard society with authentic choices and saved replay',()=>{
  it('preserves the complete legacy v1 four-day tape against independently archived source b8d42f4',()=>{
    // Obtained by git archive b8d42f42faf2ce4ef49c78bb05f858e58c2e0773 src package.json,
    // then running that isolated source with this seed/source and its original policy.
    const society=new Society({seed:20261025,sourceRevision});
    while(society.tick<4)for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
    expect(society.hash).toBe('252b7d7fde62123c62415a44ebce1933dbf647afdefe6be59f4113ae6de2c3bd');
    expect(digest(society.exportTape())).toBe('ee99622c2b82ca198d24028dab46465b1e10743ea567f7656fd05bbad096b71c');
    expect(society.exportTape()).toMatchObject({format:'node-society-offline-v1',decisions:expect.any(Array)});
    expect(Object.hasOwn(society.exportTape(),'postcardAccounts')).toBe(false);
    expect(society.exportTape().decisions.every(d=>!Object.hasOwn(d.visible,'postcards')&&!Object.hasOwn(d.action,'postcards'))).toBe(true);
  });

  it('opens explicit game time, caps one daily unclaimed interval, and makes claims plus safe fusion usable',()=>{
    const society=new Society({seed:42,sourceRevision,postcards}),initial=accounts(society.exportTape());
    const first=society.pendingPeople()[0]!,commit=society.view(first).visible;
    expect(commit.postcards).toMatchObject({held:{white:0,green:0,blue:0,purple:0,orange:0},clockMs:0,claimableWhite:0,lastClaimAtMs:null});
    expect(commit.legalChoices.postcards).toEqual({canClaim:false,fusion:[]});
    expect([...initial.values()].every(a=>a.createdAtMs===0&&a.clockMs===0)).toBe(true);
    toAct(society);
    const [person,other]=society.pendingPeople(),view=society.view(person!).visible;
    expect(view.postcards).toMatchObject({clockMs:DAY,claimableWhite:32,unclaimedUnits:String(32*HOUR),capHours:16});
    expect(view.legalChoices.postcards?.fusion).toContainEqual({tier:'white',stake:5,successProbability:1,requiresClaim:true});
    const before=society.view(other!).visible;
    society.submit(person!,action({claim:true,fusion:{tier:'white',stake:5}}));
    const own=accounts(society.exportTape()).get(person!)!;
    expect(own.held).toEqual({white:27,green:1,blue:0,purple:0,orange:0});expect(own.unclaimedUnits).toBe('0');
    expect(own.overflowUnits).toBe(String(16*HOUR));expect(own.drawCount).toBe(0);mass(own);
    // Someone else's private claim does not alter the other inhabitant's context.
    expect(society.view(other!).visible).toEqual(before);
    for(const pending of society.pendingPeople())society.submit(pending,action());
    expect(society.tick).toBe(1);expect(society.exportTape().transitions[0]!.postcards!.some(e=>e.person===person&&e.event.kind==='claim')).toBe(true);
    expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
  });

  it('allows abstention without forcing collection or fusion while genuine cap overflow accumulates',()=>{
    const society=new Society({seed:42,sourceRevision,postcards});
    while(society.tick<3)for(const person of society.pendingPeople())society.submit(person,action());
    for(const state of accounts(society.exportTape()).values()){
      expect(state.held).toEqual({white:0,green:0,blue:0,purple:0,orange:0});expect(state.lastClaimAtMs).toBeNull();
      mass(state);
    }
    const original=accounts(society.exportTape()).get(society.controlled[0]!)!;
    expect(original.unclaimedUnits).toBe(String(32*HOUR));expect(original.overflowUnits).toBe(String((3*48-32)*HOUR));
    expect(original.transactions.every(r=>r.event.kind==='clock')).toBe(true);
    expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
  });

  it('runs twenty real days with all roles under the same legal menu, real price/supply/customer decisions and postcard accounting',()=>{
    const {society,tape}=run();
    expect(tape.format).toBe('node-society-postcards-v2');expect(tape.controlled).toHaveLength(3);
    expect(tape.transitions).toHaveLength(20);expect(society.halted).toBe(false);
    const controlled=tape.decisions.filter(d=>d.controlled),autonomous=tape.decisions.filter(d=>!d.controlled);
    expect(controlled.filter(d=>d.day===1&&d.phase==='commit').map(d=>d.visible.self.role).sort()).toEqual(['Baker','Baker','Miller']);
    expect(new Set(autonomous.filter(d=>d.phase==='act').map(d=>d.visible.self.role)))
      .toEqual(new Set(['Courier','Investigator','ImportExport','Grifter']));
    expect(tape.decisions.some(d=>d.action.move!==null)).toBe(true);
    expect(tape.decisions.some(d=>d.action.communication?.kind==='wallPost')).toBe(true);
    expect(tape.decisions.some(d=>d.action.communication?.kind==='proximityUtterance')).toBe(true);
    expect(tape.decisions.some(d=>d.action.diary!==null)).toBe(true);
    expect(tape.decisions.some(d=>d.visible.self.role==='Miller'&&d.action.purchase!==null)).toBe(true);
    expect(tape.decisions.some(d=>d.action.postcards?.claim)).toBe(true);
    expect(tape.decisions.some(d=>d.action.postcards?.fusion?.stake===5)).toBe(true);
    expect(tape.decisions.some(d=>d.action.postcards?.fusion&&d.action.postcards.fusion.stake<5)).toBe(true);
    expect(new Set(tape.decisions.filter(d=>d.action.postcards?.claim).map(d=>d.visible.self.role)))
      .toEqual(new Set(['Baker','Miller','Courier','Investigator','ImportExport','Grifter']));
    for(const decision of tape.decisions){
      expect(decision.legalChoices).toEqual({menu:decision.visible.legalChoices,schema:decision.visible.decisionSchema});
      expect(decision.visible.postcards).toBeDefined();
      const allKeys=keys(decision.visible);
      for(const prohibited of ['seed','drawCount','rngVersion','origin','transactions','sourceRevision','observerSecret','packageInformation','issuedWhite','burnedWhite'])
        expect(allKeys).not.toContain(prohibited);
      expect(JSON.stringify(decision.visible)).not.toContain(sourceRevision);
    }
    for(const state of accounts(tape).values())mass(state);
    for(const transition of tape.transitions)expect(Math.abs(transition.accounting.residual)).toBeLessThan(1e-7);
    expect(verifySocietyTape(tape)).toMatchObject({verified:true,ticks:20,finalHash:society.hash});
    expect(run().tape).toEqual(tape);
  },30_000);

  it('retains the same person’s account through actual churn, retains departed holdings and starts arrivals at their real game time',()=>{
    const config={...societyConfig(),pMonthly:0.9,conscriptionDelay:3};
    const society=new Society({seed:20261025,sourceRevision,postcards,config});
    let changes=0,arrivals=0;
    while(society.tick<30){
      const peopleBefore=society.inspect().registry.people,old=accounts(society.exportTape()),tick=society.tick;
      while(society.tick===tick)for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
      const peopleAfter=society.inspect().registry.people,next=accounts(society.exportTape());
      for(const [id,state]of next){
        const earlier=old.get(id);
        if(earlier){
          expect(state.createdAtMs).toBe(earlier.createdAtMs);expect(state.origin).toEqual(earlier.origin);
          expect(state.transactions.slice(0,earlier.transactions.length)).toEqual(earlier.transactions);
          if(peopleAfter.get(id)!.roleEpoch!==peopleBefore.get(id)!.roleEpoch)changes++;
        }else{
          arrivals++;expect(state.createdAtMs).toBe(society.tick*DAY);expect(state.clockMs).toBe(state.createdAtMs);
          expect(state.held).toEqual({white:0,green:0,blue:0,purple:0,orange:0});expect(state.transactions).toEqual([]);
        }
        mass(state);
      }
      for(const id of old.keys())expect(next.has(id)).toBe(true);
    }
    expect(changes).toBeGreaterThan(0);expect(arrivals).toBeGreaterThan(0);
    expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
  },30_000);

  it('cold-reopens the exact v2 tape and verifies its views, menus, decisions, ledgers and final account state',()=>{
    const {society,tape}=run(4),bytes=stringifySocietyEvidence(tape),reopened=parseSocietyEvidence<SocietyTape>(bytes);
    expect(reopened).toEqual(tape);expect(verifySocietyTape(reopened).finalHash).toBe(society.hash);
    const script=["import {readFileSync} from 'node:fs';",
      "import {parseSocietyEvidence} from './src/society/codec.ts';",
      "import {verifySocietyTape} from './src/society/runtime.ts';",
      "process.stdout.write(JSON.stringify(verifySocietyTape(parseSocietyEvidence(readFileSync(0,'utf8')))));"].join('\n');
    const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type','module','--eval',script],
      {encoding:'utf8',input:bytes,windowsHide:true,maxBuffer:4*1024*1024}));
    expect(result).toEqual({verified:true,ticks:4,decisions:tape.decisions.length,finalHash:society.hash});
  },15_000);

  it('halts on forbidden postcard/host/world proposals before any new world or personal-account transition',()=>{
    const proposals=[
      {...action(),tool_calls:[{name:'read_file',arguments:{}}]},
      {...action(),world:{seed:123}},
      action({claim:true,fusion:{tier:'white',stake:1}}),
      action({claim:true,fusion:{tier:'orange',stake:5}}),
      action({claim:true,fusion:{tier:'green',stake:1}}),
      {...action(),postcards:{claim:true,fusion:null,seed:0}},
      {...action(),postcards:{claim:true,fusion:{tier:'white',stake:5,roll:0}}},
      {...action(),postcards:{claim:false,fusion:{tier:['green','blue'],stake:1}}},
      {...action(),postcards:{claim:false,fusion:{tier:'white',stake:5}}},
    ];
    for(const proposal of proposals){
      const society=new Society({seed:42,sourceRevision,postcards});toAct(society);
      const person=society.pendingPeople()[0]!,before=society.hash,tape=society.exportTape();
      expect(()=>society.submit(person,proposal)).toThrow(SocietySecurityError);
      expect(society.halted).toBe(true);expect(society.tick).toBe(0);expect(society.hash).toBe(before);
      expect(society.exportTape()).toEqual(tape);
      expect(()=>society.view(person)).toThrow('society_no_current_observation');
      expect(()=>society.submit(person,action())).toThrow('society_halted');
      expect(verifySocietyTape(tape,sourceRevision,{allowPartial:true})).toMatchObject({verified:true,complete:false});
    }
  },15_000);

  it('retains and replays the valid partial prefix after a duplicate/stale decision kills execution',()=>{
    const society=new Society({seed:42,sourceRevision,postcards});toAct(society);
    const person=society.pendingPeople()[0]!,choice=action({claim:true,fusion:{tier:'white',stake:5}});
    society.submit(person,choice);const before=society.hash,partial=society.exportTape();
    expect(()=>society.submit(person,choice)).toThrow('stale_or_duplicate_submission');expect(society.halted).toBe(true);
    expect(society.hash).toBe(before);expect(society.exportTape()).toEqual(partial);
    expect(verifySocietyTape(parseSocietyEvidence<SocietyTape>(stringifySocietyEvidence(partial)),sourceRevision,{allowPartial:true}))
      .toMatchObject({verified:true,ticks:0,complete:false,finalHash:before});
    expect(()=>verifySocietyTape(partial)).toThrow('society_replay_mismatch');
  });

  it('rejects tampered private accounts, clocks, choices, visible inventory and transition receipts',()=>{
    const {tape}=run(3);
    const edits:((q:SocietyTape)=>void)[]=[
      q=>(q.postcardAccounts![0]![1].held as any).white++,
      q=>(q.postcardConfig!.dayDurationMs as number)=HOUR,
      q=>(q.decisions[0]!.visible.postcards!.held as any).green++,
      q=>{const d=q.decisions.find(d=>d.phase==='act')!;d.action.postcards={claim:true,fusion:{tier:'green',stake:1}};},
      q=>q.transitions[0]!.postcards![0]!.afterHash='0'.repeat(64),
      q=>q.transitions[0]!.postcards!.pop(),
    ];
    for(const edit of edits){const changed=structuredClone(tape);edit(changed);expect(()=>verifySocietyTape(changed)).toThrow();}
  });
});
