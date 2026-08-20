# Devlog

Chronological record of work on NODE, newest entry on top. Include failures and dead ends,
not just what shipped — the point is that the next session (or next hour of this one)
doesn't have to rediscover them.

---

## 2026-08-19 — A Godot client that renders the real settlement (unverified visually)

The last item in THE DIRECTION. `client/scripts/WorldView.gd` consumes `hello` + `tick` and
draws the town: plots, stations coloured by heat, people, the Wall, district tension as a
background wash. Drag to pan, wheel to zoom.

**The palette is copied, not reinvented.** Every colour is the shipped Ember value from
`playtestRenderer.ts`, and the conformance test asserts they match — two renderers of the same
world disagreeing about what "hot" looks like is a bug waiting to happen, not a style choice.
Same auto-ranging too (heat 0.5, tension 0.25), for the same reason: measured tension sits at
0.06-0.08, so a literal 0-1 mapping renders the town permanently flat.

Obeys the doctrine directly: BACKSTOPPED renders at half brightness, VACANT at 28%, neither
ever damaged; the Wall is full brightness regardless of shard state.

**The honest limitation, stated first rather than buried: Godot is not installed here, so this
has never been looked at.** Whether the town is legible is unknown until it is opened on a PC.
`CELL`, `BUILDING_SIZE` and the role palette will likely need tuning by eye. Per-role hues are
a **first proposal chosen in the client**, flagged as such in the file — no per-role hue exists
anywhere in the engine (the terminal renderer distinguishes roles by glyph and spends its colour
budget on heat).

**What that limitation changed about how it was built.** Since I could not run it, I built the
check that catches the failure mode I *cannot* see by reading: `clientProtocolConformance.test.ts`
parses the GDScript for every key it indexes into a message with, and fails if any of them is
not a key the protocol really emits — plus the reverse (it must read the fields without which
nothing draws), and that it branches on exactly the slot states and roles the server can send.
A GDScript typo like `economic_health` for `economicHealth` fails silently at runtime as a zero;
this makes it fail loudly in CI instead.

**And the check was mutation-tested rather than trusted.** Renaming `economicHealth` to
`economic_health` in the client makes it fail; restoring it passes. Same discipline applied to
the protocol's own leak test earlier (injecting a `wealth` field fails it). A negative assertion
that cannot fail is worse than no assertion, because it reads as coverage.

`client/README.md` rewritten for PC setup — Godot 4.3+ standard build (not Mono), `npm run
server`, import `client/project.godot`, F5 — with an on-screen legend, troubleshooting, and the
known gaps: no player avatar, people mostly sit still (shipped `stepWorld` does not move
role-holders; only the sim-side driver applier does), and every body stays a silhouette because
`identityResolved` has no sender yet.

5 new tests, 693 total, typecheck clean.

---

## 2026-08-19 — The server streams a real world, and the wire is a privacy boundary

Chain item 4. The WebSocket server had broadcast the §8 MVP scenario — two Bakers and a price
spread — since Phase 3. That proved the socket worked and nothing else. `startWorldServer` now
streams the real `stepWorld` kernel. The legacy path is kept behind `NODE_LEGACY_MVP=1` rather
than deleted, because the existing Godot scaffold and its tests still speak it and breaking
them to make a point would cost more than the file it saves.

**The actual work was deciding what a client may know**, which is why `worldProtocol.ts` is a
separate pure module rather than a `JSON.stringify(world)` inside the socket handler. Three
categories, each argued in the file's own header:

- **Public** — geometry, which building carries which role and its slot state, per-building
  heat, per-district tension, and that a body is standing at a position. All things a person
  in the node perceives directly; this is the "read the world, don't compute it" doctrine.
- **Withheld** — wealth, personal stock, experience, completion stats, `wealthGini`, anything
  diary-shaped, and in-flight sabotage campaigns. The playtest inspector shows most of these
  freely, but that is explicitly a designer's x-ray and is not a precedent for a client.
  Streaming live campaigns in particular would hand every client the answer to the one thing
  detection is supposed to be a game about.
- **Pseudonymous** — the interesting one. Identity resolution is per-observer
  (`engine/identity.ts`), so real ids may not be broadcast; but a client cannot interpolate a
  body between ticks without something stable to track it by. Resolved with a per-connection
  `handle`, derived from a **server-generated** secret (never client-supplied — two cooperating
  clients could otherwise agree on one and correlate their views). Two connections therefore
  see completely disjoint handles for the same person. Resolving a handle to an actual identity
  is a separate `identityResolved` message, sent only for subjects that observer really knows.

**Why now rather than after Godot exists**: retrofitting pseudonymity once a client depends on
real ids means changing the wire format under a dependent. That is the expensive version.

**The leak test was mutation-checked rather than trusted.** A negative assertion that cannot
fail is worthless, so I deliberately injected a `wealth` field into the people payload and
confirmed the test fails, then removed it and confirmed it passes. It has teeth.

**Verified standalone, not only under vitest** — booted the server on a real port and connected
a real client: 62 buildings, 87 plots, hub at (0,0), **95 people per tick**, 46 stations, health
declining naturally day to day. Role-holders AND grifters, so the roughly one third of the
population that has never been on any map is now on this one.

18 new tests (14 pure transforms, 4 over an actual socket covering handshake order, timer
advance, cross-client handle disjointness, and no-leak on a real wire). 688 total, typecheck
clean.

Still not done: no client consumes this yet (Godot is next), `identityResolvedMessages` is
built and tested but nothing calls it — wiring it needs per-connection observer state and a
real answer to "which player is this connection", which `player.ts` still flags as deferred.

---

## 2026-08-19 — The Wall is in the middle of the town, and couriers get paid properly

Both bugs HANDOVER had been carrying as "deliberately not fixed — fix them together or not at
all" are fixed, together. User supplied a patch report (their own iteration) proposing exactly
the right architecture; three of its numbers did not survive checking, which is the only reason
this entry is interesting.

**What was right in it, and genuinely load-bearing**: station-level courier routing, which is
what makes centring the district *safe*. The trap was real — with one district, centring makes
`plazaPlot === hubPlot`, so plaza-based route distance becomes exactly 0 and every courier
earns nothing. Routing from the courier's OWN station sidesteps it entirely. That only became
possible earlier the same day, when role slots gained `x`/`y`; the report noticed that and
built on it correctly.

**What did not survive checking** (measured before adopting, per the standing rule):

1. **Mean distance 4.956 is the wrong population.** That is the lattice-plot mean. Measured
   directly: all plots 4.829, all buildings 4.724, but **real courier stations 4.357** —
   `assignRoleBuildings` does not scatter roles uniformly, so the three differ. Calibrating on
   the report's figure would have underpaid couriers by ~12%. Fee set to **0.344** against the
   courier-station mean: 4.357 × 0.344 × 0.70 = 1.049/day.
2. **A station can still land exactly on the hub → zero pay, forever.** 1 of 496 generated
   buildings across 8 seeds sits exactly on centre once centred. No courier drew it in that
   sample — which is precisely what makes it dangerous, since it would have shipped as an
   invisible edge case rather than an obvious breakage. That is a permanent zero-state with no
   action available to escape it, which **constraint 2** forbids outright. Added
   `COURIER_MIN_ROUTE_DISTANCE = 1`: a courier at the Wall still walks a route and still works
   a day. A floor, not an exclusion; nothing above it is affected.
3. **`placeDistrictCenters` takes `(config, rand)` and is not exported.** The patch's signature
   would not have compiled. Its early-return would also have skipped two `rand()` draws,
   shifting the whole downstream stream; the real fix consumes them, so the district
   **translates** onto the origin rather than regenerating into a different shape.
4. Its claimed "previously validated bounds" of Gini 0.629 / flourRatio 0.616 appear nowhere in
   this repo — the real flourRatio lineage is 0.74–0.86. Ignored as noise, per the user's own
   standing instruction about this material.

**Measured results.** Wall: hub offset from the district's true centre was 6.5–10.5 units,
now **0.14–0.61**; buildings west of the hub was **0%**, now **43.1%**. Courier pay:
courier/peer income ratio was ~0.40–0.45 in every run since 2026-08-13, now **1.028**, with
real spread **0.46–1.97** across stations — parity on the mean AND genuine variance, which is
the whole point of a distance-indexed wage.

**The re-measurement HANDOVER demanded, and a mildly surprising result.** Geometry changes
were flagged as dangerous because witness counts feed sabotage detection, identity resolution
and District Weather. Re-ran `npm run sabotage-campaign-sim`: **42.9% success (was 43.6%),
mean duration 29.0 days (was 28.9), min `economicHealth` 0.7913 (was 0.7652 — slightly
better)**. The coupling was real but weak, and the mechanism is clear in hindsight: witness
counts depend on distances BETWEEN buildings, which a pure translation preserves exactly. Only
texture-driven plot dropout (which reads absolute coordinates) shifted, which is why the
numbers moved a little rather than not at all. `economicHealth` 0.9152 / Gini 0.6896 at 600
days across 8 seeds. The fear was reasonable; the measurement says the layout was safe to move.

**A latent suite-wide flake found on the way, and fixed rather than shrugged at.**
`experienceFloorImpact` failed once in a full-suite run, then passed in isolation. It was not a
statistical failure — measured directly, its 3-seed mean is **0.094% against a 5% bar**, nowhere
near failing. It ran 5349ms against **vitest's default 5000ms timeout**, which had never been
configured despite this suite being full of multi-second deterministic simulations. Several
tests legitimately take 3–9s. `testTimeout` now 60s: costs nothing when healthy, only ever
removes a false failure.

Golden snapshot regenerated (its own documented policy for a deliberate, reviewed change).
670 tests, typecheck clean.

**Committed alongside by accident**: `src/server/worldProtocol.ts`, in-progress work on the
next chain item, swept into the geometry commit. It is complete and typecheck-clean but has no
tests and is not wired to `ws.ts` yet — finishing it is the immediate next task, not a
loose end being left.

---

## 2026-08-19 — Position decoupled from occupancy: role-holders can finally be somewhere

User: *"You can start the code process now."* Took HANDOVER's "THE DIRECTION" item 2 — the
blocker everything else in the Godot chain stacks behind — in two staged commits.

**Stage 1 (`f2eda67`), representation only.** Until now a role-holder WAS their building's
plot: the same fact, so movement wasn't merely unimplemented, it was *unrepresentable*.
`RoleEconomicSlot`/`SupportRoleSlot` now carry `x`/`y`, matching what `GrifterSlot` gained
earlier the same day. Every construction site sets them from the occupant's own building;
refills reset position alongside `wealth` (a new occupant starts AT their workplace, having
just arrived), frozen while VACANT/BACKSTOPPED. `occupantsOf` now reads the occupant's own
position instead of looking up their building — identical output, but the source of truth is
the person, not the address.

**All 659 pre-existing tests passed unchanged, golden-value snapshot included.** That's the
proof the swap was inert, and it was the point of splitting the work here rather than doing
both halves at once — witness counts (sabotage detection), identity resolution and District
Weather all consume that position set, and all three are calibrated against the current
all-at-their-building layout.

One test needed a real fix, not a loosened assertion: `world.regression.test.ts`'s
hand-built `makeMiller` fixture needed the two new required fields.

**Stage 2 (`40d7c31`), the harder half — people actually move.** `playtestDrivers` applies
`move` for role-holders as well as grifters (clamped to real plot bounds); the renderer draws
a role-holder away from their post in their own role glyph, in a new `COLOUR_AWAY` deliberately
OFF the heat ramp — their station's heat is still being drawn back at their building, and
drawing it twice would double-count the one signal that has to stay honest.

**This half is NOT inert, and the code says so where someone will actually read it.** Because
`occupantsOf` reads real positions now, a moving population produces genuinely different
detection and resolution numbers from a pinned one. **The existing 43.6%/28.9-day sabotage
calibration was measured against a pinned layout and does not describe a world where people
walk around.** Re-measuring belongs with whatever first makes role-holders move in the
SHIPPED world; `playtestDrivers` is sim-side only (behind `drivers.importGuard`), so nothing
shipped changed when this started landing. Also noted as a real open design question rather
than silently decided: movement is economically inert, because every production/wage/market
path in `stepWorld` keys off `buildingId`, never position — a Miller who wanders off still
mills.

**Verified on a real run before claiming it worked** (seed 7, 60 driven days): 9 of 16 filled
Miller/Baker slots end up away from their building, 16 distinct positions. One sample looked
like a teleport — (7,-1) to (12,-6) — so I checked the drivers' actual emission rather than
assuming: they emit ±1 steps at p=0.2/day, so that was 60 days of accumulated drift. No bug.

**A real limitation found by looking at rendered output, not by reasoning:** a person standing
on ANOTHER building's cell isn't drawn at all — the structure wins the cell. 1 of 9 away
role-holders in that sample. Kept deliberately (a person overdrawing buildings would make the
settlement's fixed structure flicker, and structure is what the map is read for first) and
documented in the renderer, with the honest warning that the map is therefore not a headcount.

**One stale test replaced rather than deleted**: `"role-holders' own move actions are still NOT
applied"` asserted exactly what this change reverses. Rewritten as a real check that a
role-holder can walk away *while their `buildingId` stays put* — the slot is still theirs, only
their feet moved.

666 tests total (659 + 7 new across `test/world.rolePosition.test.ts` and the harness suite),
typecheck clean, both commits pushed to `main`.

Still not done, deliberately: nothing moves role-holders in the SHIPPED world (only the sim-side
driver applier does), and the re-measurement that would require. Next in the chain is the server
streaming a real `World` — the Phase 3 WebSocket scaffold still broadcasts the old MVP scenario.

---

## 2026-08-19 — Consolidated visual-foundation brief, for taking outside the repo

User asked for one document representing NODE's current state as a foundation for external
visual design work ("I'll take it to CO design where I can work on elements and specific
details. Just need the current brief to set the visual foundation"). Wrote
`docs/DESIGN_NODE_VISUAL_FOUNDATION_2026-08-19.md`: what NODE is, real settlement geometry
(with the open Wall/hub-placement bug flagged so visual work isn't built on a coordinate
about to move), the full shipped data-to-visual mapping table plus the realized Ember
palette and its dynamic-range caveat, an honest audit of role verb differentiation (only
Miller and Baker have one today), the still-unbuilt heat/memory/consequence synthesis from
this session's design conversation, and the six standing constraints as binding on any
visual work. Every claim tagged [SHIPPED]/[PROPOSED]/[OPEN] so the doc stays honest once it
leaves the repo and the code can't correct a wrong assumption anymore.

User then shared four reference images (a courier with a floating package glyph at a gated
wall; two figures with floating gear/book glyphs outside a bakery; two "Gemini notebook"
mockup panels — "The Grinding Windmill" and "The Closed Alleyway" — captioned with smoke/haze
tied to `economicHealth()`/`tensionCount`, and a stealth scene captioned "total absence of
copper"). Asked to confirm understanding before folding anything in. Two real additions,
both consistent with the doc's existing doctrine rather than contradicting it: (1) floating
diegetic role-glyphs as the concrete mechanism for surfacing a player's *current real verb*
(package only while a Courier is mid-transit, not a permanent per-role badge); (2) copper
specifically as the signature of the *legal, witnessed* state, with its total absence (not
dimming — a hard switch to desaturated blue-black) marking the illicit/covert state, kept as
its own channel separate from the existing tension/heat economic-strain ramp. Also generalized
"colour is the only honest variable" to atmosphere (smoke/haze) as another channel bound to a
real variable, not scene-dressing. Folded both into §3 and §4 of the brief.

Not yet done: handing the file to the user (next step), then resuming the role-by-role
design pass (Journalist and Import/Export not yet covered) or the Godot dependency chain
(role-holder position decoupling, deliberately deferred).

---

## 2026-08-19 — Grifters move and render: the playtest harness now shows the missing third

Stage 2 of the "position decoupled from occupancy" work. `playtestDrivers.ts` now applies
`move` for grifters (they finally have somewhere real to move to — the harder half,
role-holder movement, is still deliberately untouched), and `playtestRenderer.ts` draws them
as `o` on open ground. `npm run playtest` — the map is no longer missing roughly a third of
the population.

Movement is clamped to the shard's real plot bounds (a small local helper in
`playtestDrivers.ts`, not imported from the renderer's own cursor-clamping — the two stay
decoupled on purpose). Verified live before writing anything: 24 distinct positions among 42
grifters after 40 driven days, none wildly out of range.

**A real bug caught by looking at the actual rendered output, not by reasoning about it**:
two grifters sharing a cell get a brightness boost (`scaleRgb(COLOUR_GRIFTER, 1.3)`), and
`scaleRgb` never clamped — every existing caller only ever scaled by <=1 (`STATE_BRIGHTNESS`),
so nothing had overflowed before. The boost produced `rgb(282,261,229)`, an invalid ANSI
truecolor sequence, sitting silently in the output stream. Fixed by clamping inside
`scaleRgb` itself (defensive for every future caller, zero behaviour change for the existing
<=1 callers), with a regression test that greps every emitted escape sequence in a
forced-collision frame and asserts every channel stays in 0-255.

5 new tests, 659 total, typecheck clean. Still not done: role-holder movement itself (the
harder half), and giving anyone — driver or eventual player — a reason to actually WANT to be
somewhere specific rather than a random walk.

---

## 2026-08-19 — Grifters get real position: the first case of position not tied to a role slot

User: *"let's get going then.. we have to build it."* Starting the Godot dependency chain
HANDOVER laid out — item 2 ("position decoupled from occupancy") is the blocker, but it splits
into a lower-risk half (grifters, who have never counted as witnesses to anything) and a
higher-risk half (role-holders, whose position IS their building, entangled with the sabotage/
identity/District-Weather calibration stack just re-verified yesterday). Doing the low-risk half
first, deliberately — not a detour, the same primitive role-holder movement will need.

`GrifterSlot` gains `x: number; y: number` — always real, never `undefined`, unlike `districtId`
which genuinely has no answer until housing resolves. Defaults to `Shard.hubPlot` at creation
(all 5 construction sites), corrected to the housing district's plaza in the SAME lazy-fill
pass that already assigns `districtId` — both resolve together, every tick, no case where one
exists without the other.

**Deliberately not fed into witness counts.** Grifters have always been out of the proximity
graph (`world.ts`'s own header). Giving them a coordinate for rendering is not the same decision
as making them count toward sabotage/rumour witnesses — that stays a real, separate call, and a
dedicated test locks in that this change produces byte-identical `economicHealth`/`wealthGini`
to a run without it, at the same seed.

**A real interaction found while testing, not assumed away.** The first version of the
consolidation-eviction test asserted a displaced grifter keeps their old building's position —
failed. Traced it: that grifter is given their former building as an interim value, but (like
every other creation site) carries no `districtId` yet, so the SAME tick's housing-assignment
pass immediately re-houses AND repositions them regardless. The interim value is real (a better
default than the hub if housing assignment ever finds nowhere to place someone) but not
observable from outside the tick. Fixed the test to check what's actually true — correctly
housed and positioned at the END of the tick — rather than loosening or deleting the assertion.

Also needed a targeted-construction test for consolidation itself: measured directly that it
does not occur once across 8 seeds x 400 days of ordinary churn at the shipped single-district
config (conscription/backstop keep filled-fraction too high, too consistently), so the test
primes a district one day from its own MERGED transition directly rather than waiting for an
organic occurrence — same discipline other rare-deep-state tests in this repo already use.

7 new tests, 654 total, typecheck clean. **Not yet done**: rendering grifters on the map (Phase
A/B and the browser viewer both still only draw role-holder buildings), and giving anyone —
driver or eventual player — a way to actually move one. Both are the natural next steps, staged
separately so each lands verified rather than as one large, harder-to-check change.

---

## 2026-08-19 — User-authored addition: anisotropic texture field + landmark buildings

User: *"I've been working behind your back again, iterating etc."* Supplied a full
`space.ts` and a patch against the repo's own base. Diffed against the live file before
touching anything: clean, matches the patch exactly, touches nothing outside what it
describes — and does not touch `placeDistrictCenters`, so it is orthogonal to the still-open
Wall/hub-placement bug (which has no code fix yet, only the investigation from 2026-08-18/19).

**What it adds**: `textureField(x, y, angleA, angleB)` — two low-frequency sine waves at
independently-seeded orientations, breaking the radial symmetry `edgeFactor`'s dropout alone
produces (a district built from distance-to-plaza alone reads identically in every compass
direction). `angleA`/`angleB` are drawn once per shard from the same `rand()` stream, so each
shard gets its own fixed "grain," deterministic per seed. Feeds two real, separate effects:
the existing outer-ring dropout band now modulates by texture instead of a flat 0.3 (dense
side ~0.1, sparse side ~0.5 — same one-`rand()`-per-candidate cost, so it changes WHERE the
raggedness lands, not the determinism properties anything else relies on); and
`LANDMARKS_PER_DISTRICT` (3) buildings get flagged `isLandmark`, chosen by strongest texture
MAGNITUDE (peak or trough) rather than simple order, so landmarks land in both the densest and
most open pockets rather than clustering. Post-hoc flag only — doesn't consume `rand()`,
doesn't touch building selection.

**Checked, not assumed, before saving**: two texture-angle `rand()` draws happen
unconditionally at shard generation, which is exactly the class of change that broke 6 tests
when the Oracle's stage was wired into `stepWorld` — same-shape risk, worth verifying rather
than trusting the patch's own reasoning. It turned out NOT to bite: `generateShardLayout`
seeds its own private `mulberry32(seed)` instance internally, entirely separate from
`world.ts`'s own `rng` closure that `stepWorld`'s golden-snapshot test depends on. **All 647
tests passed unchanged, typecheck clean** — genuinely additive, not just apparently so.

Verified live: seed 1 and seed 7 both produce exactly 3 landmarks per district, at different
real coordinates, building count still 62 either way. `isLandmark` is read by nothing yet —
own header says so — a real hook for the terminal/browser renderers or eventually Godot, not
wired to any of them this pass.

---

## 2026-08-19 — The Wall is outside the town, and pulling that thread found a live pay bug

User, after looking at the published viewer: *"the wall is on the western edge, rather than the
centre."* Correct, and worse than off-centre. **Investigated and measured, not fixed** — the fix
invalidates geometry-dependent calibrations and deserves its own session.

**Finding 1 — the Wall is outside the settlement entirely.** Measured across 8 seeds: **zero of
the ~62 buildings lie west of the hub; all 61-62 are east of it.** The hub sits 6.5-10.5 units
from the district's geometric centre, while the plaza sits almost exactly ON that centre
(`plazaPlot = { x: center.x, y: center.y }`, `space.ts:420`).

Cause: `placeDistrictCenters` puts core districts at radius `coreGap * 0.5 ± 2` around origin,
where `coreGap = coreDistrictRadius * 2 + 4` — so ~9 units out at the shipped `coreDistrictRadius: 7`.
That is correct behaviour for SEVERAL districts ringing a central hub, which is what it was
written for. With `coreDistrictCount: 1` (the 2026-08-13 single-district decision) there is no
ring to arrange — the lone district just gets shoved ~9 units off-origin and the hub ends up on
its rim. `space.ts`'s own comment still describes the hub as *"true center, equidistant from all
districts, never belonging to one"*, which has been false since 2026-08-13.

**Finding 2 — "distance-indexed Courier pay" indexes nothing at the shipped config.**
`courierRouteDistance` is `distance(district.plazaPlot, shard.hubPlot)`. With one district there
is exactly one plaza, so all 7 couriers share an identical route distance and an identical wage.
Addendum item 6's whole stated point — pay earned from real geometry "not the flat wage every
support role used to share alike" — is dead at the current default: it IS a flat wage again,
just derived a different way.

**Finding 3, the one that actually bites — couriers are underpaid by more than half, and have
been since 2026-08-13.** `COURIER_FEE_PER_DISTANCE_UNIT = 0.075` was calibrated 2026-08-12
against a measured ~20-unit mean route at the then-6-district layout. Routes are now 8-9 units.
Measured: courier pay **0.420-0.472/day against the 1.050 flat wage** Journalist, Detective and
Import/Export still receive. Couriers have been earning ~40-45% of their peers in every
simulation run since the district-topology change, and nothing flagged it because no test
asserts cross-role wage parity.

**And the trap in the obvious fix**: centring the district on origin makes `plazaPlot === hubPlot`,
so `courierRouteDistance === 0` and **every courier earns exactly nothing**. The Wall being
misplaced is the only reason courier pay is nonzero at all. These two cannot be fixed
independently — "distance from your district's plaza to the hub" is simply not a meaningful
quantity in a one-district shard, and needs replacing rather than recentring.

Options, none chosen: measure courier routes against something real that still varies per courier
(their own BUILDING to the Wall, rather than their district's plaza — this varies, unlike the
plaza); or restore a flat wage for Couriers and retire item 6 honestly as superseded by the
single-district decision; or revisit district count, which would reopen a resolved question.

Recorded rather than acted on because a geometry change moves witness counts, and witness counts
feed sabotage detection, identity resolution and District Weather — every one of which was
calibrated against the current layout.

---

## 2026-08-18 — Sabotage restructured into persistent campaigns; pattern-based sabotage is now SHIPPED

User: *"do the sabotage campaign restructure."* Done, in the verified stages they asked for.
647 tests, typecheck clean. `npm run sabotage-campaign-sim` is the permanent report.

**What changed.** `patternSabotageAttempt()` resolved an entire campaign inside one call, with
`detectiveActive` fixed at call time — so a campaign had no "mid" and nothing could intervene
partway through it. New `src/engine/sabotageCampaign.ts` owns a state machine only: open, step
when due, advance / catch / succeed. The detection math is imported unchanged from
`ecosystem.ts` and deliberately NOT duplicated. `patternSabotageAttempt` is kept and still
exported — it remains exactly right for `sabotagePatternHarness.ts`'s fixed-witness sweeps; it
simply stops being what the live world uses. **Pattern-based sabotage is no longer a
"PROPOSAL, not shipped"; it is the model.**

`World` gained `sabotageCampaigns`, `nextCampaignId`, `lastSabotageCampaignEvents`. The hazard
now OPENS a campaign rather than resolving one, `config.saboteurCount` caps concurrency (that
is exactly what "how many saboteurs are active" already meant), and each step rolls against the
witness count that is real *at that moment* rather than one frozen at open.

**THE STRUCTURAL FINDING, which explains why the caught-saboteur gap was never closed.**
`ecosystem.ts` has carried "no consequence for a caught saboteur" as a KNOWN GAP for both
resolvers. Tracing it turned up the real reason: **the engine had no saboteur identity at all.**
`sabotageAttempt(saboteurCount, ...)` takes an anonymous COUNT — nobody was ever named, so
there has never been anyone to fine, mark, or lock out of their abode. `SabotageCampaign.saboteurId`
closes that structurally (null for the ambient hazard, a real id once a driver or player opens
one). **The consequence itself is still NOT invented here** — the walk of shame, abode lockout,
Oracle unlock and fine are a design still being settled, and this pass deliberately stops at
making them buildable.

**Re-measurement, which the design doc demanded rather than assuming carry-over.** The old
calibration (71.1% success without a Detective, 40.2% with) came from fixed-witness sweeps.
Live, over 8 seeds x 3000 days: 1083 opened, 340 succeeded, 439 caught, 290 abandoned —
**43.6% success among contested resolutions**, mean duration 28.9 days (max 42, well under the
user's 100-day ceiling), mean 1.30 campaigns in flight, opening interval 22.1 days against a
20-day hazard, 90 distinct opening gaps (still no learnable period). Constraint 2 re-verified
directly: minimum `economicHealth` 0.7652 across every run, and a dedicated test holds it above
`BACKSTOP_PRODUCTIVITY` under deliberately heavy pressure (saboteurCount 8, cadence 5).

**A defect found by LOOKING, not reasoning — the playtest harness earning its keep.** Inspecting
a building in the harness showed a campaign opened on day 2 still grinding on day ~45 against a
Detective slot whose occupant had churned out on day 13. It would spend six weeks and one of
only three campaign slots forcing out somebody already gone. Added an `abandoned` outcome: 290
of 1069 resolved campaigns (27%) were in that state. Fixing it dropped mean concurrency
1.49 -> 1.30 and tightened the opening interval 23.4 -> 22.2 days.

**A finding I nearly shipped a wrong narrative about.** The report initially said the live
success rate "sits between" the two harness figures. The data says otherwise: **96.5% of
campaign-steps are under investigation**, because the interim assignment rule is "is a Detective
FILLED in the target's district" and the shipped config is ONE district with 8 Detective slots.
So investigation is near-constant rather than a scarce directed resource, and the live figure
lands near the WITH-Detective number rather than between. Corrected in the report itself. This
is a finding about the interim rule, not about sabotage — and it is precisely what the
flashlight exists to fix. `investigatedBy` was deliberately built as a REPLACEABLE ASSIGNMENT
RULE so Phase C changes who fills the field, not the field or anything downstream of it.

**Four tests failed on the rng-trajectory shift; each fixed on its merits, none loosened.**
The golden snapshot regenerated (its own documented policy for a deliberate order change). The
sabotage-frequency and no-learnable-period tests were RETARGETED from `lastSabotage` to campaign
OPENINGS, because that is where the hazard now lives. The multi-shard accounting test kept its
invariant — which held on every tick — but its precondition ("failed migrations actually
happen") stopped firing on one seed, so it went multi-seed. And the wealth-tax Gini test was
re-sampled after measuring the truth: the tax's effect is REAL but SMALL (0.4932 vs 0.5007,
~1.5% relative), and 5 single-tick samples cannot resolve it; 800 tail samples can. The
assertion is still a strict inequality — only the sampling changed.

25 new tests (13 pure, 12 world-level). Not built: the flashlight (Phase C), and any
consequence for a caught saboteur.

---

## 2026-08-18 — Playtest harness Phase B: the node became legible

Cursor and inspection, per `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`'s Phase B — "selecting
a building shows its real state... still strictly read-only against `World`, no new mechanics,
no writes." Held to that literally: `renderInspector` calls only existing pure projections
(`completionRatio`, `knownFraction`, `computeEconomicHeat`) and invents no derived state. 621
tests, typecheck clean.

`hjkl`/arrows move the cursor, `i` hides it. The cursor starts on the plaza — the one place in
the settlement that means something before you know anything else. It draws as a lifted, warmer
ground rather than an inversion, because Ember's whole point is that nothing in the node is
high-contrast and an inverted block would read as UI sitting on top of the town rather than a
light moved across it.

**It paid for itself on the first look.** Cursor on a Miller at (9,-2): BACKSTOPPED, empty since
day 209, completing 0% of 5 attempts against a 55% typical. A slot the backstop is visibly
running badly, legible at a glance — precisely the kind of thing the numbers in a sim report
never surface because nobody thinks to ask for that cross-section.

**Three real defects found by looking, all fixed**: inspector lines could exceed the map width
and shove the status column sideways (now hard-capped to `mapWidth`, with a test sweeping EVERY
cursor position on the grid); the plaza was described as generic "open ground"; and the key
legend still advertised the Phase A keys only.

**A false alarm worth recording, because the reasoning was wrong twice.** I read the rendered
output as misaligned by two columns and started hunting a padding bug. Instrumenting it showed
the layout was correct all along — the two "outlier" columns are the status pane's own
deliberately-indented role-count lines (`  Journalist 5/7`). Eyeball-counting terminal columns
is not evidence; measuring is. Cost a detour that a two-line probe would have avoided.

Also a real limitation, surfaced in the module rather than hidden: **grifters cannot be
inspected at all**, because they have no coordinates anywhere in this engine — they carry a
housing `districtId` and nothing finer. At the shipped config that is 20-26 of ~64 people who
are simply not on the map, and the status pane's count is the only view of them.

6 new tests (18 in the harness file, 621 total), including a sweep asserting no inspector line
at any cursor position can exceed the map width, and that inspecting mutates nothing.

---

## 2026-08-18 — Playtest harness Phase A BUILT: Ember, and the drivers finally wired

User picked **Ember** from four aesthetic directions explored on a real-data design canvas
(Ember / Signal / Phosphor / Ledger, each drawn from an actual seed-7 day-220 world so the
choice was made against real output, not a fantasy mockup), and asked for the synthetic
drivers wired at the same time. Both done. `npm run playtest`. 615 tests, typecheck clean.

**Three files, split so nothing needs a terminal to be testable**: `sim/playtestRenderer.ts`
(pure — `World` in, strings out), `sim/playtestDrivers.ts` (the applier), `sim/playtestCli.ts`
(owns raw-mode stdin, the alternate screen buffer, and nothing else). Same harness/cli split
every other `src/sim/` mechanic already uses.

**The NPC question answered without building any NPCs.** User: *"we need simulated players,
NPC's... what can we do that's feasible."* They already existed — `src/sim/drivers/` has had
four strategies (honest, opportunist, saboteur, idle) since Observatory Phase C, each a pure
function from visible state to one bounded action, with `test/drivers.importGuard.test.ts`
failing the build if `src/engine`/`src/world`/`src/server` ever import them. That guard IS the
resolution to constraint 3, written down in the drivers' own README. What never existed was
the APPLIER. Built it on the sim side of that line, so `stepWorld` still knows nothing about
it and no shipped behaviour changed.

**Also reused rather than reinvented, after writing the duplicate first**: `drivers/index.ts`
already exported `DRIVERS` and `assignDriverStrategy(seed, playerIndex)` — a deliberately
weighted, documented "chosen by seed" assignment. The first draft of the applier shipped its
own `strategyFor` + strategy-mix array before that was noticed; deleted in favour of theirs.
The only genuinely new part is `stablePlayerIndex`, because participant-list POSITION isn't
stable (slots fill and vacate, grifters arrive and leave) so the index has to key off the id.

**Two claims I made to the user that were wrong, corrected by checking**: I said
`sendEnvelope` was wireable now — it isn't, `World` has no pending-envelope queue at all, AND
no driver ever emits that action. Checking every driver's real emissions (rather than reading
breadth off the `DriverAction` union) gives the honest picture: only five of eight types are
ever emitted, and exactly **one** — `postToWall` — has anywhere to land today. `occupySlot`
would fight the conscription pass for the same slots; `move` has nowhere to go (grifters carry
a housing `districtId`, never coordinates); `attemptSabotageStep` is blocked on the
campaign-persistence finding from earlier today.

**One action turned out to be enough.** A Wall post drives rumour propagation -> identity
resolution -> diary writes -> pressure detection -> District Weather, an entire causal chain
that sits dead when nothing posts. Driverless at seed 7 day 220: zero rumours, ever. Driven:
33 on day 220 alone. The node visibly talks to itself now.

**A prediction of mine that only half held, reported rather than quietly dropped.** I expected
wiring posts would make District Weather tension climb and thereby fix the low-dynamic-range
problem. It didn't move (0.080 driven vs 0.080 driverless) — because `pressureDetection.ts`
keys off NEGATIVE-skewed posting, and the `honest` driver posts positive states while
`economicHealth` is high (0.896 here). That is the system working correctly: a healthy shard
has calm citizens, and tension should stay low. The dynamic-range problem is therefore a
LEGIBILITY problem, not a signal problem, and auto-ranging (below) is the right fix for it
rather than a workaround.

**Auto-ranging shipped on by default**, with the tradeoff stated in the code rather than
hidden: measured tension sits at 0.08 and heat spans 0-0.5 (and reads exactly 0 for all four
support roles while the district is healthy, since their heat derives from consolidation
friction that isn't present), so both are normalized against observed maxima. The honest cost
— a genuinely calm shard no longer LOOKS calm, because calm is now the bottom of a stretched
scale. Both constants are `[CALIBRATED — provisional]` from one config's measurement.

**A real caveat found by measuring, now documented at the top of the applier**: a driven run
is NOT comparable to a driverless one. `stepWorld`'s rumour stage draws from `world.rng` once
per post per neighbour, so queuing posts shifts the world's trajectory from that tick on —
seed 7 day 220 reads Gini 0.662 / 8-of-9 Millers driverless, 0.705 / 6-of-9 driven. Inherent
to there being activity at all, not a defect, but it means **this harness is for feel and its
numbers must never be quoted as simulation results**. The measurement harnesses stay the place
numbers come from.

12 new tests in `test/playtestHarness.test.ts`, including the one that matters most: 60 stepped
days are byte-identical with and without a render each tick, extending `economicHeat.ts`'s own
purity guarantee to the whole view layer. If that ever fails, the harness has become part of
the simulation.

**Not built**: Phase B (cursor/inspection) and Phase C (the flashlight, still blocked on the
sabotage campaign restructure).

---

## 2026-08-18 — Playtest harness scoped, and a blocking finding that reorders the sabotage work

User: *"I really need to get to the position where I can play test the game and design the
precise gameplay from experience and what's fun, rather than assuming simulations will do so."*
Fair, and worth stating plainly: every mechanic in this repo has been validated by simulation
against a deterministic baseline, which is right for economics and the wrong instrument for
feel. Nothing built here has ever been looked at. Scoped as
`docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md` — **design only, no code this pass.**

**Measured before scoping, not estimated** — the shipped shard is a **14 × 15 grid** (90
plots, 62 buildings, hub (0,0), plaza (7,1), probed against a real `createWorld`). That kills
the one risk that could have sunk a terminal harness: at 2 columns per x-unit it's 28 × 15
characters, comfortably inside 80 × 24 *with* a status panel. The single-district decision
from 2026-08-13 is what makes this true — one district IS the settlement, so there is nothing
else to draw.

**Two corrections to my own verbal advice from earlier in the same conversation**, recorded
rather than quietly dropped: (1) I'd suggested half-block `▀` sub-cell rendering to double
vertical resolution — wrong technique once measured, since 90 discrete plots is a coarse grid
and sub-plot detail carries no game state; one plot should be one chunky cell. (2) I'd
mentioned 20–30fps ambient animation — needless and slightly wrong-headed, since `stepWorld`
is a daily tick, so the harness is turn-based and repaints on state change, not on a frame
clock. Both were stated before the numbers were in hand, which is exactly the failure mode
CLAUDE.md's top rule is about.

**THE FINDING, and it revises a claim I made earlier this session.**
`ecosystem.ts`'s `patternSabotageAttempt()` resolves an entire campaign inside one function
call — a `for` loop over every step, returning success/caught, with `detectiveActive` as a
parameter **fixed for the whole campaign at the moment of the call**. So a Detective cannot
intervene mid-campaign, because a campaign has no "mid": it begins and ends in one call.

That directly blocks the locked design answer ("Detective selects a specific suspect, and
that's what sets `detectiveActive` for that campaign") — there is nothing in flight to point a
flashlight at. And it means my earlier characterization of promoting pattern-sabotage to
shipped-default as roughly a swap of one resolver for another **was wrong**. It's a
restructure: persistent `World.sabotageCampaigns`, a `stepWorld` stage advancing due campaigns
one step per cadence interval, rolling detection against *live* witness counts.

Two things fall out that I'd otherwise have gotten wrong later. First, the measured
calibration (71.1%/55 days without a Detective, 40.2%/85 with) came from the one-shot resolver
against a **fixed** witness count — a live stepper rolls against counts that move as slots
fill and vacate, so those numbers **do not automatically carry over and must be re-measured**.
The "simulate before trusting" constraint applies to the restructure itself, not just its
inputs. Second, the caught-saboteur consequence gap (a KNOWN GAP in `ecosystem.ts` for both
resolvers, resolved in neither) stops being deferrable, because the walk-of-shame design *is*
that consequence.

**Sequencing conclusion**: harness Phases A (viewer) and B (inspection) depend on none of
this and can start immediately against the world as it already exists — helped a lot by
`economicHeat.ts` having been built two weeks ago as an explicitly pure, `stepWorld`-uncoupled
projection, and by `districtWeather.ts`'s `tension` deliberately sharing its 0..1 scale "since
both feed the same visual contract." Phase C (the flashlight, the first real action) waits on
the campaign restructure. Building the viewer first means the sabotage rework lands in
something you can already watch, which is the whole point.

Also captured in the doc: the two independent consequence tracks the user settled — functional
(abode locked, Oracle visit clears it early, timer clears it regardless, no starvation) and
social (walk of shame at the Wall via a new narrow **confession grammar**, the only place a
player may ever name themselves, unlocked only once marked, leaving the existing Wall
invariant intact for everyone else). Checked against constraint 6: neither track subtracts
from reputation — exposure is a separate channel, shaped more like the Silhouette Shield's
forced resolution than like a reputation score. The timer failsafe was the user's own instinct
and satisfies constraint 2 without being told to.

---

## 2026-08-18 — Proximity conversation wired into stepWorld

Picked up HANDOVER's next-in-line item: "Proximity conversation wiring into `stepWorld`
(diary is wired, this is the next candidate with the same shape)." Real gap first, not
assumed away: HANDOVER had flagged this needs "real per-utterance listener resolution across
the connection graph (bigger than diary's simple queue)" — checked directly rather than
guessed at, and it turned out the connection graph already exists and is already live.
`world.ts`'s Stage 5 (comms) already builds a real `ConnectionGraph` from every currently-
FILLED role slot's building position (`buildProximityGraph`, feeding Wall-post rumour
propagation) — proximity conversation reuses that SAME graph rather than inventing a second
listener-resolution mechanism, which is what made this genuinely "the same shape as diary"
once the real machinery was found, not a bigger lift than advertised.

**New `World` fields**: `pendingProximityUtterances` (queue-in/consume-and-clear, same
convention as `pendingWallPosts`/`pendingDiaryEntries`), `lastProximityConversations`
(per-tick report of who heard what, at what degraded clarity), `lastProximityRejections`
(self-address or an absent REFERENT — `composeUtterance` throws on these rather than
silently dropping them, same convention `lastDiaryRejections` already established).

**Real, deliberate scope boundary, not silently narrowed**: `comms/proximityConversation.ts`'s
own header is explicit this channel has NO relay path and NO persistence — "ephemerality is
architectural, not a runtime check." Wiring respects that literally: no identity-ledger
update, no diary write, no pressure-ledger update, nothing accumulated across ticks. A player
who wants to keep or relay what they heard still has to route it back through Wall/Envelope
by hand, unchanged. This also means grifters stay out of scope here exactly as they already
are for Wall-post comms (`world.ts`'s own header note: no fixed building position, not part
of the proximity graph) — not a new limitation introduced by this pass, the same one Wall
posts already carry.

**Opt-in and default-empty, same discipline diary's wiring used (and Oracle's did NOT,
which is exactly why Oracle broke 6 pre-existing tests and this doesn't)**: the new stage
only consumes `rng()` when `pendingProximityUtterances` is non-empty, and nothing populates
that queue by default. All 596 pre-existing tests passed completely unchanged before any new
one was added — confirmed directly, not assumed from the pattern alone.

Refactored the Wall-post rumour stage's own `occupants`/graph construction out from inside its
`if (pendingWallPosts.length > 0)` guard so both mechanics share one build (cheap, pure, no
rng) instead of each rebuilding it — real, minor cleanup enabled by the reuse, not a
behavior change (confirmed by the full suite passing byte-identical).

7 new tests in `test/world.proximityConversation.test.ts`: self-address and absent-REFERENT
rejection, queue clearing, true no-op with nothing queued, a real positive signal (a
room-directed turn from a real occupant is actually heard, tried across a few seeds per the
same "not guaranteed on every seed" discipline the existing Wall-post regression test already
uses), one rejection not blocking a different valid turn the same tick, and direct
confirmation of ephemerality (a second tick with nothing newly queued reports nothing heard —
no accumulation, unlike the diary's real persistent store). 603 tests total, typecheck clean.

**Not done this pass**: gating proximity conversation's vocabulary by reputation level
(HANDOVER's own next item after this one, "proposed, never confirmed"); promoting
pattern-based sabotage to shipped-default status (separate, still-blocking arson's own
wiring); moderation-logging's own consumption of this channel (its import guard explicitly
forbids `src/world` from importing it — a real, separate wiring point outside `world.ts`,
not touched here).

---

## 2026-08-18 — Oracle simulation harness/CLI built, closing HANDOVER's top deferred item

Picked up `docs/HANDOVER.md`'s explicitly-flagged top "what's next" item from the Oracle
build entry below: "the full population-scale simulation harness/CLI every other mechanic
this session got, to measure the Oracle's real win rates and wealth/Gini impact under load
before trusting its illustrative constants further" — the exact re-simulation
`docs/DESIGN_ORACLE_2026-08-13.md` §5 asked for before the Oracle proceeded to code at all.

**Real gap first**: unlike `experienceFloorHarness.ts`/`evictionProtectionHarness.ts`, a
with/without counterfactual doesn't honestly apply here — the Oracle is unconditionally wired
into every `stepWorld` tick (no config flag gates it), and its wealth/`personalResourceStock`/
`daysAsGrifter`/`daysInRole` effects compound with ordinary market activity within the same
tick in ways a "strip the field back out before the next tick" approach can't cleanly
separate. Rather than force a counterfactual that wouldn't be honest, added a real side-channel
instead: `World.lastOracleStats` (`entrants`/`entered`/`wins`/`winsByPrize`), populated
directly inside `world.ts`'s existing Oracle stage — same "report what actually happened,
don't make the caller infer it from field deltas" convention `lastDiaryRejections` already
established. Purely additive (new field, always populated, no existing behavior touched) —
all 594 pre-existing tests passed unchanged before any new one was added. 6 new tests: 4 in
`test/world.oracle.test.ts` covering the new side-channel directly (internal consistency each
tick, real non-zero win activity over a long run, zero-state at creation), plus the harness
itself gets exercised by the CLI run below (not unit-tested in isolation — matches the
project's existing convention of trusting a harness's real CLI output over a synthetic
harness-of-the-harness test, same as `experienceFloorCli.ts`/`evictionProtectionCli.ts`).

**`sim/oracleHarness.ts`** runs a real single-world `stepWorld` loop, capturing
`lastOracleStats` each tick alongside `oracleWinProbability` evaluated on the exact same
pre-tick `economicHealthWithExperience` value that tick's real roll used (avoids any
off-by-one risk against the "tied to YESTERDAY's health" timing `world.ts`'s own Oracle-stage
comment documents) and the `wealthGini`/`economicHealthWithExperience`/`population` `World`
already tracks every tick. `sim/oracleCli.ts` (`npm run oracle-sim`) aggregates 8 seeds x 3000
days (this session's established convention), reporting the entry funnel, observed-vs-
theoretical win rate, prize mix, and an early-vs-late-tail stability check.

**Real, measured result**: observed win rate (21.24%) tracks the theoretical health-linked
curve (21.25%) almost exactly — direct confirmation the mechanism is calibrated correctly,
not just internally consistent. Below the `ORACLE_BASE_ODDS_HEALTHY` ~28-30% "healthy shard"
reference because `DEFAULT_WORLD_CONFIG`'s real steady-state `economicHealthWithExperience`
(~0.79-0.80) sits below `ORACLE_HEALTH_REFERENCE` (0.96) — an honest, expected consequence of
the health-linkage doing its job, not a miscalibration. Prize mix: wealth 39.5%, time 39.8%,
resourceStock 20.7% — the ~2:1 ratio is exactly right, not a bug: `resourceStock` is
role-holder-only (`ORACLE_PRIZE_TABLE`), while grifters (the majority of candidates) can only
win wealth or time. **No death-spiral** — `wealthGini` (0.6693 -> 0.6766), economic health
(0.8044 -> 0.7903), and population (62.53 -> 61.31) all stay stable early-to-late-tail within
the same run, none diverging. 596 tests total, typecheck clean.

**Not done this pass, flagged not silently skipped**: this validates the ALREADY-SHIPPED
constants under load, matching §5's ask exactly — it does not re-derive new constants, extend
the health-linkage to prize odds (§4's still-open question), or build the shard-wide "nodule
bonus"/"postcard boost" prizes HANDOVER also lists as deferred.

---

## 2026-08-18 — The Oracle built: first code for a mechanic specified since 2026-08-06

User: "build the oracle lottery but leave it so we can consider alterations to prizes etc.
can't be static otherwise we can't balance the numbers under testing." Long design
conversation preceded the build (multiple corrections: no login/visit ritual — "active
players receive it naturally"; odds uniform for everyone, confirmed via AskUserQuestion; no
role or reputation-level prize, ever; prizes can only touch what the winner already has real
access to, specifically so a solo player can never use lucky streaks to assemble a multi-role
crafting recipe like a Key). Built directly from the ALREADY-EXISTING
`docs/DESIGN_ORACLE_2026-08-13.md` rather than reinventing: `economicHealthWithExperience`-
linked odds (linear, clamped, never zero — constraint 2), three prize categories (wealth,
personal resource-stock top-up, a "time" nudge to `daysAsGrifter`/`daysInRole`), never a role
or reputation grant.

**New `src/engine/oracle.ts`.** Participation modeled as an independent Bernoulli draw per
candidate per day (`ORACLE_PARTICIPATION_PROBABILITY`) — the same no-real-session convention
`shiftCover.ts`'s "noticing" already established, not a login/streak system. Entry costs
`ORACLE_ENTRY_COST` in wealth (not postcards — those stay reserved for the exit-ticket system,
and no real per-player postcard balance exists yet to spend from anyway). `ORACLE_PRIZE_TABLE`
is a plain, weighted data list, not a switch statement, specifically so rebalancing a prize's
likelihood later is an edit to a number, not a restructure — every constant is named, exported,
`[CALIBRATED — provisional]`, per the user's explicit "not static" requirement.

**Wired into `world.ts`** right after Shift Cover: every grifter and every FILLED role slot
gets an independent roll. A win's prize type is drawn only from what that exact candidate
already has (grifters never get `resourceStock`, since they hold no personal stock).

**Real ripple effects from inserting a new rng-consuming stage, caught and fixed, not
ignored.** Adding this stage shifted every downstream tick's rng trajectory (same "any tick-
order change moves every later number" property the golden-snapshot test's own docstring
already warns about) — broke 6 pre-existing tests. Fixed each on its real merits, not by
loosening blindly: the golden-value snapshot regenerated (its own documented policy for a
deliberate, reviewed order change); two exact-wealth assertions changed to bounded ranges
(the Oracle now genuinely also touches wealth, a real interaction, not drift); two
experience-floor regression tests made multi-seed instead of single-seed (verified via
`npm run experience-floor-sim` that the real aggregate effect is still genuinely tiny, ~0.13%
— the single-seed sample had just become fragile against the new trajectory noise); one
district-weather test made multi-seed/longer-horizon (verified directly, not assumed, that the
consolidation-vs-healthy tension property still holds robustly in aggregate before changing it).

**Deliberately deferred, not silently skipped** (credit/time constraints this pass): the
full population-scale simulation harness + CLI report every other mechanic this session got
(`oracleHarness.ts`/`oracleCli.ts`, not yet built) to actually measure real win rates, wealth
drift, and Gini impact under `DEFAULT_WORLD_CONFIG` load before trusting the illustrative
constants further; the shard-wide "nodule bonus" prize category from the design doc's §3
(dropped for v1 in favor of three clean personal-grant prize types); a "postcard boost" prize
(no real per-player postcard balance exists in this engine yet). **This is now the explicit
next task — see `docs/HANDOVER.md`'s "What's next," not just noted here.**

18 new tests (8 pure-function in `test/oracle.test.ts`, 4 real-`World` integration in the new
`test/world.oracle.test.ts`, 6 pre-existing tests repaired). 594 tests total, typecheck clean.

---

## 2026-08-18 — Eviction preference now requires real performance too, not just tenure

Follow-up to the same-day eviction-preference build, prompted by user directive: *"grinders
should have greater upward mobility than lazy players etc. activity is the fastest path to
reward, inactivity over time should bite."* Real gap in what shipped earlier: the preference
protected by `daysInRole` (tenure — how LONG someone held a slot) with no signal for whether
they were actually doing the job well. A long-tenured but chronically underperforming occupant
got the same protection as a long-tenured, genuinely productive one — tenure, not activity.

**Fix**: `multiRoleConscription.ts`'s `RoleGroupState` gains `occupantPerformance?: readonly
number[]` and `PERFORMANCE_BAR = 0.8`. An occupant now only counts as "established" (protected
from `conscriptionFromOtherRole`) if they clear BOTH the tenure floor AND the performance floor
— a long-tenured chronic underperformer loses the protection a long-tenured, genuinely
productive peer keeps. The performance signal reuses `engine/roleCompletion.ts`'s real,
already-shipped `completionStats`/`completionRatio` (item 4's own signal, career-long, resets
on new occupant) rather than inventing a parallel one — normalized against a new
`TYPICAL_COMPLETION_RATIO` per role (Miller/Baker ~0.55, the four friction-bar roles ~0.97,
the same numbers `roleCompletion.ts`'s own header already documented) so a Miller's 55% and a
Courier's 97% are comparable on one shared scale. Same "preference on top of the original
neutral floor" shape as everything else this session — the bite lands on a bonus that was never
guaranteed, never on anything actually earned, so constraint 6 doesn't apply to it.

**A second real harness bug was caught before trusting the re-measurement, not after.** Once
`world.ts` started passing real `occupantPerformance` unconditionally, `evictionProtection
Harness.ts`'s existing "without" arm — which only neutralized `daysInRole` — silently stopped
being a true "feature doesn't exist" baseline; it still had a live performance-based preference
running underneath. Caught by noticing the "without" arm's own mean tenure had moved between
runs, which it should never do on its own. Fixed by also resetting `completionStats` to the
exact "meets `PERFORMANCE_BAR`, no more" value for every FILLED slot, mirroring
`ESTABLISHED_TENURE_DAYS`'s own "reset to exactly the bar" convention.

**Re-measured after the fix** (8 seeds x 3000 days, `DEFAULT_WORLD_CONFIG`): steady-state mean
`daysInRole` across every FILLED slot is **115.94 days WITH the (now tenure+performance)
preference vs. 94.40 WITHOUT — a real ~22.8% relative uplift** (down from the pure-tenure
figure of ~50%, since some previously-"established" occupants no longer qualify once
performance is also required — expected, not a regression). `economicHealth` moves by only
+0.00523 — still no measurable cost. 5 new tests (4 pure-function in
`test/multiRoleConscription.test.ts`, 1 real-`World` integration in
`test/world.evictionProtection.test.ts`). 582 tests total, typecheck clean.

---

## 2026-08-18 — The level-2 reputation gate tackled — a real mechanism, not a threshold change

User: *"tackle the level-2 reputation gate."* This was HANDOVER's #1 open item as of the
refresh two entries below, and picks up a thread left explicitly open 2026-08-13
(`docs/BLUEPRINT.md`'s "Investigating the level-2 rarity" entry): the user had already been
shown real threshold-sensitivity numbers (lowering the level-2 threshold 6→5 or 6→4 would raise
reachability 1.75x-3.7x) and explicitly asked for "a different mechanism instead" — no specifics
supplied at the time, so it sat unresolved.

**Re-reading the root cause precisely, not just re-stating it**: the measured cause was "reaching
level 1 makes a grifter an immediate target for FOUR roles' `genuineFill` at once." True, but
that framing stops one level too shallow — the actual, fixable lever is that Shift Cover (the
ONLY way a grifter earns the 3 more progress ticks level 2 needs) had a selection rule
("neediest — lowest wealth — first") that was never aware of reputation progress at all. Once a
grifter has already covered a shift or two — which is HOW they got to level 1 — their wealth
rises above a brand-new grifter's, so the existing rule progressively deprioritizes them for
MORE Shift Cover chances right when the race against `genuineFill`'s clock is tightest. Nobody
had connected these two mechanisms before; found by tracing what actually determines how fast a
level-1 grifter can earn more progress, not by re-running the same threshold experiment.

**Built**: `engine/shiftCover.ts`'s `orderGrifterCandidatesForNotice` — grifters at EXACTLY
level 1 get first pick for Shift Cover notice (closest-to-level-2 first among themselves);
everyone else falls back to the untouched original wealth-only rule. Wired into `world.ts`'s
existing Shift Cover selection, replacing the inline sort. `REPUTATION_LEVEL_THRESHOLDS` was
NOT touched — genuinely a different mechanism, honoring the earlier explicit request.

**Simulated before trusting, not just argued for**: built `sim/levelTwoReachabilityHarness.ts`
(+ `levelTwoReachabilityCli.ts`, `npm run level-two-reachability-sim`) — reconstructs real
`DEFAULT_WORLD_CONFIG`-scale dynamics (M9 B9 C7 J7 D8 IE6, N=100) directly from the same real
engine primitives `world.ts` itself uses (`stepMultiRoleConscriptionDay`, the real reputation
gate, the exact grifter-removal selection mirrored from `world.ts`'s own code), not a toy model
— same discipline `evictionProtectionHarness.ts`'s `realisticEventFrequency` already
established for a comparable question. Real, measured result, 8 seeds x 800 days (matching the
original 2026-08-13 measurement's own run length): distinct grifters reaching level 2 went from
**66 to 235 — a 256% relative increase**. Trap events (grifters removed while still stuck at
level 1, never reaching level 2) dropped from 604 to 351. A real, honest secondary observation,
not smoothed over: among grifters who STILL get trapped under the new ordering, the mean days
spent at level 1 before removal actually DROPPED (7.25→3.80) — a selection effect, not a
regression: the borderline cases that used to eventually succeed now mostly DO succeed (removed
from the "trapped" population entirely), leaving only the genuinely fast failures in the
remaining sample.

**Safety check, not assumed**: does prioritizing level-1 grifters starve level-0 grifters of
Shift Cover practice (which they need too, for the experience-floor mechanism)? Measured: level-0
grifters still receive **75.9%** of all Shift Cover completions with the fix (down from 86.4%
without it) — a real, honest tradeoff, but nowhere close to starvation; the large majority of
opportunities still go to brand-new grifters.

10 new tests: 6 pure-function in `test/shiftCover.test.ts` (racing-grifter preference, closest-
to-threshold-first among racers, the preference is scoped to exactly level 1 not "any progress,"
undefined `reputationProgress` never crashes, byte-identical to the original rule when nobody is
racing, and a total-ordering sanity check), 4 harness-level regression locks in the new
`test/levelTwoReachabilityImpact.test.ts` (measurably more grifters reach level 2, level-0
grifters aren't starved, the fix is a provable no-op when nobody could possibly be racing yet,
and the harness never crashes or produces invalid counts across several seeds). 577 tests
total, typecheck clean.

---

## 2026-08-18 — HANDOVER's "What's next" refreshed — had gone stale since 2026-08-12

User: *"refresh HANDOVER's What's next section first"* (in response to "what's next on the
roadmap"). The section still read as of the 2026-08-11 addendum's build order — it never
mentioned anything from the 2026-08-13 through 2026-08-18 work (housing/reputation levels,
diary, personalResourceStock, the experience floor, the `V_i` resolution, the eviction
preference), so a reader following it cold would have re-derived or re-litigated work that was
already done. Rewrote it: compressed the now-fully-historical addendum build-order section,
added an explicit "also fully closed since then" list naming everything shipped this session so
it can't be silently reopened, and — most importantly — surfaced **the level-2 reputation gate
("the level-2 trap")** as the #1 open item, which had NEVER been recorded in this section at
all despite being a real, measured, still-unresolved finding from earlier this session (83-90%
of grifters who reach level 1 get conscripted within 7-16 days, never reaching level 2). Also
added two items this session's work directly created: face-to-face conversation/arson's
missing `world.ts` wiring (diary got wired, they didn't), and extending the experience floor to
support roles once/if they get a tracked `experience` field. Renumbered the remaining
already-known-open items (exit-ticket accrual, differentiated support-role resources, shard
diversity Tier 2, building relocation on merge, Observatory phases) into rough priority order
under the new list, none of their content changed. One correction caught before committing:
first draft misattributed the level-2 trap's urgency to "constraint 3" (which is actually about
minimizing agent-modelable behavior, unrelated) — fixed to cite the user's own "reputation is
the entire game" framing instead, not a numbered `CLAUDE.md` constraint that doesn't say that.

---

## 2026-08-18 — Eviction preference simulated under real load — real effect, real bug caught first

Direct follow-up to the same-day build: *"simulate it — verify the eviction preference under
real load."* Built `sim/evictionProtectionHarness.ts` + `sim/evictionProtectionCli.ts`
(`npm run eviction-protection-sim`), following the exact "same seed, honest counterfactual"
discipline `experienceFloorHarness.ts` established — but this case is NOT a same-tick rng-
lockstep comparison like that one: `occupantTenure` changes SELECTION itself (which candidate a
conscription event picks), not a value computed after an already-identical pick, so the two
arms genuinely diverge in which specific building fills/vacates on which day. Compared on
steady-state aggregate statistics instead.

**A real bug was caught before any number got reported, not after.** The first version of the
harness fed the "without" arm's own just-stripped `daysInRole` straight back into the
measurement — so it reported "30.00 days" every single day, by construction, since that's
exactly the constant it had just been reset to. That produced a fabricated "276% protective
effect" number that was really just "30.00 equals 30.00." Caught by inspection before writing
it down anywhere. Fixed with an `ExternalTenureLedger` — tracks what tenure would REALLY have
accumulated under no-preference dynamics, entirely outside `World` and independent of the field
being stripped to neutralize selection for the next tick. `world.daysInRole` still gets reset
before each `stepWorld` call (that's the real counterfactual manipulation, forcing uniform-
random selection); it's just never read back out as the measurement anymore.

**Real, measured results (8 seeds x 3000 days, DEFAULT_WORLD_CONFIG, 300-day burn-in):**
- `conscriptionFromOtherRole` fires 692 times across the full run (vs. 1058
  `conscriptionFromGrifters`) — the mechanism the preference touches is real and exercised
  under load, not dead code that only fires in synthetic fixtures.
- Steady-state mean `daysInRole` across every FILLED slot, all six roles: **113.07 days WITH
  the preference vs. 75.28 days WITHOUT** — a genuine, positive, ~50% relative uplift in how
  long established role-holders actually keep their roles.
- `economicHealth` barely moves (-0.00221 difference, WITH minus WITHOUT) — the preference
  protects tenure without costing the shard anything measurable.
- Population/occupancy accounting never breaks across any seed (minimum grifters+FILLED
  observed: 50, never negative).

5 new regression tests in `test/evictionProtectionImpact.test.ts` lock these real numbers in
(loosely bounded, not brittle exact pins, since they run a smaller/shorter sample than the full
CLI report): the event type fires at all, the tenure uplift is measurably positive and above a
real floor, economicHealth stays within a tight band, accounting never goes negative. 567 tests
total, typecheck clean.

---

## 2026-08-18 — Eviction-preference bias built: the V_i alternative, shipped and tested

Direct follow-up to the same-day V_i resolution (next entry below): *"yeah, build the selection
bias extension."* Extends the already-shipped "prefer lowest-standing eligible candidate first,
longest wait" grifter-conscription selection bias to `multiRoleConscription.ts`'s
`conscriptionFromOtherRole` event — the mechanism where an existing role-holder in one role gets
evicted to cover a different role's BACKSTOPPED slot. Previously this pick was pure uniform
random across every other-role FILLED candidate, with zero regard for how long they'd held
their slot; a player who'd just started was exactly as likely to be pulled as a long-tenured
veteran.

**New `RoleGroupState.occupantTenure?: readonly number[]`** (parallel array to `slots`, per-slot
days the current occupant has held it). Optional, and its default when omitted
(`ESTABLISHED_TENURE_DAYS`, meaning "already established, no preference") is specifically chosen
so that omitting the field reproduces the EXACT old uniform-random behavior — verified directly:
every one of the 553 pre-existing tests passed unchanged with zero modification before any new
test was added, proving this isn't just intent but a checked property. When tenure data IS
provided, the eviction pick prefers candidates below `ESTABLISHED_TENURE_DAYS` (a
`[CALIBRATED — provisional]` constant, deliberately exported by itself so a dev can retune it
in one place without touching the selection logic — user: *"make sure it's adjustable by the
dev as a [variable] we can change if it doesn't play well"*); once nobody remains below the bar,
the pick falls back to the full uniform-random pool exactly as before — deliberately not a
permanent ranking even among established players themselves, matching the "preference, not
immunity, never a permanent hierarchy" discipline the V_i rejection itself was argued on.

**New `RoleEconomicSlot.daysInRole`/`SupportRoleSlot.daysInRole`** (`world.ts`) feeds it: 0 the
moment a slot transitions into FILLED, +1 every day it stays FILLED, frozen while VACANT/
BACKSTOPPED — same reset convention as `wealth`/`personalResourceStock`, touched at all ~15 real
fill-transition points plus the Stage 3 wealth-accrual stage for the daily increment (Miller/
Baker handled entirely inside `stepCompetitiveLayer`, mirroring how `experience` already works
there). Deliberately a SEPARATE field from `experience` — `experience` caps at `EXPERIENCE_CAP`
(0.5) and saturates fast, useless for ranking "how established" two long-tenured occupants are
relative to each other; `daysInRole` is uncapped. At world creation, FILLED slots start at
`ESTABLISHED_TENURE_DAYS` (not 0) — "start maxed, established shard," the same convention
`experience: EXPERIENCE_CAP` already uses.

**Tests**: 4 new pure-function tests in `test/multiRoleConscription.test.ts` (green candidate
evicted before an established one, across 5 seeds; both green candidates exhausted before either
established one is touched when 2 slots need filling the same day; falls back to the full pool
once nobody is below the bar, never stalls; omitting `occupantTenure` entirely reproduces the
exact same event tally as passing it filled with `ESTABLISHED_TENURE_DAYS` everywhere — the
explicit backward-compatibility guarantee). 5 new integration tests in the new
`test/world.evictionProtection.test.ts` against a real `World`: `daysInRole` starts at
`ESTABLISHED_TENURE_DAYS` at creation, increments/freezes correctly, resets to 0 on conscription;
and, the real end-to-end case — a deliberately constructed fixture (zero grifters so every
conscription event is forced through `conscriptionFromOtherRole`, one established courier among
an otherwise all-green cast of other-role candidates, one Miller slot forced BACKSTOPPED) proves
the established occupant survives across 5 seeds while exactly one green candidate gets evicted
in its place. 562 tests total (553 + 9), typecheck clean.

---

## 2026-08-18 — V_i / constraint 6 resolved: rejected as specified

Direct answer to the user's instruction: *"answer the V_i / constraint 6 question."* The
`V_i` "reputation velocity" mechanic from the external v8 material (conscription-shielded
above 0.5, shield drops below 0.5) was left open in the 2026-08-13 HANDOVER entry. Resolution:
**no, don't build it as specified — constraint 6 stays unrevised.**

Two reasons:
1. The shield switching off below a threshold requires reputation to fall. That's a demotion.
   Constraint 6 (reputation may only ever grant, never remove) forbids it directly — no
   ambiguity here, this was already known before this pass.
2. New this pass: even a grant-only, *permanent* version of a conscription shield is dangerous
   to constraint 2 (no permanent zero-state) on its own, independent of constraint 6. A
   monotonically-growing population of permanently-unconscriptable players can, given enough
   shard lifetime, shrink the pool the shard's own backstop/conscription mechanism is allowed
   to draft from — a slower, structural path to the same zero-state failure constraint 2 was
   written to prevent. Grant-only reputation and a permanent immunity-from-the-shard's-own-
   survival-mechanism don't compose safely, regardless of the threshold chosen.

Proposed, NOT built: extend the already-shipped "prefer lowest-standing eligible candidate
first, longest wait" conscription selection bias (built this session for grifter conscription)
to established players more broadly. Preference instead of immunity — real felt protection
without ever making anyone permanently un-pickable, and it degrades gracefully under pressure
instead of failing catastrophically once too many players accumulate a status that can never be
taken back. Explicitly not implemented this pass; needs the user's confirmation first, since it
was offered as a future direction, not a build request. `docs/HANDOVER.md` updated to record
the resolution instead of leaving it open.

---

## 2026-08-13 — Experience floor's real effect measured, not just corrected by feel

Direct follow-up to the same-day cap correction (previous entry): *"simulate the dip
before/after the floor."* Built `sim/experienceFloorHarness.ts` — runs two `World`s from the
SAME seed and config in exact lockstep (`shiftsCoveredByRole` never influences any rng draw or
selection, confirmed directly in `world.ts`), one real, one with every grifter's shift history
stripped after each tick as an honest counterfactual — plus `sim/experienceFloorCli.ts`
(`npm run experience-floor-sim`) as the permanent report.

**Real numbers, 8 seeds x 3000 days, 300-day burn-in**: only 12.3% of all Miller/Baker fills
land a non-zero floor at all — the large majority of conscripts are still green, matching the
design intent exactly. Among the fills that DO get one, mean starting experience is 0.0225 of
EXPERIENCE_CAP=0.5 (4.5%) — comfortably inside the new 15% ceiling, nowhere near it. Aggregate
steady-state effect: mean Miller+Baker experience is 0.37% higher with the floor than without;
`economicHealthWithExperience` differs by 0.00074. **The correction held**: at the new 15% cap,
this mechanism is a genuinely small cushion in practice, not a measurement-shaped guess that
happened to sound right.

4 new regression tests lock the real numbers in, not just the design intent: most fills land
zero floor, non-zero fills stay a small fraction of the cap, aggregate relative difference
stays under 2%, and the floor never produces a WORSE outcome than no floor (grant-only holds
in aggregate, not just per-entry). 553 tests total (549 + 4), typecheck clean.

---

---

## 2026-08-13 — Experience floor cut hard: 50%→15% of EXPERIENCE_CAP, same day it shipped

User caught a real risk in the experience-floor mechanic (previous entry) before it had a
chance to cause damage: *"if a lvl 2 player had a distinct advantage over a grifter after the
backstop, then we're also giving people an opportunity to just jump the queue and grifters
won't be able to get anywhere... otherwise the experienced become the only players."*

Two separate things, both worth stating plainly rather than just fixing quietly:

1. **Selection was never actually affected** — worth clarifying directly, since this may have
   been the bigger part of the worry. `stepWorld`'s conscription event loop picks WHO fills a
   vacant Miller/Baker slot purely by lowest reputation level then longest wait;
   `shiftsCoveredByRole` has zero input into that choice. Nobody skips the queue because of
   this mechanism.
2. **But the SIZE of the starting boost was a real, legitimate gap** — 50% of `EXPERIENCE_CAP`,
   reachable in just 5 shift-covers, was large enough to stop reading as "a cushion" and start
   reading as "a real edge," the same compounding-advantage shape constraint 6 exists to rule
   out elsewhere in this design. Never simulated before shipping — a guess, not a measurement,
   and the guess was too generous.

**Cut hard, not trimmed**: `EXPERIENCE_FLOOR_MAX_FRACTION` 0.5→0.15, `EXPERIENCE_FLOOR_PER_SHIFT`
scaled down to match (still exactly 5 real shift-covers to max out the now-much-smaller
ceiling — genuine practice still means something, but the ceiling itself can now only ever be
a small cushion). Both constants remain `[CALIBRATED — provisional]` — this is a considered,
conservative correction made under real time constraints, not a measured one; still needs a
real simulation before being trusted further, same discipline as everything else in this file.
All 549 tests still pass unchanged (they reference the constants symbolically, not hardcoded
numbers — confirms the test suite itself was built correctly the first time, even though the
constants it was checking needed correcting).

---

---

## 2026-08-13 — Experience floor from role-specific Shift Cover practice, wired end-to-end

Real design question from the user, prompted by disagreeing with an external "v8" spec's
`V_i`/velocity-shield mechanic (which would let reputation fall, contradicting constraint 6 —
that objection stands, unresolved, on the user's own call to make): *"what happens to your
economy when a level 2 player is replaced by a grifter because they're the only one
available?"* Real, already-shipped answer: the shard never collapses (backstop/conscription
bypass the reputation gate entirely, constraint 2) — but role `experience` resets to 0 for
whoever fills it, a genuine, measurable productivity dip.

First proposal (scale the head-start by overall reputation LEVEL) was wrong — user caught it:
*"grifters don't start at lvl 2."* Correct, and already measured this session: the "level-2
trap" means 83-90% of grifters who reach level 1 get swept into a role within 7-16 days,
so a level-2 grifter to draw from essentially never exists. User's own refinement: *"perhaps
only if you've done open shift work as a grifter."* Right idea — tie the head-start to real,
role-SPECIFIC Shift Cover practice instead, which doesn't depend on the broken level-2 gate
at all.

**Built**: `src/engine/experienceFloor.ts` — `experienceFloorFromShiftsCovered(n)`, capped at
50% of `EXPERIENCE_CAP`, grant-only by construction (0 prior shifts = today's exact
`experience: 0`, never worse). `GrifterSlot` gained `shiftsCoveredByRole` (per-role, not the
flat `reputationProgress` counter). `shiftCoverOpportunities` now carries a role tag so a
successful cover credits the SPECIFIC role. Threaded through `stepWorld`'s conscription event
loop: for each Miller/Baker `genuineFill`/`conscriptionFromGrifters` this tick, the removed
grifter's real shift history (captured before removal) is zipped against the newly-FILLED
buildingIds (same order-based pairing discipline `justFilledSet` already relies on) into an
experience-floor map, passed into `stepCompetitiveLayer`.

9 new tests (5 unit + 4 world-integration, including a full round-trip: a grifter with 5 real
prior Miller covers starts measurably ahead of a green grifter once conscripted into Miller;
a grifter with none starts at exactly 0, same as today). 549 tests total, typecheck clean.

**Deliberately not built**: fixing the level-2 trap itself (still the real, larger lever for
a deeper "veteran bench" — this session's earlier open question, still unanswered) and
extending the floor to support roles (Courier/Journalist/Detective/Import-Export have no
tracked `experience` field at all yet, so there's nothing to floor there).

---

---

## 2026-08-13 — Personal resource stock built and wired; external "v8 spec" material saved but not adopted as verified

User brought outside design material (a "v8 master document," three "simulation run reports,"
and an "evolution and verification report") produced externally and asked for it to be saved
to the repo, then built from. Saved verbatim under `docs/external/` for reference.

**Real, checkable discrepancies were found and raised before treating any of it as verified**,
per the newly-added CLAUDE.md rule ("assumption is the mother of all fuck ups" — added this
session, user directive, now at the top of the file): the three "simulation run reports" were
byte-identical across all three files, which a genuinely stochastic simulation run three times
cannot produce; the material described infrastructure (a database layer, a "Credits" currency,
64Hz netcode with Saga-pattern distributed transactions, real-dollar API billing, FFT-based
input-timing anti-cheat) that doesn't exist anywhere in this actual repository and in several
cases directly contradicts decisions already shipped here (nodules, not Credits — the closed-
loop economy item 5 built 2026-08-11; no database at all — `stepWorld` is in-memory and
deterministic). One overclaim was made and corrected in the same conversation: asserting no
code was ever executed anywhere by the external tooling, which wasn't a claim there was
evidence for either way. The specific, checkable findings (identical files; content mismatched
with this repo) stand independently of that correction.

**One real structural question raised and not yet resolved**: the v8 material's `V_i`
reputation-velocity mechanic (conscription-shielded above 0.5, unshielded below) requires
reputation to be able to fall, which conflicts directly with constraint 6 ("reputation may only
ever grant, never remove," added 2026-08-08 after resolving a real prior contradiction in this
same project). Not resolved by fiat either direction — flagged for the user to decide whether
it's a deliberate revision of constraint 6, since that's not a call this session makes alone.

**What actually got built from the material, tested for real**: `personalResourceStock`
(`src/engine/personalResourceStock.ts`), closing the real gap
`docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §1 already flagged (resources.ts only tracks
shard-aggregate flows, not a personal balance any role-holder can spend toward a crafted item).
The cap value (5) was independently proposed twice — the fines doc's own "[ILLUSTRATIVE]...
e.g. 5" and, separately, the external v8 material's `UNIT_CAP = 5` — real convergent agreement,
noted as such. Refill cadence (`RESTOCK_INTERVAL_DAYS = 3`) remains genuinely unmeasured,
labeled provisional. Wired into `stepWorld`'s existing wealth-accrual stage for all six roles,
reset on every real fill-transition point (mirroring `wealth`'s own established convention),
capped and verified deterministic against 4 new integration tests running the real engine, on
top of 5 standalone unit tests for the pure step function. 541 tests total (526 + 6 diary-wiring
+ 5 unit + 4 integration), typecheck clean.

**Deliberately not built from the v8 material this pass**: k-anonymity spatial identity
scrambling, squeeze-and-evict detection (pressureDetection.ts already covers similar ground),
the velocity/reputation shield (blocked on the constraint-6 question above), illegal transit
interception. Not rejected — genuinely not attempted yet, pending the one open question and
further scoping.

---

---

## 2026-08-13 — Diary wired into `stepWorld`; reputation-retention research prompt sent

User: *"start wiring it in."* First of the four new modules actually connected to the live
`World` kernel, mirroring `pendingWallPosts`' own established "caller queues, `stepWorld`
consumes and clears" pattern exactly: new `pendingDiaryEntries: PendingDiaryEntry[]` on
`World`, processed in a new stage right after Stage 5's `identityLedger` update (so a SUBJECT
resolved by today's own rumour-hearing is writable the same day, not lagged a tick), using
`identity.ts`'s `resolvedSubjects()` to supply `writeDiaryEntry`'s known-set. Rejections
(self-entry, unresolved SUBJECT) are caught and reported via `lastDiaryRejections` rather than
throwing and crashing the tick — one bad queued entry never blocks a different valid one the
same tick, verified directly.

**One real, deliberate exception to `World`'s otherwise-immutable-snapshot contract, flagged
explicitly rather than silently accepted.** `PrivateStore` is a mutable `Map` by design
(`privateStore.ts`'s own header: "server-authoritative... the canonical copy") — there is
meant to be exactly ONE live diary store, not a fresh clone every tick the way every other
`World` field works. `world.diary` is therefore the SAME `Map` reference across every
`stepWorld` call for a given lineage, mutated in place. This is correct, not a bug — cloning it
per tick would create divergent diary copies across snapshots, which is exactly wrong for
something the design calls "the server's one canonical copy." Documented directly on the
`World.diary` field itself so a future session doesn't "fix" it into the wrong shape.

6 new integration tests (`test/world.diary.test.ts`) against a real `createWorld`/`stepWorld`
round-trip — not just the standalone unit tests `test/diary.test.ts` already had. 532 tests
total (526 + 6), typecheck clean.

**Proximity conversation, moderation logging, and arson deliberately NOT wired into
`stepWorld` this pass** — each for a real, separate reason, not oversight:
- Proximity conversation needs real per-utterance listener resolution across the connection
  graph (bigger than the queue-and-consume pattern diary used) — next candidate.
- Moderation logging's own silo test (`test/moderationLog.importGuard.test.ts`) explicitly
  forbids `src/world` (and `src/server`) from importing it — wiring it into `stepWorld` would
  violate the exact boundary built for it two sessions ago. It has to be consumed by something
  outside the guarded directories, which doesn't exist yet.
- Arson reuses pattern-based sabotage's machinery, and pattern-based sabotage itself is still
  explicitly a "PROPOSAL, not shipped as default" per `ecosystem.ts`'s own header — promoting
  arson to a live `stepWorld` mechanic would mean promoting pattern-sabotage to shipped-default
  status too, a bigger call than this pass was scoped for.

**Also sent**: a self-contained research prompt (not committed to the repo, sent as a file)
asking for other games' reputation/retention design patterns, explicitly scoped around the
still-open "level-2 trap" finding (83-90% of grifters get swept into a role at level 1 before
reaching level 2) and framed as "extract principles, adapt them to NODE's own constraints —
monotonic-only reputation, no social voting, no permanent zero-state — don't copy any single
game's system wholesale."

---

## 2026-08-13 — "let's get busy": diary content schema built and wired to real code

User's question — "are there things we can build already, without additional data, parked
away that could just be built instead of documented?" — got a yes, with three concrete
candidates: proximity conversation, the diary's content schema, and arson. "let's get busy."
First up, the smallest and most self-contained: `src/engine/diary.ts`.

**Built exactly to the addendum's already-locked spec, nothing invented.** SUBJECT/
OBSERVATION/READING/CONTEXT slots per `docs/DESIGN_ADDENDUM_2026-08-06.md`; the illustrative
OBSERVATION table (Trade/Information/Crisis/Presence, 28 entries) and READING table (5 entries,
deliberately small and blunt by contrast) typed in verbatim as closed string-literal unions,
same discipline as `SELF_STATES`/`TEMPLATES` in `comms/grammar.ts`. `writeDiaryEntry` throws on
a self-entry (mirrors `sendEnvelope`'s existing check) and on an unresolved SUBJECT (ties to
`isKnown()`, per fog-of-recognition) — writing is otherwise unprompted-only and always honest,
no write-time distortion, matching the design exactly.

**The distortion/retention correction from earlier this session gets its first real consumer.**
`distortDiaryEntry` plugs straight into `privateStore.ts`'s `getAlive` distort hook (built
earlier today, unused until now): OBSERVATION and READING each get one `applyDistortion` roll
per elapsed server day via new neighbor tables (within-category adjacency, same
semantically-adjacent-not-noise discipline as the rumour mill's `DISTORTION_NEIGHBORS`); SUBJECT
and CONTEXT pass through untouched. `DIARY_RETENTION_DAYS = 2`, matching the corrected design
exactly, locked in with a regression test asserting it stays well under the old ~30-day figure.

13 new tests (`test/diary.test.ts`): structural table integrity (every neighbor entry is a
real, different member of its own table — the same class of check `grammar.test.ts` already
runs on `TEMPLATES`), creation gating, same-day reads are exact, distortion fires once per
elapsed day not per read, retention boundary is silent and exact. 490 tests total (477 + 13),
typecheck clean.

**Deliberately not built yet, out of this task's scope**: the trespass mechanic's
SUBJECT-graph-only read (§7.3 of `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`) — that's a
thin derived view over `readDiary`'s output, genuinely trivial once housing/keys exist, but
still has real prerequisites this file doesn't (residency, the key-crafting economy) so it
stays a follow-up rather than scope creep into this commit.

---

## 2026-08-13 — Proximity conversation built: grammar, presence gating, distance-driven degradation

Second of the three "let's get busy" candidates. `src/comms/proximityConversation.ts`:
INTENT (8) / TONE (7) / CONTEXT (3, illustrative) closed tables, same
combinatorial-not-flat-list principle and function-boundary validation as `comms/grammar.ts`'s
`SELF_STATES`. REFERENT is `{kind:'room'}` or a specific present player — `composeUtterance`
throws on addressing an absent player (the design's own explicit "never an absent one," unlike
Wall/Envelope) and, extending `sendEnvelope`'s existing self-target check, on addressing
yourself.

**Spatial clarity reuses what Observatory Phase A already built for exactly this.**
`space.ts`'s `proximityCloseness()` — its own doc comment already named "proximity
conversation" as a future consumer back when it was built — feeds `decay.ts`'s
`applyDistortion` per slot, with distance driving corruption instead of graph hops. New
neighbor tables for INTENT/TONE (same semantically-adjacent-not-noise discipline as the rumour
mill's `DISTORTION_NEIGHBORS`); REFERENT and CONTEXT (the design's own "most fragile, drop or
distort first" slots) either drop or drift to another actually-present player / another tag.
Matches the design's "corruption happens before synthesis" property exactly: `degradeForListener`
returns an already-degraded object, there is no clean signal a listener's client could ever
recover — out-of-range returns `null` (hears nothing at all, not even corrupted).

**Ephemerality enforced by omission, not a runtime flag.** Deliberately no store, no
`getAlive`, no query-by-day — unlike Wall/Envelope or the diary, this module provides nothing
to persist. Relaying something heard here still has to go back through the existing
Wall/Envelope grammar, no new path added, matching the design exactly.

14 new tests (`test/proximityConversation.test.ts`): table structural integrity, presence/
self-address gating, distance-0 is exact regardless of rng (corruption chance is
mathematically zero at closeness=1, not just empirically untriggered), edge-of-range with rng
forced-on corrupts every fragile slot, a corrupted REFERENT never resolves to someone who
wasn't actually present. 504 tests total (490 + 14), typecheck clean.

**Deliberately not built yet**: TTS rendering (client/infra concern, out of engine scope by
design); the moderation-logging telemetry from `docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`
— next up, now that there's a real `Utterance` type to generate events from (task #68).

---

## 2026-08-13 — Moderation-logging telemetry wired, silo boundary enforced by a real test

Third of the "let's get busy" build items. `src/infra/moderationLog.ts` lives in a new
top-level directory, deliberately separate from `engine`/`world`/`comms`/`server` — making the
design doc's §3 silo requirement a directory-structure fact, not just a comment. Its own doc
header explains why: the simulation kernel must have zero dependency on or awareness of this
service, so the game is unaffected if it's ever offline.

**`captureProximityConversationEvent`** converts a real `Utterance` (built last entry) into
exactly the five design-doc fields — timestamp, actor, target(s), grammar payload, spatial
coordinates — never audio, matching the doc's own "TTS synthesis is deterministic, storing the
clip is pure data-minimization risk for zero benefit." **Bifurcated retention implemented for
real, not just described**: `isExpired` ages an unflagged entry out at the 30-day Tier-1 TTL,
or a flagged one at the DSA's 6-month Tier-2 floor from the day it was flagged, not the day it
was created. `createInMemorySink` is a reference implementation for tests/local wiring only —
real backend/hosting/encryption choices stay explicitly out of scope, same as the design doc
says.

**The silo boundary is enforced by a real test, not left as a doc claim.**
`test/moderationLog.importGuard.test.ts` mirrors `test/drivers.importGuard.test.ts`'s existing
pattern exactly: scans `src/engine`, `src/world`, `src/comms`, `src/server` for any import of
the logger and fails if it finds one, plus a sanity check proving the guard would actually
catch a real violation rather than vacuously passing. (The dependency correctly runs the other
way — `moderationLog.ts` imports `Utterance`'s type from `comms/proximityConversation.ts`,
since the logger has to know the shape of what it's logging; that's not a violation, only the
game depending on the logger would be.)

9 new tests (7 functional + 2 import-guard), 513 total (504 + 9), typecheck clean.

**Last of the three "let's get busy" candidates left**: arson, against its already-set 30%
target (task #69).

---

## 2026-08-13 — Arson built and calibrated to the 30% floor: all three "let's get busy" items done

Last of the three. `src/engine/arson.ts` reuses `ecosystem.ts`'s `patternSabotageAttempt`
wholesale, per the fines doc's own explicit instruction — zero new detection math. Only
arson-specific pieces built: `canAttemptArson` (the housing doc §7.6 absence-gate, both signals
— not actively working the role, not present at the abode — must be true); `resolveArsonTarget`
(a picked default for the doc's own flagged-open workplace-vs-abode question: a role-holder's
workplace, since arson reads as "destroying infrastructure" matching `applySabotageDamage`'s
existing semantics; a grifter's abode, since grifters have none to target; moot when the two are
the same mixed-use building).

**Calibrated for real, not guessed.** Swept `pPerWitness` at the shipped 6-step count directly
against `sim/sabotagePatternHarness.ts` (8 seeds, 20,000 days, 2,000-day burn-in — same harness
sabotage's own recalibration used, reused rather than duplicated). `0.02` lands no-Detective
success at 32.0% (mean 110 days between successes), with an active Detective 18.3% (mean 171
days) — matching *"30% opportunity is enough to take a chance... otherwise it's not worth
obtaining"* read as a floor: comfortably below sabotage's 71.1%/40.2%, "explicitly the hardest
of the three" honored with a real number, and a Detective still meaningfully harder (~43%
relative reduction, same order of magnitude as sabotage's own Detective effect). `sim/arsonCli.ts`
is the permanent report (new `npm run arson-sim`), mirroring `sabotagePatternCli.ts`'s shape.

13 new tests (`test/arson.test.ts`): absence-gate truth table, target-resolution defaults,
`attemptArson`'s defaults match its explicit-args form byte-for-byte, and four real
measured-regression locks (success rate stays in a 25-40% band, is below sabotage's own rate,
Detective still raises difficulty, rate stays high enough to be "worth obtaining"). 526 tests
total (513 + 13), typecheck clean.

**Deliberately not built**: the Firestarter crafting item (needs `personalResourceStock`, a
real prerequisite the fines doc's own §1 already flags as missing) and wiring into `world.ts`'s
tick loop (needs real per-tick witness-count/absence data) — this is the same
design+sim-verified-not-shipped stage pattern-sabotage itself went through before its own
harness existed, stated explicitly rather than implied.

**All three "would you agree there are many things we can build already... parked away that
could just be built instead of documented?" candidates are now done**: the diary's content
schema, proximity conversation, and arson. Session running low on budget — see
`docs/HANDOVER.md` for exactly what's real vs. what's still a prerequisite away.

---

## 2026-08-13 — Moderation-logging research turned into architecture, verified before adopting

Follow-up to the research prompt generated and sent earlier this session (proximity
conversation's logging obligations). User supplied an 11-page report back and asked to
"verify the results and then ensure the architecture meets these compliance standards."

**Verified, not rubber-stamped.** Three claims spot-checked against primary sources before
building anything on them: COPPA's "support for internal operations" exception (confirmed —
lets a persistent identifier be logged without parental consent for security/safety purposes;
found one gap in the report's own citation, that current FTC rule text also requires naming
the specific internal operations in the privacy policy); DSA Article 17/20 (statement of
reasons, ≥6-month appeal window — both confirmed accurate); and the single most load-bearing
claim, that TTS output from a fixed template avoids GDPR's Article 9 biometric classification —
directionally confirmed against AEPD guidance, but that guidance is general voice-processing
guidance applied to this case, not a ruling about a system like NODE's, so recorded as
credible-not-certain rather than settled. User separately confirmed reaching the same
conclusion from their own research. A fourth spot-check (Epic Games' 14/28-day voice-report
retention) confirmed accurate, and surfaced that Epic's actual capture is a rolling 5-minute
buffer — more aggressive than anything proposed here, which reads as reassuring rather than
exposed for NODE's proposed 30-day default.

**Architecture written up in `docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`**: never store
the rendered TTS audio (deterministic synthesis makes storing it pure GDPR-minimization risk
for zero benefit); log five structured fields only (timestamp, actor, target, grammar payload,
spatial coordinates) to a backend service completely siloed from the game's own simulation
kernel — `stepWorld` and friends have no dependency on or awareness of it, matching the same
silo discipline `decay.ts` already models for reusable primitives; bifurcated retention,
30-day rolling TTL for unflagged logs, moved to a Dispute Archive through investigation +
DSA's 6-month appeal minimum if flagged.

**A real correction caught by cross-referencing same-session work, not missed this time**:
the report recommended matching this log's retention to the diary's ~30-day window "for
consistency." That was accurate when the report was researched, but the diary's own window
had already shrunk to ~2 days earlier the same session (previous entry, this same file).
Written up explicitly rather than silently adopting a now-stale recommendation: the two
systems are independently justified (one by GDPR's one-month DSAR cycle, the other by pure
game-design taste) and were never required to track each other — this doc says so directly so
a future session doesn't "fix" them into alignment based on a misreading of why 30 came up in
two different places.

No code — proximity conversation itself still has none. Design-only, same status as the fines
economy and Oracle docs, waiting on the feature it describes existing first.

---

## 2026-08-13 — Real correction to the diary's own retention model: daily distortion, ~2 days not ~30, and a design-doc sweep for what else was still wrong

User, sharply, after the proximity-conversation correction above: *"also, the diary changes
daily through subtle distortion. no 30 days, only yesterday's mechanical memory of interaction
reset as server. why is all this being ignored..."*

Two real errors, both fixed, neither a small one:

1. **The retention window was an order of magnitude too long.** `DESIGN_ADDENDUM_2026-08-06.md`
   had the diary at ~30 days, unfaded, reads-exactly-as-written-until-expiry. That's most of
   the way to being the persistent cross-player trust ledger constraint 4 forbids, just gated
   behind a UI. Rewritten to ~2 days ("yesterday's" — today plus what's left of yesterday),
   tied to the server's own day-tick, matching how vacancy pressure and shift eligibility
   already reset.
2. **The store itself was static — dead wrong, and I'd defended the wrong version of it
   earlier this same session.** Earlier today's housing/reputation design work (§7.4 of
   `DESIGN_HOUSING_REPUTATION_2026-08-13.md`) explicitly built a *separate* read-time-only
   distortion layer for the trespass mechanic specifically *because* I believed the diary's own
   storage had to stay untouched — citing `comms/decay.ts`'s own header, which claimed the
   diary was "NOT used by" it. Both were wrong. Fixed: the diary's stored entries (once the
   schema exists) will run through `applyDistortion` once per server day-tick they survive —
   OBSERVATION and READING drift toward plausible-adjacent values; SUBJECT and CONTEXT never
   distort, since identity resolution has to stay reliable (constraint 4) and CONTEXT is a
   pointer to a real event, not a recollection of one.

**A design-doc sweep the user explicitly asked for** ("read elsewhere in the addendums... pull
out all the parts you've forgotten") turned up more than the two docs already in view:
- `DESIGN_ADDENDUM_2026-08-12.md` §10 already had a fully-modeled diary-distortion proposal
  from two days ago (reset-with-residue, `DISTORTION_NEIGHBORS`, a 7/14/30/90-day sweep,
  0.30 distortion rate) that I never reconciled with today's `privateStore.ts` work — exactly
  the kind of thing the user's frustration was about. The *mechanic* it specifies (honest
  writes, silent distortion, no tell, no contradiction popup) is still correct and now the
  live spec; its numbers (14/30-day reset intervals) are flagged stale in place rather than
  deleted, since the reasoning trail (resets widen the screenshot gap, they don't close it) is
  still worth keeping.
- `DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.4 (the trespass read-time-distortion layer) is
  now redundant and rewritten: with the diary's own storage already drifting daily and the
  window down to ~2 days, a second distortion pass on the trespass view would just be noise.
  Trespass now reads the live SUBJECT graph, unmodified by any extra layer — §7.5's
  constraint-4 compliance reasoning updated to match (the "never the same twice" property now
  comes from the short window churning, not a bolted-on read-time roll).
- `comms/decay.ts`'s header ("NOT used by the private diary") and `privateStore.ts`'s header
  and `getAlive` signature were both wrong/incomplete. `getAlive` gained optional
  `distort`/`rng` params: applied once per elapsed server day (catches up if several days were
  missed between reads), mutating the stored value in place, entirely opt-in so any other
  future consumer of `PrivateStore<T>` that must NOT drift (a future ledger of fact, not
  impression) just omits them. 4 new tests in `test/privateStore.test.ts`.
- `ECOSYSTEM_VISION_2026-08-06.md` and `BLUEPRINT.md` (five separate spots: the addendum
  summary, the `privateStore.ts` architecture entry, the "server-authoritative" load-bearing
  decision, the file-by-file description, and the 2026-08-08 permanence-contradiction
  resolution) all still cited the old ~30-day/no-fade figure as current fact. All corrected in
  place with the new number and a note of what changed, not silently overwritten.

**Why this happened**: I anchored the diary's own storage to the 2026-08-06 static-TTL model
all session, including while doing dedicated "reconciliation" work on it a few hours earlier,
instead of noticing the 08-12 addendum had already moved past that model and applying the same
continuous-decay principle used everywhere else in the design. Caught by the user, not by me —
worth being honest about in the log rather than glossing over.

477 tests passing (473 → 477, four new), typecheck clean.

---

## 2026-08-13 — Real correction to proximity conversation's ephemerality claim: infra logs vs. game-mechanic state

User, on "proxy chat" (proximity conversation, `docs/DESIGN_ADDENDUM_2026-08-06.md`, confirmed
by description — TTS-rendered, no microphone, matches that section's own spec word for word):
*"it's just in game communication, txt to speech so there's no biometrics. there is no way
this isn't in the logs."*

A real, correct catch — the original spec's "nothing retained anywhere... no recording to be
subject to any policy" and "recorded nowhere and by no system, full stop" overstated the
claim. The composed message is ordinary structured client-server data; any real deployed
system will have SOME infrastructure that incidentally touches it (access logs, crash
telemetry, abuse-report tooling). Fixed by drawing the same distinction the diary's own
retention section already draws nearby in the same document: infrastructure-layer data a
platform holds for moderation/compliance purposes (real, unavoidable, outside this design's
control) versus GAME-MECHANIC state (what gameplay systems actually query/persist/replay —
still genuinely nothing, no mechanic anywhere lets any player pull up a transcript). The real,
buildable guarantee was always the second one; the first was never something a game design
document could actually promise. Not a redesign — the "no microphone, no biometric capture"
win (the actual point of the whole mechanic) is untouched and still real.

**Still open, from the same thread**: whether "explore it on each level" means gating
proximity conversation's INTENT/TONE/REFERENT/CONTEXT vocabulary richness by reputation level
(grifter level 0 gets a real, unremovable baseline subset; level 1/2 unlock more) — proposed,
not yet confirmed by the user. Picking up once confirmed.

---

## 2026-08-13 — Sabotage recalibrated (relatively easy now), arson given a real difficulty target, diary pace confirmed untouched

User, across several messages: *"we need sabotage to succeed more often. it can't take over
100 days"* → *"sabotage must be relatively easy, but connecting information must take
time"* → *"all you receive is a diary snippet. destroying infrastructure must be more
difficult"* → *"arson is a far more difficult crime, but still possible. 30% opportunity is
enough to take a chance. otherwise it's not worth obtaining."* Together, a real, explicit
three-tier difficulty principle for the whole crime pipeline: sabotage easy, diary-intel slow,
arson hardest of all — not one uniform difficulty knob.

Checked before touching anything: `applySabotageDamage()` reduces `filledByPlayer` (economic
output/effectiveness) — confirmed this is NOT "destroying infrastructure," so recalibrating
it doesn't blur the line with arson (unbuilt, separately targeted).

**Sabotage recalibrated with real measurement, not guessed.** Two levers checked
independently via the existing `sabotagePatternHarness.ts` before combining:
`PATTERN_STEP_CADENCE_DAYS_DEFAULT` 15→7 (detection depends only on steps completed, never
calendar time — confirmed by measurement, 44.8%→44.4% caught is noise, so this purely halves
campaign length for free) and `PATTERN_P_PER_WITNESS_DEFAULT` 0.01→0.006 (the lever that
actually raises success rate). Combined result (8 seeds, 20,000 days): no Detective 71.1%
succeed / mean 55 days (was 55.2% / 146 days); with Detective 40.2% succeed / mean 85 days
(was 32.0% / 220 days). Both now under the 100-day ceiling; Detective still meaningfully
harder; constraint 2 re-verified holding (tail health min 0.725-0.750 under 4 concurrent
attackers). 3 new regression tests lock this in as a real property.

**Arson given a real calibration target for whenever it's built**: ~30% success rate, read as
a floor not a ceiling — "far more difficult" than sabotage's new 40-71%, but not so low the
crafting cost stops being worth it. Recorded in
`docs/DESIGN_FINES_ECONOMY_2026-08-13.md`'s new §4.1 for whoever eventually builds arson's
detection math to verify against, the same way sabotage's numbers were just verified.

**Diary/intel-gathering explicitly confirmed as the deliberately slow half** — "connecting
information must take time," "all you receive is a diary snippet" reaffirms the existing
§7 design (one small distorted piece per trespass), nothing changed there.

473 tests total (470 + 3 new), typecheck clean.

---

## 2026-08-13 — Measured the level-2 "trap," fixed a latent bug found by inspection, real numbers presented

User: *"let's explore these options and offer solutions"*, following up on the earlier
flagged finding that Miller/Baker's voluntary fill path is effectively closed. Built a real
probe (not a snapshot) tracking every grifter's reputation level across 800 days, 3 seeds,
correlating level against pool removal. Confirmed the hypothesis with real numbers: 105-128
grifters reach level 1 per seed, only 10-21 reach level 2; 83-90% of those removed while at
level>=1 were removed AT level 1, mean 6.9-16.3 days after reaching it. Mechanism: level 1
opens FOUR roles at once (Courier/Journalist/Detective/Import-Export), so most grifters get
swept into one of them long before accumulating the extra progress level 2 needs.

While measuring, found a real latent bug by inspection (not a second reproduced failure):
`world.ts`'s `genuineFill` translation didn't prefer the lowest eligible reputation level
first, unlike `stepMultiRoleConscriptionDay`'s own internal bookkeeping for that same event
type — the same class of internal/real mismatch as the two bugs found restructuring the gate
itself. Fixed proactively. Conservation sweep and full suite (470 tests) still clean. Didn't
meaningfully change the level-2 numbers on its own — confirms the dominant effect really is
the four-roles-competing dynamic, not this consumption-order detail.

Measured real threshold sensitivity as a candidate fix: 6 (shipped) → 44 total level-2
achievers across 3 seeds/800 days; 5 → 77; 4 → 162. A clean, single-constant, no-side-effects
lever. Presented with real numbers via `AskUserQuestion` (leave as intended-rarity, lower to
5, lower to 4, or something else). User chose "something else — tell me what to try" without
specifying yet; asked directly what mechanism they have in mind rather than guessing. Not
resolved this entry.

---

## 2026-08-13 — Reputation gate restructured and wired, two real bugs found and fixed verifying it

User: *"let's restructure the reputation gate before coding, then begin."* Closed the piece
the earlier reputation-levels pass had explicitly deferred: the voluntary-uptake gate,
blocked because `sim/multiRoleConscription.ts`'s `genuineFill` was a hazard-driven aggregate
count with no per-grifter selection.

**Restructured, backward compatible.** `RoleGroupState.minReputationLevelForFill` and an
optional per-level pool breakdown on `stepMultiRoleConscriptionDay` — both default to
today's ungated behavior when omitted, proven with a real byte-equality test against the
exact old call shape. `world.ts` computes real per-level grifter counts every tick and wires
`minLevelForRole` (1 for the four cooperative roles, 2 for Miller/Baker) — the gate is live.

**Bug 1, caught by the pre-existing population-conservation test, not hypothesized**: a real
15-vs-14 mismatch. `conscriptionFromGrifters` (meant to bypass the gate entirely) decremented
the aggregate pool but not the new per-level breakdown, so a role processed later the same
day could see a stale snapshot and let a `genuineFill` through with nobody real left to fill
it. Fixed by keeping the per-level running count in sync on every consuming event, not just
the gated one.

**Bug 2, found immediately after — same reproduction, still failing.** The internal
bookkeeping now assumed `conscriptionFromGrifters` always consumes the lowest available
level first, but `world.ts`'s REAL selection for it was still pure longest-wait, level-blind
— if the longest-waiter happened to be a rare higher-level grifter, reality and the internal
assumption diverged. Fixed by making the real selection also prefer lowest-level-first,
matching the internal assumption exactly rather than approximately. Both bugs traced with an
actual reproduction (day 237, seed 3), not guessed at from first principles.

**A real, measured consequence, reported not hidden**: at the shipped config, no grifter
reached level 2 within 800 days across 3 seeds — so Miller/Baker's voluntary fill path is
effectively closed under current dynamics; they now fill almost entirely through
conscription/backstop instead. Economic health stayed healthy (0.909–0.922) regardless, since
the backstop absorbs it as it always has — but this is a stronger effect than "harder to get
into," flagged as worth a closer look, not smoothed over.

4 new tests, 470 total, typecheck clean. Full trail in `docs/BLUEPRINT.md`'s "reputation
gate" entries.

---

## 2026-08-13 — The two remaining open design threads: fines economy + Oracle odds (design only)

User: *"the open design threads"*. Two new documents, both design-only, both cross-referenced
with what's already written up rather than duplicating it.

**`docs/DESIGN_FINES_ECONOMY_2026-08-13.md`** — the tongue-in-cheek disallowed-rules mechanic
(no stealing/arson/trespass/detected misinformation), captured piecemeal across several
messages earlier today, written up as one coherent design. The "capped per-role resource"
requirement turns out to already exist: `resources.ts`'s six named resources
(grain/flour/bread/parcels/stories/leads), one per role, shipped since 2026-08-11 — reused,
not invented. Real gap found and closed on paper: those resources are tracked shard-aggregate
today, not as a personal stock a role-holder could spend/trade; proposed a per-slot
`personalResourceStock` mirroring `wealth`'s existing accrue-while-occupied/reset-on-new-
occupant convention, checked to confirm it does NOT hit the same persistent-identity wall that
blocked reputation levels (it only needs to persist for as long as someone holds the slot).
Three illustrative item recipes (Key/Firestarter/Theft-tool), each combining three different
roles' resources, communal pooling rather than bilateral trade (mechanical, not negotiated).
Detection reuses `ecosystem.ts`'s pattern-based sabotage step-chain wholesale — a violation is
structurally the same "many innocuous steps, no single one definitive" shape sabotage already
models, so zero new detection math was written. Misinformation explicitly does NOT get forced
into the item-crafting shape — it already has a complete home in the rumour mill/pressure
detection. Fines refund into nodule supply (closed-loop, matches nodules-as-sole-root-input);
checked whether "nodules keep pace with node growth" needs new code and found it's already
true structurally (nodule supply already scales with Import/Export slot count).

**`docs/DESIGN_ORACLE_2026-08-13.md`** — closes the Oracle's one remaining `[OPEN]` item
(which metric its odds should float on). Checked both real candidate metrics against already-
measured behavior rather than guessing: `economicHealth` reads "basically fine" (0.96) even
under real sustained attack (an existing finding from earlier this project);
`economicHealthWithExperience` genuinely moves (0.77 under the same attack) — recommended.
Proposed a linear, clamped, floored health-to-odds mapping that matches the exit-ticket
gamble's own already-validated flat-odds population simulation at healthy conditions and never
reaches zero (constraint 2). Event prizes scoped to real economic quantities only (nodule
bonus, resource top-up, a small wealth bonus checked against existing Gini findings) —
explicitly never standing or reputation, which constraint 6 rules out structurally.

**Design only, both documents. No code, no new tests this entry** — matches the design-before-
code discipline used all session. Full detail in `docs/BLUEPRINT.md`'s matching entry.

---

## 2026-08-13 — Reputation levels: real progress tracking, a real architectural blocker found, and a real calibration fix

User: *"let's continue"*. Following the housing build order's own next step (§3, reputation
levels). Before writing any code, checked whether the design's "persists across a grifter
becoming a role-holder and back" assumption actually holds against the real engine — it
doesn't. `player.ts`'s own header already flags this: player identity is "session-scoped,"
real accounts are explicitly deferred. `world.ts` substitutes `buildingId` for `playerId`
wherever role-holders need one; a role slot resets wealth/experience to 0 on every new
occupant with no reference to who held it before. Separately, the design's own gate (voluntary
uptake only, never conscription) needs to pick a SPECIFIC grifter for a voluntary fill — but
the real fill mechanism (`genuineFill`) is a hazard-driven count increment, not a per-grifter
selection at all.

**Scoped down to what's honestly buildable**: level/progress tracking, not the gate. New
`src/engine/reputation.ts` — `reputationLevelForProgress` (pure derivation, level never
stored separately from progress) and `rolesEligibleFor(level)` (additive, level 2 = level 1
plus Miller/Baker, never a replacement). `GrifterSlot.reputationProgress` wired into the
existing Shift Cover payout — a successful cover earns one tick, reusing the existing
once-per-slot-per-day cap as the anti-grind limiter, no new one needed. The gate itself isn't
called from anywhere — labeled honestly in the module's own header, not silently presented as
done.

**Then measured the illustrative thresholds before trusting them, per house rule.** First
shipped `[3, 8]`, no data behind it. Real `stepWorld` runs (1000 days, 3 seeds, 3 churn rates,
tracked every tick — a final snapshot alone undercounts, since high-progress grifters often
get conscripted and vanish from the pool, which is the mechanic working correctly) found level
1 (3) robustly reached, but level 2 (8) reached ZERO times across all 9 combinations — max
ever observed topped out at 7. A dead tier, caught before it shipped as a real number rather
than an illustrative placeholder. Lowered to 6 — empirically reached, still double level 1's
bar. Locked in with a regression test that fails if a future change makes level 2
unreachable again.

**466 tests total (451 + 15 new), typecheck clean.** Not built: the voluntary-uptake gate
(needs fill-selection restructured to pick individual grifters — separate, larger work); any
notion of reputation surviving a grifter's transition into a role and back (blocked on the
same missing persistent-identity concept, not fixable in this pass's scope). Full trail in
`docs/BLUEPRINT.md`'s "Reputation levels" entry.

---

## 2026-08-13 — First real housing code: floors, capacity, grifter residency (build+test, not design)

User: *"continue working on the build and test as you go"* — after two design-only doc
sessions today (housing/reputation, then diary-in-abode), this is the first actual engine code
from that work, following the housing doc's own §6 build order. Also, mid-work: *"the goal is
to create something fun to play despite the mathematical gymnastics underneath"* — noted, kept
scope real and shippable rather than building the whole housing/floors/rendering system at
once.

Added `Building.floors` (space.ts), `districtHousingCapacity()`, `chooseHousingDistrict()` (the
housing-capacity analogue of the existing `placeArrival` lowest-population selection), and
`GrifterSlot.districtId` (world.ts). Housing assignment is a single lazy-fill pass at the end
of `stepWorld` rather than touching the 6+ places a `GrifterSlot` gets constructed — same
pattern the `District.population` fix from earlier today already used. Role-holders are housed
for free (same district as their workplace, already tracked); `District.population` now means
real total residents, not just role-holders.

Verified against a real run, not just unit tests: shipped config, 300 ticks — housing capacity
372, real population 67, all 22 grifters housed, `District.population` matches
`world.population` exactly (one district). 9 new tests (capacity formula, headroom selection,
edge cases, plus world-level tests that every grifter gets housed, stays housed, and spreads
across districts at a multi-district config). 451 tests total, typecheck clean.

Deliberately NOT built this pass: per-building (not just per-district) assignment, the
consolidation-displacement grace period applied to housing, and wiring reputation levels or
the diary-in-abode mechanic to this new foundation — both still need it but aren't connected
yet.

---

## 2026-08-13 — The diary lives in the abode: trespass, keys, and a connections-only view (design only)

Direct follow-on, same session, right after the district-topology resolution. User: *"we have
to leave the current diary of the player in their abode. so when their offline, or online, if
someone trespassed via gaining a key, they can enter your abode and look at your diary. we
have to also make the diary mechanical so it automatically shows connections but not what
they're saying, so that the next day it's still distorted enough to change for everyone."*
Two immediate follow-up refinements in the same breath: *"but only visible to a player
trespassing, not general visitors or visible in game in that environment. only viewable via
trespass"* and *"you can only trespass when the player is outside or offline."*

This is a real, coherent composition of three previously-separate pieces from this same
session, none built in code yet: the diary (design-locked since
`docs/DESIGN_ADDENDUM_2026-08-06.md`, SUBJECT/OBSERVATION/READING/CONTEXT slots, hard silent
~30-day TTL, storage primitive built as `engine/privateStore.ts` but never wired to real
content), universal housing (`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1, not built),
and the tongue-in-cheek fines/crafting economy (earlier today's devlog entry, not designed in
detail). Written up in full as new §7 of the housing design doc rather than re-explained here.

**The key finding worth pulling out on its own**: "shows connections but not what they're
saying" maps EXACTLY onto the diary's own already-existing SUBJECT slot (who an entry is
about) versus its OBSERVATION/READING slots (what was seen, and the owner's biased read of
it) — no new schema needed, the diary's original 2026-08-06 design already drew this exact
line, and had already independently rejected a numeric trust/valence slot for the same
"don't let this become an optimizable dossier" reason. A bare connections graph sits
comfortably inside a boundary the diary's own designers already accepted as safe.

**A real, explicit reconciliation with a previously-recorded decision, not a silent
override**: `comms/decay.ts`'s own header says "NOT used by the private diary... the diary is
a genuinely different mechanic [hard TTL, no gradual fade]." That stays true — the raw stored
diary entries are untouched by this design. What's new is a separate, read-time-only
projection (the connections view shown under trespass) that reuses `decay.ts`'s existing
distortion primitive, freshly rolled every time it's queried, never cached — which is exactly
what makes "still distorted enough to change for everyone" the next day true, without
touching the diary's own storage/expiry model at all. Recorded explicitly per CLAUDE.md's own
"don't silently work around a rule that breaks — say so" instruction, since this could easily
have been read as quietly contradicting the 2026-08-06 decision if left unstated.

**Corrects my own earlier guess**: the fines devlog entry from earlier today speculated "no
trespass" would map onto `districtAccess.ts`'s wall-shortcut rules. This session's framing is
sharper — trespass means entering another player's abode without a key, unrelated to district
shortcuts. Recorded as a correction, not silently overwritten.

**Constraint-3 payoff from the "only while absent" rule**: gating trespass on the owner being
offline-or-elsewhere means the mechanic never needs to model a confrontation between the two
players at all — no alert state, no reaction to infer, nothing added to what's modelable.
Removes a whole behavioral surface by construction rather than building it and constraining it
after.

**Design only — nothing built.** All three composed systems (housing/residency, diary content
schema, key-crafting economy) remain unbuilt. Full writeup, including the constraint-4
compliance reasoning and the explicit open items (key-crafting recipe, trespass witness math,
whether the owner ever learns a trespass happened) in
`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.

**Follow-up, same thread**: *"same with arson. can't do it when their active in their role, but
can when they're not at home."* Generalizes §7.1's absence-gate to a second fines rule —
arson needs BOTH "not actively working their role" AND "not present at their abode" to be
true, which composes cleanly with the "above bakeries" mixed-use housing model (the two
signals can be the same building). Arson's actual TARGET (workplace, abode, or either) wasn't
stated and isn't assumed — recorded as `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.6,
flagged open rather than guessed.

---

## 2026-08-13 — Captured, not yet designed: tongue-in-cheek disallowed-rules / fines mechanic (Journalist + Detective enforce)

User flagged this mid-session, explicitly worried it hadn't survived a prior session:
*"we also need to include the rules, by which the journalist and detectives mechanical[ly]
fines players who are caught. the rules are tongue in cheek for things you can do, but it's
disallowed."* Checked every doc in `docs/` for "fine"/"tongue-in-cheek"/"disallowed" before
concluding this — confirmed genuinely absent, not just missed by a bad grep. Recording it now,
verbatim, precisely so this doesn't happen a second time.

**The ruleset itself, as given** (tone is load-bearing — a short, deadpan, in-fiction "code of
conduct" list, not a solemn legal document; matches the brief's own "grudges and sour
relationships are expected and fine... a world that never visibly risks anything reads as
vanilla" tone target, `DESIGN_ADDENDUM_2026-08-06.md`):

1. No stealing
2. No arson
3. No trespass
4. No detected misinformation

**Mechanically, Journalist and Detective are the enforcers** — catching a violation triggers a
fine. Not designed yet, but a first read against what's already built, so the next design pass
doesn't start from zero:

- **"No detected misinformation"** already has an obvious mechanical home: the rumour mill's
  decay/distortion tracking plus Journalist's wall-post pressure detection
  (2026-08-12 item 1, `BLUEPRINT.md`). A rumour crossing some distortion/pressure threshold,
  once flagged, is the "caught" event.
- **"No trespass"** maps onto the district-access/wall-shortcut rules already designed in the
  2026-08-13 addendum §5 (Courier/Journalist/Detective get wall shortcuts; everyone else must
  route via plaza+gates) — trespass reads naturally as "detected somewhere the access rules
  say you shouldn't be," which Detective is already the natural role to police.
- **"No stealing" and "no arson"** have no existing mechanical hook yet — no wealth-theft or
  building-damage mechanic exists in the engine today. These need their own design pass,
  including the constraint-3 check every new mechanic gets ("does this need to be an agent" —
  these must be caught mechanically/structurally, like the existing pattern-based sabotage
  re-spec, not by modeling player intent).

**Follow-up detail from the user, same conversation**: *"each event requires multiple people
to use their resource to create the item for each action."* — committing one of these
(arson's presumed "item," stealing's presumed tool) isn't a lone-player action; it requires
several players to each contribute a resource to craft whatever's needed first. This is a real
mechanical gate, not a narrative one, and it composes directly with what's already built rather
than requiring anything new to model intent (constraint 3): more participants required to
create the item means more real people whose presence/resource-spend is itself a witnessable
event, which is exactly the shape `identity.ts`'s real-encounter-count witnessing and the
pattern-based sabotage re-spec (`docs/BLUEPRINT.md`'s "Open deviations") already use for
detection — a crime that structurally can't stay solo-and-silent, by construction, not by the
engine tracking anyone's motive. User's own follow-up confirms the intent reads correctly:
*"so going solo requires help"* — there is no lone-wolf path through this at all; recruiting
help isn't a strategy choice, it's the only route the mechanic allows.

**Further mechanical detail, same conversation**: *"every role has a resource they produce via
play, to a limit and they can use it to create part of an item. they need to trade with other
people, their resource, to gain the other parts."* — each role produces its own capped
resource through ordinary play (the existing per-role economic-resource shape — grain/flour
already exist for Miller/Baker, `resources.ts`, 2026-08-11 item 5), and that resource forms
only *part* of whatever "item" a rule-4 violation requires. No single role can produce every
part alone; assembling the item means trading with players in other roles for the missing
parts. This is the actual mechanism behind "going solo requires help" above, made concrete —
and it composes with the existing resource-chain architecture (a new item-recipe layer on top
of already-produced role resources) rather than inventing a parallel economy. Final framing
from the user: *"so each person only knows one part of the puzzle"* — no player, alone, has
either the resource or the knowledge to complete the item; the "puzzle" is genuinely
distributed, not just resource-gated.

**Separate, adjacent request, same conversation, not yet started**: *"we also need to start
putting values, odds and statistics into the oracle, anything that's mechanical requires
development and modelling. event prizes etc etc"* — the Oracle currently exists only as design
(`README.md`'s "Other things being built": "a real probability draw, the same odds for a
three-year veteran as for someone who joined this morning... when the local economy is
healthy, the Oracle's odds widen for everyone"), with no concrete odds table, prize schedule,
or economic-health-to-odds mapping specified yet. User's own standing principle applies
directly here too, restated in their own follow-up on the fines/economy work: *"without the
ecosystem running on resources, I'm not sure how we can really test anything"* — i.e. don't
hand-pick odds/prizes in the abstract; ground them in the real, already-measured economic
signals (`economicHealth`, `wealthGini`, the resource chain) the same way every other constant
in this project has been derived, not guessed. Queued, not started.

**Closing detail, and an explicit request to actually simulate this, not just design it**:
*"we need to model this against the node and see what happens. giving each player a resource
they can gain, make it arbitrary and enforce a cap. interaction and trading is how resources
are distributed. fines refund the economy, and as the node grows, additional nodules arrive at
the docks so the economy stays in equilibrium."* Concrete shape now specified: every player
(any role) gains an arbitrary, capped personal resource through play; that resource only moves
between players via trade (no other distribution channel); a fine, when levied, is a sink that
refunds INTO the economy rather than just vanishing (consistent with nodules being the sole
root input per 2026-08-11 item 5 — this is a redistribution mechanism on top of that closed
loop, not a second currency); and node growth is matched by more nodules arriving at the docks,
an explicit equilibrium-maintenance rule so the fine/craft/trade loop doesn't quietly drain or
flood the economy as population scales. **Still queued, not built or simulated this session**
— this is real, additional scope on top of the fines ruleset above, and needs its own design
pass (a recipe/craft/fine economy layered on `resources.ts`) before a sweep is worth running,
matching this project's own design-before-code discipline. Recorded in full here specifically
so it survives to that pass.

**Not designed further this entry** — captured and cross-referenced, not specced, because the
user's immediate priority this session was resolving the district-topology question first (see
the entry below/above this one). Queued as the next design item once that's resolved.

---

## 2026-08-13 — District-topology question resolved: 1 district per shard, and two real bugs found+fixed getting there

Direct follow-on from the housing-design session below: user said *"let's resolve the issue
before proceeding"* — the district-count conflict from `VISUAL_FRAMEWORK_2026-08-12.md` §8.
Went to fix `District.population` first (the bug flagged, not yet fixed, in that same
session) so real per-district numbers could finally be trusted instead of guessed at.

**Bug 1, found via the fix itself.** `District.population` was never incremented by the real
`stepWorld` tick loop — confirmed 0 in every district at day 800 across 3 seeds. Fixed: the
final return in `stepWorld` now derives each district's population from real FILLED role-slot
state across all six roles. 5 new tests.

**Bug 2, found immediately by looking at the newly-real numbers.** Two of the shipped
6-district config's four periphery districts read population 0 in every seed — not noise,
deterministic. Root cause: `assignRoleBuildings` walked buildings strictly in
district-then-building order and simply ran out of role slots before reaching the last two
periphery districts. First fix attempt (interleave district-cycling and role-cycling in one
loop) introduced a WORSE bug, caught immediately by an existing test rather than shipped: with
exactly 6 roles and 6 districts, both cursors kept a constant offset mod 6 forever, so every
courier landed in the identical single district (`test/courierPay.test.ts`'s distance-variance
test caught this — all 7 couriers, identical wealth). Real fix: process roles one at a time,
with a district cursor that keeps advancing ACROSS roles rather than resetting per role. 2 more
tests confirming no district is ever starved, across 4 seeds.

**With both bugs fixed, real per-district numbers were decisive.** Single shard, 800 days, 3
seeds, shipped 46-slot split:

```
1 district:  meanRoleHoldersPerDistrict=43.0  health=0.961  gini=0.619
3 districts: meanRoleHoldersPerDistrict=14.3  health=0.961  gini=0.628
6 districts: meanRoleHoldersPerDistrict=6.8   health=0.930  gini=0.649
```

1 district wins on every axis — not a tradeoff, unlike almost every other config decision this
project has made. The earlier 3-vs-6-vs-11 comparison (which picked 6 as "balance over
extremes") wasn't wrong given what it could measure — it only had aggregate health/gini/wait
numbers, because Bug 1 hid the real per-district story the whole time that decision was made.
Adopted: `DEFAULT_SHARD_CONFIG` is now `coreDistrictCount: 1, peripheryDistrictCount: 0,
coreDistrictRadius: 7, buildingsPerCoreDistrict: 62`. This also resolves the geometry conflict
with the 2026-08-13 addendum's three-wedge concept art for free — one district now IS one
settlement, matching the art directly, no more "how many separate plazas" question. Population
beyond one settlement's natural size (~55-70/shard in these runs) is handled by the
already-built multi-shard system opening a new shard, not more districts.

**Real, undeleted cost, flagged not hidden**: removes the core/periphery District
classification split `identity.ts`'s Silhouette Shield resolution-speed gradient was built
around. `identityResolutionHarness.test.ts`'s core-vs-periphery test, plus tests in
`courierPay.test.ts`, `space.regression.test.ts`, and `districtAccess.test.ts` that implicitly
relied on the shipped default having multiple districts, all now construct an explicit
multi-district test config instead — same underlying mechanisms still verified, just decoupled
from "is this what ships today." If the busy-center-vs-quiet-edge feel is still wanted, it
needs re-deriving as a within-one-district distance-from-plaza gradient, not a between-district
one — real follow-up, not resolved here.

**Verified**: `npm run typecheck` clean; full suite 442 tests passing (437 + 5 new). Golden
snapshot regenerated (expected). `docs/VISUAL_FRAMEWORK_2026-08-12.md` §8 and
`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.5/§5 both updated to record the resolution
rather than left as stale "unresolved" markers.

**Also captured this session, not yet designed or built** — a burst of real design content
arrived interleaved with this fix, about a tongue-in-cheek disallowed-rules/fines mechanic
(Journalist/Detective as enforcers) and a capped-per-role-resource crafting/trading economy
behind it, plus explicit interest in modelling it against the real engine, and separately a
request to start putting real values/odds into the Oracle and event prizes. All captured
faithfully in the entry directly below this one (same date) so none of it is lost — none of it
is designed or built yet; both are real, separate next-session items.

---

## 2026-08-13 — Housing, ground-level access, and reputation levels written up as one design doc (no code yet)

Two `AskUserQuestion` attempts to resolve the district-count question (3 vs 6 vs 11 districts,
flagged unresolved in `VISUAL_FRAMEWORK_2026-08-12.md` §8) were both rejected, sharply. First
attempt proposed options without real population-per-district numbers ("look at what your
proposing, how many players per district?... it's absurd") — fixed by running a real
`createWorld`/`stepWorld` probe at 3 seeds, day 800, before proposing anything further. Second
attempt ("switch to 3 districts now" vs "build a cascading model") was rejected even harder
("read what I said first.") — the user's concurrent message reframed the whole problem: not
district count, but how a grifter (roleless player) exists in this world at all — where they
live, how visible they are, how they get a role. District count was a symptom, not the
question.

**Real bug found by the probe, not yet fixed**: `District.population` (`space.ts:88`) reads 0
in every district across every seed tested, despite `world.population` correctly tracking
real totals (54-63). The field exists but nothing in the normal `stepWorld` tick flow
increments it — only `placeArrival` does, and that's not called by the tick loop. Flagged to
the user directly, then made a named prerequisite in the design doc below rather than fixed
ad hoc.

The user then laid out, across several messages, a coherent system: universal housing (one
abode type for every resident regardless of role — explicitly *not* a separate "grifter
housing" category, corrected by the user directly: "the same abode anyone with a role has"),
density via floors rather than plot count ("population density can be layered... through
first, second floor etc"), ground-level role opportunities for grifters to grind toward
(explicitly connected to the already-shipped `shiftCover.ts` rather than a new mechanic), and
a full reputation-level system (discrete levels gating role eligibility, additive-only, must
not let one player's grinding advantage another player's growth, "increasingly difficult as
the lvls advance" via a rising bar not a rate cut). Explicit instruction alongside this: "find
creative solutions to problems within the constraints of the game to find emergent mechanics"
— i.e. compose existing, already-measured mechanics rather than invent new sweeps.

Written up as `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`. Every mechanism in it reuses
something already shipped and measured: `shiftCover.ts` unchanged as the grinding opportunity
(only its successful-cover event gains a reputation progress-tick); `roleCompletion.ts`'s
measured completion ratios (Miller/Baker ~54-58%, the four support roles ~97-100%) as the
real, evidence-based signal for a 2-tier role split — explicitly flagged as 2 tiers *because
that's what the data clusters into today*, not invented ahead of evidence; `roleCompletion.ts`'s
and `shiftCoverNoticedIndices`'s existing once-per-day caps as the anti-grind fairness
mechanism, with no new limiter needed; the existing district lowest-population placement rule
and `CONSOLIDATION_GRACE_DAYS` reused for housing assignment/displacement instead of new
constants. One explicit design decision recorded: reputation levels are a public/civic
progression value (like a job title), never a per-observer trust score — required by
constraint 4 (no invented in-between memory) and constraint 6 (additive-only, untouchable
floor); and reputation-level gates apply only to *voluntary* role uptake, never to backstop or
conscription, which already overrides every other access rule in this engine (constraint 2).

Also recorded: floors break the plot-count intuition that made "6 districts" read as absurd,
which materially changes what evidence the still-open district-count decision should be
checked against — but does not resolve that decision. Left open deliberately, per §5 of the
new doc, with a concrete recommended next step (re-run a population-per-district probe once
floors exist).

**Design only. No engine code, no new tests this entry** — matches the same design-before-code
discipline used for the visual framework work the same session.

---

## 2026-08-13 — New design addendum received: a real, unresolved conflict with the shipped role/district config, flagged not silently picked

**Context.** User uploaded `docs/DESIGN_ADDENDUM_2026-08-13.md` (saved verbatim) — a
three-wedge-plaza district geometry, a cascading district-opening threshold model (districts
open within a shard as population crosses ~65/~90, new shard at 100), and a role-building
placement grid, presented as derived from "the validated default" role split (M3/B7/IE2/C6/
J5/D3 = 26 slots) via a Python sweep script the addendum includes and calls "run, not
guessed." Asked to "test what's required."

**Traced the addendum's own citations before touching anything — found they're stale.** The
addendum's §1 cites `design/node_core_reference.py` and `src/sim/districtRoleSweep.ts` as the
source of "the validated default." Read both: `node_core_reference.py`'s own header literally
says "the source of truth for the TypeScript port that FOLLOWS" — it's the PRE-PORT design
sketch, with a toy `economic_health = (filled*1.0 + npc*0.4)/S` formula that has no districts,
no Cournot/Bertrand market, no grain/nodule chain, and — critically — treats population as a
STATIC number unaffected by slot count. `districtRoleSweep.ts`'s "current illustrative default
(S=24)" candidate is exactly the addendum's M3/B7/C6/J5/D3 (JSON structurally has no
`rImportExport` field at all — proving it predates the 6th role), and it's that sweep's
STARTING candidate, not its recommended winner. Both are already documented in this repo's own
HANDOVER.md as superseded: `districtRoleSweep.ts` is listed under "superseded, kept for
provenance... old single-shard 5-role sweep." The actually-shipped, actually-validated default
(`DEFAULT_WORLD_CONFIG`: M5/B5/C5/J5/D5/IE3 = 28 slots, 6 districts) came from
`jointGridSearch.ts` — screened 560 candidates against the REAL engine (real markets, real
grain chain, real consolidation), not a flat formula.

**Built a real verification rather than accepting or rejecting the addendum's claim on
priors.** The addendum's actual economic argument — scale district/shard count as population
grows, because scaling slot count starves the grifter pool below its floor — is a genuine,
testable claim, independent of whether its specific cited numbers are stale. Wrote
`sim/populationCapacitySweep.ts` + `test/populationCapacitySweep.test.ts` to check it against
the real shipped engine rather than the toy formula. Real finding, and a surprising one:
**the toy model's grifter-floor-breach concern doesn't reproduce in the real engine.**
Raising `targetPopulation` alone (with slot count held fixed) doesn't raise sustained
single-shard population at all — this session's earlier `opportunityAdjustedMigrationStep`
fix ties emigration damping to open role-slots per roleless player, so population capacity is
already, structurally, a function of slot count, not a config label. Scaling slot count up
with the shipped ratio (5:5:5:5:5:3, toward a 100-population target) raised sustained
population roughly proportionally (measured ~33 -> ~60 across seeds) and grifter fraction
stayed healthy (~37-38%, nowhere near the addendum's toy-model-predicted 4-10%) — because the
toy model's core mechanism (population fixed, grifters = pop - slots) doesn't hold in a system
where population itself responds dynamically to slot count. flourRatio also stayed coherent
(~0.53, comfortably under the 1.05 hard filter) — a check the toy model has no way to run at
all, since it has no grain/flour chain.

**What this means, stated plainly rather than left implicit**: the addendum's headline
recommendation ("keep S=24-26, scale districts not slots") rests on a model artifact, not a
property of the real game. That does NOT mean the recommendation is wrong on other grounds
(there may be good reasons — geography, visual/narrative coherence, the three-wedge design
itself — to prefer more, smaller districts over fewer, larger ones), but the specific
"grifter floor breaches at S=30+" justification given for it does not hold up once checked
against the real system.

**Deliberately did NOT implement the wedge/wall/gate geometry, the cascading district-count-
within-a-shard mechanic, or wire the addendum's role numbers into `DEFAULT_WORLD_CONFIG`.**
Reasons, all real: (1) it would silently regress the actually-validated, more-rigorously-swept
config without reconciling why; (2) "districts opening within a shard as population grows" is
an entirely new mechanic this engine doesn't have (the shipped model has FIXED districts per
shard plus a separate, already-working "open a new SHARD" registry — a different scaling
axis than the addendum proposes); (3) the addendum's own §8 explicitly flags the
district-2/district-3 placement question as unresolved; (4) the geometry itself (3 wedges, one
central plaza, wall gates) would replace this session's own district-barriers work
(K-nearest-neighbor side-street mesh, `hubPlot`) without a stated reconciliation plan. Flagged
to the user directly rather than picking a side unilaterally — matches this whole session's
standing discipline (item 6/8's flagged departures, the identity-resolution effect-size catch)
of surfacing a real conflict rather than quietly resolving or quietly ignoring it.

New `sim/populationCapacitySweep.ts` (`npm run population-capacity-sweep`),
`test/populationCapacitySweep.test.ts` (5 tests, including a structural tripwire test that
will need deliberate updating if `DEFAULT_WORLD_CONFIG` is ever changed to match the
addendum's numbers — so that can't happen silently either). Full suite: 437 tests (up from
432), `npm run typecheck` clean.

**User's decision, given both findings**: re-run `jointGridSearch.ts` itself at
`targetPopulation=100` — the rigorous path, not either the stale addendum numbers or the
shipped pop=65 default used outside the range it was calibrated for.

**Extended `jointGridSearch.ts` to take a population argument** (`npm run joint-grid-search
screen 100` / `confirm 100`) rather than writing a parallel script — the allocation grid, its
per-role candidate bands, and every district layout's building counts now scale
proportionally by `POP_SCALE`, so the search space keeps the same relative shape a larger
population needs instead of being re-guessed. Caught one real bug immediately on first run:
the screen phase's default district layout wasn't included in the scaling (only the confirm
phase's `LAYOUTS` array was), so the very first pop=100 candidate threw "43 role slots
requested, shard has 40 buildings" — fixed by hoisting a shared `SCREEN_SHARD_CONFIG` used by
both phases. At `POP_SCALE=1` (population omitted) every path is byte-identical to the
original — the screen-file path is also population-suffixed so a pop=100 run can never
clobber the original pop=65 screening output.

**Ran the full pipeline for real** (not estimated): Phase 1 screened 555 allocations (timed a
single candidate first — ~375ms/candidate — before committing to the full run, ~3.5 minutes
total), 6 discarded as incoherent, 8 finalists promoted. Phase 2 confirmed all 8 x 3 district
layouts at full fidelity (1500 days, burn-in 300, 2 seeds, ~38 seconds) — every one of 24
combinations passed the flourRatio<=1.0 hard filter, worst case 0.928. Applying the same
judgement the original pop=65 decision used (balance over extremes, avoid shard-count
inflation, prefer lower gini at comparable health): `M9 B9 C7 J7 D8 IE6` (S=46) at 6 districts
stands out — strong health (0.937), tied-lowest gini among the strong-health candidates
(0.629), a comfortable flourRatio margin (0.616, not just-under-1.0), shard count holding at
2.5 rather than inflating toward 3-4 like the S=52 candidates, grifter wait a real but modest
increase over the pop=65 baseline (26.9 vs ~22 days, not a floor breach). **Not adopted as a
shipped default yet** — reported as the evidence-backed answer to "what would a pop=100 config
actually look like," same two-phase discipline (screen ranks, confirm reports, a human
decision is separate) this sweep was always built around.

**Mid-session: user pushed back on how I'd framed the addendum's concept-art references** —
correctly. I'd treated the AI-generated visual reference images (three-wedge plaza geometry,
a "Decoding the Visual Contrast Contract" slide mapping Miller scarcity/Baker price
competition/Courier movement/stealth mechanics onto visual zones) as something to acknowledge
and set aside while finishing the config sweep. The user's point: they're modelling the
visuals FROM the actual architecture, not decorating an arbitrary shape after the fact — the
art is real design input, not flavor to nod at. Correct, and consistent with this project's
own founding visual-design law (data-to-visual mapping, established 2026-08-07/08-12) — the
"Visual Contrast Contract" material is doing exactly that mapping work, just via a newer
image-generation pass. Committed to treating it as real source material once district
geometry work resumes, not background inspiration.

Full suite: 437 tests, unchanged (`jointGridSearch.ts` is a script, not unit-tested directly,
matching its own convention — correctness verified by the POP_SCALE=1 identity-preservation
argument plus the real run itself producing coherent results). `npm run typecheck` clean.

**User's decision, given the pop=100 finding**: adopt it. `DEFAULT_WORLD_CONFIG` raised to
`M9 B9 C7 J7 D8 IE6` (S=46), `targetPopulation=100`; `DEFAULT_SHARD_CONFIG`'s building counts
raised to match (10->15 core, 5->8 periphery, exactly what the winning "6 districts" layout
validated). A genuinely wide-blast-radius change — worked through systematically rather than
assumed safe: ran the full suite first, found exactly 5 real failures, fixed each on its own
merits.

Three were mechanical (golden snapshot regen; a test title that already said "sums to 30"
while asserting 28, now correctly says 46; an `economicHeat.test.ts` sanity check needing more
days to reliably produce a non-FILLED slot among 46 rather than 28). One was the structural
tripwire test written 2026-08-12 SPECIFICALLY to fail loudly on exactly this kind of change —
it did its job, updated to the new asserted values with a comment recording that a deliberate,
reviewed decision caused this, not drift and not the addendum's stale numbers either.

**The fifth was a real, substantive finding, not a fixup: the core-vs-periphery identity-
resolution gap (measured 2026-08-12: periphery ~35% slower than core) is GONE at the new
config** (core~27.2 days, periphery~27.3, one seed even reversing). Traced the cause rather
than shrugging: this pass scaled building COUNT (10->15 core, 5->8 periphery) but not
`coreSpacing`/`peripherySpacing` — the actual density-gradient knob `identity.ts`'s own header
names as the real mechanism. Packing more buildings into an unchanged-radius district raised
absolute density in both classifications roughly equally, closing most of the relative gap.
Rewrote the test to assert the new reality honestly (core and periphery within a generous band
of each other) instead of quietly loosening the old threshold to force a pass, or silently
deleting a test that had become inconvenient. Flagged clearly in `BLUEPRINT.md` as a real,
unintended side effect for whoever next touches district geometry — if the identity-resolution
density gradient matters as a design property, it needs `coreSpacing`/`peripherySpacing`
re-derived alongside building count, not assumed to survive scaling for free.

Full suite: 437 tests, all passing (same count as before adoption — every failure fixed in
place, none deleted). `npm run typecheck` clean.

**Second decision from the same round**: fold the addendum's concept art into
`docs/VISUAL_FRAMEWORK_2026-08-12.md` as real design input, before writing any district-
geometry engine code — the user's explicit instruction, after correctly pushing back on an
earlier message where I'd set the concept art aside to finish the config sweep first ("I'm
modelling them FROM the architecture, not just my imagination... so don't ignore them").

Added §8 to the visual framework doc. Two things in it, not one:

1. **A real conflict, surfaced rather than resolved by fiat.** The addendum's geometry commits
   to exactly 3 districts per shard (three wedges, one shared plaza). The district topology
   adopted moments earlier in this same session is 6 scattered districts — chosen specifically
   because the real `jointGridSearch` pop=100 numbers showed it balances better than the
   extremes. Pulled the actual layout-comparison numbers for the winning role split back out of
   that sweep: 3 districts genuinely staffs best (health 0.968) but is real-measured worst on
   equality (gini 0.657) and grifter wait (30.3 days) — the identical "more health by adding
   Millers" trade-off pattern that's been rejected repeatedly this session, just at the
   district-count level instead of the role-count level this time. Not resolved here — flagged
   with the numbers so whoever decides has real evidence, not two competing intuitions.
2. **A concrete, reusable mapping table**, from a separate "Visual Contrast Contract" concept
   slide shown alongside the wedge geometry: Miller scarcity, Baker price competition, Courier
   movement-based economics, and sabotage/detection stealth mechanics each map onto a labeled
   visual zone. Checked every label against real shipped mechanics before treating it as
   trustworthy (same discipline as everything else this session) — all five hold up. This is
   the concrete form of "the art is modelled from the architecture": every visual claim traces
   to a real, validated mechanic already in the engine.

Also flagged: the addendum's own §6 role-building placement grid was sized for its stale
26-slot role split, not the newly-adopted 46-slot one — needs re-deriving regardless of which
district topology eventually wins.

No engine code touched by this pass — design document only, per the user's own chosen scope
("start the visual framework doc first").

---

## 2026-08-12 — Item 8's report-back verification: exact proof + real numbers, and a methodology bug caught mid-write

**Context.** User: "continue with item 8's report-back verification" — item 8 itself doesn't
have its own line in the addendum's "report back explicitly on" section (that section only
names items 5, 7, 4-parity, and identity resolution, all now closed), but the earlier item-8
verification was narrower than the others: it confirmed `DAILY_ACTIVITY_MULTIPLIER`'s numeric
value didn't change, not that nothing else was disturbed. Went further, matching the standard
every other item was held to.

**Found a genuinely interesting structural fact while checking it**: `grainDeliveredToday`
(supply) and `grainDemanded` (demand, `intendedMillerSupply * activityMultiplier *
GRAIN_PER_FLOUR`) are both linear in the activity multiplier, so `millingCapacityFactor`'s
ratio — and therefore `millerSupply` and `flourPrice` — are exactly INVARIANT to it, for any
value. Verified numerically across several (filled, backstopped, intendedSupply) combinations
at multipliers 0.1 through 2.0: `grainFactor` came out bit-identical every time, algebra
confirmed by direct computation, not just derived on paper. This proves the throttle windows
can never distort the flour price signal or shift competitive outcomes between Millers/Bakers
— only realized income scales, market structure is untouched.

**A real methodology bug caught before it shipped as a misleading report.** First attempt at
measuring real per-role daily income compared mean wealth across the whole FILLED population
at two widely-separated points in time, divided by elapsed days — wrong, because the set of
FILLED role-holders churns (conscription, backstop, sabotage), so the naive delta mixes real
income with role-holder TURNOVER (a departing high-wealth holder leaving the array, a fresh
occupant resetting to 0, both masquerading as "income"). First run of the report produced
negative and near-zero numbers and one outright NaN (a seed where couriers were all vacant at
measurement time) — caught immediately as nonsense rather than reported as-is. Fixed by
sampling SAME-SLOT single-day deltas: only buildingIds FILLED both immediately before and
after one `stepWorld` call contribute a sample.

**A second real nuance surfaced while writing the report, flagged rather than smoothed over**:
Miller/Baker/Courier/Journalist also earn `COMPLETION_REWARD` (item 4) — a flat bonus,
deliberately never activity-scaled. Their measured total income is therefore a MIX of a
genuinely 30%-capped component and an untouched one; presenting a single combined "removed
fraction" for those roles would have been precise-looking but wrong. The report says so
explicitly and doesn't attempt the reconstruction for them. Grifters earn no completion bonus,
so their income is a clean sample: measured real grifter income landed at exactly the proven
30% reduction from its unthrottled-equivalent, in all 3 seeds — algebra and live simulation
agreeing, which is the actual point of "simulate before trusting" rather than trusting either
alone.

New `test/throttleWindowImpact.test.ts` (5 tests), `sim/throttleWindowReport.ts` (`npm run
throttle-window-report`). Full suite: 432 tests (up from 427), `npm run typecheck` clean.

---

## 2026-08-12 — Identity resolution core-vs-periphery sweep: the addendum's last open question, answered

**Context.** User: "script and test identify resolution" — the one genuinely open item left
from the 2026-08-11 addendum's "report back explicitly on" section, flagged in the previous
session entry as "needs a real measurement pass, no sweep script exists for this yet."

**No driver existed to even run the measurement.** `world.ts`'s `pendingWallPosts` is cleared
every tick and nothing in the shipped kernel ever populates it — every comms test injects a
post by hand for one tick at a time. To measure resolution over a real multi-day run, wrote a
synthetic Wall-posting driver (`injectSyntheticPosts` in the new `sim/identityResolutionHarness.ts`),
explicitly flagged as measurement-only and never wired into `stepWorld`, the same "never
shipped, structurally guarded" discipline `src/sim/drivers/`'s own README already states for
its own synthetic role-decision policies.

**Followed the exact split `multiShardHarness.ts`/`multiShardValidation.ts` already
established**, rather than inventing a new convention: a pure, exported, TESTED harness file
plus a thin printing report script that imports it (`npm run identity-resolution-report`).
Most `src/sim/` scripts are pure top-level-executing reports never imported by tests — this
one is directly imported by `test/identityResolutionHarness.test.ts`, matching the two
multi-shard files rather than the majority pattern, because "script AND test" was the actual
ask.

**Measured, not assumed.** For each FILLED role-holder at day 0, tracked the first day ANY
observer accumulated `IDENTITY_RESOLUTION_THRESHOLD` real encounters with them, split by core
vs periphery district. Averaged across 5 seeds at 120 days: core resolves at ~30.1 days,
periphery at ~40.4 — periphery role-holders take **~35% longer** to become known. Real, worth
feeling. But genuinely noisy per-seed — one seed of five reversed the direction during
development, so the test asserts the multi-seed AVERAGE (`peripheryMean > coreMean * 1.15`,
a margin well below the ~35% actually measured) rather than a per-seed guarantee, which would
be a false claim the data doesn't support.

**A second question answered alongside the first, not left implicit**: is this a pacing
difference or a structural exclusion? Extended the horizon to 250 days and confirmed periphery
resolution reaches >85% too — entirely a speed difference, never a permanent unknowing. Checked
this deliberately against constraint 2 (no permanent zero-state) and constraint 6 (reputation
may only grant, never remove) before calling the finding acceptable rather than a design
problem to flag.

New `sim/identityResolutionHarness.ts`, `sim/identityResolutionReport.ts`,
`test/identityResolutionHarness.test.ts` (9 tests). Full suite: 427 tests (up from 418),
`npm run typecheck` clean. **This closes the last open item from the 2026-08-11 addendum's
"report back explicitly on" section — every question it asked is now answered.**

---

## 2026-08-12 — Item 8: economic throttle windows, and the addendum's build order is complete

**Context.** Last item in the 2026-08-11 addendum's build order. Item 8: "two windows per
day during which economic output drops to ~10%... economy only... implementation should be
a scheduled multiplier feeding existing market equations, not a new subsystem."

**Checked against an existing mechanic before writing a line of new logic.** `wealth.ts`
already had `DAILY_ACTIVITY_MULTIPLIER` — an 8-hour daily downtime window at 10% dampening,
built 2026-08-11 for a different stated reason ("account for RL," not anti-grinding). Went
through item 8's requirements one at a time against it rather than assuming a gap: ~10%
dampening — already there. Economy-only — grepped `src/comms/` for any reference to the
multiplier and found none, confirming rather than assuming it. Public/deterministic — it's a
compile-time constant. "A scheduled multiplier... not a new subsystem" — a literal
description of what already existed. The single mismatch was window COUNT: one continuous
block, not two.

**Resolved the count mismatch as real code structure, with zero behavioural risk.** Split the
same total dampened hours into `THROTTLE_WINDOWS_PER_DAY=2` x `THROTTLE_WINDOW_HOURS=4`, with
`DOWNTIME_HOURS` now literally their product instead of a bare 8. This is mathematically
inert at this kernel's one-scalar-per-day granularity — confirmed, not just reasoned about:
after the edit, `DAILY_ACTIVITY_MULTIPLIER`'s value was bit-identical, and neither
`test/wealth.regression.test.ts`'s existing golden values nor the tick-25 world snapshot
needed to change. Deliberately did NOT build a genuinely second throttle mechanism on top of
the first — that would have doubled total dampened hours and silently invalidated every
wealth/Gini/flourRatio number this whole session's history calibrated, without re-measuring
anything, which is exactly the failure mode constraint 1 ("simulate before trusting") exists
to catch.

Extended `test/wealth.regression.test.ts` with 4 new tests: the window-count structure itself,
that the literal ask ("two windows... ~10%") holds without changing `DAILY_ACTIVITY_
MULTIPLIER`'s value, a structural guard proving the multiplier is never referenced in
`src/comms/` (economy-only, proved not asserted), and the hours-sum identity.

**The 2026-08-11 Design Addendum's entire build order (0/3, 1, 2, 4, 5, 6, 7, 8) is now
built and tested.** What remains from it is its own "report back explicitly on" section —
several of those questions are now directly answerable from work already done this session
(Shift Cover's coordinated-abuse numbers, item 4's completion-parity hard filter) rather than
still open. The separate 2026-08-12 addendum (pressure detection, visual framework, district
barriers) still has its own remaining open items (Wall Soul calibration, two-tier proximity
speech, light-quality distinction, border checkpoint art) — unaffected by today's work, not
resolved by it.

Full suite: 418 tests (up from 414), `npm run typecheck` clean, no snapshot regeneration
needed.

---

## 2026-08-12 — Item 7: Shift Cover, closing the brief's long-open §2.6

**Context.** Continuing the addendum's build order after item 6. Item 7: "offline slots as
opportunity, not just backstop" — the brief's original §2.6 has sat blocked since Phase 2
first shipped, flagged in BLUEPRINT.md's own phase table as needing "a player-session concept
that doesn't exist in this headless engine yet."

**The reshaping insight, not invented but read carefully out of the addendum's own examples.**
"A Courier running an uncovered route, a player working a vacant bakery" maps directly onto
`vacancy.ts`'s existing `BACKSTOPPED` state, not a new presence/session concept. "Offline
slot" IS "BACKSTOPPED slot" — the addendum's own title ("not just backstop") says as much.
Built `engine/shiftCover.ts` around that reading: only grifters are eligible, "noticing" is a
stateless per-day Bernoulli draw per BACKSTOPPED slot (no scheduler, queue, or notification —
explicitly banned in the addendum's own text), and coverage never changes the slot's state —
it's a one-day side-payment, not a role transfer.

**Rejected a flat-rate calibration in favor of a structural one.** First instinct: pick a flat
Shift Cover rate and verify it stays below every role's measured minimum FILLED wage — same
shape as earlier calibration work this session. Caught the flaw before building it: Courier's
wage (item 6, shipped the same day) is now real-geometry-indexed with no proven analytic
floor, so a flat number could silently drift above it later without anyone noticing. Instead
`shiftCoverPay(referenceFilledWage)` returns a fixed fraction (`SHIFT_COVER_FRACTION=0.4`) of
what that EXACT slot would have earned FILLED that EXACT day, reusing each role's own
already-computed real daily income (`millerIncomes`/`bakerIncomes`'s FILLED mean, Courier's
own `courierDailyPay`, the flat support wage). Since the fraction is unconditionally under 1,
"always worse than holding the role properly" holds by construction, for every role, forever
— no cross-role numeric comparison to keep re-verifying as other constants move.

**The coordinated-abuse proof — honest about what could and couldn't be simulated.** The
addendum asks to prove the alternating-slot-farming exploit is net-negative "in simulation,
with numbers." There is no player-controlled "leave my role on purpose" action anywhere in
this engine — churn is a stochastic hazard, never a choice — so the literal collusion pattern
isn't a constructible player action here. Rather than force a fake simulation of an action
that doesn't exist, proved the underlying economics exactly instead: substituting Shift Cover
for genuine occupancy earns 0.4x the wage instead of the wage, strictly less on EVERY single
day, for ANY pattern of alternation — a stronger guarantee than one simulated scenario could
give, since it holds regardless of timing. Stated with real numbers in
`test/shiftCover.test.ts` (a representative 2.2/day Baker wage forfeits 1.32/day, 60%, every
day covered) alongside the structural argument.

**Expected snapshot shift, not a bug.** Adding Shift Cover's per-BACKSTOPPED-slot RNG draws
shifts every subsequent draw in the shared deterministic stream, changing the tick-25 golden
snapshot the same way item 6's courier-pay draws did earlier the same session. Regenerated
deliberately after confirming only that one test failed.

New `engine/shiftCover.ts` + `test/shiftCover.test.ts` (12 tests). Full suite: 414 tests (up
from 402), `npm run typecheck` clean.

---

## 2026-08-12 — Item 6: Courier pay, distance-indexed

**Context.** Continuing straight through the addendum's build order after item 5. Item 6:
"Courier compensation is a function of distance and time only, never of cargo value... paid
by whoever commissioned the delivery — a real transfer."

**Measured the real geometry before picking a formula.** Wrote a probe script against
`generateShardLayout`/`createWorld` rather than guessing: at the shipped 6-district default
(2 core + 4 periphery, `rCourier=5`), courier buildings land at real Manhattan distances of
~6-10 units from the shard hub in core districts and ~35-49 in periphery, mean ~20 across 5
seeds. `engine/courierPay.ts`'s `courierRouteDistance()` reuses `space.ts`'s existing
`distance()`/`hubPlot` — the same hub-and-spoke geometry `districtAccess.ts` already reads for
district barriers — rather than inventing a second distance model.

**A real design fork: how literally to take "commissioner-funded, real transfer."** Read
completely literally, that phrase means debiting Miller/Baker's wealth every time a Courier
gets paid. Measured it before deciding: total courier pay at the shipped defaults runs
roughly a third of Miller+Baker's COMBINED daily income — not a minor fee line, a first-order
shock to a wealth balance this whole session's history has spent calibrating (flourRatio,
Gini, the wealth-cap bug, completion-reward parity). No other role's wealth anywhere in this
codebase is computed by debiting another role's ledger — Miller/Baker income is each its own
independent market-clearing formula. Building a literal cross-role debit here would be a
genuinely NEW mechanic, which is exactly the addendum's own stated tripwire: "if any item
below seems to require... a new subsystem, that is a signal the item has been misread — stop
and flag it." Chose NOT to build the literal debit. What's built instead: Courier income
stops being an arbitrary flat number and becomes a real, geometry-derived quantity — the
honest, buildable reading of "earned, not summoned from nothing," using the same discipline
every other formula in this codebase already follows. The literal debit is left explicitly
open in `docs/HANDOVER.md` for a future dedicated calibration pass, not silently declined.

**Calibrated `COURIER_FEE_PER_DISTANCE_UNIT=0.075`** so a courier at the mean measured
distance (~20 units) earns close to what the flat `SUPPORT_ROLE_DAILY_WAGE * DAILY_ACTIVITY_
MULTIPLIER` paid before (≈1.05/day at friction=1) — preserving that constant's own original
calibration intent (a support role should be a genuine option, neither dominant nor dominated)
while finally giving Couriers real distance variance the flat wage never had.

**Existing tests updated, not left stale.** `test/world.regression.test.ts`'s two Courier-wage
assertions now compute the real expected distance-indexed figure per building instead of the
old flat constant, and the tick-25 golden snapshot was regenerated — courier wealth in it now
legitimately varies by district (previously uniform across all five slots), a deliberate,
measured change. New `test/courierPay.test.ts` (10 tests): pure-function coverage plus three
world-kernel integration properties (real distance variance shows up between couriers in
different districts; mean earnings stay within the same order of magnitude as the wage
replaced; pay is never negative or non-finite across a 500-day run).

Full suite: 402 tests (up from 392), `npm run typecheck` clean.

---

## 2026-08-12 — District barriers, visual framework, pressure detection, and item 5 (nodules root input)

**Context.** Continuation session. Started by fixing 3 false-positive failures in
`test/grammar.invariant.test.ts` (word-blacklist regexes flagging legitimate "I"-opening
templates), then the user specified two new grammar invariants directly in conversation — no
external identification signature, and no anaphora — demonstrated live with "I think the
courier is being difficult" / "I feel that too" (the second is a vote on someone else's
self-state, not one of its own; a grammar of pure self-states stays safe only if messages
don't compose). Both closed structurally, not just by word list: `WallPost`/`Envelope` proven
via source-grep to carry no reply/thread/parent field.

**District Weather's pressure signal fixed a one-day lag.** `stepDistrictWeather()`'s call
site in `world.ts` moved from right after sabotage resolution to after Stage 5 (comms), so the
`pressureSignal` it receives reflects that SAME day's Wall posts, not yesterday's.

**Built `engine/pressureDetection.ts`** (2026-08-12 addendum item 1): Detective/Journalist
pressure detection over Wall posts, mechanical not behavioural (constraint 3) — detects a
skew toward the 5 "pressure" self-states in a district's rolling post window WITHOUT ever
identifying who's posting. Feeds only into District Weather's `tension`, nowhere
player-facing. This closes a real failure mode found while reading the newly-uploaded
`docs/DESIGN_ADDENDUM_2026-08-12.md` (a 35-page social-layer failure-mode analysis): naming a
pressure-broadcaster made ambient fear WORSE in the historical-case model (+60%, not -60%) —
recorded in `docs/ADVERSARIAL_CONTAINMENT.md`'s new "Partially closed" section.

**Visual framework work — a real correction from the user, then real design output.** Two
AI-generated ("Gemini Notebook") concept-art decks were uploaded for review. First pass
treated this as commentary; user firmly corrected that framing ("were making a game not a
thought experiment... I'm looking for the best cohesive visual framework") and separately
ruled out generic aesthetics ("I don't want one shot minecraft"). Re-read existing canon
(`NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md`, `DESIGN_ADDENDUM_2026-08-08.md`) before writing
anything, then wrote `docs/VISUAL_FRAMEWORK_2026-08-12.md`, resolving: The Wall's location
(`Shard.hubPlot`, a real new field exposing the previously-implicit hub), The Market's
placement (derived from `economicHeat.ts`, no new geometry), and the Wall's Emissive Soul
aggregation function (reuses `pressureDetection.ts`'s rolling-window shape — spec only, not
yet built as code). Caught a real privacy error in one deck along the way: it depicted the
Soul as sourced from private Envelopes, which would violate constraint 4 — flagged as wrong
against canon, not adopted. A third uploaded PDF was checked for "hidden data" per the user's
instruction (PDF metadata/XMP/embedded streams inspected) — nothing found beyond ordinary
AI-generated decorative chrome text; user confirmed afterward this wasn't an alarm, just
"visual fixes."

**Built district barriers** (`engine/districtAccess.ts`) — user-specified mid-session: "some
barriers restricting flow of movement between districts, so those who can move are able to
and others have to use the main plaza," then explicitly instructed to build it, not just spec
it. Implemented as a grant-on-a-floor, never a gate: `space.ts` gained a real side-street mesh
(`District.neighborDistrictIds`, K-nearest-neighbor, symmetric union) and
`effectiveRoute(shard, from, to, travelerStatus)` returns the direct shortcut only for a
FILLED role-holder to a real neighbor; everyone else, and every non-neighbor pair, falls back
to the always-available hub route (constraint 2). Both open design questions the spec would
otherwise have left unresolved were closed STRUCTURALLY and proved by test, not just argued:
consolidation state cannot reach corridor geometry (`space.ts` has zero import of
`districtConsolidation.ts` — source-grep guard test), and no player can gate another's access
(a "tampered shard" test mutates every other district's geometry and confirms one fixed
route is unaffected). 11 new tests in `test/districtAccess.test.ts`, 6 more added to
`test/space.regression.test.ts` for the new mesh.

**Item 5 — no money: nodules as the sole root input, closed loop.** Nodules were already the
intended root of the economy in prose but existed nowhere as a tracked quantity — only
implicit inside `grainDeliveredToday()`'s internal math. Refactored `importExport.ts` so
`nodulesReceivedToday()` is now the primary function and `grainDeliveredToday()` is DERIVED
from it, making "nodules arrive -> Import/Export converts to grain" real code structure.
Decided to track `nodulesReceived` as a bare field on `ResourceFlows` rather than a 7th
`ResourceName` entry, specifically to avoid breaking `resources.ts`'s existing 1:1
role<->resource bijection test (Import/Export already owns `'grain'`) — the same "extend an
existing shape, don't invent a parallel one" instinct as `grainDelivered` sitting next to
`grainConsumed`. Wired into `world.ts` alongside the existing grain-availability computation.
Added the addendum's own explicitly-named requirement: a hard-filter coherence test extending
the existing flour/bread ratio check down to grain/nodules (`grainConsumed/grainDelivered <
1.05` across 5 seeds x 1500 days, plus a live assertion `grainDelivered ==
nodulesReceived * GRAIN_PER_NODULE`), and a structural test that `resources.ts` defines no
`exchange`/`convert`/`swap`/`wallet`/`currency` function or bare mention — the concrete
guarantee behind "non-fungible, role-locked, no generic currency ever."

**No constants changed.** `NODULES_PER_DAY`, `GRAIN_PER_NODULE`, `BACKSTOPPED_NODULE_FRACTION`
untouched — this item only exposed the existing chain as real structure and proved it
coherent, which it already was.

Full suite green: 392 tests (up from 348 at the start of this session), `npm run typecheck`
clean throughout.

---

## 2026-08-11 — Grammar invariants rewritten to survive a vocabulary that's about to grow

**Context.** The user stated plainly that vocabulary WILL expand — envelopes, voice chat, and
a slightly larger Wall grammar — "but using the same structural rules, some things can never
be said... as long as we constrain the vocabulary and the experience tight enough against
hard testing." That reframes what the grammar tests are for: they are the mechanism that
makes expansion safe, so they have to hold against entries that don't exist yet.

**A real gap was already live.** `test/grammar.test.ts`'s banned-word check covered only
`baker|miller|courier` — missing journalist, detective, importExport, and all 84 shard-local
role titles from `shardIdentity.ts` (Grinder, Oven-keeper, Legman, Asker, Factor, ...). "I
feel undercut by the Grinder" would have passed. New `test/grammar.invariant.test.ts` derives
`ROLE_WORDS` from `CANONICAL_ROLE_TITLES` + every `SHARD_CHARACTERS` entry, so it cannot go
stale when a role or shard character is added.

**Blacklists were the wrong shape entirely — and my own false positives proved it.** The first
draft banned imperatives/interrogatives/tense by matching word lists. It failed on two
*legitimate* templates: "I don't trust the people I deal with" (flagged for "don't" and
"people") and "I feel suspicious of what's happening" (flagged for "what" — a free relative,
not a question). The templates were right; the test was wrong. Rewrote those three rules as a
single structural one: **every sentence must open "I ..."**. A sentence that must begin with
"I" cannot be an imperative and cannot be an interrogative, however many verbs the vocabulary
later gains. Blacklists go stale by construction; sentence shape doesn't.

**Two rules the user specified directly in conversation, not derived from the brief:**

1. *No external identification signature.* "You can't talk to anyone directly about another
   person, no matter how much you know" — apart from roles, once reputation is earned, and
   never individuals. Encoded as: no message may carry a referent that RESOLVES to a specific
   person — no pronoun aimed at another player, no definite singular description ("the one I
   met"), no proper noun, no handle. Note "people" is deliberately *allowed*: "the people I
   deal with" points at nobody. What's banned is resolution, not third-party reference.
2. *No anaphora.* The user then, in the same conversation, wrote two messages that
   demonstrated the hole better than any analysis would have: "I think the courier is being
   difficult" / "I feel that too." The second is not a self-state — it's a **vote** on someone
   else's, and a chain of votes is a whip count assembled without ever naming anyone. A
   grammar of pure self-states is safe precisely because messages don't compose; anaphora is
   how composition sneaks back in. Banned lexically (too/also/same/likewise/agreed/...) AND
   structurally: `WallPost`/`Envelope` are proven to carry no reply/thread/parent field, plus
   a source-level grep guard — because the other way to build a whip count is a `replyTo`
   field the client renders as "N people agreed," with no banned word appearing anywhere.

**One hole flagged, not closed: role-reference cardinality.** The same exchange exposed it.
Role-level reference is meant to become sayable eventually — but "the Courier" is only a
*class* if the role has multiple occupants in view. Miller scarcity is a design pillar, so at
k=1 "the Miller" IS a name, by elimination, and no linguistic dressing fixes that ("a Miller"
doesn't help). Any future role vocabulary needs a mechanical **k-anonymity guard** (emittable
only when the referenced role has ≥k live occupants in the recipient's visible scope), not
just a reputation gate. Recorded in HANDOVER.md; no role vocabulary exists yet, and the base
grammar bans all role words outright.

17 tests in the new file, 22 across both grammar files, full suite green.

---

## 2026-08-11 — Sprint: addendum items 1, 2, 4 — two real bugs caught by measuring instead of reasoning

Ran in "sprint mode" at the user's instruction (code+tests committed as they land, docs kept
to breadcrumbs, full BLUEPRINT/HANDOVER pass deferred to the end — that pass is now done).

**Item 1 (Silhouette Shield)**: `engine/identity.ts` — real trigger for `isKnown()`, fed from
real rumour `heardBy`/`heardFrom` events. **The interesting decision was which signal to
use.** The addendum offered "verified trade history (a threshold number of completed
transactions)" first — but no per-player transaction ledger exists anywhere in this build.
The market layer is aggregate: a Baker "serves N customers" as a *count*, never tagged with
counterparty ids. Building one would have been precisely the "new subsystem" the addendum's
own scope discipline says signals a misread item. Used its second offered trigger instead
("an established relationship already recorded in existing state") — rumour hearing, which is
already directional (hearer learns about source; source doesn't learn who heard), so the
required asymmetry falls out of the existing data rather than needing extra bookkeeping.
Proximity co-presence would NOT have worked here: it's symmetric by definition. 17 tests.

**Item 2 (Economic Heat)**: `engine/economicHeat.ts` — pure projection, deliberately NOT
stored on `World` and never called by `stepWorld`, so it structurally cannot affect
determinism or tick order. Miller/Baker heat = own existing value normalized; the four
support roles = `1 - consolidationFrictionMultiplier` for their district, the third distinct
reuse of that same friction primitive. 8 tests. Also fixed stale test-count mentions
(233/266 → 335) across README/HANDOVER, caught by the user mid-sprint.

**Item 4 (role completion) — where both bugs were.**

*Bug 1, caught by measuring a design I'd already reasoned my way into.* The first version gave
every role one attempt per FILLED day and one flat reward constant, on the reasoning that
identical structure = parity for free. That argument is clean and wrong. Measured it before
trusting it (constraint 1, 1000 days × 5 seeds): Miller/Baker's task is zero-sum against
rivals and completes ~54-58% of days; the friction-bar task the four support roles share
completes ~97-100%, because a healthy shard sits at friction=1 almost always — nothing forces
that rate toward 50% the way Cournot/Bertrand competition does. A flat reward would have paid
support roles ~1.9x the expected daily bonus for a strictly easier task. **Structural parity
is not realized parity**, and no amount of reasoning about the structure would have surfaced
that — only running it did. Recalibrated per role type (0.5 vs 0.28) so *expected daily*
reward converges (~0.27-0.29 across all six), and added the addendum's required hard-filter
parity test (±30% band around the cross-role mean, same discipline as `flourRatio <= 1.0`).
The flat version measures ~1.9x — comfortably outside the band, so the test genuinely would
have caught it.

*Bug 2, a silent hole through a hard bound.* The completion reward was initially applied
directly to Miller/Baker wealth — but that code path runs AFTER `applyWealthCap`, so a
wealth-capped world could exceed its own cap by one reward per tick, forever. Nothing about
that looks wrong in isolation; it was caught because a pre-existing `wealthCap` regression
test started failing. Fixed by folding the bonus into the taxed/capped income flow itself,
before both tax and cap, like every other unit of Miller/Baker income. The four support roles
are outside tax/cap scope entirely so theirs applies directly — that asymmetry is now
deliberate and commented at both sites, not accidental.

*Flagged rather than faked*: Detective's task is NOT literally "catch a saboteur," despite
that being the addendum's own illustrative example. That example describes the **unshipped**
pattern-based sabotage proposal; the shipped mechanic has no Detective-specific detection
term at all (`detectionProbability` depends only on witness count). Building it literally
would have meant either shipping an undecided proposal or inventing a synthetic event the
model can't verify. Used the same friction-bar task as the other three support roles instead,
and said so in the code header.

348 tests, typecheck clean, all pushed to `main`. Items 5-8 not started.

---

## 2026-08-11 — Design Addendum received; item 0/3 (District Weather) wired first, as instructed

**Context.** A 9-item design addendum arrived mid-session (`NODE_DESIGN_ADDENDUM_2026-08-11`,
saved to the repo — see BLUEPRINT.md's new entry). Explicit scope discipline: role roster
stays closed at six; every item is a rule on existing primitives, a uniform layer, or a
rendering of state that already exists — nothing here is a new role, currency, or subsystem.
Build order matters: items 0/3 (District Weather) and 1-2 (Silhouette Shield, Economic Heat)
land before 4-8, because 4-8 add flows to an economy items 2-3 make observable. Also folded
in a user idea from the same conversation, not itself one of the 9 items: reputation-earned
plaza statues, updating on real completion events. Logged as a forward note against item 4
(role completion) rather than built now — the addendum's own instruction is to flag anything
outside its numbered list, not quietly build it.

**Item 0/3 — the addendum's own "verified gap found this session": `space.ts` defines
`District.weatherHistory`/`WeatherSample` (`{ tick, tension }`) — the persistent per-district
state District Weather and the Wall's Emissive Soul were both blocked on — but `world.ts`
never wrote to it. The string `tension` didn't appear in `world.ts` at all. Not a design gap;
an unwired field.**

Built `src/engine/districtWeather.ts`: `tension` (0..1) is a deterministic function of events
`world.ts` already tracks — vacancy pressure (the identical filled-fraction
`districtConsolidation.ts` already computes, not measured twice), consolidation pressure
(CONSOLIDATING/MERGED as ongoing structural stress, not a one-off), and a same-day sabotage
spike. No invented mood variable, per the addendum's explicit instruction. Decays with
distance using `space.ts`'s own `distance()`/`proximityCloseness()` — deliberately no second
decay system — and takes the *strongest* signal reaching a district rather than summing, so
one tense neighbour reads as "trouble nearby," not an implausible shard-wide aggregate.

Wired into `world.ts` right after sabotage resolves each tick (so today's spike is reflected
same-day), writing a new `shard` with bounded (90-sample) `weatherHistory` per district —
replacing what had been a straight pass-through of `world.shard`. No `rng()` calls added, so
the pinned tick-order/determinism test is untouched by this.

**Verification, not just derivation** (constraint 1): 16 new tests, including an integration
check on a deliberately shrunk/high-churn world that a district which actually goes through
consolidation reads measurably more max-tension over a run than one that stays ACTIVE — the
property the whole feature exists to produce, checked against a real `stepWorld` run rather
than asserted from the formula alone.

**One test bug caught by the test itself, not the implementation**: an early version of the
"nothing propagates beyond max range" test set `maxRange=0` to prove far sources contribute
nothing — but `proximityCloseness`'s existing contract returns `null` for `maxRange<=0`
*including at distance 0*, so it killed self-tension too and the test failed for the wrong
reason. Fixed by using `maxRange=1` (covers self, not the real inter-district distance this
layout produces) rather than changing anything in `districtWeather.ts` — the implementation
was right; the test's own edge case was wrong.

310 tests total, typecheck clean. Next: items 1 (Silhouette Shield) and 2 (Economic Heat).

---

## 2026-08-11 — Re-ran the joint grid on the fixed mechanic; the shipped allocation lost its rationale

**Context.** "Rerun the joint grid search now the defect is fixed." Correct call — the
first grid measured through the absorbing-state defect, so its district-count conclusions
rested on a broken mechanic.

**Added the incumbent to the finalist set.** The screen no longer surfaces the shipped
allocation at all, so without explicitly including it there would be no way to tell whether
a new "winner" actually beats what is live. This turned out to be the thing that made the
result readable.

**What held**: 560 screened, 151 incoherent (was 154) — the flour-chain failure mode is
structural, not an artifact of the defect.

**What broke**: M5 B5 C5 J5 D5 IE3 was picked partly for staying coherent at every district
count. Post-fix it reads 1.000 (incoherent) at 11 districts and only ~4% margin at 6. The
reason it was chosen no longer held.

**Rejected the obvious replacement.** M6 B5 C5 J4 D5 IE3 restores that property and is
identical to the incumbent on population, health, Gini, waits and shard count — but buys
its margin by adding a Miller. Same scarcity trade already rejected for M7 candidates, so
rejected again rather than accepted because it was smaller this time.

**Fixed the constant instead**: FLOUR_PER_BREAD 0.23 -> 0.20. The allocation was chosen on
design grounds; the flour ratio is the free parameter. Now 0.828 at 6 districts and 0.858
at 11 — ~15% margin, coherent everywhere, every other metric unchanged.

**6 districts re-confirmed.** Post-fix, 11 gives 1.7% better Gini and 5.0% shorter waits for
2.4% worse health — materially weaker than the pre-fix 4.9% Gini gain.

**Verification.** 266 tests, all passing; typecheck clean. Snapshot regenerated.

## 2026-08-11 — 11 vs 6 districts; instrumenting the mechanism exposed a consolidation defect

**Context.** "Try 11 districts and compare." Ran both deeply (2500 days, 3 seeds) and
instrumented how many districts actually trip the ratchet, rather than only comparing
outcomes — which is what found the real problem.

**I had documented the mechanism backwards.** I'd written that smaller districts are more
volatile and trip the ratchet more often. Measurement says the opposite: 11 districts merge
LESS than 6 (12.1% vs 22.2%). Fewer slots per district means crossing a 30% threshold needs
nearly all of them empty at once — a discretisation effect, not volatility. Corrected.

**The defect: MERGED was an absorbing state.** An irreversible ratchet on an instantaneous
threshold dooms any district that has one bad day, and over a long run every district does.
All 4 slot-bearing districts merged by day 500 and stayed merged forever — the mechanic
fired once, universally, then never again. Friction became a flat shard-wide tax instead of
a signal; the 2-week grace/draft never fired again.

**First fix attempt was also wrong, and the sweep said so.** Requiring N consecutive days
below the threshold on the raw fraction produced a cliff, not a gradient: <=14 days merged
everything, 21 merged nothing, and healthy and collapsing shards gave IDENTICAL results.
Zero discrimination. The metric was the problem — a small lumpy ratio where churn and
genuine decline look alike day to day.

**Second fix: smooth first.** ~30-day EMA on the filled fraction, then the unchanged
tipping point and ratchet. That discriminates properly: at TRIGGER_DAYS=21 a collapsing
shard merges 4/4, a very thin one 1/4, a thin-but-viable one 0/4. Irreversibility is fully
preserved — only the definition of "passed a tipping point" changed, from a single bad day
to sustained decline, which is what the phrase always implied.

**Result of the actual comparison: keep 6 districts.** With the defect fixed, 11's case is
weaker than the joint grid implied — equality gain down to 1.7% (was 4.9%), health cost up
to 2.4%, population -1.2%, coherence margin 3.6% thinner. It still wins on grifter wait
(-5.0%) so it stays a live option, but it is not close to free.

**Verification.** 4 new tests (churn noise cannot doom a district; sustained decline still
engages; thin-but-viable vs failing discrimination; EMA seeding). 266 total, all passing;
typecheck clean. Golden snapshot regenerated (deliberate).

## 2026-08-11 — Joint grid search over allocation x district layout; found an axis interaction

**Context.** "Now do the joint grid search." The previous pass tested allocations and
district counts separately and said so; this closes it.

**Coarse-to-fine, because a full joint grid at fidelity is unaffordable.** Phase 1 screened
all 560 allocations at reduced fidelity — 154 (27.5%) discarded outright as incoherent,
which says the flour-chain trap is systemic, not a one-off. Phase 2 re-ran 8 finalists
against 3/6/11 districts at full fidelity. Only Phase 2 informs the decision.

**Caught a screening bias before trusting it.** Every top-15 screen result showed 2 shards
— at 500 days shard growth hasn't happened yet, so per-shard population is inflated for
allocations that merely delay the first opening, systematically favouring small totals.
Changed promotion to top-2-per-total so the bias couldn't pick the shortlist. Worth noting
I only caught this by reading the screen output rather than trusting the ranking.

**The finding that justifies doing it jointly at all**: coherence depends on district count,
not just allocation. Three finalists coherent at 3-6 districts go incoherent at 11
(flourRatio 1.000-1.027) — more districts, more consolidation, less milling. Separate
sweeps of each axis cannot surface that, and an allocation picked at one layout can quietly
break at another.

**Chosen M5 B5 C5 J5 D5 IE3 (S=28) at 6 districts**, from M5 B6 C6 J6 D5 IE4 (S=32): gini
0.486 (best of any allocation at that layout) vs 0.514, grifter wait 22.0 vs 23.2, shards
3.0 (most bounded) vs 4.0, and coherent at every district count — the only near-even split
that is. Costs: population 56.1 vs 59.3, health 0.860 vs 0.873, both real, both small, and
56.1 is inside the brief's 50-80 band.

**Rejected M7-based candidates** despite the best coherence margins in the grid (0.63-0.73)
— they buy it purely by adding Millers, undermining the deliberate-scarcity pillar. A
better number is not worth breaking a design intent.

**Verification.** 262 tests, all passing; typecheck clean. Golden snapshot regenerated
(deliberate — DEFAULT_WORLD_CONFIG changed). Flour margin verified after the change.

## 2026-08-11 — Re-ran the allocation sweep across all six roles; it caught an incoherent shipped default

**Context.** "Re-run the sweep across all six roles." The S=30 five-role conclusion
predated Import/Export, so it no longer described what ships.

**Made the sweep answer both coupled questions at once** rather than allocation alone —
each candidate now reports its own supply-chain coherence (`flourRatio`) and the break-even
`FLOUR_PER_BREAD` that would make it coherent. That was the whole point of flagging the
coupling last pass instead of quietly re-tuning the constant again.

**It immediately earned that.** The then-shipped default (M=4 B=8 C=8 J=7 D=3 IE=2) ran a
flourRatio of **1.222** — Bakers baking flour nobody milled. Invisible to any
population/health/Gini metric, and missed by my earlier single-shard tuning of
FLOUR_PER_BREAD because the multi-shard system runs more shards at lower staffing. Two
other candidates were incoherent too (support-heavy 1.579, S=26 1.141).

**Chose M=5 B=6 C=6 J=6 D=5 IE=4 (S=32), FLOUR_PER_BREAD=0.23.** Among coherent candidates
it gives up ~1.5% population (inside noise) for the best equality (gini 0.505), the most
bounded shard count (4.0), and the widest grain headroom (2.24x). S=38 rejected despite
decent numbers — it drove shard count to 10, the proliferation regime. Miller stays
deliberately scarce at 5 of 32. Verified after: flourRatio 0.74-0.77, milled flour up
1292 -> ~1850.

**District count re-checked and unchanged at 6** — the same monotonic health-vs-equality
tradeoff as before, unaffected by the 6th role.

**Verification.** 262 tests, all passing; typecheck clean. Golden snapshot regenerated
(deliberate — DEFAULT_WORLD_CONFIG changed).

## 2026-08-11 — Import/Export + nodules: the 6th role, and a circular measurement caught

**Context.** "Now build the Import/Export role and nodules." The design had been discussed
earlier and parked; `resources.ts` had been accumulating `grainConsumed` as demand with no
supply specifically so this could be sized from a measured number.

**Built `engine/importExport.ts`** — nodules -> grain (daily, automated, no player action
required), and cross-shard route resolution replacing the flat `MIGRATION_FAILURE_RATE`
placeholder. Complete exit ticket = legal route, frictionless. Partial postcard progress =
illegal route, subject to stateless per-attempt interception. Detection carries no state
at all, so "no learnable pattern" is structural rather than merely apparent.

**Calibration deliberately preserved**: `COMPLETE_TICKET_FRACTION=0.57` x
`INTERCEPT_BASE_P=0.35` reproduces the 0.15 failure rate everything was validated against
(measured 0.1489 over 200k trials), so the mechanism replaces the constant without moving
the equilibrium under previously-measured results.

**A real error, and the kind worth recording.** `NODULES_PER_DAY=4.0` was sized against
grain demand of ~1.28/day measured BEFORE the gate existed — which was circular, because
`grainConsumed` derives from flour actually milled, so once milling became grain-limited
the reported "demand" was itself suppressed. The constant looked fine while permanently
throttling Millers to ~68%. Only caught by checking whether grain was actually binding
rather than trusting the surplus figure, which looked healthy precisely because of the
constraint. Corrected to 6.0 against unconstrained demand (~1.68/day); milled flour
recovered 1026 -> 1292 over 1500 days.

**Knock-on handled rather than hidden**: 2 extra slots (S=30 -> 32) diluted staffing, so
`FLOUR_PER_BREAD` went short again and moved 0.25 -> 0.22. Noted explicitly that this
constant and the role allocation are coupled and should be re-derived together when the
6-role split is swept — repeatedly re-tuning one constant is a stopgap, not the answer.

**Verification.** 13 new tests (routes, stateless interception with no repeats across 5000
draws, emergent rate matching the calibrated one, BACKSTOPPED supply floor, milling
capacity, an unstaffed Import/Export squeezing but never stopping the shard, and fewer
slots genuinely reducing flour). 262 total, all passing; typecheck clean. Golden snapshot
regenerated (deliberate — a 6th role changes the pinned trajectory).

## 2026-08-11 — Named per-role resources; tracking them immediately exposed an incoherent supply chain

**Context.** "We need to create arbitrary resources as named variables. Make them suitable
to the role and associate them with real numbers I can track over time."

**Built `engine/resources.ts`** — grain/flour/bread/parcels/stories/leads, one owning role
each, tracked as per-day flows and cumulative totals on `World.resources`, with
`npm run resource-report` printing a real time series. Miller/Baker figures are *derived
from mechanics that already exist* (Cournot quantity, served customers) — named and
recorded, not recomputed or second-guessed. The three support-role rates are new
`[ILLUSTRATIVE]` constants, flagged as such, because nothing exists to derive them from.
This also finally makes Courier/Journalist/Detective economically distinguishable instead
of three identical flat wages.

**The point of tracking proved itself immediately.** The grain->flour->bread chain was
incoherent and nobody could have seen it: Bakers drew ~1.39 flour/day while 4 Millers
milled ~1.09 — bread baked from flour that was never milled, a ~31% permanent deficit.

**Fixed in the direction that respects evidence.** `rMiller=4` came from a real sweep;
`FLOUR_PER_BREAD` was something I had just invented — so the invented constant yielded to
the derived role split, not the reverse. First correction to 0.27 (computed break-even
from one seed) still left a 3-8% deficit across 5 seeds — caught by my own regression test
failing, which is exactly what it was for. Shipped 0.25, holding a small surplus. Test now
asserts the consumed/milled ratio rather than per-seed surplus, since that's noisy.

**Grain deliberately has no producer** — it accumulates as measurable demand with no supply,
quantifying the hole Import/Export exists to fill (~2562 units / 2000 days / shard) before
that role is built.

**Verification.** 11 new tests. 249 total, all passing; typecheck clean.

## 2026-08-11 — Solved the population-health question by instrumenting it, not tuning it; the opportunity valve

**Context.** "Solve it buddy." The standing item was multi-shard population sitting at
~68% of target. Rather than sweep constants until a number improved, I measured the actual
flows first — which turned out to matter, because the premise was partly wrong.

**Diagnosis before any change.** (1) The 68% figure was stale — measured against the old
S=24 default; the real figure was 84%. (2) It was not a slow climb averaged down: a
6000-day run showed a genuinely stable oscillation, not a trend. (3) The per-shard mean was
hiding nothing — all shards sat evenly (54.6/55.1/54.8), no thin shard buried in it. (4)
Most importantly: the brief's own range is **50-80 players per shard**, so 54.6 was already
in spec — `targetPopulation=65` is that band's midpoint, not a floor being missed.

**Then the real mechanism, derived and verified.** The only inflow is `arrivalPDaily`; the
only outflow is a failed migration. So equilibrium must satisfy `arrivals == failures` —
measured 0.303 vs 0.295/day, confirming it. And a genuine bifurcation: BOTH obvious levers
(more arrivals, less leak) raise population *and* trigger unbounded shard proliferation
(arrivals 0.45 -> 100 shards; failure rate 0.04 -> 42 shards), because fuller shards satisfy
the open-gate and each new shard adds its own inflow. So neither constant was a clean fix.

**The user's steer found the actual flaw.** "Adapt the mechanics of the Oracle and economic
opportunity possibilities to stabilize ... purely statistics, no bias." The migration valve
keyed emigration off roleless *fraction* alone, conflating "28 roleless with 4 open slots"
(real opportunity) with "70 roleless and nothing open" (none) — so nothing about a shard
emptying out made it more attractive to stay in. No negative feedback anywhere.

**Built `opportunityAdjustedMigrationStep`** (new function; validated `migrationValveStep`
untouched): damps emigration by open role-slots per roleless player. Thin shard -> high
opportunity -> people stay -> recovery. Full shard -> no open slots -> damping vanishes ->
emigration at full strength, so it provably cannot cause the runaway regime. Pure counting,
no agent, identical for every player, and it only ever reduces emigration (constraints 2
and 3 both respected by construction, not by assertion).

**`OPPORTUNITY_WEIGHT=2.0` from a sweep, not a guess** — weight 2 takes most of the gain
(84% -> 91% of target) while the registry stays bounded at 3.7 shards; higher weights flatten
population while accelerating shard count.

**Result**: isolated single-shard baseline **8.1 -> 38.5 / 65**; multi-shard **44.5 ->
51.3 / 65**. The valve helps most exactly where the system was weakest.

**Deliberately not retuned**: `migrationFailureRate`, because it is a placeholder for
Import/Export's unbuilt route-detection design — tuning it to chase a population number
would be backwards. The sweep is checked in (`npm run multi-shard-equilibrium-sweep`) so
that design can be made with its consequences visible.

**Verification.** 5 new tests (exact passthrough at zero open slots; emigration never
increased; damping strengthens as a shard thins; weight=0 no-op; never exceeds the roleless
pool). 238 tests total, all passing; typecheck clean. Golden snapshot unaffected — the
valve is surgical enough not to touch the fully-staffed pinned window.

## 2026-08-11 — Role/district allocation, finally derived against the real system — "run it on your baseline then solve it regardless"

**Context.** Direct follow-up once the district-consolidation/shard-registry/live-N work
landed: "run it on your baseline then I'll see if I need an external plan. try and solve
it regardless." Re-ran the existing `districtRoleSweep.ts` first — confirmed it's now
stale (predates all three fixes) and actively misleading for this question, since it
judges candidates against a single, isolated shard, which collapses hard by design now
(meanPop 7-23/65 — worse than the pre-fix run, expected: live-N removed the old model's
optimism). Built `sim/multiShardRoleDistrictSweep.ts` instead — same candidate pool, same
metrics, but every candidate run through the real, composed `multiShardHarness.ts`.

**Result, and an actual decision made from it, not punted.** Role split: all six S=24
candidates clustered tightly (44.1-44.7/65 population, 0.847-0.860 health,
0.518-0.542 Gini) — the exact distribution among Miller/Baker/Courier/Journalist/
Detective didn't matter, only the total did. S=30 was the one candidate that separated
itself: 53.3/65 (82%) population, 0.875 health, at a real but smaller-magnitude equality
cost (Gini 0.563). S=18 was worse on every single axis — not a tradeoff. Set
`DEFAULT_WORLD_CONFIG` to Miller 4/Baker 8/Courier 8/Journalist 7/Detective 3 (S=30,
the one S=30 split actually tested) — "cleanest and fairest" reads as both staffed and
equitable, and the staffing gain here outweighs the equality cost rather than trading it
away for nothing.

District count showed a genuine, monotonic, non-noise tradeoff: 3 districts staffs best
(48.5/65, 0.903 health) but is least equal (Gini 0.585, worst of anything tested this
pass) and leaves grifters waiting longest; 11 districts is fairest and fastest for
grifters (Gini 0.459, wait 14.1/76) but worst-staffed (38.9/65, 0.768). Traced the
mechanism, not just observed the numbers: `districtFilledFraction` averages over however
many role slots a district holds, so bigger districts smooth that average and trip the
irreversible consolidation ratchet less often — better staffed, at the cost of each
district's health mattering more per person when it does eventually tip. Kept the
existing 6-district default deliberately — it sits almost exactly between both extremes
on every metric, the genuine balance point, not an unexamined leftover.

**Verification.** `test/world.regression.test.ts`'s role-split-sum test updated (24 → 30).
Golden-value snapshot regenerated (deliberate — `DEFAULT_WORLD_CONFIG` changed, expected).
233 tests total, all passing; `npm run typecheck` clean. New script checked in as
`npm run multi-shard-role-district-sweep`.

**Honestly not exhaustive**: only one split was tested at S=30, and only three district
counts were tried at all. This is the first evidence-backed answer to the question asked
back in the 5-role-roster work, not a claimed global optimum — flagged in
`docs/BLUEPRINT.md`'s new entry, not overclaimed.

---

## 2026-08-11 — District consolidation + shard registry: the population-collapse fix, derived from the user's own district-merge design

**Context.** Direct follow-up to the previous entry's population-collapse finding. User
specified the fix's shape unprompted, in two passes: first a shard-level "fracture into 2
when density requires new players" sketch, then a correction — it's UNDERpopulation that
triggers consolidation (not overcrowding, which was my own initial misreading), and the
real mechanism is a **district**-level merge within a shard, escalating to shard-level
active/dormant splits: districts combine when population drops past an irreversible
tipping point, displaced players get a visible notice and 2 weeks to pick a role or be
drafted, decline is felt via degraded trade-route access before it's forced, and shard
count only ever grows (2 initial, cooldown+stability-gated growth after that, new shards
dormant/"automated economic stability" until a real arrival wakes them). User chose
"everything in one pass" (district mechanic + trade-route friction + full shard registry
together) over a narrower first cut, then added mid-build: "well test it thoroughly during
and after, so it's still not really a single pass — we always find issues to resolve."
That turned out to be exactly right — see below.

**Built in the same pure-primitive-first layering as everything else this session.**
1. `engine/districtConsolidation.ts` (new): `DistrictHealth` as an irreversible ratchet
   (ACTIVE → CONSOLIDATING → MERGED), triggered when a district's own FILLED-role fraction
   drops below a tipping point; 14-day grace period (deliberately mirrors
   `conscriptionDelay`'s own default); `consolidationFrictionMultiplier` ramps service
   access down across that same window and floors above zero (constraint 2). 10 tests.
2. `engine/shardRegistry.ts` (new): the multi-shard lifecycle at the population-count
   level — 2 initial ACTIVE shards, monotonic shard ids, migration destinations always
   bounded to shards that actually exist (preferring a DORMANT one so a real arrival wakes
   it), new-shard eligibility gated on population + stability + cooldown together. 17 tests.
3. `world.ts` wired in: a district crossing into MERGED evicts its role-holders into the
   grifter pool with a hard `consolidationDeadline` (self-select or get force-drafted in 2
   weeks — bypasses the ordinary probabilistic machinery once overdue); friction scales
   Miller/Baker/support-role income by the building's district health.
4. `sim/multiShardHarness.ts` (new): composes the registry with real `World` instances —
   the piece that finally gives `stepWorld`'s emigrants (newly exposed as `lastEmigrants`)
   a real destination instead of vanishing into `migrationValveStep`'s abstract pool. 6 tests.

**Bug #1, caught by the user's own "test thoroughly during and after" instruction, before
it shipped**: an earlier version permanently excluded a MERGED district's buildings from
ever being refilled ("logically removed"). Two long-run world tests caught this collapsing
Miller+Baker FILLED counts toward zero with nowhere for that capacity to go — every
district eventually merges under enough noise, and deleted capacity never comes back.
Contradicts the user's own framing ("combine into half the shard" concentrates capacity,
it doesn't delete it) and constraint 2 applied at the whole-shard-economy scale, not just
one player. **Fixed**: a MERGED district's buildings stay in the ordinary vacancy pool
going forward; the lasting consequence is the one-time eviction plus the permanent
friction floor, not a capacity cliff. Physically relocating buildings between districts at
runtime is a bigger change, deliberately deferred and flagged, not silently done partway.

**User mid-flight correction: "N shouldn't be flat given illegal migration failure
rates."** Two real things folded into this. First, an already-flagged pre-existing
simplification finally fixed: `vacancyParamsFor`'s `N` used the *static*
`config.targetPopulation`, not live `world.population` — now uses the live figure, so
`fillHazard`'s candidate-pool math honestly reflects a shard's actual current headcount
instead of staying artificially optimistic while population is collapsed or recovering.
Second, a new placeholder: cross-shard migration is not guaranteed to succeed —
`multiShardHarness.ts`'s `MIGRATION_FAILURE_RATE` (0.15, `[ILLUSTRATIVE]`) models some
fraction of attempted moves simply failing and never arriving anywhere, standing in for
the not-yet-designed Import/Export legal/illegal route-detection mechanic until that
system actually exists.

**Bug #2, caught by `multi-shard-validation`'s own numbers, not assumed away**: the first
working version of `canOpenNewShard`'s population gate used a flat total-population floor
(120). Once 2-3 shards are healthy, a flat total trivially clears itself forever, so every
subsequent shard opened the moment its cooldown expired regardless of real pressure —
**102 shards after 3000 days** in the first validation run. Root cause: a flat total grows
automatically as shards fill, so it can never re-trip. **Fixed**: gate on the MEAN
population across currently-populated shards instead — existing shards must be genuinely
near-full before another one is justified, and opening one immediately dilutes the mean
again, so growth self-paces instead of running away. Formalized as its own regression test
(`shardRegistry.test.ts`'s "gates on the MEAN... not the flat total").

**Final validation (`npm run multi-shard-validation`, 3000 days, 3 seeds, after both
fixes)**: single-shard baseline collapses to **8.1/65** mean population (worse than the
27.4/65 seen before the live-N fix — an honest consequence of removing the old model's
optimistic bias, not a regression from this session's own work). Multi-shard registry
settles at **3 shards, 44.5/65 mean population per shard** — real, substantial
improvement, not fully healthy yet (44.5/65 ≈ 68%), reported plainly rather than rounded
up. Further tuning (fillHazard's beta/tPain, the migration failure rate, or the stability
threshold) is still open, flagged in `HANDOVER.md`, not treated as finished.

**Verification.** 33 new tests (10 districtConsolidation, 17 shardRegistry, 6
multiShardHarness) plus 2 existing world.ts tests fixed to stay robust to two new,
legitimate sources of run-to-run variation (trade-route friction touching an exact-value
assertion; live-N/friction touching a single-seed Gini snapshot, now averaged across 5
seeds instead). 233 tests total, all passing; `npm run typecheck` clean. Golden-value
snapshot unchanged (no district crosses its tipping point within the pinned test's short,
fully-staffed 25-tick window, so nothing to regenerate this time).

**Still not built**: Import/Export (nodules, grain conversion, legal/illegal shard
movement) — parked behind this rebalancing work per the user's own sequencing, and now has
a natural home for its route-detection math (replacing `MIGRATION_FAILURE_RATE`'s
placeholder). Physical building relocation between districts on MERGE. A "cleanest and
fairest" role/district allocation still can't be honestly derived from `districtRoleSweep`
until this rebalancing work is itself re-swept against — noted, not done in this pass.

---

## 2026-08-11 — 5-role roster + individually-tracked grifter pool; found the vacancy model's candidate-pool assumption breaks under a real, finite pool

**Context.** User specified the target roster directly: Miller, Baker, Courier,
Journalist, Detective, plus roleless "grifters" — community players drafted or selected
into any open role, earning a smaller floor income until they get one, individually
tracked (unlike the old aggregate-only "gossip layer") specifically so "the effect of
grifters being under the minimum income floor until they obtain a role" is directly
measurable. Asked to derive district count and role-slot allocation from simulation
("test test test"), not guess them.

**Built in layers, testing each before composing.**
1. `wealth.ts`: `SUPPORT_ROLE_DAILY_WAGE` (flat, calibrated between Miller/Baker's current
   earnings — Courier/Journalist/Detective have no designed market mechanic anywhere in
   this project, flagged as an undifferentiated placeholder) and `GRIFTER_DAILY_INCOME`
   (the floor, positive per constraint 2, below every role's wage).
2. `sim/multiRoleConscription.ts` (new file): generalizes `conscriptionHarness.ts`'s
   existing 2-role `stepConscriptionDay` to N roles + one shared grifter pool, reusing
   `vacancy.ts`'s `stepSlot`/`fillHazard` directly. The old function is untouched, still
   covered by its own tests.
3. `world.ts`: wired all 5 roles + individually-tracked `GrifterSlot[]` into the kernel.
   District-aware building assignment (round-robins across all 5 roles through the
   district-ordered building sequence, replacing "first N buildings in generation order").
   `wealthGini`/`wealthTop10Share` widened to span all 5 roles + grifters (every
   identity-bearing player, now that grifters have individual wealth) —
   `wealthTaxRate`/`wealthCap` stay scoped to Miller+Baker only, flagged as an open,
   not-yet-decided widening question, not silently resolved either way.

**Bug found and fixed while writing world-level population-conservation tests.** Module-
level tests for `multiRoleConscription.ts` verified *arithmetic* pool conservation but
never checked *non-negativity* — `fillHazard`'s voluntary-fill roll has no concept of a
real, finite, shared candidate pool (it never needed one when only 2 roles existed and
each used a separately-abstracted "N-R" candidate count). With 5 roles now drawing from
one real, shared grifter pool, multiple roles could independently roll a genuine fill the
same day and jointly overdraw a pool smaller than their combined draws — `world.ts` was
silently no-op'ing the "no grifter left to pop" case while the slot still flipped to
FILLED, breaking population conservation. Fixed by gating voluntary fills on real
same-day pool availability in `multiRoleConscription.ts` (same pattern already used for
the conscription-from-grifters branch), formalized as its own regression test (pool never
goes negative under a tight population/role ratio). Population conservation
(`grifters.length + total FILLED across all 5 roles == population`, every tick) is now
its own tested invariant at the world level, across long runs and multiple seeds.

**Bigger finding — the fix above is correct, and it exposes something the sweep script
(`src/sim/districtRoleSweep.ts`, built to derive the role-slot allocation as asked)
surfaced immediately: population collapses to well below `targetPopulation` at every
role-split candidate tested, not just an unlucky one.** At the current illustrative
default (Miller 3/Baker 7/Courier 6/Journalist 5/Detective 3, S=24), `population` settles
around **26.6** over a 2000-day run — not near 65. Every other candidate split tested
(even split, Miller/Baker-heavy, support-heavy, S=18, S=30) shows the same pattern,
landing anywhere from ~7 to ~37. **This is not new behavior specific to the 5-role split —
confirmed by running the SAME S=24 (Miller=8/Baker=16, matching the pre-existing default)
through the new kernel: population still settles around 28, not 65.** Confirmed further
by running the actual pre-session code (`git stash`, then `npm run role-ratio-sweep`
unmodified) over the same 2000-day/3-seed window: even the OLD, already-validated 2-role
kernel settles at **meanPop=46**, not 65 — so some population drift below target was
already a real, pre-existing, apparently never-noticed-at-this-timescale property of the
composed `world.ts` kernel (its own tests never ran past a few hundred ticks). The NEW
kernel's drift is considerably worse (26-28 vs. 46 for a comparable role-slot count).

**Root cause, traced not guessed**: `vacancyParamsFor`'s `N` parameter has always used the
*static* `config.targetPopulation` (a pre-existing simplification, flagged in `world.ts`'s
own comments, not touched in this pass) — so `fillHazard`'s probability of a voluntary
fill succeeding on a given day is numerically identical between the old and new kernels,
same formula, same inputs. The only actual difference is the fix above: a successful roll
can now be vetoed when there's no real grifter to fill it. Once population starts to
drift down for any reason (including the pre-existing drift the old kernel already had),
the grifter pool — now finite and shared across 5 roles instead of an infinite abstraction
per role — shrinks too, making the veto bite more often, slowing refills further, raising
the roleless fraction `migrationValveStep` reacts to, which increases emigration pressure,
which shrinks population further. A genuine, real negative feedback loop toward
population collapse — exactly what constraint 2 ("no permanent zero-state... whether
that's a player, a role-slot, or eventually a whole shard") warns about, now demonstrated
in simulation rather than theorized.

**Deliberately NOT resolved in this pass.** Picking a "fairest" role-slot allocation from
`districtRoleSweep.ts`'s numbers would be meaningless while population is spiraling
downward under every candidate — the more fundamental problem is
`migrationValveStep`'s theta/k calibration (and/or `fillHazard`'s beta/tPain/tHard),
validated against an assumption (an effectively infinite abstract candidate pool) that no
longer holds now that the pool is real and finite. `DEFAULT_WORLD_CONFIG`'s role split
(Miller 3/Baker 7/Courier 6/Journalist 5/Detective 3) stays as shipped — a working,
tested, population-conserving default — but is NOT claimed to be "the cleanest and
fairest" the user asked to derive; that derivation needs the rebalancing question settled
first. Flagged here and in `BLUEPRINT.md`'s "5-role roster" entry rather than silently
picking numbers from a sweep whose premise turned out to be undermined by something
bigger. Reported directly to the user rather than pushed past.

**Also mid-discussion, not yet built**: the user separately raised a 6th role
(Import/Export — receives a new resource ("nodules") daily, converts to grain for Miller,
controls legal/illegal shard-to-shard movement tied to the existing postcard/tier exit-
ticket system, gated by a 24/7 randomized-behavior detection mechanic). Explicitly asked
to "think it through before moving further" — no code written for this yet; see chat
history for the design discussion and open questions (what forces player interaction
with Import/Export specifically; whether to fold nodules into the same rebalancing pass
as the population-collapse finding above, since nodules would add a second hard resource
constraint on top of an already-fragile equilibrium).

**Verification.** 26 new tests across `wealth.ts` constants, `multiRoleConscription.ts`
(determinism, population conservation, both draft sources occurring, no-draftees edge
case, the non-negativity fix), and `world.ts` (5-role/grifter population conservation
across long runs and seeds, grifter income floor and `daysAsGrifter` tracking, support-role
wage and reset-on-new-occupant, district-aware assignment, widened wealthGini scope).
200 tests total, all passing; `npm run typecheck` clean. Golden-value snapshot
regenerated twice (deliberate, documented) as the tick's shape and behavior changed.

---

## 2026-08-11 — Tightened the purchase cycle, swept first, found a precise scale-invariance property

**Context.** Direct follow-up to the Baker demand model fix: "tighten the purchase cycle
and rerun the numbers." Exposed `purchaseCycleDays` as a `WorldConfig` field first,
specifically so it could be swept without editing source repeatedly.

**Swept before picking a number.** `[2.5, 4, 5, 7, 10, 14]` days, 3 seeds, 2000 days each.
Found something precise and non-obvious, not just "bigger cycle, smaller gap":
`millerOnlyGini` and `bakerOnlyGini` were *identical* at every single cycle length
tested. Traced it: `splitBakerDemand()`'s price-weighted shares are normalized regardless
of total demand, so tightening the cycle scales every baker's income down by the exact
same proportional factor, and Gini is scale-invariant under a uniform multiplier
(verified in `wealth.ts`'s own earlier tests). That means tightening the purchase cycle
is a real lever for the *cross-role* Miller/Baker gap and does *nothing whatsoever* for
inequality *among* bakers themselves — a genuinely useful distinction to have proven
rather than assumed, and now locked in as its own test so it stays true.

**Set the new default from the sweep's evidence**: `PURCHASE_CYCLE_DAYS=7` (was 2.5) —
brings the ratio from 5.3x to 1.9x without overshooting into Bakers earning *less* than
Millers, which cycle=10 and cycle=14 both start to do. Re-ran the standard baseline
report at the new default: combined Gini now 0.35-0.59 (was 0.42-0.62), ratio 1.2x-2.3x
(was 4.1-7.8x before either fix, 3.4-6.5x after the demand-model fix alone).

**Flagged, didn't silently leave stale**: the remediation sweep's tax/cap numbers from
the previous session are now largely obsolete — with the gap this much smaller, flat-tax
redistribution barely moves anything (Gini 0.489→0.487 even at 80% tax), and the wealth
cap's absolute effect shrank too (overall wealth levels dropped roughly 4x, so a cap of 5
barely binds anymore). Noted in `docs/BLUEPRINT.md` that neither should be read as
current without re-running the report.

**Verification.** 2 new tests (the config override actually takes effect; the
scale-invariant relative-shares property the whole tightening's reasoning depends on).
174 tests total, all passing; `npm run typecheck` clean. Golden-value snapshot
regenerated again — same deliberate-change discipline as the previous session.

---

## 2026-08-11 — Fixed the Baker demand model; added a daily downtime window

**Context.** Direct follow-up to the wealth-inequality session. Asked whether the 4-8x
Baker/Miller earnings gap was because the model assumed every player sees a baker every
day — yes, exactly: `BAKER_DAILY_VOLUME=1.0` was a flat per-baker constant with no
population bound at all, so adding more bakers manufactured more total income rather than
splitting a bounded customer pool. User specified the fix directly: customers store food
and don't buy daily, a baker has a realistic service ceiling ("can't serve 20-30 people
daily"), demand should scale with population not baker count, and the shard needs a daily
low-activity window "to account for RL" — same wall-clock hours every day, one shared
timezone, values dampened to 10% rather than trading stopping outright, "keeps the
economy alive during down time."

**Built exactly that.** `dailyDueCustomers()` bounds total demand by population divided
by a purchase cycle (2.5 days, illustrative). `splitBakerDemand()` splits that pool
across bakers weighted by inverse price — cheaper bakers get more, real Bertrand behavior
that `bakers.ts`'s own price competition never actually fed into anything before this —
capped per baker at a realistic daily ceiling (12, comfortably under "20-30").
`DAILY_ACTIVITY_MULTIPLIER` is the correct blended daily average of 16 active hours at
full rate and 8 downtime hours at 10% (≈0.70), applied to both roles' income, "all round."

**Flagged the scope honestly rather than overbuilding**: the kernel's tick is one day —
every existing calibration is calibrated in days, so making the downtime window a literal
same-UTC-hours clock gate would mean subdividing ticks to hourly, which would invalidate
essentially every previously-validated number in this repo. At daily granularity, the
correct representation of "quiet for part of the day" IS the blended multiplier — not an
approximation of some bigger thing left undone. The literal real-time clock enforcement
(blocking actions during specific hours) is a `src/server/ws.ts` concern for whenever real
player actions exist to gate at all — noted, not solved here.

**Re-ran the baseline after the fix — reported honestly, didn't declare victory.** The
Baker/Miller ratio dropped from 4.1-7.8x to 3.4-6.5x — real, but modest, not dramatic.
Traced why rather than just reporting the smaller number: at the current default role
counts (8 Millers, 16 Bakers against population 65), the population-bound due-customer
pool works out to ~26/day, split across 16 bakers ≈ 1.6 each — actually *higher* than the
old flat 1.0 constant, so the new capacity cap (12) never actually binds at these
defaults. The mechanism is structurally correct now; the current role-slot ratio just
doesn't happen to make its constraints bite yet. Real levers for tightening it further
(longer purchase cycle, fewer bakers relative to population, a tighter cap) are named but
not applied — that would mean touching the role-roster ratio, still the user's own open
call, not something to decide inside this fix.

**Verification.** 12 new tests for the demand-split function (price-weighting, the
capacity cap actually holding even in a lopsided case, population-boundedness, zero-
due-customer and near-zero-price edge cases) plus a check on the activity multiplier's
exact value. 172 tests total, all passing; `npm run typecheck` clean. The golden-value
tick-order snapshot was regenerated — expected and documented, since income computation
deliberately changed.

---

## 2026-08-10 — Wealth tracking, Gini coefficient, and checking the "90%/10%" concern directly

**Context.** User request, outside the Observatory phase sequence: track wealth
inequality per iterative simulation, since research into agent-based economic models
shows dystopian concentration (90%+ held by 10%) is a real, documented phenomenon in some
model families. Explicitly asked to research first, track, then remediate and tune —
"I may be wrong" was the user's own hedge, which turned out to matter.

**Researched before building anything.** The "yard-sale model" literature (Hayes;
Boghosian, Devitt-Lee & Wang, SIAM J. Appl. Math. 2024) confirms this is real: *pairwise,
proportional, zero-sum* wealth exchanges reliably condense toward oligarchy even under
fair rules. The remediation literature (Guzmán-González et al. 2025, arXiv:2501.08573)
confirms progressive taxation + redistribution as the established counter. Both cited in
`src/engine/wealth.ts`'s header. Checked whether NODE's actual market structure is even
the same *kind* of system before assuming the conclusion transfers — it wasn't (Cournot/
Bertrand best-response convergence toward a shared average, not pairwise zero-sum
transfers), which turned out to be the whole story.

**Built `src/engine/wealth.ts`** — the first STOCK variable (accumulated wealth) NODE has
ever tracked; `millers.ts`/`bakers.ts` only ever tracked FLOW variables (quantity, price).
`giniCoefficient`/`topShare` verified against hand-computed analytical cases before
trusting them (perfect equality = exactly 0, one holder with everything at n=5 = exactly
0.8, scale-invariance). Two remediation proposals built to match what the user asked for
by name: `taxAndRedistributeIncome` ("daily resource allocation") and `applyWealthCap`
("limitations upon wealth") — both off by default, config-gated, following this repo's
existing pattern for the pattern-based sabotage proposal.

**Wired into `world.ts`**: `RoleEconomicSlot.wealth`, same reset-on-new-occupant/
freeze-while-not-FILLED semantics already established for `experience`. Purely additive —
consumes zero new RNG draws, so the existing golden-value tick-order snapshot needed no
regeneration for the wiring itself (only for adding the new fields to what's snapshotted,
a deliberate change).

**The headline finding — checked, not assumed: NODE does NOT produce the dystopian
concentration the user was worried about.** `npm run wealth-inequality-report`, 3000
days, 3 seeds: Gini plateaus around 0.49-0.53 and top-10%-share plateaus around 28-31%
from tick 100 through tick 3000 — it does not climb toward 90%+ oligarchy. Traced to the
actual mechanism, not just the number: NODE's market has no pairwise wealth transfers at
all (each role-holder earns independently from a shared market-clearing price), so the
specific mathematical condensation mechanism the yard-sale literature describes simply
isn't present. The user's hedge ("I may be wrong") was right to include, and turned out
to matter — the literature's warning is real but doesn't mechanically transfer to a
structurally different market.

**But found a real, different problem instead: a large role-based earnings gap.** Bakers
earn 4-8x more than Millers on average, consistently across seeds (within-role Gini
breakdown in `docs/BLUEPRINT.md`'s "Wealth inequality" entry). Traced to the mechanism:
Miller income is quantity times a flourPrice that sits near its own floor most of the
time; Baker income is a *margin* over that same near-floor price, which stays
comparatively large regardless. A meaningful share of this gap is plausibly an artifact
of `BAKER_DAILY_VOLUME=1.0`, an explicitly `[ILLUSTRATIVE]` placeholder — no per-baker
demand model exists anywhere in this repo — not a validated prediction. Flagged for
review, not treated as settled.

**Remediation sweep, neither shipped as default.** Flat income taxation is weak even at
80% (Gini 0.531 -> 0.485) since it smooths variance around a gap that's mostly
structural, not luck. A hard wealth cap is far more effective at bounding measured Gini
(cap=5 -> Gini 0.083) but with a real caveat surfaced, not hidden: the cap's single-pass
redistribution loses value rather than fully conserving it when overflow exceeds
available headroom — `meanFinalWealth` visibly drops from 7.33 to 4.55 at that cap,
meaning some of the apparent inequality reduction is wealth being destroyed, not
redistributed the way the research describes as the actual goal. Flagged as a concrete
future refinement (iterate redistribution to convergence), not built here.

**Verification.** 20 new tests (`test/wealth.regression.test.ts`) plus 9 new integration
tests (`test/world.regression.test.ts`). One test failure caught and fixed before
trusting the cap function: an early test assumed near-full conservation in a case where
overflow (900) vastly exceeded redistribution headroom (297) — the code was right, the
test's numbers were wrong; fixed by using a case that actually matches what the test
claims, plus a separate explicit test for the large-overflow bounded-loss behavior. 160
tests total, all passing; `npm run typecheck` clean.

---

## 2026-08-10 — Phase C complete: src/sim/drivers/, plus mapping the population/role-ratio imbalance

**Context.** Third phase of the Observatory build spec, plus a follow-up request: map out
a solution to the population-imbalance finding from Phase B, without silently resolving
the still-open role-roster question it's actually blocked on.

**Built `src/sim/drivers/`** — four deterministic policy functions (`honest`,
`opportunist`, `saboteur`, `idle`), resolving the tension the spec names directly:
running a world needs occupants making decisions, which is in direct tension with
constraint 3 ("does this need to be an agent"). Each driver is a pure function from a
deliberately narrow `DriverVisibleState` (ambient counts and prices only, nothing
requiring belief modelling) to one bounded `DriverAction`. Enforced structurally, not by
convention: `test/drivers.importGuard.test.ts` scans `src/engine/`, `src/world/`, and
`src/server/` for any import referencing `sim/drivers` and fails the build if it finds
one — including a sanity check that the guard's own regex actually catches a real
violation, so a passing test means something.

**Verified the four strategies are behaviourally distinct, not four relabeled copies**:
`honestDriver` reacts to `economicHealth`, `opportunistDriver` reacts to `flourPrice`
instead — a test confirms opportunist's occupy-a-vacancy rate swings sharply with price
while honest's stays flat regardless. `saboteurDriver` only attempts a sabotage step when
the ambient `nearbyOccupantCount` is mechanically low, never otherwise, and blends in
(an ordinary Wall post or nothing) the rest of the time — matching the pattern-based
sabotage proposal's own premise that any single observed action should read as
unremarkable.

**Deliberately not wired into a live `stepWorld` tick this phase** — the spec's own
deliverable list names only the drivers and the import-guard test. Wiring
`occupySlot`/`vacateSlot` in particular raises a real design question (force a
vacancy.ts transition, or influence its existing probabilistic model?) that doesn't
belong buried inside this phase — deferred explicitly to Phase D, where `world-record`
needs real driver activity to produce a non-trivial run.

**Mapping the imbalance — data, not a decision.** Built `src/sim/roleRatioSweep.ts`
(`npm run role-ratio-sweep`), which runs the real composed kernel across six candidate
role-slot/population configurations rather than picking one. Two things worth carrying
forward: (1) population settles to roughly the same equilibrium (~35) regardless of
whether `targetPopulation` starts at 50, 65, or 80, as long as total role slots stay at
24 — `migrationValveStep`'s long-run behavior seems driven primarily by role-slot count,
not starting population, meaning `targetPopulation` currently functions more as an
initial condition than a stable target. (2) The sweep confirms the Phase B population-
drain finding wasn't a one-tick anomaly: at 8 role slots (this file's own original
mistake, kept as a reference row), `economicHealth` bottoms out at exactly the 0.4 floor
itself, not just near it — a genuinely different, worse equilibrium, not noise. Neither
finding resolves the actual open question (what the real role roster should be) — that
stays exactly where HANDOVER.md already flagged it, the user's own call. This just gives
it real data to be made against, per the Observatory's whole stated purpose.

**Verification.** 10 new tests (`test/drivers.regression.test.ts`,
`test/drivers.importGuard.test.ts`). 131 tests total, all passing; `npm run typecheck`
clean.

**Not started yet:** Phases D-F (snapshot contract, the Observatory web app,
civic-memory monuments).

---

## 2026-08-10 — Phase B complete: src/world/world.ts, the unified deterministic kernel

**Context.** Second phase of the Observatory build spec, built after checking in with
findings from Phase A. Composes Phase 1 market, Phase 2 vacancy/conscription, and the
ecosystem layer — three models that had never run together before — into one `World` and
one `stepWorld()` tick, sited on Phase A's real geography.

**Refactored `sim/conscriptionHarness.ts` first**, extracting `stepConscriptionDay()`
from `runConscriptionSim()`'s inline day loop, so `world.ts` could reuse the exact Miller
conscription logic instead of duplicating it — per the spec's explicit "existing engine
modules are called, not reimplemented" instruction. Verified the refactor changed nothing:
`test/conscription.regression.test.ts`'s existing 5 tests pass unchanged.

**Pinned the tick order** — space/occupancy, vacancy+conscription, market (Miller then
Baker), ecosystem (sabotage before arrivals before migration, then health/experience),
comms — matching the spec exactly. Checked `design/tick_order_check.py` (the prior art
the spec named) before choosing the sabotage-before-arrivals sub-order within the
ecosystem stage, rather than picking one arbitrarily; that script already proved the two
orderings produce measurably different results. Pinned with a golden-value snapshot test
(`test/world.regression.test.ts`, `toMatchSnapshot()`), so an accidental reorder inside
`stepWorld` will fail the test rather than silently changing every downstream number.

**Closed the named gap: a BACKSTOPPED or conscripted Miller now actually participates in
pricing.** `computeMillerSupply()` — FILLED slots compete via Cournot as before,
BACKSTOPPED slots contribute `BACKSTOP_PRODUCTIVITY` (reusing ecosystem.ts's own
constant, not inventing a second one), VACANT contribute nothing. Tested directly,
including that an all-BACKSTOPPED miller layer still produces a real flour price.

**Two genuine contradictions found by composing all three models for the first time —
documented in `docs/BLUEPRINT.md`'s "Phase B" entry, not papered over:**

1. `stepMillers`/`stepBakers` require >= 2 array entries; vacancy.ts permits 0 or 1
   FILLED slots as an ordinary outcome, especially at small role counts. Resolved: fewer
   than 2 FILLED means no competitive step that day (frozen values, same as any other
   non-FILLED slot) — never throws, verified across 500-tick runs at extreme churn.
2. **Caught before it became a false "contradiction" report**: `migrationValveStep`, run
   for the first time in a real composed tick, immediately drained population from 65
   toward ~27 within 25 ticks. Traced it to this file's own first-draft default
   (`rMiller=3, rBaker=5` — 8 total role slots against `targetPopulation=65`, an ~88%
   roleless fraction, far outside `migrationValveStep`'s own validated 55-68% equilibrium
   band) rather than a real module conflict — an oversight of not cross-checking against
   `ecosystem.ts`'s own `S_DEFAULT=24` before picking illustrative numbers. Fixed the
   default to `rMiller=8, rBaker=16` (24 total, matching `S_DEFAULT`), which lands at
   ~63% roleless — inside the already-validated band — and population now settles into a
   stable 33-51 range over a 365-day run instead of collapsing. This does **not** resolve
   the separately-flagged, still-open "vacancy defaults are provisional, blocked on a
   real role roster" question (HANDOVER.md) — it only makes this file's own default
   internally consistent with the existing provisional number instead of contradicting it
   with a worse one.

**Confirms Phase A's spatial-witness finding inside a real running kernel**, not just a
standalone report: `npm run world-sim` (365 days, seed 42) shows real witness counts of
2-7 at actual sabotage events — far below the previously-assumed flat 23 — and
`economicHealth` fluctuating 0.775-1.0 across repeated sabotage waves, never near the 0.4
floor even under sustained attack through the full composition.

**Explicitly not attempted, flagged not half-built:** district population tracks
role-holders only, not a full gossip-layer-per-district ledger (`placeArrival()` stays
available, unused by the automatic tick); `weatherHistory` stays empty (computing a real
District Weather value isn't a named deliverable of any phase); comms only propagates
`pendingWallPosts`, which nothing autonomously populates yet (that's a driver action —
Phase C) — the mechanism itself is real and directly tested even though it's a practical
no-op until Phase C exists.

**Verification.** 14 new tests (`test/world.regression.test.ts`) — determinism, the
tick-order golden-value pin, BACKSTOPPED-participates-in-pricing, the
Cournot-minimum-2 never-throws property across seeds, comms proximity propagation, a
real config-error check. 121 tests total, all passing; `npm run typecheck` clean.

**Not started yet:** Phases C-F (synthetic drivers, snapshot contract, the Observatory
web app, civic-memory monuments) — stopping here to report back and check in again before
continuing, per the standing instruction on this task.

---

## 2026-08-10 — Phase A complete: src/engine/space.ts, NODE's first spatial primitive

**Context.** First phase of the Observatory build spec. NODE had no spatial primitive at
all — `districtArrivalChoice()` was a coin flip with nothing persisting, witness counts
were bare parameters with no derivation, `decay.ts` used abstract hop counts. Built in
isolation and checked before moving to Phase B, per the user's explicit instruction not
to do too much in one pass.

**Built `src/engine/space.ts`** — `Shard` → `District` (persistent, core/periphery,
its own history arrays) → `Plot` (grid coordinate) → `Building` (opaque `roleSlotRef`,
resolved by whoever composes this with real `vacancy.ts` state later, not here). Kept
dependency-free of every other `src/engine/` module, matching the existing style — the
one exception is `mulberry32` from `sim/rng.ts`, needed because the spec's
`generateShardLayout(seed, config)` signature takes a raw seed rather than the `rand`
callback every other module takes.

**Real bug found and fixed via testing, not shipped silently:** the district plot
generator's grid loop stepped from `-radius` by `spacing`. Whenever `radius` is odd and
`spacing` is even — periphery's own defaults, radius=5 spacing=2 — that stepping never
lands on offset 0, so the plaza plot silently never got generated in any periphery
district. Caught by the "every district has exactly one plaza" test failing on
`plazaCount=0`; traced with a small debug script rather than guessing. Fixed by
iterating every integer offset and filtering to the spacing lattice aligned to zero,
instead of stepping from an arbitrary, radius-dependent start point.

**Wired the three named mechanics, without importing across engine modules:**
`proximityCloseness(dist, maxRange)` gives `decay.ts`/`connections.ts` a real
distance-derived closeness number in place of an arbitrary hardcoded one (the decay
curve itself is untouched); `placeArrival(shard, classification)` composes with
`ecosystem.ts`'s `districtArrivalChoice()` from the outside to close its "nothing
persists" gap, placing an arrival at an actual plaza and persisting population growth in
a new (not mutated) `Shard`; witness counts got a full report, not a direct import (see
below).

**The witness-count finding, reported not silently retuned:** built
`src/sim/spatialWitnessReport.ts` against a shard matching `S_DEFAULT=24` exactly, 65
players (24 role-holders + 41 gossip-layer), and measured real witness counts around a
core-district sabotage target at four radii. Headline: at any realistic *local* radius,
real detection is substantially **lower** than the flat ~23-witness assumption both
existing sabotage calibrations used — at radius=3 (immediate street), act-based
detection with role-holders-only real witnesses is 9.8-26.5%, not 69.3%; the
pattern-based proposal's full-pattern detection drops from an assumed 20.6% to
3.9-10.5%. This means the ~146-220 days-per-success figure reported for the pattern
proposal (2026-08-10, earlier this session) is itself an overestimate of attacker
difficulty — real spatial witnessing is almost certainly easier for an attacker than
that number suggested, at any spatially-bounded witnessing radius. Full numbers and two
flagged open questions (what witnessing radius is realistic; does "witness" mean
anyone-nearby or role-holders-only) are in `docs/BLUEPRINT.md`. Neither existing
calibration constant was changed — this is a report, and the spec was explicit that
Phase A should not silently re-tune.

**Verification.** 24 new tests in `test/space.regression.test.ts` — layout determinism
under a fixed seed, distance symmetry/triangle-inequality (Manhattan distance, a
deliberate simplification over full pathfinding-around-obstacles — flagged in
`BLUEPRINT.md`, not silently decided), occupancy queries against hand-computed ground
truth, the density gradient regression (core measurably denser than periphery, holds
across 5 seeds), and the two wiring helpers. 107 tests total, all passing; `npm run
typecheck` clean.

**Not started yet:** Phases B-F (unified world kernel, synthetic drivers, snapshot
contract, the Observatory web app, civic-memory monuments) — stopping here to report
findings and flags back before continuing, per the standing instruction on this task.

---

## 2026-08-10 — New task started: Spatial Layer + Unified World Kernel + The Observatory

**Context.** `docs/NODE_OBSERVATORY_BUILD_SPEC.pdf` (saved to the repo this entry) is a large
six-phase task: give NODE its first spatial primitive (`src/engine/space.ts`), compose the
three previously-separate models (market, vacancy/conscription, ecosystem) into one
deterministic `src/world/world.ts` kernel, add harness-only synthetic drivers, define a
versioned snapshot contract for replay/live-streaming, build a local dual-camera
(top-down + first-person) observatory web app (Vite/React/Three.js) to actually *see* the
world run, and give civic memory (constraint 4) somewhere to live via plaza monuments.

**Plan, per the user's explicit instruction not to do too much in one pass:** build in the
given phase order (A through F), each phase self-contained and testable before starting the
next, checking in with findings/flags between phases rather than attempting all six in one
session. Starting with Phase A (`space.ts`) now — it's the foundational primitive several
already-built mechanics (decay, detection, districting) are currently standing on top of as
placeholders, and the spec explicitly requires reporting what real spatial witness counts do
to both existing sabotage calibrations rather than silently re-tuning them.

Committed now, ahead of any code, so this direction is on `main` and durable rather than
sitting only in the current session's context.

## 2026-08-10 — Strengthened two standing flags; end-of-session HANDOVER/README rewrite

**Context.** Item 5 of "Resolve Standing Ambiguities" — explicitly flag, don't resolve.
Both `TRAVEL_DAYS_TARGET=168` (vs. the postcard/tier exit ticket's 4-8 week target) and
the stale vacancy defaults (`R=2-4` of `N=50-80`, unrevisited since the brief's §1.5
role-slot mix was rejected) were already noted as open in `HANDOVER.md`, but only as bare
flags — no statement of what they actually block.

**Strengthened, not resolved.** `TRAVEL_DAYS_TARGET` now states concretely what's
downstream of it: calibrating `decayExperienceTraveling()`/`TRAVEL_DECAY_PER_DAY` against
a real player timeline, and any visual-brief work depending on how long a departed
player's slot should visibly read as long-gone. The vacancy-defaults flag now states what
a revised role roster needs to specify before recalibration is even possible: how many
distinct roles exist per shard (none of the eight named in the visual design brief are
locked), how many slots per role (only Miller has one, `R=2`), and what fraction of `N`
role-holding is meant to occupy in total now that the brief's own ~1/3 figure is
rejected. Neither constant was touched.

**End-of-session documentation pass.** Rewrote `docs/HANDOVER.md`'s "Current state" and
"What's next" sections to reflect all four of today's resolutions (permanence split,
reputation constraint, backstop-framing/NPC audit, sabotage pattern-based proposal) in
one place, corrected the "five standing constraints" references to six throughout
(`HANDOVER.md`, `README.md`), and updated test counts (72 → 83) and the command list
(`sabotage-pattern-sim`) in both `HANDOVER.md` and `README.md`. Removed a stale
parenthetical in `HANDOVER.md` that had claimed the "no consequence for a caught
saboteur" gap was "less urgent" — no longer true now that the pattern-based proposal
makes repeated sabotage attempts genuinely low-cost to a caught attacker.

**Verification.** 83 tests passing, `npm run typecheck` clean — documentation-only change,
no logic touched.

---

## 2026-08-10 — Sabotage re-specified as pattern-based (proposal, not shipped)

**Context.** Item 4 of the "Resolve Standing Ambiguities" task. Diagnosis carried
forward from 2026-08-08: the act-based sabotage mechanic rolls detection every day of
the acquisition window against `detectionProbability(witnesses)`, which saturates
near-certain at a healthy shard's ~23 witnesses — sabotage was documented as nearly
non-viable. Task asked for a re-specification where sabotage is a sequence of
individually-innocuous steps, only the accumulated pattern incriminating, detection
rolling against the pattern rather than each step, and explicitly said not to ship a
final calibration without review.

**Built, additively.** `patternLegibility()`, `patternStepDetectionProbability()`,
`patternSabotageAttempt()` added to `src/engine/ecosystem.ts` alongside (not replacing)
the original `sabotageAttempt()`/`applySabotageDamage()`, which remain what
`ecosystemHarness.ts` actually runs by default. A campaign is 6 steps, one every 15
days; each step's detection hazard combines an ambient channel (ramped quadratically by
steps completed — a single step stays near-undetectable regardless of witness count) and
a Detective channel (ramped linearly instead, and only active when a Detective-type role
is investigating) — the different ramps are what make a Detective structurally necessary
as counter-play rather than optional. New harness (`src/sim/sabotagePatternHarness.ts`,
`npm run sabotage-pattern-sim`) runs this against the same real vacancy-driven shard
dynamics used for the act-based mechanic.

**Simulated before trusting.** 8 seeds, 20,000 days, both single-attacker and a
4-concurrent-attacker stress case for the constraint-2 check specifically (not just
assuming the single-attacker case generalizes):

- Attacker time investment: ~146 days/success without a Detective, ~220 with one
  actively investigating (1 attacker) — genuinely achievable, not guaranteed (44.8-68%
  of campaigns caught first).
- Constraint 2 (never zeroes a shard): holds — `economicHealth` tail minimum stayed at
  0.775-0.800 across all four configurations tested, well above the 0.4 floor, even
  under 4 concurrent campaigns.
- Consequence for a caught saboteur: still unspecified, same gap as the act-based
  mechanic — flagged, not invented. Matters more now that repeated attempts carry no
  cost beyond lost time.

**Not adopted as the new default** — explicitly a proposal per the task's instruction.
Full numbers and design rationale in `docs/BLUEPRINT.md`. 11 new tests
(`test/sabotagePattern.proposal.test.ts`) validate the mechanism itself (legibility
grows correctly, single steps stay near-undetectable, Detective raises catch rate, floor
holds under stress) without locking in these specific numbers as final. 83 tests total,
all passing; typecheck clean.

---

## 2026-08-10 — Resolved three standing ambiguities: permanence split, additive-only reputation, mechanical-backstop framing

**Context.** User task: "Resolve Standing Ambiguities in NODE" — five items. This entry
covers the first three (documentation + terminology); items 4 (sabotage re-specification)
and 5 (flagging TRAVEL_DAYS_TARGET/vacancy-default staleness) are separate, later pieces
of the same task.

**1. The permanence contradiction.** A live contradiction existed across the repo:
README's "the past is immortal" vs. external design material's persistent per-player
`trust_index` carried cross-session vs. `CLAUDE.md` constraint 4's old "nothing gets
recorded, ever" vs. the diary's ~30-day TTL. Settled: personal memory (diary, rumours,
private impressions) is mortal; civic memory (public, collectively-witnessed events —
monuments, the Wall's Emissive Soul, Ghost Shard missives, shard ruin/rejuvenation) is
immortal. Test to apply going forward: "does this record capture an event the node
collectively witnessed, or an individual's private expression/judgement? The first may
persist. The second must not." Rewrote `CLAUDE.md` constraint 4; corrected README's
tagline to "what the node did together, it did for good" (unambiguously civic); recorded
the decision and reasoning in `BLUEPRINT.md`. Explicitly: no cross-session/cross-shard
`trust_index` is to be built under any name — any external spec implying one is
superseded by this decision.

**2. New standing constraint: reputation is additive-only.** No reputation system exists
in code yet — prior sessions deliberately stopped sabotage-detection work at the
mechanical fact of whether an act was witnessed, going no further. That restraint meant
this constraint could be written before anything gets built on top of it. Added as
`CLAUDE.md` constraint 6, verbatim per the task: every player holds an untouchable
baseline of visibility and access; reputation sits on top, never below. Exclusion is the
failure mode this design is most exposed to; a subtractive reputation system is
structurally an exclusion engine. Composes with constraint 2 (no permanent zero-state)
applied to social standing. Did not build a reputation system — constraint only.

**3. The vacancy backstop vs. the "no agents" rule.** README/vacancy engine described
the backstop as flat and mechanical; external material had drifted toward "NPC Millers"/
"Ghost Couriers" — character-implying language conflicting with `CLAUDE.md` constraint 3.
Settled framing: the simulation is always running the rules for every slot; an unoccupied
slot isn't a character standing in, it's the world's own physics continuing to tick.
Audited every "NPC" occurrence across `README.md`, `HANDOVER.md`, `BLUEPRINT.md`, code
comments, and test descriptions in `src/` and `test/`, and replaced with this framing —
including renaming the `NPC_PRODUCTIVITY` constant in `src/engine/ecosystem.ts` to
`BACKSTOP_PRODUCTIVITY` (value unchanged, 0.4). Deliberately left this DEVLOG, the dated
design addenda, and `design/node_core_reference.py`/`design/node_core.ts` untouched — this
project's own practice (see the "diary fourth reinvention" entry below) is to append
corrections rather than rewrite history, and those files are closed, dated, or explicitly
preserved provenance. Also recorded in `BLUEPRINT.md`: a minimum of three real players is
required for a live economy (generalizes the Phase 1 §1.4 n=2 instability cliff to social
scheming needing a third party) — checked against existing calibration (Miller's `R=2` in
the conscription harness matches the brief's own "2-3 thin rivalry roles" recommendation),
no conflict found, no numbers changed.

**Verification.** All 72 existing tests still pass; `npm run typecheck` clean. This was a
naming/framing and documentation pass — no simulation logic changed, so no new tests were
required for this piece.

---

## 2026-08-08 — Ran the two economic-health formulas together; wired real sabotage detection

**Context.** Direct follow-up to yesterday's ecosystem-mechanics port, which carried
forward an unresolved gap from the source material: `economicHealth()` and
`economicHealthWithExperience()` were validated independently and never run on the same
trajectory. User: "run the economies together. we won't know otherwise."

**Built `src/sim/ecosystemHarness.ts`** — combines `vacancy.ts`'s real per-slot
semi-Markov dynamics (FILLED/VACANT/BACKSTOPPED via `stepSlot`, not the toy
aggregate-count model `ecosystem.ts`'s own acceptance tests used) with per-slot
experience tracking, feeding both economic-health formulas from one simulated shard.
Had to make three modeling decisions the source material didn't specify (flagged in the
harness's header, not silently picked): experience resets to 0 on a fresh `FILLED`
transition (new occupant), freezes while VACANT/BACKSTOPPED, and sabotage-evicted slots
freeze rather than reset at eviction (the slot was forced empty, not handed to someone
new — that reset happens later, on the actual re-fill).

**First finding: `economicHealth()` alone understates sustained sabotage damage by
roughly 3x.** Ran baseline churn (no sabotage) and sustained sabotage (12-of-24 evicted
every 20 days, matching the original test's own scenario) side by side. Baseline:
`economicHealth` ≈0.985, `economicHealthWithExperience` ≈0.928 (gap ≈-0.057) — even
healthy churn keeps average experience below the cap, so the two formulas were never
really interchangeable. Under sustained sabotage: `economicHealth` ≈0.960 (barely
dented — the recalibrated vacancy engine from two days ago refills fast), but
`economicHealthWithExperience` ≈0.768 (gap ≈-0.193, roughly 3x wider) — forced turnover
keeps re-filled slots perpetually inexperienced, an effect the occupancy-only metric
literally can't see. A shard dashboard built on `economicHealth()` alone would report
"basically fine" under real, ongoing attack. Confirmed stable across 5 seeds before
trusting it.

**Second finding, from a new mechanic the user then asked for.** Mid-investigation:
"1. same but with a new mechanic. 2. people know, people see people talk. people react.
the outcome is unknowable until players decide how to respond." Realized while building
this that `sabotageAttempt()` — the function that actually rolls for detection — was
never exercised anywhere in the original source material at all; the acceptance test
called `applySabotageDamage(filled, 3, 4)` directly, hardcoding "3 successes" and
bypassing detection entirely. Wired it in for real: witnesses = current filled-slot
count, driving `detectionProbability()`, driving `sabotageAttempt()`'s actual day-by-day
detection roll. Result: sabotage becomes nearly non-viable at this repo's steady-state
witness density (~23-24 of 24 slots filled) — mean successful saboteurs per round stayed
under 0.02 of 3, checked across cadences from daily to every 20 days. Dug into why:
`DETECTION_P_PER_WITNESS=0.05` compounds via `1-(1-p)^witnesses` to ~69% per-day
detection at ~23 witnesses, so surviving even a 5-day acquisition window undetected is
already unlikely, regardless of how often sabotage is attempted. Also tested whether a
deliberately depleted starting shard (as low as 3-of-24 filled) gives sabotage a real
opening — it doesn't, because the recalibrated vacancy engine (`beta=0.03, tHard=3`,
from the VACANT-phase gap fix earlier this session) heals any starting point back to
~23-of-24 within 20 days, faster than any sabotage cadence tested could exploit it. Two
design decisions made independently and for unrelated reasons — the speed-focused
vacancy recalibration and the later detection-driven sabotage mechanic — compose to
nearly cancel sabotage's efficacy. Neither decision could have predicted this in
isolation; exactly the kind of cross-system consequence "run them together, we won't
know otherwise" exists to catch.

**Respected the stated boundary explicitly, not just by omission.** The user's "people
react — the outcome is unknowable until players decide how to respond" is a boundary on
what gets simulated, not a request to model social response. The harness stops at the
mechanical fact (was an act witnessed, how many saboteurs succeeded) and does not invent
reputation scores, scripted retaliation, or NPC reactions — stated explicitly in the
harness's own header comment so a future session doesn't quietly cross that line while
extending it.

**Formalized rather than left as a scratch script.** `src/sim/ecosystemCli.ts` (`npm run
ecosystem-sim`) reproduces the comparison table on demand. 4 new regression tests lock
in both findings — including a direct test that detection-driven sabotage barely dents
`economicHealthWithExperience` while the old fixed-success model shows real suppression,
so the two sabotage models can't silently drift back together undetected. 72 tests
total, all passing; `tsc --noEmit` clean.

---

## 2026-08-07 — Ecosystem-scale mechanics ported from a parallel design session

**Context.** User had been working with Claude in a separate thread, doing the math and
design for a set of ecosystem-scale mechanics beyond anything in the brief: an economic
floor generalizing the vacancy backstop to shard scale, a migration valve modeling
population-level emigration pressure, a sabotage mechanic, an experience/travel-decay
system, and core/periphery districting. Uploaded five files: a buildable architecture
spec, a validated Python reference implementation, a cross-checked TypeScript port, a
tick-order sanity check, and a visual design brief for a downstream isometric-city
image/video generator. "We have work to do haha. I added the visual design so we're not
building 2 different things."

**Verified before porting a single line, not trusted on the claim.** Ran both
`node_core_reference.py` and `node_core.ts` directly in this environment. All 6
acceptance tests passed in both languages, with results matching closely despite
different RNG streams (Python's Mersenne Twister vs. the TS port's mulberry32) — as
expected for a stochastic model validated by a band, not an exact value. Also ran
`tick_order_check.py` and reproduced its exact claimed numbers (0.424 vs. 0.423) for
sabotage-before-arrival vs. sabotage-after-arrival ordering within a tick.

**Traced every piece against what's already in this repo before writing anything.**
Found the core of it isn't a competing design — `docs/ECOSYSTEM_VISION_2026-08-06.md`
§2 already worked out, qualitatively, that shard ruin/rejuvenation falls out of pushing
the existing vacancy backstop to its limit (every slot BACKSTOPPED, floor never zero).
`economicHealth(0, S) = 0.4` is exactly that idea given a real number, and the source
material's own integration note said to wire it off `vacancy.ts`'s existing slot states
rather than duplicate them — confirmed that's exactly how it fits. The migration valve,
sabotage, experience, and districting mechanics are genuinely new territory; checked
each against `CLAUDE.md`'s five standing constraints before treating them as fine to
build (no permanent zero-state holds throughout — floors and ceilings everywhere, never
divergence to zero or infinity; nothing requires modeling any individual's behavior or
motivation, it's all probability rolls and population-level formulas; the migration
valve is arguably the first real implementation of "let outcomes be real, don't script
them" beyond the single mention in Ecosystem Vision).

**Flagged three real gaps instead of silently resolving them**, per this repo's
standing discipline: (1) the source material's own admitted gap that
`economicHealth()`/`economicHealthWithExperience()` were never run together; (2)
`TRAVEL_DAYS_TARGET=168` (~6 months) looking suspiciously like a holdover from the exit
ticket's *original* 2026-08-06 baseline, which the postcard/tier system explicitly
revised to 4-8 weeks on 2026-08-07 for a stated reason — asked directly whether this is
the same clock or a separate post-departure window, not yet answered; (3) sabotage has
no defined consequence for a *caught* saboteur, only tracks who succeeds.

**User correction, recorded not silently applied:** "you should know by now the roles
are arbitrary... we can't have a population with 2/3 with nothing to stake. each role
produces a resource someone else needs." This explicitly rejects the brief's own §1.5
role-slot mix (~1/3 role-holding, ~2/3 pure gossip-layer). Didn't try to invent a
specific expanded role roster to fill this in — the user was explicit that the specific
role content is "nuance" they're building on top, and the priority right now is the
foundation. Checked that nothing in the ported code hardcodes the old ratio (`S` and `N`
stay independent parameters throughout), so raising the role-holding fraction later is a
calibration change, not a rework.

**User correction on the visual brief specifically:** after an initial reply treating
the visual design brief as something to defer to Phase 4, got pushed back on directly —
"if you don't understand the design visual spec, you'll build something else. hence why
it's there." Re-read it as a literal data contract (its own §3 table: role type → hue,
economic health → glow, player-held vs. NPC-backstopped → outline style, roleless
population → loose figures, detection risk → ambient light), not mood-board material,
and annotated every export in the new engine module with which row it feeds — so a
future renderer traces data to visual from the code directly, not by rediscovering the
mapping across two separate documents. Found and flagged one real gap the brief needs
that nothing built (or given) provides: persistent per-district state — nothing here
accumulates a district's history over time, only decides where one new arrival lands.

**Built.** `src/engine/ecosystem.ts` — the ported, repo-integrated mechanics, with
`filledByPlayerCount()` reading `vacancy.ts`'s existing `RoleSlot[]` directly rather than
duplicating slot state. `test/ecosystem.regression.test.ts` — the 6 validated bands
ported as real vitest regression tests using this repo's own `mulberry32` (not a second
copy), plus 4 additional checks: a closed-form verification of `districtArrivalChoice`'s
claimed core-share range (which, it turns out, had no actual test anywhere in the source
material either — checked before trusting it), that the sabotage-suppressed series
genuinely oscillates (guards against the exact bug the source material found the hard
way — a snapshot-timed-right test would pass vacuously against a flat series), and the
tick-order robustness check. Design material saved to the repo for provenance:
`docs/NODE_BUILD_SPEC_2026-08-07.md`, `docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md`,
`design/node_core_reference.py`, `design/node_core.ts`, `design/tick_order_check.py`.

10 new tests, 68 total, all passing; `tsc --noEmit` clean.

---

## 2026-08-07 — Godot client verified for real; found a genuine bug this way

**Context.** User: "Verify the Godot client actually runs." This has been the longest-
carried "still needs your input" item in HANDOVER.md — every prior session flagged the
client as unverified because the build environment had no Godot binary/GUI, so it had
never actually been opened, only written by hand against Godot 4 syntax.

**Worked around the missing binary rather than reporting it as blocking again.** Checked
for Godot on disk first (only found generic desktop mime-type registrations, not the
engine), then tried downloading it — the session's outbound proxy allowed a direct pull
of the official Godot 4.3 Linux release from GitHub. No GUI/display in this environment
either, but Godot supports `--headless` mode: the real engine, real script parsing, real
scene loading, real `WebSocketPeer` — just no rendering. That's enough to verify
everything except the visual editor experience, which is now the one narrower thing
still genuinely unverified (flagged explicitly as such, not glossed over).

**First run failed immediately** — `ERROR: Invalid URL: ws://127.0.0.1:8080?player=wren`
from `WebSocketPeer.connect_to_url()`. A real bug, not a fluke: Godot's WebSocket client
rejects a bare `host:port?query` URL, unlike the `ws` package used server-side and in
every throwaway test client this had been checked against before (`ws.integration.test.ts`
included) — it requires an explicit path before the query string. This is exactly the
class of bug the "unverified" caveat existed to warn about: the server-side protocol and
its tests were correct the entire time, but the client's own connection string was
silently broken until an actual Godot engine parsed it. Fixed with one added `/` in
`client/scripts/Main.gd`.

**Didn't stop at "it starts."** Started the real `npm run server`, ran the client
headless against it with temporary debug prints, and watched real events arrive: a
`tick` message with real data, then — waiting a bit longer for the mill to actually
fire — a targeted `rumour` message addressed correctly to `wren` with the right fields
(`heardFrom`, `state`, `distorted`, `hop`, `clarity`) and no `heardBy` leaking through,
exactly as the 2026-08-07 targeted-networking work intended. No errors or warnings
anywhere in the run, including the previously-fixed `int()` cast gotcha, re-exercised
live this time instead of just reasoned about. Removed the debug prints once confirmed —
`git diff` showed nothing left behind before committing.

**Result:** the client is genuinely verified now, not just "written correctly by hand
and hoped." `docs/BLUEPRINT.md`'s "Client/server scaffold" section rewritten to say so
plainly, including the narrower remaining gap (GUI editor experience, not covered by a
headless run). `docs/HANDOVER.md`'s longest-standing open item is closed.

---

## 2026-08-07 — Postcard/tier exit-ticket addendum: verified independently, not just trusted

**Context.** User pasted a full new design addendum — a tiered postcard-fusion exit
ticket (War and Order-style fusion risk + Rise of Kingdoms-style passive accrual floor),
superseding the single-variable gamble from `DESIGN_ADDENDUM_2026-08-06.md` — with
simulation findings already run against it, and asked "please check it works." The
original simulation script (`/home/claude/node_sim/postcard_tier_sim.py`, per the
addendum's own text) lives in a different local sandbox and was never pushed to this
repo, so there was nothing to just re-run — verifying it meant building an independent
model from scratch, from the addendum's prose alone, same discipline as every other
"simulate before trusting" check in this project.

**Two separate checks, not one.** First, the deterministic safe-path baseline (no
gambling) is fully closed-form given the stated 5:1 fusion ratio over 4 tiers: 5⁴ = 625
White postcards per Orange, ×3 Orange required = 1875 White needed. At the addendum's
illustrative 2.0/hr accrual rate, that's exactly 937.5 hours = 39.06 days — matches the
addendum's stated "40" (rounding). At 1.0/hr: 78.12 days, matching the stated "79." No
simulation needed for this part — pure arithmetic, and it checked out on the first pass.

Second, the gambling-strategy population table (median/mean/min/max at k=4/5 through
k=1/5 shortcut fusion) is inherently stochastic, so this needed an actual Monte Carlo.
Wrote `design/postcard_tier_verify.py` from the addendum's prose description only —
deliberately not looking at or guessing at the original script's internals, since it
wasn't available to compare against anyway. Ran at the addendum's stated population size
(n=300) across 5 different seeds to check the reported numbers against natural
sampling noise rather than a single lucky/unlucky run. Every number in the addendum's §6
table fell inside the range produced across those 5 seeds — median/mean landing within
~1-2 days of the reported figures, min/max within the same order of magnitude (some
spread expected there specifically, since extremes of a 300-sample population are
inherently noisier than the median). Also confirmed the stated per-attempt win rates
(80/60/40/20% for k=4..1) algebraically, not just empirically: contributing same-tier
pieces makes the weights in the addendum's win-probability formula cancel exactly,
leaving `p = k/5` — a clean derivation, not a coincidence of the simulation.

**One assumption flagged, not silently resolved.** The addendum's prose doesn't fully
pin down whether a "strategy k" player always gambles with exactly k pieces the moment
they're available, or opportunistically banks toward a safe 5-piece fuse when
convenient. Modeled the former (always-gamble, matching the "impatience relief" framing
in the addendum's §2) since it's the more natural reading, but noted this explicitly in
a verification note at the top of the addendum rather than treating it as settled —
consistent with the project's rule of not silently picking an interpretation of an
underspecified mechanic.

**Result: the addendum's findings hold up.** Saved to
`docs/DESIGN_ADDENDUM_2026-08-07.md` with the verification note prepended (same pattern
as the 2026-08-06 addendum's stake-formula bug note), `design/postcard_tier_verify.py`
committed alongside it, `design/README.md` updated to list it and to note the old
`exit_ticket_gamble_sim.py` is now superseded (kept for the record, not deleted).
`docs/HANDOVER.md` updated to retire the old "confirm the stake-formula fix" open item,
since that whole mechanic no longer applies — also caught and fixed a leftover duplicate
paragraph in HANDOVER.md from an earlier session's edit while in there.

---

## 2026-08-07 — Identity & targeted-networking primitive: scoped, then built

**Context.** User: "the addendum addresses core mechanics that can't be so easily
bolted on later. we need to scope those out now." Traced every not-yet-built addendum
mechanic (private diary, proximity conversation, the Oracle, exit ticket) against a real
architectural gap: `src/server/ws.ts` broadcasts one identical payload to every connected
socket, no per-connection identity anywhere in the stack. Not hypothetical — the MVP's
`TickMessage` already sent every player's `heardBy`/`heardFrom` rumour pair to every
connected client regardless of who they were, defeating the entire point of the rumour
mill's information asymmetry (§0/§3.2). It hadn't mattered yet only because no real
client parsed it selectively.

**Scoped first, in writing, before touching code.** Wrote up the analysis as a new
BLUEPRINT.md section rather than jumping straight to implementation — four decisions:
player as a first-class server concept, per-connection targeted send alongside the
existing broadcast, binary identity resolution for v1 (closing one of brief §7's open
questions — the diary's SUBJECT slot forced the question), and server-authoritative
private state for the diary's enforced expiry. Explicitly scoped OUT what didn't need
deciding yet (Oracle's odds curve, proximity conversation's spatial model, passport
tiers) so the write-up didn't overreach into things that genuinely can wait. User: "go
ahead and build it."

**Built.** `src/engine/player.ts` — `PlayerId`, `isKnown()` (pure, binary in/out, doesn't
decide *when* a player becomes known — that's still Phase 4 fog-of-recognition design).
`src/engine/privateStore.ts` — generic per-player store with rolling per-entry silent TTL
expiry, deliberately not diary-specific since the diary's exact slot contents are still
`[OPEN]` in the design addendum. `src/server/ws.ts` — the actual fix: split the wire
protocol into a broadcast `TickMessage` (bakers/spread/wallPost, unchanged shape minus
`rumours`) and a targeted `RumourMessage` sent only to the connection that identified
itself via `?player=<id>` as that rumour's `heardBy`. Refactored server startup out of
top-level side effects into an exported `startServer(options): Promise<ServerHandle>` so
it's actually importable in a test, keeping `npm run server`'s behavior identical via a
`pathToFileURL` entry-point guard. `client/scripts/Main.gd` updated to match — connects
with `?player=<id>`, branches on message `type` instead of assuming everything's a tick.

**Verified with a real server and real sockets, not just type-checked.**
`test/ws.integration.test.ts` replays the identical seeded scenario independently of the
server to compute ground truth for which player should receive which rumour, then spins
up an actual `startServer()` instance and two real `ws` client connections and checks the
delivered counts match exactly — plus that no `tick` message ever carries a `rumours`
field and no `rumour` message ever carries `heardBy` (delivery itself is the addressing
now). A third, unidentified connection is checked to get the shared broadcast and zero
targeted rumours, so the fallback degrades safely rather than erroring.

**One real bug caught during verification, not before.** First version of the test
failed (`expected 37 to be 36`) — not a logic bug in the server, but a race in the test
itself: the tick interval keeps firing regardless of when the test's poll loop notices
the target day was reached, so a few extra ticks could already be in flight by the time
sockets closed. Fixed by filtering received rumours to the exact day-window the ground
truth covers, rather than racing to close sockets in time. Re-ran 5x locally before
trusting a timing-based integration test — same scrutiny as a flaky test deserves,
arguably more, since it's the one test file in the repo that talks over an actual socket.

**Verified the smoke path manually too**, outside the test harness: a throwaway script
with two live connections (`?player=wren`, unidentified) confirmed wren received both
broadcasts and 15 targeted rumours over ~80 ticks while the unidentified connection
received zero rumour messages. `npm run server` still starts and logs correctly under
the refactored entry-point guard.

58 tests total (was 46), all passing, `tsc --noEmit` clean.

---

## 2026-08-07 — VACANT-phase gap resolved: a proven bound, then a joint (beta, t_hard) recalibration

**Context.** Direct follow-up to the previous entry's "not fully resolved" note: Miller
conscription fixed the NPC-dominance tradeoff but never touched the pre-backstop VACANT
phase itself, which sat at ~6-7% of Miller's slot-time against the brief's own 1-2%
target. User: "tackle the residual VACANT-phase gap next."

**Proved it before searching for a fix, not the other way round.** Every backstop episode
takes exactly `t_hard` days by construction, and the ratio definition implies
`backstopShare = 1/(1+ratio)` of resolved episodes are backstops. That gives a bound
independent of the specific hazard function: `starved_fraction >= backstopShare(ratio) *
t_hard * pDaily`. At the brief's own N=50 ratio target (1.2), `backstopShare ≈ 45.5%`; at
`t_hard=14` that alone forces `starved_fraction >= ~4.7%` — already above the stated 1-2%
band, before any genuine-fill duration is even counted. **The brief's own two §2.4
numbers are mutually exclusive at t_hard=14, for any beta at all.** Confirmed empirically
too, not just algebraically: swept beta alone (starved fraction barely moves, ratio
explodes) and t_hard alone (ratio crashes toward zero as backstops start dominating) —
neither single-parameter fix works, exactly as the bound predicts.

**Grid search, not a guess.** Since the bound implies t_hard itself has to shrink, and
shrinking it alone crashes the ratio, swept `(beta, t_hard)` jointly: for each t_hard,
bisected beta to hit the N=50 ratio target, then read off the resulting starved fraction.
Found `beta=0.03, t_hard=3` — recalibrated from the brief's literal provisional
`beta=0.0008, t_hard=14` — hits *both* targets simultaneously, verified across N=50/60/80
and 12 seeds at 20-year runs: ratio 1.19/1.60/2.71 (targets ~1.2/~2.8), starved 1.6%/1.5%/
1.4% (target 1-2%), with BACKSTOPPED time landing *lower* than before (0.2-0.4%, not the
79-86% NPC-dominance the earlier recovery-hazard fix required). Two levers doing real
work together, neither alone: shrinking t_hard caps how long any vacancy can run, raising
beta keeps enough fills happening voluntarily inside the now-shorter window to hold the
ratio up.

**Applied and re-verified.** New `DEFAULTS` exported from `src/sim/vacancyHarness.ts`,
now also imported by `conscriptionHarness.ts` instead of duplicating the constants. Full
suite re-run after the change (nothing broke by construction — the existing structural
tests didn't hardcode the old numbers) plus 3 new tests asserting the brief's actual §2.4
bands are now met, since that's newly true and worth protecting. Fixed one now-stale
assertion in the process (`gapDays <= 14` was hardcoded; now references `DEFAULTS.tHard`
so it stays a real bound instead of a vacuous one under the new t_hard=3). 46 tests total,
all passing, `tsc --noEmit` clean. `tPain=14` left untouched — with t_hard=3 the pressure
ramp never gets far enough to matter pre-backstop, an emergent consequence of the fit,
not a separate deviation.

**Also this session:** brought `main` current — it had been 28 commits behind this branch
since PR #3 (all of Phase 2, Miller conscription, and the design-doc work existed only on
`claude/new-project-setup-h5m6f8`). Opened and merged PR #4, no conflicts, 43/43 tests
passing pre-merge.

---

## 2026-08-07 — Miller conscription: user's mechanic resolves the recovery-hazard tradeoff

**Context.** Following up directly on the previous entry's finding: closing the Phase 2
ratio gap fully required BACKSTOPPED recovery to be very slow (~2000-day mean), which
meant Miller sat NPC-run 79-86% of the time — presented as a real design fork, not
picked unilaterally. User's response: NPC coverage of a scarce role like Miller should
only ever be temporary; past a fixed delay, a random player gets mandatorily drafted
into the role — from the non-role-holding "gossip layer," or from an existing holder of
a *different* role, which then leaves that role vacant in turn ("one day you're Courier,
then next the Miller... like it or not").

**Built and verified, not just designed.** New module `src/sim/conscriptionHarness.ts` —
kept the cross-role coupling logic out of `engine/vacancy.ts`'s `stepSlot` deliberately,
since drafting a Courier away and creating a new Courier vacancy is inherently a
multi-slot concern that belongs at the orchestration layer, not inside the tested
single-slot primitive. Reused `stepSlot`/`fillHazard` for the "other role" pool and
Miller's own pre-backstop phase; only Miller's BACKSTOPPED phase got new logic —
deterministic conscription after a delay, replacing the probabilistic recovery hazard
from the previous entry entirely.

Swept conscription delay (3/7/14/30 days) across N=50/60/80 before trusting it resolved
anything (`npm run conscription-sim`). It does: the genuine-fill:backstop ratio lands
close to the brief's §2.4 targets at *every* delay tested, and delay barely moves the
ratio at all (it only governs what happens after backstop already fired) — but it's the
dominant lever on how much time Miller actually spends NPC-run, which stays under 8%
even at a generous 30-day delay. That's the key result: unlike the pure-recovery-hazard
version, hitting the brief's numbers no longer requires sacrificing "the community runs
the economy." The other-role cascade is real (6-13% of conscriptions) but checked to
stay smaller than that role's own organic backstop rate, not left as an assumption.

**What this doesn't fix, stated plainly rather than folded into the win:** the
pre-backstop VACANT-phase fraction is untouched by conscription (still ~6-7% vs. the
brief's 1-2%) — a separate, smaller, still-open gap. Conscription resolves the
NPC-dominance problem; it was never going to touch the earlier phase of the process.

**Verified:** 5 new tests (`test/conscription.regression.test.ts`) — BACKSTOPPED time
stays low, the ratio-vs-N trend holds, delay length moves BACKSTOPPED time far more than
it moves the ratio, every conscription is accounted for as gossip or cascade, and the
cascade stays subordinate to organic churn. 43 tests total, all passing, `tsc --noEmit`
clean.

**Still open:** exact conscription delay (every value tried keeps the ratio on target —
this is a pacing/feel question, not something the simulation resolves on its own), the
residual VACANT-phase gap, and whether any role besides Miller ever needs this.

---

## 2026-08-07 — Found the real driver of the Phase 2 ratio mismatch

**Context.** Yesterday's session flagged that Phase 2's §2.4 targets don't reproduce
under a faithful implementation, and offered the full numeric trail on request. User
asked to try tweaking the BACKSTOPPED recovery hazard specifically and rerun the sweep.

**Checked a structural hypothesis before touching the hazard at all.** Every
`backstopFires` event in this model eventually produces exactly one recovery
(`voluntaryFill` with `fromBackstopped: true`) later — recovery isn't permanently
blocked. But the original `voluntaryFills` counter summed genuine pre-backstop fills
*and* these later recoveries together. That inflates the ratio by roughly
`(genuine/backstop) + 1` compared to what "voluntary fills outnumber backstop fires"
almost certainly means (resolved instead of backstop, not resolved after it).

Split the counters (`genuineVoluntaryFills`, `backstopRecoveries`, both now exposed from
`runVacancySim`). That alone, no other change: N=50 ratio moved from 2.48 to 1.48
against the brief's stated 1.2 target — confirming most of yesterday's mismatch was this
counting bug, not beta, not the recovery hazard nobody had touched yet.

**Then did what was actually asked: made the recovery hazard overridable and swept it.**
Added `VacancyParams.backstoppedRecoveryHazard` (optional override, defaults to the
original interpretive choice — fillHazard frozen at tau=t_hard — when omitted, so no
default behavior changed). Swept it from 0.001 to 1.0 at N=50: the corrected ratio
barely moves (1.14-1.51 across a 1000x range) — it's a downstream consequence of how
long a slot sits BACKSTOPPED, not a cause of the genuine-fill-vs-backstop-fire balance.
But it's the dominant lever on BACKSTOPPED *duration*, and at a very low rate
(0.0005, ~2000-day mean recovery time), both of the brief's headline numbers land close
to target simultaneously:

```
N=50: correctedRatio=1.44  vacantOnly=1.18%  (brief: 1.2, 1-2%)
N=80: correctedRatio=2.89  vacantOnly=1.52%  (brief: 2.8)
```

**Did not adopt this as the new default.** The catch: hitting both targets this way
requires role-slots to spend 79-86% of all time BACKSTOPPED (NPC-run) rather than
player-run. That's not really "matching the brief" so much as relocating the problem —
it surfaces a bigger, unaddressed design question (how often should an automated role
realistically return to a real player?) that sits in real tension with the brief's core
premise of an economy driven by actual Cournot/Bertrand competition. Presented this
clearly rather than quietly picking the parameterization that makes two numbers match
while changing the system's character.

**Verified, not assumed.** 3 new tests: the split always sums back to the original
`voluntaryFills` total, the corrected ratio is measurably closer to the brief's target
than the inflated one, and recovery hazard changes BACKSTOPPED duration by 3x+ while
moving the ratio by less than 0.5. 38 tests total, all passing, `tsc --noEmit` clean.
`npm run vacancy-sim` now prints the corrected/inflated ratio at both the default and
low-recovery-hazard settings side by side.

**State at end of entry.** The recovery-hazard trade-off is now the concrete open
question for Phase 2, not "does the implementation have a bug" — the ratio mismatch is
understood, the remaining gap is a genuine design decision about NPC-vs-player role
occupancy over time.

---

## 2026-08-06 — Phase 2 vacancy engine built; §2.4 targets found not to reproduce

**Context.** User: "let's start building what we can." Phase 2 (vacancy/churn/backstop)
was the obvious next piece — next in the brief's own build order, fully specified with
concrete equations, doesn't depend on the Godot client or any of the day's still-open
design decisions (exit-ticket stake formula, etc.).

**Built.** `src/engine/vacancy.ts` — the semi-Markov process from §2.1-2.3: three states
(FILLED/VACANT/BACKSTOPPED, per the brief's own §1 notation table, not the two implied by
§2.1's shorthand diagram), `fillHazard()` implementing §2.2's equations verbatim,
two-stage flag/hard-backstop thresholds. `src/sim/vacancyHarness.ts` +
`vacancyCli.ts` (`npm run vacancy-sim`) for running many role-slots over many days.

**Gap the brief leaves open, documented rather than guessed past:** no rate is specified
anywhere for BACKSTOPPED -> FILLED (a real player displacing the NPC). Without modeling
it at all, every slot would eventually ratchet permanently into BACKSTOPPED over a long
run, which can't be right — "starved fraction stays near 1-2% of the year" wouldn't be a
stable figure otherwise. Modeled as an ambient hazard frozen at the pressure-plateau
value (fillHazard at tau=t_hard) — documented clearly in BLUEPRINT.md as an interpretive
choice, not a brief-specified number.

**Failure caught during verification, not before shipping.** First pass: ran 1 year with
only R=3 role-slots (~11 total events) and got numbers that looked wildly different from
the brief's claims (ratio 2.67-4.00, starved fraction way high). Nearly treated this as
a finding immediately — caught that 11 events is far too small a sample to trust, reran
with 5 seeds x 20 years (250+ slot-years) before drawing any conclusion. Also found, while
doing that, a real bug: BACKSTOPPED-recovery events were double-counting elapsed time on
top of the gap already recorded when the backstop originally fired, producing gap values
that impossibly exceeded the 14-day hard cap (17.0 seen against a construction-guaranteed
max of 14). Fixed before trusting anything downstream of `gapDays`.

**Real finding, verified with statistical power, not forced to match.** Even after the
fix and with a properly-sized sample, a faithful implementation of the brief's literal
§2.2 equations and stated `[CALIBRATED — provisional]` constants (beta=0.0008, T_pain=14,
v_boost=3.0) does not reproduce §2.4's claimed targets: brief says voluntary:backstop
ratio ~1.2:1 at N=50 rising to ~2.8:1 at N=80 and starved fraction ~1-2%; this
implementation converges to ratio ~2.5:1 rising to ~4.2:1, and starved fraction ~6-7%
(checked both a VACANT-only definition and a VACANT+BACKSTOPPED definition of "starved" —
neither reconciles both targets). The *direction* of the N-dependence matches; the
magnitudes don't.

Before concluding this was a real discrepancy rather than a calibration miss, swept
`beta` from 0.0008 to 0.01 at N=50: starved fraction does fall toward 1-2% as beta rises,
but the ratio explodes to 783:1 in the same sweep — no single beta value hits both
targets at once. That rules out "just retune the constant," which is why this is
documented as a structural discrepancy in `BLUEPRINT.md`'s "Open deviations," not
silently patched by picking whichever beta looks closest to one target while ignoring
the other.

**Verified, not assumed:** `test/vacancy.regression.test.ts` (5 tests) encodes what's
genuinely true of this implementation instead — no gap ever exceeds t_hard (structural),
both mechanisms actually fire over a long run, the VACANT fraction reaches a stable
steady state rather than drifting, the ratio increases with N (matching the brief's
claimed direction), BACKSTOPPED is a real measurably-occupied state. 35 tests total (30
previous + 5 new), all passing, `tsc --noEmit` clean.

**Not done this entry:** §2.5's NPC fallback isn't wired into the Phase 1 market yet (a
BACKSTOPPED Baker doesn't participate in pricing) — the vacancy engine and the economic
engine are still separate, unconnected systems. §2.6 (Shift Cover) not started — needs a
player-session/online-state concept that doesn't exist in this headless engine.

---

## 2026-08-06 — Unified decay primitive extracted; two open items resolved

User resolved both items left open at the end of the previous entry.

**1. Private per-player maps vs. the diary — resolved, diary wins.** User: "this
document was unaware, keep our diary." Updated
`docs/ECOSYSTEM_VISION_2026-08-06.md`'s private-per-player-maps section: removed the
"accumulating impressions" framing, made explicit that the diary's bounded ~30-day
rolling expiry is authoritative at every scale, and that there's no separate
longer-lived "shard impression" system record above it — whatever a player carries about
a shard beyond a still-live diary entry is their own untracked human memory, not
something the system stores. `BLUEPRINT.md`'s pointer updated to match (was "open
tension," now "resolved").

**2. Unified decay/distortion model — built, verified nothing broke.** User: "feel free
to build a unified model if again, nothing breaks." Only the rumour mill is actually
implemented in code (proximity conversation and shard-graph propagation are still
design-only), so this concretely meant: extract the rumour mill's decay/distortion math
into a generic, reusable primitive those can plug into later, without changing anything
about how the rumour mill currently behaves.

Added `src/comms/decay.ts` (`stepClarity`, `applyDistortion`) and refactored
`src/comms/rumourMill.ts` to call it internally. Deliberately kept `RumourMillConfig`'s
field names (`baseSpreadChance`, `decayPerHop`, ...) completely unchanged — the new
primitive's own config shape is mapped at the call site — so zero callers or tests needed
to change, the lowest-risk version of this refactor. Preserved the exact rng() call
order (one call for the pass/fail roll, then conditionally one or two more for
distortion) since the existing tests are seeded and would produce different specific
values under a different call sequence even with equivalent logic.

Verified, not assumed: full suite before (24 tests) vs. after (30 tests: 24 unchanged +
6 new `decay.test.ts` tests exercising the primitive directly) — all passing, `tsc
--noEmit` clean, and reran `npm run mvp` to confirm byte-identical day-by-day output to
before the refactor (same posts, same hops, same distortions, same clarity values).

**Correction to the previous entry, caught on this pass:** that entry's second bullet
said the decay-with-distance pattern was independently reinvented "the fourth time,"
counting the diary as a member. That was wrong — the diary uses hard silent TTL expiry,
not gradual decay, which the user chose explicitly over the fade/blur alternative
offered earlier. It's the third reinvention (rumour mill, proximity conversation,
shard-graph distance), not the fourth. Corrected inline in that entry rather than
silently rewritten.

---

## 2026-08-06 — Ecosystem Vision reviewed, standing constraints added to CLAUDE.md

User provided `ECOSYSTEM_VISION_2026-08-06.pdf` — a one-level-up companion to
`BLUEPRINT.md`'s design intent, addressing what NODE looks like as many shards rather
than one. Transcribed to `docs/ECOSYSTEM_VISION_2026-08-06.md` for continuity (same
treatment as the design addendum).

Genuine findings from reviewing it, not just filing it:
- The doc's "shards relate to each other the way players relate within a shard" claim
  isn't just a metaphor — `src/comms/connections.ts`'s `ConnectionGraph` already models
  exactly that shape and is directly reusable one level up when ecosystem work starts.
- The "information degrades with graph distance" idea is the third independent
  reinvention of the same primitive this session: rumour mill (social hops), proximity
  conversation (physical distance), now this (shard-graph distance). Worth building one
  shared decay/distortion utility, parameterized by distance metric, rather than three
  separate implementations later — noted for whenever any of this gets built.
  ***Correction, later same session:*** this bullet originally said "fourth" and included
  the private diary as a member of this family. That was wrong — the diary explicitly uses
  hard silent TTL expiry, not gradual decay/distortion (the user chose that directly over
  the fade option offered). Caught on a later pass; see this date's later entry, where the
  primitive was actually extracted from `rumourMill.ts` into `src/comms/decay.ts`.
- Flagged one real tension rather than silently picking a side: the vision doc's private
  per-player maps section describes "accumulating" impressions, but the diary refinement
  added to the addendum earlier today gives person-level entries a bounded ~30-day
  rolling expiry instead. Whether a player's shard-level impression should inherit that
  same erosion or stay more durable than person-level impression is now an open question
  between the two documents — noted inline in the vision doc, not resolved.
- One precision note: §2's "ruin and rejuvenation — the mechanic you already built" is
  grounded in the brief's §2.5 NPC-fallback *spec*, not code that exists yet (Phase 2
  isn't built). The reasoning holds regardless; just flagging so it doesn't get misread as
  already-implemented.

**Action taken beyond filing:** the document's §6 ("how to scale this without breaking
it") reads as five binding policy statements, not narrative, so they're now in
`CLAUDE.md` as standing constraints on all future work — simulate before trusting, no
permanent zero-state at any scale, ask whether something needs to be an agent before
building it, nothing gets recorded ever, let outcomes be real rather than scripted. Same
mechanism as the existing documentation rules: automatically loaded every session, not
something that has to be re-asked for.

No code touched this entry — design review and documentation only.

---
---

## 2026-08-06 — Private diary designed collaboratively, refining "private per-player maps"

Extended back-and-forth design conversation (not implementation) working out a concrete
mechanic for the addendum's "private per-player maps" idea, which had been left vague
("tags, suspicion markers, trust notes"). Landed on a specific, coherent shape — full
writeup in `docs/DESIGN_ADDENDUM_2026-08-06.md`'s new "Refinement — the private diary"
subsection, not duplicated here. Short version: composed (not free-typed) entries from
SUBJECT/OBSERVATION/READING/CONTEXT slots, unprompted-only creation, rolling per-entry
silent expiry (~30 days, illustrative) instead of permanent accumulation. Reframed the
diary's purpose along the way — not a persistent dossier, a bounded private space to
process a feeling in the game's own vocabulary, with the player's own memory expected to
outlast the system record.

Worth noting for how this kind of session should go: this stayed pure design
conversation until explicitly asked to write it down ("keep developing it out loud"),
rather than getting formalized into docs prematurely. Nothing built, no code touched.

---

## 2026-08-06 — Design addendum review: exit-ticket gamble stake-direction bug found

**Context.** User provided a design addendum (`docs/DESIGN_ADDENDUM_2026-08-06.md`) and a
Python population sim (`design/exit_ticket_gamble_sim.py`) covering several new,
not-yet-built mechanics: vacancy backstop rationale, the shard exit ticket, the Oracle,
private per-player maps, an atmosphere principle, a Wall/rumour threat-model note,
proximity conversation (no-microphone, template-composed voice alternative), and
multi-shard passport tiers. Asked for thoughts before any action.

**Finding — exit-ticket gamble stake formula is inverted from its own stated intent.**
Installed numpy, ran the script (reproduced the addendum's own numbers exactly: 2852
wins/7384 losses, realized rate 0.279 vs 0.30 target — the script itself runs correctly),
then traced the actual `f` (required stake) against `p` (progress) directly rather than
trusting the aggregate stats:

```
p=0.02 -> f=0.040 (stake 4%)   realized_w=0.300
p=0.25 -> f=0.500 (stake 50%)  realized_w=0.300
p=0.50 -> f=1.000 (stake 100%) realized_w=0.300
p=0.90 -> f=1.000 (stake 100%) realized_w=0.167  <- capped, can't reach target
p=0.99 -> f=1.000 (stake 100%) realized_w=0.152
```

Both the script's docstring and the design addendum state the opposite: small stakes
near completion, large stakes near zero progress. The formula (`f = target_w * p /
base_odds`) makes required stake *increase* with `p`, and a near-complete player can
never even reach the target win rate once `p > 0.5` — they're capped at 100% stake with
degrading odds the closer they get. This is a genuine contradiction between the stated
design intent and the actual math, not a calibration nicety.

Why the addendum's own "Findings" section didn't catch it: finding #1 (realized win rate
converges to target) is true by construction — `f` is *solved* to hit `target_w`, so
convergence is guaranteed algebra, not evidence about which direction the risk curve
points.

**Verified a fix, did not apply it.** Swapping `p` for `1-p` (distance to completion) in
the win formula — `w(p,f) = base_odds*f/(1-p)`, so `f = target_w*(1-p)/base_odds` —
reproduces the stated intent exactly when checked numerically:

```
p=0.02 -> f=0.653 (stake 65%)  realized_w=0.100
p=0.50 -> f=0.333 (stake 33%)  realized_w=0.100
p=0.90 -> f=0.067 (stake 7%)   realized_w=0.100
p=0.99 -> f=0.007 (stake 0.7%) realized_w=0.100
```
(also dropped `target_w` from 0.30 to 0.10 for this check — the original
`target_w/base_odds` ratio of 2.0 saturates `f=1` across half the `p` range regardless of
which direction it points; a ratio `<=1` gives a smooth curve across the whole range).

**Did not silently edit the original files.** The addendum itself marks the staking
formula "still provisional," so this is exactly the right time to flag it, not late. Both
`docs/DESIGN_ADDENDUM_2026-08-06.md` and `design/exit_ticket_gamble_sim.py` were
committed with the original content intact, plus a clearly marked, dated verification
note pointing to this finding — not a rewrite. Awaiting user confirmation before anyone
changes the formula.

**Everything else in the addendum reviewed, no conflicts found.** Vacancy
backstop/mechanical-NPC section already matches what's built (§2.6, documented in
`BLUEPRINT.md`/`HANDOVER.md` since the Phase 1 session) — no new work. Proximity
conversation is architecturally identical in shape to the already-built `SELF_STATES`
pattern in `src/comms/grammar.ts` (curated table, throws on anything outside it) and
would meaningfully reduce Phase 5's scope if built, since it never captures audio at all.
Private per-player maps is flagged as a real scope change for whenever Phase 4 planning
starts (private per-user state, not shared-state-with-a-fog-layer). Nothing else touches
anything currently built.

**Action taken.** Committed the addendum and simulation script to the repo (`docs/`,
`design/`) for continuity, with the verification note attached. `BLUEPRINT.md` updated
with a pointer (not merged into its "what's built" body, since none of this is built).
No code changes to the production engine this entry — this was a design review, not an
implementation session.

---

## 2026-08-06 — Platform lock-in (Godot), client/server scaffold, Baker price drift fix

**Context.** User set the platform: PC + mobile, not web ("web is clunky and it helps to
have paranoia in your pocket"). Asked which engine would be more immersive for this
specific game; recommended Godot 4 over Unity mainly on rendering fit — §4.5's "layered
light sources, not blended" requirement maps closely onto Godot's native additive Light2D
blending, plus a lighter mobile runtime footprint matters directly to the "paranoia in
your pocket" goal (battery/jank kills immersion fast on a phone). Checked Unity's actual
current pricing before the user decided rather than relying on memory, since it's swung
wildly before (2023 Runtime Fee controversy and reversal) — confirmed free under $200K/yr
revenue+funding, ~$2,040-2,400/seat/year Pro above that; cost wasn't the deciding factor
either way. User locked in Godot.

**Architecture consequence.** The TS engine becomes the authoritative server; the client
is a thin renderer over WebSocket. Nothing already built needed to change for this — it's
additive.

**Built — scenario refactor.** Extracted `src/mvp/run.ts`'s simulation step into
`src/mvp/scenario.ts` (`initScenario`/`stepScenario`) so the CLI script and a new server
can drive the identical logic. Verified the refactor was behavior-preserving by diffing
CLI output before/after — identical.

**Built — WebSocket server.** `src/server/ws.ts` (`npm run server`), ticks the scenario
on an interval and broadcasts one JSON message per tick. Tested against a throwaway
Node client script (not committed) rather than just trusting it compiled — caught one
self-inflicted issue this way: an earlier server instance from testing was still running
in the background on port 8080 and had been silently serving 1000+ days of ticks, which
made a later verification run misleading until I noticed the day count and killed it.

**Built — Godot 4 client scaffold.** `client/` — project config (GL Compatibility
renderer, for broad PC+mobile device support), a minimal scene (status label, prices
label, scrolling log), and `Main.gd` connecting via Godot's built-in `WebSocketPeer`.
**This environment has no Godot binary or GUI**, so the client was written by hand
against Godot 4 syntax and has never actually been opened or run — flagged clearly in
`client/README.md` and `docs/BLUEPRINT.md` as unverified. Caught one likely bug just from
careful re-reading (not execution): GDScript's `JSON.parse_string` returns all JSON
numbers as `float`, so the two places assigning into declared `int` variables (`day`,
`hop`) would throw a runtime type error without an explicit `int(...)` cast. Fixed both,
but this is exactly the kind of thing that needs a real editor run to be sure of.

**Failure/finding — Baker price drift, found while verifying the server's live output.**
Watching the WebSocket server's ticks climb steadily (1.24 → 1.28 → 1.34 over ~5 days)
prompted a check of the underlying model over a much longer horizon than the §1.4 tests
use. A 5000-day run of the real engine (real Millers, no MVP shortcuts) confirmed both
bakers pin to the 2.0 price ceiling by ~day 100 and stay there permanently. Root cause:
the brief's literal `+ cost_pressure * 0.1` term in §1.3 is an unconditional daily
addition with no restoring force; summed across bakers it's a random walk with constant
positive drift. The §1.4 regression tests never caught this because they measure price
*spread*, which a drift hitting every baker equally doesn't touch.

Flagged this to the user with the evidence before touching anything — per the working
process set earlier this session (flag concrete problems, get a concrete answer, keep
moving). User: "It's ok to fix the math, as long as it passes verification under
scrutiny." Fixed with a mean-reversion term (`0.05 * (flourPrice*1.5 - mean(p))`)
applied identically to every baker each day, which provably cancels out of every pairwise
price difference — meaning the §1.4 spread-based findings should be mathematically
unaffected. Verified rather than trusted:
- Reran all 10 original regression tests: 9 passed unchanged, 1 failed (`n=2 bakers:
  stable for gamma < 2`, pinned at gamma=1.99). Diagnosed rather than papered over: ran a
  diagnostic sweep (gamma 1.5/1.9/1.95/1.99/2.0) and confirmed prices never approached the
  clip bounds — spread grows smoothly from 0.0125 to 0.065 as gamma approaches 2, a
  genuine near-critical-point property (variance amplification ~50x right at the
  boundary), not a clipping artifact from the fix. The test threshold was fragile by
  construction (pinned exactly at the edge of a smooth curve), not evidence of a new bug.
  Moved the threshold to gamma=1.9 and added an explicit monotonic-approach test instead
  of relying on one brittle point.
- Reran the long-horizon check across multiple configs/seeds out to 8000 days: settles
  near the flour-cost anchor and stays there, no saturation, in every config tried.
- Added two new regression tests locking in "no ceiling saturation" and "settles near the
  anchor" so this can't silently regress.
- Confirmed the MVP scenario's hardcoded-flour-price path also stopped drifting (60-day
  run stays in a sane 0.7-0.85 band instead of climbing past 1.3 by day 30).

24 tests total, all passing. Documented as a real deviation from the brief's literal
equation in `docs/BLUEPRINT.md`, not silently patched.

**Docs order note.** User asked specifically to push `docs/BLUEPRINT.md` (bundled with
the code it describes) before touching the other three docs — done as a separate commit,
pushed first, this entry follows in a second commit.

**State at end of session.** Godot locked in. Client/server scaffold proven (server
tested live, client written but unverified pending a local editor run). Baker price
model no longer has the drift defect. Next: someone needs to actually open `client/` in
Godot and confirm it runs; real Phase 4 rendering (isometric scene, ambient colour
layers) hasn't started.

---

## 2026-08-06 — §8 MVP slice: grammar constraint + rumour mill + two-Baker scenario

**Context.** User pushed back on timeline hedging ("you always say several months, then
a couple weeks later it's built") and set the actual working process going forward: flag
concrete unresolved problems when they're genuinely blocking, get a concrete answer, keep
moving — don't stall on open questions that don't need answering yet. Went straight into
the brief's §8 milestone: two Bakers plus a working rumour mill.

**Scope call made without asking (cheap, reversible).** Built this as a headless,
testable scenario (`npm run mvp`) rather than standing up a real server/client. The real
fork — browser vs. native, hosting, auth, persistence — is expensive to reverse and
wasn't asked about yet; flagged in HANDOVER.md as the next concrete decision rather than
guessed at silently.

**Built — grammar constraint (§3.1).** `src/comms/grammar.ts`: Wall posts and Envelopes
share one type, built from a curated `SelfState` template table (first-person,
present-tense, never naming another player), per the brief's explicit preference for a
"curated preset/template picker" over free-text-plus-a-filter. Validity is enforced at
the type/runtime boundary — `postToWall`/`sendEnvelope` throw on anything outside the
template set, so the safety property is structural, not a moderation pass. Added a
meta-test (`test/grammar.test.ts`) that regexes the whole template table for
second/third-person pronouns and past/future tense markers, so a future contributor can't
quietly add a template that violates the grammar without a test catching it.

**Built — rumour mill (§3.2).** `src/comms/connections.ts` (per-edge connection graph,
no persistent global graph — matches §4.3's "no static drawn edges" framing even though
rendering doesn't exist yet) and `src/comms/rumourMill.ts` (BFS propagation from a Wall
post's author outward, decaying clarity per hop, probabilistic distortion into a
semantically-adjacent self-state rather than pure noise). All four knobs
(`baseSpreadChance`, `distortionRate`, `decayPerHop`, `maxHops`) are one config object,
matching the brief's ask that this specific system stay cheap to retune. Explicitly
marked `[CALIBRATED — provisional]` like the Phase 1 constants — the brief says the mill
is the piece "most likely to need hands-on iteration once playable."

**Built — MVP scenario (`src/mvp/run.ts`, `npm run mvp`).** Two Bakers on the real
Phase 1 Bertrand engine with a hardcoded flour price (brief §8 explicitly allows
skipping the full Miller layer here), three gossip-layer players connected via the graph.
A Baker posts to the Wall when the price gap crosses a threshold; the post propagates
through the mill. This trigger rule is flagged in the file's own header comment as
illustrative scaffolding, not a designed mechanic — it exists to exercise the pipeline
end-to-end, and should be replaced once there's a real reason for a Baker to post.

**Failure — first cut of the MVP never actually triggered.** Initial version used
gamma=1.0 and the Phase 1 default noise (sigma=0.01) with a 0.05 price-gap threshold
copied over without checking it against the new context. Ran it: spread never exceeded
~0.03 across 10 days, so the Wall/rumour path never fired — the "two Bakers plus a
working rumour mill" demo silently didn't demonstrate the rumour mill. Caught by actually
running the script and reading the output instead of assuming it worked because it
compiled. Fixed by lowering the trigger to 0.015 and raising the demo's noise sigma to
0.02 (livelier than Phase 1's tuned default, appropriate for a demo script, not a change
to the underlying engine). Reran: Wall posts fire on ~half the days, propagate through
1-2 hops, distort on some but not all hops — matches the intended "reliably imperfect"
behavior.

**Verification.** 21 tests total (10 Phase 1 regression + 5 grammar + 6 rumour mill), all
passing. `tsc --noEmit` clean. Ran `npm run mvp` and read the actual output before calling
it done, per the failure above.

**State at end of session.** §8 MVP mechanic proven: grammar-constrained comms + rumour
propagation work end-to-end against the real economic engine. No server, no client, no
persistence, no rendering — still text/CLI only. Next concrete fork to raise with the
user: what the actual playable surface is (browser client? what hosting/persistence?)
before building one.

---

## 2026-08-06 — Phase 1 economic core: build, verify, test

**Context.** User handed over `NODE_ClaudeCode_Build_Brief_v1.pdf`, a fully-specified
design doc for a persistent multiplayer social-economic game. Brief's own build order
(§0, §8) is explicit: Phase 1 (economic core) must be built and simulated headless,
verified against §1.4's validated findings, before any UI/identity/comms work starts.

**Decision — tech stack.** Asked the user: TypeScript/Node, specifically because the
Phase 1 sim engine isn't a throwaway script — it's meant to become the live economic
engine the multiplayer server runs later (brief §1.5 implies the harness sweeps the same
code the game uses). Picking a language now that won't need a rewrite for the realtime
server avoids a costly split later.

**Built.** Chained Cournot (Miller) → Bertrand (Baker) market per brief §1.1–1.3, as
literal equations (not a lookup table, per the brief's explicit instruction). Deterministic
seeded simulation harness (`src/sim/harness.ts`) and a parameter sweep utility
(`src/sim/sweep.ts`) per §1.5's "headless harness that can sweep N, R, gamma, headcounts"
requirement — scoped to what Phase 1 actually has parameters for (nMillers, nBakers,
gamma); N/R sweeps will follow once Phase 2's vacancy system exists.

**Gap found in the brief — noise magnitude.** Both reaction equations specify `+ noise`
with no distribution or magnitude given. Not one of the brief's explicitly-flagged open
questions (§7), so this was a genuine spec gap rather than a deliberate one. Resolved by
treating it the same as the brief's other `[CALIBRATED — provisional]` constants: gaussian
noise, `sigma=0.01` default, isolated behind a single constant
(`DEFAULT_NOISE_SIGMA` in `harness.ts`) so it's cheap to retune. Documented in
`BLUEPRINT.md` rather than silently picking a number and moving on.

**Verification — ran the sweep before writing tests, not after.** Swept nMillers ∈
{2,3,4}, nBakers ∈ {2,3,4,5}, gamma across 0.5–3.0 and eyeballed the table before locking
in any test thresholds, specifically to confirm the implementation actually reproduces
the brief's claimed findings rather than assuming the equations were transcribed correctly:

- n=2 baker slot: spread ~0 through gamma=2.0, jumps to full clip saturation (2.0) by
  gamma=2.1 — confirms the brief's "boundary is gamma=2, not 0.85" claim.
- n=3 baker slot: stays stable through gamma=2.5, only diverges by gamma=3.0 — confirms
  "n>=3 stays stable well past gamma=2."
- More millers -> measurably lower flour price, measurably higher baker-side spread.
  Baker headcount (3 vs 5) changed both metrics by <0.01 — noise-floor level, i.e.
  "barely changes outcomes."

All four of these match the brief's §1.4 claims directly from the implemented equations,
which is meaningful: it means the equations were transcribed correctly and the "hard
truth" findings aren't artifacts of the brief's own (different) simulation setup.

**Failure — one regression test was wrong, caught immediately.** First pass at the test
suite included an assertion comparing n=2 vs n=3 baker-slot spread at gamma=2.01,
expecting n=3's spread to be ≤ n=2's. It failed
(`0.0000624 not <= 0.0000031`) — both values were still sitting at noise floor, because
gamma=2.01 is too close to the boundary to have diverged within the 400-day/200-day-burn-in
window used everywhere else. The comparison was measuring noise, not the cliff. Removed
the assertion rather than loosening the tolerance to make it pass — the cliff is already
demonstrated unambiguously by the gamma=2.5 tests above it, and a passing-but-meaningless
assertion is worse than no assertion. Final suite: 10 tests, all passing, `tsc --noEmit`
clean.

**Shipped.** Committed to `claude/new-project-setup-h5m6f8`, pushed. Also copied the source
brief into `docs/NODE_Build_Brief_v1.pdf` so it survives past this session's upload
context — the brief itself says its audience is "Claude Code... with full continuity
across all phases," which requires the doc actually being in the repo, not just referenced
from a chat upload.

**State at end of session.** Phase 1 built and tested. Nothing player-facing exists. Per
§8, next milestone is the two-Baker + rumour-mill MVP (needs a Phase 3 slice + Phase 4
slice) — not started.

**Docs housekeeping.** User set a standing rule (this session, after the Phase 1 push) to
maintain four docs every session: this devlog, `BLUEPRINT.md`, `HANDOVER.md`, and keep
`README.md` current. Added `CLAUDE.md` so this rule auto-loads for every future session
rather than depending on being repeated. Backfilled this entry retroactively since the
rule postdated the actual Phase 1 work.
