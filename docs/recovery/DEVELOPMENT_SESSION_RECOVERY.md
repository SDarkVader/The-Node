> Current experiment handover: [CURRENT_EXPERIMENT](../research/CURRENT_EXPERIMENT.md) and [CURRENT_SESSION](CURRENT_SESSION.md). Development snapshots below preserve local edits; live-world/history continuation uses the separate verified parent ledger and matching allowance.

# Development-session continuity

Codex sessions can resume without earlier conversation history by reading the
Git-tracked `CURRENT_SESSION.md` and verifying it against Git. The detailed local
checkpoint additionally preserves staged/unstaged patches and untracked files in
`.codex/session-recovery/`. Project instructions live in `AGENTS.md`; the supported
Codex lifecycle configuration is `.codex/hooks.json`.

## Resume in a fresh session

Fetch/open the development branch in any checkout. The session-start hook checks the
Git-tracked branch and commit anchor even when the local recovery directory is absent,
then creates a local exact-state snapshot if the checkout is a clean descendant and
supplies the tracked continuity notes. A mismatch leaves existing local data alone.
If a local ignored checkpoint already exists, the hook first verifies its exact branch,
commit and worktree fingerprint. Read
`docs/recovery/CURRENT_SESSION.md` and verify the reported Git state before editing.
You can do this manually at any time:

```powershell
npm run recovery:verify
npm run recovery:capture
```

`verify` is read-only and exits nonzero when the tracked checkpoint is missing or the
branch/commit anchor/worktree does not match. It does not switch branches, restore
files or reset anything.
`capture` records the current branch, commit, staged and unstaged patches, untracked
file inventory and local snapshots, plus the continuity notes. It updates only the
ignored `.codex/session-recovery/` directory. Repeated capture reuses the existing
snapshot when repository state has not changed.

Update `docs/recovery/CURRENT_SESSION.md` with sanitized completed work, tests, open
issues and exact next steps after meaningful changes. Commit and push that shared
handover when another checkout needs it. Update `.codex/session-recovery/continuity.md`
and run `npm run recovery:capture` for the detailed local worktree snapshot. After the
project hooks are trusted, Codex captures after file-edit tool calls, before context
compaction and at session end, and verifies on new and resumed sessions. Until hooks
are trusted, run the manual commands at each handover. Hook failures do not apply
patches; inspect Git and the checkpoint manually.

The stored patch and untracked copies are recovery evidence, never an instruction
to overwrite the current checkout. If a checkout must be rebuilt, compare the saved
branch/commit and patches with its actual state, then apply only the changes that
are still missing. Existing uncommitted work and Git history must be preserved.

The detailed patch/untracked-file checkpoint is local and ignored by Git. The tracked
handover is a sanitized project summary; keep credentials, accounting journals,
private game observations and private experiment inputs in their existing private
locations. Neither checkpoint should contain secrets. The tracked handover is not an
access-control mechanism.

New or changed project hooks require review and trust in Codex's `/hooks` interface.
If hooks are unavailable or untrusted, the manual commands above provide the same
verification and capture functions. Hook behavior follows the official
[Codex hooks documentation](https://learn.chatgpt.com/docs/hooks).

## Verify this mechanism

```powershell
npm run test:session-recovery
```

The tests use temporary local Git repositories. They do not call external APIs,
modify the current branch, or contact a model provider.
