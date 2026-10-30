import {expect,it} from 'vitest';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy} from '../src/society/policy.js';

it('starts assistance on a completed zero-crossing and evicts after three more completed days',()=>{
  const society=new Society({seed:42,sourceRevision:'backstop-fixture',competitiveGrifter:true,
    config:{...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0},
    routine:{maxTurnsPerDay:128}});
  const miller=society.controlled.find(id=>society.inspect().registry.people.get(id)?.role==='miller')!;
  let turns=0;
  while(society.tick<4&&!society.halted&&turns++<1000){
    for(const person of society.pendingPeople()){
      const view=society.view(person).visible, policyView=structuredClone(view);
      if(person===miller&&policyView.routine){policyView.routine.tasks.work=true;policyView.routine.can.work=false;}
      const action=autonomousPolicy(policyView);
      if(view.phase==='commit'&&view.self.role==='Baker')action.occupation={kind:'bakerPrice',price:0};
      society.submit(person,action);
    }
  }
  expect(society.halted).toBe(false);
  const tape=society.exportTape();
  expect(tape.transitions[0]!.reputationBackstops!.started.map(x=>x.person)).toContain(miller);
  expect(tape.transitions[1]!.reputationBackstops!.expired.map(x=>x.person)).not.toContain(miller);
  expect(tape.transitions[2]!.reputationBackstops!.expired.map(x=>x.person)).not.toContain(miller);
  expect(tape.transitions[3]!.reputationBackstops!.expired.map(x=>x.person)).toContain(miller);
  expect(society.inspect().registry.people.get(miller)?.role).toBeNull();
  expect(verifySocietyTape(tape).verified).toBe(true);
});

it('offers and settles anonymous bakery assistance with deterministic replay',()=>{
  const society=new Society({seed:42,sourceRevision:'bakery-backstop-fixture',competitiveGrifter:true,
    config:{...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0},
    routine:{maxTurnsPerDay:128}});
  const baker=society.controlled.find(id=>society.inspect().registry.people.get(id)?.role==='baker')!;
  const site=society.inspect().registry.people.get(baker)!.location!;
  let choseMechanical=false,buyer='',turns=0;
  while(society.tick<2&&!society.halted&&turns++<1000){
    for(const person of society.pendingPeople()){
      const view=society.view(person).visible,policyView=structuredClone(view);
      if(person===baker&&policyView.routine){policyView.routine.tasks.work=true;policyView.routine.can.work=false;}
      const action=autonomousPolicy(policyView);
      if(view.phase==='commit'&&view.self.role==='Baker')action.occupation={kind:'bakerPrice',price:0};
      const mechanical=view.wall.prices.find(q=>q.buildingId===site&&q.mechanical);
      if(person===baker)expect(mechanical).toBeUndefined();
      if(mechanical&&view.legalChoices.purchaseSellers.includes(mechanical.sellerRef)&&!choseMechanical){
        action.purchase={seller:mechanical.sellerRef,quantity:1};choseMechanical=true;buyer=person;
      }
      society.submit(person,action);
    }
  }
  expect(society.halted).toBe(false);
  expect(choseMechanical).toBe(true);
  const tape=society.exportTape();
  expect(tape.transitions[0]!.reputationBackstops!.started.some(x=>x.person===baker)).toBe(true);
  const day=tape.transitions[1]!.economy as {receipts:{customer:string;bakerSite:string|null;outcome:string}[]};
  expect(day.receipts.find(r=>r.customer===buyer)).toMatchObject({bakerSite:site,outcome:'noFlour'});
  expect(tape.transitions[1]!.civicEvents!.some(e=>e.subjectId===baker&&e.valence==='positive')).toBe(false);
  expect(verifySocietyTape(tape).verified).toBe(true);
});
