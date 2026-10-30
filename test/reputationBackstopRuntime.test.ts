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
