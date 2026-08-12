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

**348 tests, all passing; `npm run typecheck` clean. Working on `main` directly.**

Built and tested before this session: Phase 1 (economic core), Phase 2 (vacancy +
conscription), the §8 MVP mechanic, the client/server scaffold with real targeted delivery,
the ecosystem-scale layer (economic floor, migration, sabotage, experience, districting),
Observatory Phases A-C (spatial primitive, unified `world.ts` kernel, synthetic drivers),
and the 6-role roster + grifter pool / district consolidation / multi-shard registry /
named resources / Import-Export-and-nodules work from earlier the same day. Observatory
Phases D-F are not started.

**This session, in order:**
1. **Strengthened the grammar invariants** (`test/grammar.invariant.test.ts`) — closed a
   real coverage gap (the old test's role-word blacklist missed 4 of 6 roles and all 84
   shard-local titles), then added two rules the user specified directly in conversation, not
   derived from the brief: **no identification signature** (a message may never resolve to a
   specific person — no pronoun aimed at another player, no definite singular description,
   no proper noun) and **no anaphora** (a message may never reference another message — no
   "I feel that too" — which is how repeated agreement becomes a whip count without ever
   naming anyone). Rewrote the imperative/interrogative/tense checks from word blacklists
   (which go stale as vocabulary grows) to one structural rule: every sentence must open "I
   ...". See `test/grammar.invariant.test.ts`'s own header for the full reasoning.
2. **A 9-item Design Addendum arrived** (`docs/DESIGN_ADDENDUM_2026-08-11.md`, saved
   verbatim) with an explicit build order (0/3 → 1-2 → 4-8) and scope discipline (role
   roster stays closed at six; nothing in it adds a role, currency, or subsystem). **Items
   0/3, 1, 2, and 4 are done** — see below and `docs/BLUEPRINT.md`'s entries for the full
   reasoning on each. **Items 5-8 are not started.**

### This session's addendum work, briefly (full reasoning in BLUEPRINT.md)

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
npm test                              # 348 tests
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

**0. FINISH THE ADDENDUM — items 5, 6, 7, 8 are not started.** This is the live piece of
work; everything else below is longer-horizon. `docs/DESIGN_ADDENDUM_2026-08-11.md` has the
full brief for each. In its own build order:
- **Item 5 — no money; nodules as the sole root input, closed conservation loop.** The
  largest of the four and explicitly the riskiest: it makes the supply chain *longer*
  (nodule→grain→flour→bread), and the addendum requires extending the hard-filter coherence
  check across the whole chain, treating a break as a build failure. Resources stay
  non-fungible and role-locked — no generic currency, no universal exchange, no common
  "value" field, or money has been reinvented with extra steps.
- **Item 6 — courier pay: distance/time only, never cargo value**, paid by whoever
  commissioned the delivery. Removes the collusion incentive structurally rather than by
  policing intent. Geography is the expansion cap; don't add a second artificial one.
- **Item 7 — Shift Cover** (also closes Phase 2's long-open §2.6): player-initiated opt-in
  coverage of an offline role-holder's slot. Nothing assigns/notifies/schedules it —
  noticing is the skill being rewarded. Must be verified net-negative against the
  coordinated-abuse case (two players alternating self-created gaps to farm each other's
  slots) **in simulation, with numbers**, not assumed away.
- **Item 8 — two daily economic throttle windows** at ~10% output, economy only. Public,
  predictable, deterministic — deliberately the *opposite* rule from sabotage's covert
  hazard timing (see "covert mechanics must not run on learnable clocks" below; this is an
  overt civic timer, and the contrast is intentional). Implement as a scheduled multiplier
  on existing market equations, not a new subsystem.

Then the addendum's **"report back explicitly on"** questions, which are the actual
acceptance criteria and need real numbers: does the closed nodule loop balance long-run or
accumulate/starve; is coordinated slot-farming genuinely net-negative; do cross-role
completion rewards land at real parity (item 4's hard-filter test already answers a version
of this — extend it if item 5 changes reward flows); does identity resolution produce a
meaningful core-vs-periphery difference or one too small to feel.

**1. Answer the research questions that simulation cannot.** See
`docs/RESEARCH_QUESTIONS.md`. Three of them are load-bearing and structurally invisible to
us, because **the simulation models compliance as certain** — conscripted players always
accept, grifters always wait, displaced players always take the new role. Nothing in the
model can output "the player just quit". Question 1 (how long will someone tolerate having
no role — we currently make them wait ~22 days mean, 100+ worst case) is the single largest
untested assumption in the design, and the addendum explicitly does not address it.

**2. Wire real exit-ticket accrual into Import/Export's route detection.** Crossing success
draws from an aggregate stand-in (`COMPLETE_TICKET_FRACTION`, 57%) rather than real
per-player postcard holdings. The last placeholder in an otherwise complete mechanic.

**3. Courier/Journalist/Detective's differentiated resources still feed nothing.** Item 4
gave all six roles a real completion signal and reward, so "nothing distinguishes holding
the role well" is **resolved** — but parcels/stories/leads are still produced and tracked
with no consumer. Item 5's closed loop is the natural place to decide whether they should
have one. Easiest place in the project to accidentally over-build; keep it to whatever makes
them distinct and fun to hold, not a full economy each.

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
target; the sabotage model decision (act-based vs the simulated pattern-based proposal — note
this one now blocks a *second* thing, since item 4's Detective task had to use a friction bar
rather than the addendum's own "catch a saboteur" example precisely because the pattern-based
model isn't shipped); real Phase 4 rendering; Phase 5 voice/safety (hard-gated on legal
review). Phase 2's §2.6 Shift Cover is no longer open-ended — it is now scoped as addendum
item 7 above.

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
