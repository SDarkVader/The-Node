# DESIGN — Universal Housing, Ground-Level Role Access, and Reputation Levels

**2026-08-13. Design only — no engine code in this pass**, per the same discipline used for
`docs/VISUAL_FRAMEWORK_2026-08-12.md` and the pop=100 config adoption: work out the shape in
writing, with citations to what's already measured or already built, before anything gets
coded. This document exists because the user asked directly, after a session-long
conversation this doc reconstructs faithfully rather than re-deciding: *"Want me to write
this whole thing up as a real design document — housing, ground-level access, and levels as
one coherent system — before any code?"* — "yes."

---

## 0. Why these three are one system, not three

The trigger for this was a rejection, not a request. Two `AskUserQuestion` framings about
**district count** were rejected in a row — first for proposing options without real
population-per-district math ("look at what your proposing, how many players per district?
... it's absurd"), then for staying at the tactical district-count level at all ("read what I
said first"). The user's own reframing, arriving concurrently with that second rejection,
named the actual problem: district count is a symptom. The real question is **how a player
without a role — a grifter — exists in this world at all**: where they live, how they're
seen, and how they get from "no role" to "a role," visibly, without a scheduler deciding it
for them.

Three sub-questions fell out of that, and this doc answers all three because they share one
answer, not three separate ones:

1. **Where does a grifter live?** → §1, universal housing.
2. **How does a grifter get a role?** → §2, ground-level access (reusing Shift Cover).
3. **How does "getting a role" turn into standing that unlocks more, without hurting anyone
   else's growth?** → §3, reputation levels.

The connective tissue, stated once so it isn't repeated three times below: **every mechanism
used here already exists and is already measured.** Per the user's explicit instruction
("try and find creative solutions to problems within the constraints of the game to find
emergent mechanics" — 💯'd, not qualified), this design adds **zero new simulation
mechanics**. It composes `shiftCover.ts`, `roleCompletion.ts`'s daily-cap shape, the
already-individually-tracked `GrifterSlot`, and constraints 2/4/6 from `CLAUDE.md` — all
already built, already tested, already measured against the real engine.

---

## 1. Universal housing (the "abode")

### 1.1 One housing type, for everyone

The user was explicit and corrected an early misreading of theirs immediately: grifters do
**not** get a separate housing category. *"the same abode anyone with a role has."* A Home is
a Home. A grifter's silhouette lives above a bakery on the same floor plan a Baker's
silhouette would occupy if the Baker chose to live there instead of somewhere else in the
district. Housing is decoupled from role entirely — it is decoupled from *employment status*,
which is the whole point: a grifter is not a lesser resident, just a resident without a
workplace yet.

This directly matches user's own image: *"they can live amongst society as silhouettes, above
bakeries, and elsewhere across the city, they just don't have a role option."* Two things to
take literally from that sentence, not just poetically:

- **"Above bakeries"** — homes are not always a separate building footprint. The natural
  reading is **mixed-use**: a building's ground floor is its role function (if it has one —
  Mill, Bakery, Docker post, Courier waystation, etc.), and the floor(s) above are housing,
  available to anyone in the district regardless of who works the ground floor. This costs
  nothing new in plot count.
- **"And elsewhere across the city"** — not every Home building needs a ground-floor role.
  Districts can also carry Home-only buildings with no `roleSlotRef` at all, exactly like a
  `Building` with `roleSlotRef: null` already models today (`space.ts:70`) — that field
  already exists for a building with nothing assigned to it yet; a Home-only building is the
  same shape, permanently.

So: **no new building category is required at the type level.** `Building` (`space.ts:58-71`)
already has an optional role reference. What's missing is a **housing capacity** attached to
every building regardless of its role, which is §1.2.

### 1.2 Floors as the density lever, not plot count

This resolves the exact objection that killed the fixed-district-count framing. The rejected
math ("6 is unreasonable") was implicitly plot-count-bound: it read population capacity as
tied to how many buildings/plots a district's geometry could physically hold, the same
resource role slots already compete for. That's the wrong resource to spend on housing.

The user's own fix: *"population density can be layered if necessary, through first, second
floor etc."* Housing capacity is `floors × residentsPerFloor` **per building**, not one
resident per plot. A district's total housing capacity is the sum of that across every
building in it — role-bearing and Home-only alike — and can be scaled by adding floors to
existing buildings long before a district needs a new building footprint at all.

This is the same principle already in play everywhere else in this engine: `world.ts`'s
opportunity valve ties population capacity to **open role-slot count**, not to a free
population target (`DESIGN_HOUSING...` — see `docs/BLUEPRINT.md`'s opportunity-valve entry).
Housing needs its own equivalent, cheap knob — floors — rather than silently assuming
plot-count scales with population the way the addendum's role-slot-scaling claim turned out
not to (see `src/sim/populationCapacitySweep.ts`, which measured and rejected exactly that
assumption for role slots; the same measure-before-trusting instinct applies here: **floor
count should be tunable independent of district/building count, verified against real
`stepWorld` population output before being trusted, not just derived on paper**).

Concretely, this means the eventual engine change (not this pass) is:

- Add `floors: number` to `Building` (default 1 for a building with no housing, e.g. this
  could stay a flat multiplier of a fixed `RESIDENTS_PER_FLOOR` constant so most buildings
  need no per-building tuning).
- A district's **housing capacity** = `sum over buildings of floors * RESIDENTS_PER_FLOOR`.
- This is a distinct pool from **role-slot capacity** — a resident (role-holder or grifter)
  needs a housing assignment *and*, if employed, a role slot; the two are checked
  independently, the same way an employed player today already has independent wealth/wage
  and role-slot state that don't collapse into one field.

### 1.3 Residency assignment (sketch, not implementation)

When a player enters the world — arrival, or falling back to grifter status from any of the
existing paths (`world.ts`'s emigration/consolidation/sabotage-eviction grifter-pool
re-entries, all already real code paths per `identity.ts`'s header, §"now span every
identity-bearing player") — they need a Home floor slot, not just a `GrifterSlot` record.
Rules, derived from patterns this engine already uses elsewhere rather than invented fresh:

- **A role-holder is housed in the same district as their workplace** where capacity allows —
  this is the natural default and needs no new logic; it's the district a `districtOf(plot)`
  (`space.ts:151`) already resolves them into via their building.
- **A grifter is housed in whichever district currently has floor capacity**, same
  nearest-lowest-density selection `placeArrival` already uses for districts
  (`space.ts:185-192`, "district selection among same-classification districts is by lowest
  current [population]") — reused, not reinvented, just applied to housing capacity instead
  of role capacity.
- **Displacement on capacity loss** (e.g. a district MERGE, `districtConsolidation.ts`)
  follows the exact grace-period shape already shipped for role-holder eviction:
  `CONSOLIDATION_GRACE_DAYS` and `consolidationDeadline` (`world.ts:786`) — a resident whose
  Home building's district merges gets the same grace window before forced relocation that an
  evicted role-holder already gets, not a new and different deadline mechanic.

### 1.4 The `District.population` bug this design depends on fixing

Flagged directly to the user mid-session, still unfixed: `District.population`
(`space.ts:88`, "Current player count in this district — 0 at generation; Phase B updates it
as players move") is never incremented by the real `stepWorld` tick flow — only
`placeArrival` touches it, and the normal tick loop doesn't call it. Measured directly: every
district read population 0 across every seed tested at day 800, despite `world.population`
correctly tracking real totals.

This design makes that bug load-bearing rather than cosmetic: **once residency assignment
(§1.3) exists, `District.population` should be redefined as "residents currently housed here"
— derived from real Home-floor assignments, not a separately-tracked counter that can drift
out of sync.** Fixing the increment bug is a prerequisite of this design shipping, not an
unrelated cleanup — flagging that explicitly so it doesn't get silently skipped when this
moves to code.

### 1.5 Interaction with the open district-topology question

`VISUAL_FRAMEWORK_2026-08-12.md` §8 still has the three-wedge-geometry vs. 3/6/11-district
count conflict marked **unresolved**, and this doc does not resolve it — but it does change
what "population per district" actually means once §1.2 ships. The population math that made
"6 is unreasonable" land as a real objection was implicitly plot-count-bound (one resident ≈
one building slot); floors break that link entirely. A district's *housing* ceiling is no
longer read off its building count — it's read off its building count **times however many
floors get built on top of it**, which is a much cheaper, much less geometry-constrained
lever than adding whole districts.

That doesn't make the district-count decision go away — role-slot capacity (the addendum's
§4 cascading thresholds, keyed to the M9/B9/C7/J7/D8/IE6 = 46-slot roster now, not the
addendum's stale 26) is still a real, separate ceiling housing can't substitute for. But it
does mean the district-count decision, when it's made, should be made **after** re-checking
population-per-district against real housing capacity (§1.2), not against the plot-count
intuition that was rejected here. Recorded as the concrete next step in §5.

---

## 2. Ground-level role access (grifter grinding, made visible)

The user's own framing: *"we also have to create role opportunities at ground level so that
grifters can grind to get into whichever role is required by the economy."*

### 2.1 Shift Cover, reused not reinvented

This already exists, already measured, and already matches the spec almost exactly.
`shiftCover.ts` (built 2026-08-11) lets a grifter cover a BACKSTOPPED slot — a real, visible,
"a Courier running an uncovered route, a player working a vacant bakery" opportunity — for
`SHIFT_COVER_FRACTION` (0.4) of the slot's real wage, noticed via one independent
per-slot-per-day Bernoulli draw (`SHIFT_COVER_NOTICE_PROBABILITY`, 0.15), explicitly built
**not** to be a scheduler or notification system (its own header: *"nothing assigns it,
nothing notifies... watching the world is the skill being rewarded"*).

That is already "ground-level access to grind toward a role" almost word for word — the only
piece missing is that covering a shift doesn't currently accrue toward anything beyond that
day's pay. §3.3 closes that gap by having a successful cover also register one reputation
progress-tick, using the exact same daily-cap shape that already governs it. No new
opportunity mechanic is being proposed here — this section exists to name the reuse
explicitly, per the "find creative solutions… before inventing new mechanics" instruction.

### 2.2 Why this satisfies "ground level, not a scheduler"

Shift Cover's own design already rejected a scheduler/queue/notification system on the
grounds that "watching the world" is the intended skill. That constraint transfers unchanged
to reputation-building: a grifter does not queue for reputation progress, does not get
assigned a shift, and cannot force an opportunity to exist. They notice a real BACKSTOPPED gap
or they don't. This is precisely what makes it "grinding" in the honest sense the user meant —
effortful and skill-rewarding, not a progress bar filled by clicking a button.

---

## 3. Reputation levels

Full quote, because every clause here is load-bearing and misreading any one of them breaks
the design:

> *"reputation level needs to have levels, so if you're a grifter with little options, a
> small role at lvl 1 can become available. if at lvl 2, you can't become that role, only
> Lvl 2 roles, which would be less common. building reputation should increase the ability to
> do things, but not to affect other player growth on a mechanical level. if a lvl 1 grifter
> plays an event all day, the lvl 2 guy doesn't get an advantage. if necessary we'd consider a
> handicap ratio. so when the game is played you reach equilibrium and equal opportunities to
> gain reputation but increasingly difficult as the lvls advance."*

### 3.1 What a level is, and is NOT

**A reputation level is a single, global, additive progression value per player — like a job
title, not a trust score.** This distinction is not stylistic; it's required by constraint 4
(`CLAUDE.md`, "personal memory is mortal; civic memory is immortal — and nothing in between
gets invented... no cross-session or cross-shard per-player trust score is ever built, full
stop") and constraint 6 ("reputation may only ever grant, never remove").

Concretely, that means:

- A level is **public and civic** — the same category of fact as "which building this player
  currently works," already visible today. It records "this player has reached level N," a
  collectively-observable, non-judgmental fact, not "what player X privately thinks of player
  Y." No per-observer variation, no decay, no dossier.
- A level **only ever goes up.** There is no demotion path, no negative-signal subtraction —
  satisfying constraint 6's "no accumulation of negative signal may ever push a player below
  the floor" directly, and constraint 2's no-permanent-zero-state at the identity/standing
  scale, not just the population scale.
- Silhouette Shield (`identity.ts`) stays entirely separate and untouched — this doc does not
  couple reputation level to identity resolution speed. Higher-profile roles (Miller/Baker,
  who see more real market-driven foot traffic per the Cournot/Bertrand mechanics already
  built) will *naturally* accumulate more real encounters and resolve faster under the
  existing asymmetric-resolution mechanic — that's an emergent consequence of the existing
  system, not a new coupling this design adds. Adding an explicit reputation→resolution-speed
  multiplier was considered and rejected here: it would be exactly the kind of invented
  in-between memory constraint 4 forbids, layered on top of a mechanic that already produces
  the right shape for free.

### 3.2 Level → role-tier mapping, derived from measured data

Slot **count** alone doesn't give a usable tier split — the pop=100 winning roster (M9 B9 C7
J7 D8 IE6) actually gives Miller/Baker the *most* slots (9 each), not the fewest, so "less
common" can't mean raw headcount. What the engine already measures, and what genuinely
differentiates the six roles, is **difficulty of holding the role well**
(`roleCompletion.ts`'s header, hard-filter-tested against a real `stepWorld` run):

- **Miller & Baker: ~54–58% career completion.** Zero-sum, competitive (Cournot
  quantity-competition for Miller, Bertrand price-competition for Baker) — you're measured
  against rivals, not a fixed bar. Genuinely harder to hold well.
- **Courier, Journalist, Detective, Import/Export: ~97–100% career completion.** Cooperative —
  beat your own district's trade-route friction, not another player. Genuinely easier to hold
  well, once you're in it.

That split maps directly onto the user's "small/common role at lvl 1" vs. "less common role
at lvl 2, [gated at lvl 2 and above]" language, with the measured data giving the ordering
rather than a guess:

- **Level 1 (grifter-accessible)**: the four cooperative roles — Courier, Journalist,
  Detective, Import/Export. High real completion rate once held (~97–100%), no rival
  comparison, the honest "small role, achievable by grinding" tier.
- **Level 2**: Miller, Baker. Structurally harder (~54–58% completion, real rival
  competition), the "less common" tier in the sense that matters — fewer players actually
  succeed at it consistently, not that fewer slots exist.

Flagged honestly, matching this doc's own citation discipline: **this is a two-tier default
because the measured data only cleanly clusters into two groups today.** If a future role or
mechanic change produces a third distinguishable difficulty band, a level 3 should be derived
from re-measured `roleCompletion.ts` data at that time, not invented ahead of evidence — the
same "measure before trusting" instinct (constraint 1) that governed the pop=100 config
adoption this session.

### 3.3 Anti-grind fairness mechanism (daily cap, reused)

The requirement — *"if a lvl 1 grifter plays an event all day, the lvl 2 guy doesn't get an
advantage"* — is already structurally satisfied by two existing shapes composed together,
not a new anti-grind system:

- `roleCompletion.ts` already caps a role-holder's reward-relevant activity at **one attempt
  per FILLED day**, not per action — "career ratio, not per-attempt" is the file's own stated
  design. A level-2 role-holder grinding harder within a day already gains nothing extra from
  this mechanic; it was built anti-grind from day one.
- `shiftCoverNoticedIndices` (`shiftCover.ts`) already caps grifter opportunity the same way:
  one independent Bernoulli draw **per BACKSTOPPED slot per day**, with total covers capped at
  `grifterCount` — a grifter cannot "play harder" to manufacture more opportunities than
  exist; the model has no notion of session length or click-rate at all, by construction
  (deterministic day-tick, not action-tick).

Reputation progress for a grifter reuses this unchanged: **a successfully-covered Shift Cover
slot registers one reputation progress-tick for that day, capped identically to the pay
itself.** No separate reputation-specific rate limit needs inventing — the existing
once-per-BACKSTOPPED-slot-per-day cap already *is* the anti-grind mechanism, because there is
structurally no way to attempt it twice in one tick.

### 3.4 Rising bar, not a handicap on others

*"if necessary we'd consider a handicap ratio... increasingly difficult as the lvls
advance"* — the mechanism that satisfies this without touching any other player's rate of
gain is a **rising threshold, not a subtracted rate.** Each level requires more accumulated
progress-ticks than the last (a standard escalating-XP-curve shape) — a level-1 grifter's
*rate* of gaining reputation-ticks is untouched by anyone else's level; only the finish line
for level 2 moves further out. This is the same principle as constraint 6 applied
structurally: nothing about advancing yourself ever slows someone else down, and nothing
about someone else's advancement makes yours harder — it only makes the *next* level's own
bar, which was always going to rise, rise a bit more, for everyone equally, not
competitively.

This also directly explains the user's own "equilibrium" language: since gain-rate is
identical for everyone at a given level (§3.3) and the bar is a fixed, publicly-known curve
rather than a moving target relative to rivals, the population naturally distributes across
levels according to real time-in-role and real skill at noticing Shift Cover opportunities —
an emergent equilibrium, not an authored one, matching constraint 5 ("let outcomes be real,
don't script them").

### 3.5 Backstop/conscription always overrides

A real design fork exists here and needs naming explicitly rather than left implicit: what
happens when the mechanical backstop (constraint 2's "no permanent zero-state") needs to
conscript *someone* into a level-2 role, and the only available grifter hasn't reached level
2 yet?

**Resolution: reputation-level gates apply only to *voluntary* role uptake. Conscription and
backstop-fill always bypass them entirely.** This isn't a new carve-out invented for
reputation — it's the existing precedent in this engine already: backstop/conscription
already overrides every other access rule that exists (district access, wall-shortcut
privilege, everything) because constraint 2 is structurally senior to every voluntary-access
system built on top of it. A permanent unfilled level-2 slot because no one has "earned" it
yet would itself be exactly the permanent-zero-state failure constraint 2 exists to forbid.
Reputation is additive opportunity on top of the floor (constraint 6) — it can never become a
reason the floor fails to hold.

### 3.6 Additive-only, untouchable floor

Restated once more because it's the single constraint every other subsection above depends
on: a grifter with reputation level 0 retains every baseline access this engine already gives
every player — the grifter income floor (`GRIFTER_DAILY_INCOME`), eligibility for the
existing conscription/draft safety net, a Home to live in (§1, unconditional on role or
level), and ordinary emigration/consolidation handling. Levels only ever unlock *additional*
voluntary role tiers on top of that unconditional floor. Nothing in this design subtracts
from what a level-0 player already has.

---

## 4. Emergent connections found (recap)

Per the explicit "find creative solutions... to find emergent mechanics" instruction, named
plainly so the reuse is visible rather than buried in prose above:

1. **Role scarcity signal** for level-tiering comes from `roleCompletion.ts`'s already-measured
   completion ratios (§3.2) — no new sweep needed.
2. **Grinding opportunity** is Shift Cover, unmodified in mechanism, only extended to also
   register reputation progress (§2.1, §3.3).
3. **Anti-grind fairness** falls out for free from two already-shipped daily-cap shapes
   (`roleCompletion.ts` + `shiftCoverNoticedIndices`) composed together, not a new limiter
   (§3.3).
4. **Housing density** reuses the district lowest-population placement rule already used for
   role-holder arrival (`space.ts:185-192`), applied to housing capacity instead (§1.3).
5. **Displacement grace period** reuses `CONSOLIDATION_GRACE_DAYS` unchanged rather than a
   new housing-specific deadline constant (§1.3).
6. **Identity visibility** needs no new coupling at all — Miller/Baker's already-higher real
   foot traffic under existing market mechanics naturally resolves their Silhouette faster
   under the existing asymmetric mechanic, satisfying the user's "isolation, identity is
   immediately visible... depending on reputation" intent without inventing a second memory
   system (§3.1).

---

## 5. Open items / what this doc does NOT decide

- **District-topology count (3 vs 6 vs 11, or a cascading model)** — still unresolved, per
  `VISUAL_FRAMEWORK_2026-08-12.md` §8. §1.5 above changes what evidence that decision should
  be checked against (real housing capacity via floors, not plot count) but does not make the
  decision. **Recommended next step: re-run a population-per-district probe once floors
  exist, before revisiting district count.**
- **Exact numeric constants** — `RESIDENTS_PER_FLOOR`, the reputation-tick progress curve's
  exact per-level thresholds, and how many floors a typical building carries are all
  deliberately left unspecified here (illustrative, not yet measured) — per this project's
  own convention, these get [ILLUSTRATIVE]-tagged real values only once implemented and
  measured against a real `stepWorld` run, not guessed in a design doc.
- **The `District.population` tick-loop bug** (§1.4) needs a real code fix — flagged as a
  prerequisite of this design, not yet done.
- **Item 6 of the 2026-08-13 addendum** (role-building placement grid) still needs re-deriving
  against the 46-slot split regardless of district-count outcome — unrelated to housing but
  still open from the prior addendum work.

## 6. Suggested build order, if/when this proceeds to code

Not a commitment, just a sequencing note for whoever picks this up next, following the
project's own design→code→test→docs discipline:

1. Fix `District.population` tracking in the real `stepWorld` tick loop (prerequisite, §1.4).
2. Add `floors`/housing-capacity to `Building`/`District`, with residency assignment (§1.2–1.3),
   verified against real `stepWorld` output the same way `populationCapacitySweep.ts` verified
   the role-slot scaling claim — not trusted on paper.
3. Wire Shift Cover's existing successful-cover event to also register a reputation
   progress-tick (§3.3) — additive, should not touch `SHIFT_COVER_FRACTION` or
   `SHIFT_COVER_NOTICE_PROBABILITY`.
4. Add the reputation-level state and role-tier gate, applied only to voluntary uptake
   (§3.5), with regression tests proving backstop/conscription bypasses it.
5. Revisit district-topology count with real housing-capacity numbers in hand (§1.5).
