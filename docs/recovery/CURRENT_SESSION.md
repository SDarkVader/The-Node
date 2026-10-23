# Current development and experiment checkpoint

Updated 2026-10-23. The live reasoning-continuation pilot is stopped at tick 18 after 36 decisions.
Start with [CURRENT_EXPERIMENT](../research/CURRENT_EXPERIMENT.md), [documentation index](../README.md)
and [sanitized results](../research/CONTINUATION_PILOT_RESULTS_2026-10-23.md).

Current review branch: `ccr-8d64b59c-a4puhv`, which carries the read-only observatory and
agent-specific perception. It is built on `codex/stateful-continuation-2026-10-23` (PR 38); the
shared integration branch is main. Read the [observatory and perception runbook](../observatory/README.md).
Implementation, selected configuration, evidence so far and further work are distinct. Missing
work is not a limitation on what the experiment may become. Any genuine boundary needs explicit
conditions and a reason. [Earlier session records](SESSION_HISTORY_2026-10-23.md) are historical.

<!-- NODE_SESSION_CHECKPOINT
{
  "format": "the-node-git-session-checkpoint",
  "version": 1,
  "branch": "main",
  "verifiedBaseCommit": "c611e108afd8014997760352eb4d46200e12ef28",
  "completedWork": [
    "2026-10-23 agent-specific perception (owner request), branch ccr-8d64b59c-a4puhv, source c611e10: the Node builds a per-agent, per-tick perception request from committed state, and a headless Godot worker (client/scenes/PerceptionWorker.tscn) derives first-person (camera frustums, raycasts against the client's own buildings and Wall, declared fog visibility) or isometric (district bands, locations, counts, no references) observations. The Node validates every item against its request before delivery; records bind agent, tick, request and world hash. The perception episode reuses ContinuationHost unchanged with a hash-checked mirror; policies receive only their own perception, position, role and legal moves. Runbook docs/observatory/README.md.",
    "2026-10-23 read-only observatory, branch ccr-8d64b59c-a4puhv, source 90add57: ledger tail with parent/divergence checks and sealed re-verification, exact summaries with signatures withheld, world frames re-derived from genesis and tape with every hash re-checked, authenticated Godot stream, telemetry, diary classifier bridge and authority not_applicable, loopback API with resumable SSE, append-only annotations, frame export and web view. Verified on TEST-ONLY staged runs only; not yet run against the private tick-18 archive.",
    "2026-10-23 owner requested a Claude Design realtime web/Godot data interface handover. docs/research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md maps existing ledger/codec/replay, Inspect/scorer outputs and Godot hello/tick wire types to explicitly proposed adapters, contracts, telemetry definitions and ordered offline acceptance tests. The current standalone server creates a separate world and must not be substituted for the experiment. No interface, adapter implementation, listener, deployment or paid call is claimed.",
    "Owner clarification 2026-10-23: execution and evaluation must be separate. The operator may record facts and comment on returned reasoning, but must not simultaneously grade it by freeform judgment. Evaluation belongs to named frameworks/scorers or humans; any assistant-run evaluation must identify specific metrics and report its inputs/results separately. Inspect imported this pilot; no reasoning-quality evaluation was produced. Current documentation now states that policy and treats the historical exploratory stop label as provenance, not a grade.",
    "2026-10-23 documentation audit: current guidance now describes the live reasoning-continuation experiment, distinct from paused Study 1 and offline fixtures. Missing features, defects, unrun comparisons and selected caps are further work or configuration, not inherent limitations. A genuine boundary must state explicit conditions and why it cannot be crossed. Current implementation and evidence are checked against source d237eff and sanitized live records. Historical session records moved to SESSION_HISTORY_2026-10-23.md without turning old test results into new runs.",
    "Live pilot stopped at the recorded exploratory checkpoint: original 4 calls plus 32 extension decisions, 18 total real ticks, same two Bakers/world/signed own histories. All extension responses HTTP 200/end_turn, validator accepted and executed. Three independent replay checks and Inspect imports (8/8/16) passed. Actual diary expiry with historical exposure retained was verified. No background run is active.",
    "Extension receipt-based estimated list USD 0.0613495; conservative booking USD 0.122711, zero held, within USD 1 cap. Combined estimated list USD 0.0665121 / booked USD 0.133038. Original journals and prior charges preserved; no invoice reconciliation claimed. Sanitized evidence: docs/research/evidence/reasoning-continuation-live-extension-2026-10-23.json.",
    "Recognition v2, individual dealings, authored A01 diary rules, v2 Grifter speech/diary permissions, provider summaries, live accounted dispatch and verified parent-linked resumption are implemented. Frozen authority-attribution Study 1 remains separate and paused; protected production broker, kernel, replay and price entries are unchanged.",
    "Repository access: docs/research/CONTINUATION_PILOT_RESULTS_2026-10-23.md and evidence JSON are confirmed readable through GitHub. Root README and PR 38 link them; CURRENT_EXPERIMENT.md and docs/README.md provide current orientation."
  ],
  "testResults": [
    "At c611e108afd8014997760352eb4d46200e12ef28 (Linux, cloud): TypeScript passed; 1,397 Vitest across 109 files with NODE_GODOT_BIN set to Godot 4.3-stable headless (the 4 real-Godot perception tests skip without it); 8 session-recovery tests; 29 Python Inspect tests. Perception mutation checks (no occlusion, empty frustum, fog ignored, Wall removed) each failed the suite and were reverted. Study 1 freeze test passed; protected core files unchanged. No provider call.",
    "Live runtime/source d237effcc129c7757e382a3af8ecc0e95307ebc4: 32/32 extension calls HTTP 200/end_turn, validated and executed, three fresh-process parent/world/history replay checks, explicit live diary-expiry/history assertion, three Inspect 0.3.282 imports totaling 32 samples with zero further calls. No retry, forced event, repair or history reset.",
    "At d237eff: TypeScript passed; 1,346 Vitest across 107 files plus one existing Windows skip; eight recovery checks; hosted Windows offline-verification and both Linux offline-conformance checks succeeded. Earlier Python suite passed 29 tests; not rerun locally for the extension. These totals are historical source-anchored verification, not a new docs-edit test run.",
    "Documentation audit: 109 documents inventoried, 423 relative links resolved across 87 Markdown files; checkpoint/evidence JSON validated; 29 original/provenance/evidence Git blobs unchanged. Eight session-recovery tests and 32 targeted Vitest tests (accounted study, frozen Study 1, pricing) passed. No runtime/code/contract change, broad test rerun or paid call."
  ],
  "unresolvedIssues": [
    "Observatory further work: run verify/serve against the private tick-18 archive on the owner's PC and compare with the sanitized evidence (expected values in docs/observatory/README.md); build the Python importer for Inspect/Study 1 outputs only once a genuine scored output or an owner-chosen contract for non-ledger samples exists.",
    "Perception further work: no live model has received perception (policies are scripted); a provider-facing perception condition needs its own design, rules text and tests. Windows launch is unverified; CI has no Godot, so the 4 real-Godot tests run only where NODE_GODOT_BIN is set. The Node checks that perceived items are genuine and within limits but does not re-derive visibility; an independent re-derivation check is further work.",
    "Select and run any reasoning/decision-quality evaluation separately from execution, through a named framework/scorer, human reviewer or explicitly specified metrics. Current comments on returned summaries are not evaluation results.",
    "Memory-condition comparisons and mechanics-grounded interpretation/decision-quality measurement are further research. The uncontrolled exploratory pilot does not identify a causal memory benefit. New hypotheses or directional predictions must not be invented as requirements.",
    "The owner intends transcript-memory bounds and degradation. Current continuation preserves the full own history within a selected request profile; a declared degradation policy and provider-compatible tests are further implementation work.",
    "Broader live roles, seeds, horizons and changing circumstances remain experiments to design and run. Current live coverage is two Bakers across 18 ticks; seven-actor and other fixture coverage is offline evidence.",
    "Complete restricted trespass and individual abode transactions remain development work. Automatic event-only marking was an earlier design superseded by authored A01 entries; it must not be presented as the current implemented contract or a missing mandatory pilot feature.",
    "Additional framework packages, model-based monitors and metrics are work to select and verify. Existing adapted patterns and deterministic scorers do not certify general safety or establish intent.",
    "Billing reconciliation remains further evidence work. Original unknown historical liabilities are retained; zero holds in the extension grant do not erase them or prove invoice reconciliation.",
    "The pilot is stopped at tick 18 with 32 extension calls consumed and zero held. Any later authorized continuation needs the actual latest private parent and matching current journal. Git does not contain unpublished private data because those bytes were never committed; do not invent them, repeat calls or reset balances.",
    "The separate authority-attribution Study 1 is paused with its frozen recognition-v2 manifest, contract 1.1.0 and current-view memory condition. Its reactivation is not implied by a docs edit or by the completed continuation pilot."
  ],
  "nextSteps": [
    "Owner review of branch ccr-8d64b59c-a4puhv (observatory and perception) for integration into PR 38's branch; no PR is opened unless requested.",
    "On the owner's PC: point a private registration at the tick-18 ledgers and run npm run observatory -- verify; run the perception tests with NODE_GODOT_BIN set to the local Godot 4.3+ binary.",
    "For substantive experiment work, select the next implementation or research task with mechanics-grounded acceptance evidence. Preserve the current contracts, private evidence and all charges; no new paid dispatch is part of this documentation task.",
    "Keep PR 38 on codex/stateful-continuation-2026-10-23 for review. Preserve main, unrelated work and Git history. Any later real continuation must verify the exact latest private tick-18 parent and current journal first."
  ],
  "privateCredentialsOrExperimentalInputsIncluded": false,
  "reviewBranch": "ccr-8d64b59c-a4puhv"
}
NODE_SESSION_CHECKPOINT -->
