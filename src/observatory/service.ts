/**
 * Shared observatory state: one tailer and one world projection per registered experiment, and
 * one display cursor per experiment that every client (web panels and Godot) follows.
 *
 * Polling reads files; it never writes them, never calls a provider and never steps a running
 * host. A client connecting, reconnecting, replaying or changing the displayed tick changes only
 * this in-memory display state.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { validateEvaluationRecord, type EvaluationRecord, type ExperimentRegistration, type ObservatoryEvent } from './contracts.js';
import { ObservatoryExperiment } from './ledgerTail.js';
import { WorldProjection } from './worldProjection.js';

export interface Display { mode: 'live_following' | 'replay'; tick: number | null }
export interface RunHandle {
  experiment: ObservatoryExperiment;
  projection: WorldProjection;
  display: Display;
  listeners: Set<(change: RunChange) => void>;
}
export type RunChange = { kind: 'events'; events: ObservatoryEvent[] } | { kind: 'display'; tick: number; mode: Display['mode'] } | { kind: 'error'; error: string };

export class ObservatoryService {
  readonly runs = new Map<string, RunHandle>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(registrations: readonly ExperimentRegistration[]) {
    for (const r of registrations) {
      const experiment = new ObservatoryExperiment(r);
      if (this.runs.has(experiment.registration.experimentId)) throw Error('observatory_duplicate_experiment');
      this.runs.set(experiment.registration.experimentId, { experiment, projection: new WorldProjection(experiment),
        display: { mode: 'live_following', tick: null }, listeners: new Set() });
    }
    for (const id of this.runs.keys()) this.refresh(id);
  }

  run(id: string): RunHandle {
    const r = this.runs.get(id);
    if (!r) throw Error('observatory_unknown_run');
    return r;
  }

  /** Read new complete records; publish frames only for committed transitions. */
  refresh(id: string): ObservatoryEvent[] {
    const r = this.run(id), hadError = r.experiment.error;
    const added = r.experiment.refresh();
    if (r.experiment.error && !hadError) { this.#emit(r, { kind: 'error', error: r.experiment.error }); return []; }
    if (added.length) {
      try { r.projection.sync(); } catch (error) { this.#emit(r, { kind: 'error', error: (error as Error).message }); }
      this.#emit(r, { kind: 'events', events: added });
      if (r.display.mode === 'live_following') this.#emit(r, { kind: 'display', tick: this.displayedTick(id), mode: 'live_following' });
    }
    return added;
  }

  displayedTick(id: string): number {
    const r = this.run(id), latest = r.projection.latestTick();
    return r.display.mode === 'replay' && r.display.tick !== null ? Math.min(r.display.tick, latest) : latest;
  }

  setDisplay(id: string, display: Display): Display {
    const r = this.run(id), latest = r.projection.latestTick();
    if (display.mode === 'replay') {
      if (!Number.isSafeInteger(display.tick) || display.tick! < 0 || display.tick! > latest) throw Error('observatory_display_tick');
      r.display = { mode: 'replay', tick: display.tick };
    } else if (display.mode === 'live_following') r.display = { mode: 'live_following', tick: null };
    else throw Error('observatory_display_mode');
    this.#emit(r, { kind: 'display', tick: this.displayedTick(id), mode: r.display.mode });
    return { ...r.display };
  }

  subscribe(id: string, listener: (change: RunChange) => void): () => void {
    const r = this.run(id);
    r.listeners.add(listener);
    return () => r.listeners.delete(listener);
  }
  #emit(r: RunHandle, change: RunChange) { for (const l of [...r.listeners]) { try { l(change); } catch { /* a client never blocks the poll */ } } }

  /** Separately produced evaluation records. Malformed records are counted and refused, never shown. */
  evaluations(id: string): { records: EvaluationRecord[]; rejected: number } {
    const r = this.run(id), records: EvaluationRecord[] = [];
    let rejected = 0;
    for (const path of r.experiment.registration.evaluations ?? []) {
      if (!existsSync(path) || !lstatSync(path).isFile()) { rejected++; continue; }
      for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
        try {
          const rec = validateEvaluationRecord(JSON.parse(line));
          if (rec.experimentId !== id) { rejected++; continue; }
          records.push(rec);
        } catch { rejected++; }
      }
    }
    return { records, rejected };
  }

  start(pollMs = 1000) {
    if (this.#timer) return;
    this.#timer = setInterval(() => { for (const id of this.runs.keys()) this.refresh(id); }, pollMs);
    this.#timer.unref?.();
  }
  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
