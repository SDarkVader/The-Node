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

**266 tests, all passing; `npm run typecheck` clean. Working on `main` directly.**

Built and tested before this session: Phase 1 (economic core), Phase 2 (vacancy +
conscription), the §8 MVP mechanic, the client/server scaffold with real targeted delivery,
the ecosystem-scale layer (economic floor, migration, sabotage, experience, districting),
and Observatory Phases A-C (spatial primitive, unified `world.ts` kernel, synthetic
drivers). Observatory Phases D-F are not started.

This session added, in order: the **6-role roster + grifter pool**, **district consolidation
+ a multi-shard registry**, the **opportunity valve** (the population fix), **named per-role
resources**, the **Import/Export role and nodules**, and a **joint grid search** that derived
the shipped allocation. Each is summarised below.

### The roles, and what each actually does economically

**Miller** (Cournot quantity) and **Baker** (Bertrand price) keep their original validated
market mechanics. **Courier, Journalist, Detective** have no differentiated market mechanic
designed anywhere in the project — they share a flat `SUPPORT_ROLE_DAILY_WAGE`, an
explicitly flagged placeholder. **Import/Export** receives nodules daily and automatically
(no player action — "automated to the miller if offline"), converting them to grain, which
Millers now genuinely require in order to mill.

**Grifters** are roleless community players — the newbie, the camper, the socially isolated.
Individually tracked (`GrifterSlot: { id, wealth, daysAsGrifter, consolidationDeadline? }`),
earning a real positive income floor, and the pool every open role is filled from. Nobody is
stuck there by design and nobody in it goes without.

### Shipped configuration, and where it came from

```
rMiller 5  rBaker 5  rCourier 5  rJournalist 5  rDetective 5  rImportExport 3   (S=28)
6 districts (2 core + 4 periphery)        targetPopulation 65 (brief band: 50-80)
```

Derived by `npm run joint-grid-search` (screen, then confirm): 560 allocations screened at
reduced fidelity, **151 discarded outright as incoherent**, finalists then re-run jointly
against 3/6/11 districts at full fidelity. **Re-run after the consolidation defect was
fixed**, with the incumbent explicitly re-entered as a baseline — without that there was no
way to tell whether a "winner" actually beat what was live.

Live per-shard behaviour at these defaults: population ~56/65 (inside the brief's band),
economicHealth ~0.87, Gini ~0.55, grifter wait ~22 days mean, 3 shards, flourRatio 0.83.

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
npm test                              # 266 tests
npm run typecheck

npm run joint-grid-search             # allocation x district grid (screen | confirm) — THE SHIPPED CONFIG CAME FROM THIS
npm run district-layout-comparison    # 6 vs 11 districts head-to-head, incl. the consolidation mechanism
npm run multi-shard-validation        # single-shard collapse vs multi-shard registry
npm run multi-shard-equilibrium-sweep # what sets equilibrium population, and the bifurcation
npm run resource-report               # named per-role resources over time
npm run wealth-inequality-report      # Gini/top-10% baseline + tax/cap remediation sweep

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

## What's next

**Scope directive (2026-08-11, from the user): the role roster is CLOSED at six. Not looking
to keep expanding roles — build "enough for stability and fun."** Treat that as binding: the
work below is about making what exists hold up, not adding to it. Resist the pull to add
another role or system to solve a balance problem; the last several balance problems were
solved by fixing a constant or a mechanism, not by adding anything.

**1. Answer the research questions that simulation cannot.** See
`docs/RESEARCH_QUESTIONS.md`. Three of them are load-bearing and structurally invisible to
us, because **the simulation models compliance as certain** — conscripted players always
accept, grifters always wait, displaced players always take the new role. Nothing in the
model can output "the player just quit". Question 1 (how long will someone tolerate having
no role — we currently make them wait ~22 days mean, 100+ worst case) is the single largest
untested assumption in the design.

**2. Wire real exit-ticket accrual into Import/Export's route detection.** Crossing success
draws from an aggregate stand-in (`COMPLETE_TICKET_FRACTION`, 57%) rather than real
per-player postcard holdings. The last placeholder in an otherwise complete mechanic.

**3. Courier/Journalist/Detective share one flat wage.** They produce differentiated
resources (parcels/stories/leads) that nothing consumes yet. This is *deepening three
existing roles*, not expanding the roster — but it is also the easiest place to accidentally
over-build, so keep it to whatever makes them distinct and fun to hold, not a full economy
each.

**4. Shard diversity is at Tier 1 (cosmetic) and deliberately stops there.** Shards differ
in name and local role framing (`engine/shardIdentity.ts`, `npm run shard-identity-report`) —
Miller and Baker keep recognisable titles as the economic spine, the other four are reframed
locally so a migrant's knowledge is partially wrong. Mechanics are identical everywhere, and
that is enforced structurally: `world.ts` cannot import the module, and a test proves it.
**Tier 2 (per-shard mechanical differences) is blocked** on research question 10 —
`chooseMigrationDestination` assumes shards are interchangeable, so the moment they differ in
quality the simulation would report a stability it is no longer testing.

**5. Physical building relocation on MERGE.** A merged district's buildings stay in place,
permanently friction-penalised, rather than relocating capacity into a surviving district.

**6. Observatory Phases D-F** (snapshot/replay contract, the web app, civic-memory
monuments) — not started.

**Still open from before, unchanged:** `TRAVEL_DAYS_TARGET=168` vs the postcard/tier 4-8 week
target; the sabotage model decision (act-based vs the simulated pattern-based proposal);
Phase 2's §2.6 Shift Cover; real Phase 4 rendering; Phase 5 voice/safety (hard-gated on legal
review).

## Things to know before you touch this

**The flour chain is the most fragile coupling in the system — check it after any config
change.** Three separate times, a change elsewhere (adding a role, fixing consolidation,
changing district counts) silently pushed the grain→flour→bread chain incoherent, meaning
Bakers baking flour nobody milled. It is invisible to every population/health/equality
metric. `joint-grid-search` treats `flourRatio <= 1.0` as a **hard filter, not a score**,
which is the only reason it keeps getting caught — 151 of 560 allocations fail it.
`FLOUR_PER_BREAD` is the free parameter that absorbs adjustment; the role allocation is
chosen on design grounds and should not be bent to fix the chain.

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

**Other standing notes:**
- `multiRoleConscription.ts` is a NEW function; the old 2-role `stepConscriptionDay` is
  untouched and still covered by its own tests. Don't merge them without checking both.
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
