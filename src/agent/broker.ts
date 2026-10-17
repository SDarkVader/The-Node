import { policyInput, validateDecision, type DecisionContext, type Decision } from './protocol.js';

export const RECOVERY_HOLD = Object.freeze({
  originalReservationMicroUsd: 19_114,
  originalActorRequests: 1,
  totalDiagnosticAdmissionsRecordedInHandover: 9,
  accountingReconciled: false,
});

// No provider adapter, credentials, HTTP requests, ledger initialization or live
// entrypoint exists in this reconstruction. This is an unconditional closed gate.
export function assertLiveAdmission(): never { throw new Error('recovery_accounting_unresolved'); }

export interface FixtureResponse {
  status: 'completed';
  model: string;
  inputTokens: number;
  outputTokens: number;
  decision: unknown;
}
export type Outcome =
  | { kind: 'validated_offline'; decision: Decision }
  | { kind: 'rejected'; code: string };

/** Only an offline contract harness, not connected to the game or a live provider. */
export class OfflineBroker {
  private busy = false;
  private halted = false;
  private consumed = new Set<string>();

  async evaluate(
    context: DecisionContext,
    fixture: (input: DecisionContext, signal: AbortSignal) => Promise<FixtureResponse>,
    current: () => DecisionContext,
    bounds = { model: 'offline-fixture', maxInputTokens: 36_864, maxOutputTokens: 2_048, deadlineMs: 12_000 },
  ): Promise<Outcome> {
    if (this.halted) return { kind: 'rejected', code: 'fixture_halted' };
    if (typeof fixture !== 'function' || typeof current !== 'function') return { kind: 'rejected', code: 'invalid_callback' };
    if (this.busy) return { kind: 'rejected', code: 'in_flight' };
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const input = policyInput(context);
      const identity = JSON.stringify([input.selfRef, input.tick]);
      if (this.consumed.has(identity)) return { kind: 'rejected', code: 'tick_already_attempted' };
      if (!bounds.model || ![bounds.maxInputTokens, bounds.maxOutputTokens, bounds.deadlineMs].every(n => Number.isSafeInteger(n) && n > 0) ||
          bounds.maxInputTokens > 36_864 || bounds.maxOutputTokens > 2_048 || bounds.deadlineMs > 12_000 ||
          Buffer.byteLength(JSON.stringify(input), 'utf8') > 32_768) {
        return { kind: 'rejected', code: 'invalid_bounds' };
      }
      // Snapshot before invoking a caller callback. Neither callback gets the snapshot.
      const snapshot = structuredClone(input);
      this.consumed.add(identity);
      let timedOut = false;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('deadline')); }, bounds.deadlineMs);
      });
      let result: FixtureResponse;
      try { result = await Promise.race([fixture(structuredClone(input), controller.signal), timeout]); }
      catch {
        // Aborting does not prove a callback stopped. Never overlap a later fixture
        // with a timed-out callback that ignored cancellation.
        // A rejecting callback may have launched work before failing. Its
        // termination cannot be established from a rejected promise alone.
        this.halted = true;
        return { kind: 'rejected', code: timedOut ? 'fixture_timeout' : 'fixture_failure' };
      }
      if (!result || result.status !== 'completed' || result.model !== bounds.model ||
          !Number.isSafeInteger(result.inputTokens) || result.inputTokens < 0 || result.inputTokens > bounds.maxInputTokens ||
          !Number.isSafeInteger(result.outputTokens) || result.outputTokens < 0 || result.outputTokens > bounds.maxOutputTokens) {
        return { kind: 'rejected', code: 'invalid_response' };
      }
      const now = policyInput(current());
      if (now.tick !== snapshot.tick || now.selfRef !== snapshot.selfRef || now.role !== snapshot.role || now.roleEpoch !== snapshot.roleEpoch) {
        return { kind: 'rejected', code: 'stale_context' };
      }
      const decision = validateDecision(result.decision, snapshot);
      // Revalidate current affordances too; never retarget a stale proposal.
      if (!decision || !validateDecision(decision, now)) return { kind: 'rejected', code: 'invalid_decision' };
      return { kind: 'validated_offline', decision };
    } catch { return { kind: 'rejected', code: 'invalid_context' }; }
    finally { clearTimeout(timer); controller.abort(); this.busy = false; }
  }
}
