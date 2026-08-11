# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

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

## Current state (as of 2026-08-11, end of session)

**Phase 1 (economic core), Phase 2 (vacancy + conscription), the §8 MVP mechanic, the
client/server scaffold with real targeted delivery, and an ecosystem-scale mechanics layer
(economic floor, migration, sabotage, experience, districting) are all built and tested.**
The Observatory build spec's Phases A-C (spatial primitive, unified `world.ts` kernel,
synthetic drivers) are also built and tested; Phases D-F (snapshot/replay contract, the
web observatory app, civic-memory monuments) are not started.

**This session, in order: (1) the 5-role roster + individually-tracked grifter pool, (2)
the population-collapse finding that surfaced from deriving a role/district allocation for
it, and (3) district consolidation + a multi-shard registry, built specifically to fix
that collapse, per direct user design spec.** All three are built and tested. 233 tests
total, all passing; `npm run typecheck` clean. (Since extended — see (4) and (5) below;
238 tests now.)

### (1) 5-role roster + grifter pool

Miller, Baker, Courier, Journalist, Detective, plus roleless "grifters" — drafted/selected
into any open role, individually tracked (`GrifterSlot: { id, wealth, daysAsGrifter,
consolidationDeadline? }`), earning a smaller floor income (`GRIFTER_DAILY_INCOME`) until
they get one. Miller/Baker keep their Cournot/Bertrand mechanics; Courier/Journalist/
Detective get a flat `SUPPORT_ROLE_DAILY_WAGE` — flagged placeholder, none of the three
have a designed market mechanic anywhere in this project. `sim/multiRoleConscription.ts`
generalizes the old 2-role `conscriptionHarness.ts` to N roles sharing one real grifter
pool (that old function is untouched, still covered by its own tests). Role-to-building
assignment is district-aware. `wealthGini`/`wealthTop10Share` span all 5 roles + grifters.
Full trail: `docs/BLUEPRINT.md`'s "5-role roster" entry, `docs/DEVLOG.md`.

### (2) The population-collapse finding

`src/sim/districtRoleSweep.ts` (built to derive "the cleanest and fairest" role/district
allocation, as asked) showed population collapsing well below `targetPopulation=65` at
*every* candidate tested — traced to a real negative feedback loop: a correctness fix
(gating voluntary role-fills on a real, finite, shared grifter pool instead of an
infinite abstraction) meant that once population drifted down for any reason, the shrunk
pool made refills harder, raising `migrationValveStep`'s emigration pressure, dropping
population further. Confirmed not a 5-role artifact (the old 8-Miller/16-Baker split
collapses too) and that some drift already existed pre-session (unmodified old code
settles at ~46/65, not 65). Full trace: `docs/BLUEPRINT.md`'s "5-role roster" entry.

### (3) District consolidation + shard registry — the fix

User specified this directly (two design passes — see `docs/DEVLOG.md`'s top entry for
the exact back-and-forth, including a correction of this author's own initial
misreading of the trigger direction). Two new pure engine primitives:

- **`engine/districtConsolidation.ts`** — per-district health as an irreversible ratchet
  (ACTIVE → CONSOLIDATING → MERGED), triggered by UNDERpopulation crossing a tipping
  point. 14-day grace period, then a permanent trade-route friction penalty on income for
  buildings in that district (never full inaccessibility — constraint 2).
- **`engine/shardRegistry.ts`** — the multi-shard lifecycle at the population-count level.
  2 initial ACTIVE shards, shard ids that only ever grow, a new shard opens only once
  population + stability + cooldown are all satisfied, migration destinations always
  bounded to shards that actually exist, preferring a DORMANT one so a real arrival wakes
  it (`world.ts`'s `createDormantWorld`).

Wired into `world.ts`: a district crossing into MERGED evicts its role-holders into the
grifter pool with a hard 2-week `consolidationDeadline` (self-select first, then
force-drafted). `sim/multiShardHarness.ts` composes the registry with real `World`
instances and is the piece that actually fixes the collapse — `stepWorld`'s emigrants
(`lastEmigrants`, newly exposed) now get routed to a real destination shard instead of
vanishing into `migrationValveStep`'s abstract pool.

**Two real bugs caught by testing before shipping** (per the user's own "we always find
issues to resolve" instruction mid-build): an earlier version permanently excluded a
MERGED district's buildings from ever refilling, which collapsed the whole economy toward
zero over a long enough run (fixed — MERGED districts stay in the ordinary pool, friction
is the lasting penalty, not deleted capacity); and the shard-opening gate used a flat
total-population floor that let shard count run away to 102 in 3000 days (fixed — gates on
the MEAN population per currently-populated shard instead, which self-paces).

**User mid-flight correction, also folded in**: "N shouldn't be flat given illegal
migration failure rates." `vacancyParamsFor`'s `N` now uses live `world.population`
instead of the static `config.targetPopulation` (a long-flagged simplification, finally
fixed). `multiShardHarness.ts`'s `MIGRATION_FAILURE_RATE=0.15` (`[ILLUSTRATIVE]`) models
some cross-shard migration attempts simply failing — a placeholder for Import/Export's
not-yet-designed route-detection mechanic.

**Final validation (`npm run multi-shard-validation`)**: single-shard baseline collapses
to **8.1/65** mean population (worse than pre-live-N-fix — an honest consequence of
removing the old model's optimism, not a regression). Multi-shard registry settles at **3
shards, 44.5/65 mean population per shard** at the time — since improved again to 51.3/65
by the opportunity valve, see (5) below. Full numbers and reasoning:
`docs/BLUEPRINT.md`'s "District consolidation + shard registry" entry.

### (4) Role/district allocation — finally derived against the real system

Immediate follow-up: "run it on your baseline then I'll see if I need an external plan.
try and solve it regardless." The original `districtRoleSweep.ts` numbers were stale
(predate the fixes above) and misleading to use as-is (judges candidates against a single,
isolated shard, which still collapses by design). Built `sim/multiShardRoleDistrictSweep.ts`
to re-run the same candidate pool through the real `multiShardHarness.ts` instead, and
actually picked a default from the results rather than leaving it open:

- **Role split moved from S=24 to S=30** — `DEFAULT_WORLD_CONFIG` is now Miller 4/Baker
  8/Courier 8/Journalist 7/Detective 3. Every S=24 split tested clustered tightly together
  regardless of distribution; S=30 was the one candidate that meaningfully out-staffed the
  rest (82% vs. ~68% of target population) at a smaller equality cost.
- **District count stays at 6** (2 core + 4 periphery) — a real, monotonic tradeoff exists
  (fewer/bigger districts staff better but are less equal and slower for grifters; more/
  smaller districts are the reverse), and 6 sits almost exactly at the balance point.

Full numbers, the traced mechanism behind the district tradeoff, and the honest caveat
(only one S=30 split and three district counts were tested, not exhaustive) are in
`docs/BLUEPRINT.md`'s "5-role/district allocation, re-derived" entry.

### (5) Population health — solved by instrumenting, not tuning

The standing "~68% of target" concern turned out to be partly stale (measured against the
old S=24 default; really 84%) and partly a misreading — the brief's own range is **50-80
players per shard**, so `targetPopulation=65` is that band's midpoint, not a floor. Flows
were measured rather than constants swept: equilibrium is exactly `arrivals == migration
failures` (0.303 vs 0.295/day, verified), and both obvious levers trigger unbounded shard
proliferation, so neither was a clean fix.

The real flaw, found from the user's steer ("economic opportunity ... purely statistics, no
bias"): the migration valve keyed emigration off roleless *fraction* alone, treating "28
roleless with 4 open slots" identically to "70 roleless with nothing open" — so nothing
about a shard emptying made it worth staying in. `opportunityAdjustedMigrationStep`
(`engine/ecosystem.ts`, new; the validated `migrationValveStep` is untouched) damps
emigration by open role-slots per roleless player: thin shards recover, full shards are
unaffected (so it cannot cause runaway growth). `OPPORTUNITY_WEIGHT=2.0` from a sweep.
**Single-shard 8.1 -> 38.5/65; multi-shard 44.5 -> 51.3/65.**

```
npm install
npm test                     # 233 tests, all passing
npm run sim                  # Phase 1 stability-curve sweep to stdout
npm run vacancy-sim          # Phase 2 vacancy sweep to stdout (N=50/60/80)
npm run conscription-sim     # old 2-role Miller conscription sweep (delay x N)
npm run ecosystem-sim        # combined economic-health / sabotage-detection comparison
npm run sabotage-pattern-sim # pattern-based sabotage PROPOSAL — not the shipped default
npm run spatial-witness-report # real spatial witness counts vs. the assumed flat 23
npm run world-sim            # unified kernel — market + vacancy + ecosystem, one running world
npm run role-ratio-sweep     # OLD 2-role Miller/Baker ratio sweep — long superseded
npm run district-role-sweep  # OLD single-shard 5-role sweep — stale, predates the fixes above, superseded by the one below
npm run multi-shard-role-district-sweep # the CURRENT role/district sweep — evidence behind DEFAULT_WORLD_CONFIG
npm run wealth-inequality-report # Gini/top-10% baseline + tax/cap remediation sweep
npm run multi-shard-equilibrium-sweep # what sets equilibrium population + the bifurcation
npm run multi-shard-validation # single-shard collapse vs. multi-shard registry — the population-collapse evidence
npm run mvp                  # two-Baker + rumour-mill scenario, CLI, prints day-by-day output
npm run server                # WebSocket server broadcasting the MVP scenario live
npm run typecheck
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ locally and run the main scene (set the `player_id` export on Main.gd to
`wren`/`sable`/`idris` to see targeted rumours arrive for that identity specifically).
**Still worth someone opening it in a real editor** — the headless run confirms the wire
protocol, connection string, and script logic are all correct, but says nothing about
the actual GUI experience.

**Working branch: `main`, directly (2026-08-08).** Commit and push as you go, one logical
change at a time — see `CLAUDE.md`'s "Branch policy." No CI configured. See
`docs/BLUEPRINT.md` for full architecture detail.

## What's next

**Role/district allocation is now resolved** (see "Current state" (4) above) —
`DEFAULT_WORLD_CONFIG` moved to S=30 (Miller 4/Baker 8/Courier 8/Journalist 7/Detective 3),
district count stays at 6. Not the top priority anymore; the item below is.

**Population health is resolved** — see "Current state" (5) below. The isolated
single-shard baseline went 8.1 -> 38.5/65 and the multi-shard registry 44.5 -> 51.3/65 via
the opportunity valve. Per-shard population now sits inside the brief's own 50-80 band.
Remaining tuning is optional, not a blocker; `migrationFailureRate` is deliberately left
alone until Import/Export's route-detection design sets it.

**The six-role allocation is re-derived and shipped** — M=5 B=6 C=6 J=6 D=5 IE=4 (S=32),
district count 6, `FLOUR_PER_BREAD=0.23`, all from `npm run multi-shard-role-district-sweep`,
which now judges allocation and supply-chain coherence together. That sweep caught the
previous default baking flour nobody milled (flourRatio 1.222) — re-run it, not the
constant alone, whenever role counts change.

**A finer role/district search is possible but not done** — only one split was tested at
S=30 (out of many possible distributions at that total) and only three district counts
were tried at all (3/6/11). A proper grid search (S=26/28/32, more district counts, joint
role-split × district-count combinations) could still find something better than what
shipped. Not urgent — what's live now is evidence-backed, not a guess — but worth knowing
it isn't claimed to be a global optimum.

**Import/Export (nodules, grain conversion, legal/illegal shard movement) is mid-design,
not started.** Open questions from the design discussion: what forces player interaction
with it specifically (standing proposal: Couriers physically ferry nodules from
Import/Export to Miller — not yet confirmed); its route-detection math is the natural
replacement for `MIGRATION_FAILURE_RATE`'s current flat placeholder, so this and the
multi-shard tuning above are now linked, not independent.

**Physical building relocation between districts on MERGE** is deliberately not built —
the current model keeps a MERGED district's buildings in place (just permanently
friction-penalized) rather than actually moving role-slot capacity into a surviving
district's geography. Flagged, not silently narrowed; a real "combine into half the
shard" would need this.

**Everything from before this session that's still genuinely open:**

- **`TRAVEL_DAYS_TARGET=168` vs. the postcard/tier exit ticket's 4-8 week target** — still
  unresolved, still your call, blocks `decayExperienceTraveling()` calibration.
- **Wire `src/engine/ecosystem.ts`'s sabotage decision (act-based vs. the pattern-based
  proposal) — still your call**, `patternSabotageAttempt()` exists and is simulated
  (~146-220 days/success) but not adopted as default.
- **Phase 2's §2.6 Shift Cover** (offline players' pre-set prices) needs real session
  state, doesn't exist yet.
- **Real Phase 4 rendering** — the current client is plain Labels, not the isometric
  camera/ambient-colour system the visual brief describes.
- **Phase 5 (voice/safety)** — architecture only, hard-gated on legal review.
- **Observatory Phases D-F** (snapshot/replay contract, the web app, civic-memory
  monuments) — not started, stopped after Phase C per explicit instruction not to do too
  much in one pass; still true.

Worth reading before touching the above: `docs/ECOSYSTEM_VISION_2026-08-06.md` (multi-shard
shape, no mechanics yet — now partially superseded by this session's actual shard registry,
worth reconciling), `docs/DESIGN_ADDENDUM_2026-08-07.md`'s organic shard-opening (§7 —
the prior art this session's shard registry actually implements) and postcard/tier
exit-ticket system (relevant to Import/Export's legal/illegal routes),
`docs/DESIGN_ADDENDUM_2026-08-08.md` (District Weather, the Wall's Emissive Soul — worth
reconciling with the new district-health/friction model, which covers similar ground
mechanically).

## Things to know before you touch this

- **The 5-role kernel's `DEFAULT_WORLD_CONFIG` role split (Miller 4/Baker 8/Courier 8/
  Journalist 7/Detective 3, S=30) is now evidence-backed, re-derived against the real
  multi-shard system** — not the same as claiming it's a global optimum (only one S=30
  split and three district counts were ever tested — see "What's next"), but it's a real
  decision made from data, not a placeholder awaiting one. District count (6) likewise.
- **`multiRoleConscription.ts` is a NEW, separate function from `conscriptionHarness.ts`'s
  `stepConscriptionDay`** — the old one is untouched and still what its own tests cover.
  Don't merge them without checking both test suites first.
- **`vacancyParamsFor`'s `N` now uses live `world.population`, not the static
  `config.targetPopulation`** — fixed this session (was flagged, now resolved). This
  makes single-shard population collapse WORSE in isolation (removes an optimistic bias) —
  expected, not a regression; the multi-shard registry is the actual fix.
- **A MERGED district's buildings are NOT physically removed from `shard.districts`** —
  logically excluded is not what shipped either, in the end: they stay in the ordinary
  vacancy/conscription pool (an earlier version that excluded them permanently collapsed
  the economy — see DEVLOG). The lasting MERGE consequence is the one-time eviction plus
  a permanent friction floor on income, not a capacity cliff.
- **`MIGRATION_FAILURE_RATE=0.15` in `multiShardHarness.ts` is a flat placeholder** for
  Import/Export's not-yet-built route-detection mechanic — replace, don't just retune,
  once that system exists.
- **`SHARD_OPEN_MIN_TOTAL_POPULATION` no longer exists** — replaced by
  `SHARD_OPEN_SURPLUS_FACTOR`, which gates on mean population per currently-populated
  shard, not a flat total. Do not reintroduce a flat total-population gate; it reproduces
  the 102-shard runaway bug this session found and fixed.
- **Courier/Journalist/Detective's `SUPPORT_ROLE_DAILY_WAGE` is a flat, undifferentiated
  placeholder** — no market mechanic designed for any of the three. The Import/Export
  discussion may give Courier a real mechanic (nodule delivery) that would need to compose
  with, not replace, this wage.
- **`wealthTaxRate`/`wealthCap` remediation stays scoped to Miller+Baker only**, even
  though `wealthGini`/`wealthTop10Share` now span all 5 roles + grifters — an explicit,
  flagged, not-yet-decided scoping gap, not an oversight.
- **The Baker price equation is NOT the brief's literal §1.3 equation** (mean-reversion
  fix, `src/engine/bakers.ts`) — see `BLUEPRINT.md`'s "Open deviations."
- **Phase 2's beta/t_hard are recalibrated** (`beta=0.03, tHard=3`, not the brief's
  `0.0008/14`) — a proven bound shows the brief's literal values can't hit its own §2.4
  targets simultaneously at any beta. Full derivation in `BLUEPRINT.md`.
- **`stepMillers`/`stepBakers` throw below n=2** — intentional; `world.ts`'s
  `stepCompetitiveLayer` freezes values instead of calling them below 2 FILLED.
- **The Godot client is verified headless (2026-08-07), not yet in a real GUI editor.**
- **The private diary is NOT part of the "signal decays with distance" family**
  (`src/comms/decay.ts`) — hard silent TTL expiry, no gradual fade, don't retrofit.
- **`PURCHASE_CYCLE_DAYS=7`, `BAKER_MAX_DAILY_CUSTOMERS=12`, `DAILY_ACTIVITY_MULTIPLIER≈0.70`,
  `SUPPORT_ROLE_DAILY_WAGE=1.5`, `GRIFTER_DAILY_INCOME=0.5`,
  `DISTRICT_TIPPING_POINT_FILLED_FRACTION=0.3`, `CONSOLIDATION_GRACE_DAYS=14`,
  `CONSOLIDATION_FRICTION_FLOOR=0.25`, `SHARD_OPEN_COOLDOWN_DAYS=30`,
  `SHARD_OPEN_STABILITY_THRESHOLD=0.8`, `SHARD_OPEN_SURPLUS_FACTOR=1.0`,
  `MIGRATION_FAILURE_RATE=0.15`** are all `[ILLUSTRATIVE]`, swept or reasoned from real
  baseline numbers where possible, not guessed blind — see each constant's own doc
  comment and `BLUEPRINT.md`'s corresponding entries for the reasoning behind each.
- **Sabotage now targets all 5 roles**, not just Miller+Baker, and an eviction now also
  pushes the evicted player into the grifter pool (they lose their role, not their place
  in the population).

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current. Push doc
updates one at a time, not batched. `CLAUDE.md` also carries six standing design
constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md`, plus the 2026-08-08 reputation
addition) binding on all future work — check new work against them the same way, every
session.
