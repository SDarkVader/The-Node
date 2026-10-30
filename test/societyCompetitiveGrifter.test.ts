import { expect, it } from 'vitest';
import { Society, verifySocietyTape } from '../src/society/runtime.js';
import { autonomousPolicy } from '../src/society/policy.js';
import { buildSocietyRequest } from '../src/society/request.js';
import { validateSocietyWire } from '../scripts/society-request-worker.js';

it('selects one persistent competitive inhabitant and replays its offline decisions', () => {
  const society = new Society({seed: 42, sourceRevision: 'a'.repeat(40), competitiveGrifter: true});
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
  while(society.tick < 2) {
    for(const person of society.pendingPeople()) {
      const view = society.view(person).visible;
      society.submit(person, autonomousPolicy(view));
    }
  }
  expect(verifySocietyTape(society.exportTape()).verified).toBe(true);
});
