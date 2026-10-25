import { describe, expect, it } from 'vitest';
import { stringifySocietyEvidence, parseSocietyEvidence } from '../src/society/codec.js';
import { Society, verifySocietyTape, type SocietyTape } from '../src/society/runtime.js';
import { createSocietyPlan } from '../src/society/accounted.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { digest } from '../src/agent/replay.js';

describe('lossless society disk evidence',()=>{
  it('preserves absent versus undefined configuration and negative zero without modifying the original',()=>{
    const original={a:undefined,nested:{b:undefined,zero:-0},list:[undefined,0,null]};
    const restored=parseSocietyEvidence<typeof original>(stringifySocietyEvidence(original));
    expect(digest(restored)).toBe(digest(original));expect(Object.hasOwn(restored,'a')).toBe(true);
    expect(Object.is(restored.nested.zero,-0)).toBe(true);expect(original.nested.b).toBeUndefined();
    const corrupt=JSON.parse(stringifySocietyEvidence(original));corrupt.value.nested.zero=5;
    expect(()=>parseSocietyEvidence(JSON.stringify(corrupt))).toThrow();
  });
  it('reopens a prepared plan with the identical full genesis and initial society hash',()=>{
    const society=new Society({seed:42,sourceRevision:'disk-fixture',observerSecret:'new-private-offline-observer-secret'});
    const bundle={genesis:society.exportTape().genesis,plan:createSocietyPlan(society)};
    const restored=parseSocietyEvidence<typeof bundle>(stringifySocietyEvidence(bundle));
    const reopened=new Society({seed:restored.genesis.seed,sourceRevision:restored.genesis.sourceRevision,
      config:restored.genesis.config,observerSecret:restored.genesis.observerSecret});
    expect(digest(reopened.exportTape().genesis)).toBe(digest(bundle.genesis));
    expect(reopened.hash).toBe(restored.plan.initialHash);
  });
  it('verifies all contexts/actions/transitions after a real JSON write/read round trip',()=>{
    const society=new Society({seed:42,sourceRevision:'disk-fixture'});
    while(society.tick<3)for(const person of society.pendingPeople())society.submit(person,autonomousPolicy(society.view(person).visible));
    const restored=parseSocietyEvidence<SocietyTape>(stringifySocietyEvidence(society.exportTape()));
    expect(verifySocietyTape(restored)).toMatchObject({verified:true,ticks:3,finalHash:society.hash});
  });
});
