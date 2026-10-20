import { constants, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync,
  mkdirSync, lstatSync, realpathSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const FILE = 'synthetic-budget.json';
const LOCK = '.synthetic-budget.lock';
const RECOVERY = '.synthetic-budget.recovery.lock';
const NEXT = '.synthetic-budget.next';
const FORMAT = 'node-synthetic-spend-fixture-v1';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 30_000;
export type SyntheticWriteStage = 'before_write' | 'after_file_sync' | 'after_rename';
export interface SyntheticBudgetOptions {
  recoverStaleLock?: boolean;
  /** Trusted mechanical fault injection only. */
  fault?: (stage: SyntheticWriteStage) => void;
}
export interface SyntheticLimits { totalMicroUsd: number; maxRequests: number }
type Event = { kind: 'reserve'; id: string; ceilingMicroUsd: number }
  | { kind: 'settle'; id: string; actualMicroUsd: number }
  | { kind: 'uncertain'; id: string };
interface Document {
  version: 1;
  scope: 'synthetic-only';
  fixtureId: string;
  limits: SyntheticLimits;
  events: Event[];
}
export interface SyntheticRequest {
  id: string;
  ceilingMicroUsd: number;
  status: 'reserved' | 'uncertain' | 'settled';
  actualMicroUsd: number | null;
}
export interface SyntheticBudgetView {
  scope: 'synthetic-only';
  fixtureId: string;
  limits: SyntheticLimits;
  requestCount: number;
  spentMicroUsd: bigint;
  heldMicroUsd: bigint;
  remainingMicroUsd: bigint;
  activeRequest: string | null;
  halt: null | 'over_reservation';
  requests: SyntheticRequest[];
}
export class SyntheticBudgetError extends Error {
  constructor(code: string) { super(code); this.name = 'SyntheticBudgetError'; }
}
const fail = (code: string): never => { throw new SyntheticBudgetError(code); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const checksum = (value: string) => createHash('sha256').update(value).digest('hex');

function derive(value: unknown): SyntheticBudgetView {
  if (!object(value) || !exact(value, ['version', 'scope', 'fixtureId', 'limits', 'events']) || value.version !== 1 ||
      value.scope !== 'synthetic-only' || typeof value.fixtureId !== 'string' || !/^fixture-[A-Za-z0-9._-]{1,72}$/.test(value.fixtureId) ||
      !object(value.limits) || !exact(value.limits, ['totalMicroUsd', 'maxRequests']) ||
      !integer(value.limits.totalMicroUsd) || value.limits.totalMicroUsd < 1 || !integer(value.limits.maxRequests) ||
      value.limits.maxRequests < 1 || value.limits.maxRequests > 10_000 || !Array.isArray(value.events) || value.events.length > MAX_EVENTS) {
    return fail('synthetic_budget_schema');
  }
  const limits = value.limits as unknown as SyntheticLimits;
  const requests = new Map<string, SyntheticRequest>();
  let spent = 0n;
  let active: string | null = null;
  let halt: SyntheticBudgetView['halt'] = null;
  for (const event of value.events) {
    if (!object(event) || !id(event.id)) return fail('synthetic_budget_event');
    const prior = requests.get(event.id);
    if (event.kind === 'reserve') {
      if (!exact(event, ['kind', 'id', 'ceilingMicroUsd']) || !integer(event.ceilingMicroUsd) || event.ceilingMicroUsd < 1 ||
          prior || active !== null || halt || requests.size >= limits.maxRequests || spent + BigInt(event.ceilingMicroUsd) > BigInt(limits.totalMicroUsd)) {
        return fail('synthetic_budget_event');
      }
      requests.set(event.id, { id: event.id, ceilingMicroUsd: event.ceilingMicroUsd, status: 'reserved', actualMicroUsd: null });
      active = event.id;
    } else if (event.kind === 'uncertain') {
      if (!exact(event, ['kind', 'id']) || !prior || prior.status !== 'reserved' || active !== event.id) return fail('synthetic_budget_event');
      prior.status = 'uncertain';
    } else if (event.kind === 'settle') {
      if (!exact(event, ['kind', 'id', 'actualMicroUsd']) || !integer(event.actualMicroUsd) || !prior ||
          prior.status === 'settled' || active !== event.id) return fail('synthetic_budget_event');
      prior.status = 'settled'; prior.actualMicroUsd = event.actualMicroUsd;
      spent += BigInt(event.actualMicroUsd);
      if (event.actualMicroUsd > prior.ceilingMicroUsd) halt = 'over_reservation';
      active = null;
    } else return fail('synthetic_budget_event');
  }
  const held = active === null ? 0n : BigInt(requests.get(active)!.ceilingMicroUsd);
  return { scope: 'synthetic-only', fixtureId: value.fixtureId, limits: { ...limits }, requestCount: requests.size,
    spentMicroUsd: spent, heldMicroUsd: held, remainingMicroUsd: BigInt(limits.totalMicroUsd) - spent - held,
    activeRequest: active, halt, requests: [...requests.values()] };
}

function directorySafe(directory: string): void {
  const stat = lstatSync(directory);
  const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(realpathSync(directory)) !== normalize(resolve(directory))) fail('synthetic_budget_directory');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('synthetic_budget_permissions');
}
function fileSafe(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) fail('synthetic_budget_file');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('synthetic_budget_permissions');
}
function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return; // Process-crash protection, not a Windows power-loss guarantee.
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function read(directory: string, expectedFixtureId: string): { document: Document; bytes: string } {
  directorySafe(directory); const path = join(directory, FILE); fileSafe(path);
  const bytes = readFileSync(path, 'utf8'); let envelope: unknown;
  try { envelope = JSON.parse(bytes); } catch { return fail('synthetic_budget_encoding'); }
  if (!object(envelope) || !exact(envelope, ['format', 'payload', 'checksum']) || envelope.format !== FORMAT ||
      typeof envelope.payload !== 'string' || typeof envelope.checksum !== 'string' || checksum(envelope.payload) !== envelope.checksum) {
    return fail('synthetic_budget_checksum');
  }
  let document: unknown;
  try { document = JSON.parse(envelope.payload); } catch { return fail('synthetic_budget_encoding'); }
  const view = derive(document);
  if (view.fixtureId !== expectedFixtureId) return fail('synthetic_budget_fixture_mismatch');
  return { document: document as Document, bytes };
}

/** A synthetic fixture journal only. No real-account initialization, import, reconciliation or live admission. */
export class SyntheticBudgetLedger {
  #directory: string;
  #document: Document;
  #bytes: string | null;
  #identity: string;
  #closed = false;
  #poisoned = false;
  #fault?: SyntheticBudgetOptions['fault'];
  private constructor(directory: string, document: Document, bytes: string | null, identity: string, options: SyntheticBudgetOptions) {
    this.#directory = resolve(directory); this.#document = document; this.#bytes = bytes; this.#identity = identity; this.#fault = options.fault;
  }
  static #lock(directory: string, recover: boolean): string {
    const path = join(directory, LOCK);
    const identity = JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString('hex') });
    const recoveryPath = join(directory, RECOVERY);
    let recoveryOwned = false;
    try {
      if (existsSync(path) && recover) {
        // Only one reaper may inspect/remove a dead owner's lock. A recovery marker
        // left by a crash is never automatically reclaimed or treated as permission.
        const guard = openSync(recoveryPath, 'wx', 0o600); recoveryOwned = true;
        try { writeFileSync(guard, identity); fsyncSync(guard); } finally { closeSync(guard); }
        fileSafe(path); const bytes = readFileSync(path, 'utf8'); let owner: unknown;
        try { owner = JSON.parse(bytes); } catch { return fail('synthetic_budget_lock'); }
        if (!object(owner) || !exact(owner, ['pid', 'nonce']) || !integer(owner.pid) || owner.pid < 1 ||
            typeof owner.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(owner.nonce)) return fail('synthetic_budget_lock');
        let dead = false;
        try { process.kill(owner.pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
        if (!dead || readFileSync(path, 'utf8') !== bytes) return fail('synthetic_budget_locked');
        unlinkSync(path);
      }
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, identity); fsyncSync(fd); } finally { closeSync(fd); }
      return identity;
    } finally {
      if (recoveryOwned) {
        fileSafe(recoveryPath);
        if (readFileSync(recoveryPath, 'utf8') !== identity) fail('synthetic_budget_recovery_changed');
        unlinkSync(recoveryPath); syncDirectory(directory);
      }
    }
  }
  static create(directory: string, fixtureId: string, limits: SyntheticLimits, options: SyntheticBudgetOptions = {}): SyntheticBudgetLedger {
    const document: Document = { version: 1, scope: 'synthetic-only', fixtureId, limits: structuredClone(limits), events: [] };
    derive(document);
    mkdirSync(directory, { mode: 0o700 }); directorySafe(directory);
    const identity = this.#lock(directory, false);
    const ledger = new SyntheticBudgetLedger(directory, document, null, identity, options);
    try { ledger.#publish(document); return ledger; } catch { ledger.close(); return fail('synthetic_budget_create_failed'); }
  }
  static open(directory: string, expectedFixtureId: string, options: SyntheticBudgetOptions = {}): SyntheticBudgetLedger {
    directorySafe(directory);
    const identity = this.#lock(directory, options.recoverStaleLock === true);
    let ledger: SyntheticBudgetLedger | undefined;
    try {
      const prior = read(directory, expectedFixtureId);
      ledger = new SyntheticBudgetLedger(directory, prior.document, prior.bytes, identity, options);
      const next = join(directory, NEXT);
      if (existsSync(next)) {
        fileSafe(next); renameSync(next, join(directory, `.synthetic-budget.orphan-${randomBytes(12).toString('hex')}`)); syncDirectory(directory);
      }
      return ledger;
    } catch (error) {
      if (ledger) ledger.close();
      else if (readFileSync(join(directory, LOCK), 'utf8') === identity) unlinkSync(join(directory, LOCK));
      throw error;
    }
  }
  #guard(): void { if (this.#closed || this.#poisoned) fail('synthetic_budget_unavailable'); }
  view(): SyntheticBudgetView { this.#guard(); return derive(this.#document); }
  #publish(document: Document): void {
    this.#guard(); derive(document);
    try {
      directorySafe(this.#directory);
      fileSafe(join(this.#directory, LOCK));
      if (readFileSync(join(this.#directory, LOCK), 'utf8') !== this.#identity) fail('synthetic_budget_lock_changed');
      const path = join(this.#directory, FILE);
      if (this.#bytes === null) { if (existsSync(path)) fail('synthetic_budget_already_exists'); }
      else { fileSafe(path); if (readFileSync(path, 'utf8') !== this.#bytes) fail('synthetic_budget_changed'); }
      const payload = JSON.stringify(document);
      const bytes = JSON.stringify({ format: FORMAT, payload, checksum: checksum(payload) });
      if (Buffer.byteLength(bytes, 'utf8') > MAX_BYTES) fail('synthetic_budget_full');
      this.#fault?.('before_write');
      const next = join(this.#directory, NEXT); const fd = openSync(next, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); this.#fault?.('after_file_sync'); } finally { closeSync(fd); }
      renameSync(next, path); syncDirectory(this.#directory); this.#fault?.('after_rename');
      this.#document = structuredClone(document); this.#bytes = bytes;
    } catch { this.#poisoned = true; fail('synthetic_budget_write_failed'); }
  }
  #append(event: Event): SyntheticBudgetView {
    const document = structuredClone(this.#document); document.events.push(event); this.#publish(document); return this.view();
  }
  reserve(requestId: string, ceilingMicroUsd: number): 'reserved' | 'duplicate' {
    const view = this.view();
    if (!id(requestId) || !integer(ceilingMicroUsd) || ceilingMicroUsd < 1) return fail('synthetic_budget_reservation');
    const prior = view.requests.find(request => request.id === requestId);
    if (prior) {
      if (prior.ceilingMicroUsd !== ceilingMicroUsd) return fail('synthetic_budget_duplicate_mismatch');
      return 'duplicate';
    }
    if (view.halt) return fail('synthetic_budget_halted');
    if (view.activeRequest !== null) return fail('synthetic_budget_outstanding');
    if (view.requestCount >= view.limits.maxRequests) return fail('synthetic_budget_request_limit');
    if (BigInt(ceilingMicroUsd) > view.remainingMicroUsd) return fail('synthetic_budget_cost_limit');
    if (this.#document.events.length + 3 > MAX_EVENTS) return fail('synthetic_budget_full');
    this.#append({ kind: 'reserve', id: requestId, ceilingMicroUsd }); return 'reserved';
  }
  markUncertain(requestId: string): SyntheticBudgetView {
    const view = this.view(); const request = view.requests.find(item => item.id === requestId);
    if (!request || request.status === 'settled') return fail('synthetic_budget_request');
    return request.status === 'uncertain' ? view : this.#append({ kind: 'uncertain', id: requestId });
  }
  settle(requestId: string, actualMicroUsd: number): SyntheticBudgetView {
    const view = this.view(); const request = view.requests.find(item => item.id === requestId);
    if (!request || !integer(actualMicroUsd)) return fail('synthetic_budget_settlement');
    if (request.status === 'settled') {
      if (request.actualMicroUsd !== actualMicroUsd) return fail('synthetic_budget_settlement_conflict');
      return view;
    }
    return this.#append({ kind: 'settle', id: requestId, actualMicroUsd });
  }
  close(): void {
    if (this.#closed) return; this.#closed = true;
    const path = join(this.#directory, LOCK);
    if (existsSync(path)) {
      fileSafe(path); if (readFileSync(path, 'utf8') !== this.#identity) fail('synthetic_budget_lock_changed');
      unlinkSync(path); syncDirectory(this.#directory);
    }
  }
}
