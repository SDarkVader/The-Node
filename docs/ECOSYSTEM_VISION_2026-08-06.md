# Ecosystem Vision — the shape of NODE at scale

Companion to `BLUEPRINT.md`'s "Design intent" section, one level up. That section states
what NODE *is* at the scale of a single shard: 50–80 players, no combat, tension from
asymmetric information and structural pressure, permanently tilted 49-51. This document
is the same question asked one level up — not what a shard is, but what NODE is when
there are many of them, what happens when one dies, how players move between them, and
what all of it is actually for.

Nothing here is a mechanic spec. Where a real mechanic already exists
(`DESIGN_ADDENDUM_2026-08-06.md`), it's referenced, not re-derived. Where this document
proposes shape without a mechanic yet, it's marked `[VISION — shape only, not a spec]`.

---

## 1. The shape: a shard is the atom, not the world

A single shard is the complete, self-contained unit everything so far has been designed
around — its own Miller/Baker economy, its own vacancy pressure, its own Wall, its own
rumour mill, its own Oracle. NODE at scale is many shards existing in parallel, each one
a live, independent economic and social organism, not a symmetric copy of the others.

This is already implied by decisions made at the micro scale, just not stated as an
ecosystem property until now: "every shard will be different" was said about density
pressure specifically, but it generalizes — no two shards should converge on the same
economic history, the same rumour distortions, the same vacancy pattern, because nothing
in the design pushes them toward convergence. Divergence isn't a risk to manage, it's the
default and correct outcome of independent economies running independent seeds.

**The graph, not the map.** Shards relate to each other the way players relate to each
other within a shard — connected, unevenly, with real distance between some pairs and
near-adjacency between others. NODE-the-ecosystem is structurally the same shape as
NODE-the-shard: a node graph, one level up. The name holds at both scales, which is
usually a sign the underlying idea is sound rather than a coincidence of naming.

---

## 2. Ruin and rejuvenation — the mechanic you already built

**[VISION — grounded in an existing mechanic, not a new one]**

The addendum already establishes that shard death is an allowed real ending, not a
failure state to prevent. What wasn't stated explicitly until now is that you don't need
a new system to make rejuvenation possible — the vacancy backstop already is one, at the
limit.

Walk it through: the two-stage vacancy/NPC-backstop system exists so a single empty
role-slot doesn't stall the shard's economy — flag it, and if nobody fills it, fall back
to flat NPC pricing, mechanical and honest, no agent, no behavior to model. Nothing about
that system assumes only one role-slot can be vacant at a time. Push it to the limit —
every role-slot on a shard empty simultaneously — and what falls out is exactly a ruined
shard: technically alive, running entirely on NPC flat-pricing, atmosphere flatlined,
Oracle presumably reading thin odds off a dead economic-health metric, waiting. Nobody
scripted a "ruin state." It's the same mechanic you built for a much smaller problem,
applying itself correctly at a larger scale.

**Rejuvenation, by the same logic, is just migration into a flat-priced shard.** A ruined
shard isn't locked or archived — it's sitting there at NPC-backstop equilibrium, and the
moment real players migrate in and start filling role-slots, the flat pricing gives way
to real Cournot/Bertrand competition again, the Wall starts registering real activity,
the Oracle's odds start moving with a real economy instead of a dead one. No rejuvenation
script exists because none is needed — the same machinery that keeps one empty stall
running also keeps an entire empty shard running, at whatever fidelity real players
choose to restore.

**What this correctly refuses to do:** predict, script, or incentivize which shards get
rejuvenated and which stay empty. That has to stay a real consequence of where migration
actually flows — driven by the exit ticket, by rumour and reputation about a shard's
condition, by whatever draws a player toward one destination over another. Design's job
here is only to make sure the door is never mechanically locked, not to decide who walks
through it.

**[OPEN]** Whether a fully-vacant shard needs any additional signal (visibility to
prospective migrants that this shard is specifically in the ruined state, vs. just
generically quiet) is a genuine open question — see the ecosystem-visibility discussion
below, since this is really a signalling question, not a mechanics question.

---

## 3. Shard travel — the shape, without locking the passport mechanic

**[VISION — shape only, not a spec. `MULTI-SHARD MOBILITY` in the addendum already
covers the mechanic itself; this section deliberately doesn't re-derive it.]**

What's safe to say about shard travel at the vision level, without pinning down
passport-tier specifics:

- **Distance is real, not cosmetic.** Two shards can be "close" (cheap/fast to move
  between, matching the existing adjacent-shard exit ticket) or "far" (expensive, risky,
  matching the looser illegal-migration/passport idea) — and that distance should mean
  something economically and socially, not just be a UI number. A shard's actual distance
  in the graph is a legitimate thing for its Wall, its rumours, and its Oracle odds to all
  quietly reflect.
- **Information about a shard degrades with graph distance, the same way the rumour mill
  already degrades information with social-graph distance.** What a player hears about a
  far shard before ever visiting it should be less reliable than what they hear about an
  adjacent one — not because of a new rule, but because the same clarity-decay shape
  already built for the rumour mill and for proximity conversation applies naturally here
  too: distance degrades signal, whether that distance is measured in social hops,
  physical metres, or shard-graph hops. A distant shard should feel like rumour and legend
  until a player actually arrives, which is honest to how migration and distant places
  actually feel.
- **Travel is a real leap into partial unknown, by design, not a UX gap to close later.**
  Nothing here should try to give a prospective migrant a fully reliable preview of a
  shard before they commit — that would undercut the entire point of the decay principle
  above.

Nothing above requires deciding what a "passport" actually is mechanically — that stays
exactly as open as it's marked in the addendum.

---

## 4. Every observation, translated to ecosystem scale

Everything below is a single-shard design decision asked the same question: what does
this look like when there are many shards instead of one? None of these are new
mechanics — they're the existing ones, checked for whether they still hold at scale.

**Hope-as-structural-target becomes an ecosystem signal, not just an aesthetic.** A
shard's default rendering — warm, glowing, hopeful rather than oppressive, for the same
underlying economic/social data — was designed as in-shard atmosphere. At ecosystem
scale, if a prospective migrant can see anything about a shard before committing to
travel there, that glow becomes real information architecture: a shard's aggregate
"temperature," visible at a distance, becomes part of what a player weighs when deciding
where to go. This ties visual design directly into the travel-decision economy rather
than leaving it purely decorative — worth treating deliberately rather than incidentally
once Phase 4 gets anywhere near ecosystem-level views.

**Private per-player maps become a patchwork with no canonical version anywhere, not even
at the top.** Within a shard, no player sees a single ground truth, only their own
private, non-canonical impressions of others — and per the diary refinement below, those
impressions are not a permanent system record. At ecosystem scale this compounds cleanly
rather than needing new design: no player ever holds a canonical picture of the ecosystem
either, only their own patchwork of every shard they've personally touched or heard about
— and per the point above, what they've heard about shards they haven't visited is itself
rumour-mill-degraded. There is no view of NODE, at any scale, that is the objectively
true one. That's not a limitation to work around — it's the same design principle that
made the screenshot problem disappear at the shard level, now holding the entire
ecosystem to the same honesty.

> **Resolved same day, after review:** this section originally said "accumulating"
> impressions, written independently of (unaware of) the "private diary" refinement
> developed in conversation and added to `DESIGN_ADDENDUM_2026-08-06.md`'s "Private
> per-player maps" section — which gives person-level entries a bounded, ~30-day rolling
> silent expiry, not an ever-growing dossier. Confirmed: the diary's model is
> authoritative at every scale, corrected above. There is no separate, longer-lived
> "shard impression" system record sitting above the diary — whatever a player carries
> about a shard beyond what a still-live diary entry shows is their own untracked human
> memory, exactly as the diary was designed to lean on ("people will remember the person
> and events; the diary is just a private space to vent in the language of the game"),
> not a second data structure the system maintains and would need its own retention rule
> for.

**The Oracle's flat, identity-agnostic fairness holds ecosystem-wide, and that matters
more at scale, not less.** If every shard has its own Oracle reading its own economic
health, the fairness guarantee — same odds for a newcomer and a veteran — needs to hold
per-shard independently, otherwise "shard-hopping for better luck" becomes a real,
resentment-generating strategy the whole design has been careful to avoid at the
individual level. Worth stating explicitly: no shard should ever be able to develop a
reputation as the "lucky" one independent of its actual economic health, because that
would be exactly the kind of gameable, agent-like unfairness the mechanical-NPC and
flat-Oracle decisions were built to prevent in the first place.

**No-recording, no-biometric-capture scales for free.** This is the one piece of the
whole design that gets easier, not harder, as the ecosystem grows — because nothing is
ever captured regardless of shard count or player count, the compliance/legal surface
doesn't grow with scale the way a system built on moderation-after-recording would. Worth
naming explicitly as a genuine architectural win: the decision to solve voice through a
constrained grammar rather than real audio wasn't just an elegant single-shard solution,
it's one of the only pieces of this entire design that scales to an arbitrary number of
shards without needing to be redesigned.

**49-51 needs its own version at the ecosystem level, one tilt up from the shard level.**
Within a shard, the system stays permanently, slightly tilted — never comfortable, never
collapsing. At ecosystem scale, the equivalent failure modes are: every shard converging
toward the same bland equilibrium (systemic vanilla, boring at the meta level even if
individually each shard is fine), or a cascade where shard death becomes so common the
whole ecosystem trends toward collapse. Neither should be engineered against directly —
consistent with the whole design ethos, this should be checked the same way the exit
ticket gamble was checked: simulate the aggregate, see whether the population of shards
naturally holds a live spread (some rising, some ailing, some dying, some rejuvenating)
rather than converging or collapsing, once there's something real to simulate.

---

## 5. What this is actually for

Stripped of mechanics, stated plainly, because it's worth having written down once in
this register rather than only living in conversation:

NODE isn't a war game with the war removed. It's an attempt to build an environment where
the actual texture of human nature — the good and the petty and the loyal and the
irritating, the elevated and the pissed-off, the niggling feeling that peace doesn't last
forever no matter how small the argument that broke it — has somewhere honest to happen,
without ever making that texture unrecoverable for the people living it. Not a clean
ride. Not oppressive either. Weird and wonderful, deliberately, because that's the actual
shape of the thing being modeled.

The method matches the goal: walk the space like it already exists, notice what's true
about it, build only what the space actually implies rather than importing what other
games did — and where the implication is genuinely unclear, run the numbers rather than
guess, the same way the exit ticket gamble got tested before being trusted.

---

## 6. How to scale this without breaking it

Not a new set of rules — the discipline that's already been used at shard scale, stated
as the standing policy for everything built beyond it:

1. **Simulate before trusting, every time a mechanic gets new reach.** The exit ticket
   gamble wasn't accepted on the strength of the idea alone — it was population-simulated
   against a deterministic baseline first, and the simulation is what actually confirmed
   it doesn't break the economy in either direction. Any ecosystem-scale mechanic
   (passport tiers, rejuvenation dynamics, cross-shard economic effects if those ever
   exist) needs the same treatment before being trusted, not just before being built.
2. **No permanent zero-state, at any scale.** Established for individual players
   (progress lost in a failed gamble never zeroes out completely) and now established for
   shards too (a ruined shard is dormant, not deleted — the door back stays open via the
   same vacancy machinery). Every new system added at any scale should be checked against
   this before it ships: does failure here ever produce a state nothing can recover from?
   If yes, it doesn't belong in this design.
3. **Ask "does this need to be an agent" before building anything new.** The
   vending-machine NPC and the Oracle both exist because the alternative — something with
   behavior, motivation, or belief to infer — is a deception surface waiting to happen.
   That question should be the first one asked of every future system, not just those
   two: minimize what's modelable, at every scale, by default.
4. **Nothing gets recorded, ever, regardless of how big this gets.** The
   voice-as-constrained-grammar decision is the clearest example of a choice that doesn't
   just solve today's problem, it removes an entire category of future problem from ever
   existing. Any future system touching player expression should be checked against the
   same standard: can this be built so there's nothing to capture in the first place,
   rather than something captured and then handled responsibly.
5. **Let outcomes be real, don't script them.** Shard death, shard rejuvenation, who
   migrates where and why, which shards end up thriving and which end up thin — none of
   it should be authored. The system's job is to make every outcome genuinely possible
   and genuinely consequence-bearing, and then get out of the way. This has been the
   consistent instinct throughout — "as emergent as possible" — and it's the one thing
   that would be easiest to quietly compromise under real production pressure, so it's
   worth stating here as a standing constraint, not just a preference.
