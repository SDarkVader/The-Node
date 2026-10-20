# Main consolidation and branch audit — 2026-10-20

Status: prepared integration candidate; no merge into main or branch deletion is claimed.

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
| Consolidation recovery regression | 8/8 passed | Primary and exact named review branch accepted; unrelated clean branch rejected |
| Full Vitest and typecheck | 1,188/1,188; TypeScript clean | Full offline regression on merged candidate |
| Python evaluation unit tests | 18/18 passed | No model requests |
| Two Inspect runs and exported replay | 29/29 deterministic; 56/56 checks and 29/29 exported replays per run | Scripted calibration only |
| Native checks | 80/80 passed | Actual local funded baseline 41da84f; new CI uses equivalent reviewed 320592e baseline code |
| Runtime/dependency comparison with development | No differences | src/, client/, evals/, package.json/lock and Vitest config |
| Hosted CI | Added, not claimed complete before GitHub reports it | Main push and main-targeting PRs; Node, Python, native, recovery and two offline Inspect runs |

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
