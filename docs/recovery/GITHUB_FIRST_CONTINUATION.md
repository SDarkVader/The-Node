# GitHub-first continuation — The Node

Updated 2026-10-20. This is the cross-device entry point for a **new ChatGPT, Codex, PC, phone or cloud checkout**. GitHub is the shared source of code and sanitized development context; a local PC checkout is optional.

## Start from GitHub, not a previous chat or PC

Repository: `SDarkVader/The-Node`. Current development branch: `broker-rules-context-2026-10-18`. Verify the live branch HEAD with Git before work; do not assume a hardcoded commit is the current HEAD. Read `AGENTS.md`, `docs/recovery/CURRENT_SESSION.md`, this file, and the relevant feature evidence. Treat the user's current task as authoritative. Do not require local `.codex/session-recovery/` files, a running PC, prior conversation memory or trusted Codex hooks to understand the GitHub checkout.

The local recovery hook is optional convenience for uncommitted work on the *same machine*. It is not the cross-device transport. Only committed/pushed files are shared; ignored local patches, private data, secret bindings, runtime game checkpoints and local account ledgers **do not follow** a GitHub clone. Never infer that they have been transferred.

## Current code and verification

PR #21 is merged into the development branch at `2941067`, with the same tracked
tree as reviewed `298b636`. Latest full evidence: 1188 Vitest, TypeScript, 18 Python,
7 recovery and 80 native checks; two 29-sample Inspect runs with exported replay.
See [PR #21 review](PR21_REVIEW_2026-10-20.md) for commands and limitations.
Those results were verified before this documentation refresh, not rerun by it.
The post-merge checkpoint branch mismatch is corrected in CURRENT_SESSION.md.
The next integration task is to audit and consolidate development into `main`.
Root [README](../../README.md) is the current overview; update it with the checkpoint.
The [accounted-agent design](../DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md) is
tracked for cross-device continuity; execution remains disabled.

The branch includes the TypeScript simulation and broker under `src/`, Godot client under `client/`, and deterministic tests under `test/`. Current rules-aware context lives in `src/agent/rulesContext.ts`, `rulesAwareContext.ts`, `observationTables.ts`, `responsesRequest.ts` and `offlineRulesEvaluation.ts`. Detailed implementation, source boundaries and reproducible evidence: [RULES_AWARE_CONTEXT](RULES_AWARE_CONTEXT.md). Its historical stage reported 1,143 Vitest + 80 native checks, TypeScript passing, and a deterministic bounded-memory fixture (8/8 with diary, 4/8 without, 8/8 replay-restored). These are **reported historical runs**, not independently rerun here and not proof of real-model strategy.

The Windows GitHub Actions workflow `.github/workflows/session-recovery-ci.yml` completed successfully at [run 39141127029](https://github.com/SDarkVader/The-Node/actions/runs/39141127029) after full-history checkout was enabled. It verified the Git-tracked recovery anchor, executed the hook-start script, tested recovery and typechecked. It **did not** verify an interactive Codex app automatically invoking hooks, and it did **not** test whether an agent can continue a substantive task. Check its run SHA when interpreting that result.

## Scientific and operational boundaries

Read [RULES_AWARE_CONTEXT](RULES_AWARE_CONTEXT.md), [RULES_REVIEW_2026-10-18](RULES_REVIEW_2026-10-18.md), [INITIAL_GAME_TURN](INITIAL_GAME_TURN.md), and [INITIAL_TEST_BUDGET](INITIAL_TEST_BUDGET.md) before changing the agent experiment. The current diary/event-mark contract is not implemented automatically; restricted trespass transactions remain incomplete. Actual held-out multi-turn model comprehension has not been established. Do not treat old composed diary actions as automatic event marking.

Some older documents (including `docs/HANDOVER.md` and `EXPERIMENT_FIRST_PASS_RESULTS.md`) contain **dated stages and older checkout descriptions**. Do not interpret their 'CURRENT' banners as the current branch state. Reconcile conflicting claims against Git, actual source, tests, and the latest scoped evidence. Historical original ledger gaps and holds must not be erased or replaced with zero. A successful earlier private two-tick experiment is not a portable game checkpoint. **Do not run paid model calls, initialize or reset allowances, or claim private experimental state is available from GitHub.** Obtain explicit authorization and actual private state through approved secure channels before any live work.

## Continuation contract

For each new task: inspect the live branch and exact relevant source; identify the requested change and protected invariants; implement and verify the smallest coherent change; distinguish actual test results from historical reports; update the Git-tracked `CURRENT_SESSION.md` and this handover when facts change; commit and push sanitized results to the agreed development branch. If writes cannot be performed, report that plainly and supply the patch. Do not silently change branches, merge to main, launch actors, use paid APIs, or substitute a local recovery test for the user's GitHub-first requirement.

**Known limitations:** GitHub alone cannot recover unpublished local edits, ignored runtime state, private credentials or the original missing historical ledger. The presence of source and notes proves portability of documented context, not automatic injection of those notes into every ChatGPT conversation. A new agent must read the files through its available GitHub access.
