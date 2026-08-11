# Open research questions — where external evidence would stabilise the core

**Purpose.** The simulation is internally consistent and heavily tested, but a number of its
load-bearing constants are `[ILLUSTRATIVE]`: defensible, swept against each other, and
*self-consistent* — yet never checked against how real people actually behave. Internal
sweeps can only tell us a value is coherent with the rest of the model. They cannot tell us
it is **right**. This document lists the places where that distinction matters most.

**Scope note (2026-08-11, user directive):** the role roster is **closed** at six — Miller,
Baker, Courier, Journalist, Detective, Import/Export, plus the roleless grifter population.
Nothing here proposes new roles, new systems, or new mechanics. The goal is **enough for
stability and fun** — so every question below is about whether what already exists holds up
with real people in it, not about building more.

Questions 1, 5 and 6 are the ones that bear on *fun* as much as stability: they are all
about whether a mechanic that works in simulation is actually tolerable to be on the
receiving end of.

**How to read the priority ratings.** *Load-bearing* means a wrong answer invalidates
calibration work already done. *Important* means it changes tuning but not structure.
*Useful* means it would improve confidence without changing much.

---

## 1. How long will a real player accept having no role? — **LOAD-BEARING**

**What we assume:** nothing. This is the single largest untested assumption in the design.

**What the model currently produces:** grifters wait a mean of **~22 days** to get a role,
with a p90 around **45 days** and a worst observed case over **100 days**. They earn a real
income floor throughout (`GRIFTER_DAILY_INCOME`), so they are never at zero — but they are
below every role's wage for that entire period.

**Why it matters:** the grifter pool is where every new player starts and where every
churned role-holder returns. If real players quit after, say, a week without a role, then a
22-day mean wait means the game bleeds exactly the people it most needs to retain, and the
whole vacancy/conscription equilibrium is built on a population that would not exist. Every
population figure in `BLUEPRINT.md` assumes those people stay.

**What would change:** if tolerance is much shorter than ~20 days, the fix is structural,
not cosmetic — role slots would need to be far more numerous relative to population, or
roleless players need a genuinely engaging activity loop, which does not currently exist.

**What would answer it:** retention/churn data from persistent games with queue-or-wait
onboarding; research on tolerable wait times before abandonment in multiplayer contexts;
ideally, playtest data of our own.

---

## 2. Is 20% monthly churn realistic for this kind of game? — **LOAD-BEARING**

**What we assume:** `pMonthly = 0.2` — 20% of role-holders leave their role each month.
Taken from the original brief, never independently validated.

**Why it matters:** churn drives *everything* downstream. It sets vacancy rates, which drive
conscription frequency, which drives the grifter pool size, which feeds the migration valve,
which sets equilibrium population. `vacancy.ts`'s entire calibration (`beta`, `tHard`) was
tuned against §2.4 targets that themselves presuppose this churn rate.

**What would change:** a materially different churn rate would require re-running Phase 2's
whole calibration, and would move the shipped role allocation.

**What would answer it:** published retention curves for persistent social/economic games at
this scale; distinction between *leaving the game* and *leaving a role* matters here, and
our model currently conflates them less than it should.

---

## 3. What per-shard population actually sustains a social economy? — **IMPORTANT**

**What we assume:** 50-80 players per shard (brief), `targetPopulation = 65`. The model
settles around **56**, comfortably inside that band.

**Why it matters:** the band is the anchor for "is the shard healthy". If real social
cohesion needs 120 people, or works fine at 30, the district counts, role allocation, and
shard-opening thresholds all shift.

**What would answer it:** research on group size and social cohesion (Dunbar-adjacent work
is suggestive but not directly applicable to asynchronous online play); comparable data from
existing small-shard persistent games.

---

## 4. What wealth inequality do players actually perceive as unfair? — **IMPORTANT**

**What we assume:** lower Gini is better, with no threshold. The model currently runs a Gini
of about **0.55**, with the top 10% holding roughly **41%** of wealth.

**Why it matters:** we have optimised *toward* equality without knowing where the line is.
If 0.55 already reads as unfair to players, the current configuration ships a problem. If
players tolerate up to 0.65, we have been trading population and health for a fairness gain
nobody perceives — which the joint grid search shows we have done, deliberately, more than
once.

**Prior work already done:** `wealth.ts` cites real yard-sale-model literature, and we
verified NODE does *not* reproduce the 90%/10% condensation those models predict. But that
is about mechanism, not perception.

**What would answer it:** research on perceived fairness thresholds in game economies;
player-facing studies rather than purely economic ones.

---

## 5. How do players respond to compulsory role assignment? — **IMPORTANT**

**What we assume:** conscription is mandatory with no opt-out ("like it or not"), and
displaced players get 14 days to choose before being placed. Both figures are design
decisions, not researched ones.

**Why it matters:** this is one of the few genuinely coercive mechanics in the game, and it
fires regularly. If forced assignment reads as punitive rather than as civic obligation, it
could drive exactly the churn the mechanic exists to prevent — a self-defeating loop the
simulation cannot detect, because it models compliance as certain.

**What would answer it:** research on compulsory/assigned duties in multiplayer games;
comparable mechanics (jury-duty-style systems) and their reception.

---

## 6. Is an irreversible district merge acceptable to players? — **IMPORTANT**

**What we assume:** consolidation cannot be reversed once genuinely triggered (explicit
design decision). Trade-route friction degrades visibly for 14 days first, then the merge is
permanent.

**Why it matters:** permanent, un-undoable loss is a strong mechanic. It is currently rare
(~22% of districts merge over a long run, and only in genuinely failing shards), which is
the intended behaviour — but "rare and permanent" can still be the thing players remember
and resent.

**What would answer it:** research on permanent-loss mechanics and player retention;
particularly whether *visible warning before* permanent loss materially changes acceptance,
since that is exactly what the friction ramp is for.

---

## 7. Real-world daily activity patterns — **USEFUL**

**What we assume:** an 8-hour daily downtime window at 10% activity, on a single shared
timezone, giving `DAILY_ACTIVITY_MULTIPLIER ≈ 0.70`.

**Why it matters:** a single global window advantages some timezones and disadvantages
others. The model cannot see this because it has no per-player timezone.

**What would answer it:** activity-by-hour data for globally distributed player bases; how
comparable games handle server-time-based downtime fairly.

---

## 8. Risk tolerance on the illegal route — **USEFUL**

**What we assume:** `INTERCEPT_BASE_P = 0.35` per attempt, jittered, with a complete exit
ticket bypassing risk entirely. Chosen to reproduce the previously calibrated 0.15 aggregate
failure rate, *not* from any evidence about what feels right.

**Why it matters:** 35% is high enough to be a real deterrent and low enough to tempt. That
is a guess. If it is far off, the legal/illegal route choice collapses into "always" or
"never", and the mechanic stops being a decision.

**What would answer it:** research on risk/reward thresholds in games with smuggling or
contraband mechanics.

---

## 9. Exit-ticket pacing — **USEFUL**

**What we assume:** ~40 days of passive accrual to a first complete ticket (from the
postcard/tier addendum), with gambling as an optional accelerator.

**Why it matters:** this sets how long "I could leave" takes to become real. Too fast and
shards destabilise; too slow and the choice is theoretical. Also currently disconnected from
the simulation — Import/Export's route detection uses an aggregate stand-in
(`COMPLETE_TICKET_FRACTION = 0.57`) rather than real per-player accrual.

**What would answer it:** comparable long-horizon unlock pacing in persistent games.

---

## 10. Do players chase the *best* shard, or the most *interesting* one? — **LOAD-BEARING (blocks Tier 2 diversity)**

**What we assume:** that shards are **interchangeable**. `chooseMigrationDestination` picks
by dormancy first, then lowest population — it has no concept of a player preferring one
shard over another on any quality, and no way to express such a preference.

**Why it matters:** that assumption is safe only while every shard is genuinely identical,
which is true today. The moment shards differ in more than name (Tier 2 — per-shard role
counts, scarcity, or conditions), the assumption silently becomes false, and the simulation
would keep reporting a stable population equilibrium it is no longer actually testing.

**The specific risk:** diversity has to be *lateral* (different in character) rather than
*vertical* (different in quality). If one shard is simply a better place to live, migration
stops being a redistribution mechanism and becomes a gradient everyone flows down — which
would undo the population equilibrium that `opportunityAdjustedMigrationStep` was built to
fix. Worse, the current model cannot detect that happening, because it never models choosing.

**What we did about it for now:** shipped **Tier 1 only** — shards differ in name and local
framing, with identical mechanics, enforced structurally (`world.ts` cannot even import
`shardIdentity.ts`; see `test/shardIdentity.test.ts`). That delivers cross-shard diversity
and the "a migrant's knowledge is partially wrong" effect with zero calibration risk, and
deliberately leaves Tier 2 blocked on this question.

**What would answer it:** research on server/realm selection in games that offer meaningfully
different realms; whether players optimise for advantage or for social fit and novelty. If
they optimise for advantage, Tier 2 needs a migration-preference model *before* any shard is
allowed to differ mechanically.

---

## 11. Where does a persistent, ambitious player put that ambition? — **LOAD-BEARING**

**What we assume:** nothing — and that is the problem. There is **no reputation system in the
code at all**. Containment against domination works (see `docs/ADVERSARIAL_CONTAINMENT.md`),
but a patient, invested player currently has no legitimate channel for ambition whatsoever.

**Why it matters:** this may be a worse failure than the domination risk it is protecting
against. The players most willing to invest years are the ones with least to do. Constraint 6
already fixes the *shape* any answer must take (additive only, never subtractive, never
pushing anyone below their floor) and constraint 4 fixes where legacy may live (public
collectively-witnessed events persist; private judgements never do). The design is specified
and unbuilt.

**Purpose now specified (2026-08-11).** Reputation is not a reward or a scoreboard — it is
the **coordination substrate**. A player cannot execute anything ambitious alone (one role
each, wealth buys nothing, the grammar cannot carry a plan), so they need allies who are
strangers with imperfect information. The only basis for a stranger to act with you is what
they have witnessed you do. That makes reputation the thing that *prices* ambition: it takes
time, it is visible while being built, and it cannot be bought or faked.

**The hard constraint on any design:** built on **actions, not superiority** — derived from
publicly witnessed events, never from wealth, rank, or role held. Constraint 4 supplies the
source (civic memory: collectively-witnessed events may persist, private judgement may not);
constraint 6 supplies the limit (additive only, never subtractive).

**The self-limiting mechanism (2026-08-11).** Being known is simultaneously the benefit and
the risk: reputation buys coordination with strangers, and the same visibility makes the
player legible, so they can no longer move quietly. Ambition pays twice — in time to build
it, and in obscurity permanently once built. Note carefully that this is **not** subtractive:
what is lost is obscurity, never standing, and obscurity was never part of the protected
baseline (constraint 6 guarantees a floor *of* visibility). Any design where fame *reduces*
something violates constraint 6.

**Requirement, revised 2026-08-11.** An earlier version of this said grifters must be able to
build standing *outside* roles, on the grounds that reputation-from-role-activity would lock
them out. That was overstated: the role system is itself the ladder — voluntary fills and
conscription move grifters into roles at a ~22-day mean wait, and holding a role is exactly
what makes a player witnessable. The narrower requirement that does hold: **a long roleless
spell must not erase a player's history.** `RoleEconomicSlot.wealth` resets to 0 on every new
occupancy, which is right for wealth and would be wrong for standing — applied to reputation
it would turn the ~100-day worst-case wait into a genuine caste trap.

**What would answer it:** research on prestige and legacy systems that confer standing
without conferring power over others — the distinction is the whole difficulty, and most
existing games collapse it. Also: how coordination forms between strangers under enforced
communication limits, since that is the loop this has to support; and whether visibility
alone is a sufficient deterrent in practice, or whether players simply accept being watched.

---

## 12. Is ten symbols enough to actually play a social game with? — **LOAD-BEARING**

**What we assume:** that the grammar (10 `SelfState` values, first-person only, no subject,
no free text) leaves enough room for meaningful social play — probing, signalling, building
private conventions with trusted allies.

**Why it matters:** the constraint is doing excellent defensive work — it is the single
strongest anti-information-brokering property in the design (see
`docs/ADVERSARIAL_CONTAINMENT.md`). But defence is not the point. The intended gameplay is
*interrogating people without them knowing*, by emitting a signal and reading what comes back.
That requires the channel to be narrow enough to stay ambiguous and wide enough to carry
intent. Ten symbols is ~3.3 bits per message.

**The failure mode:** if probing is indistinguishable from noise in practice, the social layer
is not subtle — it is dead. The protection would then have cost the game the very thing it
exists to protect. That is a real possibility and the current design has no evidence either
way.

**What we know it does support, at least in principle:** private conventions between players
with shared history ("two `uneasy` in a row means the thing we discussed"). The system cannot
detect these and should not try — the useful property is that a code cannot be bootstrapped
with a *stranger* through ten ambiguous symbols, so conspiracy ends up gated on relationship
rather than banned. Whether that is enough to feel like a game is the open part.

**What would answer it:** playtesting, primarily — this is not simulable, since the model has
no player capable of probing. Adjacent evidence: research on constrained-communication games
(Hanabi, Spyfall, Werewolf variants with restricted vocabularies) and how much expressive
range players need before signalling becomes legible.

---

## Cross-cutting note on method

Several of these share a failure mode worth naming: **the simulation models compliance as
certain.** Conscripted players always accept; grifters always wait; players displaced by a
merge always take the new role. Nothing in the model can produce "the player just quit" as a
response to a mechanic, so no amount of internal simulation will ever surface questions
1, 5, or 6. Those need real evidence or playtesting — they are structurally invisible to us
otherwise.

Conversely, questions 3, 4, 7, 8 and 9 are calibration: the model *can* explore them, and
the sweep infrastructure already exists to do so once a target is known.

Question 12 is the sharpest case of the whole pattern: the mechanic is provably good at what
it prevents and completely unevidenced at what it enables. Only people can tell us.

Question 11 is the mirror of the rest: not "is our number right" but "is there anything here
for our most invested players to want". Simulation cannot raise it either, because nothing in
the model has ambition.

Question 10 is a third kind again: the model does not merely fail to answer it, it **encodes
a specific answer already** (shards are interchangeable) without that ever having been a
decision. Those are the most dangerous assumptions in any simulation — not the ones known to
be uncertain, but the ones baked in as structure and never noticed.
