# GitHub-first continuation — The Node

Updated 2026-10-23. A fresh phone, PC or cloud session can recover development context from GitHub.
Start with the [current experiment](../research/CURRENT_EXPERIMENT.md) and
[CURRENT_SESSION](CURRENT_SESSION.md); verify actual refs instead of assuming a historical HEAD.

## Active branch and current experiment

Repository: `SDarkVader/The-Node`. Current review branch:
`codex/observatory-windows-2026-10-23`, extending Claude's `ccr-8d64b59c-a4puhv` observatory
and perception work. [PR #38](https://github.com/SDarkVader/The-Node/pull/38) has merged into
the shared integration line `main` at `afbdec7`. The observatory review branch remains separate;
do not silently switch, reset, merge or discard work. See the
[Windows acceptance record](../observatory/WINDOWS_ACCEPTANCE_2026-10-23.md).

The live continuation pilot is stopped at tick 18 after 36 paid decisions, including 32 extension
calls. Exact histories and the original world persisted. Fresh-process replay and Inspect imports
passed. Estimated extension list cost USD 0.0613495 / conservative booking USD 0.122711, zero holds.
No background run is active. The separate authority-attribution Study 1 is still paused and frozen.

[Results](../research/CONTINUATION_PILOT_RESULTS_2026-10-23.md) and
[sanitized evidence](../research/evidence/reasoning-continuation-live-extension-2026-10-23.json)
record runner source `d237effcc129c7757e382a3af8ecc0e95307ebc4` and the original world revision.
Current documentation describes the programme, the evidence so far and further work separately.
An unimplemented task is not a limitation of the experiment's future.

## Start in a fresh session

1. Read `AGENTS.md`, this guide, `CURRENT_SESSION.md` and the current experiment page on the
   actual development branch. Older 'current' labels describe dated stages.
2. Inspect Git HEAD, branch and worktree. Read relevant source and source-anchored evidence.
3. Run `npm run recovery:verify`. A local `.codex/session-recovery/` snapshot and trusted
   lifecycle hook are optional conveniences, not prerequisites for GitHub-first context.
4. Preserve staged, unstaged, untracked and ignored private work. Never reset or automatically
   overwrite it. Existing checkpoints are verified rather than restored over the worktree.
5. After meaningful work update root README, CURRENT_SESSION and local continuity when available;
   run `npm run recovery:capture`, then commit/push sanitized context on the agreed branch.

The local recovery directory preserves machine-specific patches and snapshots. A trusted hook
can invoke the same recovery checks at session lifecycle events. Manual commands work independently.
The historical [consolidation report](MAIN_CONSOLIDATION_2026-10-20.md) and
[PR #21 review](PR21_REVIEW_2026-10-20.md) retain their original source-specific test results.

## Private experimental state

GitHub carries source, documents and sanitized aggregates. It does not contain private provider
responses, signatures, world observations, runtime state, credentials or allowance journals.
Those bytes cannot be reconstructed from a clone that never contained them. Secure transfer and
recovery mechanisms can be developed; do not confuse missing data with a ceiling on future work.

A later authorized live continuation requires the actual latest private tick-18 parent, its
matching current journal, and independent verification before dispatch. The runner reconstructs
the world through original replay and preserves exact signed own histories. Reusing an older
checkpoint after the journal advanced is refused. Unknown/failed partial calls are evidence to
retain and diagnose, not an instruction to retry or erase a hold.

Do not infer permission, missing records or a zero balance from a fresh clone. Do not create a
replacement allowance or repeat paid calls as setup. This guide does not authorize a run.

## Documentation discipline

[Scope, evidence and development](../EVALUATION_SCOPE_AND_DEVELOPMENT.md) defines the terminology.
Keep current implementation, revisable configuration, observed evidence and further work distinct.
For a genuine boundary, state exactly what cannot be done under which conditions and why.
Preserve original design documents, hash-bound evidence and dated results as provenance; route
readers to current guidance rather than silently rewriting historical observations.
