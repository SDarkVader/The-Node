# Daily Oracle agent trial

The owner approved this provisional trial on 26 October 2026: free daily participation; wealth prizes 0.05, 0.15 and 0.30; relative prize weights 100:5:0.1 at poor health and 100:10:1 at healthy conditions; and a one-off 100 game-wealth treasury explicitly recorded as trial issuance. This is an opt-in experiment configuration, not a default economy calibration. The separate USD model-call budget is unchanged.

From the committed checkout, prepare a real-agent test:

```powershell
powershell -NoProfile -File scripts/start-society-playtest.ps1 -PostcardRate 2/1 -Ticks 3 -OracleConfig experiments/oracle/daily-oracle-trial-2026-10-26.json
```

Supply the latest completed accounting journal, credential-file path and a new private output folder when prompted. Preparation makes no provider call or allowance, and prints the exact `-Review ... -ApprovePaidRun` command that starts this reviewed test. Existing [PowerShell launch instructions](POSTCARD_AGENT_PLAYTEST_2026-10-26.md), count-closed/no-hold carry checks, source pinning, per-inhabitant raw results and stop-on-violation behaviour apply.

Every active inhabitant has the same zero-cost daily opportunity, including roleless residents and people with zero wealth. The independent `dailyOracle` action is `"enter"` or `null`; it must be null during commit. With postcards enabled, decisions have eight fields. The existing `oracle` field remains the separate paid lottery/voucher choice. Agents can take both, either or neither.

The canonical economic-health win curve stays at 5–30%. Conditional reward probabilities use normalized log weights interpolated by squared normalized health; common rewards remain more likely than rare, and improved health cannot worsen the ordered distribution. These are chances, not a guaranteed winner or a population quota. The whole active roster's maximum possible prize is reserved before any draw. Insufficient trial funds refuse the day's menu rather than excluding later participants or reducing their promised prizes.

Daily awards resolve in stable roster order before the ordinary economic tick. Payouts enter the actual person's wealth, follow existing role changes and migration accounting, and do not grant standing or eligibility. Applicable existing Baker/Miller caps route prize overflow to the district pool. The ledger tracks the declared initial treasury, remaining funds, actual awards and cap overflow; unused daily reservations return to the treasury. Existing default cap coverage is not broadened.

The inhabitant view shows the public health, current chances and rewards, and only that person's previous result. Treasury, canonical IDs, RNG state, receipts and world metadata remain operator-only. Raw evidence records the complete daily ledger and the submitted choices; replay reconstructs the same results. Existing v1 and postcard-only v2 modes remain available without the Oracle profile.

This slice provides a usable Oracle behaviour test. Temporary role or migration opportunities, ticket forging, signed reputation, monuments and universal caps remain separate subsequent work. No actual model call or private financial/credential read is performed by implementation verification.
