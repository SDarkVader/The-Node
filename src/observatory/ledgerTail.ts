import { lstatSync, readFileSync } from 'node:fs';
import type { ContinuationEvent } from '../eval/continuationLedger.js';
import { recoverExperiment } from './recovery.js';

/** Read-only complete-line tail. Never truncates or repairs evidence. A rewritten prefix
 * poisons this reader until the operator explicitly registers the source again. */
export class LedgerTail {
  #prefix = Buffer.alloc(0);
  #events: ContinuationEvent[] = [];
  #failure = false;
  #verified: ReturnType<typeof recoverExperiment> | null = null;
  constructor(readonly path: string, readonly sourceRevision: string) {}
  get verified(): ReturnType<typeof recoverExperiment> | null { return this.#verified; }
  read(): readonly ContinuationEvent[] {
    if (this.#failure) throw Error('observatory_source_diverged');
    try {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw Error('observatory_source_bounds');
      const bytes = readFileSync(this.path);
      if (bytes.length < this.#prefix.length || !bytes.subarray(0, this.#prefix.length).equals(this.#prefix)) throw Error('observatory_source_diverged');
      const end = bytes.lastIndexOf(10) + 1;
      if (end === this.#prefix.length) return this.#events;
      if (end === 0) return this.#events;
      const prefix = bytes.subarray(0, end);
      const events: ContinuationEvent[] = prefix.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
      const verified = recoverExperiment(events, this.sourceRevision);
      this.#prefix = Buffer.from(prefix); this.#events = events;
      this.#verified = verified;
      return this.#events;
    } catch (error) {
      if (!this.#prefix.length && (error as NodeJS.ErrnoException).code === 'ENOENT') return this.#events;
      this.#failure = true; throw error;
    }
  }
}
