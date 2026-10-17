// Native Node tests against compiled reconstruction. No agents or API requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

if (!process.env.BROKER_RECOVERY_BUILD) throw new Error('Set BROKER_RECOVERY_BUILD to the compiled output directory');
const load = file => import(pathToFileURL(path.join(process.env.BROKER_RECOVERY_BUILD, 'agent', file)).href);
const { validateDecision, policyInput } = await load('protocol.js');
const { OfflineBroker, assertLiveAdmission, RECOVERY_HOLD } = await load('broker.js');
const { readBoundedJson } = await load('httpBody.js');
const context = () => ({tick: 10, selfRef: 'self', role: 'Baker', roleEpoch: 2,
  legalMoves: [{x: 1, y: 2}], presentRefs: ['other'], knownSubjects: ['known']});
const idle = () => ({move: null, communication: null, diary: null, role: null});
const response = decision => ({status: 'completed', model: 'offline-fixture', inputTokens: 20, outputTokens: 10, decision});

test('valid four-category decision remains detached from input', () => {
  const d = {...idle(), move: {x: 1, y: 2}, communication: {kind: 'wallPost', state: 'hopeful'},
    diary: {subject: 'known', observation: 'keptAPromise', reading: 'cantTellYet', context: null}, role: {kind: 'bakerPrice', price: 0.75}};
  const admitted = validateDecision(d, context());
  assert.deepEqual(admitted, d);
  d.move.x = 50;
  assert.equal(admitted.move.x, 1);
});

const invalid = [
  ['extra authority', {...idle(), author: 'victim'}],
  ['missing slot', {move: null, communication: null, role: null}],
  ['teleport', {...idle(), move: {x: 500, y: 500}}],
  ['nonfinite coordinate', {...idle(), move: {x: NaN, y: 2}}],
  ['extra coordinate field', {...idle(), move: {x: 1, y: 2, token: 'x'}}],
  ['foreign diary', {...idle(), diary: {subject: 'foreign', observation: 'keptAPromise', reading: 'cantTellYet', context: null}}],
  ['self reference', {...idle(), communication: {kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: {kind: 'player', playerId: 'self'}, context: null}}],
  ['absent reference', {...idle(), communication: {kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent: {kind: 'player', playerId: 'absent'}, context: null}}],
  ['unknown vocabulary', {...idle(), communication: {kind: 'wallPost', state: 'invented'}}],
  ['free text', {...idle(), communication: {kind: 'wallPost', state: 'hopeful', text: 'arbitrary'}}],
  ['infinite price', {...idle(), role: {kind: 'bakerPrice', price: Infinity}}],
  ['negative price', {...idle(), role: {kind: 'bakerPrice', price: -1}}],
  ['price above ceiling', {...idle(), role: {kind: 'bakerPrice', price: 2.01}}],
  ['unsupported crime', {...idle(), role: {kind: 'arson', target: 'other'}}],
];
for (const [name, d] of invalid) test(`reject ${name}`, () => assert.equal(validateDecision(d, context()), null));

test('grid coordinate contract rejects fractional and unsafe coordinates', () => {
  for (const x of [0.5, Number.MAX_SAFE_INTEGER + 1, -0.25]) {
    assert.throws(() => policyInput({...context(), legalMoves:[{x,y:2}]}), /invalid_context/);
    assert.equal(validateDecision({...idle(), move:{x,y:2}}, context()), null);
  }
  assert.ok(validateDecision({...idle(), move:{x:1,y:2}}, context()));
});

test('role authority and Grifter limitations', () => {
  assert.equal(validateDecision({...idle(), role: {kind: 'bakerPrice', price: 1}}, {...context(), role: 'Miller'}), null);
  assert.equal(validateDecision({...idle(), communication: {kind: 'wallPost', state: 'hopeful'}}, {...context(), role: 'Grifter'}), null);
  assert.ok(validateDecision({...idle(), move: {x: 1, y: 2}}, {...context(), role: 'Grifter'}));
});

test('projection strips extra private fields and deeply detaches affordances', () => {
  const c = {...context(), observationId: 'secret', world: {seed: 99}, apiKey: 'fixture-secret'};
  const p = policyInput(c);
  assert.equal(JSON.stringify(p).includes('secret'), false);
  assert.equal(Object.hasOwn(p, 'world'), false);
  p.legalMoves[0].x = 800;
  assert.equal(c.legalMoves[0].x, 1);
});

test('live admission always fails and historical hold is immutable', () => {
  assert.throws(assertLiveAdmission, /recovery_accounting_unresolved/);
  assert.equal(RECOVERY_HOLD.originalReservationMicroUsd, 19114);
  assert.equal(RECOVERY_HOLD.originalActorRequests, 1);
  assert.equal(Object.isFrozen(RECOVERY_HOLD), true);
});

test('offline valid decision, duplicate attempt denied without second fixture call', async () => {
  const broker = new OfflineBroker(); let calls = 0;
  const fixture = async () => { calls++; return response(idle()); };
  assert.equal((await broker.evaluate(context(), fixture, context)).kind, 'validated_offline');
  assert.equal((await broker.evaluate(context(), fixture, context)).code, 'tick_already_attempted');
  assert.equal(calls, 1);
});

test('concurrent attempt rejected; later result discarded on tick change', async () => {
  const broker = new OfflineBroker(); let finish;
  const first = broker.evaluate(context(), () => new Promise(r => {finish = r;}), () => ({...context(), tick: 11}));
  assert.equal((await broker.evaluate(context(), async () => response(idle()), context)).code, 'in_flight');
  finish(response(idle()));
  assert.equal((await first).code, 'stale_context');
});

for (const changed of [{selfRef: 'replacement'}, {roleEpoch: 3}, {role: 'Miller'}]) {
  test(`discard changed identity/role ${JSON.stringify(changed)}`, async () => {
    assert.equal((await new OfflineBroker().evaluate(context(), async () => response(idle()), () => ({...context(), ...changed}))).code, 'stale_context');
  });
}

test('fixture cannot mutate trusted context or current affordances', async () => {
  const trusted = context();
  const broker = new OfflineBroker();
  const result = await broker.evaluate(trusted, async input => {
    input.legalMoves[0].x = 99;
    input.knownSubjects.push('forged');
    return response({...idle(), move: {x: 1, y: 2}});
  }, () => trusted);
  assert.equal(result.kind, 'validated_offline');
  assert.deepEqual(trusted.legalMoves, [{x: 1, y: 2}]);
  assert.deepEqual(trusted.knownSubjects, ['known']);
});

test('non-callable fixture and current callbacks fail closed without consumption', async () => {
  const broker = new OfflineBroker();
  assert.deepEqual(await broker.evaluate(context(), null, context), {kind:'rejected',code:'invalid_callback'});
  assert.deepEqual(await broker.evaluate(context(), async () => response(idle()), null), {kind:'rejected',code:'invalid_callback'});
  assert.equal((await broker.evaluate(context(), async () => response(idle()), context)).kind, 'validated_offline');
});

test('fixture cannot mutate validation snapshot; changed legal moves rejected', async () => {
  const fixture = async input => { input.legalMoves.push({x: 9, y: 9}); return response({...idle(), move: {x: 9, y: 9}}); };
  assert.equal((await new OfflineBroker().evaluate(context(), fixture, context)).code, 'invalid_decision');
  assert.equal((await new OfflineBroker().evaluate(context(), async () => response({...idle(), move: {x: 1, y: 2}}), () => ({...context(), legalMoves: []}))).code, 'stale_context');
});

for (const bad of [{status: 'incomplete'}, {model: 'wrong'}, {inputTokens: -1}, {outputTokens: 2049}, {inputTokens: NaN}]) {
  test(`provider contract rejected ${JSON.stringify(bad)}`, async () => {
    assert.equal((await new OfflineBroker().evaluate(context(), async () => ({...response(idle()), ...bad}), context)).code, 'invalid_response');
  });
}

test('fixture timeout aborts signal, returns no decision and permits no same-tick retry', async () => {
  const broker = new OfflineBroker(); let signal;
  const result = await broker.evaluate(context(), async (_, s) => { signal = s; return new Promise(() => {}); }, context,
    {model: 'offline-fixture', maxInputTokens: 100, maxOutputTokens: 100, deadlineMs: 10});
  assert.equal(result.code, 'fixture_timeout'); assert.equal(signal.aborted, true);
  assert.equal((await broker.evaluate(context(), async () => response(idle()), context)).code, 'fixture_halted');
  assert.equal((await broker.evaluate({...context(), tick: 11}, async () => response(idle()), context)).code, 'fixture_halted');
});

test('changed affordances reject an otherwise valid asynchronous decision', async () => {
  for (const changed of [
    {legalMoves: [{x: 2, y: 2}]},
    {presentRefs: []},
    {knownSubjects: []},
  ]) {
    const broker = new OfflineBroker();
    const result = await broker.evaluate(context(), async () => response(idle()), () => ({...context(), ...changed}));
    assert.deepEqual(result, {kind: 'rejected', code: 'stale_context'});
  }
});

test('fixture exception is sanitized and cannot trigger retry', async () => {
  const broker = new OfflineBroker();
  assert.deepEqual(await broker.evaluate(context(), async () => {throw Error('private-provider-body');}, context), {kind: 'rejected', code: 'fixture_failure'});
  assert.equal((await broker.evaluate(context(), async () => response(idle()), context)).code, 'fixture_halted');
  assert.equal((await broker.evaluate({...context(), tick: 11}, async () => response(idle()), context)).code, 'fixture_halted');
});

test('oversized input and widened bounds denied before fixture invocation', async () => {
  let calls = 0;
  const fixture = async () => { calls++; return response(idle()); };
  const huge = {...context(), knownSubjects: ['x'.repeat(32768)]};
  assert.equal((await new OfflineBroker().evaluate(huge, fixture, context)).code, 'invalid_bounds');
  assert.equal((await new OfflineBroker().evaluate(context(), fixture, context,
    {model: 'offline-fixture', maxInputTokens: 36864, maxOutputTokens: 2049, deadlineMs: 12000})).code, 'invalid_bounds');
  assert.equal(calls, 0);
});

test('invalid trusted context fails closed without invoking fixture', async () => {
  let calls = 0;
  const result = await new OfflineBroker().evaluate({...context(), tick: NaN}, async () => {calls++; return response(idle());}, context);
  assert.equal(result.code, 'invalid_context'); assert.equal(calls, 0);
});

test('room/player speech and exact price boundaries are accepted', () => {
  for (const referent of [{kind: 'room'}, {kind: 'player', playerId: 'other'}]) {
    assert.ok(validateDecision({...idle(), communication: {kind: 'proximityUtterance', intent: 'ask', tone: 'warm', referent, context: null}}, context()));
  }
  for (const price of [0, 2]) assert.ok(validateDecision({...idle(), role: {kind: 'bakerPrice', price}}, context()));
});

test('bounded UTF-8 JSON across chunks', async () => {
  const bytes = Buffer.from('{"value":"£"}');
  const body = Readable.from([bytes.subarray(0, 11), bytes.subarray(11)]);
  assert.deepEqual(await readBoundedJson(body, 200), {value: '£'});
});

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status}: asynchronous destroy error is handled without decoding error text`, async () => {
    const body = new Readable({read() {}, destroy(_, callback) { setImmediate(() => callback(Error('private-body'))); }});
    await assert.rejects(readBoundedJson(body, status), /^Error: http_rejected$/);
    await new Promise(r => setImmediate(r));
    assert.equal(body.destroyed, true);
  });
}

test('overflow, malformed JSON, early close and stalled body rejected', async () => {
  await assert.rejects(readBoundedJson(Readable.from([Buffer.alloc(10)]), 200, 5), /body_too_large/);
  await assert.rejects(readBoundedJson(Readable.from(['{invalid']), 200), /body_json/);
  const early = new Readable({read() { this.destroy(); }});
  await assert.rejects(readBoundedJson(early, 200), /body_closed/);
  const stalled = new Readable({read() {}});
  await assert.rejects(readBoundedJson(stalled, 200, 100, 10), /body_timeout/);
  assert.equal(stalled.destroyed, true);
});
