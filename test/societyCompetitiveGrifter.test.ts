import { expect, it } from 'vitest';
import { Society, verifySocietyTape, societyConfig } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { emptySocietyAction } from '../src/society/policy.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { validateSocietyWire } from '../scripts/society-request-worker.js';

it('selects one persistent competitive inhabitant and replays its offline decisions', () => {
  const society = new Society({seed: 42, sourceRevision: 'a'.repeat(40), competitiveGrifter: true, config:{...societyConfig(),purchaseCycleDays:1}});
  expect(society.controlled).toHaveLength(4);
  const grifter = society.controlled[3]!;
  for(const person of society.pendingPeople()) society.submit(person, autonomousPolicy(society.view(person).visible));
  const grifterView = society.view(grifter).visible;
  expect(grifterView.self.role).toBe('Grifter');
  expect(grifterView.objective).toBe('competitive-society-v1');
  const wire = buildSocietyRequest(grifterView);
  expect(JSON.parse(wire.body).system).toContain('influence anyone');
  expect(() => validateSocietyWire(Buffer.from(wire.body), wire.sha256)).not.toThrow();
  const other = society.view(society.controlled[0]!).visible;
  expect(other.objective).toBe('competitive-society-v1');
  expect(JSON.parse(buildSocietyRequest(other).body).system).toBe(JSON.parse(wire.body).system);
  while(society.tick < 5) {
    for(const person of society.pendingPeople()) {
      const view = society.view(person).visible;
      society.submit(person, autonomousPolicy(view));
    }
  }
  const tape=society.exportTape();
  expect(tape.transitions.some(t=>t.civicEvents!.length>0)).toBe(true);
  expect(tape.decisions.some(d=>d.day>1&&d.visible.civicStanding!.own.standing>0)).toBe(true);
  for(const d of tape.decisions){
    const allowed=new Set([...d.visible.local.people.map(p=>p.ref),...d.visible.legalChoices.diarySubjects]);
    for(const rival of d.visible.civicStanding!.others)expect(allowed.has(rival.ref)).toBe(true);
  }
  expect(verifySocietyTape(tape).verified).toBe(true);
  const corrupted=structuredClone(tape);
  const events=corrupted.transitions.find(t=>t.civicEvents!.length)!.civicEvents!;
  events[0]={...events[0]!,weight:2};
  expect(()=>verifySocietyTape(corrupted)).toThrow();
});

it('records loss only after the inactive role holder explicitly finishes a settled day',()=>{
  const config={...societyConfig(),pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0};
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),competitiveGrifter:true,config,routine:{maxTurnsPerDay:128}});
  const target=society.controlled.find(p=>society.inspect().registry.people.get(p)?.role==='miller')!;
  const start=society.view(target).visible.civicStanding!.own.standing;
  expect(start).toBeGreaterThan(0);
  while(society.tick<1){
    for(const person of society.pendingPeople()){
      const visible=society.view(person).visible;
      if(person===target&&visible.phase==='act'&&visible.routine){
        const other=structuredClone(visible);
        other.routine!.tasks.work=true;
        other.routine!.can.work=false;
        const action=autonomousPolicy(other);
        society.submit(person,action);
      } else society.submit(person,autonomousPolicy(visible));
    }
  }
  const tape=society.exportTape();
  expect(tape.transitions[0]!.civicEvents).toContainEqual(expect.objectContaining({subjectId:target,valence:'negative',domain:'service',weight:1}));
  expect(verifySocietyTape(tape).verified).toBe(true);
});

it('does not settle or penalize an interrupted day at the operational turn limit',()=>{
  const society=new Society({seed:42,sourceRevision:'a'.repeat(40),competitiveGrifter:true,routine:{maxTurnsPerDay:1}});
  for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
  for(const person of society.pendingPeople())society.submit(person,emptySocietyAction());
  expect(society.halted).toBe(true);
  expect(society.tick).toBe(0);
  expect(society.exportTape().transitions).toHaveLength(0);
  expect(verifySocietyTape(society.exportTape(),undefined,{allowPartial:true})).toMatchObject({verified:true,ticks:0,complete:false});
});
