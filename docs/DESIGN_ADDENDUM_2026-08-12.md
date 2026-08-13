# Design Addendum — 2026-08-12 — Social Layer Failure-Mode Analysis: Communication, Mobilisation, Events, Memory

Status: **analysis + specification. Nothing in this document is built.** All figures below
come from standalone Python models run against the v5 design assumptions, *not* against the
TypeScript engine. Every number here is provisional and needs re-deriving in-engine before
any of it is trusted.

This session did not touch the repo. It ran adversarial models against four questions the
containment audit (`ADVERSARIAL_CONTAINMENT.md`) left open, found five distinct failure
modes, and closed four of them. The fifth is closed by reframing rather than by mechanism.

## 0. Framing

`ADVERSARIAL_CONTAINMENT.md` established that NODE contains predatory players well but gives
them nothing to do with sustained ambition, and that no reputation system exists in code.
This session attacked the layer underneath that: **can a determined operator build influence
through communication, timing, and coordination alone**, under the constraints already
shipped?

The operator model throughout is drawn from the real War & Order history: information
asymmetry, psychological pressure, cross-timezone loyalty, disproportionate outcomes from
modest means. Not a generic griefer — a specific, competent, patient one.

Design goal restated in the terms this session used: **influence should be reachable, never
solvable.** A calculating player must be able to compute odds and never close them.

## 1. What already exists (read from v5, unchanged this session)

`src/comms/` is further along than the handover implied:
- `grammar.ts` — ten `SELF_STATES`, fixed first-person present-tense templates, zero
  third-party reference. Structurally enforced: `assertValidState` rejects anything off the
  curated table, and `test/grammar.test.ts` asserts the whole table rather than spot-checks.
  Wall and Envelope share the exact same type; audience size is the only difference.
- `rumourMill.ts` — Wall posts seed rumours that propagate hop-by-hop through the connection
  graph, decaying in clarity, drifting to semantically-adjacent states via
  `DISTORTION_NEIGHBORS`. Deliberately imperfect, not a faithful relay.
- `connections.ts` — per-edge weighted graph, no persistent global structure.
- `decay.ts` — generic distance-decay + distortion primitive, already extracted for reuse.
  `[CORRECTED 2026-08-13]` Now used by the diary — see §10 below and
  `docs/DESIGN_ADDENDUM_2026-08-06.md`'s "Retention" section.

This is a Hanabi-shaped system already: a small finite message palette where meaning comes
from convention, timing, and context rather than vocabulary. That framing is what the rest of
this document builds on.

## 2. Failure mode: repetition-as-code

**The attack.** The grammar cannot name a target, so an operator encodes meaning in *pattern*
instead — same state, same recipient, repeated. Ten states × timing × recipient choice is a
far larger signal space than ten messages suggests. Repetition alone also functions as
intimidation with no informational content at all.

**Model result.** A 14-day single-target campaign using only pressure-cluster states
(`suspicious`, `distrustful`, `uneasy`, `manipulated`, `exploited`) touched 5 of 10 states,
most-used state appearing 11 times in 42 utterances. The effective harassment vocabulary is
half the nominal vocabulary, because positive states are useless to a pressure campaign.

**Detection.** A per-target detector on pressure-cluster ratio (threshold 0.6, non-mutual
contact) flags the naive campaign at ratio 1.00. Laundering with positive states to evade it:

| Launder rate | Pressure ratio | Flagged |
|---|---|---|
| 0.00 | 1.00 | yes |
| 0.20 | 0.88 | yes |
| 0.35 | 0.79 | yes |
| 0.50 | 0.62 | yes |

The operator must launder **over half** their messages before approaching the threshold — by
which point the campaign is diluted to the point of not working. The threshold holds.

**Caveat.** 0.6 is arbitrary. It needs deriving from real traffic, not chosen. The finding
that matters is the *shape* — laundering is self-defeating — not the specific number.

## 3. Failure mode: multi-target dilution

**The attack.** Don't launder content; spread the same campaign across many targets so no
single target's ratio trips a per-target threshold.

**Model result** (30 days, 3 conversations/day budget):

| Targets | Mean days contacted per target | Effective frequency |
|---|---|---|
| 20 | 4.5 / 30 | once per ~6.7 days |
| 3 | 30 / 30 | daily |

**The daily conversation budget forces a real choice.** Broad-but-weak (too thin to sustain
pressure on anyone) or narrow-but-detectable (trips per-target detection immediately). There
is no third option. This is the budget cap doing genuine structural work.

**What this exposes.** The historical MO was neither of these. It was pressuring a few key
nodes directly and letting *reputation and rumour* carry the fear to everyone else. That
indirect channel is the next section, and it is the one the direct-contact detector is
completely blind to.

## 4. Failure mode: reputation-driven ambient fear (the significant one)

**The attack.** Zero direct contact. Wall posts only, propagating through the rumour mill,
amplified by the operator being *known*.

**Model result** (30 players, 30 days, no envelopes, no conversations):

| Operator | Mean ambient unease | Players affected |
|---|---|---|
| Unknown | 0.0378 | 15/29 |
| Known | 0.0944 | 15/29 |

**2.5× amplification from reputation alone.** Same posting behaviour, same graph, same
reach — the only difference is whether the audience knows who it is. Over 90 days, mean
unease reaches 0.1033 with a single-player max of 0.5099.

The 2.5× multiplier is an assumption of the model, not a measurement. What the model
demonstrates is the *channel*, not its gain: presence-without-action is a real vector, and
the direct-contact detector from §2 cannot see it at all.

**Detection surface.** Wall posts are public by design. A Detective or Journalist *can*
observe post frequency and cluster skew (100% pressure-cluster over 30 posts in the 90-day
run, against a ~50% baseline). The signal exists. **Nothing currently reads it** — both roles
are flat-wage placeholders. This is the single largest actionable gap found.

### 4.1 What naming actually does

Three hypotheses tested, naming triggered at day 30 by a rolling-30-day skew check
(threshold 0.7, minimum 8 posts):

| Hypothesis | Mean unease | Δ |
|---|---|---|
| A: naming has no effect | 0.0703 | baseline |
| B: naming inoculates (audience discounts) | 0.0282 | −60% |
| C: naming amplifies (now they know who) | 0.1123 | +60% |

**Hypothesis B is wrong**, on direct evidence: in the real case, being known did not let
people organise. It confirmed the threat and made the waiting worse. Naming is closer to C.

**Design consequence.** *Naming alone is not a remedy.* A Journalist mechanic that only
publishes "this player posts a lot of distress" makes things worse, not better. Whatever
Detective and Journalist do, it has to hand the target something actionable — not just
identification. **This is unresolved and is the most important open question from this
session.**

## 5. Reframe: reputation as trust-weighted mobilisation

The more accurate model of the historical case is not fear. It is **distributed loyalty
acting as an early-warning and response network** — a known, consistently-behaving player's
*actions alone* mobilise allies without instruction, and attacking them means attacking
everyone connected to them, independent of their own visible strength.

Trust links modelled as sparser and stronger than rumour edges (1–4 allies, weight 0.4–1.0),
with `fog = 0.4` representing ordinary friction (offline, busy, asleep).

**Non-determinism check** — same network, same operator, 10 runs:

```
mobilised set size: [9, 8, 4, 0, 1, 0, 1, 0, 8, 2]
mean 3.3, min 0, max 9
players mobilising in ALL 10 runs: 0
players mobilising in SOME runs:  22
```

**Zero deterministic core.** Even the operator cannot predict who turns up.

**Learning-attacker check** — attacker observes N mobilisations, builds a frequency model,
predicts a fresh event:

| Observations | Predicted "reliable" responders | Precision on fresh event |
|---|---|---|
| 5 | 4 | 0.75 |
| 20 | 0 | — |
| 50 | 2 | 1.00 |

**Predictability by hop distance** (50 observations):

| Hop | Players | Mean response rate | >50% predictable |
|---|---|---|---|
| 1 | 2 | 0.56 | 2 |
| 2 | 5 | 0.27 | 0 |
| 3 | 7 | 0.16 | 0 |
| 4 | 13 | 0.05 | 0 |
| 5+ | 8 | 0.00 | 0 |

**Only hop-1 is learnable.** Your two closest allies are predictable after sustained
observation; everything beyond is fog. This is the right shape — your best friend always
showing up is loyalty, not an exploit. The wider response, which is what actually makes you
expensive to attack, stays genuinely uncertain no matter how long someone studies you.

**Open**: whether an attacker can neutralise the 1–2 known hop-1 responders first and thereby
isolate the target. Not tested.

## 6. Failure mode: timezone dead zones

**The attack.** Don't learn the trust graph at all. Learn the clock.

Single-district model, EU-skewed population (60% UTC−1..+2, 25% UTC−8..−4, 15% UTC+5..+9),
averaged over 50 trials per hour: hours 00–02 and 17–23 show real coverage (0.74–1.84 mean
defenders); **hours 03–09 are a structural dead zone** (0.00–0.42 through most of the range).

**Hours 03–09 are a structural dead zone.** Learnable by anyone with a clock, no social
engineering required. This is the same class of defect as the fixed sabotage cadence found in
the previous session — a public deterministic pattern hiding in plain sight.

### 6.1 Fix 1 — deliberate timezone diversity

Three close allies at UTC−8 / 0 / +8: **0 of 24 hours uncovered.** At least 2 sentinels
plausibly online at every hour.

This is not a balance patch. It is an *earnable strategic choice* — players who deliberately
build cross-timezone relationships are genuinely safer; players who don't stay exposed. It
matches the historical practice exactly ("reinforcements from different time zones").

### 6.2 Fix 2 — schedule marquee events into known overlap windows

Full ecosystem (6 districts × 65 players, realistic skew), minimum coverage per district
0.16–0.22 at hours 05–06 — thin, but not zero: roughly 10–14 people awake per district.

Defensive mobilisation at full district scale:

| Window | Mean defenders | Zero-defender trials |
|---|---|---|
| 05:00 (dead zone) | 39.4 | 2/50 |
| 15:00 (afternoon overlap) | 63.9 | 0/50 |
| 00:00 (EU late / US evening) | 63.9 | 0/50 |

The named overlap windows — roughly **15:00–17:30** and **around midnight** — are near-full
coverage. High-stakes events belong there. The dead zone is shallower at ecosystem scale than
in the single-district model, but it is real and should not host anything decisive.

## 7. Events: deterministic reward, skill-expressive path

### 7.1 The defect in the first model

Probability-roll checkpoints produced luck wearing a skill costume: a 0.9-skill player
cleared 1 checkpoint while a 0.5-skill player cleared 0; the same skill level returned
anywhere from 0 to 30 reward across 30 runs.

### 7.2 The fix

Fixed difficulty thresholds (0.2 → 0.9 across 8 sequential checkpoints), with skill
perturbed by a small execution-noise band (±0.08) rather than a coin flip.

| Skill | Mean reward (100 seeds) |
|---|---|
| 0.2 | 4.2 |
| 0.3 | 15.3 |
| 0.5 | 34.4 |
| 0.7 | 55.2 |
| 0.9 | 74.6 |
| 1.0 | 80.0 |

Same-skill variance collapses from 0–30 to **30–40**. Strictly monotonic, near-linear.

**Ordering-violation rate** (does lower skill ever out-earn higher?):

| Skill gap | Violation rate |
|---|---|
| 0.52 vs 0.50 | 18.5% |
| 0.55 vs 0.50 | 8.0% |
| 0.60 vs 0.50 | 0.0% |
| 0.70+ vs 0.50 | 0.0% |

Beyond a ~0.1 skill gap, skill always wins. Violations only occur where the gap is inside the
noise band, which is correct behaviour, not a defect.

### 7.3 Failure mode: reputation farming

Reputation is additive-only and permanent (constraint 6), which makes it farmable by volume
if attempts are uncapped:

| Player | Attempts/day | 30-day reputation |
|---|---|---|
| Grinder (skill 0.3) | 10 | 890 |
| Skilled (skill 0.9) | 1 | 456 |

**Nearly 2× — volume beats skill outright.** This directly undermines reputation as a skill
signal, which the containment document identifies as the actual prize.

**Fix: daily attempt cap**, same pattern as the conversation budget.

| Cap | Grinder | Skilled | Grinder wins |
|---|---|---|---|
| 1 | 88 | 456 | no |
| 2 | 186 | 456 | no |
| 3 | 272 | 456 | no |
| 5 | 440 | 456 | no |

Holds at every cap tested up to 5. Even a generous cap closes it. **This should be a hard
requirement on any event mechanic.**

### 7.4 Reward *type* — closing the transferability hole

Raw currency rewards violate the wealth-is-inert principle immediately. Replaced with:
- **Reputation** — permanent, additive-only, never spent, never gifted. A record, not capital.
- **Temporary personal buff** — decays, tied to the player's own action economy, no transfer
  mechanic exists or should exist.
- **Statue / monument eligibility** — keys off cumulative reputation, same non-transferable
  logic. Unbuilt.

None of these touch wealth or the wealth cap. A skilled operator cannot lend advantage to
build a faction.

### 7.5 Time as the primary gate

Time invested, not skill and never money, is the primary reward gate. Skill sets efficiency
per unit time (1.0×–1.5×), not access.

30 days, daily cap 120 min, no money → minutes conversion anywhere:

| Player | Skill | Min/day | Reward |
|---|---|---|---|
| Skilled grinder | 0.9 | 110 | 1568 |
| Low-skill grinder | 0.3 | 110 | 1072 |
| Skilled casual | 0.9 | 20 | 285 |
| Time-poor "spender" | 0.5 | 10 | 112 |

A low-skill grinder beats a high-skill casual **3.8×** on time alone. Skill still pays — same
hours, ~46% more — but cannot substitute for presence. Free-to-play time beats money, because
no money lever exists.

**Ecosystem check**: mean 30-day reward across 6 districts ranged 483.9–571.4, a **1.18×
spread**. No district structurally disadvantaged by population mix.

## 8. Economy: shared pool and the self-punishing exploit

Recycling model — a fraction of individual outflow returns to a shared node pool rather than
to individuals (20 players, 60 days, recycle rate 0.3, wealth cap 200):

| Day | Shared pool | Mean individual wealth |
|---|---|---|
| 0 | 27.7 | 94.1 |
| 20 | 607.6 | 97.8 |
| 40 | 1187.8 | 96.4 |
| 50 | 1481.4 | 99.6 |

Individual wealth stays flat (final spread 86.2–112.1). The collective pool climbs without
bound. Rising tide, no personal hoard.

**Attempted exploit**: operator quadruples spend rate to inflate contribution share. Result —
contribution share 7.2%, and their **own wealth collapses to 30.4 against a peer average of
99.8**. The exploit is self-punishing before it could ever pay off.

**Tripwire.** This only holds because the pool has *no contribution-weighted payout.* Adding
one would recreate a pay-to-win lever directly. **Never build that.**

## 9. Isolation is not neutral — it is the most exposed position

A pure grinder allocating 100% of daily time to events gets zero social minutes and cannot
form trust links at all. Initial read was "self-contained, fair outcome." That was wrong.

Predation model, 20 scouting attempts, detection scaling with wealth visibility (economic
heat) and defence scaling with trust links:

| Profile | Wealth | Trust links | Successful strikes |
|---|---|---|---|
| Isolated rich grinder | 180 | 0 | 14/20 |
| Moderately connected | 180 | 3 | 5/20 |
| Well networked | 180 | 8 | 4/20 |
| Isolated poor | 60 | 0 | 2/20 |

**Isolated + wealthy is the worst position in the game.** Three trust links cut predation from
70% to 25%; eight barely improves on three. You don't need a large network — you need to not
be the easiest target in the district.

"You need friends" becomes a mechanical truth rather than flavour. Hoarding alone guarantees
you become someone's target.

### 9.1 Silent accumulation

Per shipped `engine/identity.ts`, `isKnown()` triggers only on rumour-hearing events, not
economic activity. A silent grinder generates no rumours and stays genuinely unknown.

When they resurface, **no trust links exist** — trust requires built history. They are as
socially naive as a new player, just economically ahead. "Go silent, accumulate, surface" is
a valid strategy, but the surprise is purely economic and has no mobilisation teeth. The
existing identity system already closes this; no new code needed.

## 10. The diary: screenshots, and what actually needs defending

**No diary exists in code.** Referenced in six design docs, unimplemented.

`[CORRECTED 2026-08-13]` The reset interval this section models below (7/14/30/90 days) is
superseded — `DESIGN_ADDENDUM_2026-08-06.md`'s retention window shrank to ~2 days the same
day, and distortion now applies every server day-tick an entry survives rather than only at a
much-longer reset boundary. The *mechanic* this section specifies (§10.5: honest writes,
silent distortion applied via `decay.ts`, no tell, no contradiction popup) is unchanged and
still correct — only the numbers in §10.2/§10.4's tables are stale, since they were run
against reset intervals an order of magnitude longer than the diary actually uses now. Left
in place below as the reasoning trail (resets widen rather than close the screenshot gap,
regardless of interval length), not as current tuning.

### 10.1 The exploit

Screenshot the diary daily, externally, and hold perfect recall regardless of any in-game TTL
or reset. Unpreventable — it happens outside the client entirely.

### 10.2 What resets do and don't do

Reset-with-residue over 90 days:

| Reset interval | Residue kept | In-game entries | Screenshotter's archive | Gap |
|---|---|---|---|---|
| 7d | 20% | 6 | 90 | 84 |
| 14d | 30% | 10 | 90 | 80 |
| 30d | 50% | 51 | 90 | 39 |
| never | 100% | 90 | 90 | 0 |

Resets widen the information gap, they don't close it. More aggressive resetting makes the
screenshotter *relatively* better informed. Chasing the screenshot directly fails.

### 10.3 The correct reframe

Separate **mechanical** advantage (a lever the game grants) from **advisory** advantage
(better personal recall).

Mechanical — **none found**:
- Cannot inject archived content into any grammar-constrained channel; retyping re-applies
  every constraint in §2–§3.
- Cannot bypass any *other* player's reset — you only ever screenshot your own diary.
- Cannot prove anything to a third party: a screenshot is not an in-game artifact and cannot
  be verified as unedited, exactly like any out-of-game claim.
- Diary-reading mechanics see only current post-reset state.

Advisory — **exists, and is unavoidable**: a screenshotter remembers more, exactly as a
player with a good memory or a paper notebook would. Every multiplayer social game has this.

> Design goal shifts from *prevent external recall* (impossible) to *ensure recall is never
> transmissible or mechanical* (achieved by the existing grammar constraints).

### 10.4 Making hoarded recall a liability

Rather than defend against screenshots, make their contents unreliable — reusing
`DISTORTION_NEIGHBORS` from the rumour mill, applied inward to diary residue.

90 days, reset every 14 days:

| Distortion rate | Residue entries distorted |
|---|---|
| 0.00 | 0/36 (0%) |
| 0.15 | 3/36 (8%) |
| 0.30 | 14/36 (39%) |

At 0.30, nearly 40% of a hoarded archive is subtly, undetectably wrong within 90 days. The
hoarder cannot tell which entries are true. Acting on the stockpile — or worse, passing it to
allies as proof — becomes a genuine gamble. **Hoarding stale information becomes a liability;
live re-verification becomes the reliable path.**

### 10.5 Mechanic specification

1. **Writing is always honest.** Entries store exactly as the player intended. No write-time
   distortion. The player always knows what they meant.
2. **Distortion happens only at reset**, silently, via the existing `decay.ts` /
   `DISTORTION_NEIGHBORS` machinery. Reused, not reinvented. `[CORRECTED 2026-08-13]`
   "Reset" is now the server's own daily day-tick, not the 14/30-day interval modeled in
   §10.2/§10.4 above — so in practice this is continuous daily drift, not a periodic event.
3. **No tell.** The player is never shown which residue survived intact and which drifted.
   Identical visual treatment either way — the same "reliably imperfect, not a faithful
   relay" principle already documented for rumours.
4. **No contradiction popup.** The player discovers mismatches only indirectly, when live
   proximity speech or wall posts fail to match what their diary says. *That mismatch is the
   signal.*
5. **Screenshots become moot.** The capture may already be residue from a prior distortion.
   There is no clean copy to protect; uncertainty is baked in before the screenshot happens.

The player still does the work of writing and rebuilding a mental map each cycle. What they
cannot know is whether the fragments that survived are still true.

## 11. Two-tier speech (specification, untested)

Emerged from discussion; **no modelling was run on this.** Recorded for the next session.

**Tier 1 — Wall and Envelope.** Asynchronous, persistent, legible at leisure. Keep the
existing tight grammar: first-person, present-tense, introspective, no third-party reference.
Wall and Envelope differ only in audience size, as now.

**Tier 2 — proximity speech.** Same district, same time, ephemeral by nature. Nobody re-reads
it. This is where tone, pressure, insinuation, and genuine psychological play can live
*because* it isn't logged. Delivered as bounded text options rendered as voice — it feels like
speech, but the palette underneath stays finite and mechanically parseable by Detective and
Journalist.

Vocabulary is wider here and tuned for interpersonal pressure rather than pure self-state.
Lines like "I think you're scared" or "I feel underestimated" needle without naming a target
or making an accusation.

Combinatorics, if expansion is needed:

| Form | Distinct utterances |
|---|---|
| Single state | 10 |
| Unordered pairs | 45 |
| Ordered pairs | 90 |

Ordered pairs carry different framing weight from unordered ("X but also Y" ≠ "Y but also
X"), which is probably worth having.

Constraints that come with it:
- **Daily conversation budget** — you cannot physically speak to everyone; §3 shows this cap
  does the real structural work against dilution attacks.
- **Per-exchange time limit** — you cannot camp on one person all day.
- **Presets** — saved lines the player uses often, so the interface isn't a hassle.

Identity stays fragmented: voice, face, and role are presented separately and never fully
fused. Pressure is real in the moment; nobody walks away holding proof.

**Open question (RESEARCH_QUESTIONS q12).** Whether repetition in proximity speech should
carry a visible counter-signal — the target seeing "this person has said the same thing to
you five days running" — turning quiet endurance into visible, actionable pressure. Not
modelled.

## 12. Status summary

| Finding | Status |
|---|---|
| Grammar (10 states, structural enforcement) | Shipped, holds under §2 testing |
| Repetition-as-code via pattern | Detectable; laundering self-defeating |
| Multi-target dilution | Closed by conversation budget |
| Reputation-driven ambient fear | Real channel; detection surface exists, nothing reads it |
| Naming as remedy | Insufficient — needs actionable recourse, unresolved |
| Trust-weighted mobilisation | Non-deterministic beyond hop-1; holds vs 50-observation attacker |
| Hop-1 isolation attack | Untested |
| Timezone dead zones (03–09) | Real; closed by tz-diverse allies + event scheduling |
| Event reward determinism | Fixed: threshold + execution noise, monotonic |
| Reputation farming by volume | Fixed by daily attempt cap — hard requirement |
| Reward transferability | Closed: reputation / temp buff / statues only |
| Time as primary gate | Holds; F2P time beats money, 1.18× district spread |
| Shared pool gaming | Self-punishing, no fix needed |
| Isolation | Most exposed position; 3 trust links cut predation 70%→25% |
| Silent accumulation | Closed by shipped `identity.ts` |
| Screenshot / perfect recall | Reframed: no mechanical advantage; distortion makes hoarding a liability |
| Two-tier speech | Specified, unmodelled |

## 13. Next actions

**Build (highest value first)**

1. **Detective / Journalist foundational detection.** The wall-post signal already exists and
   nothing reads it. Constrain tightly: frequency + cluster skew over a rolling window,
   nothing more. Everything else is sauce on top.
2. **Answer what naming *does*.** §4.1 shows identification alone makes things worse.
   Recourse must be actionable. This blocks (1) from being designed correctly.
3. **Daily attempt cap on any event mechanic** — before events exist, so it is never
   retrofitted.
4. **Diary with reset + silent residue distortion**, per §10.5. Reuses `decay.ts`.
5. **Event scheduling into overlap windows** (~15:00–17:30, ~00:00), never into 03:00–09:00.

**Model (before building)**
- Re-derive every constant here in-engine. The standalone models used invented parameters
  (2.5× reputation multiplier, 0.6 detection threshold, 0.4 fog, ±0.08 execution noise). None
  are calibrated.
- Hop-1 isolation attack: can neutralising 1–2 known close allies isolate a target?
- Repetition counter-signal in proximity speech (q12).
- Whether trust links should be visible to their owner, and to anyone else.

**Do not build**
- Contribution-weighted payout from the shared pool (§8 tripwire).
- Any transfer mechanic for buffs or reputation.
- Any money→time or money→event-progress conversion.
- Journalist mechanics that name without providing recourse.
