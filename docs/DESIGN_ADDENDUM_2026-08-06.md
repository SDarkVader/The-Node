# Design Addendum — 2026-08-06

New design decisions and mechanics from today's session, none of which are built yet.
Written to sit alongside `BLUEPRINT.md`'s existing sections — either paste directly under
a new "Design ideas — not yet built" heading there, or keep as a standalone doc; either
way it should be read before Phase 2/4/5 work starts, since several of these bear
directly on those phases.

Tags follow the repo's existing convention: `[DESIGN — not yet built]` for a locked
decision awaiting implementation, `[CALIBRATED — provisional]` for a number picked for
illustration that hasn't been tuned, `[OPEN]` for a genuinely unresolved question.

---

> **Verification note, added same day, after review.** The "Exit ticket gamble —
> proportional staking" section below (and `design/exit_ticket_gamble_sim.py`) states the
> stake required for a given win chance should be *small* near completion and *large* near
> zero progress. Running the simulation and tracing the formula `f = target_w * p /
> base_odds` against concrete `p` values shows the opposite: required stake *increases*
> with `p`, saturating at 100% for `p >= 0.5` and never reaching the target win rate past
> that point (e.g. at `p=0.9`, staking everything only yields `w=0.167` against a `0.30`
> target). The population-level "Findings" below (win rate converging to target) don't
> catch this because `f` is solved to hit `target_w` by construction — that's a check on
> the algebra, not on the direction of the risk curve.
>
> A verified fix: use distance-to-completion (`1-p`) instead of progress (`p`) in the win
> formula — `w(p,f) = base_odds*f/(1-p)`, giving `f = target_w*(1-p)/base_odds`. Re-run
> with this formula reproduces the stated intent exactly (near-zero `p` requires most of
> the player's banked progress; near-complete `p` requires very little). Separately, the
> original `target_w/base_odds` ratio of `2.0` saturates `f=1` across roughly half the `p`
> range regardless of which direction it points — a ratio `<=1` (e.g. `target_w=0.10` at
> `base_odds=0.15`) gives a smooth curve across the whole range instead of a step function.
> Neither the original files below nor the simulation script were edited — this note
> documents the finding for the mechanic to be re-verified before the staking formula is
> actually locked. See `docs/DEVLOG.md`'s entry for this date for the full numeric trace.

---

## Vacancy backstop — NPC is mechanical, not behavioral

**[DESIGN — not yet built, feeds Phase 2]**

The hard-backstop fallback (brief-implied, timing per the existing two-stage
flag/backstop model) is a **flat-pricing transaction, not an agent**. No inference, no
behavior to model, no state to hide — a lookup table with a cosmetic face or loop on it,
nothing underneath but a sale.

Rationale, stated explicitly by design rather than left implicit: any agent capable of
behavior is capable of being modeled, and anything modelable is a deception/manipulation
surface (see e.g. the Starace & Soule findings on motivation-inference accuracy vs.
belief-inference accuracy — real, verified research, cited here only because it's the
reason this decision was made deliberately rather than by default). A vending machine has
no motivation and no belief to infer, so none of that attack surface exists. This also
matches the existing sim finding that NPC fallback reduces price-spread volatility by
roughly 4% without distorting real-player competitive dynamics — the mechanical version
gets the stabilizing benefit with none of the risk a "smarter" fallback would carry.

**[OPEN]** Does the cosmetic face/loop stay static regardless of vacancy severity, or
does it visibly react to flag-stage vs. hard-backstop-stage? Current leaning is static —
nothing underneath it should ever imply state it doesn't actually have.

### Refinement — Miller conscription (developed 2026-08-07, simulation-verified)

**[DESIGN — not yet built, mechanic locked, delay length still open]**

Motivated directly by a real problem found simulating Phase 2 (see
`docs/BLUEPRINT.md`'s "Open deviations"): a Baker/Courier-style role can sit
NPC-covered indefinitely without breaking anything, but Miller can't — its scarcity is
the entire structural tension lever (§1.4: "keep Miller count deliberately low... this is
the real tension lever"), and a persistently NPC-run Miller quietly removes that lever
from the game. Stated principle: **NPC coverage of Miller is temporary only — past a
fixed delay, the community is forced to cover it, mandatory, no opt-out** ("keeps roles
open to anyone, like it or not").

**Mechanic.** Once a Miller slot has been NPC-BACKSTOPPED for a fixed delay
(`[CALIBRATED — provisional]`, simulated at 3/7/14/30 days — see below), a random player
is conscripted into the role. The draft pool is everyone not already Miller: the
non-role-holding "gossip layer," or an existing holder of a different role (e.g. a
Courier). Drafting a gossip-layer player has no further consequence. Drafting an
existing role-holder pulls them out of that role — "one day you're Courier, then next
the Miller" — creating a real cascading vacancy there, which re-enters the ordinary
vacancy/backstop cycle for that role (no conscription for non-Miller roles; only Miller
is scarce enough to need it).

**Simulation-verified, not just designed.** A prior attempt to close the gap between
this and the brief's §2.4 targets by lowering the probabilistic BACKSTOPPED-recovery
hazard worked numerically but required Miller to sit NPC-run 79-86% of the time — in
direct conflict with the principle above. Conscription resolves both problems at once
(`src/sim/conscriptionHarness.ts`, `npm run conscription-sim`):

```
R_miller=2, R_other=4, brief targets: ratio ~1.2-2.8, starved ~1-2%

conscriptionDelay=7 days after backstop:
  N=50: ratio=1.49  Miller-backstopped=1.98%  conscriptions=207 (6% from other-role)
  N=80: ratio=2.94  Miller-backstopped=1.18%  conscriptions=123 (7% from other-role)

conscriptionDelay=30 days after backstop:
  N=50: ratio=1.47  Miller-backstopped=7.41%  conscriptions=180 (13% from other-role)
  N=80: ratio=3.33  Miller-backstopped=4.68%  conscriptions=114 (10% from other-role)
```

The genuine-fill:backstop ratio lands close to the brief's stated targets at every delay
tested — delay length barely moves the ratio (it's set before conscription is ever
relevant), it mainly controls how much time Miller actually spends NPC-run, which stays
under 8% even at a generous 30-day delay. The other-role cascade is real but modest
(6-13% of conscriptions, and consistently smaller than that role's own organic backstop
rate — verified, not assumed, in `test/conscription.regression.test.ts`).

**What conscription does *not* fix**, worth being explicit about: the pre-backstop
VACANT phase itself still runs around 6-7% of Miller slot-time versus the brief's stated
1-2% "starved" target — conscription only acts after backstop already fired, so this is
a separate, smaller, still-open residual gap (see `docs/BLUEPRINT.md`).

**[OPEN]**
- Exact conscription delay — 3/7/14/30 days all keep the ratio close to target; the
  choice is really about *feel* (how present should the NPC be before the community gets
  forced to respond) more than a number the simulation can settle on its own.
- Whether "other roles" ever need their own version of this, or whether Miller is
  genuinely the only role scarce enough to warrant mandatory conscription.
- The residual pre-backstop VACANT-phase gap noted above — unrelated to conscription,
  not resolved by it.

---

## Shard exit ticket

**[DESIGN — not yet built, new system, not in the original brief]**

A slow, individual, non-transferable path off a shard. Exists so migration is a real
decision with real weight, not a casual escape hatch, while still guaranteeing that
nobody is ever permanently locked into a shard they want to leave.

- **Individual accrual only.** No delegation, no pooling, nothing external can alter it.
  Deliberately closes off the exact exploit that would let an organized group buy a
  member's way out — this has to stay a personal cost with a personal payoff.
- **Deterministic baseline, illustrative figure ~6 months** `[CALIBRATED —
  provisional]` — same for every player, floor guaranteed regardless of luck.
- **Purchasable rate boost**, illustrative figure ~1 month of acceleration
  `[CALIBRATED — provisional]` — buys certainty/speed, never advantage. Matches the
  existing monetization principle (pay for certainty, not for an edge over other
  players).
- **Gamble mechanic layered on top of the deterministic floor**, not a separate path:
  a player can stake a portion of already-banked progress — illustrative unit, "a week
  or two" `[CALIBRATED — provisional]` — against a probability of early completion via
  the Oracle (below). Failure costs only the staked amount, never a full wipe back to
  zero. This mirrors a gear-fusion pattern from prior game experience: a guaranteed slow
  path exists in parallel with an optional, partial-stakes gamble path, and the two never
  have to be balanced against each other because they're different bets on the same
  underlying resource.
- **No permanent zero-state, anywhere.** Explicit design principle, not limited to this
  mechanic: nobody should ever be reduced to a state that's practically unrecoverable.
  Leaving is slow and costly; the road back should always exist, even if it's also slow.
  This directly shapes tone — churn is expected and fine, exile in all but name is not.

---

## The Oracle — public interface onto calculated luck

**[DESIGN — not yet built, new system]**

A visibly weathered, damaged fixture — described as beaten-up and mechanical/robotic in
character, not polished — present as an ordinary, universal daily errand available
everywhere, in every district/shard, not a landmark requiring travel. Deliberately not
the "voice from outside" scripted-ambient-dialogue idea from earlier in the day; that
stays separate (flavour-only, no real-world weight) if it gets built at all. The Oracle's
entire remit is: **report real probability draws from real distributions already in the
system.** Never narrative flavour, never random noise dressed as meaning.

Mechanically:
- **Daily task, universal.** Every player visits, collects a resource, either waits a
  short period (`~30s` `[CALIBRATED — provisional]`) or spends an in-game resource to
  skip the wait. Skipping buys time back, never better odds — same principle as the exit
  ticket's rate boost.
- **Flat, identity-agnostic probability.** The odds of any given draw (e.g. early exit
  ticket resolution when a gamble is staked) are the same for every player regardless of
  playtime, role, or history. A newcomer and a three-year veteran face literally the same
  number. This is a stricter fairness guarantee than the exit-ticket gamble's stake
  sizing alone would give — nobody, no matter how invested, gets better cold-mathematics
  odds than anyone else.
- **No malice, no target for grudges.** Because the outcome is genuinely cold
  mathematics with no agent behind it, a bad roll can't be resented and a good one can't
  be envied at anyone in particular — the social layer (Wall, rumour mill, reputation)
  stays entirely separate from this, which matters given how much of the rest of the
  design deliberately routes tension through social channels.
- **Odds float on shard economic health.** `[DESIGN — not yet built, needs a concrete
  metric]`. Illustrative shape: statistical thresholds where the shard's aggregate
  economic health (candidate input: Baker/Miller price spread, or another volatility
  measure already produced by the Phase 1 engine — not yet decided which) translates
  into wider or narrower odds bands at the Oracle for everyone on that shard
  simultaneously. This ties individual and collective interest together directly: keeping
  the shard's economy functional isn't civic virtue, it's what widens your own personal
  odds tomorrow. A sick economy shrinks odds for everyone at once, including anyone
  quietly benefiting from the sickness.
- **Shard death is an allowed real ending, not a failure state to prevent.** A shard
  whose economy collapses and stays collapsed can genuinely die down to a skeleton
  population; whether it then gets slowly rebuilt by whoever stayed, stabilizes small, or
  empties out further is explicitly not something to script or predict — it should be
  allowed to actually happen, and the outcome should be allowed to be whatever the real
  players make of it.

**[OPEN]** Exact economic-health metric and its threshold-to-odds mapping — not yet
defined, needs its own design pass once Phase 2 exists to give the metric something real
to measure.

---

## Private per-player maps

**[DESIGN — not yet built, significant departure from the original fog-of-recognition
framing]**

Rather than one shared, canonical map with uniformly-obscured identity, each player
maintains their **own private, non-shared annotations** on other players — tags,
suspicion markers, trust notes — visible only to the player who made them. Not a shared
ground truth with a fog layer over it; genuinely divergent, personal models of the same
world.

Two effects worth being explicit about:

- **This is a materially bigger client build than fog-of-recognition as previously
  scoped** — the client now needs to store and render private annotated state per user,
  not just hide/reveal shared state. Closer in shape to a private-intel system than a
  visibility toggle.
- **It quietly solves the screenshot problem without a policy.** A no-screenshot rule is
  unenforceable and was never going to be worth trying to police. But if every player's
  map is genuinely personal and non-canonical, a screenshot of it only proves what *that
  player believed*, not what's actually true — which deflates its value as evidence in a
  dispute more or less automatically, without needing anyone to enforce anything.

**[OPEN]** Does this replace the fog-of-recognition camera/visibility model outright, or
sit as an additional private layer on top of it? Not resolved this session.

### Refinement — the private diary (developed in conversation, same day)

**[DESIGN — not yet built, mechanic locked, table contents still provisional]**

Concretizes "private per-player maps" above into a specific mechanic, and reframes its
purpose along the way: not a persistent intel dossier that accumulates indefinitely, but
a bounded, private space to process a feeling about another player, expressed in the
game's own constrained vocabulary rather than free text. Stated explicitly during
development: *"I'm not trying to remove people's voices, just how they have to interact
with one another in this universe. Within limits, of course."* Constraint here isn't
censorship — it's the same medium-defines-the-interaction principle as the Wall grammar
and proximity conversation, applied to a private context instead of a public or
addressed one.

**Composed, not typed.** Same family as `SELF_STATES` (Wall/Envelope) and proximity
conversation — a diary entry is assembled from curated slots, never free text. A diary
entry costing a real decision from a bounded set says more than a paragraph would,
precisely because a choice had to be made.

**Slot structure:**
- **SUBJECT** — a specific *known* player. Ties directly to fog-of-recognition (§4.2):
  you cannot write an entry about a stranger's silhouette, only someone actually
  resolved. The diary becoming available for someone is itself a quiet signal that a
  relationship has become real.
- **OBSERVATION** — what you saw them *do*. Behavior-based, not motive-based — matches
  the existing atmosphere-principle finding that *what* someone does is almost always
  visible while *why* genuinely isn't. Deliberately a bigger, finer-grained table than
  `SELF_STATES`'s ten entries; illustrative starting set, grouped, not final:
  - *Trade:* undercut my price / matched my price / overpaid without needing to /
    haggled hard / refused to trade / offered first, unprompted / paid late / disputed a
    fair deal
  - *Information:* warned me about someone / shared a rumour freely / kept a confidence
    / let a confidence slip / corrected a false rumour about me / let one stand /
    introduced me to someone / kept me out of something
  - *Crisis:* covered a vacancy unasked / disappeared during one / showed up when it
    mattered / was nowhere to be found / kept a promise / broke one
  - *Presence:* sought me out / avoided me / stayed guarded / opened up unprompted /
    confronted me directly / deflected when confronted
- **READING** — your own subjective interpretation of *why*: seems trustworthy / seems
  opportunistic / seems scared / seems calculating / can't tell yet. Deliberately the
  biased, personal slot — the one that's allowed to age badly. `[OPEN]` whether this
  needs a table as large as OBSERVATION's or should stay small and blunt by contrast —
  not resolved yet.
- **CONTEXT** (optional) — ties an entry to a real game event (a trade, a Wall post read,
  a rumour heard), same grounding device as proximity conversation's CONTEXT tag.

No fifth slot for a trust score or numeric valence, deliberately — a number is the thing
players would optimize around; the READING slot's wording and the player's own memory of
the sequence carry that weight instead.

**Creation is unprompted-only.** The game never nudges a player to write an entry, even
off a CONTEXT-worthy event. Writing one is always a deliberate act, never a system
suggestion — consistent with the diary being personal processing space, not a system
telling players what's worth noticing about each other.

**Retention: rolling per-entry expiry, illustrative ~30 days `[CALIBRATED —
provisional]`, silent.** Each entry ages out independently on its own clock — oldest
erodes first, like real pages — rather than a whole subject's history clearing at once.
No fade or blur applied before expiry; an entry reads exactly as written until its window
closes, then it's simply gone. Expiry carries no warning or prompt, same
don't-tell-players-what-to-notice instinct as creation. This is a deliberate design
choice, not a legal requirement — unlike the brief's §5.2 voice-retention discussion
(which governs data the platform collects about a user for moderation purposes), a
private diary is the player's own content about their own experience; nothing compels an
expiry window here. It's adopted anyway because it does real thematic and safety work:
- The player's own persistent memory of a person and events is expected to outlast the
  system record — the diary is explicitly not meant to *be* the memory, just a temporary
  aid to it. "People will remember the person and the events. The diary is just a private
  space to vent in the language of the game."
- It's a second, independent safeguard against the diary ever becoming a leaked
  dossier, on top of the vocabulary constraint: even in the worst case, a leaked diary is
  only ever a bounded recent snapshot, never someone's whole history with another player.
- It matches the design's existing refusal to let anything calcify permanently —
  vacancy pressure resolves, economic position shifts, identity resolution is the one
  thing that's supposed to stay reliable once earned; an ever-growing private
  grudge-ledger would be the one place something *did* accumulate forever, which is the
  exact shape of thing this design avoids everywhere else.

**Thematic pairing worth preserving:** the Oracle (documented above) is deliberately
cold — no agent, no target for grudges, identical odds for everyone. The diary is the
opposite: entirely personal, entirely about grudges and trust, entirely private, and now
also entirely temporary. Same design rigor, opposite emotional register.

**[OPEN]**
- Whether this replaces fog-of-recognition's shared-map framing outright or sits
  alongside it — inherited from the parent section above, still unresolved.
- Final size/contents of the OBSERVATION and READING tables — illustrative only above.
- Exact retention window — 30 days is illustrative, not tuned.
- Whether there's any cap on entries per SUBJECT, or per player overall — not discussed
  yet.

---

## Atmosphere: hope as a structural target, not a mood applied afterward

**[DESIGN PRINCIPLE — applies across Phase 4 visual work, not a single mechanic]**

Correction to the emotional target implied by the original visual spec. Not a reduction
in tension or stakes — the 49-51 lean stays, "a little more darkness than there is
light," grudges and sour relationships are expected and fine. The actual failure mode
being corrected against is **vanilla**: a world that never visibly risks anything reads
as safe regardless of what the rulebook permits, and that quietly tells players nothing
they do matters.

Concretely: the same underlying tension (the Wall glowing, colour intensity signaling
economic/social state) should default toward **hopeful and glorious rather than
oppressive** — warm amber-to-gold rather than amber-to-red, a lantern rather than a
warning, for the *same* underlying data. Darkness stays real and present; it just isn't
the default rendering of ordinary tension. Directly ties to the fog-of-recognition
finding from earlier research: since *what* someone does is almost always visible
(motivation is highly behaviorally inferable) while *why* — trust, alignment — genuinely
isn't, the honest design claim is narrower than "you can't tell who anyone is." Worth
keeping that distinction in mind wherever Phase 4 visual/atmosphere work touches
identity or trust cues specifically.

---

## Wall/rumour grammar — threat model flag for later, not an issue yet

**[OPEN — no action until real players exist]**

The existing curated-template grammar (`SELF_STATES`, first-person/present-tense only,
no free text) already structurally blocks outright fabrication by construction — this
holds regardless of the following. Worth flagging for a future stress-test once real
players are actually posting: misdirection through **true, structurally-permitted**
statements (correct self-state, strategically timed or placed to imply something false
about a third party) is a distinct attack surface the grammar constraint doesn't
address, because it was never designed to — it constrains truthfulness of the statement
itself, not the inference a reader draws from its timing. Not a bug, not urgent, just the
actual threat model worth testing once the rumour mill has real stakes behind it.

## Proximity conversation — 1:1 and group, in-room and nearby

**[DESIGN — not yet built, new system, extends the Phase 3 grammar model]**

Live, addressed, turn-taking conversation between players sharing a room or physical
proximity — distinct from Wall/Envelope (asynchronous, broadcast, no third-party
reference) and from the earlier ambient-voice idea (scripted flavour dialogue, no real
weight), which stays separate if it gets built at all.

**Origin of the constraint.** The original open question was whether literal voice chat
between players was still necessary. It was wanted for unscripted presence and
atmosphere, not just coordination — but real voice opens the exact problem the rest of
the design has already solved elsewhere: free expression can only be moderated after the
fact, which means recording, which means biometric data, retention obligations, a human
reviewing captured audio, and the GDPR/compliance surface that comes with all of it.
Explicit design principle stated this session: if the game doesn't have to hold the data,
it doesn't hold the data — not compliant handling of voice recordings, but not collecting
the thing that creates the liability in the first place. Freedom of speech within the
game is real, but it's expressed through a rich constrained vocabulary rather than
unlimited free text, the same trade the Wall grammar already made.

**Slot structure — combinatorial, not a flat list.** Each turn composes from a small set
of independent slots rather than picking one of ten fixed lines:

- **INTENT** — inform / ask / warn / deflect / affirm / refuse / needle / reassure
- **TONE** — warm / cold / wry / urgent / guarded / playful / weary
- **REFERENT** — the room generally, or a specific *present* player by name (never an
  absent one — unlike Wall/Envelope, direct address to someone in the room isn't the
  same defamation risk as gossiping about a third party who isn't there to answer, since
  everyone present already knows who's present)
- **CONTEXT TAG** (optional) — ties the line to existing game state (your price, your
  vacancy status, a rumour you've heard) rather than open topic text

`INTENT x TONE x REFERENT x CONTEXT` produces a large, enumerable space of distinct
utterances from a handful of small tables — same cheapness-of-implementation principle
as `SELF_STATES`, composed instead of flat, every combination checkable at the function
boundary exactly like `postToWall` throwing on anything outside its table.

**No microphone, ever.** Player composes a turn via staged UI selection (INTENT narrows
sensible TONE options, then REFERENT, then optional CONTEXT); the validated template
string renders through text-to-speech. Nothing captured, nothing biometric, nothing
retained anywhere — there is no recording to be subject to any policy, which is the
actual solution, not a workaround of one.

**Tone still permits real social maneuvering.** Same property as the Wall's grammar:
constraining truthfulness of the statement itself is not the same as constraining what a
listener infers from tone or timing. A warm-toned deflection is a real, legitimate social
move under this system, not a hole in it.

### Ephemerality — gone from the system, kept in the minds that heard it

**[DESIGN — not yet built]**

Room conversation is recorded nowhere and by no system, full stop. It is not lost,
however — it persists exactly as far as the memory of whoever was actually present, the
same way a real overheard conversation does. This resolves cleanly into the existing
rumour mill rather than requiring a new propagation system: a player who wants to relay
something they heard in a room later has to route it back through the same constrained
Wall/Envelope grammar as everything else — first-person, present-tense, no free text.

This makes verbatim leaking structurally impossible: there is nothing to screenshot or
transcript, so the only path back into the social layer is a lossy, template-shaped
reconstruction filtered through whoever is relaying it. Three players present for the
same conversation could relay three different secondhand versions later, each shaped by
their own framing — closer to how real gossip actually behaves than a system that
faithfully logs and republishes ever would be, and it inherits the Wall grammar's
harassment-prevention property for free: there's no free-text path to route around at
the point of relay either.

### Spatial clarity — reusing the rumour mill's decay model, driven by distance instead of hops

**[DESIGN — not yet built]**

Proximity eavesdropping should degrade the same way the rumour mill already degrades
information over graph hops — clarity falling off, a chance of drift into something
plausible-but-wrong, a floor below which nothing arrives at all — just driven by
physical/acoustic distance and the listening player's in-space awareness rather than
social-graph distance.

**Distance and awareness are acoustic-realist, not an arbitrary game number.** Whether an
eavesdropper is close enough to catch anything, and whether they're even aware someone
nearby is speaking, is determined by the game's own physics and spatial model — not a
separate abstract proximity stat layered on top. This was an explicit correction this
session away from a clean inverse-square abstraction toward "let the actual space the
avatar occupies decide it."

**Corruption happens before synthesis, not after — this is what kills the
volume-override problem.** Because a room conversation is a composed string (from the
INTENT/TONE/REFERENT/CONTEXT slots above) rather than a captured waveform, degrading with
distance doesn't mean turning down a clean signal — there is no clean signal sent to a
distant listener to turn down or recover. Slot values are corrupted or dropped *before*
text-to-speech ever renders anything, so a distant eavesdropper's client only ever
receives an already-degraded string. No UI setting or client trick can recover a
signal that was never sent. Likely degradation order: TONE and INTENT survive longest —
you can usually tell that someone's warning you and how urgently, even at range — while
REFERENT and CONTEXT (the specific, information-dense slots) drop or distort first. That
mirrors real-world eavesdropping and lip-reading: never a faithful representation, always
some degree of inference and missed detail, worse the further or less aware you are.

**Corrupted slots drift to plausible-wrong values, matching the rumour mill's distortion
model** rather than simply going silent — an eavesdropper can walk away with a
confidently wrong belief about who or what was meant, not just an acknowledged gap. This
is the richer, more mischievous option and was confirmed as the intended behavior this
session.

**Whether a corrupted (mis-heard) account is treated identically to a faithfully-heard
one once relayed is deliberately left to the players, not resolved by the system.**
Explicit design position: the game does not adjudicate whether the eavesdropper or the
original speaker is the more trustworthy source when a relayed account conflicts with the
source — that judgment call belongs entirely to the social layer (reputation, history,
who the listener trusts), the same way real gossip works. If a conflict escalates, that's
the social system doing its job, not a defect to patch.

**[OPEN]**
- Exact decay curve and cutoff range for spatial clarity — realism-driven per this
  session's correction, but the precise falloff shape (and how it interacts with the
  game's actual movement/space model) isn't tuned yet.
- Room/group scaling once occupancy is large — does everyone in a room hear every turn,
  or does proximity-based sub-grouping emerge naturally from the same distance-decay
  model applied at short range.
- Whether relayed room-talk that re-enters the rumour mill via Wall/Envelope gets any
  distinguishing marker (e.g. "overheard" vs. "told directly"), or is fully
  indistinguishable from any other secondhand account once it's back in the system.

---

## Exit ticket gamble — proportional staking, simulation-verified

**[DESIGN — not yet built, mechanic locked, staking formula still provisional]**

> See the verification note at the top of this document — the staking formula direction
> below does not match this section's own stated intent. Not edited here; flagged there.

Refinement of the exit ticket gamble above: the stake required for a given win chance
scales with how far a player already is from completion, rather than being a flat wager
independent of progress. Design intent stated this session: a player nearly at the
deterministic finish risks comparatively little for a meaningful shot at finishing early;
a player gambling from near zero has to stake nearly everything they've banked for the
same shot. Explicitly not drawn from any single other game — a deliberate reframing built
from direct experience running competitive systems at scale (five years leading a
top-ranked War and Order alliance) rather than a borrowed mechanic.

### Illustrative model tested

`[CALIBRATED — provisional]` — for population-scale sanity-checking only, not tuned
numbers:

- Progress `p` in `[0,1]`, deterministic accrual `1/180` per day (matches the ~6-month
  baseline above).
- A gambling player stakes fraction `f` of their own banked progress; win probability
  `w(p, f) = clip(base_odds * f / p, 0, 1)`, where `base_odds` stands in for the Oracle's
  flat, identity-agnostic draw probability.
- A win completes the ticket instantly (`p -> 1`); a loss reduces progress to
  `p * (1 - f)` — costs only the staked fraction, never zeroes the player out entirely,
  matching the "no permanent zero-state" principle stated earlier in this doc.
- Gamblers in the simulation size their stake to target a constant ~30% win chance
  regardless of where they are in `p` — i.e. players behaving exactly as the design
  intends, choosing "meaningful odds" rather than an arbitrary stake.

### Simulation methodology

5000-player population, deterministic daily accrual, 1% of active players gambling on
any given day, seeded (`seed=7`) for reproducibility, run out to 1000 days — well past
the ~180-day deterministic baseline, to see the tail. Compared directly against a
no-gambling baseline (pure deterministic accrual, zero variance, everyone completes at
exactly day 180).

### Findings (preserve these across parameter retuning — re-verify if the staking formula changes)

1. **Proportional staking genuinely equalizes risk, not just at the endpoints.** Win rate
   among gamblers converged to ~28% against a 30% target across the whole run, regardless
   of whether a given gamble was staked from near-zero or near-completion progress — i.e.
   the *rate of return per unit staked* is constant across the entire progress curve. What
   differs is only the absolute size of the stake needed to buy that same rate, which is
   exactly the intended behavior: a near-complete player commits a sliver of banked time,
   a near-zero player commits nearly everything.

2. **The mechanic trades expected time for variance — it does not break the economy in
   either direction.** Against the deterministic 180-day baseline (zero variance,
   everyone finishes exactly on day 180), the gambling population is *slower* early on
   (3125/5000 complete by day 200, vs. all 5000 in the no-gamble baseline) but eventually
   converges (4990/5000 by day 999). No runaway early completion, no death-spiral where
   losses systematically outpace deterministic accrual for the population as a whole —
   the system self-stabilizes around a wider, fatter-tailed completion distribution
   rather than collapsing toward either extreme.

3. **Population-average completion time goes up under gambling, not down** — losing a
   gamble costs real banked progress, so in aggregate the population pays for the
   possibility of early finishers with a longer average wait, not a shorter one. This
   matches the stated intent directly: a loss is a real cost ("you can lose it within an
   hour and have to start again"), not a free roll with no downside, so the aggregate
   math should — and does — reflect that the house edge here is time, borne by the
   population that gambles and loses, subsidizing the minority who win early.

4. **Active (non-completed) players' mean progress stays in a stable band (~0.38–0.48)
   throughout the run** rather than collapsing toward zero or ballooning toward
   completion — confirms the gamble mechanic doesn't create a treadmill trap where losses
   compound faster than deterministic accrual can recover from, at this `base_odds`/
   `target_w` combination.

**[OPEN]** The illustrative `base_odds`/`target_w` values used here aren't tuned to any
real design target — they were chosen only to get a stable, testable population dynamic
for this sanity check. Real values depend on the Oracle's actual economic-health-linked
odds model (`[OPEN]` above), which doesn't exist yet. Re-run this population check once
that model is defined, since a shard-health-dependent `base_odds` could behave very
differently in aggregate from the flat constant used here.

---

## Multi-shard mobility — passport tiers (legal vs. illegal migration)

**[DESIGN — not yet built, extends the exit ticket system, structure still loose]**

Beyond adjacent-shard migration via the standard exit ticket, an expansion toward
distinct migration "rights" tiers, framed as legal vs. illegal rather than as separate
unrelated systems — same underlying principle (deterministic floor vs. proportional
gamble) reused at a larger scale rather than a new mechanic invented from scratch:

- **"Legal" migration** — the exit ticket as already specified: deterministic accrual,
  purchasable rate boost, optional proportional gamble on top. Low or no legal/systemic
  risk beyond the stake itself.
- **"Illegal" migration** — a higher-variance, chance-driven path to reach a
  *non-adjacent* shard or a different ecosystem entirely (explicitly floated: distinct
  "passport" tiers granting access to structurally different shards/ecosystems, not just
  neighbouring ones), where the risk taken is relative to distance from the target rather
  than distance from a single fixed finish line — conceptually the same proportional-risk
  shape as the gamble above, generalized: nearly there, low relative risk; far away,
  risking nearly everything for a wild chance.

Motivating idea: different shards/ecosystems could mature at different rates and develop
different play-style identities (older established shards vs. newer ones), and player
migration between them — in either direction — should be possible without collapsing the
whole system into one homogenous blob. "Keep the same fundamental principles, expand them
piece by piece so the whole structure doesn't fall apart" — stated explicitly as the
constraint on how this gets built.

**[OPEN]** This is looser than the proportional-gamble mechanic above and not yet reduced
to a concrete mechanic — needs its own design pass on what "different ecosystem" actually
means structurally (a differently-tuned economic engine? a genuinely separate ruleset?),
and how passport tiers are earned/purchased/gambled for, before it's buildable.
