# Empty reasoning-content compatibility — 18 October 2026

Continues provider-adapter commit `0a1bffb069a1d43fbd001a2db6fc111351b792e1` in the separate `broker-response-compatibility-2026-10-18` checkout/branch. The earlier checkout and four protected core/test files remain unchanged.

## Observed failure and narrow repair

A user-authorized single request to `gpt-5.4-nano-2026-03-17`, with low reasoning and the complete authorized observation of a Baker in a 100-person local game, returned HTTP 200 and a legal decision. The provider included a reasoning item with `summary: []`, `content: []` and opaque encrypted metadata. The archive reader rejected the mere presence of `content`, so it preserved usage but returned no actionable decision.

`src/agent/recordedResponse.ts` now accepts an absent or empty-array reasoning `content` field with an empty summary. Nonempty reasoning text, malformed content and nonempty summaries remain rejected. Opaque encrypted metadata is neither decrypted, returned to policy nor replayed in another request. Provider metadata does not gain game authority. Envelope/body/usage bounds and existing refusal, tool, annotation, message-count, completion and decision checks remain in force.

The official [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create) describes optional reasoning content and default encrypted metadata; the [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) also documents encrypted metadata in stateless responses. The actual archived response is the regression evidence; no downloaded examples were executed.

## Verification

Eleven new parser cases cover the observed empty-array shape with absent/null/opaque encrypted metadata, exclusion of that metadata from policy output, and rejection of malformed or nonempty reasoning beside an otherwise valid answer. The three acceptance regressions failed before the repair. All 105 focused parser, accounting, broker and transport-integration checks subsequently passed, together with TypeScript and an emitted-library build. The existing local-service/accounting/game-effect/full-replay integration now includes this metadata shape and passes. The changed parser/integration suites were rerun after that addition: 45/45 passed. The full repository suite was not rerun for this narrow change.

The original saved provider response now passes the repaired parser and unchanged offline broker validator without a new provider request.

After those checks, the user-authorized second game request used the same selected snapshot, production request serializer, low reasoning, strict JSON schema, 2,048-output-token cap, no tools, no response-state linkage and one request without retries. A fresh local kernel/credential-separated host supplied the observation. Its result was:

- HTTP 200, completed response, exact requested model returned.
- 12,981 input tokens; 188 output tokens, including 149 reasoning tokens; no cached input.
- Estimated standard-rate cost **$0.0028312**, using $0.20/million input and $1.25/million output from the [model page](https://developers.openai.com/api/docs/models/gpt-5.4-nano). This is a usage-based estimate, not an invoice.
- Provider response time 2,349 ms; 2,736 ms including diagnostic-client startup.
- Decision: `{"move":{"x":0,"y":-3},"communication":null,"diary":null,"role":null}`.
- Repaired parser marked the envelope actionable; the unchanged offline broker validated the decision against the actual observed/current context.

This was a bounded standalone provider diagnostic using native HttpClient, not a production `evaluateLive` run or verification of the managed CONNECT deployment route. No decision was submitted, no tick advanced, and the local game's evidence hash remained unchanged. The host was closed. The original unconditional live gate remains closed.

Private response/observation/receipt records and the per-attempt reservation are retained outside Git in `work/game-decision-probe-fixed-2026-10-18/`. The earlier failed-parser record is preserved separately. Credentials and opaque provider response artifacts are not committed.

## Accounting preservation

The original documentary account journal remains byte-identical at SHA256 `fc91bd96dc2b34ba43aa063bfc5a9eabb2aff48ce7ca92d4c1fedaa77ac808df`. Historical unknown billing and diagnostic liability are not reconciled by this test. Each new diagnostic has its own durable attempt/usage record; no original allowance or request count was reset. The selected snapshot was not changed to the cheaper connection-test model. No further API call or automatic game loop is authorized by this report.
