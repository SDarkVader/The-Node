# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

**2026-08-24**: The basic day — first real intra-day structure (user directive: "we need a
basic day before we can have anything more"). New `src/engine/dayCycle.ts`: gives the
existing daily-blended economics (`wealth.ts`'s 2x4hr offline dampening, `importExport.ts`'s
once-a-day nodule/grain aggregate) real UTC-anchored windows instead of one number per day.
`World.lastImportExportWindows` reports that tick's nodule/grain supply as two real dated
window events (byte-identical total to before — reporting structure changed, not the
economics). `MultiShardState.lastMigrationWindows` (in `multiShardHarness.ts`) tags each
migration attempt by which window it fell in, purely for reporting — never changes which
attempts happen, consumes no extra rng, doesn't touch the seed trajectory. **Deliberately NOT
done this pass** (explicit user scoping decision, "kernel first, server cadence next pass"):
the live server (`ws.ts`) still ticks every 2.5 real seconds by default with each tick
advancing the whole economy one full day — there is still no real wall-clock anchoring on the
live path, even though a past session already "confirmed" (on paper, never built) that 1 tick
should = 24 real hours aligned to server reset. Gating real player connections/actions by
wall-clock hour needs that server-cadence change plus a real session/presence primitive
first — both still open, and the presence primitive investigation done earlier this session
(live-world path has no connection→player identity binding at all) is still valid groundwork
for whenever that's picked up. 9 new tests (`test/dayCycle.test.ts`,
`test/world.dayCycle.test.ts`, plus 3 added to `multiShardHarness.test.ts`), 728/729 passing
(1 pre-existing, previously-documented CPU-contention flake in `ws.inbound.test.ts`,
unrelated — passes clean in isolation), typecheck clean.

**2026-08-22 (later)**: Journalist and Detective merged into Investigator (user directive).
`World.investigators` replaces the two separate arrays; `WorldConfig.rInvestigator` (default
15, sum-preserving) replaces `rJournalist`/`rDetective`. Investigator inherits Detective's
real mechanic (`investigatedBy` → sabotage detection bonus, district-scoped) since Journalist
had none to lose. `resources.ts` kept `leads` (Detective's), retired `stories`
(Journalist's) — `RESOURCE_OWNER`'s 1:1 bijection meant the merged role could only keep one.
Wire protocol and Godot client (`ROLE_COLOUR`, icon glyphs — kept the magnifier) both updated.
Two real bugs caught by reasoning about the merge's intent, not by the compiler: an untyped
test config literal that silently left `rInvestigator` at the wrong default (runtime crash,
not a type error), and `reputation.ts`'s `LEVEL_1_ROLES` which would have left Investigator
permanently unreachable for voluntary uptake — a real constraint-6 violation caught before it
shipped, not after. Golden snapshot re-captured deliberately (role-roster changes shift rng
order — expected, per `BLUEPRINT.md`'s determinism section) and reviewed before accepting.
714/714 tests, typecheck clean. Full account: `docs/DEVLOG.md`'s top entry.

**Roster is now 5 roles + grifter pool**: Miller, Baker, Courier, Investigator, Import/Export.
Every doc, config default, and test referencing "six roles" or the old Journalist/Detective
split needs to be read as historical from this point forward unless it's explicitly about
`sim/jointGridSearch.ts`'s own archival derivation record (left untouched — historical, not
live code).

**2026-08-22**: Per-agent driver dispositions built and measured (`src/sim/drivers/
heterogeneity.ts`) — see `docs/DEVLOG.md`'s top entry for the full account. Short version: every
"honest"/"opportunist"/"saboteur" agent used to share one literal set of constants; now each
samples its own fixed disposition once at creation, deterministically from `(seed, playerIndex)`,
opt-in via `applyDriverTick(world, rng, { heterogeneous: true })` — default unchanged. Measured
effect on Gini is real but modest (+24% day-to-day movement over the last 500 of a 3000-day run,
5 seeds). Honestly does NOT explain the near-static Gini the user observed in a separate,
externally-run 5-role-plus-grifter simulation (the Ember Blueprint deck's proposed roster) —
this repo's own drivers were never that flat to begin with. Next candidates, explicitly
sequenced and not yet started: the Journalist/Detective→Investigator merge, and a sibling-shard
sky visualization reading real `shardRegistry` state (not an invented orbital-physics system).

**2026-08-21**: `README.md` is now simplified and current. Stripped game mechanics exposition
(cut 90% of the original text), kept mystery intact, added a Status section, and pointed readers
to the docs for deeper detail.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players per shard, no combat —
tension comes from asymmetric information and structural economic pressure. Platform:
**PC + mobile, client in Godot 4**, server authoritative in TypeScript/Node (decided
2026-08-06). Full spec: `docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything;
it's the one part of the brief that isn't up for revision. Also read `CLAUDE.md`'s
"Standing design constraints" — six binding rules (simulate before trusting; no permanent
zero-state at any scale; minimize what's modelable — ask "does this need to be an agent";
personal memory is mortal, civic memory is immortal; let outcomes be real, don't script
them; reputation may only ever grant, never remove) that apply to everything built from
here on.

## Current state (as of 2026-08-19, latest — INBOUND PIPE)

**The server can now receive from a client. Until this session it could only send.** User's own
framing for why: *"so I can pull and record output simulation data for the build game + run
simulation for data model."* This is a control/recording channel, not a player-action channel —
scoped narrowly and deliberately.

**What's real**: `src/server/ws.ts` gained `parseClientMessage` (total, defensive — bad JSON, a
non-object, a missing/wrong-typed `type` or `action` all return `null`, never throw) and
`attachActionReceiver`, shared by BOTH server paths (`startServer` legacy scenario AND
`startWorldServer` live world) so untrusted input is handled identically on either. A
`ClientActionMessage` carries `{ type: 'action', action: string, payload: unknown }` —
deliberately generic. **`action`/`payload` are not interpreted anywhere.** No vocabulary was
invented; that is explicitly the next owner's call, not this session's.

- **Legacy path**: `stepScenario` gained an optional `pendingActions` parameter, drained once
  per tick, echoed back uninterpreted on `DayResult.receivedActions` (present only when
  non-empty). Omitting it is **byte-identical** to before — proven by capturing 200 recorded
  scenario days both before and after this change and diffing (md5 `5b8ed60d...`, identical),
  not by inspection.
- **Live world path** (the one the Godot client actually speaks): `startWorldServer` gained an
  `onActions(actions, tick)` observer hook. Called once per tick with whatever arrived since the
  last one, omitted entirely when nothing did. `stepWorld` itself reads none of it — the hook is
  how a recorder captures input alongside the real `World` output, without this module or the
  kernel ever deciding what an action means.
- Both queues cap at `MAX_PENDING_ACTIONS = 256` — a flooding client is dropped-and-logged, not
  buffered without bound.

**Verified real, not just typechecked**: `test/ws.inbound.test.ts`, 9 tests, a real
`WebSocketServer` and a real `ws` client — connects, sends `{type:'action',...}`, and the server
reports it back via `onActions`. Covers: happy path, tick correlation, drain-once (not
re-reported), malformed frames dropped without killing the connection, the flood cap, and that
the legacy path accepts input too. **Mutation-checked**: pulling `attachActionReceiver` out
failed 5 of 9; restoring it passed all 9 — the suite has teeth, not just green ticks.

703 tests total, typecheck clean.

**Explicitly not done, on purpose — this is the whole point of scoping it this way**: no action
vocabulary. Nothing like `'post_to_wall'` or `'move'` or `'trade'` exists anywhere in this
change, and none should be added without a session that works the scenario mechanics out by
hand first. **Action semantics are the next open item, and they are the user's design call, not
an engineering default to reach for.**

## Current state (as of 2026-08-19, latest — CODE)

**"THE DIRECTION" item 2 is DONE: position is decoupled from occupancy.** The blocker
everything else in the Godot chain stacked behind. Two staged commits, `f2eda67` then
`40d7c31`:

1. **Representation** — `RoleEconomicSlot`/`SupportRoleSlot` carry `x`/`y`, initialized to
   the occupant's own building, reset on refill alongside `wealth` (a new occupant starts AT
   their workplace), frozen while VACANT/BACKSTOPPED. `occupantsOf` reads the person, not the
   address. **All 659 pre-existing tests passed unchanged, golden snapshot included** — that
   equality was the whole point of splitting the work here.
2. **Movement** — `playtestDrivers` applies `move` for role-holders too, clamped to real plot
   bounds; the renderer draws them in their role glyph at their real position, in a new
   `COLOUR_AWAY` off the heat ramp (their station's heat is still drawn at their building;
   drawing it twice would double-count it).

**READ THIS BEFORE TRUSTING ANY SABOTAGE NUMBER**: `occupantsOf` feeds witness counts, and
witness counts feed sabotage detection, identity resolution and District Weather. **The
43.6% / 28.9-day sabotage calibration was measured against a PINNED layout and does not
describe a world where people walk around.** Nothing shipped changed yet — only the sim-side
driver applier moves anyone, and it is behind `drivers.importGuard` — but the re-measurement
is owed to whatever first makes role-holders move in the shipped world. Do not quote the old
numbers past that point.

**A real open design question, flagged not decided**: movement is economically inert. Every
production/wage/market path in `stepWorld` keys off `buildingId`, never position, so a Miller
who wanders off still mills. Whether that should stay true is genuinely unresolved.

**Accepted rendering limitation, found by looking at real output**: a person standing on
another building's cell isn't drawn (structure wins the cell — 1 of 9 away role-holders at
seed 7 day 60). The map is not a headcount. Documented in `playtestRenderer.ts`.

**Then both long-standing open bugs were fixed** — the misplaced Wall and the Courier pay bug
behind it (`5276919`). Full account in the CLOSED section further down this file; short version:
the Wall now sits in the middle of the town (hub offset 0.14-0.61, was 6.5-10.5; 43.1% of
buildings west of it, was 0%), and couriers earn parity with their peers (ratio 1.028, was
~0.40-0.45) via station-level routing — which only became possible because of the `x`/`y` work
above. Sabotage re-measured and barely moved (42.9%, was 43.6%).

**Also fixed, found on the way**: vitest had no `testTimeout`, so its 5s default applied to a
suite full of multi-second simulations — a real intermittent-failure source. Now 60s.

670 tests, typecheck clean, pushed to `main`.

**Then chain item 4 landed too: the server streams a real `World`** (`a1203ef`).
`startWorldServer` replaces the two-Baker MVP scenario (kept behind `NODE_LEGACY_MVP=1`, since
the existing Godot scaffold still speaks it). `src/server/worldProtocol.ts` owns what may go on
the wire — read its header before changing anything there, it is a privacy boundary and not a
serialization detail:

- **public**: geometry, role-per-building + slot state, per-building heat, per-district tension,
  and that a body is at a position.
- **withheld**: wealth, personal stock, experience, completion stats, `wealthGini`, anything
  diary-shaped, and in-flight sabotage campaigns.
- **pseudonymous**: people carry a per-connection `handle` derived from a SERVER-generated
  secret, so two clients see disjoint handles for the same person and cannot correlate. Real ids
  never go on the wire. `identityResolved` is the separate, earned message that turns a handle
  into a face.

Verified standalone on a real port, not only under vitest: 62 buildings, 87 plots, hub (0,0),
**95 people per tick** — role-holders and grifters both. 688 tests, typecheck clean.

**THE DIRECTION IS COMPLETE — the Godot client renders the real settlement** (`2d448e0`).
`client/scripts/WorldView.gd` + `scenes/WorldView.tscn` (now the main scene) consume `hello` +
`tick`: plots, stations coloured by real economic heat, people, the Wall, tension as a
background wash, drag-to-pan and wheel-zoom. Ember palette copied from `playtestRenderer.ts`,
not reinvented. **Setup instructions for PC are in `client/README.md`** — Godot 4.3+ standard
build (not Mono), `npm run server`, import `client/project.godot`, F5.

**READ THIS BEFORE TRUSTING IT: Godot is not installed in the dev environment, so the client
has never been visually verified.** The protocol contract is checked automatically
(`test/clientProtocolConformance.test.ts`, itself mutation-tested), so it will not fail on a
typo'd field name — but whether the town is *legible* is genuinely unknown. Expect to tune
`CELL`, `BUILDING_SIZE`, and especially the per-role palette, which is a **first proposal chosen
in the client**, not derived from anything in the engine. No per-role hue exists in code.

**GODOT IS INSTALLED IN THE DEV ENVIRONMENT AND ITS LIMITS ARE MEASURED** — see
`docs/RENDER_CAPABILITY_2026-08-19.md` before planning any visual work. Short version, all
probed rather than assumed: isometric 3D, directional and omni lights, emissive materials,
**glow/bloom**, custom shaders, GPU and CPU particles, and MultiMesh at full population scale
(62 buildings + 65 people) all work and can be screenshotted. Forward+/Vulkan does NOT
initialise here (no `VK_KHR_surface` under xvfb) — irrelevant on a real PC, but it means
Forward+-only effects cannot be verified in this environment. Performance is **64.8 ms/frame,
~15 fps** under software rendering, which is a statement about a CPU pretending to be a GPU and
not about NODE: **still frames are reliable, motion and feel are not.** That is the honest
boundary of what can be validated here rather than on the PC.

Practical: run `--rendering-method gl_compatibility`, use `xvfb-run -a` for anything that must
call `_draw`, and always pass `--quit-after N` or buffered output is discarded on kill and a
working scene looks silent.

**Nothing in the isometric target is blocked by the simulation.** Every signal it displays is
already computed and already on the wire; the gap is rendering work, and most of it can be built
and checked here.

**Immediate next candidates**, in rough order of payoff:
1. **Design the action vocabulary.** The inbound pipe is real and tested (above); nothing reads
   `action`/`payload` yet. This is a design session — work the scenario mechanics out by hand
   first — not a "just add a switch statement" job.
2. **Look at it and tune it** — the one thing no test here can do.
3. **Move role-holders in the SHIPPED world.** They currently sit at their stations unless the
   sim-side driver applier moves them, so the client mostly shows a static town. This needs the
   witness-count re-measurement (see the movement note above) — though the geometry change
   suggests that coupling is weaker than feared.
4. **A player avatar.** "I need to be inside the place" is still not literally true — you watch
   the town, you are not in it.
5. **Wire `identityResolved`.** Built and tested, no sender; needs per-connection observer state
   and a real answer to "which player is this connection" (`player.ts` still defers it). Until
   then every body stays a silhouette.

**Known gaps, deliberately left**: `identityResolvedMessages` is built and tested but nothing
calls it — wiring it needs per-connection observer state and a real answer to "which player is
this connection", which `player.ts` still flags as deferred. And nothing moves role-holders in
the SHIPPED world yet (only the sim-side driver applier does).

## Current state (as of 2026-08-19, docs)

**Session ended on a documentation task, not code — read this before anything else.**
User asked for one consolidated document to take into an external visual design tool
("CO design"): *"As a singular design doc representing the node first please so I can
build it out visually also... Just need the current brief to set the visual foundation."*
Wrote `docs/DESIGN_NODE_VISUAL_FOUNDATION_2026-08-19.md` — grounded in the two real,
already-shipped visual docs (`VISUAL_FRAMEWORK_2026-08-12.md`, the founding
`NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md`), not invented: what NODE is, the real settlement
geometry (with the still-open Wall/hub-placement bug flagged so visual work isn't built on
a coordinate about to move), the full shipped data-to-visual mapping table plus the
realized Ember palette and its dynamic-range caveat, an honest per-role verb-differentiation
audit (only Miller and Baker have a real one today), the still-unbuilt heat/memory/
consequence design synthesis from this session's earlier conversation (see below), and the
six standing constraints as binding on any visual/UI work. Every claim tagged
`[SHIPPED]`/`[PROPOSED]`/`[OPEN]` deliberately, since this doc leaves the repo and the code
can no longer correct a wrong assumption for whoever's reading it next. Committed and
pushed to `main` (`7acefe3`), sent directly to the user via file.

**Then the user shared four reference mockup images and asked "do you get what I'm going
for."** Confirmed understanding rather than guessing, then folded two real, consistent
refinements into the brief (not contradictions of its existing doctrine):
1. **Floating diegetic role-glyph** — a small icon over a character (package = Courier
   mid-transit, book = Journalist working a lead) as the visual answer to the role-verb gap
   in §4: the glyph should track the player's *current real action*, never a static
   permanent per-role badge. §4 of the brief.
2. **Copper specifically as the signature of the legal/witnessed state** — not just "the
   warm end of a ramp." Its total absence (a hard switch to desaturated blue-black, not
   dimming) marks the illicit/covert state (a sabotage step in progress, an off-route
   transit), kept as its own channel separate from the existing tension/heat
   economic-strain ramp. Also generalized "colour is the only honest variable" to
   atmosphere itself (smoke/haze density bound to a real variable like
   `economicHealth()`, not scene-dressing). Both in §3 of the brief.

Both DEVLOG'd (`docs/DEVLOG.md`'s 2026-08-19 "Consolidated visual-foundation brief" entry)
and pushed in the same commit.

**Not resumed this session, still exactly where the 2026-08-18 entries below leave them**:
the role-by-role design pass (Detective was covered in conversation this session — see the
still-unwritten synthesis note below — Journalist and Import/Export were not reached), and
THE DIRECTION section's Godot dependency chain (position decoupled from occupancy is still
the next real engine step, not started).

**One piece of this session's design conversation is NOT yet written to any doc file** —
flagging honestly rather than silently losing it, since the session ended on context limits
before it could be filed: a synthesis, discussed at length before the visual-foundation
brief was requested, extending §5 of the new brief — ambient heat generated by interaction
itself (trading, conversation), structure-visibility gated by relationship depth (not just
distance, reusing `proximityConversation.ts`'s INTENT/TONE-vs-REFERENT/CONTEXT split), the
diary as a decaying connection-map of who's near/talking-to-whom among people you know, civic
monuments recording behavioral legacy/pattern ("always gets busted," "runs the economy
well"), and — the one firm resolution reached — **consequence for getting caught stays
economic only (a fine); job/role/opportunity always remain available regardless of record;
civic memory makes the pattern visible to other players, who form their own social judgment,
but the system itself never imposes a structural penalty** (this is the version constraint 6
actually permits — a system-side scrutiny increase would be a demotion by another name). This
is captured in full in `docs/DESIGN_NODE_VISUAL_FOUNDATION_2026-08-19.md` §5, tagged
`[PROPOSED]` — that IS the filed version, nothing further needed, noting it here only so the
next session doesn't wonder whether it survived.

## Current state (as of 2026-08-18)

**2026-08-18**: the `V_i`/constraint-6 open question (below, was still-open as of 2026-08-13)
is resolved — rejected as specified, constraint 6 stays unrevised — and the buildable
alternative offered instead is now BUILT and tested: `multiRoleConscription.ts`'s
`conscriptionFromOtherRole` eviction pick (which existing role-holder gets pulled out of their
role to cover a BACKSTOPPED slot elsewhere) now prefers evicting whoever hasn't held their
current slot for `ESTABLISHED_TENURE_DAYS` days yet (`[CALIBRATED — provisional]`, 30,
adjustable in one place — a named exported constant, not a hardcoded literal, specifically so
the feel can be retuned without touching the selection logic) over anyone who has. This is
PREFERENCE, not immunity: once every other-role candidate has cleared the bar, the pick falls
back to plain uniform random exactly like before — no permanent ranking even among established
players, and nobody is ever permanently un-pickable, unlike the rejected `V_i` shield. New
`RoleEconomicSlot.daysInRole`/`SupportRoleSlot.daysInRole` (uncapped, unlike `experience` which
saturates at `EXPERIENCE_CAP`) feeds this — 0 the moment a slot transitions into FILLED, +1
each day it stays FILLED, frozen otherwise, `ESTABLISHED_TENURE_DAYS` at world creation ("start
maxed, established shard," matching `experience: EXPERIENCE_CAP`'s existing convention). Fully
optional/backward-compatible at the pure-function level — every one of the 553 pre-existing
tests passed unchanged before any new ones were added, proving the omitted-field path is
byte-identical to before. 9 new tests (4 pure-function in `multiRoleConscription.test.ts`, 5
real-`World` integration in the new `test/world.evictionProtection.test.ts`), 562 total,
typecheck clean.

**Then simulated under real load** (user: "simulate it — verify the eviction preference under
real load"), per the standing "simulate before trusting" constraint —
`sim/evictionProtectionHarness.ts`/`evictionProtectionCli.ts`, `npm run eviction-protection-sim`.
A real measurement bug was caught and fixed BEFORE any number got reported: the first draft fed
the "without" arm's own just-neutralized `daysInRole` back into the measurement, so it reported
the constant it had just been reset to every day — fixed with an external tenure ledger
independent of the field being manipulated to neutralize selection. Real, measured result (8
seeds x 3000 days, `DEFAULT_WORLD_CONFIG`): `conscriptionFromOtherRole` fires 692 times (vs.
1058 `conscriptionFromGrifters`) — genuinely exercised under load, not dead code; steady-state
mean `daysInRole` across every FILLED slot is **113.07 days WITH the preference vs. 75.28
WITHOUT — a real ~50% relative uplift**; `economicHealth` moves by only -0.00221 — the
protection costs the shard nothing measurable; population/occupancy accounting never breaks
(minimum grifters+FILLED observed across all runs: 50). 5 new regression tests lock these
numbers in. 567 tests total, typecheck clean. Full reasoning and the caught-bug account in
`docs/DEVLOG.md`'s matching entries.

**Then the level-2 reputation gate itself — "the level-2 trap," this file's own #1 open item
until now — was tackled** (user: "tackle the level-2 reputation gate"), resolving the thread
left explicitly open 2026-08-13 ("explore a different mechanism instead of a threshold change
— specifics requested, not yet supplied"). Root cause re-read one level deeper than the
original finding: the ONLY way a grifter earns the progress level 2 needs is Shift Cover, and
Shift Cover's own selection rule ("neediest — lowest wealth — first") had never given level-1
grifters any priority — worse, once a grifter has already covered a shift or two (which is HOW
they reached level 1), their wealth rises above a brand-new grifter's, so the OLD rule actively
deprioritized them right when the race against `genuineFill`'s 4-role sweep is tightest. Fixed
with `engine/shiftCover.ts`'s `orderGrifterCandidatesForNotice`: grifters at EXACTLY level 1
get first pick, closest-to-level-2 first among themselves; everyone else falls back to the
untouched original rule. `REPUTATION_LEVEL_THRESHOLDS` was NOT touched — genuinely a different
mechanism. Simulated (`sim/levelTwoReachabilityHarness.ts`/`Cli.ts`, `npm run
level-two-reachability-sim`, reconstructing real `DEFAULT_WORLD_CONFIG` dynamics from the same
primitives `world.ts` uses), 8 seeds x 800 days (matching the original 2026-08-13 measurement's
run length): distinct grifters reaching level 2 went from **66 to 235 — a 256% relative
increase**; trap events dropped 604→351; level-0 grifters still receive **75.9%** of all Shift
Cover completions (down from 86.4%, a real but non-starving tradeoff). 10 new tests, 577 total,
typecheck clean. Full reasoning in `docs/DEVLOG.md`'s matching entry.

**Then the eviction preference was sharpened to require real performance, not just tenure**
(user: "grinders should have greater upward mobility than lazy players... activity is the
fastest path to reward, inactivity over time should bite"). A long-tenured but chronically
underperforming occupant was getting the same protection as a genuinely productive one —
tenure measures how LONG someone held a slot, not whether they did the job well. Fixed:
`multiRoleConscription.ts`'s eviction preference now requires BOTH `daysInRole >=
ESTABLISHED_TENURE_DAYS` AND a new `occupantPerformance >= PERFORMANCE_BAR` (0.8), reusing item
4's real `completionStats`/`completionRatio` (normalized per-role via a new
`TYPICAL_COMPLETION_RATIO`, since Miller/Baker's ~55% and the four friction-bar roles' ~97%
aren't otherwise comparable). Same "preference on a neutral floor" shape — the bite lands on an
unearned bonus, never on anything actually held. **A second harness bug was caught before
re-trusting the re-measurement**: `evictionProtectionHarness.ts`'s "without" arm only
neutralized tenure, so once `world.ts` started passing real performance data unconditionally,
it silently stopped being a true "feature doesn't exist" baseline — caught by noticing the
"without" arm's own mean had moved between runs, which it should never do on its own. Fixed;
re-measured (8 seeds x 3000 days): steady-state mean `daysInRole` is **115.94 days WITH the
combined preference vs. 94.40 WITHOUT — a real ~22.8% relative uplift** (down from the
pure-tenure ~50%, expected — some previously-"established" occupants no longer qualify once
performance is also required). `economicHealth` moves by only +0.00523. 5 new tests, 582
total, typecheck clean. Full reasoning in `docs/DEVLOG.md`'s matching entry.

**Then the Oracle got built — first code for a mechanic specified since 2026-08-06.** Built
directly from the already-locked `docs/DESIGN_ORACLE_2026-08-13.md` odds model and prize
shape, not reinvented: new `src/engine/oracle.ts` — `economicHealthWithExperience`-linked win
probability, a weighted, data-driven `ORACLE_PRIZE_TABLE` (wealth / personal resource-stock
top-up / a "time" nudge to `daysAsGrifter`/`daysInRole`), never a role or reputation grant, and
a prize can only ever touch what the winner already has real access to (keeps a solo player
from assembling a multi-role crafting recipe via lucky streaks). Wired into `world.ts` right
after Shift Cover. **Inserting this new rng-consuming stage shifted every downstream tick's
trajectory and broke 6 pre-existing tests — each fixed on its real merits, not loosened
blindly**: the golden-value snapshot regenerated (its own documented policy for a deliberate
order change); two exact-wealth assertions widened to bounded ranges; two experience-floor
tests and one district-weather test made multi-seed after directly re-verifying the underlying
properties still hold. 18 new tests, 594 total, typecheck clean.

**Then: the deferred population-scale simulation harness/CLI got built** (`sim/oracleHarness.ts`/
`oracleCli.ts`, `npm run oracle-sim`), closing `docs/DESIGN_ORACLE_2026-08-13.md` §5's
suggested next step. Not a with/without counterfactual (the Oracle is unconditionally wired,
no config flag, and its effects compound with ordinary market activity within the same tick —
a "strip the field back out" comparison couldn't honestly isolate it); instead a new
`World.lastOracleStats` side-channel (`entrants`/`entered`/`wins`/`winsByPrize`), same
"report what actually happened" convention `lastDiaryRejections` already established, purely
additive. **Real, measured result** (8 seeds x 3000 days): observed win rate **21.24%** tracks
the theoretical health-linked curve **21.25%** almost exactly — the mechanism is calibrated
correctly. Below the ~28-30% "healthy" reference because real steady-state
`economicHealthWithExperience` (~0.79-0.80) sits below `ORACLE_HEALTH_REFERENCE` (0.96) —
expected, not a miscalibration. Prize mix wealth 39.5% / time 39.8% / resourceStock 20.7% (the
skew is structural — resourceStock is role-holder-only). **No death-spiral**: wealthGini,
economic health, and population all stay stable early-to-late-tail in the same run. 6 new
tests, 596 total, typecheck clean.

**Still not done, not silently skipped**: the design doc's shard-wide "nodule bonus" prize; a
"postcard boost" prize (no real per-player postcard balance exists yet to grant one from);
extending the health-linkage to prize odds themselves (§4's still-open question).

**Then: proximity conversation got wired into `stepWorld`.** The "real per-utterance listener
resolution across the connection graph" this file used to flag as making this bigger than
diary's simple queue turned out to already exist: `world.ts`'s Stage 5 already builds a real
`ConnectionGraph` from every FILLED role slot's building position (`buildProximityGraph`, the
same machinery Wall-post rumour propagation already uses) — this reuses that graph rather than
building a second one. New `World` fields: `pendingProximityUtterances`,
`lastProximityConversations`, `lastProximityRejections` — same queue-in/consume-and-clear
convention as `pendingWallPosts`/`pendingDiaryEntries`. Deliberately respects
`comms/proximityConversation.ts`'s own "ephemerality is architectural" header literally: no
identity-ledger update, no diary write, no pressure-ledger update, nothing accumulated across
ticks — unlike the diary, this channel has no relay path of its own. Grifters stay out of
scope, same as Wall-post comms already excludes them. Opt-in and default-empty (only consumes
`rng()` when the queue is non-empty) — all 596 pre-existing tests passed unchanged before any
new one was added. 7 new tests in `test/world.proximityConversation.test.ts`. **603 tests
total, typecheck clean.**

**2026-08-13 so far**: a new design addendum (`docs/DESIGN_ADDENDUM_2026-08-13.md`) proposed a
three-wedge/plaza/wall-gate district geometry and cited a "validated default" role split that
turned out to be stale (traced to a pre-port Python toy model). Verified its underlying
economic claim against the real engine (didn't hold), then — per the user's explicit
decision — extended `jointGridSearch.ts` to re-derive a role/district config at
`targetPopulation=100` properly, and adopted the result: `DEFAULT_WORLD_CONFIG` is now
`M9 B9 C7 J7 D8 IE6` (S=46), `targetPopulation=100` (was M5/B5/C5/J5/D5/IE3=28, pop=65). Full
trail in `docs/BLUEPRINT_HISTORY.md`'s "2026-08-13 addendum received" and "Adopted (2026-08-13)"
entries; a real side-finding (the core-vs-periphery identity-resolution gap disappeared at the
new building-count scaling) is flagged there too. Concept art was then folded into
`docs/VISUAL_FRAMEWORK_2026-08-12.md` as real source material (user's explicit instruction —
the art is modelled from the architecture, not decoration) as §8, which surfaced a genuine
conflict: the addendum's three-wedge geometry implies a district-count question (3 vs 6 vs 11).

Two rejected `AskUserQuestion` framings on that district-count question led the user to
reframe the actual problem: not "how many districts" but "how does a grifter exist in this
world at all" — where they live, how they're seen, how they get a role. That's now written up
as `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`: universal housing (one abode type for
everyone, capacity via floors not plot count), ground-level role access (reusing
`shiftCover.ts` unchanged, not a new mechanic), and reputation levels (two tiers derived from
`roleCompletion.ts`'s measured 54-58% vs 97-100% completion split, additive-only per
constraint 6, backstop always overrides per constraint 2). **Design only — no engine code for
this part.** It flagged a real prerequisite bug: `District.population` (`space.ts`) was never
incremented by the real `stepWorld` tick loop.

**Then the user said "let's resolve the issue before proceeding"** — the district-count
question. Fixing `District.population` (the flagged prerequisite) surfaced a SECOND real bug
immediately: `assignRoleBuildings` starved whichever districts landed last in iteration order
once role count fell short of building count — 2 of the shipped config's 4 periphery districts
held zero role-holders, ever, deterministically. Both fixed (world.ts) — the first fix attempt
at Bug 2 introduced a worse resonance bug (caught by an existing courier-pay test before it
shipped), the real fix processes roles one at a time with a district cursor that keeps
advancing across roles. With both bugs fixed, real per-district numbers were decisive: **1
district per shard beats 3, 6, and 11 on every metric measured** (population, per-district
headcount, health, AND equality — not a tradeoff). `DEFAULT_SHARD_CONFIG` is now
`coreDistrictCount: 1, peripheryDistrictCount: 0`. This resolves the geometry conflict with the
addendum's three-wedge art for free (one district now IS one settlement) and closes
`VISUAL_FRAMEWORK_2026-08-12.md` §8. Full numbers and the real, undeleted cost (the
core/periphery Silhouette-Shield resolution-speed distinction no longer applies to the shipped
default) are in `docs/BLUEPRINT_HISTORY.md`'s 2026-08-13 "District-topology question RESOLVED" entry.
442 tests passing (437 + 5 new), typecheck clean.

Also captured this session but **not yet designed or built**: a tongue-in-cheek
disallowed-rules/fines mechanic (no stealing/arson/trespass/detected misinformation,
Journalist+Detective as mechanical enforcers, violations requiring multiple players trading a
capped per-role resource to craft — nobody can go solo), an explicit ask to simulate that
economy once designed, and a separate ask to put real values/odds/prize numbers into the
Oracle. Full detail in `docs/DEVLOG.md`'s two matching 2026-08-13 entries — recorded verbatim
so none of it is lost a second time (the user flagged they'd raised the fines idea before and
weren't sure it survived).

**Then, same session**: the diary (design-locked since 2026-08-06, never wired to real
content) got composed with housing and the fines economy into one mechanic — a player's diary
now lives in their abode; trespassing (requires a key — the fines economy's first concrete
use) while the owner is offline-or-elsewhere reveals a connections-only view (who they have
diary entries about, not what those entries say), freshly distorted every read via the
existing `comms/decay.ts` primitive so it's never the same stable "truth" twice. Full design in
`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7 — explicitly reconciles with, rather than
contradicts, the diary's existing hard-TTL/no-fade storage decision (only the read-time
projection distorts, not the stored entries). **Design only, nothing built** — depends on
housing/residency, the diary's content schema, and the key-crafting economy, none of which
exist in code yet.

**Also captured, same thread**: arson gets the same absence-gate as trespass ("can't do it
when they're active in their role, but can when they're not at home") — target (workplace vs.
abode) not stated, flagged open rather than guessed, `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`
§7.6.

**Then: "continue working on the build and test as you go."** First real code from the
housing design, not just another design doc — `space.ts` gained `Building.floors`,
`districtHousingCapacity()`, `chooseHousingDistrict()`; `world.ts` gained
`GrifterSlot.districtId`, assigned via a single lazy-fill pass at the end of `stepWorld` (same
pattern the `District.population` fix used) rather than touching every grifter-construction
call site. `District.population` now means real total residents (role-holders + housed
grifters), not just role-holders. Verified against a real run: shipped config, 300 ticks,
housing capacity 372 vs. real population 67, all 22 grifters housed. 9 new tests, 451 total,
typecheck clean. Deliberately scoped down from the full design — no per-building/per-floor
assignment yet (district-level only), no consolidation-displacement grace period for housing.
Full detail in `docs/BLUEPRINT_HISTORY.md`'s "Housing capacity + grifter residency" entry.

Then folded the real shipped numbers into `docs/VISUAL_FRAMEWORK_2026-08-12.md` §9 (floors,
capacity, the "every building is mixed-use, same footprint regardless of role" rule) per the
user's explicit ask — *"ensure it's represented in the visual design so that I can model the
game directly from code and documents"* — so a 3D modeler has real code constants to work
from, not concept-only language.

**Then: "let's continue"** — reputation levels (§3), following the housing build order's own
next step. Before coding, checked whether the design's "persists across a grifter becoming a
role-holder and back" assumption holds against the real engine — **it doesn't**: `player.ts`
already flags player identity as session-scoped/deferred, and `world.ts` has no thread
connecting a grifter to whoever they become after filling a role. Separately, the design's
own voluntary-uptake gate needs to pick a SPECIFIC grifter for a fill, but the real fill
mechanism (`genuineFill`) is a hazard-driven count increment, not a per-grifter selection.
Both real, load-bearing gaps — scoped down to what's honestly buildable: `src/engine/
reputation.ts` (level derivation, additive role-eligibility sets) plus `GrifterSlot.
reputationProgress`, wired into Shift Cover's existing payout (a successful cover earns one
progress-tick, reusing the existing anti-grind cap). **The gate itself is not wired up** —
labeled honestly as level/progress tracking only, not the full mechanic.

Also caught and fixed a real calibration problem before it shipped: the illustrative
thresholds `[3, 8]` were guessed with no data; measured against real 1000-day runs and found
level 2 (8) was NEVER reached once across 9 (seed, churn-rate) combinations — max ever
observed topped out at 7. Lowered to 6, verified reachable, locked in with a regression test.

466 tests total (451 + 15 new), typecheck clean. Full trail in `docs/BLUEPRINT.md`'s
"Reputation levels" entry.

**Then: "the open design threads."** Wrote up both remaining ones in full, design-only:

- `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` — the fines ruleset made coherent. The "capped
  per-role resource" requirement is `resources.ts`'s six already-shipped named resources,
  reused not invented (real gap closed on paper: they're shard-aggregate today, need a
  per-slot personal stock, checked to NOT hit the same identity-persistence wall reputation
  levels hit). Three illustrative item recipes, communal pooling not bilateral trade.
  Detection reuses `ecosystem.ts`'s pattern-based sabotage machinery wholesale — zero new
  detection math. Misinformation explicitly NOT forced into the item shape — already has a
  home in the rumour mill. Fines refund into nodule supply; "nodules keep pace with growth"
  turns out to already be true structurally, no new mechanism needed there.
- `docs/DESIGN_ORACLE_2026-08-13.md` — closes the Oracle's one open item (which metric odds
  float on). Checked both candidates against real measured behavior:
  `economicHealthWithExperience` (0.77 under real attack) recommended over `economicHealth`
  (reads "basically fine," 0.96, under the same attack — an existing finding). Proposed a
  linear, clamped, floored health-to-odds mapping matching the exit-ticket gamble's own
  already-validated flat-odds simulation at healthy conditions. Event prizes scoped to real
  economic quantities only, never standing/reputation (constraint 6).

Both cross-reference, not duplicate, the housing/reputation/diary work already written up.
No code in either — full detail in `docs/BLUEPRINT_HISTORY.md`'s matching entry.

**Then: "let's restructure the reputation gate before coding, then begin."** Done, and live.
`sim/multiRoleConscription.ts`'s `RoleGroupState` gained an optional
`minReputationLevelForFill`, and `stepMultiRoleConscriptionDay` an optional per-level pool
breakdown — both default to the exact pre-existing ungated behavior when omitted (proven with
a byte-equality test), so this was additive, not a breaking rewrite. `world.ts` computes real
per-level grifter counts every tick and wires it up — Miller/Baker require level 2, the four
cooperative roles require level 1, for VOLUNTARY fills only; backstop/conscription still
bypass it entirely.

**Two real bugs found and fixed verifying it against real `stepWorld` runs, not just unit
tests** — both caught by the pre-existing population-conservation test, not hypothesized:
(1) `conscriptionFromGrifters` decremented the aggregate pool but not the new per-level
breakdown, letting a later role's gate pass against a stale snapshot; (2) once fixed, a
subtler mismatch remained — the internal bookkeeping assumed `conscriptionFromGrifters`
always consumes the lowest reputation level first, but the REAL selection in `world.ts` was
still pure longest-wait, level-blind, so the two views of the pool could still disagree.
Fixed by making the real selection also prefer lowest-level-first, matching the internal
assumption exactly. Both traced to an actual reproduction (day 237, seed 3), not guessed.

**A real, measured consequence, reported honestly**: at the shipped config, no grifter
reached level 2 within 800 days across 3 seeds tested — Miller/Baker's voluntary fill path is
effectively closed under current dynamics, filling almost entirely through conscription/
backstop instead. Economic health stayed fine (0.909–0.922, the backstop absorbs it as
always) but this is flagged as a stronger effect than intended, worth a closer look later.

470 tests total (466 + 4 new), typecheck clean. Full trail in `docs/BLUEPRINT.md`'s
"reputation gate" entries.

**Then: "let's explore these options and offer solutions."** Built a real probe (every
grifter's level tracked across 800 days x 3 seeds, not a snapshot) and confirmed the "trap"
with numbers: 105-128 grifters reach level 1 per seed, only 10-21 reach level 2; 83-90% of
those removed while at level>=1 were removed AT level 1 (mean 6.9-16.3 days after reaching
it) — because level 1 opens FOUR roles at once, so most grifters get swept up long before
accumulating level 2's extra progress. Found and fixed a real latent bug while measuring
(`world.ts`'s `genuineFill` didn't prefer the lowest eligible level first, same class of
internal/real mismatch as the gate-restructuring bugs) — didn't move the numbers much on its
own, confirming the four-roles-competing dynamic is the dominant effect. Measured real
threshold sensitivity: 6 (shipped) → 44 total level-2 achievers/3 seeds/800 days; 5 → 77;
4 → 162 — a clean lever, presented with real numbers via `AskUserQuestion`. User chose
"something else" without yet specifying the mechanism; asked directly rather than guessing.
**Unresolved, waiting on the user's answer** — pick this up first next session if it's still
open.

**Then, a separate thread, same session**: *"we need sabotage to succeed more often... it
can't take over 100 days"* → *"sabotage must be relatively easy, but connecting information
must take time"* → *"arson is a far more difficult crime, but still possible. 30% opportunity
is enough to take a chance."* A real three-tier difficulty principle for the whole crime
pipeline. **Sabotage recalibrated and shipped**: `ecosystem.ts`'s
`PATTERN_STEP_CADENCE_DAYS_DEFAULT` 15→7 (detection depends only on steps completed, not
calendar time — halves campaign length for free, zero effect on success rate, confirmed by
measurement) and `PATTERN_P_PER_WITNESS_DEFAULT` 0.01→0.006 (raises success rate). Measured
(8 seeds, 20,000 days): no Detective 71.1% succeed / mean 55 days (was 55.2%/146); with
Detective 40.2% succeed / mean 85 days (was 32.0%/220) — both under the 100-day ceiling,
Detective still meaningfully harder, constraint 2 re-verified. **Arson** (still unbuilt) got a
real calibration target for later: ~30% success rate, a floor not a ceiling, clearly below
sabotage's new numbers — recorded in `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §4.1. **Diary
pace explicitly confirmed unchanged** — "connecting information must take time," "all you
receive is a diary snippet" reaffirms the existing design, nothing recalibrated there.

473 tests total (470 + 3 new), typecheck clean, no test/doc debt left hanging.

**Then, a research-prompt request, then a sharp correction that reopened the diary itself**:
after generating a self-contained research prompt on proximity-conversation moderation logging
(sent as a file, not committed to the repo), the user caught something bigger: *"the diary
changes daily through subtle distortion. no 30 days, only yesterday's mechanical memory of
interaction reset as server. why is all this being ignored..."* This was right, and it exposed
that the §7.4 diary-in-abode reconciliation earlier this same session had defended the *wrong*
version of the diary's retention model — built on the 2026-08-06 static/no-fade/~30-day
assumption without noticing `DESIGN_ADDENDUM_2026-08-12.md` §10 had already proposed daily-ish
distortion two days earlier. Fixed properly, not just patched: `DESIGN_ADDENDUM_2026-08-06.md`'s
Retention section now specifies ~2 days (was ~30), with OBSERVATION/READING distorting once per
server day-tick via `applyDistortion` (`comms/decay.ts` — its header no longer says "NOT used
by the diary," because now it is); SUBJECT and CONTEXT never distort, since identity resolution
must stay reliable (constraint 4). `privateStore.ts`'s `getAlive` gained optional
`distort`/`rng` params (applied once per elapsed day, catching up if several were missed,
entirely opt-in) — 4 new tests. `DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.4/§7.5 rewritten:
the separate read-time-only distortion layer it built for the trespass view is now redundant
(the diary's own storage already drifts daily) and removed; trespass just reads the live,
short-windowed SUBJECT graph. Per the user's explicit follow-up ask, swept every design doc for
other stale references to the old model and fixed them in place rather than just the two files
already in view: `DESIGN_ADDENDUM_2026-08-12.md` §10's own reset-interval numbers (7/14/30/90
days) flagged stale (mechanic still correct, numbers superseded), `ECOSYSTEM_VISION_2026-08-06.md`
and five spots in `BLUEPRINT.md`. Full trail in `docs/DEVLOG.md`'s matching 2026-08-13 entry,
including the honest "why this happened" note.

477 tests total (473 + 4 new), typecheck clean.

**Then: the research prompt came back, with an explicit ask to verify it and build to it.**
User supplied an 11-page report answering the moderation-logging research prompt from earlier
this session, plus: *"everyone has to keep logs, I just need to obey the law... I think we can
verify the results and then ensure the architecture meets these compliance standards."* Four of
the report's claims were spot-checked against primary sources rather than adopted on faith —
COPPA's internal-operations exception (confirmed, with a real gap found: current FTC rule text
also requires naming the specific operations in the privacy policy), DSA Article 17/20
(confirmed), the GDPR biometric-classification argument for TTS output (directionally confirmed
against AEPD guidance, flagged as credible-not-certain since it's general guidance applied to
this case, not a ruling on a system like NODE's — the user separately confirmed reaching the
same conclusion independently), and the Epic Games retention precedent (confirmed, and turns
out more aggressive than what's proposed here). Written up as
`docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`: never store rendered TTS audio (deterministic
synthesis makes it redundant), log five structured fields only to a backend service completely
siloed from the game's own simulation kernel, bifurcated 30-day-unflagged /
Dispute-Archive-if-flagged retention. **Caught and corrected the report's own now-stale
recommendation** rather than adopting it: it suggested matching this log's retention to the
diary's window "for consistency," but the diary shrank to ~2 days earlier the same session —
the doc records explicitly that these are two independently-justified systems (one legal, one
game-design) never required to track each other. No code — design only, same status as fines
economy/Oracle, waiting on proximity conversation's own engine work to exist first.

**Then: "would you agree there are many things we can build already... parked away that could
just be built instead of documented?"** Yes — named three candidates (proximity conversation,
the diary's content schema, arson), user said "let's get busy." **In progress, this same
session, tracked as tasks #66-69:**

- **#66 done**: `src/engine/diary.ts` — SUBJECT/OBSERVATION/READING/CONTEXT built exactly to
  the already-locked addendum spec, `distortDiaryEntry` wired into `privateStore.ts`'s distort
  hook (its first real consumer). 13 new tests, 490 total, typecheck clean. Full detail in
  `docs/BLUEPRINT_HISTORY.md`'s matching entry.
- **#67 done**: `src/comms/proximityConversation.ts` — INTENT/TONE/REFERENT/CONTEXT, presence
  gating, distance-driven degradation reusing `space.ts`'s `proximityCloseness()` +
  `decay.ts`'s `applyDistortion`. 14 new tests, 504 total, typecheck clean.
- **#68 done**: `src/infra/moderationLog.ts` (new top-level dir, deliberately siloed) —
  `captureProximityConversationEvent`, bifurcated retention (`isExpired`, 30-day unflagged /
  6-month-from-flagged Tier 2), `createInMemorySink` reference implementation. Silo boundary
  enforced by `test/moderationLog.importGuard.test.ts`, mirroring the existing driver-guard
  pattern. 9 new tests, 513 total, typecheck clean.
- **#69 done**: `src/engine/arson.ts` — `canAttemptArson` (housing doc §7.6 absence-gate),
  `resolveArsonTarget` (picked default: role-holder's workplace, grifter's abode — the
  workplace-vs-abode question was flagged open in the docs, this is a stated choice, not a
  silent resolution), `attemptArson` (thin wrapper around `ecosystem.ts`'s
  `patternSabotageAttempt`, zero new detection math). Calibrated for real against
  `sim/sabotagePatternHarness.ts`: `pPerWitness=0.02` at 6 steps lands no-Detective 32.0%
  success (mean 110 days), with Detective 18.3% (mean 171 days) — matches "30% opportunity...
  otherwise it's not worth obtaining" as a floor, clearly below sabotage's 71.1%/40.2%. New
  `sim/arsonCli.ts` (`npm run arson-sim`) is the permanent report. 13 new tests, 526 total
  (513 + 13), typecheck clean.

**All three "let's get busy" build candidates are done (#66-69).** Not built, by design, in any
of the three: the Firestarter crafting item and trespass's SUBJECT-graph read both need
`personalResourceStock`/residency-and-keys, real prerequisites flagged in their own docs, not
avoided by accident; TTS rendering and `world.ts` tick-loop wiring for both proximity
conversation and arson are client/infra concerns or need real per-tick spatial/absence data this
pass didn't have. All of this is the SAME "design+sim-verified, not yet wired to a live world"
stage sabotage itself went through before its own harness existed — a real, named stage, not a
gap.

**#66-69 all done, this session.** 526 tests total, typecheck clean. New files this build push:
`src/engine/diary.ts`, `src/comms/proximityConversation.ts`, `src/infra/moderationLog.ts`,
`src/engine/arson.ts`, `src/sim/arsonCli.ts` (`npm run arson-sim`), plus matching test files.

**Then: "fuck it. start wiring it in."** Diary is now the first of the four new modules wired
into the real, live `World` kernel — `World.pendingDiaryEntries`/`World.diary`, processed in a
new `stepWorld` stage right after the identity-ledger update, mirroring `pendingWallPosts`'
exact queue-in/consume-and-clear shape. Rejections (self-entry, unresolved SUBJECT) are caught,
not thrown — `lastDiaryRejections` reports them, one bad entry never blocks another the same
tick. `world.diary` is a documented, deliberate exception to `World`'s otherwise-immutable
snapshot contract: the SAME mutable `Map` across ticks (not cloned), because `privateStore.ts`
was built as one server-authoritative canonical store — see the `World.diary` field's own
comment for the full reasoning. 6 new integration tests, 532 total (526 + 6), typecheck clean.

**Proximity conversation, moderation logging, and arson deliberately NOT wired this pass** —
each hit a real, separate reason, not just running out of time:
- Proximity conversation needs real per-utterance listener resolution across the connection
  graph (bigger than diary's simple queue) — the natural next candidate.
- Moderation logging's own `test/moderationLog.importGuard.test.ts` explicitly forbids
  `src/world`/`src/server` from importing it — wiring it into `stepWorld` would break the exact
  silo boundary built for it. It needs to be consumed from somewhere outside those guarded
  directories, which doesn't exist yet.
- Arson reuses pattern-based sabotage's machinery, and pattern-based sabotage itself is STILL
  explicitly "a PROPOSAL, not shipped as default" per `ecosystem.ts`'s own header — wiring
  arson in would mean promoting pattern-sabotage to shipped-default status too, a real,
  separate decision this pass wasn't scoped to make.

**Also sent** (not committed to the repo): a self-contained research prompt on
reputation-driven retention design, explicitly scoped around the still-open "level-2 trap"
finding and asking for principles synthesized from other games, not a lifted system.

**Then: the user brought externally-produced "v8 spec" design material** (a master document,
three "simulation run reports," an "evolution and verification report") and asked for it to be
saved and built from. Saved verbatim under `docs/external/`. Real, checkable discrepancies were
raised before any of it was treated as verified — full detail in `docs/DEVLOG.md`'s matching
entry, short version: the three "simulation" reports are byte-identical (impossible for a
genuine stochastic run repeated three times), and the material describes infrastructure (a
database layer, "Credits" currency, 64Hz netcode/Saga-pattern transactions, real-dollar API
billing) that doesn't exist in this repo and in places directly contradicts decisions already
shipped here (nodules, not Credits; no database — `stepWorld` is in-memory/deterministic). This
got heated; one real overclaim was made and corrected (asserting no code was ever executed
anywhere externally, which wasn't something there was evidence for either way — the checkable
findings about the artifacts themselves stand independently of that). **New CLAUDE.md rule
added as a direct result, now at the top of the file**: *"Assumption is the mother of all fuck
ups"* — bring up real issues with evidence, don't hold up real work on something checkable.

**The `V_i`/constraint-6 question is resolved (2026-08-18, user directive "answer the V_i /
constraint 6 question"): rejected as specified, constraint 6 stays unrevised.** Two reasons,
not just one:
1. The known one — a shield that switches off below a threshold requires the underlying value
   to be able to fall. That's a demotion. Constraint 6 forbids it outright.
2. A sharper one, derived this pass — a grant-only *permanent* conscription shield is also a
   structural threat to constraint 2 (no permanent zero-state), not just constraint 6. If the
   shield can only be gained and never lost, the population of permanently-unconscriptable
   players can only grow. Given enough shard lifetime, that pool can crowd out the shard's own
   backstop/conscription draft pool — a new, slower path to the exact zero-state failure
   constraint 2 exists to rule out. Grant-only and permanent-immunity-from-the-shard's-own-
   survival-mechanism don't coexist safely.

**Buildable alternative, offered — and then, same day, built and tested (user: "yeah, build the
selection bias extension").** Extended the already-shipped "prefer lowest-standing eligible
candidate first, longest wait" conscription selection bias (built earlier this session for
grifters) to `conscriptionFromOtherRole`: an established occupant (>= `ESTABLISHED_TENURE_DAYS`
in their current slot) is now preferred to survive eviction over a green one, wherever a green
alternative still exists. Preference, not immunity — see the top-of-file 2026-08-18 entry for
the full build summary and `docs/DEVLOG.md`'s matching entry for the complete reasoning.

**What DID get built and tested from that material**: `personalResourceStock`
(`src/engine/personalResourceStock.ts`) — closes the real, previously-flagged gap
(`DESIGN_FINES_ECONOMY_2026-08-13.md` §1) that `resources.ts` only tracks shard-aggregate
flows, not a personal balance any role-holder can spend. Cap=5 (independently proposed twice:
the fines doc's own illustrative guess AND the external material's `UNIT_CAP=5` — real
convergent agreement). Wired into `stepWorld`'s wealth-accrual stage for all six roles, reset
at every real fill-transition point. This unblocks the Firestarter (arson) and Key (trespass)
crafting items.

**Then, a real design question, worked through to a shipped answer**: user asked what happens
economically when a level-2 Miller/Baker is lost and only a grifter is available (shard
survival was never in question — backstop/conscription already bypass the reputation gate,
constraint 2 — but role `experience` resets to 0, a real productivity dip). First answer
(experience head-start scaled by overall reputation level) was wrong — caught directly:
*"grifters don't start at lvl 2"* — the level-2 trap means one's essentially never available
to draw from. User's own fix: *"perhaps only if you've done open shift work as a grifter"* —
scale by real, role-SPECIFIC Shift Cover practice instead. Built and wired end-to-end:
`src/engine/experienceFloor.ts`, `GrifterSlot.shiftsCoveredByRole` (per-role, not the flat
`reputationProgress` counter), threaded through the conscription event loop for Miller/Baker
fills. 9 new tests including a full world-level round-trip.

**Then, caught again — same day, before it caused any real damage**: user flagged the cap
itself as a real compounding-advantage risk, not a style nitpick — *"if a lvl 2 player had a
distinct advantage over a grifter after the backstop... the experienced become the only
players."* Clarified directly that selection was never actually affected (still pure
lowest-level/longest-wait, zero input from shift history — nobody skips the queue), but the
boost's SIZE was a legitimate, unmeasured gap. Cut hard: `EXPERIENCE_FLOOR_MAX_FRACTION`
0.5→0.15, `EXPERIENCE_FLOOR_PER_SHIFT` scaled to match (still 5 real shifts to max out the now
much smaller ceiling). Both remain `[CALIBRATED — provisional]` — a considered correction
under real time constraints, not a measured one.

**Then: "simulate the dip before/after the floor."** Done for real — `sim/
experienceFloorHarness.ts` + `sim/experienceFloorCli.ts` (`npm run experience-floor-sim`): two
`World`s from the same seed run in exact lockstep, one real, one with every grifter's
`shiftsCoveredByRole` stripped each tick as an honest counterfactual (confirmed it never
influences any rng draw or selection). Measured, 8 seeds x 3000 days: only 12.3% of Miller/
Baker fills land any floor at all; among those, mean starting experience is 4.5% of
`EXPERIENCE_CAP`, comfortably inside the 15% ceiling; aggregate steady-state effect is 0.37%
relative on mean experience, 0.00074 on `economicHealthWithExperience` — genuinely small. The
cap correction held under real measurement, not just intent. 4 new regression tests lock the
actual numbers in. **553 tests total, typecheck clean, all committed and pushed to `main`.**

**Then: the playtest harness got scoped AND its Phase A built** — the first thing in this repo
you can watch rather than measure, prompted by the user directly: *"I really need to get to the
position where I can play test the game and design the precise gameplay from experience and
what's fun, rather than assuming simulations will do so."* `npm run playtest`.

Scoped as `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`. **The measurement that de-risked it**:
the shipped shard is a 14x15 grid (90 plots, 62 buildings, probed not estimated), so the whole
settlement is 28x15 characters — fits in 80x24 with a status panel. **The Ember palette** was
chosen from four directions explored on a real-data design canvas (working files kept in
`design/playtest-aesthetics/`). **Auto-ranging is on by default** because measured tension sits
at 0.08 and heat spans 0-0.5 — a naive 0-1 ramp renders the node flat; the honest cost is that
a genuinely calm shard no longer looks calm.

**The synthetic drivers are finally wired.** `src/sim/drivers/` has held four strategies since
Observatory Phase C with nothing ever calling them — `sim/playtestDrivers.ts` is the applier
they never had, on the sim side of `test/drivers.importGuard.test.ts`'s boundary so `stepWorld`
still knows nothing about it. Only `postToWall` actually lands (checked against every driver's
real emissions), and it's enough: seed 7 day 220 goes from zero rumours ever to 33 in a day.
**Two caveats that matter**: wiring posts did NOT move tension (correct — `pressureDetection`
keys off negative-skewed posting, and healthy shards have calm citizens), and a driven run is
**not comparable** to a driverless one (the rumour stage draws from `world.rng` per post, so
trajectories diverge) — **this harness is for feel; its numbers are never simulation results.**

12 new tests, typecheck clean. Phase B (cursor/inspection) and Phase C (the
flashlight — still blocked on the sabotage campaign restructure) are not built.

**THE BLOCKING FINDING from the scoping pass, which reorders the sabotage work and revises an
earlier claim**: `ecosystem.ts`'s `patternSabotageAttempt()` resolves an ENTIRE campaign inside
one function call, with `detectiveActive` fixed as a parameter at call time. A Detective
therefore cannot intervene mid-campaign, because a campaign has no "mid" — which directly
blocks the locked flashlight design. Promoting pattern-sabotage to shipped-default is a
**restructure** (persistent `World.sabotageCampaigns` + a per-tick stepper), not the swap it was
earlier described as. Knock-on: the 71.1%/40.2% calibration was measured against a fixed witness
count and **must be re-measured** against a live stepper.

**Then Phase B — cursor and inspection.** `hjkl`/arrows move an inspection light; `i` hides
it. Selecting a cell reports real state: role, slot state, wealth, personal stock, days in role,
experience/value, heat, completion ratio against that role's typical, identity resolution, and
how long a non-FILLED slot has been empty. Strictly read-only, hard-capped to `mapWidth` so the
status column never shifts. It paid for itself on the first look — a Miller reading BACKSTOPPED,
empty since day 209, completing 0% of 5 attempts against a 55% typical. **A real limitation
surfaced, not hidden**: grifters cannot be inspected, having no coordinates anywhere in this
engine — ~a third of the population is simply not on the map.

**Then THE SABOTAGE CAMPAIGN RESTRUCTURE — pattern-based sabotage is now SHIPPED**, no longer
`ecosystem.ts`'s "PROPOSAL, not shipped". New `engine/sabotageCampaign.ts` is a state machine
only (open / step when due / advance / catch / succeed) over UNCHANGED detection math;
`patternSabotageAttempt` is kept for the fixed-witness harness sweeps but the live world no
longer uses it. `World` gained `sabotageCampaigns`, `nextCampaignId`,
`lastSabotageCampaignEvents`. The hazard now OPENS a campaign; `saboteurCount` caps concurrency;
each step rolls against the witness count real AT THAT MOMENT. A successful campaign evicts the
slot it actually targeted (a real change — the legacy resolver evicted a random set).

**The structural finding**: the caught-saboteur KNOWN GAP was never closable because **the engine
had no saboteur to name** — `sabotageAttempt` takes an anonymous COUNT. `saboteurId` closes that.
The consequence itself (walk of shame, abode lockout, Oracle unlock, fine) is deliberately NOT
invented — still yours to settle.

**Re-measured live** (`npm run sabotage-campaign-sim`, 8 seeds x 3000 days): **43.6% success
among contested resolutions** (vs the old fixed-witness 71.1%/40.2% — they did not carry over),
mean duration 28.9 days (max 42, ceiling 100), opening interval 22.1d vs a 20-day hazard, no
learnable period. Constraint 2 re-verified: min `economicHealth` 0.7652, plus a test holding it
above `BACKSTOP_PRODUCTIVITY` under saboteurCount 8 / cadence 5. **`abandoned` outcome added
after watching a real run** — 27% of campaigns were grinding against targets who had already
churned out. **And a measured caveat**: 96.5% of campaign-steps run "under investigation",
because the interim rule is "a FILLED Detective in the target's district" and the config is ONE
district with 8 Detective slots — investigation is near-constant rather than scarce, which is
exactly what the flashlight is for. `investigatedBy` is built as a REPLACEABLE ASSIGNMENT RULE.

**Then a browser viewer** (`npm run web-export`, `docs/web/`) — a recorded run inlined into one
self-contained page with a day scrubber and tap-to-inspect, so the shard can be seen from a
phone. Explicitly a stopgap and labelled as one: no avatar, nothing moves, grifters absent.

**647 tests, typecheck clean, all pushed to `main`.**

## CLOSED 2026-08-19 — the misplaced Wall and the Courier pay bug (both fixed, `5276919`)

Kept as a record rather than deleted, because the shape of this pair is instructive and the
numbers below are the ones any future geometry work should compare against.

**What was wrong.** `placeDistrictCenters` rings core districts ~9 units around origin — right
for several districts around a shared hub, meaningless for the ONE district shipped since
2026-08-13. So the hub (The Wall) sat on the settlement's western rim: measured across 8 seeds,
6.5-10.5 units off the district's true centre, with ZERO of ~62 buildings west of it. Pulling
that thread found a live pay bug: `courierRouteDistance` was plaza-to-hub, so with one district
every courier had an identical route, and `COURIER_FEE_PER_DISTANCE_UNIT = 0.075` had been
calibrated against ~20-unit routes in the old 6-district layout. **Couriers earned 0.42-0.47/day
against their peers' 1.05 — ~40% — in every run since 2026-08-13**, unseen because no test
compared two roles' wages.

**Why they could only be fixed together.** Centring the district makes `plazaPlot === hubPlot`,
so plaza-based route distance becomes exactly 0 and couriers earn *nothing*. The misplaced Wall
was the only reason courier pay was nonzero at all.

**How they were fixed.** Route distance moved to the courier's OWN station — possible only
because role slots gained `x`/`y` the same day. The single-district case now centres on the hub,
consuming the same `rand()` draws rather than skipping them, so the district **translates**
rather than regenerating.

**Numbers, after.** Hub offset 0.14-0.61 (was 6.5-10.5). Buildings west of hub 43.1% (was 0%).
Courier/peer income ratio **1.028** (was ~0.40-0.45), with real spread 0.46-1.97 across
stations. `COURIER_FEE_PER_DISTANCE_UNIT = 0.344`, calibrated against the **courier-station**
mean distance of 4.357 — NOT the lattice mean (4.829) or all-building mean (4.724), which differ
because `assignRoleBuildings` does not scatter roles uniformly and would underpay by 8-12%.

**A constraint-2 trap that survived the obvious fix**: 1 of 496 generated buildings lands
exactly on centre once centred, which would be permanent zero income with no escape. No courier
drew it in the sample — which is exactly what would have let it ship invisibly. Hence
`COURIER_MIN_ROUTE_DISTANCE = 1`.

**The re-measurement this section used to demand, done.** Sabotage after the geometry change:
**42.9% success (was 43.6%), mean 29.0 days (was 28.9), min `economicHealth` 0.7913 (was
0.7652)**. The feared coupling is real but weak — witness counts depend on distances BETWEEN
buildings, which translation preserves exactly; only texture-driven plot dropout (absolute
coordinates) shifted. `economicHealth` 0.9152 / Gini 0.6896 at 600 days, 8 seeds.

**Still open, unchanged by this**: the literal "commissioner-funded" cross-role wealth debit
(`courierPay.ts`'s header) was never built and still isn't.

## THE DIRECTION, set by the user 2026-08-19

*"I need to be inside the place. PC Godot is the objective."* The viewer was accepted as a
look-at-it stopgap with the explicit condition: *"if it ain't a game then we push on."* It is
not a game. **So the objective is now the Godot client, and the blocker is not Godot.**

The engine has no concept of a person in a place. In dependency order:

1. **A player entity.** `player.ts` still flags identity as session-scoped/deferred; a "player"
   is currently a `buildingId`. Being somewhere requires being someone first.
2. **Position decoupled from occupancy** — THE one everything else stacks behind. Today a
   role-holder IS their building's plot; those are the same fact, so movement is impossible.
   Note this touches the witness counts sabotage rolls against, so it needs re-measuring after.
3. **Grifters on the map** — once position exists independently, the missing third stops missing.
4. **The server streaming a real `World`** — the Phase 3 WebSocket scaffold still broadcasts the
   old MVP scenario.
5. **Then Godot** — most visible payoff, least uncertainty, because by then it renders a world
   that already knows where everyone is.

Not yet decided: whether to scope this the way the playtest harness was scoped (measure first,
find what is actually blocking rather than what looks blocking) or go straight at item 2.

**Next, in rough priority order (refreshed 2026-08-18, second pass — proximity conversation's
own wiring is now DONE, see the entry directly above; renumbered):**
0. **The Godot path above is now the stated objective** — everything below is secondary to it.
1. Whether "let's explore it on each level" meant gating proximity conversation's vocabulary by
   reputation level — proposed, never confirmed. **User asked to take this in a separate
   session and consider it carefully; do not start it unprompted.**
2. ~~Promote pattern-based sabotage~~ — **DONE 2026-08-18.** Arson's own wiring is now unblocked
   by it, and Phase C (the flashlight) is unblocked too.
3. Extend the experience floor to support roles once they get a tracked `experience` field —
   not needed yet, none of the four support roles have one.
4. The Firestarter/Key crafting items themselves, now that `personalResourceStock` exists.
5. The Oracle's shard-wide "nodule bonus" prize (`DESIGN_ORACLE_2026-08-13.md` §3).
6. The Oracle's "postcard boost" prize — blocked on a real per-player postcard balance not
   existing in this engine yet.
7. Whether the Oracle's prize odds should ALSO float on economic health the way the win-roll
   odds do, or stay flat regardless of shard condition — `DESIGN_ORACLE_2026-08-13.md` §4's own
   still-open question, not assumed either way by the harness work above.
8. Moderation-logging's own consumption of the newly-wired proximity conversation channel —
   its import guard explicitly forbids `src/world` from importing it, so this needs a real
   wiring point outside `world.ts`, not built this pass.

The rest of this file below was last fully rewritten 2026-08-12 and is accurate except where
the above supersedes it (role/population numbers in "Shipped configuration" below need the
single-district update — see `docs/BLUEPRINT_HISTORY.md`'s 2026-08-13 entries for the real numbers;
narrative elsewhere referring to "65" as the target, or to 6 scattered districts, is now
historical).

## Current state (as of 2026-08-12, end of session)

**437 tests, all passing; `npm run typecheck` clean. Working on `main` directly.**

**The entire 2026-08-11 Design Addendum's build order (items 0/3, 1, 2, 4, 5, 6, 7, 8) is now
built and tested.** What's left from it is only its own "report back explicitly on" section —
see below, several of those questions are now directly answerable from work already done.

Built and tested before this session: Phase 1 (economic core), Phase 2 (vacancy +
conscription), the §8 MVP mechanic, the client/server scaffold with real targeted delivery,
the ecosystem-scale layer (economic floor, migration, sabotage, experience, districting),
Observatory Phases A-C (spatial primitive, unified `world.ts` kernel, synthetic drivers),
the 6-role roster + grifter pool / district consolidation / multi-shard registry / named
resources / Import-Export-and-nodules work, and 2026-08-11 addendum items 0/3, 1, 2, 4
(District Weather, Silhouette Shield, Economic Heat, uniform role completion). Observatory
Phases D-F are not started.

**This session (2026-08-12), in order:**
1. **Strengthened the grammar invariants** (`test/grammar.invariant.test.ts`) — closed a
   real coverage gap (the old test's role-word blacklist missed 4 of 6 roles and all 84
   shard-local titles), then added two rules the user specified directly in conversation, not
   derived from the brief: **no identification signature** and **no anaphora** ("I feel that
   too" is a vote on someone else's self-state, which is how agreement becomes a whip count
   without ever naming anyone). Rewrote imperative/interrogative/tense checks from word
   blacklists to one structural rule: every sentence must open "I ...".
2. **District Weather's pressure signal fixed** — its computation point in `world.ts` moved
   to after Stage 5 (comms), so `pressureSignal` reflects same-day Wall posts, not
   yesterday's.
3. **Built `engine/pressureDetection.ts`** (2026-08-12 addendum item 1) — Detective/
   Journalist pressure-cluster detection over Wall posts, mechanical not behavioural
   (constraint 3), feeding only District Weather's `tension`, never identifying a
   broadcaster. Closes a real failure mode from the newly-uploaded
   `docs/DESIGN_ADDENDUM_2026-08-12.md`: naming a pressure-broadcaster made ambient fear
   WORSE (+60%) in the historical-case model. See `docs/ADVERSARIAL_CONTAINMENT.md`'s
   "Partially closed 2026-08-12" section.
4. **Visual framework** (`docs/VISUAL_FRAMEWORK_2026-08-12.md`) — user firmly redirected a
   review of two AI-generated concept-art decks from commentary into real, actionable design
   work ("were making a game not a thought experiment"), and separately ruled out generic
   aesthetics ("I don't want one shot minecraft"). Resolved The Wall's location
   (`Shard.hubPlot`), The Market's placement (derived from Economic Heat), and the Wall's
   Emissive Soul aggregation function (spec only, reuses `pressureDetection.ts`'s window
   shape — **not yet built as code**). Caught and corrected a real privacy error in one deck
   (Envelope-sourced Soul would violate constraint 4).
5. **Built district barriers** (`engine/districtAccess.ts`) — user-specified mid-session
   ("some barriers restricting flow of movement between districts... those who can move are
   able to and others have to use the main plaza"), then explicitly instructed to build, not
   just spec. A FILLED role-holder gets a direct side-street shortcut to a real neighbor
   district (`space.ts`'s new K-nearest-neighbor mesh); everyone else, always, falls back to
   the hub route (constraint 2 — never a hard gate). Both open design questions (consolidation
   independence, no cross-player gating) closed structurally and proved by test, not just
   argued.
6. **A 9-item Design Addendum from 2026-08-11 is now fully built**
   (`docs/DESIGN_ADDENDUM_2026-08-11.md`), build order 0/3 → 1-2 → 4-8, scope discipline
   (role roster closed at six) held throughout. **Items 0/3, 1, 2, 4, 5, 6, 7, and now 8 are
   all done.**
7. **Item 5 — no money: nodules as sole root input, closed loop.** `importExport.ts`
   refactored so `nodulesReceivedToday()` is the primary function and `grainDeliveredToday()`
   is derived from it (real code structure, not parallel prose). `resources.ts` tracks
   `nodulesReceived` as a bare `ResourceFlows` field (not a 7th `ResourceName`, to preserve
   the existing 1:1 role<->resource bijection test). New hard-filter coherence test extends
   the flour/bread check down to grain/nodules; new structural test proves `resources.ts`
   defines no exchange/convert/swap/wallet/currency function. No constants changed.
8. **Item 6 — Courier pay: distance-indexed** (`engine/courierPay.ts`). Pay is now a real
   function of the Courier's own district's Manhattan distance to the shard hub (reusing
   `space.ts`'s existing geometry), not the flat `SUPPORT_ROLE_DAILY_WAGE` the other two
   support roles still use. Measured real placement before calibrating: mean route distance
   ~20 units at the shipped default, `COURIER_FEE_PER_DISTANCE_UNIT=0.075` chosen so the
   average stays near what the flat wage paid. **A real design fork, decided and documented,
   not silently narrowed**: the addendum's "commissioner-funded, real transfer" language was
   taken to require the honest-and-buildable core (pay is earned from real geometry, not an
   arbitrary flat number) rather than a literal cross-role wealth debit from Miller/Baker —
   measured that a literal debit would remove roughly a third of their COMBINED daily income,
   which is a new kind of mechanic outside this item's scope, not a fee line. See below and
   `docs/BLUEPRINT_HISTORY.md`'s "Item 6" entry for the full reasoning and what's left open.
9. **Item 7 — Shift Cover**, closing the brief's long-open §2.6 (`engine/shiftCover.ts`).
   Reshaped around this engine's real `BACKSTOPPED` state rather than the brief's original
   player-session concept: any grifter can be probabilistically "noticed" covering a
   BACKSTOPPED slot for one day, earning `SHIFT_COVER_FRACTION=0.4` of what that exact slot
   would have earned genuinely FILLED that day — structurally, not just measured, always a
   worse deal than holding the role, because the fraction is unconditionally under 1. The
   coordinated-abuse case the addendum asks to prove net-negative "in simulation" has no
   constructible player action to simulate (churn is a stochastic hazard, not a player
   choice, anywhere in this engine) — proved the underlying economics exactly instead
   (0.4x wage forfeits 60% of it, every single day, for any alternation pattern). See
   `docs/BLUEPRINT_HISTORY.md`'s "Item 7" entry for the full reasoning.
10. **Item 8 — economic throttle windows**, the addendum's last item. Verified against the
    EXISTING `DAILY_ACTIVITY_MULTIPLIER` downtime mechanic (built 2026-08-11 for a different
    stated reason) point by point rather than assumed to need new code — every requirement
    already held except window COUNT (one vs two). Resolved by splitting the same total
    dampened hours into `THROTTLE_WINDOWS_PER_DAY=2 x THROTTLE_WINDOW_HOURS=4` as real code
    structure — mathematically inert at this kernel's one-scalar-per-day granularity,
    confirmed (not just reasoned) by the fact that no existing golden value or snapshot
    needed to change. Deliberately did NOT build a second throttle mechanism on top of the
    first, which would have silently doubled dampened hours and invalidated every wealth/
    Gini/flourRatio calibration this session's history depends on. See `docs/BLUEPRINT.md`'s
    "Item 8" entry for the full reasoning.
11. **Identity resolution core-vs-periphery sweep** (`sim/identityResolutionHarness.ts`,
    `npm run identity-resolution-report`) — the addendum's last open "report back" question,
    answered with real numbers: averaged across 5 seeds, periphery role-holders take ~35%
    longer to resolve than core ones, real but noisy per-seed, and confirmed to be a pacing
    difference (periphery still reaches >85% resolved given enough time), not a structural
    exclusion. Built a synthetic Wall-posting driver to make the measurement possible at all
    (`pendingWallPosts` has no driver anywhere in the shipped kernel) — flagged as
    measurement-only, same discipline `src/sim/drivers/` already uses for its own synthetic
    policies. See `docs/BLUEPRINT_HISTORY.md`'s "Identity resolution core-vs-periphery sweep" entry.
12. **Item 8's report-back verification, strengthened** (`test/throttleWindowImpact.test.ts`,
    `npm run throttle-window-report`) — proved EXACTLY, not just checked against the shipped
    constant's value, that the throttle windows can never distort market-clearing dynamics:
    grain supply and demand are both linear in the activity multiplier, so `grainFactor` and
    `flourPrice` are provably invariant to it, verified numerically at multipliers 0.1 through
    2.0. Caught a real methodology bug while measuring real per-role numbers (a naive
    population-mean-at-two-points approach conflated income with role-holder turnover — fixed
    with same-slot single-day deltas), and flagged a real nuance rather than hiding it
    (Miller/Baker/Courier/Journalist's completion bonus, item 4, is NOT activity-scaled, so
    their combined income isn't a clean sample — grifters' is, and it landed at exactly the
    proven 30% cut in all 3 seeds). See `docs/BLUEPRINT_HISTORY.md`'s "Item 8 report-back
    verification" entry.

### 2026-08-11 addendum work, briefly (full reasoning in BLUEPRINT.md)

- **Item 0/3 — District Weather** (`engine/districtWeather.ts`): wired a field
  (`District.weatherHistory`) that had existed since Phase A but was permanently empty —
  `world.ts` never wrote to it. `tension` derives from vacancy pressure + consolidation
  state + same-day sabotage, decaying by distance, taking the strongest signal reaching a
  district rather than summing.
- **Item 1 — the Silhouette Shield** (`engine/identity.ts`): a real trigger for
  `isKnown()`, fed from real rumour-hearing events (no per-player trade ledger exists to
  trigger off instead — flagged, not invented). Deterministic procedural faces.
- **Item 2 — Economic Heat** (`engine/economicHeat.ts`): pure rendering layer over
  existing Miller/Baker/friction state — deliberately NOT stored on `World`, zero
  determinism risk.
- **Item 4 — uniform role completion** (`engine/roleCompletion.ts`): one attempt per
  FILLED day, one career ratio, for all six roles. **Caught two real bugs by measuring
  before trusting**: a flat reward-per-completion would have paid support roles ~1.9x
  Miller/Baker's expected daily bonus (their tasks have very different natural completion
  rates — 54-58% vs 97-100% — so reward had to be calibrated per role, not left flat); and
  the reward was initially applied to Miller/Baker wealth AFTER `wealthCap`, silently
  defeating a supposedly hard bound. Both fixed; see BLUEPRINT.md for the numbers.

**A user idea logged but not built**: reputation-earned plaza statues, updating on real
completion events — composes cleanly with constraint 4 (civic memory/monuments) and
constraint 6 (additive-only reputation), and naturally keys off item 4's completion signal
once that existed. Recorded in `docs/DESIGN_ADDENDUM_2026-08-11.md`'s "addendum to the
addendum" section — not scoped or built, a real forward candidate for whenever roster/scope
discipline allows revisiting rendering-layer work.

### The roles, and what each actually does economically

**Miller** (Cournot quantity) and **Baker** (Bertrand price) keep their original validated
market mechanics. **Courier, Journalist, Detective** still share a flat
`SUPPORT_ROLE_DAILY_WAGE` as their base wage — but as of item 4 that is no longer the
*whole* story: all six roles now also earn a per-role-calibrated completion reward on top,
so holding a role well is finally distinguishable from merely occupying it (see item 4
above). **Import/Export** receives nodules daily and automatically (no player action —
"automated to the miller if offline"), converting them to grain, which Millers now genuinely
require in order to mill.

**Grifters** are roleless community players — the newbie, the camper, the socially isolated.
Individually tracked (`GrifterSlot: { id, wealth, daysAsGrifter, consolidationDeadline? }`),
earning a real positive income floor, and the pool every open role is filled from. Nobody is
stuck there by design and nobody in it goes without.

### Shipped configuration, and where it came from

```
rMiller 9  rBaker 9  rCourier 7  rJournalist 7  rDetective 8  rImportExport 6   (S=46)
1 district per shard (coreDistrictCount=1, peripheryDistrictCount=0, buildingsPerCoreDistrict=62)
targetPopulation 100 (brief band was 50-80; raised 2026-08-13, user's own call — see below)
```

District count was 6 (2 core + 4 periphery) earlier the same day, then revised to 1 district
LATER the same day once real per-district population data (a bug fix away — see below) showed
1 district wins on every metric. Population beyond one settlement's natural size is handled by
opening a new *shard*, not more districts within this one — see `docs/BLUEPRINT.md`'s
"District-topology question RESOLVED" entry for the full numbers and reasoning.

**Raised from the original pop=65/S=28 default on 2026-08-13**, user's explicit decision,
after the day's design addendum turned out to cite stale numbers (traced to a pre-port Python
toy model and a pre-Import/Export sweep, both already superseded here) and its underlying
"scale districts not slots" economic claim didn't reproduce against the real engine
(`sim/populationCapacitySweep.ts`). Rather than trust either the stale addendum numbers or
the old pop=65 default used outside its calibrated range, `jointGridSearch.ts` was extended
to take a population argument (`npm run joint-grid-search screen 100` / `confirm 100`) and
re-run properly: 555 allocations screened, 6 discarded as incoherent, 8 finalists confirmed
at full fidelity across all three district layouts — every one passing the flourRatio<=1.0
hard filter. `M9 B9 C7 J7 D8 IE6` won on the same judgement the original pop=65 choice used:
balance over extremes (near-top health, tied-lowest gini among strong performers, a
comfortable flourRatio margin, shard count staying steady rather than inflating).
`DEFAULT_SHARD_CONFIG`'s building counts were raised to match exactly what that winning
layout validated. See `docs/BLUEPRINT_HISTORY.md`'s "Adopted (2026-08-13)" entry for the full trail,
including a real side-finding caught while adopting it: raising building count without also
re-deriving `coreSpacing`/`peripherySpacing` closed the core-vs-periphery identity-resolution
gap that used to exist at the old default — flagged, not silently absorbed.

The ORIGINAL pop=65/S=28 derivation (`npm run joint-grid-search` with no population argument,
still the default invocation): 560 allocations screened at reduced fidelity, **151 discarded
outright as incoherent**, finalists then re-run jointly against 3/6/11 districts at full
fidelity, re-run again after the consolidation defect was fixed with the incumbent explicitly
re-entered as a baseline. That process and its own numbers (population ~56/65, economicHealth
~0.87, Gini ~0.55, grifter wait ~22 days mean, 3 shards, flourRatio 0.83) are historical now —
kept here for provenance, not the live shipped behaviour.

**Live per-shard behaviour at the current defaults** (from the pop=100 confirm-phase run,
6-district layout): population ~87.4, economicHealth ~0.937, Gini ~0.629, grifter wait ~26.9
days mean, ~2.5 shards, flourRatio ~0.616. Grifter wait and Gini are both a real, modest step
up from the pop=65 numbers — not a floor breach (verified directly, not assumed), just the
honest cost of a bigger population target.

### Multi-shard: registry, consolidation, and the population fix

- **`engine/shardRegistry.ts`** — 2 initial shards, ids only ever grow, new shards open only
  when population + stability + cooldown all pass, migration destinations always bounded to
  shards that exist (preferring DORMANT, so a real arrival wakes one).
- **`engine/districtConsolidation.ts`** — per-district health as an irreversible ratchet
  (ACTIVE → CONSOLIDATING → MERGED) on **UNDER**population, with a 14-day grace period,
  trade-route friction that degrades visibly first, and a 2-week gain-a-role-or-be-drafted
  deadline for displaced holders.
- **`engine/ecosystem.ts`'s `opportunityAdjustedMigrationStep`** — the population fix.
  Emigration is damped by *open role-slots per roleless player*, so a thinning shard becomes
  worth staying in and recovers, while a full shard is unaffected (so it cannot cause runaway
  growth). Took the isolated single-shard baseline from 8.1 to 38.5/65.

### Named resources

`engine/resources.ts` tracks six named flows, one owning role each — **grain**
(Import/Export), **flour** (Miller), **bread** (Baker), **parcels** (Courier), **stories**
(Journalist), **leads** (Detective) — as per-day and cumulative totals on `World.resources`.
`npm run resource-report` prints the time series.

```
npm install
npm test                              # 473 tests
npm run typecheck

npm run joint-grid-search             # allocation x district grid (screen | confirm) — THE SHIPPED CONFIG CAME FROM THIS
npm run district-layout-comparison    # 6 vs 11 districts head-to-head, incl. the consolidation mechanism
npm run multi-shard-validation        # single-shard collapse vs multi-shard registry
npm run multi-shard-equilibrium-sweep # what sets equilibrium population, and the bifurcation
npm run resource-report               # named per-role resources over time
npm run wealth-inequality-report      # Gini/top-10% baseline + tax/cap remediation sweep
npm run identity-resolution-report    # core-vs-periphery identity resolution speed, real numbers
npm run throttle-window-report        # item 8: real measured per-role income vs. its unthrottled equivalent

npm run world-sim                     # unified kernel, one running world
npm run sim                           # Phase 1 stability-curve sweep
npm run vacancy-sim                   # Phase 2 vacancy sweep
npm run ecosystem-sim                 # economic-health / sabotage-detection comparison
npm run sabotage-pattern-sim          # pattern-based sabotage PROPOSAL — not the shipped default
npm run spatial-witness-report        # real spatial witness counts vs. the assumed flat 23
npm run mvp                           # two-Baker + rumour-mill scenario, day-by-day output
npm run server                        # WebSocket server for the Godot client

# superseded, kept for provenance:
npm run role-ratio-sweep              # old 2-role sweep
npm run district-role-sweep           # old single-shard 5-role sweep
npm run multi-shard-role-district-sweep  # hand-picked candidates; superseded by joint-grid-search
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ and run the main scene (set `player_id` on Main.gd to `wren`/`sable`/`idris`).
**Still worth opening in a real editor** — the headless run confirms wire protocol and
script logic, not the GUI experience.

## What's next (refreshed 2026-08-18 — the list below had gone stale since 2026-08-12)

**Scope directive (2026-08-11, from the user): the role roster is CLOSED at six. Not looking
to keep expanding roles — build "enough for stability and fun."** Still binding. The work
below is about making what exists hold up, not adding to it. Resist the pull to add another
role or system to solve a balance problem; the last several balance problems — including the
level-2 trap (now resolved, see this file's top entry) — were solved by fixing a constant or a
mechanism, not by adding anything.

**The addendum's entire build order (items 0/3, 1, 2, 4, 5, 6, 7, 8) and its "report back
explicitly on" section are fully closed, as of 2026-08-12** — full detail in
`docs/BLUEPRINT.md`'s per-item entries, not repeated here. Two scoping notes from that work
still worth knowing before touching Courier pay or the throttle windows: Courier pay is real
geometry-earned pay, not a literal Miller/Baker wealth debit (a literal debit removes ~1/3 of
their combined income and would need its own calibration pass); the throttle windows reuse the
pre-existing `DAILY_ACTIVITY_MULTIPLIER` rather than a second downtime mechanic, deliberately.

**Also fully closed since then, from the 2026-08-13 → 2026-08-18 work** (so nobody re-derives
or re-litigates these): universal housing + reputation-level role gating (built, wired,
tested); the diary (built, wired into `stepWorld`, tested); `personalResourceStock` (built,
wired); the experience floor for grifters conscripted into Miller/Baker, including its cap
correction and simulated real dip size; the `V_i`/constraint-6 question (rejected as specified,
constraint 6 stays unrevised); and its buildable alternative, the `occupantTenure`/
`ESTABLISHED_TENURE_DAYS` eviction preference, which is now built AND simulated under real
load (~50% real tenure uplift, negligible economic cost — see this file's top entry and
`docs/DEVLOG.md`); and the level-2 reputation gate itself, resolved via Shift Cover's new
racing-grifter priority (256% more grifters reach level 2, measured — see this file's top
entry). None of that was reflected in this section before this refresh.

~~**The level-2 reputation gate ("the level-2 trap")**~~ — **RESOLVED 2026-08-18**, see this
file's top entry and `docs/DEVLOG.md`'s matching entry. Shift Cover now prefers level-1
("racing") grifters for notice; measured 256% more grifters reach level 2 (66→235, 8 seeds/800
days). Was this list's #1 item; do not re-litigate without a real new finding.

**1. Simulate the Oracle before trusting its illustrative constants further — the explicit
next task, deferred this pass only for time, not by design.** `src/engine/oracle.ts` +
`world.ts`'s wiring are real and tested at the unit/light-integration level
(`test/oracle.test.ts`, `test/world.oracle.test.ts`), but — unlike every other mechanic built
this session — has NO population-scale simulation harness/CLI yet. Build
`sim/oracleHarness.ts`/`oracleCli.ts` (same pattern as `evictionProtectionHarness.ts`/
`levelTwoReachabilityHarness.ts`) and measure, at real `DEFAULT_WORLD_CONFIG` scale: real win
rate vs. the `ORACLE_BASE_ODDS_HEALTHY`/`ORACLE_ODDS_FLOOR` targets; whether
`ORACLE_ENTRY_COST`/`ORACLE_WEALTH_PRIZE_AMOUNT` measurably move the wealth Gini
`test/wealth.regression.test.ts` already locks in (the design doc's own explicit "be most
careful with wealth" flag); whether `ORACLE_PARTICIPATION_PROBABILITY` produces a real,
felt daily-return incentive without dominating other income sources. Also still open from the
same pass, not yet built: the design doc's §3 shard-wide "nodule bonus" prize (dropped for v1
in favor of three personal-grant prize types); a "postcard boost" prize (blocked on real
per-player postcard accrual existing at all — see item 4 below).

**2. Answer the research questions that simulation cannot.** See `docs/RESEARCH_QUESTIONS.md`.
Three are load-bearing and structurally invisible to us, because **the simulation models
compliance as certain** — conscripted players always accept, grifters always wait, displaced
players always take the new role. Nothing in the model can output "the player just quit."
Question 1 (how long will someone tolerate having no role — we currently make them wait ~22
days mean, 100+ worst case) is the single largest untested assumption in the design. This is
now the single biggest open retention question, with the level-2 gate closed.

**3. Built-but-not-wired: face-to-face conversation and arson still have no `world.ts`
tick-loop integration.** (Diary got wired this session; these two didn't.) Proximity
conversation specifically needs real per-utterance listener resolution — bigger than the
simple queue-in/consume-and-clear pattern that worked for diary, since "who heard this" isn't
a fixed target the way a diary entry's SUBJECT is. Wiring arson also means deciding #4 below
first, since it currently reads as a pattern-sabotage-adjacent PROPOSAL, not shipped default.

**4. The sabotage model decision (act-based, shipped, vs. the simulated pattern-based
proposal) is still undecided — and now blocks THREE things, not two.** Item 4's Detective task
had to use a friction bar instead of the addendum's own "catch a saboteur" example; arson's
wiring (#3 above) needs this resolved first too.

**5. Wire real exit-ticket accrual into Import/Export's route detection.** Crossing success
still draws from an aggregate stand-in (`COMPLETE_TICKET_FRACTION`, 57%) rather than real
per-player postcard holdings. The last placeholder in an otherwise complete mechanic — also
what the Oracle's own deferred "postcard boost" prize (#1 above) is blocked on.

**6. Courier/Journalist/Detective's differentiated resources still feed nothing.** All six
roles have a real completion signal and reward (item 4) — "nothing distinguishes holding the
role well" is resolved — but parcels/stories/leads are still produced and tracked with no
consumer. Easiest place in the project to accidentally over-build; keep it to whatever makes
them distinct and fun to hold, not a full economy each.

**7. Extend the experience floor to support roles.** `engine/experienceFloor.ts` only applies
to Miller/Baker because only they have a tracked `experience` field. If Courier/Journalist/
Detective/Import/Export ever get one (see #6), the same grant-only, role-specific-practice
mechanism should extend to them rather than a new one being invented.

**8. Shard diversity is at Tier 1 (cosmetic) and deliberately stops there.** Shards differ in
name and local role framing (`engine/shardIdentity.ts`) — mechanics are identical everywhere,
enforced structurally (`world.ts` cannot import the module, and a test proves it). **Tier 2
(per-shard mechanical differences) is blocked** on research question 10 —
`chooseMigrationDestination` assumes shards are interchangeable, so the moment they differ in
quality the simulation would report a stability it is no longer testing.

**9. Physical building relocation on MERGE.** A merged district's buildings stay in place,
permanently friction-penalised, rather than relocating capacity into a surviving district.

**10. Observatory Phases D-F** (snapshot/replay contract, the web app, civic-memory
monuments) — not started.

**Still open, unchanged, lower priority:** `TRAVEL_DAYS_TARGET=168` vs the postcard/tier 4-8
week target; real Phase 4 rendering; Phase 5 voice/safety (hard-gated on legal review).

## Things to know before you touch this

**The flour chain is the most fragile coupling in the system — check it after any config
change.** Three separate times, a change elsewhere (adding a role, fixing consolidation,
changing district counts) silently pushed the grain→flour→bread chain incoherent, meaning
Bakers baking flour nobody milled. It is invisible to every population/health/equality
metric. `joint-grid-search` treats `flourRatio <= 1.0` as a **hard filter, not a score**,
which is the only reason it keeps getting caught — 151 of 560 allocations fail it.
`FLOUR_PER_BREAD` is the free parameter that absorbs adjustment; the role allocation is
chosen on design grounds and should not be bent to fix the chain.

**Covert mechanics must not run on learnable clocks; overt ones may.** Sabotage used to fire
on `day % sabotageCadenceDays === 0` — a covert mechanic on a public 20-day timetable, which
any player tracking dates learns in two cycles. Now a per-day hazard of `1/cadence`: identical
expected frequency (verified 1 per 20.3 days), no learnable period. The vacancy flag, backstop,
conscription delay and consolidation grace period are deliberately left deterministic — those
are civic timers and public pressure only works if the clock is public.

**Direct channels cannot carry a plan, and that is load-bearing.** An `Envelope` payload is a
single `SelfState` — ten first-person feelings, no free text, no subject, no third-party
reference. Tapping every private channel yields a distribution of moods, never intentions.
Adding free text or a subject slot for "expressiveness" would convert direct channels into an
information-brokering vector; treat that request as a containment change, not a UX one.

**The grammar's safety is STRUCTURAL, not scarcity — which is why the vocabulary can grow.**
The user has said vocabulary WILL expand (envelopes, voice, the Wall). That is fine, and
`test/grammar.invariant.test.ts` is what makes it safe: it enforces sentence *shapes* against
the whole template table, derived from source, rather than blacklisting today's ten entries.
Three rules there are load-bearing and must survive any expansion:
- **No external identification signature.** A message may never carry a referent that
  *resolves* to a specific person — no pronoun aimed at another player, no definite singular
  description ("the one I met"), no proper noun, no handle. This holds regardless of what the
  sender knows. It is the mechanical form of constraint 4 (remove the referent and no private
  dossier can be built, because nothing is captured), and what makes constraint 6 enforceable
  (the way you bury someone is by naming them to third parties).
- **No anaphora — no message may reference another message.** "I feel that too" is not a
  self-state, it's a *vote* on someone else's, and a chain of votes is a whip count built
  without ever naming anyone. Enforced lexically AND structurally: `WallPost`/`Envelope` are
  proven to carry no reply/thread/parent field, plus a source-level grep guard, because the
  other way to build a whip count is a `replyTo` field the client renders as "N people agreed."
- **Every sentence opens "I ..."** — which structurally excludes imperatives (can't instruct
  an ally) and interrogatives (can't ask a direct question), and stays true however many verbs
  the vocabulary gains. This replaced word blacklists, which go stale by construction.

**Known open hole in the above, flagged not solved: role-reference cardinality.** The design
intends role-level reference to become sayable eventually, gated on relationship-earned
reputation ("the courier is being difficult"). That is only safe when the role has enough
occupants to not resolve to a person — and Miller scarcity is a *design pillar*, so at k=1
"the Miller" IS a name, by elimination, and no linguistic dressing fixes it. Any future role
vocabulary needs a mechanical **k-anonymity guard** (only emittable when the referenced role
has ≥k live occupants in the recipient's visible scope), not just a reputation gate. No role
vocabulary exists yet; the base grammar bans all role words outright and a test proves it.

**The untouchable floor protects the powerful player as much as everyone else** — read
`docs/ADVERSARIAL_CONTAINMENT.md`'s closing section before ever weakening constraint 2 or 6
"for stakes". Destructive power is self-consuming: zeroing someone destroys years of their
investment *and* removes them as audience, rival and witness, leaving a dominator running an
empty town. The floor is what keeps people in the room, which is what makes being known worth
anything. The design does not ask ambitious players to want less; it removes the one move
that would cost them what they actually want.

**Containment of adversarial players rests on properties that are easy to remove by
accident.** See `docs/ADVERSARIAL_CONTAINMENT.md`. In short: wealth is currently a scoreboard
that buys nothing, sabotage is uniform-random and cannot be aimed at a person, roles are
single-occupancy and rotate by churn/conscription regardless of merit. Those three are what
stop a determined player taking a quiet shard apart — and two of them are **incidental**,
not designed. Making wealth spendable or sabotage targetable would each break it, and neither
would look dangerous in isolation. Re-verify containment whenever either is touched, the same
way supply-chain coherence is re-verified after a config change.

**The economy is the board, not the game — keep it computable.** All the stabilisation work
in this repo exists so players can *reason* about the world: work out what flour will cost,
when a slot opens, what a district's decline implies. Do not add hidden modifiers or
unlearnable rules to "add mystery" — the mystery is supposed to live in other people (allies
who cannot be briefed, intel that expires, witnesses who may not be there), not in obscured
arithmetic. The target is **calculable but not solvable**: a player should be able to compute
the odds and still not know the answer. See `ADVERSARIAL_CONTAINMENT.md`'s "deeper calculus"
section — it also gives the first concrete design target the Detective/Journalist roles have
had ("caught less than you succeed", as a career ratio, not a per-attempt probability).

**Stability is the floor, not the goal.** Most of this session optimised for stability, and
that work is necessary — but a perfectly stable shard is a placid idle game. Time and
migration are the antagonists; the pressure is supposed to bite. Do not treat "more stable"
as automatically better: a change that calms the equilibrium by removing pressure (longer
tenure, softer consolidation, cheaper migration) may improve every metric here while making
the game worse. Nothing in this repo measures whether anything is still at stake.

**Shard premises explain shared behaviour socially; they never imply different mechanics.**
All shards run identical constants. A premise gives a local *reason* for the same turnover
and decline (debt, shift rotation, transience, affordability), not a different rate. Test for
any new one: could this be true of a place whose numbers are identical to everywhere else?

**Miller scarcity is a design pillar, not a tunable.** Several candidates score better on
coherence margin purely by adding Millers. Those were rejected repeatedly and deliberately —
including one that was otherwise identical to the incumbent on every outcome metric.

**Two corrected errors worth not repeating:**
- *"Smaller districts trip the consolidation ratchet more often"* — **wrong**, and it sat in
  the docs as fact for a while. 11 districts merge LESS than 6 (12.1% vs 22.2%): fewer slots
  per district means the threshold needs nearly all of them empty at once.
- *Sizing a supply constant against measured demand* — the first nodule rate was set against
  grain demand measured **before** the supply gate existed, which was circular
  (`grainConsumed` derives from flour actually milled, so once milling was grain-limited the
  reported demand was itself suppressed). Measure UNCONSTRAINED demand.

**`MERGED` was an absorbing state, and the first fix was also wrong.** An irreversible ratchet
on an instantaneous threshold doomed every district within ~500 days. Requiring N consecutive
days on the *raw* fraction didn't fix it either — it produced a cliff, with healthy and
collapsing shards giving identical results. The working fix smooths the signal first (~30-day
EMA), then applies the unchanged tipping point. **Irreversibility is untouched** — only the
definition of "passed a tipping point" changed, from one bad day to sustained decline.

**A completion reward must never be applied outside the taxed/capped income flow.** Found and
fixed while building item 4: the reward was first added to Miller/Baker wealth *after*
`applyWealthCap`, so a wealth-capped world could exceed its own cap by one reward per tick —
a silent hole through a supposedly hard bound. It is now folded into the income flow itself,
before tax and cap, like every other unit of Miller/Baker income. Any future bonus, grant, or
payout on those two roles must go in at the same place. (The four support roles are outside
tax/cap scope entirely, so theirs applies directly to wealth — that asymmetry is deliberate
and commented at both sites.)

**Structural parity is not the same as realized parity — measure it.** Item 4's first design
gave every role one attempt per FILLED day and one flat reward, which *looks* like equal
opportunity by construction. Measured, it wasn't: Miller/Baker's task is zero-sum against
rivals (~54-58% completion) while the support roles' friction-bar task completes ~97-100% on
a healthy shard, so a flat reward paid support roles ~1.9x. `COMPLETION_REWARD` is calibrated
per role type as a result, and `test/roleCompletion.test.ts`'s hard filter (+-30% band around
the cross-role mean) is what keeps it honest — the same role `flourRatio <= 1.0` plays for
the supply chain. Re-measure it if any task's completion condition or the role counts change.

**Nodules are tracked outside `RESOURCE_NAMES`, deliberately.** `resources.ts`'s
`RESOURCE_OWNER` is a strict 1:1 role<->resource bijection with its own test guarding it.
Import/Export already owns `'grain'`, so nodules live as a bare `nodulesReceived` field on
`ResourceFlows` instead of a 7th named resource — don't "fix" this by promoting nodules to
`RESOURCE_NAMES`, it would break the bijection test for no real gain since nodules and grain
share one owner and one origin.

**District barriers are a shortcut on top of the hub floor, never a gate — read
`districtAccess.ts`'s header before changing who gets `hasShortcutAccess`.** The two
containment questions (does district health affect access; can one player gate another's) are
closed structurally (no import of `districtConsolidation.ts`; no per-player identity input
beyond the traveler's own status) and proved by test, not just documented. Any change that
makes access depend on anything other than the traveler's own FILLED/VACANT/BACKSTOPPED/
grifter status needs the same structural proof, not just a new comment.

**The Wall's Emissive Soul is specced but not built.** `docs/VISUAL_FRAMEWORK_2026-08-12.md`
§3 resolves its aggregation function (reuse `pressureDetection.ts`'s rolling-window shape,
shard-wide across all 10 `SELF_STATES`) but no `soulTemperature` code exists yet, and
`WALL_SOUL_WINDOW_POSTS` has no measured value. Don't assume it's live.

**Other standing notes:**
- `multiRoleConscription.ts` is a NEW function; the old 2-role `stepConscriptionDay` is
  untouched and still covered by its own tests. Don't merge them without checking both.
- `engine/economicHeat.ts` is deliberately NOT on `World` and NOT called by `stepWorld` — it
  is a pure projection over a `World` snapshot, so it cannot affect determinism or tick
  order. Keep it that way; if it ever needs to be stored, that is a real design decision.
- `engine/shardIdentity.ts` and now `engine/economicHeat.ts` are both consumed *outward*
  only. The `drivers.importGuard.test.ts` pattern (structurally proving a module isn't
  imported where it shouldn't be) exists for exactly this class of guarantee.
- `vacancyParamsFor`'s `N` uses live `world.population`, not the static target (fixed this
  session). This makes single-shard collapse look worse in isolation — expected, not a
  regression; the multi-shard registry is the actual fix.
- `wealthTaxRate`/`wealthCap` remediation stays scoped to Miller+Baker only, even though
  `wealthGini` spans all roles + grifters. An explicit, flagged scoping gap.
- Import/Export interception carries **no state between attempts** — "no learnable pattern"
  is structural, not cosmetic.
- The Oracle: deterministic outputs, no AI involvement. Presented ATM-like, lit and glowing so
  it reads positive *regardless* of payout — mechanically load-bearing, since it stops players
  reading shard health off it.
- The Baker price equation is NOT the brief's literal §1.3 equation (mean-reversion fix).
- Phase 2's beta/t_hard are recalibrated (`beta=0.03, tHard=3`) — the brief's literal values
  provably can't hit its own §2.4 targets.
- `stepMillers`/`stepBakers` throw below n=2; `stepCompetitiveLayer` freezes values instead.
- The private diary is NOT part of the decay family — hard silent TTL expiry, don't retrofit.
- Sabotage targets all roles and pushes the evicted player into the grifter pool.
- The Godot client is verified headless (2026-08-07), not yet in a real GUI editor.
- Every `[ILLUSTRATIVE]` constant carries a doc comment explaining what it was derived from.
  Read those before changing one — most are swept, not guessed.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite this
file at the end, keep the root `README.md`'s Status section current. Push doc updates one at
a time, not batched. `CLAUDE.md` also carries six standing design constraints binding on all
future work — check new work against them every session.
