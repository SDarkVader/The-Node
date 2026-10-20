<!-- NODE_SESSION_CHECKPOINT
{
  "format": "the-node-git-session-checkpoint",
  "version": 1,
  "branch": "broker-rules-context-2026-10-18",
  "verifiedBaseCommit": "41afa09d6ec8ec9ae3ab7d648f22056687bf4f5d",
  "completedWork": [
    "2026-10-20: createDormantWorld now vacates Import/Export slots (was leaving 6 FILLED at population 0); test/world.dormant.test.ts.",
    "2026-10-20: settlement ledger (src/engine/settlement.ts): every stepWorld wealth write is a named issuance line, an account transfer (oraclePool, districtPool, dock) or emigrant holdings; per-tick residual tested. Standing berths keep at least one Import/Export slot non-VACANT. Transit vouchers carry emigrant holdings across shards; failed crossings go to the source dock. Design: docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md.",
    "Rules-aware agent context derived from the authorized observer and actual game mechanics, including roles, available actions, consequences, information asymmetry, memory decay, and lossless observation packing.",
    "Offline evaluation for interpretation, evidence support, decision validity, bounded memory ablation, replay continuity, and real kernel price effects.",
    "Development-session recovery with local staged/unstaged patch and untracked-file snapshots, branch/commit/worktree verification, and Codex lifecycle hooks. A verified clean fresh checkout creates its local exact-state snapshot at SessionStart.",
    "GitHub-first continuation contract committed at docs/recovery/GITHUB_FIRST_CONTINUATION.md and prioritized in AGENTS.md; PC and local hook are optional for cross-device work."
  ],
  "testResults": [
    "2026-10-20: 1162 Vitest across 94 files and TypeScript pass; golden world snapshot unchanged. The 80 native checks were not run (they need private baseline paths absent from a fresh clone).",
    "2026-10-20 npm run settlement-report (8 seeds x 3000 days): issuance 45.79/tick, implied k 2.02 per nodule, 82.7% of issuance forfeited at role transitions, standing berth fired 0/20000 populated ticks.",
    "npm run test:session-recovery: 7 passed, 0 failed, including a clean fresh-checkout test using only the Git-tracked handover.",
    "npm run typecheck: passed.",
    "node --check scripts/session-recovery.mjs: passed.",
    ".codex/hooks.json JSON parse and Windows session-start command: passed.",
    "Rules-context stage: 1,143 Vitest tests across 92 files, 80 native checks, and TypeScript passed; 26 focused rules/request tests passed after final edits.",
    "GitHub Actions Windows fresh-checkout recovery workflow passed at run 39141127029 (commit 3b8ccd7); this verifies script behavior, not interactive Codex hook invocation."
  ],
  "unresolvedIssues": [
    "Settlement design decisions are the user's: what bounds wealth if it follows the person through role changes (today 82.7% of issuance is forfeited there); funded issuance at rate k; currency option A/B/C.",
    "Codex project hooks require review/trust in /hooks before automatic lifecycle execution; manual recovery commands work independently.",
    "Automatic mechanically generated diary connections and non-editing player event marks are not implemented.",
    "Complete restricted trespass transactions, including key provenance/consumption, authoritative absence, and witness consequences, remain unimplemented.",
    "Actual model comprehension and held-out live multi-turn strategy remain untested; no paid calls were made.",
    "Cross-device GitHub clones cannot recover unpublished local changes, private experimental runtime state, credentials, or missing original accounting evidence."
  ],
  "nextSteps": [
    "In any new phone, PC or cloud session, open the GitHub development branch and read AGENTS.md, GITHUB_FIRST_CONTINUATION.md and this checkpoint; verify Git HEAD and relevant source. No PC connection required.",
    "Review and trust the project recovery hooks in /hooks, or use npm run recovery:verify and npm run recovery:capture manually.",
    "Continue the next user-directed game task from the diary/event-mark or trespass gaps, preserving broker, kernel, accounting, replay, and existing experiment evidence.",
    "After meaningful work, update this tracked checkpoint with sanitized results and commit/push the handover when it should be available to a fresh checkout."
  ],
  "privateCredentialsOrExperimentalInputsIncluded": false
}
NODE_SESSION_CHECKPOINT -->

# Current development checkpoint

The current shared development line is `broker-rules-context-2026-10-18`. The Git
branch and its current `HEAD` are authoritative; the recorded base commit anchors
this checkpoint in that branch's history. The working tree at the checkpoint commit
is clean. Local in-progress work is preserved in `.codex/session-recovery/`, which
is Git-ignored and is never required to read this shared summary.

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
- Measured: 82.7% of issuance is forfeited at role transitions, the economy's only real sink.
  What replaces it if wealth follows the person is the user's decision, as are funded issuance
  at k ≈ 2.02 and the currency option.

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

1. In any fresh GitHub-backed session (phone, PC or cloud), read the GitHub-first continuation contract, this checkpoint and the relevant source. Confirm branch HEAD before editing; no PC or local recovery directory is required.
2. Review/trust the `.codex/hooks.json` project hooks in `/hooks`; until then use
   `npm run recovery:capture` at each handover.
3. Continue the next user-directed game task from diary/event marking or restricted
   trespass, preserving validated core and private experiment evidence.
4. Update this record after meaningful work and commit/push the sanitized handover
   when another checkout needs it. Keep credentials and private experiment inputs
   out of this file and GitHub.
