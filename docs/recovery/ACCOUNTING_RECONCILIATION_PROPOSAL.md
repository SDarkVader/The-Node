# Accounting reconciliation proposal — not executed

17 October 2026. The read-only [inventory](ACCOUNTING_RECOVERY_INVENTORY.md) did not locate the original ledger. No financial disposition, request-count reset, new budget or paid request has been made. The following is a reviewable plan, not an instruction to settle anything automatically.

## Preferred recovery

If the user can supply an authentic original ledger/run export or an earlier environment filesystem snapshot, preserve its bytes and hash it before interpretation. Identify source revision, event IDs, reservations, settlements, cumulative limits and diagnostic admissions. Reconcile duplicate imports by original event identity rather than adding totals from multiple copies.

Acceptance: original evidence remains immutable; importing twice does not duplicate events; no missing/uncertain event becomes zero-cost; nine combined admissions in the documentary report are not added to the separately described actor request; any disagreement is retained for review. A recovered ledger alone does not authorize a provider call.

## Explicit operator reconciliation if original evidence cannot be found

The historical safeguards allow a trusted operator to explicitly close an uncertain actor attempt at its **entire original reserved ceiling** while retaining its request count and recording the decision and reason. That would be a conservative accounting disposition, not a statement that an invoice actually billed US$0.019114. No such decision has been made here.

Any proposal to use this route must separately address the diagnostic events: their identities, count overlap, unknown provider delivery and any additional uncertain costs. The actor reservation must not silently be treated as covering every diagnostic. Do not infer a remaining allowance from the old ten-request cap. Preserve the old US$5 cumulative and US$0.25 first-pass ceilings as historical constraints; do not restart them at zero or widen them by creating a new directory.

A concrete reconciliation record, if later authorized, should retain:

- The original evidence hashes, missing-artifact statement and source-session identifiers.
- The full actor reservation, unknown actual usage/billing and separately labeled conservative disposition.
- The support report's nine combined admissions including the actor attempt, plus the unchanged legacy field label/value and its conflict. Do not invent event IDs or assert nine additional diagnostic requests.
- Explicit treatment of any still-unbounded diagnostic liability and the reason further admission remains blocked if it cannot be bounded.
- The human decision, reason and date; no actor/model may authorize or alter it.

## Future ledger implementation acceptance criteria

Implementation remains separate future work. It must support one common cumulative history, integer microUSD, durable reservation before dispatch, one outstanding request, idempotent immutable settlement, no refund of consumed request counts, and a persistent halt if usage exceeds reserve or evidence writes fail.

Unknown outcomes must retain the full reservation. Restart, duplicate import, missing/corrupt state or an alternate directory must not replenish allowance. Wrong ownership/links and concurrent writers must fail closed. Test all of these with synthetic fixtures; test data must never become an initialized real-account ledger.

Paid execution also needs a reviewed credential-isolated provider adapter, current verified prices/access and explicit user authorization. The protected offline core and its unconditional live gate remain unchanged. No API diagnostic or key rotation is needed to review this proposal.

## What can be completed now

The accounting ambiguity is documented and the handoff wording is corrected. Offline provider request/response contracts can be exercised against mocks. Exact historical billing and a final financial disposition cannot be proven from the currently available source documents; a trustworthy additional artifact or explicit informed operator decision is required for that part.
