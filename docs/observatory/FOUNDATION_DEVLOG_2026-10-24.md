# Preserved foundation branch development notes

Historical additions recorded on the PR40/41 line through 5f84cc0, retained during consolidation.
For the completed fresh cloud run and current commands, follow the root README.

> 2026-10-24 — Thinking / History interface integration (implementation source 1f7901de1cef4aa69a1223cf1cdd9f60376a33fa).
>
> Cherry-picked Claude c151e41 as 3484264. Corrected its missing static route, mismatched reasoning/admission contracts, unused filters, resetting inputs, incomplete exports and unsafe external-response HTML. The canonical researcher endpoint preserves complete actions, exact returned summaries, request/cursor/world identity and selected statistics. Client views load current-at-tick and historical authorized observations on demand. Exports stay local; an external evaluator is not connected and no paid request occurred. Full signed transcript display is further work, not a capability of this summary-backed panel.
>
> Verification: bounded full suite 1,461 passed/115 files, one existing platform skip; three additional client DOM/event tests passed separately after full-run discovery, TypeScript/JavaScript syntax and eight recovery checks passed. Actual private archive: 56 decisions/28 ticks, 22 with returned text, exact pre-existing evidence matches; five registered ledger/journal files unchanged. Protected broker, kernel, observer, accounting and replay unchanged. Initial unconstrained full run had no assertion failures but two perception suite file errors; both passed independently (52 tests) and bounded full rerun passed. Native browser verification stopped when the Windows controller could not confidently establish the URL for policy enforcement; no bypass and no visual-browser claim. Details: docs/observatory/THINKING_HISTORY_INTERFACE.md and evidence/thinking-history-2026-10-24.json.

> 2026-10-24 — Observatory readiness beyond Claude's perception handover (implementation source 2f425507d454eabf3337f9651ef200b3c4af1bd6).
>
> Added the mechanics-aware perception context, scoped output schema, provider-neutral bounded packet, strict record revalidation at policy boundaries, independent-worker audit and audited episode. District Weather was already in the kernel; its aggregate meaning, band edges and consequences now reach policies. Movement remains optional, current legal destinations are explicit, and real kernel movement/next position/replay pass. No production broker, kernel, observer, accounting, replay, frozen contract or model configuration changed.
>
> A6 now imports existing Inspect/Study 1 sample outputs with producer/metric/status and exact source hashes/pointers, in a separate schema and researcher collection. It invents neither continuation ticks nor scores and refuses unvalidated continuation exports. UI/API sample scope stays separate from the selected world tick.
>
> Verification: full Vitest 1,454 passed across 114 files, one existing Windows PowerShell preflight skip; TypeScript plus explicit CLI typecheck; eight recovery checks; all 39 Python tests in the established Inspect environment. Two actual Windows Godot 4.7.2 processes agreed for all eight requests in the four-tick scripted readiness run; the exact submitted move matched the next position and replay. Actual private tick-28 archive acceptance passed again, including unchanged ledger/journal fingerprints. Zero model calls and no behavioural evaluation.
>
> Failures diagnosed and resolved: default Python lacked inspect_ai, so the existing venv was located and used without dependency changes; new API tests initially needed unknown-JSON narrowing; review corrected version-specific Courier pay/move timing and tightened readiness to the exact proposed destination. Worker startup cleanup now covers synchronous failures. The full suite rewrote a snapshot's line endings without a Git content diff; refreshing its index metadata left no snapshot change to commit. Browser automation had no available browser, so interactive visual verification is unclaimed.
>
> Current handover: observatory/CLAUDE_INTERFACE_HANDOVER_2026-10-24.md. Continue interface work from this branch; keep later live perception/history/accounting integration explicit rather than silently changing the original pilot.

> 2026-10-23 — Agent-specific perception through the Godot client (branch ccr-8d64b59c-a4puhv, source c611e10).
>
> The owner asked for perception derived by the existing Godot client: first-person and isometric, with real information limits, bound to the right agent, tick and world-state snapshot, and the Node staying authoritative.
>
> - **Request.** The Node builds a per-agent request from the committed state. It carries public geometry and station state, the hub, district weather and shard health as bands, and bodies under the observer's own references. Bodies are pruned to the perspective's reach, and isometric requests carry no references at all.
> - **Godot side.** Headless Godot (`PerceptionWorker.tscn`) derives the observation. First person uses four camera frustums, physics raycasts against the client's own buildings and Wall (shared `NodeGeometry.gd`), and fog-derived sight from a declared visibility condition. Isometric uses one orthographic view of district bands, locations and counts.
> - **Validation.** The Node checks every item against its request before the agent sees it. A loopback bridge correlates requests with timeouts.
> - **Episode.** It runs the continuation host unchanged, plus a hash-checked mirror. Policies receive only their own record, position, role and legal moves.
>
> Failures and reversals:
>
> - **Wrong-tick probe.** The first obscured-entity scenario was picked from tick-0 positions, and the run then failed: day 1 houses every grifter off the hub (stable once housed). The test now scouts the real day-1 state through the kernel and checks the episode reproduces that hash.
> - **Wall missing from geometry.** Perception initially ignored IsoView's Wall. Adding it correctly broke the first occluder-removal probe, which then had to remove the Wall too.
> - **Float32 distances.** `Vector2.length()` is float32; distances are now computed in double precision.
> - **Windows launch.** The worker launcher used `URL.pathname` (wrong on Windows) and dropped `SystemRoot`; both were fixed. The fix is unverified on Windows.
>
> Evidence: 31 perception tests (4 need `NODE_GODOT_BIN`) pass against Godot 4.3 headless on Linux. Mutation checks (no occlusion, empty frustum, fog ignored, Wall removed) each fail the suite. The full suite was 1,397 Vitest across 109 files, plus TypeScript and 29 Python Inspect tests. The Study 1 freeze, protected core files and the Inspect integration were unchanged. No provider call. Runbook: observatory/README.md.

> 2026-10-23 — Read-only observatory adapters and web view (branch ccr-8d64b59c-a4puhv, source 90add57).
>
> Implemented the Claude Design handover in `src/observatory`:
>
> - **Ledger tail.** Complete records only; seq/previous/hash, parent and divergence checks. Sealed segments are re-verified through `recoverContinuation`.
> - **Reasoning.** Exact returned summaries with status; signatures withheld.
> - **World frames.** Reconstructed from genesis and tape, with every hash re-checked.
> - **Godot stream.** Authenticated, read-only, with cursor metadata.
> - **Telemetry.** Unknown stays unknown.
> - **Evaluation jobs.** The diary classifier runs through a contract-aware bridge, and the authority classifier is recorded `not_applicable`.
> - **Delivery.** A loopback API with resumable SSE, append-only annotations, a frame export and a web view where one selected tick drives every panel.
>
> Found and fixed during verification:
>
> - SSE waited 15 s for its first write; headers are now flushed at once.
> - The frame hash check was not exercised by any test until a forged-but-rechained transition test was added.
> - Filesystem errors leaked private paths and are now sanitized.
> - Screenshot review caught a stray "null", a favicon 404 and cramped evaluation columns.
>
> The Python importer for Inspect and Study 1 outputs (handover A6) was not built. Nothing genuine for a continuation run exists to import: fixture results, an unrun study, and continuation imports marked `not_validated`. Each route needs a declared contract first. Evidence: 19 observatory tests on TEST-ONLY staged runs. Not yet run against the private tick-18 archive.
