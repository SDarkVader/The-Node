# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players, no combat — tension comes
from asymmetric information and structural economic pressure. Platform: **PC + mobile,
client in Godot 4**, server authoritative in TypeScript/Node (decided 2026-08-06). Full
spec: `docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything; it's the one
part of the brief that isn't up for revision. Also read `CLAUDE.md`'s "Standing design
constraints" — six binding rules (simulate before trusting; no permanent zero-state at
any scale; minimize what's modelable — ask "does this need to be an agent"; personal
memory is mortal, civic memory is immortal; let outcomes be real, don't script them;
reputation may only ever grant, never remove) that apply to everything built from here on.

## Current state (as of 2026-08-11)

**Phase 1 (economic core), Phase 2 (vacancy + conscription), the §8 MVP mechanic, the
client/server scaffold with real targeted delivery, and an ecosystem-scale mechanics layer
(economic floor, migration, sabotage, experience, districting) are all built and tested.**
The Observatory build spec's Phases A-C (spatial primitive, unified `world.ts` kernel,
synthetic drivers) are also built and tested; Phases D-F (snapshot/replay contract, the
web observatory app, civic-memory monuments) are not started.

**This session: the 5-role roster + individually-tracked grifter pool, per direct user
spec.** Miller, Baker, Courier, Journalist, Detective, plus roleless "grifters" —
drafted/selected into any open role, individually tracked for the first time
(`GrifterSlot: { id, wealth, daysAsGrifter }`), earning a smaller floor income
(`GRIFTER_DAILY_INCOME`) until they get one. Miller/Baker keep their existing Cournot/
Bertrand mechanics; Courier/Journalist/Detective get a flat `SUPPORT_ROLE_DAILY_WAGE` —
flagged placeholder, none of the three have a designed market mechanic anywhere in this
project. A new `sim/multiRoleConscription.ts` generalizes the old 2-role
`conscriptionHarness.ts` to N roles sharing one real grifter pool (that old function is
untouched, still covered by its own tests). Role-to-building assignment is now
district-aware. `wealthGini`/`wealthTop10Share` now span all 5 roles + grifters — every
identity-bearing player — not just Miller+Baker as before. 200 tests total, all passing;
`npm run typecheck` clean. Full trail: `docs/BLUEPRINT.md`'s "5-role roster" entry,
`docs/DEVLOG.md`'s top entry.

**A real bug was found and fixed while testing this, then formalized as a test**:
`fillHazard`'s voluntary-fill roll had no concept of a real, finite, shared candidate
pool (never needed one with only 2 roles). With 5 roles sharing one grifter pool, it
could be independently rolled successful by multiple roles the same day and overdraw the
pool, flipping slots to FILLED without a real grifter behind them. Fixed by gating
voluntary fills on real same-day availability. Population conservation
(`grifters.length + total FILLED across all 5 roles == population`) is now an explicitly
tested invariant.

**A bigger, more important finding came out of the sweep script built to derive the
role-slot allocation (`src/sim/districtRoleSweep.ts`, `npm run district-role-sweep`) —
population collapses well below `targetPopulation=65` at every candidate tested**, not
just an unlucky split. Confirmed this isn't 5-role-specific (the old 8-Miller/16-Baker
split, run through the new kernel, still collapses) and that the composed kernel already
had *some* unnoticed drift before this session too (confirmed by running the actual
pre-session code unmodified over the same 2000-day window: it settles at ~46, not 65 —
its own tests never ran that long before). Root cause, traced: `fillHazard`'s probability
math is identical old vs. new; the only real difference is the correctness fix above, and
once population drifts down for any reason, the now-finite shared grifter pool shrinks
too, refills slow, `migrationValveStep`'s emigration pressure rises, population drops
further — a genuine feedback loop toward collapse. **`DEFAULT_WORLD_CONFIG`'s role split
(Miller 3/Baker 7/Courier 6/Journalist 5/Detective 3, S=24) ships as a working,
population-conserving, fully-tested default, but is explicitly NOT the "cleanest and
fairest" allocation the user asked to derive** — that derivation is meaningless until the
migration/arrival rebalancing question below is settled. Full trace and numbers:
`docs/BLUEPRINT.md`'s "5-role roster" entry.

**Also raised mid-session, not yet built or fully scoped**: (1) the user pointed out
`arrivalPDaily` currently models only brand-new players, with no concept of *existing*
players migrating in from other shards — while emigration is real and reactive. Likely a
significant piece of the collapse above (a real, reactive outflow with only a flat
trivial inflow is inherently unstable), but modeling it properly needs either simulating
multiple shards or an abstracted external-pool design — not resolved. (2) A 6th role,
**Import/Export** — receives a daily resource ("nodules"), converts to grain for Miller
(closing a real gap: Miller currently has no raw-material input at all), and controls
legal/illegal shard-to-shard movement tied to the existing postcard/tier exit-ticket
system (`docs/DESIGN_ADDENDUM_2026-08-07.md`), gated by a 24/7 randomized-behavior
detection mechanic (reusing `ecosystem.ts`'s existing `detectionProbability()` pattern,
not a new primitive). User explicitly said "let's think it through before moving
further" — no code written yet. Open questions: what forces player interaction with
Import/Export specifically (my proposal: Couriers physically ferry nodules from
Import/Export to Miller, finally giving Courier a real mechanic instead of its flat
placeholder wage — not yet confirmed); and whether to fold nodules into the same
rebalancing pass as the population-collapse finding, since nodules would add a second
hard resource constraint on top of an already-fragile equilibrium.

```
npm install
npm test                     # 200 tests, all passing
npm run sim                  # Phase 1 stability-curve sweep to stdout
npm run vacancy-sim          # Phase 2 vacancy sweep to stdout (N=50/60/80)
npm run conscription-sim     # old 2-role Miller conscription sweep (delay x N)
npm run ecosystem-sim        # combined economic-health / sabotage-detection comparison
npm run sabotage-pattern-sim # pattern-based sabotage PROPOSAL — not the shipped default
npm run spatial-witness-report # real spatial witness counts vs. the assumed flat 23
npm run world-sim            # unified kernel — market + vacancy + ecosystem, one running world
npm run role-ratio-sweep     # OLD 2-role Miller/Baker ratio sweep — superseded by the one below
npm run district-role-sweep  # 5-role + grifter-pool allocation/district sweep — see finding above
npm run wealth-inequality-report # Gini/top-10% baseline + tax/cap remediation sweep
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

**Highest priority — the population-collapse finding above needs a rebalancing decision
before anything else in the role/district space is finalized.** Candidate directions, not
yet chosen: retune `migrationValveStep`'s theta/k (validated against an infinite-pool
assumption that no longer holds), retune `fillHazard`'s beta/tPain/tHard for a real finite
pool, model shard arrivals as existing-player migration rather than a flat constant (the
point the user raised), or some combination. Once the equilibrium is stable near
`targetPopulation` again, re-run `npm run district-role-sweep` to actually pick "the
cleanest and fairest" role/district allocation the user asked for — picking one before
that is meaningless.

**Import/Export (nodules, grain conversion, legal/illegal shard movement) is mid-design,
not started.** See "Current state" above for the open questions. Needs the user's answer
on what forces player interaction with it, and a decision on whether to fold it into the
same rebalancing pass as the population-collapse work (it adds a second hard constraint
on Miller output, which will interact with whatever the rebalancing lands on).

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
  much in one pass; still true, now compounded by the rebalancing work above needing to
  land first.

Worth reading before touching the above: `docs/ECOSYSTEM_VISION_2026-08-06.md` (multi-shard
shape, no mechanics yet), `docs/DESIGN_ADDENDUM_2026-08-07.md`'s organic shard-opening
(§7 — reuses the vacancy-backstop pattern at the shard level, directly relevant to the
arrival-migration question above), `docs/DESIGN_ADDENDUM_2026-08-08.md` (District
Weather, the Wall's Emissive Soul).

## Things to know before you touch this

- **The 5-role kernel's `DEFAULT_WORLD_CONFIG` role split is a working default, not a
  validated conclusion** — see "Current state" above. Don't treat Miller 3/Baker 7/
  Courier 6/Journalist 5/Detective 3 as final; it's what shipped so the kernel has
  *something* consistent to run, pending the rebalancing decision.
- **`multiRoleConscription.ts` is a NEW, separate function from `conscriptionHarness.ts`'s
  `stepConscriptionDay`** — the old one is untouched and still what its own tests cover.
  Don't merge them without checking both test suites first.
- **`vacancyParamsFor`'s `N` parameter uses the static `config.targetPopulation`, not the
  live `world.population`** — a pre-existing simplification, not touched this session,
  but directly relevant to the population-collapse finding (it's part of why `fillHazard`
  doesn't itself react to population drift — only the new real-pool veto does).
- **Courier/Journalist/Detective's `SUPPORT_ROLE_DAILY_WAGE` is a flat, undifferentiated
  placeholder** — no market mechanic designed for any of the three. The Import/Export
  discussion (see above) may give Courier a real mechanic (nodule delivery) that would
  need to compose with, not replace, this wage.
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
  `SUPPORT_ROLE_DAILY_WAGE=1.5`, `GRIFTER_DAILY_INCOME=0.5`** (all `src/engine/wealth.ts`)
  are all `[ILLUSTRATIVE]`, swept or reasoned from real baseline numbers, not guessed —
  see `wealth.ts`'s own doc comments and `BLUEPRINT.md`'s "Wealth inequality" and
  "5-role roster" entries for the reasoning behind each.
- **Sabotage now targets all 5 roles**, not just Miller+Baker, and an eviction now also
  pushes the evicted player into the grifter pool (they lose their role, not their place
  in the population) — a real behavior change from before this session.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current. Push doc
updates one at a time, not batched. `CLAUDE.md` also carries six standing design
constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md`, plus the 2026-08-08 reputation
addition) binding on all future work — check new work against them the same way, every
session.
