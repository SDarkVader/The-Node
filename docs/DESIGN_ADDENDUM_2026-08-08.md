# Design Addendum — 2026-08-08

Covers: District Weather and the Wall's Emissive Soul — a two-axis atmospheric reading
(local mood vs. global mood), extending the ambient colour system already specified in
`NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §4-5.

Tags follow repo convention: `[DESIGN — not yet built]`, `[CALIBRATED — provisional]`,
`[OPEN]`.

---

## 1. District Weather — the local mood

**[DESIGN — not yet built, already implied by the visual brief, now given a name and
scoped explicitly]**

A localized, fluid atmospheric heatmap describing the immediate economic tension and
activity of a specific neighborhood/district. Shifts independently between cool blues
(low tension/activity) and warm ambers/reds (high activity or rising disruption risk).
This is the "emotional weather" concept `NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` §4
already described ("a warm front rolling through one district while another stays
cool") — District Weather is that same mechanic, now explicitly named as a per-district
phenomenon rather than a shard-wide one.

Requires persistent per-district state that doesn't exist yet. Already flagged as a real
gap in `docs/BLUEPRINT.md`'s "Ecosystem-scale mechanics" section:
`districtArrivalChoice()` only decides where one new arrival lands, once — it doesn't
accumulate an ongoing district history. District Weather is the concrete reason that gap
needs closing eventually, not an abstract one.

## 2. The Wall's Emissive Soul — the global sentiment

**[DESIGN — not yet built, mechanic locked 2026-08-08]**

The Wall — already the one landmark every player sees regardless of connection depth
(Tier 1 visibility, brief §4.5) — carries a second signal beyond its role as the message
board itself: its central glow colour is the aggregate emotional temperature of the
whole shard's player base.

**Mechanic.** Every Wall post is already built from one of ten fixed SELF_STATES
(`src/comms/grammar.ts`): isolated, manipulated, distrustful, exploited, suspicious,
uneasy, overwhelmed, hopeful, secure, grateful. Each carries an implicit tone; the
Wall's core glow aggregates recently-posted tones into one colour, shard-wide.

**Structural beauty is constant; colour is the only variable allowed to be honest.** The
plaza and the Wall stay open, bright, and beautiful regardless of the shard's actual
mood — brightness and openness are never the signal, and never degrade into something
ugly or broken-looking just because the mood has soured. The colour bleeding from the
Wall's core is the one thing allowed to say the truth without softening it: gold on a
good day, red on a bad one, with nothing pre-decided about which it lands on.

This directly resolves a tension with `DESIGN_ADDENDUM_2026-08-06.md`'s earlier
"Atmosphere: hope as a structural target" note, which named the Wall specifically and
argued for a gold-leaning default ("warm amber-to-gold rather than amber-to-red, a
lantern rather than a warning"). This doesn't pick gold-always over honest ambiguity —
it separates the two signals that note was conflating: the *physical beauty* of the
structure is what gets to carry the hope, permanently; the *colour* is what gets to
carry the truth, whatever that truth is on a given day. Consistent with the standing
"let outcomes be real, don't script them" constraint (`CLAUDE.md`) — nothing about this
mechanic decides in advance whether a shard trends toward heaven or hell; that's read
off what players actually post.

**User's own words, kept verbatim as the source of the decision:** "the plaza and wall
are still open, bright and beautiful, but the wall is the description of the shards
players mood... we can tone down the colours and it will still be brightly lit and a
beacon of hope, or so it may seem. depends on the mood but essentially it either heaven
or hell. once again, it's up to the players."

## 3. The Visual Contrast Contract

**[DESIGN — not yet built, mechanic locked 2026-08-08]**

A player standing in the city reads the shard's actual state by comparing two signals
at once: their immediate District Weather against the Wall's Emissive Soul glowing over
the rooftops. Worked example: a cold, dim-blue district (low local activity) under a
bleeding-red, high-tension Wall (rising shard-wide friction) reads as an immediate,
legible mismatch — this specific neighborhood is quiet or dying, but the wider shard is
somewhere else entirely, in active social friction or frantic trading.

This doubles the signal depth of the existing ambient colour system without adding any
new mechanic or UI element. Both colours already exist independently (district-local
weather per §1, Wall-global sentiment per §2); the contract is only that a player is
meant to read them against each other, not in isolation — no new system, just a reading
instruction for two systems that already exist side by side.

---

## 4. Open questions `[OPEN]`

1. **Exact damping/aggregation function for the Wall's colour.** "Tone down the
   colours" is directional, not a formula. A raw, unweighted aggregate would skew
   warm-to-hot by default: 7 of the 10 SELF_STATES read as tension/negative (isolated,
   manipulated, distrustful, exploited, suspicious, uneasy, overwhelmed) against only 3
   that don't (hopeful, secure, grateful). Candidate approach, not decided: recency-
   weighted decay, the same shape as the rumour mill's clarity decay
   (`src/comms/decay.ts`) — recent posts weigh more than old ones, so the Wall reflects
   current mood rather than lifetime average.
2. **Whether District Weather and the Wall's glow need visually distinguishable
   *quality* of light, not just different hue**, so the contrast in §3 reads instantly
   at a glance rather than requiring a player to consciously compare two colour values.
   An implementation/art-direction question, not a mechanics one.
3. **District Weather's persistence model** — inherits the gap already flagged in
   `docs/BLUEPRINT.md`: no district data structure exists yet to hold this state over
   time. Not re-litigated here, just inherited.
