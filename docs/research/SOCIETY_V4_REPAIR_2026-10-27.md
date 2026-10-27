# Society v4 repair pass — 2026-10-27

The stopped live run used source `bb1b23282421553c3e996ac487b0f43e786f4445` and ended
during day 1. Its original event file and accounting history remain private. The original
run produced no completed-day tape. An offline reconstruction used that exact source, the
original plan and controlled outcomes, and the historical deterministic non-model policy.
All 98 controlled request bodies and recorded before/after hashes matched. The separate
reconstructed prefix contains 383 decisions, including 285 policy-reconstructed non-model
decisions, and independently replays with zero committed days. It ends at the last recorded
controlled outcome; no subsequent action or day completion is inferred.

The 3D renderer previously treated any role holder on a building cell as its working occupant
and retained at most one occupant. The 2D overview also overlaid people sharing a cell. Both
now display every projected person, with presentation-only offsets. The 3D display no longer
infers attendance or courier routes from role and position. Frame protocol and inhabitant
observations are unchanged.

New v4 executions durably journal each admitted controlled or autonomous submission and its
state hashes. An offline, source-pinned recovery can replay the recorded prefix into a fresh
private viewing bundle, labelled as reconstructed. It rejects altered or out-of-order records,
source mismatch, writes within the original run, and changes to the pinned event file. It does
not call a provider, policy or accounting operation. The old run predates this journal and its
separate policy reconstruction is identified distinctly.

The observed controlled residents made 54 adjacent moves with no immediate reversals. They
received the district plot map, their own location, task sites and legal adjacent choices.
Adjacent movement is an existing v4 rule; this pass does not replace it with automatic or
multi-cell travel. The constrained diary, Wall and proximity grammars remain in force.
The actual latest private accounting history remains pending and is not count-closed; no new
live experiment or accounting reset was performed.

Offline checks on the repair working tree included 74 targeted boundary, launch, accounting,
report, Observatory and provenance tests; the full suite passed 1,968 tests with 7 skipped
before the final recovery follow-up. Project TypeScript, JavaScript syntax and a headless Godot
scene regression passed. These counts are working-tree checks, not a new live result.
