# NODE — Oracle, reputation, monuments and wealth implementation handoff (2026-10-26)

**Status:** Owner-authorised documentation and implementation handoff only. No game code, paid-run configuration or secret accounting has been changed. Remote `main` audited at `056ab6e843e2ff7a173bd83604a0342da1091d88`. The previous independently replayed 20-tick run is historical evidence from `e2a16e6df069cf21beaa6107365adc359f19bd64`; it is **not** a test of these proposed changes.

**Full checked package in Google Drive:** https://drive.google.com/file/d/1zi2qoodDMzJTyrws-9p1eXH0FDkRCCVo/view

Contains: source-to-code discrepancy audit, preservation/implementation contract, draft strict agent-visible schema (not executable yet), seven short sequential Sol Ultra prompts, independently runnable zero-provider-call PowerShell offline/verification wrapper, mathematical audit and results, verification matrix, and provenance SHA-256 manifest.

## Owner rule precedence

Read the current `AGENTS.md`, `docs/recovery/CURRENT_SESSION.md`, checked source and latest **owner instructions** before coding. `docs/DESIGN_ADDENDUM_2026-08-07.md` **supersedes** the earlier 6 August scalar exit-ticket gamble with tiered postcards and weighted fusion. Older Oracle restrictions and strictly additive reputation wording do not override later, documented October decisions permitting signed/decreasing deed-based standing and bounded opportunities. Preserve basic access/floor and historical witnessed civic records. Unknown prices, rare prize probabilities, mixed-tier recipe legality, higher passport tiers and cap levels remain unresolved calibration—not a licence to improvise.

## Source-to-code gaps

1. **Universal Oracle:** Current `src/society/boundary.ts`, `src/engine/oracleOpportunities.ts` expose only paid `enter` / voucher `redeem` and omit the negligible-cost daily universal Oracle opportunity. Do not introduce a money gate on ordinary participation or a guaranteed winner. Optional tiny-cost gambling remains accessible to all; repeat winners are allowed.
2. **Economic health/prizes:** The shipped `oracleWinProbability` is clamped 5%-30% and keys off `economicHealthWithExperience`. It is not a non-linear, health-sensitive **quality/rarity of prizes** distribution: society prizes are currently equal-weighted bounded wealth/own stock/entry voucher. Implement a versioned normalized, mathematically checked rarity function and escrow/treasury ledger, but do not invent numeric weights or payouts without calibration.
3. **Postcards and forging:** The 7 August specified White→Green→Blue→Purple→Orange, five same-tier items for guaranteed next tier, optional `k/5` same-tier shortcut at eligible tiers, consumption on loss, passive hourly White accrual capped to 16h in the unclaimed buffer, and an illustrative three Orange for a held exit ticket. None is a complete live inhabitant mechanic. A simulation **tick is a day**, not a real-world hourly visit: model explicit clock/claim events before promising daily accrual.
4. **Migration/Import-Export:** A real personal ticket must be recorded before it becomes a legal migration entitlement. An agent can know and discuss owned items with existing grammar/identity controls but cannot invent travel actions, passport tiers, trade or stock access not yet implemented.
5. **Reputation:** Existing `src/engine/reputation.ts` `reputationProgress` is additive Grifter opportunity progression; October signed deed reputation, authoritative public/private provenance, loss of standing and monuments are separate proposed mechanisms. Never turn rumours, secret crime or unrecognised identity into a publicly certified score.
6. **Monuments:** Competitive civic markers may use verified Baker completion and sales. The *current* title may change; the witnessed event record persists. No invented title thresholds or public attribution for hidden crimes.
7. **Wealth caps:** `wealthCap` disabled by default; current cap pathway covers Miller/Baker, not all roles/Grifters. Audit all income, Oracle prizes, migration/refill and settlement; trial universal caps offline without erasing survival floor or silently enabling historical defaults.
8. **Testing:** `npm run society -- --ticks 10/20 --seed ... --output ...` and `--verify ...` test offline policy/replay for **zero paid provider requests**. Remote `scripts/run-society-live.ts`'s standard paid plan validator permits at most **three** ticks. The owner's previous 20-tick PC wrapper delegates to an existing local `scripts/start-society-live.ps1` and a consumed plan; do not copy its approval or create funding from a new script. The package's wrapper defaults to offline, checks source/approval, and delegates to the existing local private paid launcher only with a new approved plan.

## Exact mathematical audit

At the original illustrative 2 White/hour, safe 5:1 fusion at four levels and three Orange per exit ticket requires `3 * 5^4 = 1,875` White. Fully collected at 2/hour: `39.0625 days`. If claimed **once every 24 hours** under the original 16-hour cap: at most `32/day`, thus about `58.59375 days` of collected accrual. For same-tier shortcut stake `k ∈ {1,2,3,4,5}`, `P(success)=k/5`, expected input per successful fusion = 5, variance decreases as k approaches 5. Wolfram and the package's no-network Python audit confirm these identities. This **does not** establish proposed rare-reward balance or gameplay outcomes.

## Strict order (one Sol task, one verified diff at a time)

1. Repo read-only audit; establish actual branch/status and any source drift. No edits or provider calls.
2. Pure postcard state, real clock/16h buffer and safe fusion + offline tests.
3. Same-tier weighted shortcut and atomic failure consumption + replay tests.
4. Universal Oracle access and optional inexpensive lottery, source-backed health/rarity/rewards, audited ledger; **do not activate uncalibrated numbers**.
5. Allowlisted truthful agent views, role/asset information, authorized social context, action validator and non-agent parity tests.
6. Signed event-derived reputation, rival Baker civic marker, configured universal wealth-cap sweep; preserve old Grifter progress separately.
7. PC PowerShell offline 10/20-tick runs, exact replay; separate fresh approved paid preflight only when explicitly authorized.

**No merge** on missing accounting, private/world-state leakage, retroactive historical run changes, fabricated prices/probabilities, illegal agent actions or paid-call dispatch without a fresh explicit approval.

The **full source audit, implementation contract, draft schema and acceptance matrix** are in the Drive ZIP. This file is a pointer and minimal durable handoff, not a replacement for those contracts.