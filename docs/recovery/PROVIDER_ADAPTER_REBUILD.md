> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Responses transport and separate game-host rebuild

Continues account-ledger rebuild `70132cf081672784ba7eefeb7461e4c7218ebe0c` on `broker-provider-adapter-2026-10-17`. The actual request serializer, bounded HTTPS/CONNECT transport, lazy credential reader and credential-separated mechanical host are now reconstructed and verified locally. They are new implementations, not recovered original source. The four protected core/test files and original account journal remain byte-identical.

## Components

| File | Implemented contract |
|---|---|
| `src/agent/responsesRequest.ts` | Final serialized Responses body, nested authorized-observer whitelist, strict dynamic decision schema, fixed controls, final UTF-8 byte/framing ceiling and immutable process-local prepared-request identity. |
| `src/agent/responsesTransport.ts` | Fixed HTTPS provider endpoint behind the original unconditional gate; explicit HTTP/HTTPS CONNECT proxy and approved CA; verified target TLS; bounded headers/body and one deadline covering connection, proxy, TLS, headers and body. |
| `src/agent/providerCredential.ts` | Lazy read of only one valid `OPENAI_API_KEY` assignment in an explicitly selected workspace file. No automatic env loading or process.env mutation. Missing/duplicate/malformed/linked/unsafe files fail with a fixed error that never echoes content. |
| `src/agent/responsesBroker.ts` | Reserve the final wire-body hash/cost/count before dispatch; no retries; account response usage before decision validation; retain unknown costs on I/O failure; cancellation/deadline prevents action publication; reuse existing durable response claims. |
| `src/agent/isolatedHost.ts` | Mechanical Node child, OS-only environment allowlist, private bounded IPC, one command in flight, deadlines, termination/reaping and trusted admission/replay methods. No model/provider worker. |
| `src/agent/isolatedHostChild.ts` | Existing deterministic authenticated host in a separate process. Reject inherited OpenAI key names at startup. Optional durable create/resume, existing person/session/episode/freshness authority and complete evidence export. No provider or env-file-loader import. |

`AccountedBroker.complete` now accepts an asynchronous latest-host read after recording usage and claiming the response. This supports IPC without moving the provider credential into the host. The unchanged offline core still validates the pinned context and complete decision; the host/kernel still decide admission and actual effect. No result is retargeted or automatically replayed after a consumed response.

## Verified provider contract

The request uses `text.format` with a strict JSON schema, all required keys, no additional properties, a fresh user observation, low reasoning, default service, no tools, `store:false`, non-streaming, no background execution and disabled truncation. Output is capped at 2,048 tokens including reasoning. No conversation, previous response, scratchpad, evaluator feedback or reasoning summary is requested. Model and evidence-linked prices are explicit inputs; no model migration, current-price assumption or entitlement probe occurred.

Sources fetched from official documentation during this work: [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Static reference Markdown and fingerprints are retained in the local verification workspace. The web reader could not decode the reference Markdown; fetching the same official Markdown as text succeeded. Documentation examples were not executed. No inference endpoint was called.

The serializer preserves the full existing legitimate projection while explicitly selecting nested fields. It excludes controller/session/observation tokens, observer secret, raw World and unexpected producer fields. Context/self/affordance references must agree. The typical 100-person fixture produces a final body of 31,356 bytes and an input ceiling of 35,452 tokens (bytes plus 4,096 framing margin); 32,768 request bytes / 36,864 input / 2,048 output remain hard ceilings. Larger observations fail before admission; nothing is truncated to fit. Supported schema size/enum/depth bounds are checked locally.

Prepared request objects and their contexts are detached/immutable, registered within their producing module and cannot be replaced by deserialized lookalikes. Account reservations bind to their final body SHA-256, not the earlier application-policy artifact hash. An adapter mismatch or duplicate person/tick cannot authorize a different request.

## Network and lifecycle containment

The production endpoint is fixed to `https://api.openai.com/v1/responses`. There is no alternate-base-URL parameter, redirect following, retry or fallback. Live operation requires an explicit CONNECT proxy URL and CA bundle; no inherited ambient proxy or insecure TLS setting silently supplies a route. Proxy URL credentials/query/path injection are rejected. CONNECT receives no provider Authorization header. The bearer appears only inside the verified target TLS request. Target identity and certificate verification are never disabled. Proxy-authentication schemes beyond this explicit route are not implemented; a refusal retains the hold instead of bypassing the route.

The single request deadline covers stalled CONNECT and target TLS as well as delayed headers and endlessly arriving body data. Responses are bounded to 16-KiB headers / 262,144 body bytes. Non-2xx responses are discarded without logging or parsing their body; compression/unexpected content types are rejected. Error listeners are installed before destruction and retained for late errors. Errors contain fixed codes, never raw provider text, keys or request headers. The separate raw-response parser extracts usage before refusing invalid, stale, incomplete, failed or unsupported decisions. Cancellation during asynchronous host validation retains booked cost and returns no action.

Final review reproduced an additional deadline defect: a synchronous host callback could block delivery of the timer, then return a valid proposal after the deadline. A new 500-ms synchronous-stall/300-ms deadline regression failed against that implementation. Direct monotonic checks after latest-host reads and before final publication fix it; credential preparation also subtracts elapsed time before network I/O. If persistence finishes late, the wrapper rejects publication even when the earlier core-validation event was positive. That event describes validation only, never publication, admission or game effect. The consumed response and booked cost are retained without retry or rewritten history. The original green full-run log and the later final verification are retained separately.

`sendLiveResponses` and `ResponsesBroker.evaluateLive` both call the protected `assertLiveAdmission()` before any reservation, credential read, DNS or socket. It still throws `recovery_accounting_unresolved` unconditionally. Creating a key or writing an operator fixture cannot alter that gate.

The only exercised network entrypoint is explicitly named `sendLoopbackResponsesFixture` / `evaluateLoopbackFixture`. It accepts only a normalized 127.0.0.1 endpoint at `/v1/responses`, an explicit local port and an optional local proxy. It has a fixed invented bearer and no real key accessor. Passing the provider endpoint, localhost DNS, alternate path, userinfo, query or external proxy fails before a connection. It cannot be used as an alternative live admission path.

## Credential decision and actual account preservation

The user approved new-key setup and the exact local destination through the text fallback after the target-selection widget did not appear on mobile. One `NODE Broker` key was created through the encrypted OpenAI Platform flow and saved as `OPENAI_API_KEY` in this checkout's ignored `.env.local`. Its value was never printed, put in a command argument, committed, shipped in a handoff or sent to a fixture. No custom org/project was selected through the failed widget; the connector's default connected target was used. Creation is not evidence that it matches the old account or has model entitlement.

The selected destination is `outputs/broker-accounting-rebuild/.env.local` on Steve_PC. The directory retains that name while its active Git branch is now the provider-adapter branch. Do not create another key or ask the user to repeat the resolved credential decision for this same checkout. The key is not automatically loaded. Tests use disposable fake key files and fixed fake HTTP credentials; Vitest has `envDir:false` so offline verification does not import this private `.env.local`.

Only the explicitly authorized key-provisioning operation used the Platform connector. No model request, provider credential diagnostic, model-list probe, Evals run or paid actor was executed. No actual operator reconciliation/settlement, new allowance, account-ID reassignment or spending reset occurred. The carried journal still contains the original 19,114-microUSD hold, nine combined admissions including the actor, null actual billing and unbounded diagnostic liability. Its exact file SHA-256 remains `fc91bd96dc2b34ba43aa063bfc5a9eabb2aff48ce7ca92d4c1fedaa77ac808df`.

## Host separation and verification

The child receives only allowlisted OS runtime environment values, not provider keys, arbitrary secrets, Node preload hooks or TLS overrides. The controller token travels only on the private initialization IPC channel, never command-line arguments, logs or provider input. Host stdout/stderr are not forwarded to policy. Startup rejects either known provider key name even when the child is invoked directly. Bounded command identities, one pending request and deadlines prevent overlapping or mismatched IPC replies from granting authority. Timed-out/malformed mechanical children are killed and reaped. Clean durable resume authenticates a new lease; old observation tokens cannot be reused.

The child is trusted deterministic application code, not a malicious-code sandbox. Same-user filesystem access can still read files; a new process alone does not establish adversarial isolation. NTFS private ACL enforcement, malicious same-user rollback/copy forks, cross-machine global accounting and physical power-loss durability remain unclaimed. Existing ledger/checkpoint process-crash protections and conservative reopen rules remain in force.

Seventy-two new tests cover final-wire/whitelist contracts (9), real local HTTP/TLS/HTTP-and-HTTPS-proxy lifecycle (28), account/transport/game integration (14), mechanical host isolation/recovery (12), and lazy fake-file credential handling (9). The initial direct-child startup tests used unsupported synchronous IPC spawning; the harness was corrected to real asynchronous IPC, and all startup rejection checks now run and pass. Type/declaration errors discovered while composing the new modules were fixed before final verification; no assertions were weakened or tests excluded.

The full standard two-worker run passed **1,088 tests across 88 files**, with durable exit status 0. The native broker/participant parity runner passed **80/80**. Total distinct checks: **1,168**, including the 72 new tests, plus repository and CLI TypeScript compilation. A real local service → account journal → separate game child → authenticated Baker price effect → complete-state replay flow passes. The preserved account journal and protected core fingerprints are unchanged. Hosted CI was not queried or claimed to pass.

To emit the library and its mechanical host entrypoint with existing locked local dependencies:

```powershell
node node_modules/typescript/bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --outDir dist --rootDir src src/agent/responsesBroker.ts src/agent/isolatedHost.ts src/agent/isolatedHostChild.ts src/agent/providerCredential.ts
```

This compiles files only; it starts no host or provider. Do not run the legacy `npm run server` as a broker entrypoint. Future live rollout still requires explicit user authorization, an informed historical financial disposition/authentic evidence, current account/model/price/access review and a separately reviewed way to open admission without weakening the preserved core. The reconstructed code does not manufacture the lost invoices or original event identities.
