# Windows observatory acceptance — 2026-10-23

Latest archive: the [subsequent 20-call batch](../research/CONTINUATION_TICK28_RESULTS_2026-10-23.md) reached tick 28 and
passed observatory acceptance over five segments and 29 frames. Use its new private registration
and matching advanced journal for current acceptance. The tick-18 measurements below describe
the earlier checkpoint; its old parent no longer matches the advanced journal for dispatch.

The owner's PC verified Claude's observatory against the existing private tick-18 archive.
No model ran, no evaluation was performed, and no allowance was opened for writing.
The work is on `codex/observatory-windows-2026-10-23`, extending Claude's branch at
`0d7080306d94e2837a0e27480b2e0e8cc1ba3e15`. PR #38 has merged into main; this branch
has not been merged. The original PC checkout was preserved.

## Implementation and results

Acceptance source: `49a496b25455be1c980d0661410fe008f09b7ede`.

- Added `src/observatory/legacy/archiveAcceptance.ts`, its CLI and nine synthetic regression cases.
- All four registered segments verified, including the original pilot embedded as a parent.
  Counts matched the existing sanitized evidence: 36 requests/decisions, 18 ticks, 19 frames.
- Every recorded stop hash matched its reconstructed frame. Parent records were counted once.
- The latest accounting journal's envelope checksum, authorization run and canonical payload
  fingerprint matched the final stop. Recorded totals were counted once per allowance grant.
  This is checkpoint/journal agreement, not invoice reconciliation or renewed spending authority.
- Authenticated loopback HTTP routes enforced researcher/renderer scopes. Web frames and the
  Godot WebSocket protocol agreed on tick, cursor and world hash at the beginning, middle and
  end. Reconnection and SSE cursor resumption produced no duplicate events. Renderer messages
  were received and discarded. Refreshing or scrubbing changed no execution record.
- Windows: **66 Vitest tests across five files passed**, including all four real-Godot tests,
  using Godot **4.7.2-stable**, plus TypeScript and **eight native session-recovery tests**.
  The files were observatory, observatory
  acceptance, perception, frozen Study 1 and model pricing. The broader historical suite was
  not rerun for this addition. No Godot launcher change was necessary.
- The acceptance harness hashes its registered ledger files and journal before and after.
  A separate private inventory covers the original pilot/extension files and October 18 journal.
  Raw evidence, private registration, filesystem inventory and local result files stay outside
  the checkout and are not included here.

The Godot protocol check uses a WebSocket client; the separate perception tests launch the
real headless Godot worker. Interactive visual review of the browser/native renderer is a
separate check, not implied by these results.

## Repeat from a fresh session

1. Inspect the actual refs and worktree, then read `docs/recovery/CURRENT_SESSION.md` and the
   [observatory runbook](README.md). Preserve existing edits and private records.
2. Check out this development branch in a separate directory. Run `npm ci` when dependencies
   are absent. Keep private evidence outside that checkout.
3. Create a private registration using the runbook's four-segment example. Pin each runner
   revision. Point it at the existing extension ledgers; do not create a replacement run.
4. Supply the actual latest matching journal and a private expectations JSON using the fields
   below. Values for this archive come from the existing
   [sanitized evidence](../research/evidence/reasoning-continuation-live-extension-2026-10-23.json),
   not an invented result or a fresh model call.

```text
npm run observatory:acceptance -- <registration.json> <latest-accounting.journal.json> <expectations.json> [<NEW private-result.json>]
```

The expectations fields are `uniqueRequests`, `executedDecisions`, `completedTicks`, `finalTick`,
`finalWorldHash`, `bookedMicroUsd`, `heldMicroUsd`, `requestsPerSegment` (segment-id to count)
and optional `segmentRoots` (segment-id to root). Money fields are decimal micro-USD strings.
The private registration identifies the files; the command never searches for or substitutes
another journal. A stale journal, altered checksum, missing source pin, count mismatch or frame
mismatch fails acceptance. Errors expose fixed codes only. Existing output files are refused.

The harness opens and closes an ephemeral loopback observatory. It reads evidence, tests the
existing serving paths and changes only the display cursor in memory. It never writes an
annotation, evaluates behaviour, dispatches a provider call or runs the standalone world server.

To repeat the Windows tests with your installed Godot console binary:

```powershell
$env:NODE_GODOT_BIN = 'C:\path\to\Godot_console.exe'
npm test -- test/observatoryAcceptance.test.ts test/observatory.test.ts test/perception.test.ts test/eval.study1Freeze.test.ts test/modelPricing.test.ts
npm run typecheck
npm run test:session-recovery
npm run recovery:verify
```

To examine the archive interactively, use `npm run observatory -- serve <registration.json>`.
The researcher URL is printed locally and contains a temporary access token; keep it private.
The runbook also describes the renderer URL. Opening either view does not resume the experiment.

## Further work

Subsequent implementation of independent-worker re-derivation, perception rules/action packets
and Inspect/Study 1 sample imports is recorded in the
[2026-10-24 interface handover](CLAUDE_INTERFACE_HANDOVER_2026-10-24.md). Separate live
perception integration, declared continuation reasoning/decision metrics and transcript-memory
degradation remain development/research tasks. These dated acceptance checks establish
archive integrity and interface behaviour; they do not score reasoning or establish memory benefit.
