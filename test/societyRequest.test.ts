import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createParticipantState, fixtureGenesis } from '../src/agent/participantWorld.js';
import { DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { buildSocietyContext, SocietySecurityError } from '../src/society/boundary.js';
import { buildSocietyPolicyPacket, buildSocietyRequest } from '../src/society/request.js';
import {usageCost} from '../src/agent/accountingLedger.js';
import {PRICED_MODELS} from '../src/agent/modelPricing.js';

function view() {
  const state = createParticipantState(fixtureGenesis(72, { ...DEFAULT_WORLD_CONFIG, recognition: 'v2' }));
  const baker = [...state.registry.people.values()].find(p => p.role === 'baker')!;
  return { state, baker, visible: buildSocietyContext(state, baker.id, { phase: 'commit' }).visible };
}
describe('safe society request preparation without dispatch', () => {
  it('sends exactly the authorized current view with the six-field schema', () => {
    const { visible } = view(), request = buildSocietyRequest(visible), wire = JSON.parse(request.body);
    expect(wire.messages).toHaveLength(1);
    expect(wire.messages[0].role).toBe('user');
    expect(wire.messages[0].content).toHaveLength(1);
    expect(JSON.parse(wire.messages[0].content[0].text)).toEqual(visible);
    expect(wire.output_config.format.schema.required).toEqual(['move', 'communication', 'diary', 'occupation', 'purchase', 'oracle']);
    expect(wire.output_config.format.schema.additionalProperties).toBe(false);
    expect(wire.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(wire.output_config.effort).toBe('high');
    expect(wire.max_tokens).toBe(16384);
    expect(request.maxOutputTokens).toBe(16384);
    // Even the largest admitted body reserves the full output headroom within
    // the new per-request ceiling; reservations never assume a short response.
    expect(usageCost(65536+4096,16384,PRICED_MODELS['claude-haiku-5-5']!)).toBeLessThanOrEqual(32000);
    expect(wire).not.toHaveProperty('tools');
    expect(wire).not.toHaveProperty('tool_choice');
    expect(request.sha256).toBe(createHash('sha256').update(request.body).digest('hex'));
    expect(request.maxInputTokens).toBe(Buffer.byteLength(request.body) + 4096);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('never includes transport, source, experiment or injected development metadata in messages', () => {
    const { state, baker } = view();
    Object.assign(state.world, { packageInformation: 'PACKAGE_SECRET', developmentNotes: 'DEVELOPMENT_SECRET', worldHash: 'WORLD_HASH_SECRET' });
    Object.assign(state.genesis, { providerCredential: 'CREDENTIAL_SECRET' });
    const visible = buildSocietyContext(state, baker.id, { phase: 'act' }).visible;
    const request = buildSocietyRequest(visible), wire = JSON.parse(request.body), spoken = JSON.stringify({ system: wire.system, messages: wire.messages });
    for (const value of ['PACKAGE_SECRET', 'DEVELOPMENT_SECRET', 'WORLD_HASH_SECRET', 'CREDENTIAL_SECRET', state.genesis.observerSecret,
      state.genesis.sourceRevision, state.genesis.namespace, 'worldHash', 'requestId', 'sourceRevision', 'experimentStart', 'conditionTransition', 'perceptionPatch', 'countBody', 'maxInputTokens', 'sha256', 'src/', 'package.json']) expect(spoken).not.toContain(value);
    for (const word of ['experiment', 'provider', 'version', 'host', 'developer', 'source']) expect(wire.system).not.toContain(word);
    expect(Object.keys(buildSocietyPolicyPacket(visible))).toEqual(['system', 'observation', 'decisionSchema']);
  });

  it('rejects forged, cloned, extended or unreviewed model inputs before preparing bytes', () => {
    const { visible } = view();
    for (const forged of [structuredClone(visible), { ...visible, developmentUpdate: 'secret' }, {}, null]) {
      expect(() => buildSocietyRequest(forged as typeof visible)).toThrow(SocietySecurityError);
    }
    expect(() => buildSocietyRequest(visible, 'unreviewed-model')).toThrow('society_request_model');
    expect(buildSocietyRequest(visible).body).toBe(buildSocietyRequest(visible).body);
  });
});
