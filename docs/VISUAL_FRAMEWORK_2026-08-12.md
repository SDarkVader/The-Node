# Visual Framework — 2026-08-12 (extended 2026-08-13)

Closes both `[OPEN]` items from `docs/DESIGN_ADDENDUM_2026-08-08.md` §4, corrects a stale role
list in `docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §3, and locks the district/plaza layout
concretely against real generated geometry rather than leaving it as an unplaced landmark.
This is a design document — no Godot code changes here — but every rule below is written to
be directly implementable against fields that already exist in the shipped engine, not
aspirational language. Where something needs a small new field to be buildable, that's called
out explicitly as a deliverable, not glossed over.

**2026-08-13 addition (§8)**: `docs/DESIGN_ADDENDUM_2026-08-13.md`'s three-wedge/plaza/gate
geometry and its accompanying concept art are folded in as real design input — the user's own
instruction: the art is modelled FROM the architecture, not decoration. §8 also surfaces a
real, unresolved conflict between that geometry (which commits to exactly 3 districts per
shard) and the district topology actually adopted the same session (6 scattered districts,
chosen by real sweep numbers) — flagged with the measured trade-off, not picked silently.

**Standing doctrine, restated because it's the whole point**: this is not a generic city. Not
a voxel block-world, not a reskin, not a "one-shot" throwaway aesthetic — a specific, organic,
node-shaped settlement whose every visible signal is a real number from the simulation. The
2026-08-07 brief's §3 table is the founding law of this project's visual design and nothing
below overrides it — this document extends it to cover everything built since.

---

## 1. The central landmark question, resolved: the Wall occupies the shard hub

`docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §5 specified the Wall must sit "at true center,
equidistant from all districts, never belonging to one." At the time that was aspirational —
no such point existed in the generated geometry. It does now, and has since Phase A:

`src/engine/space.ts`'s `generateShardLayout()` already computes `const hub = { x: 0, y: 0 }`
and routes every district's plaza back to it via `corridorPlots()` — literally the one point
every district connects to and none of them own. This is not a coincidence worth reusing;
it's the same shape the brief specified, already built for an unrelated reason (keeping the
shard one walkable graph). The Wall's location is not a new design decision — it's recognizing
a decision space.ts already made.

**Deliverable, small and mechanical**: `Shard` doesn't currently expose the hub as a named
field — it's an implicit convention (`(0,0)`, same for every shard) rather than documented
state. Add `Shard.hubPlot: { x: 0; y: 0 }` (or equivalent) so a renderer — or any future
consumer — reads it as a real field, not tribal knowledge of what `generateShardLayout`
happens to do internally. This is the one piece of this document that's an actual code change,
not just a reading of what exists; everything else below is real today.

## 2. The Market, resolved: it is not a new landmark, it is the busiest core district's plaza

The brief's §5 also named "The Market/central plaza" as a separate landmark from the Wall —
"an open gathering space... where trade and Importer/Exporter activity is visually implied."
Building a second shard-level structure alongside the Wall would duplicate geometry `space.ts`
already generates per-district (`District.plazaPlot`, one per district, real today).

**Resolution**: the Market is not a distinct structure. It is whichever CORE district's own
plaza currently reads hottest on Economic Heat (`engine/economicHeat.ts`'s `districtEconomicHeat()`,
shipped 2026-08-11) — the "first-mover density" effect the brief's §3 table already calls for
("the oldest/most-established cluster should visually read as denser and hotter... without
being labeled as such") falls out of this for free, because a genuinely busier district *is*
economically hotter, not by authorial fiat. No new mechanic, no new geometry — a rendering rule
that reads two fields that already exist (`District.classification === 'core'`,
`districtEconomicHeat()`'s output) and picks the max. If two core districts tie, break by lower
district array index — deterministic, matching this project's own convention everywhere else.

This also fixes an implicit assumption in the original brief that doesn't hold at the shipped
scale: the brief pictured one obvious center. The shipped default config has **2 core
districts**, not one (`DEFAULT_SHARD_CONFIG.coreDistrictCount = 2`). The Market can genuinely
move between them over a shard's life as one core district out-trades the other — which is a
better, more alive result than a landmark nailed to one place forever, and it costs nothing to
compute.

## 3. The Wall's Emissive Soul, resolved: the open aggregation function

`DESIGN_ADDENDUM_2026-08-08.md` §4.1 left the damping/aggregation function undecided — "tone
down the colours" was directional, not a formula, and flagged that a raw unweighted aggregate
skews warm/negative by default (7 of 10 `SELF_STATES` are tension-cluster, only 3 are
positive). That document's own candidate was "recency-weighted decay, the same shape as the
rumour mill's clarity decay" — and this session built exactly that shape for a different
purpose (`engine/pressureDetection.ts`'s rolling-window skew, 2026-08-12), which is directly
reusable rather than needing a second decay system:

**Mechanic**: a shard-wide rolling window of the most recent N Wall posts (not
per-author — this is explicitly the aggregate, unlike `pressureDetection.ts`, which is
deliberately per-author and never surfaces an aggregate reading). For each post in the window,
classify by the same tension/positive split `pressureDetection.ts` already established:
- **Tension cluster** (7 states): isolated, manipulated, distrustful, exploited, suspicious,
  uneasy, overwhelmed.
- **Positive cluster** (3 states): hopeful, secure, grateful.

`soulTemperature = tensionCount / totalCount` in the window, 0 (all positive → gold) to 1 (all
tension → red) — same [0,1] contract every other ambient signal in this codebase already uses
(`tension`, `heat`), so a renderer treats them identically rather than needing per-signal
special-casing.

**This directly answers the addendum's own flagged skew risk** by NOT weighting the raw
10-state split (which would default warm) — it reads recent behavior only, through a bounded
window, the same "recency beats lifetime average" fix `pressureDetection.ts` already proved
out. A shard that's currently calm reads gold regardless of its history; the window is the
mechanism, same as it is everywhere else signal-decay is used in this codebase.

**Load-bearing correction, confirmed against source canon, not just inferred**: the Wall's
Emissive Soul reads **Wall posts only** — `DESIGN_ADDENDUM_2026-08-08.md` §2 states this
explicitly ("Every Wall post is already built from one of ten fixed SELF_STATES... the Wall's
core glow aggregates recently-posted tones"). It was never specified to read Envelopes, and it
must not: Envelopes are the private 1:1 channel (`comms/grammar.ts`) constraint 4 protects.
Aggregating Envelope content into any public signal — even fully anonymized down to one
number — would turn private exchanges into an inferable public broadcast, which is exactly
what constraint 4 rules out. Flagging this explicitly because an externally-generated concept
render (a Gemini Notebook visual deck reviewed this session) depicted an Envelope-sourced
pipeline for this exact mechanic; that depiction is wrong against both the original design
canon and constraint 4, not just an alternate interpretation.

**Suggested window size** (not yet calibrated in-engine, flagged per this project's own
"measure before trusting" discipline): `WALL_SOUL_WINDOW_POSTS = 50`, roughly matching
`pressureDetection.ts`'s `PRESSURE_WINDOW_POSTS = 30` scaled up for a shard-wide (not
per-author) population of posters. Needs a real measurement pass against actual Wall-posting
cadence before shipping, same discipline `FLOUR_PER_BREAD`/`NODULES_PER_DAY` were held to —
not guessed and left alone.

## 4. Structural beauty stays constant; colour is the only honest variable

Restating `DESIGN_ADDENDUM_2026-08-08.md` §2's locked rule because it's easy to lose when
translating to an actual renderer: the Wall and the district plazas stay open, bright, and
architecturally beautiful regardless of `soulTemperature` or `tension`. Brightness and
structural integrity are never the signal. Only **hue** carries the truth — gold-to-red for
the Wall, cool-to-warm for District Weather. A shard in genuine crisis should look like a
beautiful place having a bad day, never like a broken asset. This is the single rule most
likely to get quietly violated by an artist reaching for "distressed" textures under time
pressure — worth stating as a hard constraint for whoever builds the renderer, not just a
vibe.

## 5. The full data-to-visual mapping, current as of this session

`NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §3's table is the founding law; everything below is
additive to it, and one row in the original table is corrected.

| Signal | Real source (field, [0,1] unless noted) | Visual encoding |
|---|---|---|
| Role type | `RoleType` (`world.ts`) — **miller, baker, courier, journalist, detective, importExport** — corrects the original brief's stale 8-role list (farmer/smith/miner/healer/watchman don't exist; the roster closed at 6, 2026-08-11) | Distinct hue per role, 6 clearly separable colors |
| District Weather (local mood) | `District.weatherHistory` latest `tension` (`districtWeather.ts`, shipped) | Cool blue → warm amber/red, per-district, independently moving |
| Wall's Emissive Soul (global mood) | `soulTemperature` per §3 above — **not yet built**, this document is the spec | Gold → red glow on the Wall structure at the shard hub |
| Economic Heat (station-level) | `computeEconomicHeat()` per-building `heat` (`economicHeat.ts`, shipped) | Glow intensity/radiating paths per station — Miller/Baker read their own value; support roles read district friction |
| Economic Heat (district/"Market") | `districtEconomicHeat()` (shipped) | Foot-traffic density in the plaza; also selects which core district is currently "the Market," per §2 above |
| Identity resolution | `isKnown()` / `resolvedSubjects()` (`identity.ts`, shipped) | Silhouette + role icon (unknown) → deterministic procedural face (`generateFace()`, shipped) once resolved, per-observer |
| Player-held vs. backstopped slot | `RoleSlot.state` (`vacancy.ts`) — FILLED vs BACKSTOPPED | Solid saturated outline (FILLED) vs. dashed/desaturated (BACKSTOPPED) — quieter, never broken, per original brief |
| Core vs. periphery density | `District.classification`, `coreSpacing`/`peripherySpacing` (`space.ts`, shipped) | Density gradient — already generated, not yet rendered |
| Detection / witness density | `occupantsWithin()`, `detectionProbability()` (`space.ts`/`ecosystem.ts`, shipped) | Ambient light/activity noise scales with real witness count, not a decorative crowd |
| Consolidation decline | `DistrictHealth.state` (`districtConsolidation.ts`, shipped) — ACTIVE/CONSOLIDATING/MERGED | Feeds District Weather already (§ above); a renderer may additionally desaturate/thin a CONSOLIDATING district's own structures, distinct from its color |
| Pressure detection (Detective/Journalist sensor) | `pressureContribution()` (`pressureDetection.ts`, shipped 2026-08-12) | Already folded into District Weather's `tension` — no separate visual, by design (never a name, never a second signal to read) |
| District access (barriers) | `District.neighborDistrictIds` (`space.ts`), `effectiveRoute()` (`districtAccess.ts`, shipped 2026-08-12) | Side streets rendered as real passable routes between neighbouring districts; a gate/checkpoint (§5's border-checkpoint language, scaled down) at the edge for travelers routed `'viaHub'` instead |

## 6. District barriers — gated movement, not just gated rendering

**Status: built, 2026-08-12.** User's own framing, kept close to verbatim as the source of the
decision: barriers restricting movement between districts, so that those who can move are
able to, and everyone else has to use the main plaza. This is a real spatial/gameplay
mechanic, not a rendering choice — it changes who can reach whom, not just what it looks
like — and it got its own build+test cycle rather than a same-session bolt-on, per the
paragraph above. `src/engine/districtAccess.ts` is the implementation; both design questions
originally left open below are now resolved and proven by test, not just argued.

**The gap this closes in the existing geometry**: `NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §2
already wanted "side streets: connective paths between neighborhoods that don't pass through
the center — genuine alternate routes, not just spokes." `space.ts`'s `generateShardLayout()`
never actually built these — it only generates hub-spoke corridors (§1 above), one path per
district straight to the hub, nothing district-to-district. The barrier mechanic and the
missing side streets are the same gap: side streets are the thing being gated.

**Who gets the shortcut, decided from what already exists rather than invented fresh**: a
FILLED role-holder has a real building and a real, fixed position in a specific district —
they have standing there. A grifter has neither; `world.ts`'s own header already documents
this exact asymmetry for an unrelated reason ("grifters have no fixed position in this
model... not part of the proximity graph"). Extending that same asymmetry to movement is not
a new invention, it's the same distinction the engine already draws, applied to a second
system. Implemented rule (`districtAccess.ts`'s `hasShortcutAccess`/`effectiveRoute`): **a
FILLED role-holder may use direct district-to-district side streets between their home
district and its nearest neighbours; a grifter (or anyone in a BACKSTOPPED/VACANT slot's
former position) must route through the hub/plaza to reach any other district.**

**Why this is additive, not subtractive, and so doesn't touch constraint 6**: the baseline —
everyone can always reach every district via the hub — is never removed for anyone; the hub
route is the floor, and it always works (constraint 2, no permanent zero-state). What
role-holders get is a genuine shortcut on top of that floor, not a penalty subtracted from
someone else's access. This is the identical shape constraint 6 already requires of
reputation — a grant on top of an untouchable baseline — applied to geography instead of
standing. It also gives grifters a second, concrete, felt reason to want a role beyond
income — this project has already established the role ladder as real (~22-day mean wait,
`docs/HANDOVER.md`) — mobility is now part of what a role is worth, not just wage.

**Composes with, but does not require, Courier/item 6**: the pending addendum item 6 (courier
pay, distance-indexed, not yet built) already establishes that moving things between districts
has a real cost. A grifter needing to reach a specific district could plausibly pay a Courier
to close the gap the direct shortcut denies them — that's a natural extension once item 6
ships, not a dependency; the barrier mechanic stands on its own without it.

**What "nearest neighbours" means, concretely**: `space.ts`'s `sideStreetPairs()` — each
district connects to its `DISTRICT_SIDE_STREET_NEIGHBOR_COUNT` (K=2) nearest other districts
by real `distance()` between plaza plots, unioned symmetrically (a corridor exists if EITHER
side picked it, since it's physically walkable both ways regardless of which side "chose"
it) — matching the brief's "genuine alternate routes," not a fully-connected mesh which would
make the hub pointless. Stored once at shard generation as `District.neighborDistrictIds`,
static for the shard's whole life, same as `plazaPlot`/`radius`/`buildings`.

**Visually**: a barrier is not a wall in the "MERGED district" sense — it doesn't degrade or
look broken (§4's rule about structural beauty staying constant applies here too). It should
read as a real, physical checkpoint or gate at the district edge — the brief's own optional
"border checkpoint" landmark (§5 of the 2026-08-07 brief, previously tied only to the
cross-shard exit-ticket mechanic) is the natural visual language to reuse here, scaled down to
a district-to-district gate rather than a shard-exit one. A grifter standing at a gate they
can't use should read as "not for you yet," not "broken" or "hostile."

**Both questions this section originally left open are now resolved, decided during the
build rather than deferred again:**

- **Consolidation state does NOT affect shortcut access.** A CONSOLIDATING/MERGED district's
  role-holders already pay the trade-route friction penalty on income
  (`districtConsolidation.ts`); also revoking shortcuts would double-penalize a district
  already struggling, cutting against "the floor protects everyone." This is enforced
  structurally, not just by intention — `space.ts` has zero import of
  `districtConsolidation.ts`, proven by `test/districtAccess.test.ts`'s import-guard test
  (same pattern `drivers.importGuard.test.ts` and `grammar.invariant.test.ts` already use),
  so district health has no path to reach corridor geometry even by future accident.
- **No containment gap**: a well-connected role-holder cannot control or gate another
  player's access, because `directNeighbors`/`effectiveRoute` take no per-player identity for
  any district but the traveler's own — there is no parameter through which a third party's
  state could enter the computation. Proven, not just argued: `test/districtAccess.test.ts`
  tampers with every OTHER district's geometry in a shard and confirms the route between two
  specific districts is completely unaffected.

## 7. What this still leaves open, per the original brief's own §9 discipline

Not everything needs deciding now, and the 2026-08-07 brief was explicit that execution
details (exact structure shapes per role, precise street-generation logic, weather-particle
behavior) are for whoever builds the renderer, not this layer of design. Genuinely still open:

1. ~~`Shard.hubPlot` as a named field~~ — done (§1).
2. **Wall Soul window size calibration** — `WALL_SOUL_WINDOW_POSTS` is a starting guess (§3),
   needs measuring against real posting cadence before it's trusted.
3. **Visual *quality* of light distinguishing District Weather from the Wall's Soul** — the
   addendum's own open question 2, still open. Both are hue-on-[0,1], but a player needs to
   tell "my district" from "the whole shard" at a glance without reading two legends. An
   art-direction question, not a mechanics one — candidate: District Weather as ambient/diffuse
   haze in the air, the Wall's Soul as a hard-edged emissive glow on one specific structure,
   so the *shape* of the light differs even when the *hue* logic is identical.
4. **The border checkpoint landmark** the original brief flagged as optional, tied to the
   still-undecided legality/border-risk mechanic (Import/Export's illegal-route interception,
   `importExport.ts`, exists mechanically but has no visual treatment specified).
5. **Structure shapes per role** — unchanged from the original brief's own scope: still an
   execution decision for whoever builds this, once the 6-role roster's shapes are chosen.

## 8. The 2026-08-13 addendum's three-wedge geometry — RESOLVED (2026-08-13, later same day):
## one district per shard, not 3 or 6 or 11

**Resolved, not left open** — see the block at the end of this section for how and why. The
rest of §8 below is kept verbatim as the real record of how the conflict was found and framed
before resolution; don't read it as still-open.

`docs/DESIGN_ADDENDUM_2026-08-13.md` §5-§7 proposes a specific settlement shape (one central
plaza, exactly three 120° wedge districts, three wall-gates at the plaza edge, courier-only
inter-wedge shortcuts) and includes real AI-generated concept art matching it — the user's own
framing, worth stating plainly rather than glossing past a second time: **the art is modelled
FROM the architecture, not decoration layered on top of an arbitrary shape.** The clearest
reference (the plain black-and-white line-diagram frame, not the later ones that drift into
unrelated concept art) shows exactly what §5 describes: three wedges around one plaza, gates
at the inner plaza edge, roads fanning out organically per wedge, fairly even building density
toward the outer rim rather than a center-heavy gradient. That's a real, usable target.

**The conflict, stated with numbers rather than picked silently.** The addendum's geometry
commits to exactly **3 districts total per shard** (District 1/2/3, cascading open as
population grows, each running the full role roster). The shard topology adopted this same
session (2026-08-13's `DEFAULT_WORLD_CONFIG`/`DEFAULT_SHARD_CONFIG` update — see
`docs/HANDOVER.md`'s "Shipped configuration" section) is **6 scattered districts** (2 core + 4
periphery, each with its own plaza, connected by hub-spoke corridors plus a K-nearest-neighbor
side-street mesh) — chosen BECAUSE the real `jointGridSearch` pop=100 confirm-phase run showed
it balances better than either extreme, not by default. The actual numbers for the winning
role split (`M9 B9 C7 J7 D8 IE6`), all three district-count layouts the sweep tested:

| Layout | health | gini | grifter wait | flourRatio |
|---|---|---|---|---|
| 3 districts | 0.968 (highest) | 0.657 (worst) | 30.3 days (worst) | 0.586 |
| **6 districts (adopted)** | 0.937 | 0.629 | 26.9 days | 0.616 |
| 11 districts | 0.924 (lowest) | 0.612 (best) | 25.7 days (best) | 0.611 |

3 districts is not incoherent (flourRatio well under the 1.0 hard filter) — it genuinely staffs
best. But it is real, measured, worse on equality and grifter wait than the balance point 6
districts was chosen for, the same trade-off pattern that made "more health by adding Millers"
a rejected direction earlier this session (see `docs/BLUEPRINT.md`'s Miller-scarcity notes).
**This is a real design decision the addendum's own geometry forces, not a detail to average
away**: committing to the addendum's exact three-wedge/one-plaza shape means committing to the
3-districts row above, with its real equality/grifter-wait cost, or finding a way to keep 6
(or more) districts while still delivering the wedge/plaza/gate visual language — e.g., a
shard made of two three-wedge clusters, or wedges that themselves subdivide, neither of which
the addendum specifies (its own §8 already flags "district 2/3's position relative to district
1" as unresolved). **Not decided here — flagged for whenever this gets resolved with the user
before any `space.ts` geometry code gets written**, the same discipline the role-count conflict
was held to earlier this session.

**A second, smaller reconciliation the geometry proposal needs regardless of which topology
wins**: the addendum's own §6 role-building placement grid (26 buildings, split
M3/B7/IE2/C6/J5/D3) was calibrated for the addendum's own stale role numbers, not the
newly-adopted `M9 B9 C7 J7 D8 IE6` (46 slots) split. Whichever topology is chosen, the
placement grid needs re-deriving against the real adopted split, not ported as-is.

**What's genuinely reusable right now, independent of the topology question**: the "Visual
Contrast Contract" concept material (a separate generated slide, not in the addendum text
itself, shown alongside the wedge geometry) maps game mechanics onto visual zones in exactly
the shape §5 above already establishes as doctrine — reconciled against real engine truth
below rather than taken on faith:

| Concept-art label | Real mechanic it maps to | Already true today? |
|---|---|---|
| "The Miller Duopoly — Strategic Supply Starvation" | Miller scarcity (a design pillar defended repeatedly against "just add more Millers" — see `docs/HANDOVER.md`'s "Miller scarcity is a design pillar, not a tunable") | Yes — Miller is 9 of 46 slots at the new default, deliberately the smallest core role alongside Import/Export |
| "The Baker Stand-off — Competition on Price, Not Supply" | Baker's Bertrand price-competition layer (`bakers.ts`) | Yes, unchanged since Phase 1 |
| "Couriers and Peripheral Lines — The Stability of Motion" | Courier's distance-indexed pay (`courierPay.ts`, item 6) and the district-barrier shortcut privilege (§6 above) | Yes — Courier is literally the role whose economics AND movement privilege are both geometry-driven now |
| "Stealth and Information Mechanics" | Sabotage/detection (`ecosystem.ts`) and Detective/Journalist pressure detection (`pressureDetection.ts`) | Yes, both shipped |
| "The Core Central Plaza — Wall's Emissive Soul / Sentiment Beacon" | §3 above (Wall's Emissive Soul, spec'd, not yet built as code) | Spec matches — the concept art's plaza-as-mood-beacon reading is consistent with, not contradicting, §3's design |

This table is the concrete form of "treat the art as architectural input" — every label on the
concept art traces to a real, already-validated mechanic, not an invented visual motif. It
should anchor whatever renderer eventually gets built, once the topology question above is
resolved.

---

### RESOLUTION (2026-08-13, later the same session): 1 district per shard

The 3-vs-6-vs-11 table above compared AGGREGATE metrics (health/gini/wait/flourRatio) — it
never actually measured population per individual district, because `District.population`
(`space.ts`) was silently never incremented by the real tick loop. Found and fixed by probing
it directly: every district read 0 at day 800 across every seed tested, despite
`world.population` tracking correctly. A second, independent bug was found in the same pass:
`assignRoleBuildings` (`world.ts`) walked buildings strictly in district-then-building order,
so once role count fell short of building count (routine), whichever districts landed last in
that order got literally zero role-holders, ever — 2 of the old 4 periphery districts, always,
deterministically. Both fixed (see `docs/BLUEPRINT.md`'s 2026-08-13 entry for the fix
mechanics and the real resonance bug hit and caught mid-fix).

With both bugs fixed, real per-district numbers (single shard, 800 days, 3 seeds) were
decisive, not close:

| layout | districts | meanPop | meanRoleHolders | **meanRoleHoldersPerDistrict** | health | gini |
|---|---|---|---|---|---|---|
| **1 district (adopted)** | 1 | 69.0 | 43.0 | **43.0** | 0.961 | 0.619 |
| 3 districts | 3 | 66.0 | 43.0 | 14.3 | 0.961 | 0.628 |
| 6 districts (old default) | 6 | 58.7 | 40.7 | 6.8 | 0.930 | 0.649 |

1 district wins on every metric measured — not a tradeoff being traded away, unlike most
decisions this project has made. More districts fragment the same role-slot pool across more
separately-consolidatable units, which is worse for equality and health too, not just a "feel"
problem. This directly resolves the user's own rejection of the old 6-district default ("6 is
unreasonable... how many players per district? ... it's absurd") with real numbers.

**This also resolves the conflict this section spent so long describing, for free**: one
district IS one settlement, which is exactly what the addendum's three-wedge geometry already
describes (one central plaza, three 120° wedges) — there's no longer a "3 vs 6 vs 11 separate
plazas" question to reconcile against the concept art at all. Population beyond what one dense
settlement comfortably holds (currently ~55-70 per shard in these single-shard runs) is handled
by the already-built, already-tested multi-shard system opening a new shard, not by adding more
districts — exactly what README.md's "Beyond one shard" section already describes.

**Real, known cost, not silently absorbed**: this removes the separate core-district/
periphery-district distinction the Silhouette Shield's resolution-speed gradient
(`identity.ts`'s `coreSpacing`/`peripherySpacing`) was built around. `test/
identityResolutionHarness.test.ts`'s core-vs-periphery comparison no longer has anything to
compare in the shipped default — the test now runs against an explicit multi-district config to
keep the underlying mechanism verified, decoupled from what ships. If a felt busy-center-vs-
quiet-edge gradient is still wanted, it needs re-deriving as a distance-from-plaza gradient
WITHIN this one district (the existing edge-raggedness factor in `generateDistrictPlots`
already gestures at this) rather than between separate District objects — real follow-up work,
not done here.

`DEFAULT_SHARD_CONFIG` is now `coreDistrictCount: 1, peripheryDistrictCount: 0,
coreDistrictRadius: 7, buildingsPerCoreDistrict: 62` — see `space.ts`'s own header for the full
trail. The periphery fields stay in the config type (not deleted) so a future cascading
district-opening feature (addendum §4 — a real district 2/3 opening only once population
genuinely crosses a threshold, not built yet) has somewhere to plug in.

---

## 9. Building form: floors and housing capacity — first real numbers, not concept only

Added 2026-08-13, same session, once `space.ts` actually shipped `Building.floors`,
`districtHousingCapacity()`, and grifter residency (`docs/BLUEPRINT.md`'s "Housing capacity +
grifter residency" entry) — the user's own instruction: *"ensure it's represented in the
visual design so that I can model the game directly from code and documents."* Everything
below is a real, shipped code constant, not a concept-art guess — safe to model from directly.

**Every building is mixed-use, per `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §1.1's
"above bakeries, and elsewhere across the city."** Ground floor: the building's role function,
if it has one (`roleSlotRef` — a Mill, a Bakery, a Docker post, or nothing, for a Home-only
building; the model should look identical either way from the outside, since visibility rules
already say nothing about a resident should be legible from outside their home). Every floor
above ground: housing, available to any resident of the district regardless of who works
downstairs — a grifter's silhouette can live directly above a Baker's shop.

**Real numbers, shipped default (`space.ts`)**:
```
HOUSING_FLOORS_PER_BUILDING = 3   [ILLUSTRATIVE — tunable, not yet measured/tuned]
HOUSING_RESIDENTS_PER_FLOOR = 2   [ILLUSTRATIVE]
-> 6 residents of housing capacity per building, ground floor unaffected/unchanged
62 buildings x 6 = 372 total district housing capacity (single-district shard)
```
Measured against a real 300-tick run at the shipped config: real population ~67, all housed,
comfortable headroom (372 capacity vs. 67 residents) — a modeler should NOT read this as "every
building needs to look crowded, floor to roof"; most buildings sit well under capacity most of
the time, which the model should show (some buildings mostly-dark upper floors, not every
window lit).

**Every building should read as the SAME footprint, 3 floors tall, regardless of role.** No
special-cased "big" Mill or "small" Courier post from height alone — `floors` is currently
identical (3) for every building in the shipped code, so nothing in the geometry itself
distinguishes role visually beyond ground-floor signage/function. If role-specific building
height ever becomes a real, measured design choice, it needs a real `floors` value change in
`space.ts` first — don't invent visual variety the code doesn't have; §4 above already
established "structural beauty stays constant, colour is the only honest variable," and this
extends that same discipline to building height.

**What's NOT real yet, don't model as fixed**: which SPECIFIC floor/unit within a building a
given resident occupies (assignment today is district-level only, not per-building or
per-floor — `docs/BLUEPRINT.md`'s housing entry flags this explicitly as not built);
per-building floor-count variation (every building is 3 floors today, uniformly); and the
diary-in-abode/trespass mechanic's visual language (a key, an entry animation, whatever reads
as "breaking in") — designed (`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7) but not built
in code, so nothing about its presentation is real yet either.
