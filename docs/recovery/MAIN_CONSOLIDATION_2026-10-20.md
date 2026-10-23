> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Main consolidation and branch audit — 2026-10-20

Status: PR #22 merged into main at `acb3b2d` on 2026-10-20. Its tracked tree equals verified PR head `1b6684a`. All 23 approved merged remote branches are now deleted; deletion protection is restored. Main and the two separate Godot/Vitest 5 branches remain.

## Integration boundaries

- Existing main: `1eb6958` (four commits outside development, including the existing dependency-security merge and README/history updates).
- Development input: `320592e` (PR #21, settlement/shard fixes, broker/accounting/participant reconstruction, current README and recovery repair).
- Review branch: `consolidate-main-2026-10-20`; destination: `main`.
- The three merge conflicts were README.md, docs/DEVLOG.md and docs/HANDOVER.md. Both histories are retained, with the current README and checkpoint taking precedence over dated banners.
- The merged src/, client/, evals/, package.json, package-lock.json and vitest.config.ts match development exactly. The existing main security changes are preserved; a separate major Vitest upgrade is not mixed in.
- Additional changes are consolidation documentation, an exact named-review/destination recovery contract and its regression, a main/PR offline CI workflow, and removal of an inherited blank line at the end of a PowerShell script. No game mechanics or live gate changed.

## Actual checks

| Check | Result | Scope |
|---|---|---|
| Development README refresh | Pushed at 320592e | 25 local links, npm commands, 7 recovery tests; fresh clean development clone now passes |
| Recovery before repair | Reproduced exit 2 at 2941067 | Wrong evaluation-branch checkpoint on development |
| Consolidation recovery regression | 8/8 passed | Actual fresh clone also verified candidate and main at 8281db6; unrelated clean branch rejected with exit 2 |
| Full Vitest and typecheck | 1,189/1,189; TypeScript clean after the test-only deadline correction | Full offline regression on merged candidate |
| Python evaluation unit tests | 18/18 passed | No model requests |
| Two Inspect runs and exported replay | 29/29 deterministic; 56/56 checks and 29/29 exported replays per run | Scripted calibration only |
| Native checks | 80/80 passed | Actual local funded baseline 41da84f; new CI uses equivalent reviewed 320592e baseline code |
| Runtime/dependency comparison with development | No differences | src/, client/, evals/, package.json/lock and Vitest config |
| Hosted CI | Integration 39456555818 and dependency audit 39456555781 passed on 1b6684a | Main push and main-targeting PRs; Node, Python, native, recovery and two offline Inspect runs |

The new checkpoint has canonical branch main and one explicit reviewBranch. This avoids changing branch metadata again on merge while retaining exact branch and ancestor checks. It is not an arbitrary branch bypass. The new workflow checks out the named PR branch so it can verify that contract. Existing historical stage workflows are retained.

## Branch disposition

The snapshot contains 25 remote branch heads. Twenty historical tips are already ancestors of development; after a regular merge of this candidate they also become ancestors of main. These are deletion candidates, not deletion instructions. Keep them until the main integration is actually merged and final reachability is rechecked.

| Historical branch | Recorded tip |
|---|---|
| `broker-accounting-rebuild-2026-10-17` | `70132cf` |
| `broker-affordance-stability-2026-10-17` | `7eaac9f` |
| `broker-audit-rebuild-2026-10-17` | `0b51994` |
| `broker-diagnostic-import-2026-10-18` | `6f9932e` |
| `broker-fixture-failure-hold-2026-10-17` | `354011f` |
| `broker-game-resume-2026-10-18` | `1f40ed6` |
| `broker-game-turn-runner-2026-10-18` | `c35c343` |
| `broker-native-ci-2026-10-17` | `d851103` |
| `broker-provider-adapter-2026-10-17` | `0a1bffb` |
| `broker-reconstruction-2026-10-17` | `c1238de` |
| `broker-response-compatibility-2026-10-18` | `03b7c61` |
| `broker-rules-security-2026-10-18` | `6ba5b2d` |
| `broker-synthetic-accounting-2026-10-17` | `6f090f0` |
| `checkpoint-inflight-fixture-2026-10-17` | `5a588c1` |
| `claude/new-project-setup-h5m6f8` | `396bdc5` |
| `inspect-safety-evals-2026-10-20` | `298b636` |
| `offline-broker-fixture-hardening-2026-10-17` | `b958bcc` |
| `offline-coordinate-validation-2026-10-17` | `0d19c49` |
| `participant-lifecycle-ci-2026-10-17` | `6b3278f` |
| `participant-session-rollover-2026-10-17` | `49c7962` |

Additional branches:

| Branch | Disposition |
|---|---|
| `security-dependencies-2026-10-18` (`6343a96`) | Already in main. Its manifest/lock and audit workflow match the development security state; no second upgrade required. Later deletion candidate. |
| `broker-rules-context-2026-10-18` (`320592e`) | Keep through main review/merge. It can be retired later if main is adopted as the shared line. |
| `main` (`1eb6958`) | Integration destination; preserve its history. |
| `claude/sibling-shard-sky-viz-xbpl1r` (`90975e4`) | Three unique commits, 17 changed files: sibling sky, camera/navigation, courier pathfinding, server/protocol changes and tests. User explicitly chose separate review; not discarded or merged here. |
| `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a` (`c10f849`) | Unique Vitest 5 major-upgrade proposal. Keep separate for compatibility/security review; current consolidation retains verified Vitest 4.1.11. |

No remote branch has been deleted, force-pushed or silently included. The unique sky/navigation and dependency-upgrade work must remain available. After main merge, recheck each candidate with git merge-base --is-ancestor against the then-current main before any separately authorized deletion.

## What remains necessary

1. Review the consolidation PR and hosted CI, then make an explicit main-merge decision.
2. Review the separate Godot sky/navigation branch and Vitest 5 proposal independently.
3. Only after main adoption, approve branch deletion for tips proven reachable; keep current documentation on one shared line.
4. Continue the tracked accounted-agent/framework design as directed, with execution disabled. Native AgentDojo/ControlArena integration and real-agent reasoning evidence remain unimplemented.

No new simulation rewrite, duplicate PR #21 integration, accounting reset, model key, live request, framework package installation or redesign of game actions is required to complete this consolidation.

## Source and evidence

The candidate code merge is `8281db6` (parents main `1eb6958` and development `320592e`). Evaluation verification is rerun at that exact source revision; evidence is in `evals/evidence/main-consolidation-2026-10-20/`. Subsequent evidence/CI-order documentation commits do not change the runtime or evaluation implementation.

## First hosted CI failure and correction

[Integration run 39455761722](https://github.com/SDarkVader/The-Node/actions/runs/39455761722)
failed with 1,187 passing and one failing Vitest test. The regression expected
`deadline_or_cancelled_after_accounting`, but received `deadline_before_dispatch`.
Its 50 ms real-time deadline expired during durable reservation I/O on the runner,
before its sender could produce the synchronous 70 ms stall it intended to exercise.
Production rejected before dispatch correctly; this was a fixture path-selection defect.
Subsequent hosted recovery/native/Python/Inspect steps were skipped in that run and
are not claimed as passed there. The independent hosted dependency audit passed.

The test now advances a controlled monotonic clock without yielding to timers. Its
strict post-accounting rejection, booked-usage and zero-action assertions remain,
and it explicitly asserts the sender was called. A separate deterministic regression
covers deadline expiry during reservation, proving zero dispatch, retained hold,
zero booked usage and zero game ticks. The focused 12 tests, full 1,189-test suite
and TypeScript pass locally. No production, deadline limit, assertion or game mechanic
was relaxed. The hosted workflow is rerun by the correction push.

## Confirmed main merge

The user merged [PR #22](https://github.com/SDarkVader/The-Node/pull/22) at
`acb3b2d21698871366d4dbb5431f9c2c68ba6c9e` on 2026-10-20 at 17:38 BST.
Git tree comparison with `1b6684a` is identical. A real fresh clone of main passed
tracked recovery. Main is now canonical; the obsolete reviewBranch metadata is removed.
Both the corrected [integration run](https://github.com/SDarkVader/The-Node/actions/runs/39456555818)
and [dependency audit](https://github.com/SDarkVader/The-Node/actions/runs/39456555781)
passed. Earlier candidate and failed-run notes above remain dated evidence.

The post-merge snapshot has 26 remote heads: main plus 23 other branch tips fully
reachable from main, and the two separately retained Godot/Vitest 5 branches. The
23 cleanup candidates comprise the 20 historical branches listed above, the existing
security branch, the former development branch and the completed consolidation branch.
The user subsequently explicitly approved deletion. Fresh fetch and exact-tip checks
confirmed 23/23 unchanged candidates and 23/23 ancestors of main `4da5301`.

The atomic push used an exact-SHA lease on every candidate. GitHub rejected every
deletion with `GH013: Cannot delete this branch`. Active ruleset
[`verify`](https://github.com/SDarkVader/The-Node/rules/25489816) targets all 26
branches and restricts deletions to bypass actors. A subsequent `git ls-remote --heads
origin` confirmed all 26 tips unchanged. No repository rule was changed during
that first attempt.

### Completed cleanup after separate authorization

The user then explicitly approved temporarily changing only **Restrict deletions**.
After fresh fetch and another 23/23 exact-tip and ancestry check against main
`4da5301`, the exact-SHA-leased atomic push deleted all 23 approved refs. Remote
inventory confirmed exactly three heads and their unchanged tips:

| Retained branch | Tip at cleanup |
|---|---|
| `main` | `4da5301ace9522f244e73b99cc8582ec4d4e68c7` |
| `claude/sibling-shard-sky-viz-xbpl1r` | `90975e407cbaaf9fbdd0d39e4e3445d2e1a278dc` |
| `dependabot/npm_and_yarn/npm_and_yarn-8bd3e5320a` | `c10f8490dde8c8b15426d9ee28290fa40fea7124` |

Deletion protection was restored immediately after deletion. GitHub confirmed
**Ruleset updated**; reloading the saved editor showed **Restrict deletions** checked,
enforcement Active, targeting all branches. Pull-request, force-push and code-quality
rules and the existing bypass list were preserved. No local branch or worktree was
deleted. Every deleted tip remains reachable from main; the manifest preserves exact
names and SHAs for recovery. This was ref/documentation maintenance, with no runtime
change and no new full regression claim. All 8 session-recovery tests, 38 relative
documentation links and `git diff --check` passed for this handover.

Exact branch names and pinned tips are recorded in the [post-merge cleanup manifest](evidence/merged-branches-2026-10-20.json).

The subsequent documentation publication was also required to use a pull request:
GitHub rejected a direct main fast-forward with Changes must be made through a pull
request. The separate docs/branch-cleanup-handover-2026-10-20 review branch contains
only this handover; the 23 stale branches remain deleted. Main protection was kept.
