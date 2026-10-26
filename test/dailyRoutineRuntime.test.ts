import {describe,it,expect} from 'vitest';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';
import {stringifySocietyEvidence,parseSocietyEvidence} from '../src/society/codec.js';
import {stepParticipantTurn,createParticipantState,fixtureGenesis} from '../src/agent/participantWorld.js';
import {observe} from '../src/server/observer.js';
import {stepRecognition,emptyRecognitionState,CREDIT_ADDRESS,RECOGNITION_DECAY_PER_DAY} from '../src/engine/recognition.js';
import {validateSocietyRoutineConfig} from '../src/society/routine.js';
import type {SocietyEconomyDay} from '../src/engine/societyEconomy.js';

const sourceRevision='daily-routine-fixture';
const stable=()=>({...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
const make=(maxTurnsPerDay=128)=>new Society({seed:42,sourceRevision,config:stable(),routine:{maxTurnsPerDay}});
function commit(s:Society){while(s.phase==='commit')for(const person of s.pendingPeople())s.submit(person,autonomousPolicy(s.view(person).visible));}
function run(days=2){const s=make();while(s.tick<days&&!s.halted)for(const person of s.pendingPeople())s.submit(person,autonomousPolicy(s.view(person).visible));return s;}

describe('versioned sequential Society days',()=>{
  it('keeps a day open without a diary and stops the last admitted turn without advancing the day',()=>{
    const s=make(2);commit(s);expect(s.turn).toBe(1);
    const before=s.inspect().world.resources;
    for(let turn=1;turn<=2;turn++)for(const person of s.pendingPeople())s.submit(person,emptySocietyAction());
    expect(s.halted).toBe(true);expect(s.stoppedReason).toBe('society_daily_turn_limit');expect(s.tick).toBe(0);
    expect(s.inspect().world.resources).toEqual(before);
    const tape=s.exportTape();expect(tape.format).toBe('node-society-routine-v4');expect(tape.turnTransitions).toHaveLength(2);
    expect(tape.transitions).toEqual([]);expect(verifySocietyTape(tape,sourceRevision,{allowPartial:true})).toMatchObject({verified:true,complete:false,ticks:0});
    expect(()=>verifySocietyTape(tape)).toThrow();
  });
  it('rejects an early finish as a boundary violation rather than fabricating daily work',()=>{
    const s=make();commit(s);const person=s.pendingPeople()[0]!;
    expect(s.view(person).visible.routine?.can.finishDay).toBe(false);
    expect(()=>s.submit(person,{...emptySocietyAction(),occupation:{kind:'finishDay'}})).toThrow();
    expect(s.halted).toBe(true);expect(s.tick).toBe(0);expect(s.exportTape().transitions).toEqual([]);
  });
  it('cold-replays a stopped partial round with its admitted pending action and exact pre-rollover hash',()=>{
    const s=make();commit(s);const person=s.pendingPeople()[0]!,before=s.hash;
    s.submit(person,autonomousPolicy(s.view(person).visible));expect(s.hash).not.toBe(before);s.halt();
    const tape=parseSocietyEvidence<ReturnType<Society['exportTape']>>(stringifySocietyEvidence(s.exportTape()));
    expect(tape.turnTransitions).toEqual([]);expect(tape.decisions.at(-1)!.transition?.afterHash).toBe(s.hash);
    expect(verifySocietyTape(tape,sourceRevision,{allowPartial:true})).toMatchObject({verified:true,complete:false,ticks:0,finalHash:s.hash});
  });
  it('uses private role-independent real residential floors and exact task destinations',()=>{
    const s=make(),state=s.inspect(),homes=s.pendingPeople().map(person=>s.view(person).visible.routine!.home);
    for(const home of homes){const building=state.world.shard.districts.flatMap(d=>d.buildings).find(b=>b.id===home.buildingId)!;
      expect(home.x).toBe(building.x);expect(home.y).toBe(building.y);expect(home.floor).toBeGreaterThanOrEqual(1);expect(home.floor).toBeLessThanOrEqual(building.floors);}
    commit(s);const p=s.pendingPeople()[0]!,v=s.view(p).visible;
    expect(v.routine?.can.diary).toBe(true);expect(v.routine?.can.wallPost).toBe(false);
    expect(()=>s.submit(p,{...emptySocietyAction(),communication:{kind:'wallPost',state:'hopeful'}})).toThrow();
  });
  it('connects existing generated islands with reproducible street links without changing old plots or buildings',()=>{
    const original=new Society({seed:42,sourceRevision,config:stable()}).inspect().world.shard;
    const shard=make().inspect().world.shard,again=make().inspect().world.shard;
    expect(shard).toEqual(again);
    expect(shard.districts[0]!.buildings).toEqual(original.districts[0]!.buildings);
    expect(shard.districts[0]!.plots.slice(0,original.districts[0]!.plots.length)).toEqual(original.districts[0]!.plots);
    const key=(p:{x:number;y:number})=>`${p.x},${p.y}`,points=new Set(shard.districts[0]!.plots.map(key));
    const queue=[shard.hubPlot],reached=new Set([key(shard.hubPlot)]);
    for(let i=0;i<queue.length;i++){const p=queue[i]!;for(const q of [{x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1}])
      if(points.has(key(q))&&!reached.has(key(q))){queue.push(q);reached.add(key(q));}}
    expect(reached.size).toBe(points.size);
    expect(new Society({seed:42,sourceRevision,config:stable()}).inspect().world.shard).toEqual(original);
  });
  it('steps real speech and movement without paying, producing, ageing or recognising extra days',()=>{
    const state=createParticipantState(fixtureGenesis(42,{...stable(),diarySubjectOptional:true}));
    const people=[...state.registry.people.values()].filter(p=>p.location!==null),p=people.find(p=>observe(state,p.id,state.genesis.observerSecret).context.hearingRefs!.length>0)!;
    const view=observe(state,p.id,state.genesis.observerSecret),target=view.context.hearingRefs![0]!;
    const before=structuredClone({...state.world,rng:undefined});
    const result=stepParticipantTurn(state,[{person:p.id,epoch:p.roleEpoch,tick:0,decision:{move:view.context.legalMoves[0]??null,
      communication:{kind:'proximityUtterance',intent:'refuse',tone:'guarded',referent:{kind:'player',playerId:target},context:null},
      diary:{subject:null,observation:'stayedGuarded',reading:'cantTellYet',context:null},role:null}}],1);
    expect(result.state.world.tick).toBe(0);expect(result.state.world.resources).toEqual(before.resources);
    expect(result.state.world.settlement).toEqual(before.settlement);expect(result.state.world.recognitionV2).toEqual(before.recognitionV2);
    expect(result.addresses).toHaveLength(1);expect(result.state.world.diary.get(p.id)?.[0]?.lastTouchedOnDay).toBe(0);
    const repeated=[...result.social.interactions,...result.social.interactions,...result.social.interactions];
    const recognition=stepRecognition(emptyRecognitionState(),0,repeated);
    expect(recognition.state.ledger.get(result.addresses[0]!.listener)?.get(p.id)?.credit).toBe(CREDIT_ADDRESS);
    const next=stepRecognition(recognition.state,1,[]);expect(next.state.ledger.get(result.addresses[0]!.listener)?.get(p.id)?.credit).toBe(CREDIT_ADDRESS-RECOGNITION_DECAY_PER_DAY);
  });
  it('completes actual multi-turn days through the same validated autonomous policy and cold replay',()=>{
    const s=run();expect(s.halted).toBe(false);expect(s.tick).toBe(2);
    const tape=s.exportTape();expect(tape.turnTransitions!.length).toBeGreaterThan(2);
    for(const day of tape.transitions){expect(day.routine!.turns).toBeGreaterThan(1);for(const resident of day.routine!.residents){
      expect(resident.closed).toBe(true);expect(Object.values(resident.tasks).every(Boolean)).toBe(true);
    }expect(Math.abs(day.accounting.residual)).toBeLessThan(1e-7);
      expect(day.effects.filter(e=>e.category==='diary')).toHaveLength(day.routine!.residents.length);
      const economy=day.economy as SocietyEconomyDay;
      expect(economy.grainConsumed).toBeLessThanOrEqual(economy.grainAvailable+1e-9);
      expect(economy.flourConsumed).toBeLessThanOrEqual(economy.flourProduced+1e-9);
      expect(economy.receipts).toHaveLength(day.routine!.residents.length);
    }
    expect((tape.transitions[0]!.economy as SocietyEconomyDay).receipts.every(r=>r.outcome==='unaffordable')).toBe(true);
    expect((tape.transitions[1]!.economy as SocietyEconomyDay).receipts.some(r=>r.outcome==='served')).toBe(true);
    for(const decision of tape.decisions.filter(d=>d.action.occupation?.kind==='finishDay')){
      expect(decision.visible.routine?.customers).toEqual([]);expect(decision.visible.routine?.awaitingSeller).toBeNull();
      expect(decision.visible.routine?.tasks.diary).toBe(true);
    }
    expect(verifySocietyTape(parseSocietyEvidence(stringifySocietyEvidence(tape)))).toMatchObject({verified:true,ticks:2,finalHash:s.hash});
    expect(stringifySocietyEvidence(run().exportTape())).toBe(stringifySocietyEvidence(tape));
  });
  it('validates the technical turn bound without relaxing historical contract shapes',()=>{
    for(const config of [{maxTurnsPerDay:0},{maxTurnsPerDay:129},{maxTurnsPerDay:1,extra:1},{maxTurnsPerDay:1.5},null])expect(()=>validateSocietyRoutineConfig(config)).toThrow();
    const old=new Society({seed:42,sourceRevision,config:stable()});expect(old.exportTape().format).toBe('node-society-offline-v1');expect(old.exportTape()).not.toHaveProperty('routineState');
    expect(old.view(old.pendingPeople()[0]!).visible).not.toHaveProperty('routine');
    expect(()=>validateSocietyRoutineConfig({get maxTurnsPerDay(){throw Error('getter_executed');}})).toThrow('society_routine_config');
  });
});
