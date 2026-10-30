import {describe,expect,it} from 'vitest';
import {createParticipantState,fixtureGenesis} from '../src/agent/participantWorld.js';
import {societyConfig} from '../src/society/runtime.js';
import {totalHoldings} from '../src/engine/settlement.js';
import {roleArrays} from '../src/engine/inhabitants.js';
import {evictBackstoppedOccupant,stepReputationBackstops,type BackstopIncumbent} from '../src/society/reputationBackstop.js';

const subject:BackstopIncumbent={person:'p',role:'miller',roleEpoch:0,businessId:'mill',standingBefore:1,standingAfter:0};
describe('completed-day reputation backstop',()=>{
  it('starts only on crossing and evicts after three completed days unless recovered',()=>{
    expect(stepReputationBackstops([],[{...subject,standingBefore:0}],1).started).toEqual([]);
    const started=stepReputationBackstops([],[subject],1);
    expect(started.started).toHaveLength(1);
    const day2=stepReputationBackstops(started.active,[{...subject,standingBefore:0}],2);
    const day3=stepReputationBackstops(day2.active,[{...subject,standingBefore:0}],3);
    expect(day2.expired).toHaveLength(0);expect(day3.expired).toHaveLength(0);
    const day4=stepReputationBackstops(day3.active,[{...subject,standingBefore:0}],4);
    expect(day4.expired).toEqual(started.started);expect(day4.active).toHaveLength(0);
    const rescue=stepReputationBackstops(day3.active,[{...subject,standingBefore:0,standingAfter:0.1}],4);
    expect(rescue.recovered).toEqual(started.started);expect(rescue.expired).toHaveLength(0);
  });
  it('does not apply an old role episode to a replacement person',()=>{
    const started=stepReputationBackstops([],[subject],1);
    const replacement={...subject,person:'another',roleEpoch:1,standingBefore:0};
    const result=stepReputationBackstops(started.active,[replacement],2);
    expect(result.active).toHaveLength(0);expect(result.expired).toHaveLength(0);
    const crossing=stepReputationBackstops(started.active,[{...replacement,standingBefore:1,standingAfter:0}],2);
    expect(crossing.started[0]?.person).toBe('another');
  });
  it('preserves the person and total holdings when evicting into the existing roleless pool',()=>{
    const genesis=fixtureGenesis(42,societyConfig()),state=createParticipantState(genesis);
    const miller=[...state.registry.people.values()].find(p=>p.role==='miller')!;
    const item={person:miller.id,role:'miller' as const,roleEpoch:miller.roleEpoch,businessId:miller.location!};
    const wealth=state.world.millers.find(m=>m.buildingId===miller.location)!.wealth;
    const holdings=(s:typeof state)=>totalHoldings([...roleArrays(s.world).map(([,slots])=>slots),s.world.grifters]);
    const before=holdings(state),after=evictBackstoppedOccupant(state,item,1);
    expect(holdings(after)).toBe(before);
    expect(after.world.population).toBe(state.world.population);
    expect(after.registry.people.get(miller.id)?.role).toBeNull();
    expect(after.registry.people.get(miller.id)?.roleEpoch).toBe(miller.roleEpoch+1);
    expect(after.world.grifters.find(g=>g.id===after.registry.people.get(miller.id)?.location)?.wealth).toBe(wealth);
    expect(after.world.millers.find(m=>m.buildingId===miller.location)?.slot.state).toBe('BACKSTOPPED');
    expect(state.registry.people.get(miller.id)?.role).toBe('miller');
    expect(()=>evictBackstoppedOccupant(after,item,2)).toThrow('society_backstop_stale_incumbent');
  });
});
