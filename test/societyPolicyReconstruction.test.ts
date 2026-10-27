import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Society } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { stringifySocietyEvidence } from '../src/society/codec.js';
import { SocietyObservatorySource } from '../src/observatory/societySource.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const s=new Society({seed:42,sourceRevision:'a'.repeat(40),routine:{maxTurnsPerDay:128}});
  const events:unknown[]=[{kind:'start',data:{plan:{controlled:s.controlled}}}];
  let call=0,seenAutonomous=false,lastControlled=false;
  while(!seenAutonomous||!lastControlled){
    const p=s.pendingPeople()[0]!,v=s.view(p),action=autonomousPolicy(v.visible);
    if(s.controlled.includes(p)){
      const wire=buildSocietyRequest(v.visible),id=`test-${call}`,beforeHash=s.hash,tick=s.tick,phase=s.phase,turn=s.turn;
      events.push({kind:'request',data:{requestId:id,index:call,actorId:p,tick,phase,turn,body:wire.body,sha256:wire.sha256}});
      events.push({kind:'decision',data:{requestId:id,index:call,actorId:p,tick,phase,turn,action}});
      s.submit(p,action);
      events.push({kind:'outcome',data:{requestId:id,index:call,actorId:p,tick,phase,turn,status:'submitted',beforeHash,afterHash:s.hash}});
      call++;lastControlled=true;
    }else{s.submit(p,action);seenAutonomous=true;lastControlled=false;}
  }
  const tape=s.exportTape(),tapeText=stringifySocietyEvidence(tape),eventsText=events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n')+'\n';
  const dir=mkdtempSync(join(tmpdir(),'node-policy-provenance-'));
  writeFileSync(join(dir,'society.json'),tapeText);writeFileSync(join(dir,'events.jsonl'),eventsText);
  const marker={format:'node-society-policy-prefix-reconstruction-v1',sourceRevision:tape.genesis.sourceRevision,
    eventsSha256:sha(eventsText),tapeSha256:sha(tapeText),controlledOutcomes:call,
    policyDecisions:tape.decisions.filter(d=>!d.controlled).length,endpoint:'last_recorded_controlled_outcome',unrecordedLaterActionsAssumed:false};
  writeFileSync(join(dir,'recovery.json'),JSON.stringify(marker));
  const source=new SocietyObservatorySource({kind:'society',id:'TEST-ONLY-policy-provenance',directory:dir,mode:'live'});
  return {source,dir,marker,eventsText};
}
it('labels policy-reconstructed actions separately and does not count them as recorded execution',()=>{
  const f=fixture();expect(f.source.refresh()).toBe(true);
  const snapshot=f.source.snapshot(null,'TEST-ONLY-observer',true);
  if(!('calls' in snapshot))throw Error('missing researcher projection');
  expect(snapshot.status).toBe('policy_reconstructed');
  const policy=snapshot.calls.filter(c=>c.reasoning.source==='reconstructed_deterministic_policy');
  expect(policy).toHaveLength(f.marker.policyDecisions);
  expect(policy.every(c=>c.executed===false)).toBe(true);
  expect(snapshot.telemetry.executedDecisionCount).toBe(f.marker.controlledOutcomes);
  expect(snapshot.control.replayOnly).toBe(true);
});
it('rejects inconsistent policy provenance and altered evidence bytes',()=>{
  const f=fixture();writeFileSync(join(f.dir,'recovery.json'),JSON.stringify({...f.marker,policyDecisions:f.marker.policyDecisions+1}));
  expect(()=>f.source.refresh()).toThrow('society_observatory_recovery_provenance');
  writeFileSync(join(f.dir,'recovery.json'),JSON.stringify(f.marker));
  writeFileSync(join(f.dir,'events.jsonl'),f.eventsText+'\n');
  expect(()=>f.source.refresh()).toThrow('society_observatory_recovery_provenance');
});
