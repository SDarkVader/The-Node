<!-- NODE_SESSION_CHECKPOINT
{
  "format": "the-node-git-session-checkpoint",
  "version": 1,
  "branch": "main",
  "verifiedBaseCommit": "a7591824f467759d227835c50a00691d9539501a",
  "completedWork": [
    "2026-10-21 (late night): PR #31 opened. Fixed a study-breaking request-size blocker (v2 requests at 32,756 of the 32,768-byte fail-closed ceiling) with 64-bit v2 observer references (max ~26 KB now; headroom regression test); freeze pins moved a second time (bytes only). identityResolved no longer sends the raw player id. Cheaper-model research running; owner has an RTX 4070 Ti Super (16 GB), 64 GB RAM, Ryzen 7 7800X3D for local models.",
    "2026-10-21 (night): owner directed that study 1 depends on the viable solution and must not start with known issues. Closed the v2 data blockers (protected protocol.ts Grifter gate via DecisionContext.rules 'v2', owner-authorised; decision schema; person-owned speech/diary across role changes; rules text v2; workplace Courier pay) and rebased study 1 onto authority contract 1.1.0 (design.world.recognition 'v2'): contract snapshot, manifest and freeze pins moved once, deliberately. Tests updated to the v2 baseline; G1 history untouched.",
    "2026-10-21 (evening): recognition v2 and individual dealings implemented as an opt-in rules version (WorldConfig.recognition = 'v2'; engine/recognition.ts, engine/dealings.ts; world.ts, observer.ts, responsesRequest.ts, worldProtocol.ts). Default v1 is byte-identical. Owner postponed study 1 until reactivated; runbook, README, register, A01, EVAL_INFRASTRUCTURE and this checkpoint updated. PR #30 merged at a759182.",
    "2026-10-21: user merged PR #29 (recognition v2 first and second pass) at 90b4954; tree identical to reviewed head b8c46bd. Post-merge review (the automated review workflow stopped on a session limit before any reviewer finished, so checks were run directly): corrected three overstated or stale claims in the simulation note and DEVLOG (6-9 Bakers in post, not 'roughly 9'; 22 spot-checked facts, not 21; 17 tests and 16 killed mutations, not 11 and 6). No relative link broken; no number in the evidence report changed.",
    "2026-10-21 (later): recognition v2 second pass on the owner's statements (resolution can be lost; role holders must interact with customers; speaking is optional; refusal is a signal; deception is also interpretation). Grounded by read-only investigators. Harness extended with a capped, hysteretic ledger, perceived refusal, a modelled customer channel and intended/heard intent; first-pass report reproduced byte for byte. Results and open questions Q1-Q5 in RECOGNITION_V2_SIMULATION_2026-10-21.md. Dated notes on the superseded design passages; A01 records the decisions. Found: courier pay follows current position, contrary to the live rules text and the binding decision; recorded as a study-1 limitation in the runbook.",
    "2026-10-21: recognition v2 run in simulation before building (docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md; src/sim/recognitionV2Harness.ts; npm run recognition-v2-sim). Shadow ledger over real kernel hearings; nothing written back, study 1 unaffected. Found: the literal spec credits silent bystanders (one utterance reaches a median 39 listeners), address must be judged by intent, a permanent ledger saturates, pressure amplification would collapse unless decoupled, and Grifter churn is high. Recommended rule I1D pending owner decisions R1-R5. PR #28 (A01) merged by the user at e2ff353.",
    "2026-10-20: PR #27 merged at 022c0bf. A01 diary contract v1.0.0 (docs/research/DIARY_CONTRACT_A01.md, src/eval/constructs/diaryContract.ts, evals/contracts/diary.v1.json). Owner decisions: the diary is a daily measured task; Grifters have a diary; everyone has an abode; trespass reveals full entries; recognition is not immediate or easy (10-20 days of dealings: proximity conversations, trades/deliveries, campaign cooperation; weak partial credit for overheard Wall posts; shared district does not count); Grifters hear district Wall posts and speak/hear proximity where they stand. Evaluator classifier built. Study-1 freeze test pins request bytes, contract and manifest. Superseded notes added to the 2026-08-06 addendum, the 2026-10-18 rules review and housing section 7.3.",
    "2026-10-20: user merged PR #26 into main at 9d004e8 (merge commit). Its tracked tree is identical to verified head c59dd70 (tree fed816c); a clean main checkout passes tracked recovery. This follow-up docs change uses the same task branch, restarted from main, as its one reviewBranch.",
    "2026-10-20 PR #26 opened (ccr-8d64b59c-a4puhv -> main). Hosted CI found and the branch fixed: research-conformance checked out the PR merge commit detached (recovery:verify correctly refused; now checks out the head branch by name, as main-integration does; 2407e4b); the runner's response deadline counted local journal writes (Windows failure in run 39512361278; now ends at response receipt, with a slow-ledger regression test); reservations stored full decision contexts (~7.8 KB/call, ~5.6 MB per study of the 8 MiB journal) and now store participant identity plus request-bytes hash (~0.9 KB/call, 0.66 MB for 714 calls); a fixture race made a TEST-ONLY 24 h window 24 h + 1 ms (7f7bef9).",
    "2026-10-20 G3 (owner decisions: capped batch runner, USD 5 first allowance, gpt-5.4-nano-2026-03-17; D1 resolved as a measured daily diary task, with the earlier unprompted-only and marks-only rules superseded and manipulation permitted). Built ExperimentBudget (carries the closed 18 Oct allowance unchanged; operator settlement books unknown outcomes at the full ceiling), buildEvaluationRequest, runAccountedStudy (fail closed, pacing, resume by attempt), study manifest authority_attribution_study_1 (15 episodes, 630 calls, 714 admitted, USD 5), scripts build-study-runtime / prepare-experiment-budget / run-accounted-study / settle-failed-call, analyze_study, and the Thursday runbook docs/research/RUNBOOK_AUTHORITY_STUDY_1.md. No API call made.",
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
    "2026-10-21 (late night, Linux): Vitest 1286/1286; Python 28/28; G1 29/29; G2 12/12; freeze 4/4 at the re-pinned bytes.",
    "2026-10-21 (night, Linux): Vitest 1285/1285; Python 28/28; G1 29/29 vs main-consolidation-2026-10-20; G2 constructs 12/12 fixture checks, 9 deterministic; accounted-study rehearsal 8/8 on the v2 manifest; study-1 freeze 4/4 at the new pins.",
    "2026-10-21 (evening, Linux): full Vitest 1279/1279, TypeScript, Python 28/28; G1 verify 29 deterministic and replay-verified, compare_hashes 29/29 equal to main-consolidation-2026-10-20; G2 constructs deterministic; study-1 freeze 4/4. test/world.recognitionV2.test.ts 19/19 with 10 kernel mutations killed. v1 vs v2 over 10 seeds x 300 days: bread unchanged (paired +2.6, SD 44), settlement residual ~3e-12 both, mean FILLED Baker wealth +5.0 (+14%, paired SD 4.8), Gini -0.019 (n.s.).",
    "2026-10-21 (later): recognition-v2 tests 17/17; 10 further mutations (cap, hysteresis, refusal answer/direction/window, custom credit, baker-side purchase, customer RNG isolation, heard intent, loyal weekly cycle) each fail at least 1 test. Courier probe: 5-day courier earnings 0.71 staying, 2.61 walking away from the hub.",
    "2026-10-21 on top of e2ff353 (Linux): recognition-v2 tests 11/11; mutations (ignore intent, widen exchange window, drop decay, drop address requirement, Grifter hears rejected talk, drop modelled Grifter speech) each fail at least 1 test. Shadow v1 vs kernel: 694 pairs, 0 mismatches. Full-suite and freeze-test results for this head are recorded in the commit/PR, not claimed here.",
    "2026-10-20 A01 on top of 022c0bf (Linux): diary contract tests 12/12 (179 kernel-confirmed writes, 142 supported rumour claims in the faithful run; mutations forcing eligibility and inverting grounding fail 3 and 2 tests); study-1 freeze 4/4, and a one-character rules-text change fails 3 of them.",
    "2026-10-20 post-merge: Hosted CI on the merged head c59dd70: Main integration verification run 39513742598 (Windows, required offline-verification, including 80 native broker/participant checks) and Research conformance runs 39513742596 (PR) and 39513736363 (push) all passed. Fresh clean main checkout at 9d004e8: recovery:verify ok. No full regression rerun is claimed for this documentation-only follow-up.",
    "2026-10-20 at 7f7bef9 (Linux): 1227/1227 Vitest across 97 files, TypeScript, 28/28 Python, CLI rehearsal 8/8; accounted-study tests 5/5 repeated runs green. Hosted: research-conformance push run 39512193563 on 8f428d6 passed every step on Ubuntu/Node 24/Python 3.14 (G1 hashes 29/29, G2, G3 rehearsal); the PR-event run and Windows main-integration run 39512361278 failed for the two defects fixed above. Results on the fixed head are reported by CI, not claimed here.",
    "2026-10-20 at a32f4bc (Linux, Node 22.22.0, Python 3.13.16): 1226/1226 Vitest across 97 files, TypeScript, 28/28 Python; CLI rehearsal 8/8 (real scripts, TEST-ONLY fake transport: normal run, injected HTTP 429, settlement, resume, analysis); 29-sample verify 29/29 hashes identical to archived 8281db6; constructs verify 9 deterministic, 12/12. Mutation dispatch-before-reservation fails 7 tests.",
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
    "Study-path design choices still open: a proximity address to someone out of range is admitted by the validator and dropped by the kernel (documented to agents; not a measured effect in study 1); study 1's 6-tick episodes cannot show recognition-dependent behaviour (first resolution takes ~10+ days); Courier commissions and multi-member campaigns do not exist (delivery/evidence attribute existing flows). Repeat custom raises mean Baker wealth ~14%.",
    "Study 1 not yet run: postponed on 2026-10-21 (it was planned for 2026-10-22) until the owner reactivates it; it runs on the PC with the credential and private allowance and stays frozen until then. If the owner's gpt-5.4-nano TPM limit is below ~300k, raise minIntervalMs in the manifest and commit before preparing the allowance.",
    "Authority contract v1.0.0 is one seed and not preregistered; G5 must freeze hypotheses, held-out seeds and analysis. The owner authorised study 1 (USD 5, 630 calls) on 2026-10-20 as a separate allowance; the historical ten-request ceiling belonged to the closed 18 Oct allowance and is carried, not reused.",
    "Eval harness: Inspect itself still refuses live models; live calls run only through the TypeScript accounted study runner (src/eval/accountedRunner.ts) and its ExperimentBudget. ControlArena/AgentDojo are reimplemented as patterns, not installed packages; Concordia is not integrated; scorers and monitor are deterministic rules; RMF thresholds are illustrative.",
    "Settlement: currency option A/B/C is still the user's decision; whether funded settlement's halved Gini (0.68 -> 0.32) is the intended feel; growing past SHARD_COUNT_CAP (3) shards is a design decision, not built.",
    "Codex project hooks require review/trust in /hooks before automatic lifecycle execution; manual recovery commands work independently.",
    "Automatic mechanically generated diary connections and non-editing player event marks are not implemented.",
    "Complete restricted trespass transactions, including key provenance/consumption, authoritative absence, and witness consequences, remain unimplemented.",
    "Actual model comprehension and held-out live multi-turn strategy remain untested; no paid calls were made.",
    "Cross-device GitHub clones cannot recover unpublished local changes, private experimental runtime state, credentials, or missing original accounting evidence."
  ],
  "nextSteps": [
    "Owner: when reactivated, run study 1 per docs/research/RUNBOOK_AUTHORITY_STUDY_1.md (postponed on 2026-10-21); share study1-analysis/results.json and summary.md.",
    "When the owner reactivates study 1: run it per the runbook on contract 1.1.0 (recognition-v2 baseline). Before a diary/recognition study: decide episode length (recognition needs ~10-20 days of dealings) and its allowance.",
    "G5: add seeds (contract v1.1) and a frozen analysis plan before a larger allowance.",
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

`main` is the shared development line. The user merged [PR #26](https://github.com/SDarkVader/The-Node/pull/26)
at `9d004e8` on 2026-10-20, after its hosted checks passed on head `c59dd70`. Those checks were
Windows Main integration, including the 80 native checks, and both Linux Research conformance
runs. The merged tree is identical to that head, and a clean `main` checkout passes tracked
recovery. PR #27 merged the follow-up at `022c0bf`, and the user merged PR #28 (A01) at `e2ff353`
and PR #29 (recognition v2 simulation) at `90b4954`, and PR #30 at `a759182`. This checkpoint anchors at `a759182` and accepts `main` or the exact task branch
`ccr-8d64b59c-a4puhv`, which carries recognition v2 and study 1 rebased onto it (contract 1.1.0).

PR #26 worked through the owner's [ground-truth register](../research/GROUND_TRUTH_REGISTER_2026-10-20.md):

- **G0:** claims verified against source; owner decisions D1, D2, D3 and D5 recorded.
- **G1:** reproduced on Linux, with byte-identical kernel hashes ([record](../research/G1_REPRODUCTION_2026-10-20.md)).
- **G2:** authority-attribution contract v1.0.0 with seven controlled actors and offline reachability.
- **G3:** an accounted, capped batch runner for the first live study.

**A01** ([diary contract](../research/DIARY_CONTRACT_A01.md)) records the owner's diary, abode,
trespass and recognition decisions. Its evaluator is built. The Grifter gate, recognition model v2
and the new rules text land after study 1; `test/eval.study1Freeze.test.ts` holds study 1's request
bytes until then. Recognition v2 has been run in simulation
([results](../research/RECOGNITION_V2_SIMULATION_2026-10-21.md)): the spec as worded fails, and the
owner's 2026-10-21 statements settle R1–R3, with R4, R5 and Q1–Q5 still open. A courier-pay defect is
recorded as a study-1 limitation in the runbook.

**Next:** study 1 is postponed (2026-10-21) until the owner reactivates it; it then runs from `main` per the
[runbook](../research/RUNBOOK_AUTHORITY_STUDY_1.md): USD 5 cap, `gpt-5.4-nano-2026-03-17`.

D1 is resolved: the diary is a measured daily task, and the earlier unprompted-only and marks-only
rules are superseded. No API call has been made, and no existing accounting file was changed.
Local ignored snapshots are optional and do not imply private runtime or accounting state.

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
