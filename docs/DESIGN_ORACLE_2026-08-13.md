# DESIGN — The Oracle: Real Odds Tied to Real Economic Health

**2026-08-13. Design only — no engine code in this pass.** User: *"we also need to start
putting values, odds and statistics into the oracle, anything that's mechanical requires
development and modelling. event prizes etc etc."*

The Oracle's shape is already locked (`docs/DESIGN_ADDENDUM_2026-08-06.md`, "The Oracle —
public interface onto calculated luck"): a daily universal errand, flat/identity-agnostic
probability, and — the one piece left explicitly `[OPEN]` — odds that float on the shard's
real economic health, with no metric chosen yet. This document closes that gap with a real
metric, checked against what the engine already measures, and lays out what "event prizes"
should actually pay out from. Nothing here is built — the Oracle doesn't exist in code at all
yet (only `importExport.ts`'s `drawTicketProgress` exists today, and that's a flat aggregate
stand-in for exit-ticket holdings, not a health-linked probability draw).

---

## 1. The metric: `economicHealthWithExperience`, not `economicHealth` — checked, not assumed

Two candidate metrics already exist in the shipped engine, both 0..1, both already computed
every tick on `World`:

- `economicHealth` (`ecosystem.ts`) — floors at `BACKSTOP_PRODUCTIVITY` even at zero real
  occupancy, because a vacated slot always reverts to mechanical backstop output. Real,
  measured behavior from earlier this project (`docs/BLUEPRINT.md`'s "uniform role
  completion" entry): under sustained real attack, this metric stayed at **mean 0.96** —
  "basically fine" — because the backstop absorbs the damage the metric is supposed to
  reveal.
- `economicHealthWithExperience` — same shape, but denominates against real occupant
  experience, not just occupied/backstopped. Same real measurement, same attack scenario:
  this one showed **mean 0.77** — genuinely, visibly worse, because experience lost to churn
  doesn't hide behind the backstop's flat productivity floor.

**Choosing `economicHealthWithExperience` for the Oracle, not `economicHealth`.** The whole
point of "odds float on shard health" is that players should be able to *feel* their shard's
condition through the Oracle. A metric that reads "basically fine" under real, sustained
attack (per the measurement above) would leave the Oracle's odds nearly static regardless of
what's actually happening — defeating the mechanic's stated purpose ("keeping the shard's
economy functional isn't civic virtue, it's what widens your own personal odds tomorrow").
`economicHealthWithExperience`'s already-measured 0.77–0.96 range gives real, felt movement.

---

## 2. The mapping: health -> `base_odds`, shape not final numbers

The exit-ticket gamble's own illustrative model (`DESIGN_ADDENDUM_2026-08-06.md`, "refinement
of the exit ticket gamble") already validated a **flat** `base_odds` at 5000-player,
1000-day scale: stable ~28% win rate against a 30% target, no runaway completion, no
death-spiral, active players' mean progress holding in a stable 0.38–0.48 band throughout.
That simulation's own `[OPEN]` note says exactly what's needed next: *"Real values depend on
the Oracle's actual economic-health-linked odds model... Re-run this population check once
that model is defined."* This section is that model's shape — the re-run itself is listed as
the concrete next step in §5, not done here.

**Proposed shape** — linear, clamped, with a floor (constraint 2: no permanent zero-state
applies to odds exactly as much as it applies to population or standing):

```
base_odds(health) = clip(
  base_odds_healthy * (health - health_floor) / (health_reference - health_floor),
  odds_floor,
  base_odds_healthy
)
```

Where `health_reference` (~0.96, the measured healthy-condition value) maps to the ALREADY
population-validated flat `base_odds_healthy` — preserving every stable-dynamics property the
existing simulation already proved, at healthy times. `health_floor` and `odds_floor` are the
constraint-2 guarantee: odds shrink as health degrades but never hit zero, matching the
existing exit-ticket design's own "a loss is a real cost... never a full wipe" principle
applied to the DRAW itself, not just its outcome. **All four constants
(`base_odds_healthy`, `health_reference`, `health_floor`, `odds_floor`) are `[ILLUSTRATIVE]`**
— the shape is the real design contribution here; tuned numbers need the re-simulation in §5
before they're trustworthy, per this project's own "measure before trusting" discipline.

**Why linear, not something fancier**: nothing measured yet justifies a curve. A linear
clamp is the simplest shape that satisfies the two hard requirements (matches the already-
validated flat value at healthy conditions; never reaches zero) — if a real sweep later shows
a different shape genuinely serves player experience better, that's a deliberate, evidenced
change to make then, not a guess to make now.

---

## 3. Event prizes: draws from real, already-existing quantities, never a new currency

The addendum's own constraint is explicit and binding: *"The Oracle's entire remit is: report
real probability draws from real distributions already in the system. Never narrative
flavour, never random noise dressed as meaning."* Event prizes have to be real, not invented
— concretely, drawn from quantities this engine already tracks and already treats as
economically meaningful:

- **A nodule bonus** — extra grain arriving at the dock beyond the day's ordinary
  `NODULES_PER_DAY` supply, the exact same "refund into the closed loop, never a new
  currency" shape the fines ruleset's fine-refund already uses
  (`docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §6) — reusing that same mechanism rather than
  inventing a second one.
- **A resource-stock top-up** — a direct addition to whichever personal resource stock a
  winning role-holder already has (`docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §1), capped the
  same way ordinary accrual is capped, so a win can't be used to bypass the cap that makes
  crafting a real, felt choice.
- **A wealth bonus** — [ILLUSTRATIVE, and the one to be most careful with]: this project has
  already measured, directly, that its market structure does NOT produce runaway inequality
  under ordinary play (`README.md`'s "Under the hood" — Gini plateaus around 0.5, not 90%+).
  A prize pool needs to stay small enough relative to ordinary daily wealth that it doesn't
  quietly reopen that finding — capped low, and checked against
  `test/wealth.regression.test.ts`'s existing Gini/top-10%-share invariants before shipping,
  not assumed safe by default.

**What a prize should NOT be**: nothing that grants a role, a reputation level, or any kind
of standing. Constraint 6 (reputation only ever grants, never removed by anything) and the
whole "no agent, no target for grudges, identical odds for everyone" design of the Oracle
itself both rule that out structurally — a lucky Oracle draw buying real standing would make
the Oracle a second, colder reputation system, exactly the kind of invented in-between memory
constraint 4 already forbids elsewhere. Prizes are economic, bounded, and additive-only, same
family as fines' refund, never a shortcut around anything else this project has built.

---

## 4. What this design does NOT decide

- The four illustrative constants in §2's mapping — real numbers need the re-simulation in
  §5, not a guess here.
- Exact prize sizes/probabilities for each prize type — not stated, not assumed.
- Whether prize odds ALSO float on economic health the same way completion odds do, or stay
  flat regardless of shard condition — the addendum's own text only commits the completion-
  gamble odds to the health mapping; prizes are a new addition this document introduces, and
  extending the same health-linkage to them is a real, separate decision, not assumed here.
- Whether the Oracle draws from a single shard-wide health number, or something coarser/finer
  (e.g. per-district, once districts re-exist at more than one per shard) — the shard is a
  single district today (`docs/BLUEPRINT.md`'s "District-topology question RESOLVED" entry),
  so this question is moot for now but will need revisiting if that changes.

## 5. Suggested next step, if/when this proceeds to code

Re-run the exit-ticket gamble's own population-scale simulation (5000 players, 1000 days,
same methodology as `DESIGN_ADDENDUM_2026-08-06.md`'s original check), this time with
`base_odds` computed per-day from §2's health-linked formula instead of the flat placeholder
— exactly what that simulation's own `[OPEN]` note already asked for. Compare against the
original flat-odds findings (stable ~28% win rate, 0.38–0.48 active-progress band, no
death-spiral) to confirm a REAL, moving `base_odds` doesn't break any of those properties
before trusting illustrative constants any further. Only after that verification should the
Oracle's draw mechanic and prize system actually get built.
