import { constants, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync,
  mkdirSync, lstatSync, realpathSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const FILE = 'accounting.journal.json';
const LOCK = '.accounting.lock';
const RECOVERY = '.accounting.recovery.lock';
const NEXT = '.accounting.next';
const MAX_BYTES = 8 * 1024 * 1024;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export type AccountingWriteStage = 'before_write' | 'after_file_sync' | 'after_rename';
export interface AccountingStoreOptions {
  recoverStaleLock?: boolean;
  /** Mechanical fault injection, never a policy/model callback. */
  fault?: (stage: AccountingWriteStage) => void;
}
export class AccountingError extends Error {
  constructor(code: string) { super(code); this.name = 'AccountingError'; }
}
export const failAccounting = (code: string): never => { throw new AccountingError(code); };
const fail = failAccounting;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function safe(directory: string, path?: string): void {
  const stat = lstatSync(path ?? directory);
  const normalize = (s: string) => process.platform === 'win32' ? s.toLowerCase() : s;
  if (stat.isSymbolicLink() || (path ? !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES
    : !stat.isDirectory() || normalize(realpathSync(directory)) !== normalize(resolve(directory)))) fail('accounting_unsafe_path');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('accounting_permissions');
}
function syncDirectory(directory: string): void {
  // NTFS ACL enforcement and Windows power-loss durability are not implied.
  if (process.platform === 'win32') return;
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Private, checksummed, single-writer journal. Missing state never initializes on open. */
export class AccountingStore<T> {
  #directory: string;
  #identity: string;
  #value: T;
  #bytes: string | null;
  #closed = false;
  #poisoned = false;
  private constructor(directory: string, identity: string, value: T, bytes: string | null,
    private validate: (value: unknown) => T, private options: AccountingStoreOptions) {
    this.#directory = resolve(directory); this.#identity = identity; this.#value = value; this.#bytes = bytes;
  }
  static #lock(directory: string, recover: boolean): string {
    const path = join(directory, LOCK), guardPath = join(directory, RECOVERY);
    const identity = JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString('hex') });
    let guarded = false;
    try {
      if (existsSync(path) && recover) {
        const guard = openSync(guardPath, 'wx', 0o600); guarded = true;
        try { writeFileSync(guard, identity); fsyncSync(guard); } finally { closeSync(guard); }
        safe(directory, path); const prior = readFileSync(path, 'utf8'); let owner: unknown;
        try { owner = JSON.parse(prior); } catch { return fail('accounting_lock_invalid'); }
        if (!object(owner) || Object.keys(owner).length !== 2 || !Number.isSafeInteger(owner.pid) || Number(owner.pid) < 1 ||
          typeof owner.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(owner.nonce)) return fail('accounting_lock_invalid');
        let dead = false;
        try { process.kill(owner.pid as number, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
        if (!dead || readFileSync(path, 'utf8') !== prior) return fail('accounting_locked');
        unlinkSync(path);
      }
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, identity); fsyncSync(fd); } finally { closeSync(fd); }
      return identity;
    } finally {
      if (guarded) {
        safe(directory, guardPath);
        if (readFileSync(guardPath, 'utf8') !== identity) fail('accounting_recovery_changed');
        unlinkSync(guardPath); syncDirectory(directory);
      }
    }
  }
  static create<T>(directory: string, initial: T, validate: (value: unknown) => T, options: AccountingStoreOptions = {}): AccountingStore<T> {
    const value = validate(structuredClone(initial));
    mkdirSync(directory, { mode: 0o700 }); safe(directory);
    const identity = this.#lock(directory, false);
    const store = new AccountingStore(directory, identity, value, null, validate, options);
    try { store.commit(value); return store; } catch (error) { store.close(); throw error; }
  }
  static open<T>(directory: string, validate: (value: unknown) => T, options: AccountingStoreOptions = {}): AccountingStore<T> {
    safe(directory); const identity = this.#lock(directory, options.recoverStaleLock === true);
    try {
      const path = join(directory, FILE); safe(directory, path);
      const bytes = readFileSync(path, 'utf8'); let envelope: unknown;
      try { envelope = JSON.parse(bytes); } catch { return fail('accounting_encoding'); }
      if (!object(envelope) || Object.keys(envelope).length !== 3 || envelope.format !== 'node-accounting-journal-v1' ||
        typeof envelope.payload !== 'string' || sha256(envelope.payload) !== envelope.sha256) return fail('accounting_checksum');
      let document: unknown;
      try { document = JSON.parse(envelope.payload); } catch { return fail('accounting_encoding'); }
      const value = validate(document);
      const next = join(directory, NEXT);
      if (existsSync(next)) { safe(directory, next); renameSync(next, join(directory, `.accounting.orphan-${randomBytes(12).toString('hex')}`)); syncDirectory(directory); }
      return new AccountingStore(directory, identity, value, bytes, validate, options);
    } catch (error) {
      safe(directory, join(directory, LOCK));
      if (readFileSync(join(directory, LOCK), 'utf8') === identity) unlinkSync(join(directory, LOCK));
      throw error;
    }
  }
  #guard(): void {
    if (this.#closed || this.#poisoned) fail('accounting_unavailable');
    try {
      safe(this.#directory); const lock = join(this.#directory, LOCK); safe(this.#directory, lock);
      if (readFileSync(lock, 'utf8') !== this.#identity) fail('accounting_lock_changed');
      if (this.#bytes !== null) {
        const path = join(this.#directory, FILE); safe(this.#directory, path);
        if (readFileSync(path, 'utf8') !== this.#bytes) fail('accounting_changed');
      }
    } catch { this.#poisoned = true; fail('accounting_unavailable'); }
  }
  current(): T { this.#guard(); return structuredClone(this.#value); }
  commit(value: T): void {
    this.#guard(); const checked = this.validate(structuredClone(value));
    try {
      const path = join(this.#directory, FILE);
      if (this.#bytes === null && existsSync(path)) fail('accounting_already_exists');
      const payload = JSON.stringify(checked);
      const bytes = JSON.stringify({ format: 'node-accounting-journal-v1', payload, sha256: sha256(payload) });
      if (Buffer.byteLength(bytes) > MAX_BYTES) fail('accounting_full');
      this.options.fault?.('before_write');
      const next = join(this.#directory, NEXT), fd = openSync(next, 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); this.options.fault?.('after_file_sync'); } finally { closeSync(fd); }
      renameSync(next, path); syncDirectory(this.#directory); this.options.fault?.('after_rename');
      this.#value = checked; this.#bytes = bytes;
    } catch { this.#poisoned = true; fail('accounting_write_failed'); }
  }
  close(): void {
    if (this.#closed) return; this.#closed = true;
    const path = join(this.#directory, LOCK);
    if (existsSync(path)) {
      safe(this.#directory, path);
      if (readFileSync(path, 'utf8') !== this.#identity) fail('accounting_lock_changed');
      unlinkSync(path); syncDirectory(this.#directory);
    }
  }
}
