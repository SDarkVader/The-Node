<!-- NODE_SESSION_CHECKPOINT
{
  "format": "the-node-git-session-checkpoint",
  "version": 1,
  "branch": "broker-rules-context-2026-10-18",
  "verifiedBaseCommit": "89f578147bce81a7b7e395c6be24dcc5fdc3b86f",
  "completedWork": [
    "Rules-aware agent context derived from the authorized observer and actual game mechanics, including roles, available actions, consequences, information asymmetry, memory decay, and lossless observation packing.",
    "Offline evaluation for interpretation, evidence support, decision validity, bounded memory ablation, replay continuity, and real kernel price effects.",
    "Development-session recovery with local staged/unstaged patch and untracked-file snapshots, branch/commit/worktree verification, and Codex lifecycle hooks."
  ],
  "testResults": [
    "npm run test:session-recovery: 7 passed, 0 failed, including a clean fresh-checkout test using only the Git-tracked handover.",
    "npm run typecheck: passed.",
    "node --check scripts/session-recovery.mjs: passed.",
    ".codex/hooks.json JSON parse and Windows session-start command: passed.",
    "Rules-context stage: 1,143 Vitest tests across 92 files, 80 native checks, and TypeScript passed; 26 focused rules/request tests passed after final edits."
  ],
  "unresolvedIssues": [
    "Codex project hooks require review/trust in /hooks before automatic lifecycle execution; manual recovery commands work independently.",
    "Automatic mechanically generated diary connections and non-editing player event marks are not implemented.",
    "Complete restricted trespass transactions, including key provenance/consumption, authoritative absence, and witness consequences, remain unimplemented.",
    "Actual model comprehension and held-out live multi-turn strategy remain untested; no paid calls were made."
  ],
  "nextSteps": [
    "Open the same repository branch in a new Codex session; verify the tracked checkpoint against Git before editing.",
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

1. Open this branch in a fresh Codex session and run `npm run recovery:verify` before
   editing; confirm the branch, `HEAD` and worktree reported by Git.
2. Review/trust the `.codex/hooks.json` project hooks in `/hooks`; until then use
   `npm run recovery:capture` at each handover.
3. Continue the next user-directed game task from diary/event marking or restricted
   trespass, preserving validated core and private experiment evidence.
4. Update this record after meaningful work and commit/push the sanitized handover
   when another checkout needs it. Keep credentials and private experiment inputs
   out of this file and GitHub.
