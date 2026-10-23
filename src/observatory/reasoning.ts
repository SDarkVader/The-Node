/**
 * A2 — reasoning and observation presentation (observatory handover, 2026-10-23).
 *
 * Reasoning: exactly the provider-returned summaries the existing reader recorded, with their
 * source and status. Signatures, signature hashes and redacted payloads are withheld; a
 * redacted block is shown only as a count. Nothing is summarized, completed or reconstructed.
 * The provider returns a whole response, so a request is `pending` until its response is
 * recorded; there is no token stream to imitate.
 *
 * Observations: the authorized view an actor received when deciding, decoded two ways: from the
 * observer record the ledger holds, and from the actor's own lossless conversation patches. The
 * two must agree or the presentation is refused. Earlier views are labelled historical: the
 * actor remembers them, but they were not current at the selected tick.
 */
import { parseAnthropicResponse, type ReasoningEvidence } from '../agent/anthropicResponse.js';
import { responsesObservation, type AuthorizedObservation } from '../agent/responsesRequest.js';
import { digest } from '../agent/replay.js';
import { conversationObservations, unpackContinuationObservation, type Message } from '../eval/continuationConversation.js';
import type { ObservatoryExperiment } from './ledgerTail.js';

export type ReasoningDisplayStatus =
  | 'summary_returned' | 'summary_empty' | 'redacted_only' | 'not_returned'
  | 'pending' | 'absent_transport_failed' | 'response_unreadable';

export interface ReasoningPresentation {
  source: 'anthropic_thinking_summary' | null;
  status: ReasoningDisplayStatus;
  /** Provider-written summaries, verbatim and in order. Never the raw chain of thought. */
  summaries: string[];
  redactedBlocks: number;
  /** How many thinking blocks carried a signature; the signatures themselves are not shown. */
  signedBlocks: number;
}

export function presentReasoning(evidence: ReasoningEvidence | null | undefined): ReasoningPresentation {
  if (!evidence) return { source: null, status: 'not_returned', summaries: [], redactedBlocks: 0, signedBlocks: 0 };
  return { source: evidence.source, status: evidence.status, summaries: [...evidence.summaries],
    redactedBlocks: evidence.redactedBlocks, signedBlocks: evidence.signatureSha256.length };
}

export interface DecisionRecord {
  requestId: string; actorId: string; tick: number; cursor: string;
  reasoning: ReasoningPresentation;
  proposed: unknown; actionable: boolean | null; admitted: unknown;
  executed: boolean; stopReason: string | null; latencyMs: number | null;
}

/** One request's state from the evidence alone, using the existing reader on backend bytes. */
export function decisionRecord(experiment: ObservatoryExperiment, requestId: string): DecisionRecord {
  const raw = experiment.rawEvents().map(x => ({ ...x, cursor: `${x.segmentId}:${x.event.seq}` }));
  const of = (kind: string) => raw.find(x => x.event.kind === kind && x.event.data.requestId === requestId);
  const request = of('request');
  if (!request) throw Error('observatory_unknown_request');
  const response = of('response'), receipt = of('receipt'), validation = of('validation'), failure = of('failure');
  const executed = raw.some(x => x.event.kind === 'transition' && Object.values(x.event.data.requests as Record<string, string>).includes(requestId));
  let reasoning: ReasoningPresentation;
  if (receipt) reasoning = presentReasoning(receipt.event.data.reasoning);
  else if (response) {
    try { reasoning = presentReasoning(parseAnthropicResponse(Buffer.from(response.event.data.raw, 'base64'), requestId).reasoning); }
    catch { reasoning = { source: null, status: 'response_unreadable', summaries: [], redactedBlocks: 0, signedBlocks: 0 }; }
  } else reasoning = { source: null, status: failure ? 'absent_transport_failed' : 'pending', summaries: [], redactedBlocks: 0, signedBlocks: 0 };
  return {
    requestId, actorId: request.event.data.actorId, tick: request.event.data.tick, cursor: request.cursor, reasoning,
    proposed: receipt?.event.data.proposed ?? null, actionable: receipt ? receipt.event.data.actionable : null,
    admitted: validation ? validation.event.data.admitted : null, executed,
    stopReason: receipt?.event.data.stopReason ?? null, latencyMs: response?.event.data.latencyMs ?? null,
  };
}

export interface ActorObservation {
  actorId: string; tick: number; requestId: string; cursor: string;
  label: 'current_at_tick';
  /** What the model received for this tick, unpacked (the observer projection after the request whitelist). */
  projection: unknown;
  decodeAgreement: true;
  /** Earlier views, as the actor's own transcript holds them. Historical, not current. */
  history: { tick: number; label: 'historical'; projection: unknown }[];
}

/** The authorized view `actorId` decided on at `tick`, with its transcript history. */
export function actorObservation(experiment: ObservatoryExperiment, actorId: string, tick: number): ActorObservation {
  const found = experiment.rawEvents().find(x => x.event.kind === 'request' && x.event.data.actorId === actorId && x.event.data.tick === tick);
  if (!found) throw Error('observatory_no_observation');
  const d = found.event.data;
  const projection = responsesObservation(d.observation as AuthorizedObservation);
  const messages = (JSON.parse(d.body) as { messages: Message[] }).messages;
  const decoded = conversationObservations(messages).map(unpackContinuationObservation) as { tick: number }[];
  if (!decoded.length || digest(decoded.at(-1)) !== digest(projection)) throw Error('observatory_observation_decode_mismatch');
  return {
    actorId, tick, requestId: d.requestId, cursor: `${found.segmentId}:${found.event.seq}`, label: 'current_at_tick',
    projection, decodeAgreement: true,
    history: decoded.slice(0, -1).map(p => ({ tick: p.tick, label: 'historical' as const, projection: p })),
  };
}
