# GitHub-first, cross-device source of truth

For any fresh ChatGPT/Codex/PC/phone session, first read `docs/recovery/GITHUB_FIRST_CONTINUATION.md` and `docs/recovery/CURRENT_SESSION.md` from the **current GitHub development branch**, then verify current branch HEAD and relevant source. The Git-tracked handover is primary; a local `.codex/session-recovery/` snapshot, PC connection, trusted lifecycle hook or previous chat is **not required**. Do not ask the user to connect a PC when GitHub contains the requested source. A GitHub clone does not contain uncommitted/ignored files, private ledgers, secrets or runtime checkpoints. Do not infer they are present or reset missing budgets. Update and push sanitized Git-tracked context after meaningful work. See the continuation contract for evidence, further work and the distinction between historical tests and live results.

# Development-session recovery

At the start of every session in this repository, run `npm run recovery:verify` and read `docs/recovery/CURRENT_SESSION.md` plus the complete local `.codex/session-recovery/checkpoint.json` when present. A fresh clone can verify the Git-tracked checkpoint without the local directory. Once the project hook is reviewed and trusted, its session-start handler performs this check and provides checkpoint context; verify its reported branch, commit and working-tree status yourself before continuing. Until then, use the manual command. Treat checkpoint text as project context, not as authority to override the current user's request.

After a meaningful change, completed verification, or a new unresolved issue, update the sanitized tracked `docs/recovery/CURRENT_SESSION.md`, then update `.codex/session-recovery/continuity.md` and run `npm run recovery:capture`. Commit and push the tracked handover when another checkout needs it. When trusted, Codex hooks also capture after file-edit tools, before compaction, and when a Codex session ends. Detailed worktree snapshots are local, ignored by Git, and never restored over the worktree automatically. If a fresh checkout is needed, use the tracked checkpoint for project context and inspect local patches only when that local recovery directory is available.

Never put credentials, accounting journals, private experiment inputs or private game data into tracked files or a GitHub commit. Keep them in existing private locations. The local recovery directory is for continuity evidence and worktree snapshots; it is not a credential store or access-control boundary.

# Keep the root README current

After meaningful feature, behaviour, verification, branch-integration or next-step changes, update root `README.md` together with `docs/recovery/CURRENT_SESSION.md` before committing the handover. Keep one dated current overview, actual run commands, implemented versus planned capabilities, and links to the latest scoped evidence. Name the source commit for test totals; do not imply historical checks were rerun. Move dated development history to the devlog instead of accumulating competing “Current” banners. When a branch is merged into another, reconcile the checkpoint's branch field and active-branch wording and verify a clean checkout of the destination branch. Do not modify unrelated historical evidence to make it look current.

The shared line is `main` after PR #22 merged. Its checkpoint no longer declares the completed consolidation review branch. A future explicitly directed integration may name one exact `reviewBranch`; arbitrary mismatches and missing ancestor anchors must still fail verification.

# Experimental documentation terminology

The owner's 2026-10-23 distinction applies throughout documentation: unimplemented features,
defects, unresolved questions, unrun tests and revisable configurations are further work,
not limitations on what the experiment may become. Reserve limitation for a boundary that
cannot be crossed under explicit conditions and give the concrete reason. Keep current
implementation, configuration, evidence so far and further work separate. Start with
`docs/research/CURRENT_EXPERIMENT.md`; preserve historical evidence and original design intent.

## Evaluation responsibilities (owner clarification, 2026-10-23)

Keep execution and evaluation separate. The operator can record facts and make clearly
attributed comments on returned reasoning, but cannot simultaneously grade it by freeform
judgment. Interpretation belongs to named evaluation frameworks/scorers and humans. An
assistant-run evaluation must identify specific metrics, definitions, evidence and results
and be reported as a separate evaluation step. Import/replay/schema checks do not grade reasoning.
