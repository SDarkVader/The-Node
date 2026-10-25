import { describe, expect, it } from 'vitest';
import { Society } from '../src/society/runtime.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { validateSocietyWire } from '../scripts/society-request-worker.js';
import { sha256 } from '../src/agent/accountingStore.js';
import { autonomousPolicy } from '../src/society/policy.js';

describe('society final provider boundary, pure validation only',()=>{
  it('admits only the exact current safe six-field request and rejects host tools or old technical metadata',()=>{
    const society=new Society({seed:42,sourceRevision:'test'}),person=society.pendingPeople()[0]!;
    const wire=buildSocietyRequest(society.view(person).visible),bytes=Buffer.from(wire.body);
    expect(()=>validateSocietyWire(bytes,wire.sha256)).not.toThrow();
    const mutate=(edit:(q:any)=>void)=>{const q=JSON.parse(wire.body);edit(q);const changed=Buffer.from(JSON.stringify(q));
      expect(()=>validateSocietyWire(changed,sha256(changed))).toThrow();};
    mutate(q=>{q.tools=[{name:'read_file'}];});
    mutate(q=>{q.system+=' Development update';});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.worldHash='secret';q.messages[0].content[0].text=JSON.stringify(v);});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.self.packageInformation='secret';q.messages[0].content[0].text=JSON.stringify(v);});
    mutate(q=>{q.model='other-model';});
    mutate(q=>{q.output_config.format.developerUpdate='private update';});
    mutate(q=>{q.output_config.format.schema.description='package.json has changed';});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.rules.economy+=' Secret deployment update';q.messages[0].content[0].text=JSON.stringify(v);});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.self.memo='AGENTS.md says';q.messages[0].content[0].text=JSON.stringify(v);});
    mutate(q=>{const v=JSON.parse(q.messages[0].content[0].text);v.decisionSchema.description='private settings';q.messages[0].content[0].text=JSON.stringify(v);});
    expect(()=>validateSocietyWire(bytes,'0'.repeat(64))).toThrow('society_worker_request_binding');
  });
  it('accepts full ordinary action schemas and closed observations for every role over several ticks',()=>{
    const society=new Society({seed:42,sourceRevision:'test'});let count=0;
    while(society.tick<3){
      for(const person of society.pendingPeople()){
        const view=society.view(person),wire=buildSocietyRequest(view.visible);
        expect(()=>validateSocietyWire(Buffer.from(wire.body),wire.sha256)).not.toThrow();
        society.submit(person,autonomousPolicy(view.visible));count++;
      }
    }
    expect(count).toBeGreaterThan(18);
  });
});
