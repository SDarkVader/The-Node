# Recovery and continuation

Updated 2026-10-23. Start with [CURRENT_SESSION](CURRENT_SESSION.md),
[the fresh-session guide](GITHUB_FIRST_CONTINUATION.md) and
[the current experiment](../research/CURRENT_EXPERIMENT.md).

The live reasoning-continuation pilot is stopped at a verified tick-18 checkpoint after 36 paid
decisions. Exact own signed histories, the original world, deterministic replay and accounting
were preserved. [Readable results](../research/CONTINUATION_PILOT_RESULTS_2026-10-23.md) and
[sanitized evidence](../research/evidence/reasoning-continuation-live-extension-2026-10-23.json)
are accessible in the repository's development branch. The authority-attribution study is separate
and paused. Nothing is running in the background.

## Current recovery mechanisms

- [GitHub-first session context](GITHUB_FIRST_CONTINUATION.md): committed source and sanitized handover.
- [Local development-session snapshots](DEVELOPMENT_SESSION_RECOVERY.md): preserve unpublished work;
  lifecycle hooks need local review/trust, while manual commands work independently.
- [Live experiment continuation](../research/REASONING_CONTINUATION_2026-10-23.md): verified
  parent-linked checkpoints reconstruct the exact world and histories and require the matching journal.
- [Documentation index](../README.md): current pages, design sources and historical evidence.

Private state does not follow a Git clone. Never invent missing state, reset spending or repeat
consumed calls. Read the latest checkpoint before any new work. Missing features and issues to
resolve are further work, not limitations on the programme's future.

## Historical recovery records

The October 17–22 documents below record their own stages. Their branch names, remaining
allowance counts, missing-integration claims and no-paid-call statements are dated observations,
not the present experiment's status. The original missing implementation was reconstructed;
the history must not be described as byte-for-byte recovery of that original source.

- [Recovered experiment description](EXPERIMENT_FIRST_INHABITANT.md), [protocol](EXPERIMENT_BROKER_PROTOCOL.md),
  [first-pass record](EXPERIMENT_FIRST_PASS_RESULTS.md), [original safeguards](EXPERIMENT_EVALS_AND_SAFEGUARDS.md).
- [Broker reconstruction](BROKER_RECONSTRUCTION.md), [participant integration](OFFLINE_INTEGRATION_STATUS.md),
  [local transport](LOCAL_TRANSPORT_REVIEW.md), [checkpoint mechanics](CHECKPOINT_RECOVERY.md),
  [durable execution](DURABLE_FIXTURE_RECOVERY.md).
- [Historical accounting inventory](ACCOUNTING_RECOVERY_INVENTORY.md),
  [reconciliation proposal](ACCOUNTING_RECONCILIATION_PROPOSAL.md),
  [accounted rebuild](BROKER_ACCOUNTING_REBUILD.md), [synthetic accounting](SYNTHETIC_ACCOUNTING.md).
- [Provider rebuild](PROVIDER_ADAPTER_REBUILD.md), [metadata compatibility](RESPONSE_METADATA_COMPATIBILITY.md),
  [initial game turns](INITIAL_GAME_TURN.md), [initial budget](INITIAL_TEST_BUDGET.md).
- [Rules review](RULES_REVIEW_2026-10-18.md), [rules-aware context](RULES_AWARE_CONTEXT.md);
  the later [A01 contract](../research/DIARY_CONTRACT_A01.md) and v2 implementation govern the
  current diary and recognition path.
- [Development audit](DEVELOPMENT_BRANCH_AUDIT.md), [main consolidation](MAIN_CONSOLIDATION_2026-10-20.md),
  [PR #21 review](PR21_REVIEW_2026-10-20.md), [October 22 handover](CODEX_HANDOVER_2026-10-22.md).
- [Historical credential support report](CREDENTIAL_BINDING_SUPPORT_REPORT.md): an old failed
  diagnostic, not a current test of the working live continuation credential.

The three original accounting-origin documents and price evidence are retained unchanged because
their contents participate in historical provenance. Missing original billing evidence is not
silently replaced by later successful calls. Actual private journals carry their history intact.
