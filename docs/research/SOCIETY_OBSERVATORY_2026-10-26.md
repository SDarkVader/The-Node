# Current workflow update

Use `START-NODE.ps1` for preview, or `START-NODE.ps1 -Start -Ticks 1` for a freshly reviewed
real test without this chat running. Society v4 has sequential turns and mandatory duties.
The old 18-call/three-day figure below belongs to the earlier one-act contract; v4 reviews
its explicit turn-dependent call cap while retaining USD1 total/USD0.02 request ceilings.
[Current rules, commands and verification](SEQUENTIAL_DAYS_2026-10-26.md).

The earlier interface guide follows as source-specific history:

# Society tests in one PC interface

From the repository, open a model-free manual preview and registered previous runs:

```powershell
powershell -NoProfile -File scripts/start-node-test.ps1
```

Prepare and start a real three-day agent test through the same interface:

```powershell
powershell -NoProfile -File scripts/start-node-test.ps1 -Start -Ticks 3
```

The launcher uses one private machine settings file at
`%LOCALAPPDATA%\The-Node\test.local.json`. It retains the credential path, latest journal
pointer, output parent, Godot binary/template paths and saved-run registry. None belongs
in Git. Preparation prints the exact source, rules, call and spending bounds. Typing
`START` approves that prepared run; there is no automatic approval or provider retry.
Three days permit at most 18 calls and USD 1. A tick is still a complete game day.

The launcher builds the existing Godot scene for the browser when the source changes,
starts the Observatory and opens its URL. Paste the interface token printed in the
terminal. Godot runs inside the world panel; no separate editor, Godot window or accounting
application is required. Keep the launcher terminal open. The renderer and the 2D overview
consume the same committed world as the research timeline. The observer interface is
operator-only and is never passed into an inhabitant request.

The street material now receives the existing computed local weather field; the earlier
helper was never applied to the ground. Stronger lit-surface gradients retain the visual
contract's weather/heat/role meanings and measured anchors. A browser-compatible additive
layer makes real station heat and overlapping radiance visible when HDR bloom is absent.
No decorative crowd, movement, transactions or hidden event signals are generated.

The owner's subsequent correction targets the **2D settlement overview** for the stronger
gradient: its streets now encode local District Weather, heat halos blend additively over
neighbouring cells, station states remain distinct and people carry clear role colours.
The main 3D world's halo/core and emission intensity are reduced. Both views still use
the recorded world; these changes alter rendering only.

## Owner daily-routine clarification

The next simulation revision must provide several sequential turns inside each day and
actual visits to the relevant locations. Daily diary writing and Wall posting are tasks;
a diary's subject may be null but its vocabulary remains constrained. The day stays open
for the inhabitant to choose when to write, before rollover. Bakers and Millers must leave
their abode for duties, people buy food, and role/customer communication is compulsory
under the existing lexical rules. Extra speech outside role duties remains a separate
choice under the established design. These requirements are not yet implemented by the
current one-act-per-day Society loop. Historical tapes and the frozen diary classifier
must retain their original semantics when the new routine is added.

Use the experiment, world-tick, agent, phase and decision selectors. **Advance one tick**
permits exactly one day through the existing validated/accounted controller. Waiting makes
no provider request or reservation. Duplicate/stale permits, a world-only token,
cross-origin mutation and advance during historical playback are rejected. **Stop test**
halts execution and retains partial evidence. **Play recorded ticks** changes only the
shared replay cursor, including Godot; it never invokes a model or policy. **Follow latest**
returns to the active run. The existing legacy Observatory and native clients remain supported.

**Thinking history** selects the current decision, every returned block for the selected
tick, or the agent's full chronological history through the selected evidence cursor.
Each entry pairs the unabridged returned text with the actual authorized observation,
decision, execution status and recorded resulting transition. A historical cursor does
not reveal thinking from a later response. Model-controlled inhabitants are selected
first by default; all role holders remain selectable. This is a behavioural record,
not a reasoning-quality score. Provider-returned summaries are all that exist when the
provider supplies summaries; absent or redacted internal content is not reconstructed.

Every raw or readable results export now includes `ticks.json` and
`agents/controlled-N/tick-0001.json`, in addition to each identity's chronological JSONL.
Each tick file contains agent ID, exact recorded contexts and legal choices, submitted
actions, provider-returned summaries or explicit absence, outcomes, transition and errors.
Autonomous residents' actual contexts/actions remain in the full tape and are inspectable
in the interface. Their deterministic policy is identified explicitly; no model reasoning
is invented. No hidden reasoning is reconstructed or evaluated.

Completed runs enter the private registry automatically. The latest financial journal
pointer advances even when a run stops unfinished. Existing count-closed/expired, no-held-
liability and no-overrun requirements still apply before another paid run; an unfinished
allowance cannot be replaced with an older journal. An unstarted review may be released
without deleting its files. One local lock prevents overlapping launcher sessions.

For another PC, supply its private settings and installed Godot 4 binary plus the matching
single-threaded Web release template, then use the same launcher. The build command is
`scripts/build-godot-web.ps1 -Godot <binary> -WebTemplate <web_nothreads_release.zip>`.
Build assets are local/ignored. Template provenance and actual verification are recorded
separately from paid-model results. No paid run is claimed by an offline interface check.
