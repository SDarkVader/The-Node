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

## Cross-cutting note on method

Several of these share a failure mode worth naming: **the simulation models compliance as
certain.** Conscripted players always accept; grifters always wait; players displaced by a
merge always take the new role. Nothing in the model can produce "the player just quit" as a
response to a mechanic, so no amount of internal simulation will ever surface questions
1, 5, or 6. Those need real evidence or playtesting — they are structurally invisible to us
otherwise.

Conversely, questions 3, 4, 7, 8 and 9 are calibration: the model *can* explore them, and
the sweep infrastructure already exists to do so once a target is known.
