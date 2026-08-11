# Devlog

Chronological record of work on NODE, newest entry on top. Include failures and dead ends,
not just what shipped — the point is that the next session (or next hour of this one)
doesn't have to rediscover them.

---

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
