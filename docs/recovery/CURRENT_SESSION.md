<!-- NODE_SESSION_CHECKPOINT
{
  "format": "the-node-git-session-checkpoint",
  "version": 1,
  "branch": "main",
  "verifiedBaseCommit": "afdf39019ae2472b49b6ea6380bede690cf287a3",
  "completedWork": [
    "2026-10-20 ground-truth register v0.1 (owner-supplied PDF, tracked at docs/research/): G0 source-verification annex and owner decisions D1/D2/D3/D5 in docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md; G1 reproduced on Linux at afdf390 with 29/29 kernel hashes byte-identical to archived 8281db6/96a431f evidence (docs/research/G1_REPRODUCTION_2026-10-20.md); G2 authority-attribution contract v1.0.0 with a seven-actor MultiActorEpisode (D3), label-only council/anonymous/none arms, validator-derived feasibility, kernel-evidenced effects, pure exported-record classifier, Inspect task node_authority_attribution and python -m inspect_node.constructs; Linux research-conformance workflow on every push. Branch ccr-8d64b59c-a4puhv; no PR opened.",
    "2026-10-20: user asked how to simplify the GitHub ruleset, then explicitly authorized applying the recommendation. Changed verify ruleset 25489816 from all branches to exact main, kept PRs required, set required approvals to 0 for the solo-maintainer workflow, and required offline-verification from GitHub Actions. Deletion, force-push and code-quality rules and bypass actors preserved. This permanent user-approved configuration supersedes the prior temporary 1-to-0-and-back procedure. PR #24 can now receive normal branch updates; intermediary PR #25 is superseded, not needed for merge.",
    "2026-10-20 user refinement: rewrote the README as a connected research description, following purpose -> concrete simulated society and Baker scenarios -> Inspect/framework methodology -> execution and evidence. Removed the branch-cleanup chronology and repeated limitation lists from the overview. Consolidated experimental interpretation, framework integration gaps, simulation/runtime limits and live-accounting boundaries in docs/EVALUATION_SCOPE_AND_LIMITATIONS.md, linked at the bottom. Existing detailed audits remain historical evidence. PR #24 is revised before its authorized merge; no source/runtime changes.",
    "2026-10-20: reframed the root README opening as an independently designed agent evaluation suite and deterministic simulation testbed, following user direction. Described research into agent hierarchies, authority and behaviour; identified native Inspect AI orchestration, adapted AgentDojo/ControlArena patterns and project-defined NIST AI RMF mapping. Kept scripted validation, one controlled participant, disabled live inference and unimplemented hierarchical coordination explicit. No simulation or evaluation code changed.",
    "2026-10-20: PR #23 merged at 2c8c448; README and branch-cleanup evidence are on main. Its hosted integration run 39461928204 passed. The user separately authorized a temporary required-review count change from 1 to 0 for that merge; it was immediately restored to 1 and verified after editor reload. Other protections were preserved.",
    "2026-10-20: user approved deleting 23 merged remote branches and separately approved a temporary deletion-rule change after initial GH013 rejection. Fresh fetch verified all 23 exact tips unchanged and ancestors of main 4da5301. Atomic SHA-leased deletion succeeded for all 23; exactly main, Godot sky/navigation and Vitest 5 remain with unchanged tips. Restrict deletions was restored immediately, confirmed saved and checked after editor reload; other rules and bypass actors preserved. All deleted commits remain reachable from main and pinned in the cleanup manifest. Local branches/worktrees preserved. The documentation handover uses the exact named review branch because GitHub requires a PR for main updates; no additional protection is disabled.",
    "2026-10-20: user merged PR #22 into main at acb3b2d. Its tracked tree exactly equals verified PR head 1b6684a. Main is now the shared development line; README and continuation reflect the merge and the obsolete reviewBranch allowance is removed from this checkpoint. Unique Godot sky/navigation and Vitest 5 work remain separate.",
    "2026-10-20 PR #22 is open: https://github.com/SDarkVader/The-Node/pull/22, verified development-to-main consolidation. User explicitly chose to keep unique Godot work separate. First hosted run found a deadline fixture reached correct pre-dispatch expiry before its intended stall; made the test clock deterministic and added a separate early-expiry case, preserving all strict assertions and production code.",
    "2026-10-20 main consolidation candidate: integrated existing main 1eb6958 and verified development 320592e, preserving both documentation histories and the existing security fixes. Unique Godot sky/navigation and Vitest 5 work remain separate. Canonical destination is main; the explicit reviewBranch permits the same checkpoint to verify before and after merge. See MAIN_CONSOLIDATION_2026-10-20.md.",
    "2026-10-20 post-merge orientation: PR #21 was merged by GitHub at 2941067; its tracked tree equals independently reviewed 298b636. Root README now has one current overview, source-anchored evidence, current commands, game/evaluation limits and next steps. The accounted-agent/framework design is now tracked in docs/DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md; design only. AGENTS.md and CLAUDE.md require README/checkpoint maintenance together.",
    "2026-10-20 PR #21 independent review: target 41da84f merged into the evaluation branch; both documentation histories and the shard fix preserved. Fixed evaluation-only stale role instructions, failed-integrity scoring, incomplete verifier success, exported JSON replay and Python-source provenance. See docs/recovery/PR21_REVIEW_2026-10-20.md.",
    "2026-10-20: shard availability no longer depends on population: canOpenNewShard's mean-population gate replaced by a population-independent SHARD_COUNT_CAP (3); stability, cooldown and every migration path unchanged. Every seed now reaches 3 shards; seed 1 was stranded at 2.",
    "2026-10-20: funded settlement (default): wealth follows the person through every role change, the dock pays for nodules (WEALTH_PER_NODULE 2.0), wages come from districtPool (floor first), upkeep (0.0073 of holdings) is the sink. 'legacy' mode is byte-identical to the pre-settlement economy.",
    "2026-10-20: createDormantWorld now vacates Import/Export slots (was leaving 6 FILLED at population 0); test/world.dormant.test.ts.",
    "2026-10-20: settlement ledger (src/engine/settlement.ts): every stepWorld wealth write is a named issuance line, an account transfer (oraclePool, districtPool, dock) or emigrant holdings; per-tick residual tested. Standing berths keep at least one Import/Export slot non-VACANT. Transit vouchers carry emigrant holdings across shards; failed crossings go to the source dock. Design: docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md.",
    "Rules-aware agent context derived from the authorized observer and actual game mechanics, including roles, available actions, consequences, information asymmetry, memory decay, and lossless observation packing.",
    "Offline evaluation for interpretation, evidence support, decision validity, bounded memory ablation, replay continuity, and real kernel price effects.",
    "Development-session recovery with local staged/unstaged patch and untracked-file snapshots, branch/commit/worktree verification, and Codex lifecycle hooks. A verified clean fresh checkout creates its local exact-state snapshot at SessionStart.",
    "GitHub-first continuation contract committed at docs/recovery/GITHUB_FIRST_CONTINUATION.md and prioritized in AGENTS.md; PC and local hook are optional for cross-device work.",
    "2026-10-20 (eval branch): Inspect AI safety evaluation harness. src/eval/ (scenarios, episode runner over the unchanged participant pipeline, JSON-lines bridge) and evals/inspect_node/ (scripted policies via offline mockllm, solver refusing live models, 11 independent scorers keeping observed/inferred/not-scorable apart, NIST AI RMF classification, export, verify). See docs/EVAL_INFRASTRUCTURE.md."
  ],
  "testResults": [
    "2026-10-20 at fe4b058 (Linux, Node 22.22.0, Python 3.13.16): 1208/1208 Vitest across 96 files (1189 + 19 new), TypeScript, 25/25 Python (18 + 7), 29-sample verify still 29/29 identical to archived hashes; constructs verify 9 samples deterministic, exported replay + re-classification equal, 12/12 fixture rate checks; mutations M1-M3 killed. G1 at unmodified afdf390: 1189 Vitest, 18 Python, 8 recovery, 29/29/56 Inspect; recovery:verify passes on clean main worktree. 80 native checks not run (no PowerShell).",
    "2026-10-20 README narrative revision: 17 relative links across README and consolidated scope document resolve; checkpoint JSON valid; git diff --check passes. This is documentation verification, not a new behavioural experiment. PR CI must pass on the revised head before merge.",
    "2026-10-20 completed branch cleanup: 23/23 exact-tip and 23/23 ancestry checks passed against main 4da5301. Atomic deletion succeeded for 23 refs after separately authorized temporary deletion-rule change. Remote inventory confirmed exactly 3 unchanged retained heads. Saved deletion protection restored and verified after reload; other rules preserved. 8/8 session-recovery tests, 38 relative documentation links and git diff --check pass. No runtime changes or new full regression run.",
    "2026-10-20 merged-main verification: fresh clean main checkout at acb3b2d passes tracked recovery. Hosted integration run 39456555818 and dependency audit 39456555781 passed on identical-tree 1b6684a: 1189 Vitest, TypeScript, 18 Python, 80 native, 8 recovery and two deterministic 29-sample Inspect runs with exported replay. No full regression rerun is claimed for this post-merge documentation update.",
    "2026-10-20 PR #22 CI correction: hosted run 39455761722 failed 1/1188 tests (expected deadline_or_cancelled_after_accounting, actual deadline_before_dispatch); later hosted steps skipped. Hosted dependency audit passed. Corrected fixture: focused 12/12 and full 1189/1189 Vitest plus TypeScript pass locally. Production/evaluation code unchanged; see MAIN_CONSOLIDATION_2026-10-20.md for exact evidence.",
    "2026-10-20 main consolidation candidate: 1188/1188 Vitest across 95 files, TypeScript, 18/18 Python unit tests, 80/80 native checks and 8/8 recovery tests passed. Two 29-sample Inspect runs match state hashes/event digests, with 56/56 fixture checks and 29/29 in-memory/exported replay each. No live models, paid inference or accounting reset. Hosted main/PR CI added; completion is unclaimed until GitHub reports it.",
    "2026-10-20 documentation refresh: 7/7 session-recovery tests passed; 25 local documentation links and README npm-script references checked; no runtime/test/dependency changes. At 2941067 a real clean development-branch clone failed recovery with exit 2 because the checkpoint named inspect-safety-evals-2026-10-20; corrected destination metadata. Prior full game/evaluation results below were not rerun by this documentation change.",
    "2026-10-20 PR #21: 1188/1188 Vitest (95 files), TypeScript, 18/18 Python tests, 7/7 recovery, 80/80 native checks against target 41da84f. Two Inspect runs: 29/29 matching state hashes and event digests; 29/29 in-memory and exported replays in each run; 56/56 fixture checks each; CLI control task 2/2. Scripted infrastructure evidence only; no live models, model APIs, paid inference or real-account resets.",
    "2026-10-20 shard availability: 1177 Vitest + TypeScript + 7/7 session recovery pass; restoring the old population gate fails 9 of the new/rewritten tests. multi-shard-validation: all 3 seeds reach 3 shards (mean 254.4 people).",
    "2026-10-20 funded settlement: 1170 Vitest and TypeScript pass. The full suite also passed with legacy as default; the legacy golden matches the original snapshot exactly. settlement-report legacy -> funded: new money 45.79 -> 6.27/tick, role-change losses 37.86 -> 0, Gini 0.68 -> 0.32, health 0.905 -> 0.914; multi-shard 7/8 seeds equal or higher (seed 1 shard-opening knife edge, pre-existing).",
    "2026-10-20: 1162 Vitest across 94 files and TypeScript pass; golden world snapshot unchanged. The 80 native checks were not run (they need private baseline paths absent from a fresh clone).",
    "2026-10-20 npm run settlement-report (8 seeds x 3000 days): issuance 45.79/tick, implied k 2.02 per nodule, 82.7% of issuance forfeited at role transitions, standing berth fired 0/20000 populated ticks.",
    "npm run test:session-recovery: 7 passed, 0 failed, including a clean fresh-checkout test using only the Git-tracked handover.",
    "npm run typecheck: passed.",
    "node --check scripts/session-recovery.mjs: passed.",
    ".codex/hooks.json JSON parse and Windows session-start command: passed.",
    "Rules-context stage: 1,143 Vitest tests across 92 files, 80 native checks, and TypeScript passed; 26 focused rules/request tests passed after final edits.",
    "GitHub Actions Windows fresh-checkout recovery workflow passed at run 39141127029 (commit 3b8ccd7); this verifies script behavior, not interactive Codex hook invocation.",
    "2026-10-20 eval harness at 3512ded: python -m inspect_node.verify ok (29 samples, two runs, 29/29 identical state hashes and event digests, 29/29 replay verified, 56/56 fixture agreement checks, every model mockllm); 13/13 Python unittest; 1179 Vitest, TypeScript, 7/7 session-recovery. Evidence: evals/evidence/scripted-fixtures-2026-10-20/. 80 native checks not run (private paths)."
  ],
  "unresolvedIssues": [
    "D1 diary decision (mandatory daily menu entry chosen by the agent) conflicts with DESIGN_ADDENDUM_2026-08-06 'creation is unprompted-only' and RULES_REVIEW_2026-10-18 principle 4 (game creates content; players only mark); owner confirmation and four sub-questions in GROUND_TRUTH_REGISTER_2026-10-20.md section 7 block A01.",
    "Authority contract v1.0.0 is a G2 fixture contract on one seed, not preregistered; G5 must freeze hypotheses, held-out seeds and analysis. 42 model calls per episode exceeds the historical ten-request ceiling, so a G4 pilot needs a reduced, separately authorized manifest.",
    "Eval harness: live model runs are refused until Inspect's model calls are routed through the accounted broker and budget ledger (not built). ControlArena/AgentDojo are reimplemented as patterns, not installed packages; Concordia is not integrated; one controlled Baker per episode; scorers and monitor are deterministic rules; RMF thresholds are illustrative.",
    "Settlement: currency option A/B/C is still the user's decision; whether funded settlement's halved Gini (0.68 -> 0.32) is the intended feel; growing past SHARD_COUNT_CAP (3) shards is a design decision, not built.",
    "Codex project hooks require review/trust in /hooks before automatic lifecycle execution; manual recovery commands work independently.",
    "Automatic mechanically generated diary connections and non-editing player event marks are not implemented.",
    "Complete restricted trespass transactions, including key provenance/consumption, authoritative absence, and witness consequences, remain unimplemented.",
    "Actual model comprehension and held-out live multi-turn strategy remain untested; no paid calls were made.",
    "Cross-device GitHub clones cannot recover unpublished local changes, private experimental runtime state, credentials, or missing original accounting evidence."
  ],
  "nextSteps": [
    "Owner: answer the D1 questions (register section 7) before A01 is written.",
    "G3: accounted custom-provider adapter with execution disabled (synthetic ledgers, loopback responses, crash/failure injection), per DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md.",
    "G5 protocol for authority attribution: held-out seeds, arm-order randomization, exclusions, episode-level uncertainty.",
    "Continue separate review of the Godot sky/navigation branch and Vitest 5 upgrade when directed.",
    "Continue the tracked accounted-agent/framework design only when directed, with execution disabled; maintain README/checkpoint together and preserve private accounting evidence."
  ],
  "privateCredentialsOrExperimentalInputsIncluded": false,
  "reviewBranch": "ccr-8d64b59c-a4puhv"
}
NODE_SESSION_CHECKPOINT -->

# Current development checkpoint

**Task branch `ccr-8d64b59c-a4puhv` (2026-10-20), from main `afdf390`.** Works through the owner's
[ground-truth register](../research/GROUND_TRUTH_REGISTER_2026-10-20.md):

- **G0:** claims verified against source; owner decisions D1, D2, D3 and D5 recorded.
- **G1:** reproduced on Linux, with byte-identical kernel hashes ([record](../research/G1_REPRODUCTION_2026-10-20.md)).
- **G2:** authority-attribution contract v1.0.0 with seven controlled actors and offline reachability.

The checkpoint names this branch as its one `reviewBranch`. Open for the owner: the D1 diary
decision conflicts with two earlier documented rules (register §7). No live inference, credentials
or accounting changes.

`main` is the shared development line. The user merged PR #22 at `acb3b2d` on
2026-10-20. Its tracked tree matches verified PR head `1b6684a`; hosted integration
and dependency checks passed. This checkpoint anchors at the subsequent PR #23 merge `2c8c448` and accepts
main or the exact docs/evaluation-suite-overview-2026-10-20 review branch for
the evaluation-suite README update. Completed review-branch allowances are removed.
Local ignored snapshots are optional and do not imply private runtime/accounting state.

## Cross-device continuation

GitHub is the shared development source; read [GITHUB_FIRST_CONTINUATION.md](GITHUB_FIRST_CONTINUATION.md) first. Local Codex hooks and ignored patch snapshots are optional machine-specific recovery, not prerequisites for phone/cloud continuation. Historical results below are not rerun by this documentation update. Windows CI run 39141127029 passed recovery script, tests and typecheck, but did not prove interactive Codex context injection.

## Completed work

- Rules-aware agent context uses the existing authorized observer projection and
  actual game mechanics. It covers role duties, permissions, economic relationships,
  consequences, information asymmetry and memory decay without expanding the view.
- Offline evaluations cover interpretation, source support, decision validity,
  narrow legitimate-memory ablation, replay continuity, and actual kernel price
  effects. Results are deterministic fixtures, not evidence of model intelligence.
- Session recovery verifies the local branch, commit and working-tree fingerprint;
  saves staged and unstaged patches and untracked files locally; and provides
  startup, edit, compaction and handover hooks. It never restores or commits files
  automatically.
- The validated broker, deterministic kernel, accounting and replay were preserved.
  No paid API calls were used.

## Test results

- Recovery mechanism: 7 tests passed, including clean fresh-checkout recovery from the
  tracked handover alone; repository TypeScript, script syntax, hook JSON
  parsing, and Windows session-start command passed.
- Rules-context stage: 1,143 Vitest tests across 92 files, 80 native checks and
  TypeScript passed; final focused rules/request tests passed 26/26.
- In the bounded memory fixture, current legitimate diary scored 8/8, ablated diary
  4/8, and replay-restored diary 8/8. This is not a model intelligence result.

## Settlement work (2026-10-20)

- `createDormantWorld` now vacates Import/Export; `test/world.dormant.test.ts` failed 4/5 before
  the fix and passes 5/5 after.
- `src/engine/settlement.ts` makes the flow-balance invariant exact and tested every tick. It
  adds standing berths (Import/Export is never fully VACANT) and transit vouchers across
  shards. See `docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md`'s build status and
  `npm run settlement-report`.
- 1162 Vitest and TypeScript pass, and the golden snapshot is unchanged. The 80 native checks
  were not run (private baseline paths needed).
- Then funded settlement became the default: wealth follows the person, upkeep is the sink,
  the dock pays for nodules, and wages come from the pool. Before → after: new money 45.79 →
  6.27 per tick, losses at role changes 37.86 → 0, Gini 0.68 → 0.32. 'legacy' mode stays
  byte-identical. Open: currency option A/B/C, and whether the lower Gini is intended.

## Evaluation harness (2026-10-20; original evaluation-branch evidence)

- Inspect AI drives one controlled Baker per episode through the unchanged participant
  pipeline (`src/eval/`, `evals/inspect_node/`). Scripted policies run through Inspect's
  offline `mockllm`; the solver refuses any other model.
- `python -m inspect_node.verify` at `3512ded`: 29/29 samples deterministic across two runs,
  29/29 replays verified, 56/56 fixture agreement checks, no live model. 13/13 Python tests.
  Evidence: `evals/evidence/scripted-fixtures-2026-10-20/`.
- Blocker for any real-model result: routing Inspect's model calls through the accounted
  broker and budget ledger (unbuilt). See `docs/EVAL_INFRASTRUCTURE.md`.

## Unresolved issues

- Project lifecycle hooks must be reviewed and trusted in Codex `/hooks` before they
  run automatically. Manual `recovery:verify` and `recovery:capture` commands work.
- Automatic mechanically generated diary connections and non-editing event marks
  remain unimplemented; the legacy diary action remains.
- Full restricted trespass transactions, including key provenance/consumption,
  authoritative absence and witness consequences, remain unimplemented.
- Live model comprehension and held-out multi-turn strategy have not been tested.
  No paid call is authorized by this checkpoint.

## Exact next steps

1. Main is canonical and the 23 merged remote branches are deleted. Deletion
   protection is restored. Keep the Godot sky/navigation and Vitest 5 branches
   separate for review when directed.
2. Follow the tracked [accounted-agent/framework design](../DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md)
   for later evaluation work. It is a design, not an enabled live backend.
3. Update root README and this checkpoint together after meaningful work. Manual
   recovery commands work independently of optional trusted project hooks.

## PR #21 independent review (2026-10-20)

PR #21, including target `41da84f`, is now merged into the shared development branch at `2941067`. The population-dependent shard-opening defect is resolved; the remaining shard limit is the deliberate cap of three. Both conflict histories are retained. See [PR21_REVIEW_2026-10-20](PR21_REVIEW_2026-10-20.md) for reproduced failures, evaluation-only fixes, command evidence and experimental limitations. Current totals: 1188 Vitest, 18 Python, 7 recovery and 80 native checks; two 29-sample Inspect runs with exported replay. No live inference or accounting reset.
