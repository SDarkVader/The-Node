# Thinking / History interface

Updated 2026-10-24. Claude's interface commit `c151e41` was cherry-picked into
`codex/observatory-windows-2026-10-23` as `3484264`, then audited against the actual
observatory contracts. The integration fixes the static script route, evidence types,
filtering, exports and private access scopes. It makes no model calls.

## Recorded evidence

The researcher sees decisions in tick order across the registered parent-linked segments.
Each record includes the full request ID, actor ID, evidence cursor, segment, world hashes,
verification state, exact returned summaries, complete proposed/admitted action objects,
execution flag, stop reason and recorded latency. The source label identifies the recorded
reasoning evidence type; it is not a model identifier.

Reasoning availability and execution are separate fields:

- `status` retains the existing reader's values: `summary_returned`, `summary_empty`,
  `redacted_only`, `not_returned`, `pending`, `absent_transport_failed`, `response_unreadable`.
- `stage` comes from the timeline; `admissionStatus` is `pending`, `admitted` or `rejected`.
- `admitted` contains the actual admitted object or null. Null without validation is pending,
  not evidence of rejection. `executed` is copied from the committed transition evidence.

Provider-returned summary text is displayed verbatim, as text. Missing text is labelled with
its actual availability status. Nothing reconstructs unreturned internal thinking. This is
not a complete signed conversation viewer: opaque/redacted blocks and signatures are shown
as counts through the existing presentation contract. Transcript decoding, provider-compatible
signed history and raw archives remain unchanged in their private source locations.

Expand **Authorized observation and remembered views** on a decision to fetch the exact
authorized observation used at that tick, checked against its conversation decoding. Earlier
views are explicitly historical. They are loaded only when expanded and are not silently
treated as the current world. Full history exports reference world hashes; they do not repeat
every historical observation inside every decision.

## API and access

```text
GET /observatory/v1/runs/{experimentId}/thinking-history
```

Uses the existing bearer researcher token. Renderer tokens receive 403; unauthenticated
requests receive 401. The renderer gets no private decisions or thinking history.
This route has no experiment controls and cannot call a model, book spending or advance time.

Optional query parameters:

| Parameter | Meaning |
| --- | --- |
| `actorId` | Exact actor ID |
| `status` | Exact reasoning availability status |
| `summaryKeyword` | Case-insensitive substring of actor ID, request ID or returned summaries |
| `tickFrom`, `tickTo` | Inclusive nonnegative integer tick range |
| `format` | `json` (default), `csv`, `markdown` |

JSON returns `node-observatory-thinking-history-v1`, with `scope: researcher`,
`evidenceKind: provider_returned_summaries`, the selection, chronological ticks and statistics
computed over that selection. CSV/Markdown return `{format, content}` in a JSON envelope.
Invalid ranges/formats receive 400. A missing/mismatched join is refused, not silently omitted.

## Viewing and exports

Open the existing local researcher URL printed by `npm run observatory -- serve`.
The Thinking History panel initializes with the timeline. Enter any combination of keyword,
actor, status and tick range, then select **Apply filters**. Filters survive cursor changes.
**Clear filters** restores the full registered history. Exports use exactly the active filter
selection and include IDs and complete action objects.

JSON preserves returned strings verbatim. CSV uses RFC 4180 quoting, including multiline text
and embedded quotes; formula-like text receives an apostrophe prefix for spreadsheet safety.
Markdown encloses the complete JSON evidence in a sufficiently long fence so returned text is
literal. Exports download locally; no data is uploaded.

## External evaluation integration

The original webhook controls were not a working authenticated external-model integration:
the server's same-origin CSP blocked arbitrary endpoints, and response HTML was interpolated
unsafely. This integration keeps the same-origin policy and does not connect a webhook.
No outbound call occurs on page load, filter, cursor movement or export.

`buildExternalModelPayload` prepares an **offline** payload and actually applies its actor/tick
selection. It does not call a model or imply authorization for a paid evaluator. Connecting an
external evaluator remains further work: declare its destination, permitted evidence, model,
budget/accounting and output provenance. Such evaluation is separate from execution and cannot
give an in-world actor access to another actor's private history. Human interpretation and
named framework scores remain distinct from this evidence display.

## Verification

`test/thinkingHistory.test.ts` covers multi-segment chronology/deduplication, exact returned
text/actions, join failures, pending/rejected distinctions, filter statistics, CSV quoting and
formula handling, researcher/renderer/anonymous scopes and unchanged fixture bytes.
`test/thinkingViewer.test.ts` exercises the actual scripts in a DOM/event harness: literal text,
filter persistence, stale-response refusal, failure display and actor/tick observation lookup.
These client tests do not claim visual browser verification.

The real private archive was checked locally: 56 decisions across 28 ticks, 22 decisions with
nonempty summary text, exact matches to the existing evidence package, and registered ledger/
journal bytes preserved. Private records, credentials and paths are not committed.
Native browser verification stopped when the Windows controller could not confidently verify
the current URL for policy enforcement. Interactive browser review remains further work.

Source and suite totals are anchored in [the current checkpoint](../recovery/CURRENT_SESSION.md).
Integration source: `1f7901de1cef4aa69a1223cf1cdd9f60376a33fa`.
[Sanitized verification record](evidence/thinking-history-2026-10-24.json).
After publication at `472d709`, a fresh GitHub clone of the review branch verified the tracked
recovery checkpoint successfully, with no local snapshot, previous conversation or private data.
Claude continues interface presentation; Codex owns backend/Godot integration.
