# Managed API binding: remaining authentication failure

Observed 2026-10-17. This report contains no secret values or complete provider error text.

## Current verified state

- User published the environment; runtime spec and observed revisions are both 5.
- Observations are current; NODE_AI_API_KEY reports ready.
- Restricted network policy reports enforced, with api.openai.com allowed.
- A new HTTPS POST /v1/responses returned 401, code invalid_api_key.
- Probe body: {"model":"gpt-5.4-nano-2026-03-17","input":[],"max_output_tokens":0}.
- The deliberately invalid zero-output body cannot start generation. No actor/Evals run started.
- Managed HTTPS proxy, injected binding, configured CA and TLS verification were preserved.
- Secret value was never printed, saved in source or included in command arguments.

## Earlier evidence and limits

At revision 3, GET /v1/models using the same named binding returned 200 with a valid list,
while Responses POST returned 401 using Python and curl. That comparison predates revision
5; it does not establish that the current underlying credential is identical or that current
model listing succeeds. GET success alone does not prove Responses generation entitlement.

During revision 4, the UI reported a generic environment-save rejection with no field
identified; runtime secret/network readiness was unknown. The supported tool successfully
saved the existing secret declaration without touching the secret value. Publication to
revision 5 now establishes runtime readiness, while actual Responses authentication still
fails. Do not conflate these outcomes or claim an endpoint/injection root cause is proven.

Available tools expose binding metadata/readiness, not the mapped secret value, tracking ID,
provider project identity, proxy substitution trace or field-specific UI save failure.
Further investigation should check the secure binding-to-active-key association and managed
credential substitution on the Responses request, then provider authorization. Another
unchanged publication or blind key rotation is not a demonstrated fix.

## Containment

Diagnostics have reached nine conservatively counted request admissions including the
historical failed actor attempt and sandbox-denied diagnostics. The initial ten-request cap
has not been widened. Stop automatic probes; no retry loop, model fallback or paid generation.
Historical US$0.019114 remains an unreconciled full reservation. Original ledger/source are
still missing and must be recovered before paid gameplay. No actual invoice is inferred.

This is a prepared report only; it has not been sent to platform support or anyone else.
