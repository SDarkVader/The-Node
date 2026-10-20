# Initial testing budget — 18 October 2026

The user clarified that the API dashboard provides billing and that the task is to set a reasonable budget for initial testing. This supersedes the unexecuted proposal to add a historical diagnostic provision. No historical cost is forgiven, invented, settled or newly charged.

The configured allowance covers **additional test spending only**: five new decisions, USD 0.10 total, USD 0.02 per request, and `gpt-5.4-nano-2026-03-17`. It expires 24 hours after configuration. The reservation uses twice the recorded standard input/output prices, ignores caching discounts and permits at most 36,864 input / 2,048 output tokens. A maximum-size reservation is 19,866 microUSD. No API call, action or automatic background run starts during configuration.

## Implementation and historical evidence

- `initialTestBudget.ts` stores the complete validated historical account document unchanged as a carried snapshot, imports diagnostic evidence, and appends one explicit forward test allowance. It keeps historical unknown billing separate from the remaining new-test allowance.
- The original nine documented admissions remain carried. Three completed generation diagnostics and two models-list attempts add five distinct records, yielding 14 recorded attempts before the new allowance. The failed models-list event is labeled as a transcription of its observed tool result; its delivery/cost remains unknown. Exact original historical event identities and provider-account linkage are not invented.
- Both game response archives are checked against the saved receipt hashes and usage. The tiny connection-generation test has recorded usage metadata, not an archived raw response. Published-price estimates remain estimates, not invoices. Encrypted response metadata remains private evidence, not policy input.
- Successful non-generating models-list requests receive a zero token-cost estimate; failed requests remain unknown. Neither changes the original historical diagnostic liability.
- `prepare-initial-test.ts` requires the existing historical ledger, five unique evidence packets, the user's budget instruction and a rate snapshot. It writes one canonical run directory alongside the source ledger. Another output name cannot silently reissue this same allowance. Existing/missing/corrupt state is never replaced or initialized on open.

The configured local state is `outputs/initial-test-budget-2026-10-18/accounting.journal.json`. It embeds the carried history and evidence. The old journal in `outputs/rebuilt-accounting-ledger/` remains byte-identical. Private state/evidence and the configured user instruction are not committed. Preserve this existing budget file when continuing elsewhere; configuration must not be rerun to replenish it.

## Enforcement and verification

A reservation is durable before a caller may dispatch. One request can remain outstanding, the actor must remain the same Baker, ticks must increase and the model is pinned. Duplicate requests/receipts are idempotent only when their contents match. Imported provider response IDs cannot be reused as new usage. Unknown outcomes and wrong-model responses retain the full reservation and block further admission. Known usage is recorded even when it exceeds the reservation; honest overruns remain booked and halt future spending. No count is refunded, including zero-token usage. Returned views are detached from stored state.

Sixteen new offline tests exercise evidence import/deduplication, historical preservation, control failures, byte/usage verification, grant conflicts, expiry, five-request exhaustion, restart, overlapping requests, repeated ticks, actor/model substitution, receipt reuse, overrun, missing state and three atomic-write interruption stages. All 121 focused tests pass, together with repository and CLI TypeScript checks. No provider request or credential read was needed for these checks. The full repository suite was not rerun for this scoped addition.

`inspectAccountingDocument` is a pure export of the existing historical validator. Historical reconciliation rules, including their original ten-request cap, are unchanged. The new additional-spending window is explicitly scoped and does not claim a newly calculated global API balance, proof of an invoice, or a reset of the historical trial. Cross-host spending coordination and malicious same-user copies/rollback remain outside this local guard.

The protected decision core and its original unconditional live gate remain unchanged. This stage implements/configures the test budget; it does not wire an executing game-turn runner into that budget or enable the production live broker. The next integration must reserve through this guard before transport and record usage before admitting a decision. The broader production gate must not be silently disabled. No Evals, agents, automatic inference or new game actions were executed here.
