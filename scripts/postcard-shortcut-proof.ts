/** Deterministic offline mechanics fixtures, not population or agent behaviour evidence.
 * The illustrative 2 White/hour rate is explicit; no world clock or default is activated. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { applyPostcardEvent, createPostcardState, POSTCARD_HOUR_MS, POSTCARD_TIERS,
  postcardAccrualDenominator, PostcardRuleError, type PostcardEvent, type PostcardState,
  type PostcardTier } from '../src/engine/postcards.js';
import { createPostcardTape, parsePostcardState, postcardStateHash, serializePostcardState,
  verifyPostcardTape, type PostcardTape } from '../src/engine/postcardReplay.js';
import { applyPostcardTransaction, upgradePostcardState, type PostcardAccount,
  type PostcardTransaction } from '../src/engine/postcardAccount.js';
import { createPostcardAccountTape, parsePostcardAccount, postcardAccountHash, serializePostcardAccount,
  verifyPostcardAccountTape, type PostcardAccountTape } from '../src/engine/postcardAccountReplay.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['src/engine/postcards.ts', 'src/engine/postcardReplay.ts', 'src/engine/postcardAccount.ts',
  'src/engine/postcardAccountReplay.ts', 'src/sim/rng.ts', 'scripts/postcard-shortcut-proof.ts'];
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const currentFiles = (): Record<string, string> => Object.fromEntries(files.map(file => [file, sha(readFileSync(join(root, file)))]));
const HOUR = POSTCARD_HOUR_MS, rate = { numerator: 2, denominator: 1 }, personId = 'postcard-shortcut-offline-proof';
const calibration = 'Explicit illustrative 2 White/hour from DESIGN_ADDENDUM_2026-08-07; no production rate or tick-to-hour mapping enabled.';
const fixtureSelection = 'Synthetic mechanical fixtures: seeds 4 (first bucket 0) and 5 (first bucket 4) deliberately cover success and loss; no agent or population behaviour is measured.';
const eligible = ['green', 'blue', 'purple'] as const;
const weights = { white: 1n, green: 5n, blue: 25n, purple: 125n, orange: 625n } as const;
interface Opening { tape: PostcardTape; snapshot: string }
interface Failure { name: string; event: unknown; errorCode: string; beforeHash: string; afterHash: string; drawCount: number }
interface Scenario {
  name: string;
  opening: Opening;
  tape: PostcardAccountTape;
  checkpoints: { afterEvents: number; snapshot: string }[];
  failures: Failure[];
}
interface Proof {
  format: 'node-postcard-shortcut-proof-v2';
  sourceRevision: string;
  sourceFiles: Record<string, string>;
  mode: 'offline_explicit_clock_fixture';
  providerCalls: 0;
  calibration: string;
  fixtureSelection: string;
  scenarios: Scenario[];
}

/** Every opening holding has a complete v1 accrual/claim/safe-fusion ledger. */
function opening(tier: PostcardTier, quantity: number): Opening {
  let state = createPostcardState(personId, rate, 0);
  const events: PostcardEvent[] = [];
  const submit = (event: PostcardEvent): void => { state = applyPostcardEvent(state, event).state; events.push(event); };
  const white = Number(weights[tier]) * quantity;
  while (state.held.white < white) {
    const count = Math.min(32, white - state.held.white);
    submit({ kind: 'claim', personId, atMs: state.clockMs + count * HOUR / 2 });
  }
  for (const lower of POSTCARD_TIERS) {
    if (lower === tier) break;
    while (state.held[lower] >= 5) submit({ kind: 'safeFusion', personId, atMs: state.clockMs, tier: lower });
  }
  if (state.held[tier] !== quantity) throw Error('postcard_shortcut_opening_quantity');
  return { tape: createPostcardTape(personId, rate, 0, events), snapshot: serializePostcardState(state) };
}
function clock(id: string, atMs: number): PostcardTransaction { return { kind: 'clock', id, personId, atMs }; }
function claim(id: string, atMs: number): PostcardTransaction { return { kind: 'claim', id, personId, atMs }; }
function roll(id: string, tier: PostcardTier, stake: number, atMs: number): PostcardTransaction {
  return { kind: 'shortcutFusion', id, personId, atMs, tier, stake };
}
function assertConservation(state: PostcardAccount): void {
  const held = POSTCARD_TIERS.reduce((sum, tier) => sum + BigInt(state.held[tier]) * weights[tier], 0n);
  const d = BigInt(state.rate.denominator) * BigInt(HOUR);
  const gross = (BigInt(state.clockMs) - BigInt(state.createdAtMs)) * BigInt(state.rate.numerator);
  if ((held + BigInt(state.burnedWhite)) * d + BigInt(state.unclaimedUnits) + BigInt(state.overflowUnits)
    !== gross + BigInt(state.issuedWhite) * d) throw Error('postcard_shortcut_independent_conservation');
}
function failures(state: PostcardAccount, entries: readonly { name: string; event: unknown }[]): Failure[] {
  return entries.map(({ name, event }) => {
    const beforeHash = postcardAccountHash(state), drawCount = state.drawCount;
    let errorCode: string | undefined;
    try { applyPostcardTransaction(state, event as PostcardTransaction); }
    catch (error) { if (!(error instanceof PostcardRuleError)) throw error; errorCode = error.code; }
    if (!errorCode) throw Error('postcard_shortcut_invalid_fixture_accepted');
    const afterHash = postcardAccountHash(state);
    if (beforeHash !== afterHash || state.drawCount !== drawCount) throw Error('postcard_shortcut_nonatomic_failure');
    return { name, event, errorCode, beforeHash, afterHash, drawCount };
  });
}
function scenario(name: string, start: Opening, seed: number, events: PostcardTransaction[], checkpointCounts: number[] = [],
  invalid: readonly { name: string; event: unknown }[] = []): Scenario {
  const origin = parsePostcardState(start.snapshot), tape = createPostcardAccountTape(origin, seed, events);
  const checkpoints = checkpointCounts.map(afterEvents => {
    const prefix = createPostcardAccountTape(origin, seed, events.slice(0, afterEvents));
    return { afterEvents, snapshot: serializePostcardAccount(verifyPostcardAccountTape(prefix).state) };
  });
  const state = verifyPostcardAccountTape(tape).state;
  if (serializePostcardState(origin) !== start.snapshot) throw Error('postcard_shortcut_v1_mutated');
  return { name, opening: start, tape, checkpoints, failures: failures(state, invalid) };
}
function buildScenarios(): Scenario[] {
  const starts = Object.fromEntries(eligible.map(tier => [tier, opening(tier, 5)])) as Record<typeof eligible[number], Opening>;
  const time = (start: Opening): number => start.tape.records.at(-1)?.event.atMs ?? 0;
  const orange = opening('orange', 1), orangeTime = time(orange);
  const result: Scenario[] = [scenario('v1-safe-orange-upgrade-and-held-year', orange, 4,
    [clock('held-year', orangeTime + 365 * 24 * HOUR)], [0])];
  for (const tier of eligible) {
    const start = starts[tier], atMs = time(start);
    for (let stake = 1; stake <= 4; stake++) {
      for (const outcome of ['success', 'loss'] as const) {
        const seed = outcome === 'success' ? 4 : 5;
        result.push(scenario(`${tier}-stake-${stake}-${outcome}`, start, seed,
          [roll(`${tier}-${stake}-${outcome}`, tier, stake, atMs)]));
      }
    }
    result.push(scenario(`${tier}-guaranteed-five-no-draw`, start, 4,
      [roll(`${tier}-guaranteed-five`, tier, 5, atMs)], [0]));
  }
  result.push(scenario('fractional-claim-and-capped-overflow', opening('white', 0), 4,
    [claim('one-millisecond', 1), claim('whole-hour', HOUR), clock('unclaimed-24-hours', 25 * HOUR),
      claim('collect-capped-buffer', 25 * HOUR)], [1, 3]));
  const purple = starts.purple, purpleTime = time(purple);
  const first = roll('resumable-first', 'purple', 1, purpleTime);
  result.push(scenario('seeded-prefix-reopen-and-delayed-duplicate', purple, 4,
    [first, clock('fractional-clock', purpleTime + 1), roll('resumable-second', 'purple', 2, purpleTime + 1),
      clock('later-clock', purpleTime + 24 * HOUR), first, claim('later-claim', purpleTime + 24 * HOUR),
      roll('resumable-third', 'purple', 1, purpleTime + 24 * HOUR)], [2, 5]));
  const green = starts.green, greenTime = time(green), original = roll('existing-id', 'green', 1, greenTime);
  const future = greenTime + HOUR;
  result.push(scenario('invalid-transactions-are-atomic', green, 5, [original], [1], [
    { name: 'white-has-no-shortcut', event: roll('bad-white', 'white', 1, future) },
    { name: 'orange-is-terminal', event: roll('bad-orange', 'orange', 1, future) },
    { name: 'mixed-tiers-not-defined', event: { ...roll('bad-mixed', 'green', 1, future), tier: ['green', 'blue'] } },
    { name: 'stake-zero', event: roll('bad-zero', 'green', 0, future) },
    { name: 'stake-six', event: roll('bad-six', 'green', 6, future) },
    { name: 'insufficient-held-cards', event: roll('bad-inventory', 'purple', 1, future) },
    { name: 'other-owner', event: { ...roll('bad-owner', 'green', 1, future), personId: 'another-person' } },
    { name: 'time-reversal', event: roll('bad-time', 'green', 1, greenTime - 1) },
    { name: 'untrusted-supplied-roll', event: { ...roll('bad-roll', 'green', 1, future), roll: 0 } },
    { name: 'conflicting-id', event: { ...original, stake: 2 } },
  ]));
  return result;
}
function buildProof(): Proof {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  return { format: 'node-postcard-shortcut-proof-v2', sourceRevision: revision + (dirty ? '-working-tree' : ''),
    sourceFiles: currentFiles(), mode: 'offline_explicit_clock_fixture', providerCalls: 0,
    calibration, fixtureSelection, scenarios: buildScenarios() };
}
function verifyProof(value: unknown) {
  const proof = value as Proof;
  const keys = ['format', 'sourceRevision', 'sourceFiles', 'mode', 'providerCalls', 'calibration', 'fixtureSelection', 'scenarios'];
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
    !isDeepStrictEqual(Object.keys(proof).sort(), keys.sort()) || proof.format !== 'node-postcard-shortcut-proof-v2' ||
    !/^[a-f0-9]{40}(?:-working-tree)?$/.test(proof.sourceRevision) ||
    proof.mode !== 'offline_explicit_clock_fixture' || proof.providerCalls !== 0 || proof.calibration !== calibration ||
    proof.fixtureSelection !== fixtureSelection || !isDeepStrictEqual(proof.sourceFiles, currentFiles()) ||
    !Array.isArray(proof.scenarios)) throw Error('postcard_shortcut_proof_source_or_format');
  const expected = buildScenarios();
  if (!isDeepStrictEqual(proof.scenarios, expected)) throw Error('postcard_shortcut_proof_fixed_fixture');
  const scenarios = proof.scenarios.map(item => {
    const origin = verifyPostcardTape(item.opening.tape).state, snapshot = parsePostcardState(item.opening.snapshot);
    if (postcardStateHash(origin) !== postcardStateHash(snapshot) || !isDeepStrictEqual(origin, item.tape.genesis.origin) ||
      origin.personId !== personId || origin.createdAtMs !== 0 || !isDeepStrictEqual(origin.rate, rate))
      throw Error('postcard_shortcut_proof_opening');
    const replay = verifyPostcardAccountTape(item.tape);
    for (const checkpoint of item.checkpoints) {
      if (!Number.isSafeInteger(checkpoint.afterEvents) || checkpoint.afterEvents < 0 || checkpoint.afterEvents > item.tape.records.length)
        throw Error('postcard_shortcut_checkpoint_index');
      let resumed = parsePostcardAccount(checkpoint.snapshot);
      const expectedHash = checkpoint.afterEvents === 0 ? item.tape.genesisHash : item.tape.records[checkpoint.afterEvents - 1]!.afterHash;
      if (postcardAccountHash(resumed) !== expectedHash) throw Error('postcard_shortcut_checkpoint_hash');
      for (const record of item.tape.records.slice(checkpoint.afterEvents)) resumed = applyPostcardTransaction(resumed, record.event).state;
      if (postcardAccountHash(resumed) !== replay.finalHash) throw Error('postcard_shortcut_checkpoint_resume');
    }
    const checkedFailures = failures(replay.state, item.failures.map(({ name, event }) => ({ name, event })));
    if (!isDeepStrictEqual(checkedFailures, item.failures)) throw Error('postcard_shortcut_failure_receipt');
    const state = replay.state;
    assertConservation(state);
    if (!isDeepStrictEqual(state.origin, origin) || serializePostcardState(origin) !== item.opening.snapshot)
      throw Error('postcard_shortcut_origin_retention');
    return { name: item.name, legacyEvents: item.opening.tape.records.length, events: replay.events,
      receipts: state.transactions.length, drawCount: state.drawCount, issuedWhite: state.issuedWhite, burnedWhite: state.burnedWhite,
      held: state.held, unclaimedUnits: state.unclaimedUnits, overflowUnits: state.overflowUnits,
      unitDenominator: postcardAccrualDenominator(state.rate).toString(),
      checkpointsReopened: item.checkpoints.length, atomicFailures: checkedFailures.length,
      duplicateRecords: item.tape.records.filter(record => record.duplicate).length, finalHash: replay.finalHash };
  });
  return { verified: true, sourceRevision: proof.sourceRevision, providerCalls: 0,
    evidence: 'synthetic_mechanical_fixtures_not_agent_behaviour', scenarios };
}

const { values } = parseArgs({ options: { output: { type: 'string' }, verify: { type: 'string' } } });
if (Boolean(values.output) === Boolean(values.verify)) throw Error('postcard_shortcut_proof_output_or_verify_required');
if (values.verify) {
  const bytes = readFileSync(resolve(values.verify));
  if (bytes.length > 128 * 1024 * 1024) throw Error('postcard_shortcut_proof_bounds');
  console.log(JSON.stringify(verifyProof(JSON.parse(bytes.toString('utf8'))), null, 2));
} else {
  const path = resolve(values.output!);
  if (existsSync(path)) throw Error('postcard_shortcut_proof_output_exists');
  const proof = buildProof(), verified = verifyProof(proof);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...verified, output: path }, null, 2));
}
