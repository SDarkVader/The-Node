# Design Addendum — 2026-08-07

Covers: postcard/tier exit-ticket system (replaces the flat-progress exit ticket
gamble from 2026-08-06), and organic shard-opening as the resolution to
multi-shard migration.

Tags follow repo convention: `[DESIGN — not yet built]`, `[CALIBRATED — provisional]`,
`[OPEN]`.

---

> **Verification note, added same day.** §6's simulation findings were checked
> independently — the original script (`/home/claude/node_sim/postcard_tier_sim.py`)
> lives in a different local sandbox and was never pushed to this repo, so
> `design/postcard_tier_verify.py` is a fresh model built only from this document's
> prose, not a copy of the original. Two things checked:
>
> 1. **The deterministic safe-path baseline, by closed-form math, not simulation**: the
>    5:1 ratio over 4 fusion steps means 5⁴ = 625 White per Orange, ×3 Orange = 1875
>    White needed. At 2.0/hr that's exactly 39.06 days; at 1.0/hr, 78.12 days. Both
>    round to the document's stated "40" and "79" — confirmed, the small gap is just
>    rounding an illustrative figure, not an error.
> 2. **The gambling-strategy population table, by an independent Monte Carlo at n=300**
>    (matching this document's stated population size, run across multiple seeds to
>    check against natural sampling noise): every number in §6's table falls within the
>    range this independent model produces. The qualitative finding holds — near-flat
>    median/mean regardless of gambling aggressiveness, wide variance in min/max — and
>    the per-attempt win rates (80/60/40/20% for k=4..1) are also confirmed
>    algebraically: contributing same-tier pieces makes the weights in the win-probability
>    formula cancel, leaving exactly `p = k/5`.
>
> One thing not fully pinned down by this document's prose, flagged as a modeling
> assumption rather than a finding: whether a "strategy k" player always gambles with
> exactly k pieces as soon as available, or opportunistically banks toward a safe 5-fuse
> when convenient. The verification script assumes the former (always-gamble, matching
> the "impatience relief" framing in §2) — a different strategy definition could shift
> the exact numbers, though probably not the qualitative finding, since the same-tier
> weight-cancellation result (`p = k/5`) holds regardless of when a player chooses to
> gamble. See `design/postcard_tier_verify.py` for the full model and both checks,
> runnable standalone with no dependencies.

---

## 1. Supersession note

This addendum **replaces** the single-variable exit-ticket gamble described in
`DESIGN_ADDENDUM_2026-08-06.md` and its 2026-08-07 bugfix (`w(p,f) = base_odds*f/(1-p)`).
That model treated exit-ticket progress as one continuous float `p ∈ [0,1]`,
directly gambled. It is superseded entirely by the tiered postcard-merge system
below, which folds progress, gambling, and the physical travel asset into a
single mechanic. The population/worst-case simulation findings from
2026-08-06/07 (crush risk, two-track resolution) are subsumed by this design —
the "permanent standing never decreases" concern is resolved structurally here,
because postcards already held are never destroyed by *time*, only ever at risk
during a chosen fusion gamble.

---

## 2. Design thesis `[DESIGN — not yet built]`

The exit ticket is meant to sit in a player's pocket as **a choice, not a
requirement**. Many players will accrue postcards, complete tickets, and never
spend them, because they're happy where they are. That's intended, not a
leak. The system's job is to make leaving always technically possible, never
free, and to make holding an unused ticket itself a meaningful, visible piece
of player state — an option value, not a wasted resource.

Movement between shards has to exist for the world to stay dynamic — new
people arriving, roles opening and closing, gossip and standing shifting — but
the baseline pace has to land in **weeks, not months or years**. Target for
an un-boosted baseline player under the calibration below: roughly 4–8 weeks
to a first completed ticket, confirmed by simulation (see §6).

The mechanic is an explicit blend of two borrowed structures, credited rather
than disguised, per Steven's account of both games:

- **War and Order's blacksmith fusion**: fill every slot with the exact
  correct tier/color and the result is deterministic — pure grind, no risk.
  Under-fill it with wrong colors/tiers and it becomes a probability roll,
  with the result always capped at the value of your best contributing piece
  (you can never gamble your way *above* what you already hold).
- **Rise of Kingdoms' passive gem production**: a hard-capped, slow, mostly
  un-boostable background accrual rate as the base resource feed — the wait
  is real and can only be nudged, never broken.

Neither game's exact mechanic is copied; NODE combines War and Order's
fusion-risk logic with Rise of Kingdoms' passive-accrual discipline and adds
its own weighted-odds shortcut layer (§4) that exists in neither source.

**Tone reference (Steven's, not mechanical):** the framing draws loosely on
*The Island* — the sense that a comfortable, contained world can have a real
exit built into it, mostly unused, known about but not always acted on. This
informs presentation, not numbers.

---

## 3. Accrual and the login buffer `[CALIBRATED — provisional]`

- Postcards accrue passively at a fixed hourly rate, tier-1 ("White") only.
- Accrued postcards sit in an **unclaimed buffer**, capped at **16 hours'**
  worth. Anything accrued beyond the cap while unclaimed is lost — this is a
  deliberate **login-frequency lever**, not an economy lever. A once-daily
  login leaves value on the table; twice-daily captures full accrual.
- A purchasable boost may **slow the buffer's decay/raise the cap slightly**,
  giving "a little advantage in rate." It must never touch merge odds, tier
  value, or the tier ladder. This holds the line with NODE's existing
  monetization principle: pay for certainty/speed, never edge.
- Illustrative calibration used in simulation: base rate 2.0 White
  postcards/hour lands the safe, no-gamble baseline at **40 days** to first
  completed ticket — inside the intended 4–8 week window. 1.0/hour lands at
  79 days (too slow); scaling above ~3–4/hour compresses below 4 weeks.
  **Real rate TBD against actual playtest data, not simulation alone.**

---

## 4. Fusion — two modes `[DESIGN — not yet built]`

Five tiers, illustrative color-coded per War and Order convention:
White → Green → Blue → Purple → Orange (final tier).

**Fusion ratio:** 5 same-tier postcards → 1 postcard of the next tier up
`[CALIBRATED — provisional, borrowed directly from W&O's blacksmith "combine 5
resources" convention]`.

**Bottom tier (White → Green) has no gamble option.** There's nothing lower
to draw filler or shortcut material from, so this step is always the safe,
deterministic recipe.

### 4a. Safe fusion (default, all tiers)
Fill all 5 slots with correct-tier postcards → guaranteed result at the next
tier. No risk, no variance, this is the reliable grind path and is always
available.

### 4b. Shortcut gamble (tier 2 and above)
A player may fuse using **fewer than 5 correct-tier postcards** — e.g. 3 of 5
— for a chance at the same next-tier result, at reduced but real odds. Each
tier of postcard carries an intrinsic **weight** reflecting its rarity/cost
`[CALIBRATED — provisional illustrative weights: White=1, Green=3, Blue=8,
Purple=20, Orange=50]`. Win probability for a shortcut attempt is the
contributed weight divided by the weight of a full same-tier recipe:

```
p_success = (sum of weights of pieces contributed) / (5 × weight of the tier being fused)
```

On failure, the contributed pieces are **consumed and lost** — this is the
real risk Steven specified ("you lose whatever you've got"). There is no
partial-refund state; failure is a clean loss of the staked material.

This directly implements Steven's account of adding "slightly more expensive
pieces" to raise odds without needing the full recipe count — a single
higher-tier piece can substitute for several lower ones, at odds proportional
to its weight, never guaranteed, never capped above the recipe's own target
tier.

**Never purchasable.** Odds, weights, and the recipe itself cannot be bought
or improved with real money under any circumstance — only the *rate* (§3) can
be boosted, and only marginally. This is a hard design constraint, stated
explicitly by Steven, not an implementation detail.

---

## 5. The completed ticket `[DESIGN — not yet built]`

A fixed number of final-tier (Orange) postcards — illustrative **3**
`[CALIBRATED — provisional]` — complete an exit ticket, which is the actual
travel asset.

- **Never tradeable for real money.** May be tradeable in-world for other
  extremely high-value goods/standing (open question, see §8).
- **Completed tickets can sit unused indefinitely.** Many players will
  accumulate several and never spend them — this is intended texture, not
  economic waste, and should be a visible piece of player state (e.g. "tickets
  held" as a standing/wealth signal, separate from "tickets spent").
- Spending a ticket enables shard-to-shard travel. Travel is **never
  blocked**, only ever made deliberately slow/costly — consistent with
  NODE's existing "expensive coordination, not hard gates" philosophy.

---

## 6. Simulation findings this session (illustrative parameters, not final)

Run against the calibration in §3–4 (2.0/hr accrual, 5:1 fusion ratio, weights
1/3/8/20/50, 3 final tickets required, 300-player populations):

| Strategy | Median days | Mean | Min | Max | Notes |
|---|---|---|---|---|---|
| Safe (no gambling) | 40 | 40.0 | 40 | 40 | Zero variance — fully deterministic given fixed accrual |
| Shortcut gamble, k=4/5 | 38 | 39.8 | 23 | 96 | 80% per-attempt win rate |
| Shortcut gamble, k=3/5 | 36 | 39.2 | 14 | 102 | 60% per-attempt win rate |
| Shortcut gamble, k=2/5 | 35 | 39.7 | 7 | 104 | 40% per-attempt win rate |
| Shortcut gamble, k=1/5 | 35 | 38.3 | 3 | 121 | 20% per-attempt win rate |

**Key finding:** under this weighting model, gambling does **not** meaningfully
move the population average — median/mean stay within a few days of the safe
baseline regardless of how aggressively a player shortcuts. What gambling
actually buys is **variance**: the luckiest players finish in a fraction of
the safe time (3 days vs. 40 at the most aggressive setting), while unlucky
players run to 2–3× the safe baseline. This was confirmed against Steven's
stated intent (2026-08-07 session) — gambling is meant as a genuine
alternate path for players who want the thrill/impatience relief, not a
system anyone should rely on for a reliably faster average. The near-flat
population mean is therefore a feature of this calibration, not a gap to fix.

**Caveat:** an earlier same-session model (purity-threshold curve rather than
weighted-piece-value) produced negative-EV gambling that actively punished
shortcutting — that model was discarded once Steven clarified the mechanic is
per-piece weighted probability, not a purity percentage. Left out of the
table above; superseded, not a finding to carry forward.

Simulation code: `/home/claude/node_sim/postcard_tier_sim.py` (local sandbox,
not yet pushed to repo). Independently re-verified 2026-08-07, see the
verification note at the top of this document and `design/postcard_tier_verify.py`.

---

## 7. Shard migration & organic opening `[DESIGN — not yet built]`

- Spending a ticket moves a player to another shard. Arrival state (fresh
  start vs. stepping into existing standing/business) is **open**, see §8.
- **New shards open automatically as overall population density crosses a
  trigger threshold** — no group pledge/commit mechanic, no player-facing
  coordination requirement, no risk of a ticket being "stranded" waiting on
  others. This mirrors the existing vacancy-and-backstop pattern already
  built for role vacancies (Phase 2), applied at the shard level instead of
  the player-role level — same underlying philosophy, no new primitive
  required architecturally.
- Once open, a new shard populates organically as ticket-holders choose to
  migrate there, filling roles as they arrive, the same way any existing
  shard's economy would self-organize.
- New shards may carry different roles / different atmosphere from existing
  ones — not yet specified further.

---

## 8. Open questions `[OPEN]`

1. **Top-tier tradeability.** Should a completed/near-completed ticket be
   tradeable to another player at all? Steven has raised both a concern
   (wealth buying shard access without earning it — resolved: never
   purchasable with real money) and a design interest (trading places,
   taking over someone else's business/standing shard-to-shard). These
   aren't the same question — in-world trade between players is not the same
   risk as real-money purchase. Needs its own resolution.
2. **Arrival state on migration.** Fresh-start newcomer, or can a player step
   into existing standing/business via trade/exchange with another player?
3. **Population-density trigger** for opening a new shard — no threshold
   number or formula proposed yet.
4. **Final-tier ticket count** (illustrative 3) and **fusion ratio**
   (illustrative 5:1) — both provisional, not simulated against alternatives
   yet.
5. **Tier weights** (1/3/8/20/50) are a smooth illustrative geometric
   progression, not derived from anything Steven specified numerically —
   flagged explicitly as the single most made-up number in this document.
6. **Real accrual rate** — 2.0/hour is chosen purely to hit the 4–8 week
   target in simulation; needs grounding against actual expected playtime
   patterns, not just the math.
7. **Event/bonus structure** for temporarily compressing timelines — noted
   as intended ("you don't want to hold people to nine months... there may be
   events that give bonuses") but not designed.

---

## 9. Not touched this session (standing from prior addenda, unchanged)

Heist/coordination mechanic, diary OBSERVATION table extension, shard
mergers via population-density regeneration, tone-entropy fix, richer
communication tier, resource-interdependency web, two-mode camera system —
all still scoped-not-built per `DESIGN_ADDENDUM_2026-08-06.md` and this
session's opening recap. None of this addendum's content changes their
scoping or priority.
