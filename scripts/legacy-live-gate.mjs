/**
 * The historical provider contexts include implementation paths, experiment controls and
 * technical world metadata. Keep their exact builders and replay verifiers for the archived
 * experiments, but prevent new real dispatch until a paid adapter uses the society boundary.
 * There is deliberately no environment flag or owner-approval switch that bypasses this gate.
 * The current supervised society CLI accepts JSON locally and never contacts a provider.
 */
export const LEGACY_LIVE_DISPATCH_ERROR = 'legacy_live_context_security_gate_closed';
export function assertLegacyLiveDispatchClosed() {
  throw new Error(LEGACY_LIVE_DISPATCH_ERROR + ': historical contexts are replay-only; '
    + 'a paid adapter must use the society information boundary. '
    + 'Supervised local play: npm run society -- --interactive --ticks 3');
}
