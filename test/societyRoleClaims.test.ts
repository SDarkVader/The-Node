import {expect,it} from 'vitest';
import {createParticipantState,fixtureGenesis,applyParticipantMove} from '../src/agent/participantWorld.js';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {evictBackstoppedOccupant} from '../src/society/reputationBackstop.js';
import {resolveRoleClaims} from '../src/society/roleClaims.js';
import {assertPopulation} from '../src/engine/inhabitants.js';
import {buildSocietyContext,validateSocietyAction} from '../src/society/boundary.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';

function vacancy() {
  const state=createParticipantState(fixtureGenesis(42,societyConfig()));
  const victim=[...state.registry.people.values()].find(p=>p.role==='miller')!;
  return {state:evictBackstoppedOccupant(state,{person:victim.id,role:'miller',roleEpoch:victim.roleEpoch,businessId:victim.location!},1),target:victim.location!};
}
it('offers a known open business as a legal action and rejects an unseen or invented site',()=>{
  let {state,target}=vacancy();
  const person=[...state.registry.people.values()].find(p=>p.role===null)!;
  const place=state.world.millers.find(m=>m.buildingId===target)!;
  state={...state,world:applyParticipantMove(state.world,null,person.location!,{x:place.x,y:place.y})};
  const view=buildSocietyContext(state,person.id,{phase:'act',objective:'competitive-society-v1',
    civicStanding:{own:{standing:0,notoriety:0},others:[],assistance:[]}});
  expect(view.visible.legalChoices.roleOpportunities).toContain(target);
  const base={move:null,communication:null,diary:null,occupation:{kind:'claimRole',buildingId:target},purchase:null,oracle:null};
  expect(validateSocietyAction(base,view.context).occupation).toEqual(base.occupation);
  expect(()=>validateSocietyAction({...base,occupation:{kind:'claimRole',buildingId:'invented'}},view.context)).toThrow();
  const wire=buildSocietyRequest(view.visible);
  expect(()=>validateSocietyWire(Buffer.from(wire.body),wire.sha256)).not.toThrow();
});
it('awards the first admitted valid claim and preserves population, identity and wealth',()=>{
  const {state,target}=vacancy(),candidates=[...state.registry.people.values()].filter(p=>p.role===null).slice(0,2);
  const [first,second]=candidates;
  const firstWealth=state.world.grifters.find(g=>g.id===first!.location)!.wealth;
  const {state:next,outcomes}=resolveRoleClaims(state,candidates.map(p=>({person:p.id,roleEpoch:p.roleEpoch,buildingId:target})),2);
  expect(outcomes.map(q=>q.status)).toEqual(['claimed','unavailable']);
  expect(next.registry.people.get(first!.id)).toMatchObject({location:target,role:'miller',roleEpoch:first!.roleEpoch+1});
  expect(next.registry.people.get(second!.id)).toEqual(second);
  expect(next.world.millers.find(s=>s.buildingId===target)!.wealth).toBe(firstWealth);
  expect(()=>assertPopulation(next.world,next.registry)).not.toThrow();
});
it('allows an incumbent to take an open role without holding two jobs',()=>{
  const {state,target}=vacancy(),person=[...state.registry.people.values()].find(p=>p.role==='baker')!;
  const source=person.location!,wealth=state.world.bakers.find(s=>s.buildingId===source)!.wealth;
  const {state:next,outcomes}=resolveRoleClaims(state,[{person:person.id,roleEpoch:person.roleEpoch,buildingId:target}],2);
  expect(outcomes[0]!.status).toBe('claimed');
  expect(next.registry.people.get(person.id)).toMatchObject({location:target,role:'miller'});
  expect(next.world.bakers.find(s=>s.buildingId===source)!.slot.state).toBe('VACANT');
  expect(next.world.millers.find(s=>s.buildingId===target)!.wealth).toBe(wealth);
  expect(()=>assertPopulation(next.world,next.registry)).not.toThrow();
});
it('records chronological claims in a real society and replays the winning decision',()=>{
  const config={...societyConfig(),pMonthly:0.9,arrivalPDaily:0,migrationK:0,
    conscriptionDelay:999, vacancy:{beta:0,backstoppedRecoveryHazard:0}};
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),config,competitiveGrifter:true});
  let contested=false;
  while(society.tick<12&&!contested){
    if(society.phase==='act'){
      const candidates=society.pendingPeople().flatMap(person=>{
        const view=society.view(person).visible;
        return view.self.role==='Grifter'?[{person,options:view.legalChoices.roleOpportunities??[]}]:[];
      });
      const first=candidates[0],target=first?.options.find(id=>candidates.slice(1).some(q=>q.options.includes(id)));
      if(first&&target){
        const second=candidates.slice(1).find(q=>q.options.includes(target))!;
        society.submit(first.person,{...emptySocietyAction(),occupation:{kind:'claimRole',buildingId:target}});
        const prefix=society.exportTape();
        expect(verifySocietyTape(prefix,prefix.genesis.sourceRevision,{allowPartial:true}).verified).toBe(true);
        society.submit(second.person,{...emptySocietyAction(),occupation:{kind:'claimRole',buildingId:target}});
        contested=true;
      }
    }
    for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
  }
  expect(contested).toBe(true);
  const claims=society.exportTape().transitions.flatMap(t=>t.roleClaims??[]);
  expect(claims.slice(-2).map(q=>q.status)).toEqual(['claimed','unavailable']);
  expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
});

it('settles an incumbent claim without reusing the old business commitments',()=>{
  const config={...societyConfig(),pMonthly:0.9,arrivalPDaily:0,migrationK:0,
    conscriptionDelay:999,vacancy:{beta:0,backstoppedRecoveryHazard:0}};
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),config,competitiveGrifter:true});
  let claimed=false;
  while(society.tick<30&&!claimed){
    if(society.phase==='act'){
      const candidate=society.pendingPeople().map(person=>({person,view:society.view(person).visible}))
        .find(q=>q.view.self.role==='Baker'&&(q.view.legalChoices.roleOpportunities?.length??0)>0);
      if(candidate){
        society.submit(candidate.person,{...emptySocietyAction(),occupation:{kind:'claimRole',
          buildingId:candidate.view.legalChoices.roleOpportunities![0]}});
        claimed=true;
      }
    }
    for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
  }
  expect(claimed).toBe(true);
  expect(society.exportTape().transitions.flatMap(t=>t.roleClaims??[]).some(c=>c.status==='claimed')).toBe(true);
  expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
});

it('does not penalize a new roleholder for work before their claim was settled',()=>{
  const config={...societyConfig(),pMonthly:0.9,arrivalPDaily:0,migrationK:0,
    conscriptionDelay:999,vacancy:{beta:0,backstoppedRecoveryHazard:0}};
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),config,competitiveGrifter:true,routine:{maxTurnsPerDay:128}});
  let applicant:string|undefined, appliedDay=0, turns=0;
  while(society.tick<15&&!society.halted&&turns++<3000){
    const pending=society.pendingPeople();
    for(const person of pending){
      const view=society.view(person).visible;
      const target=view.legalChoices.roleOpportunities?.[0];
      if(!applicant&&view.phase==='act'&&view.self.role==='Grifter'&&target){
        applicant=person; appliedDay=view.day;
        society.submit(person,{...emptySocietyAction(),occupation:{kind:'claimRole',buildingId:target}});
      }else society.submit(person,autonomousPolicy(view));
    }
    if(applicant&&society.tick>=appliedDay)break;
  }
  expect(applicant).toBeDefined();
  const transition=society.exportTape().transitions.find(t=>t.day===appliedDay)!;
  expect(transition.roleClaims?.some(q=>q.person===applicant&&q.status==='claimed')).toBe(true);
  expect(transition.civicEvents?.filter(e=>e.subjectId===applicant&&e.valence==='negative')).toEqual([]);
  expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
});
