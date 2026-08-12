# Adversarial containment — what actually stops one player taking everything

**The design position this documents** (user-stated, 2026-08-11): *"If you live in a quiet
little area and a fucker like me decides to impose their will upon you, then I have to make
it damn near impossible. But still remember players like me need boundaries — because let
loose, I'll find a way to take everything you have, no matter how long it takes. So the game
has to contain me but still accept I'm always there. My reach is reputational, not
destructive. I'd be remembered for a different reason."*

**Refined by the same user shortly after** (2026-08-11), and the refinement matters more
than the original: *"If there's a constant pattern to detect, the other roles have to make
following that pattern exciting but not guaranteed and a calculated risk. I know I'll do it,
I know it'll work at some point, but at what cost — and how do I make plans with strangers
who have imperfect information? It's a puzzle you can only solve with reputation built on
actions, not on superiority."*

That changes the target. "Damn near impossible" as an absolute was the wrong reading:

**The goal is not to make domination impossible. It is to make it expensive, uncertain, and
impossible to do alone.**

Six requirements, in tension with each other:
1. A quiet place cannot be steamrolled by a determined outsider.
2. The determined player is **contained**, not excluded — they belong here.
3. Their reach is **reputational**, not destructive.
4. They are **remembered** — the point is legacy, not erasure.
5. Exploiting a pattern must be a **calculated risk with a real price**, not a free win and
   not a blocked door. It should work *eventually*; the question the player must face is
   *at what cost*.
6. Ambition must require **coordination with strangers under imperfect information** — which
   is only solvable by building reputation through witnessed action.

This document audits what the code actually does about that today. It is deliberately
evidence-based: claims below cite the mechanism, because "the constraints cover it" is not
the same as "the implementation does."

---

## What genuinely prevents domination today

### 1. Wealth is a scoreboard, not leverage — **strongest protection, and partly accidental**

Every read of `.wealth` in the codebase is a *metric* (Gini, top-10% share), a *remediation*
(tax/cap, both off by default), or a *report*. **Nothing spends it. Nothing buys anything
with it.** A player who accumulates relentlessly for a year ends up with a large number and
no additional power.

This is the single most important containment property in the system, and it is worth being
honest that it is **incidental** — wealth was built as a *measurement* of inequality, not as
a currency. Nobody designed it as a containment mechanism. It works as one anyway.

### 2. Sabotage cannot be aimed — **verified, and probably not intentional**

`world.ts`'s sabotage stage picks its target with `Math.floor(rng() * filled.length)` and
picks each eviction with `Math.floor(rng() * evictable.length)`. Both are **uniform random
over currently-FILLED slots**. There is no attacker identity, no target selection, and no way
for a player to direct it at a rival. `saboteurCount` is a world config constant, not a
player action.

So the mechanic that most obviously *looks* like a weapon is currently a **weather event**,
not a tool. It cannot be used to systematically dismantle a specific person.

### 3. Nobody can hold more than one role, or hold one indefinitely

Role slots are single-occupancy, and there is no path to holding two — conscription *moves*
a player between slots (`conscriptionFromOtherRole`), never grants an extra. On top of that,
churn and conscription both remove people from roles over time regardless of merit or
wealth. **Time evicts everyone eventually.** Positional power cannot be hoarded because the
system keeps redistributing it.

### 4. The floor cannot be taken away

Constraint 2 (no permanent zero-state) and constraint 6 (reputation may only grant, never
remove) are enforced in the mechanics that exist: `GRIFTER_DAILY_INCOME` is strictly
positive, the vacancy backstop keeps unstaffed slots productive, and
`CONSOLIDATION_FRICTION_FLOOR` never reaches zero access. There is no mechanism by which one
player reduces another player's baseline. **The worst anyone can do is decline to elevate.**

### 5. Direct channels cannot carry a plan — **the answer to information-brokering**

The stated exploit is specific: *"I used information to know what people were going to do
before they decided amongst themselves ... because it was directly accessible through direct
channels."* That is information-brokering — aggregating private communications to front-run a
group decision.

NODE's private channel is the **Envelope**, and its entire payload is:

```ts
export interface Envelope { id; fromId; toId; state: SelfState; day; opened }
```

`SelfState` is one of ten first-person feelings ("I feel isolated", "I feel exploited").
There is **no free text, no subject, and no third-party reference anywhere in the grammar** —
`grammar.ts` states this as a structural rule and `test/grammar.test.ts` asserts the whole
table rather than spot-checking it.

So a player who successfully taps every private channel in the shard obtains a **distribution
of moods, not a set of intentions**. They cannot learn what the group will decide, because the
vocabulary is incapable of expressing a decision. This is the strongest anti-brokering
property in the design, and unlike wealth-inertness it *is* deliberate.

**Tripwire:** adding free text, a subject slot, or any third-party reference to the grammar
would convert direct channels into exactly the vector described above. This is the single
change most likely to be requested for "expressiveness" and most damaging if granted.

#### Correction: the grammar does not make conspiracy impossible — it makes it require history

I overstated this above ("the vocabulary is incapable of expressing a decision"). Literally
true of a *single* message; false over a relationship. Ten symbols, sent repeatedly between
two people, is enough to build a private convention — *two 'uneasy' in a row means the thing
we discussed*. Players will do this, the system cannot detect it, and it should not try.

What matters is that establishing a code **requires shared context that must be built first**,
and the channel is too narrow to bootstrap one with a stranger. So the real property is
better than the one I claimed:

- **Strangers cannot conspire.** Ten ambiguous mood-symbols carry no way to agree on what
  they will mean, with someone you have no history with.
- **Long-standing allies can.** People with accumulated shared experience can hold a private
  code, because the meaning lives in the history rather than in the message.
- **Codes need maintenance.** The diary's TTL means the shared context underpinning a
  convention decays unless it keeps being refreshed by real interaction.

That is exactly the intended shape: conspiracy is not banned, it is **gated on relationship**.
The determined player can absolutely build a coded channel — with people they have invested
years in. Which is the cost, and which is also, again, reputation.

### Interrogation is the actual gameplay — and it is deliberately hard

*"I'll have to interrogate people without them knowing it through cryptic messages. Not
exactly an easy start."*

That is the intended loop, and it falls straight out of the constraints. You cannot ask a
question — the grammar has no interrogative and no subject. What you can do is **emit a
signal and read what comes back**: send a state, watch whether the reply shifts, watch what
propagates to the Wall, watch what a third party starts broadcasting a week later. It is a
signalling game played in ten symbols against people who may be doing the same to you.

Three properties make it a real puzzle rather than a guessing game:

- **You cannot tell probing from sincerity.** A player broadcasting `suspicious` may be
  genuinely suspicious or fishing. Neither you nor they can prove which.
- **The channel distorts.** Rumours decay and flip in transit (`comms/decay.ts`), so a signal
  arriving three hops away may not be the one that was sent — and the sender cannot know what
  the receiver actually got.
- **Silence is information.** With ten states and no way to say nothing-in-particular,
  *choosing not to post* is itself legible to anyone watching closely.

#### The unresolved tension: the design withholds the thing this player most enjoys

*"But I like talking to people. And the chaos or beauty that follows."*

This deserves a straight answer rather than a reassuring one. **NODE, as designed, does not
let you talk to people.** Ten mood-symbols is not conversation. The planned face-to-face
proximity channel is also a composed vocabulary rather than free text, so it does not solve
this either. Free typed text is not merely unbuilt — it is deliberately excluded, and Phase 5
(voice/safety) is hard-gated on legal review precisely because open expression in a game
built on rivalry and social pressure is a harassment vector. The design's own framing is that
"the harmful sentence structures simply don't exist in the grammar you're given."

So the trade is real and should be named: **the design chose safety and anti-brokering over
expression, and the cost is paid by exactly the players who most want to talk.** That is not
a bug to be engineered around; it is a decision with a price, and this is the price.

What the design offers instead — and whether it is enough is genuinely unknown:

- **The chaos comes from interpretation, not expression.** When a channel is this narrow,
  meaning is made by the receiver. The rumour mill *literally* distorts signals in transit,
  so what you meant and what lands are routinely different. Misreading is guaranteed rather
  than incidental.
- **The beauty, if it appears, is inference.** Working out who someone is from ten symbols,
  their timing, their silences, and what other people started saying afterwards — that is a
  different pleasure from conversation, not a substitute for it.
- **Relationships still form**, but through accumulated shared history rather than dialogue,
  which is what makes private conventions possible at all (above).

**Honest assessment:** if what a player loves is the back-and-forth itself, this design will
frustrate them, and no amount of clever signalling mechanics will fix that. If what they love
is the *consequences* — the chaos, the misreadings, the reputations that form — then a narrow
channel may actually intensify it, because ambiguity is the raw material. Which of those is
true for real players is unknown and unsimulable, and it is the same question as research
question 12 seen from the other side.

**The open risk, stated honestly:** this may be *too* hard. Ten symbols is roughly 3.3 bits a
message, and if probing turns out to be indistinguishable from noise in practice, the social
layer is not subtle — it is dead, and the anti-brokering protection has cost the game its
actual gameplay. Nothing in the simulation can tell us which, since it has no player capable
of probing. Logged as research question 12.

### 6. Fixed schedules — **a real vulnerability, now fixed**

Found while auditing this: sabotage fired on `day > 0 && day % sabotageCadenceDays === 0` —
a **covert mechanic running on a perfectly public 20-day timetable**. Any player tracking
dates learns it within two cycles and can plan around or exploit it. That directly
contradicted the treatment already given to interception in `importExport.ts` (stateless,
jittered, "no pattern to learn because nothing persistent generates one").

**Fixed** by making the opportunity a per-day hazard of `1 / sabotageCadenceDays`. Expected
frequency is mathematically unchanged — verified at 1 per 20.3 days against a cadence of 20 —
so no calibration moves; only predictability is removed. Measured 88 distinct interval
lengths where a fixed clock gives exactly 1. Locked by two regression tests.

**Deliberately left deterministic**, because these are *civic* timers that everyone is
supposed to be able to read: the vacancy flag at `tFlag`, the backstop at `tHard`, the
conscription delay, and the district-consolidation grace period. Public pressure only works
if the clock is public. The distinction that matters: **overt mechanics may be predictable;
covert ones must not be.**

---

## The gap: the reach they *want* does not exist

**There is no reputation system in the code at all.** The only occurrence of the word is a
comment in `ecosystemHarness.ts` noting its absence ("no reputation, no scripted
retaliation").

So the current state is lopsided in an interesting way: the game **contains** this player
type well, but offers them **nothing to do with their persistence**. Requirement 3
(reputational reach) and requirement 4 (being remembered) are both unmet. A patient,
ambitious player currently has no legitimate channel for ambition — which is its own failure
mode, and arguably a worse one than the domination risk, because it makes the game boring
for exactly the players most willing to invest in it.

Constraint 6 already specifies the *shape* such a system must take (additive only, never
subtractive, never pushing anyone below their floor). Civic memory (constraint 4) already
specifies where legacy may live: public, collectively-witnessed events persist; private
judgements do not. **The design is specified and unbuilt** — that is the honest status.

---

## Patterns should be contestable, not merely absent

The sabotage-clock fix above removes a *world-generated* schedule, and that stands: a covert
system event on a public timetable is a free win with no counter-play, which fails
requirement 5 from the other direction (no cost, no risk, nothing to calculate).

But it would be a mistake to generalise that into "eliminate every pattern with RNG." The
stated principle is sharper: **where a pattern exists, the counter-play should come from
other roles, not from denying that the pattern is there.** Randomness that merely hides
information produces a game of dice; a pattern that other players can *contest* produces a
game of judgement.

This is what the Detective and Journalist roles are structurally for, and it is worth
recording that neither currently does it — both are flat-wage placeholders producing
resources (`leads`, `stories`) that nothing consumes. When those roles are given real
mechanics, the design target is not "detect the cheater" but **make acting on a pattern a
priced, uncertain bet**: the attacker knows it will work eventually, and cannot know whether
this attempt is the one that gets seen.

The unshipped pattern-based sabotage proposal is the right shape for this — many
individually-innocuous steps, only the accumulated pattern incriminating, a Detective
structurally necessary as counter-play. Its risk was never the patience it requires; it was
that it could be *aimed*. Priced-and-uncertain is the goal; aimed-and-reliable is not.

---

## The actual puzzle: coordination with strangers

*"How do I make plans with strangers who have imperfect information?"*

This is the load-bearing question, and the design answers it structurally rather than by
choice. A determined player **cannot execute anything ambitious alone**:

- No player can hold more than one role, so no individual controls a supply chain.
- Roles rotate by churn and conscription regardless of merit, so position cannot be held.
- Wealth buys nothing, so allies cannot simply be purchased.
- The grammar cannot express a plan, so allies cannot be *briefed* — only felt out.

Every one of those pushes toward the same requirement: **you need other people, and you
cannot instruct them.** That is the puzzle, and it is the game.

## Reputation is the coordination substrate, not a scoreboard

The stated solution — *"a puzzle you can only solve with reputation built on actions, not on
superiority"* — resolves what reputation is actually *for* in this design, which was
previously unspecified even though constraint 6 fixed its shape.

**Reputation is not a reward for winning. It is the mechanism that makes coordination with
strangers possible at all.** Under imperfect information and a grammar that cannot carry a
plan, the only basis for a stranger to act with you is what they have *witnessed you do*.

Two consequences follow directly, and both are already constraints:

- **Built on actions, not superiority.** Reputation must derive from publicly witnessed
  events — never from wealth, never from role held, never from rank. This is constraint 4's
  civic-memory line (public collectively-witnessed events may persist; private judgement may
  not) doing double duty as the *source* of reputation, and constraint 6's additive-only rule
  ensuring it cannot become a weapon.
- **It prices ambition rather than blocking it.** A player who needs allies must accumulate
  witnessed, verifiable action — which takes time, is visible while it happens, and cannot be
  faked or bought. That *is* the cost in "at what cost". It is also exactly the legacy the
  player asked to be remembered by.

### Being known is the benefit AND the risk — the mechanism that makes this self-limiting

User's closing point, and the keystone of the whole design: *"the biggest benefit is you are
just known everywhere, and also the biggest risk."*

**The risk is to the famous player themselves, not a risk they pose to everyone else.** This
matters and is easy to misread: "biggest risk" does not mean known players are dangerous to
the community and need checking. It means fame is a bet the player places *on themselves*.
Reading it the other way invites a mechanic that penalises the well-known — which would be
subtractive, would violate constraint 6, and would invert the design.

Reputation's payoff is that strangers will act with you without being briefed — which is the
only route to anything ambitious. Its cost, borne entirely by the person who earned it, is
that the same visibility makes them **legible**.
A known player cannot move quietly. Every pattern they run is watched by people who already
know to watch them, and every action they take is the kind that gets witnessed and
remembered.

**This is what makes containment intrinsic rather than bolted on.** The exact property that
enables coordination is the property that removes covertness. Ambition therefore pays twice:

1. **Time**, to accumulate witnessed action before anyone will coordinate with you.
2. **Obscurity**, permanently, the moment you have. You cannot spend reputation to become
   unknown again.

So the determined player faces a genuine bind rather than an artificial cap: *the reach
required to execute a plan is exactly the reach that makes the plan visible.* Nothing blocks
them. The cost is structural and self-inflicted, which is why it satisfies requirement 5
(priced, not blocked) without any punishment mechanic existing at all.

**Critically, this does not make reputation subtractive** — constraint 6 holds intact. What
a known player loses is **obscurity, not standing**. Their visibility and access only ever
increase; nothing is removed from them, no floor is lowered, no door closes. Obscurity was
never part of the protected baseline — constraint 6 guarantees a floor *of* visibility, so
becoming more visible moves with that guarantee rather than against it. A design that made
fame *reduce* anything would violate constraint 6 and should be rejected.

This also gives the two unbuilt roles their natural hook: a Journalist writes about who is
already known; a Detective watches who is already worth watching. Counter-play scales with
the target's own reach, which means it needs no arbitrary difficulty knob.

**Status: specified, unbuilt.** Constraints 4 and 6 fix the shape and the limits; the
sections above fix the purpose (coordination substrate), the source (witnessed action, never
superiority), and now the self-limiting mechanism (visibility as both payoff and exposure).
What remains is a mechanic. See `docs/RESEARCH_QUESTIONS.md` question 11.

---

## Uncertainty must be irreducible, and it must worry people differently

Two related positions (user, 2026-08-11): *"unpredictability happens to everyone — in other
games you can make it almost entirely deterministic if you're silly to think about it"*, and
*"I want power and grifters to worry about different things, depending on who they are."*

### Randomness is not uncertainty

A determined player models RNG out. Cadences get timed, distributions get sampled, hazards
get averaged — given enough patience, anything generated by a seed becomes a known quantity.
Randomness raises the cost of prediction; it does not create genuine uncertainty. So
scattering more RNG around is not the answer, and over-randomising is already listed as a
tripwire (it produces dice, not judgement).

**The only irreducible source of uncertainty in NODE is other people.** The grammar cannot
carry a plan, so an ally can never be *instructed* — only felt out and trusted. That means
every ambitious act depends on a stranger's unforced choice, which no amount of analysis
resolves. It is irreducible because it is not generated by the system at all.

This is worth stating because it inverts the obvious engineering instinct: the defence
against a calculating player is **not** more noise in the mechanics. It is that the mechanics
never supply a substitute for trusting somebody.

### The same axis, opposite fears

Risk should differ in *kind* by position, not merely in amount. The design already has one
axis that does this naturally — **being witnessed** — and the two ends fear opposite failures
of it:

| | The known player | The grifter |
|---|---|---|
| **Fears** | Being seen | Not being seen |
| **Because** | Every pattern is read by people already watching; covertness is unrecoverable | Without witnessed action there is no basis for a stranger to coordinate with them |
| **Their scarce resource** | Obscurity | Attention |
| **What time does to them** | Erodes it — reputation only accumulates | Erodes them — `daysAsGrifter` climbs with nothing to show for it |

Neither is a penalty applied by the system; both are consequences of where a player currently
stands on a single axis. That is what makes them feel different without being different rules.

### Reputation and diary decay in opposite directions — which is where the worries come from

The design already has **two** memory systems pointing opposite ways, and that asymmetry is
what makes different players worry about different things without any special-casing:

| | Reputation (civic memory) | Diary (personal memory) |
|---|---|---|
| **Visibility** | Public | Private to one owner, never leaks |
| **Over time** | Accumulates, permanent | Silently expires, per entry, on its own clock |
| **Status** | Specified, **unbuilt** | **Built** — `engine/privateStore.ts` |
| **Governed by** | Constraint 4 (civic memory is immortal) + constraint 6 (additive only) | Constraint 4 (personal memory is mortal) |

This is constraint 4's split doing real mechanical work rather than just settling a
philosophical question. And it produces the third distinct worry:

**The informed player's fear is expiry.** Private observations rot. You cannot bank
intelligence and cash it in later — an entry is silently gone at its TTL boundary, with no
fade and no warning. So the player who has *worked out what is going on* is racing a clock
that the famous player is not.

That is a direct, structural answer to the original exploit — *"I used information to know
what people were going to do before they decided amongst themselves."* Information advantage
in NODE is **perishable by construction**. Aggregating intel over months does not compound;
it evaporates behind you at the same rate you gather it. Use it or lose it, permanently.

Note the pleasing inversion: the two assets a determined player would most want to stockpile
behave oppositely. **Reputation cannot be spent** (you can't trade fame for obscurity), and
**intel cannot be saved** (you can't hold knowledge until the moment suits). Neither hoards.

### Finding the opportunity is its own worry

Opportunities are transient and contested, and now genuinely so: role vacancies open and
close on churn, sabotage windows are a hazard rather than a timetable, districts decline on
a smoothed signal, migration destinations shift as shards fill. Nothing waits.

That gives a fourth position with its own fear — not exposure, not expiry, but **timing**:
finding the opening while it is still open, and while whatever you know about it is still
alive in your diary. The two clocks interact, which is the interesting part: intel about an
opportunity ages at the same time the opportunity itself closes.

### The four worries, one mechanism

| Position | Scarce resource | Time does what to it | Fear |
|---|---|---|---|
| Known / high reputation | Obscurity | Erodes it — reputation only accumulates | Being seen |
| Informed / rich diary | Fresh intel | Expires it — per entry, silently | Acting too late |
| Grifter / roleless | Attention | Wastes it — `daysAsGrifter` climbs, nothing accrues | Not being seen |
| Opportunist | Open windows | Closes them | Missing it |

None of these are separate rule-sets. They are four positions on the same witness-and-memory
machinery, which is why the game can make very different players anxious about very different
things without fragmenting into special cases.

### There is no anonymous power — you have to hold a job

User's resolving point (2026-08-11): *"you still need a job... a role... so you can't be a
hidden prick."*

This is the load-bearing containment rule, and it is already true of the mechanics rather
than something to add. **Every form of leverage in NODE is attached to a role**, and a role is
a fixed, located, visible position: it occupies a specific building in a specific district,
its output is public (a Miller's supply sets the flour price everyone pays), and its
occupancy is legible to the whole shard through the vacancy system.

There is no mechanism anywhere that lets a player accumulate influence while remaining a
nobody. Wealth buys nothing. Sabotage cannot be aimed. The grammar cannot brief an ally. The
*only* route to mattering is to take a position that puts you in a building with your name
effectively on it.

So the scheming-from-the-shadows archetype is not blocked by a rule — it is **structurally
unavailable**, because the shadows contain no levers. To reach for power you must first
become findable, and having become findable you cannot go back (see the reputation section
above: obscurity is unrecoverable).

### Correcting an overstatement of mine

I previously flagged that grifters would be locked out of reputation entirely — "no role, no
witnessed action, no reputation, no route to a role except waiting to be drafted" — and
called it a structural underclass. **That was too strong**, and this point is why: the role
system *is* the ladder. Voluntary fills and conscription both move grifters into roles
routinely, measured at a ~22-day mean wait, and taking a role is precisely what makes a
player witnessable. The route exists and is well-trodden.

What survives of the concern is narrower and worth keeping: while roleless, **nothing
accrues**. `daysAsGrifter` climbs and yields nothing, so the ~100-day worst-case wait is dead
time in a way the mean is not. The requirement on a future reputation design is therefore not
"invent a way for grifters to build standing outside roles" but the softer **"do not let a
long wait erase someone's history"** — a player returning to a role after a long gap should
not be starting from zero on every axis at once. Note `RoleEconomicSlot.wealth` already
resets to 0 on every new occupancy, which is correct for wealth and would be wrong for
standing.

---

## Tripwires — the specific changes that would break containment

Containment currently rests on properties that are easy to remove by accident while building
something else. Each of these is individually reasonable-sounding and collectively fatal:

| Change | Why it breaks containment |
|---|---|
| **Making wealth spendable** on anything — role access, information, influence, protection | Converts an inert scoreboard into leverage, and hands victory to whoever accumulates longest. This is the single highest-risk change available. |
| **Making sabotage targetable** — attacker chooses the victim | Turns a weather event into a weapon. Directly contradicts "reputational, not destructive." Note the unshipped pattern-based sabotage proposal is explicitly described as *"genuinely achievable by a patient attacker"* — that is precisely this player, and shipping it with targeting would arm them. |
| **Allowing multiple role slots**, or tenure that resists churn/conscription | Lets positional power be hoarded instead of redistributed by time. |
| **Any subtractive reputation** — downvotes, blacklists, standing that can fall | Violates constraint 6, and hands the most persistent player a tool to bury others. |
| **Cross-shard persistent per-player scores** | Violates constraint 4 and lets a reputation built by grinding one shard be imported as power into a quiet one — the exact "outsider imposes their will" scenario. |
| **Reputation derived from wealth, rank, or role held** rather than witnessed action | Turns reputation into superiority, which is the specific thing requirement 6 excludes. Coordination would then be purchasable, and the puzzle disappears. |
| **Removing every pattern with randomness** | Overcorrection. Produces a game of dice instead of judgement, and leaves the Detective/Journalist roles nothing to contest. Patterns should be priced by counter-play, not erased. |
| **Any leverage that does not require holding a role** — anonymous influence, off-books deals, power that follows a player rather than a position | Reintroduces the hidden operator the whole design excludes. Power must stay attached to a located, visible, losable position. |
| **Standing that resets to zero on losing a role**, the way wealth does | Correct for wealth, wrong for reputation: it would make a long roleless spell erase a player's history and turn the ~100-day worst-case wait into a genuine caste trap. |

**Recommended standing rule:** treat containment as a property to be *re-verified* whenever
any of the above is touched, in the same way supply-chain coherence is re-verified after any
config change. Both are invisible to the metrics currently in the repo.

---

## What the simulation cannot tell us here

The model has no adversary in it. Every driver is a policy function, wealth buys nothing, and
sabotage is undirected — so **no amount of simulation will ever surface a domination
strategy**, because there is nothing in the model capable of pursuing one. The absence of
exploits in the sweeps is not evidence of their absence in a real game.

This is the same structural blindness noted in `RESEARCH_QUESTIONS.md`: the simulation models
compliance as certain. It cannot produce a player who quits, and it cannot produce a player
who schemes. Containment therefore has to be argued from mechanism — as above — and then
tested against real adversarial players, not against the harness.

**Partially closed 2026-08-12**, without touching the TypeScript engine — exactly because the
engine cannot model an adversary. A separate session ran standalone Python models of a
specific, competent, patient operator (drawn from a real historical case) against four open
questions from this document, and found four of five failure modes close on the constraints
already shipped; the fifth does not, and is resolved below. Full findings, all figures
provisional pending in-engine re-derivation: `docs/DESIGN_ADDENDUM_2026-08-12.md`.

### The open failure mode, and its resolution: naming is not recourse

The one mode that didn't close on analysis alone: a known player broadcasting a
pressure-skewed pattern of self-states on the Wall creates measurable ambient dread across
everyone who can hear it (2.5× the unease of the same posting pattern from an unknown player,
in the model) — and the obvious fix, having a Detective or Journalist *identify* the
broadcaster, was tested against the real historical case and found to make things **worse**,
not better: being named confirmed the threat and made the waiting worse, it didn't let anyone
organise. Identification alone amplifies; it does not defend.

The reason this matters for constraint 6 specifically: the tempting mechanic — a public
"pressure alert" that names a player — is a subtractive reputation mechanic wearing a safety
costume. It would let the population *punish* a player by identification even though nothing
about their in-game standing changed; that's a real-world social penalty riding on a
mechanical signal, and constraint 6 forbids exactly this shape of thing (the worst a group may
do is decline to elevate someone, never brand them). **Naming-as-defense was rejected on this
basis, not just because the model showed it backfiring.**

**Resolution, consistent with every standing constraint**: the detection signal is real
(§4 of the 08-12 addendum shows public Wall-post frequency and pressure-cluster skew is a
genuine, observable pattern, not currently read by anything) — but what it feeds is
**ambient, anonymous, mechanical, and already built**, not an accusation. It becomes a new
contributing source to District Weather's `tension` (`engine/districtWeather.ts`, shipped
2026-08-11, item 0/3), alongside the vacancy/consolidation/sabotage signals already there —
never naming a player, never touching anyone's reputation, purely "something is elevated
here." What the population does in response is exactly the lever §9 of the same addendum
already proved works mechanically: build trust links, which cut successful predation from 70%
to 25% in that model. The recourse is real and actionable — it just isn't an accusation.

This composes rather than invents:
- Reuses District Weather (item 0/3) as the delivery channel — "reused, not reinvented," the
  same discipline the diary-distortion proposal in the 08-12 addendum applies to `decay.ts`.
- Never violates constraint 4 (no private dossier travels — the signal is aggregate skew, not
  content, and the grammar already prevents any post from naming a third party at all).
- Never violates constraint 6 (nobody's reputation moves; nobody is identified).
- Gives calculating players a real, computable variable to react to — "calculable but not
  solvable," this document's own repeated standard — rather than nothing, and rather than a
  vigilante tool.

Detective and Journalist are the natural sensors for this (their item-4 completion task
today is an undifferentiated friction bar, flagged at the time as a placeholder pending a
real signal to detect) — see `engine/pressureDetection.ts` for the implementation.

---

## Why the floor serves the powerful player too

Closing statement from the same user, and the thesis the rest of this document is really
about (2026-08-11): *"Everyone in the war game knew I could kill them. But killing them took
away five years of work. Just knowing I can't take everything from you is the security you
don't have in other games — but you still know who I am, and that's enough. You don't have to
zero someone into quitting to get into their heads about who's actually running town."*

Three things follow, and they reframe every constraint above.

**1. Destructive power is self-consuming.** Exercising it destroys the thing that made it
worth having. Zeroing a player removes years of their investment — and simultaneously removes
them as an audience, a rival, a counterparty, and a witness. A dominator who succeeds
completely ends up running an empty town. Destruction is not merely harmful to the victim; it
is *strategically incoherent* for the dominator, and games that permit it force ambitious
players into a move that undoes their own position.

**2. The untouchable floor is what keeps the audience in the room.** Constraint 2 (no
permanent zero-state) and constraint 6 (reputation may only grant, never remove) are usually
read as protections *against* the powerful player. They are equally protections *for* them.
Because nobody can be zeroed, nobody has to flee — so the quiet shard stays populated, the
rivalries stay live, and there remains a town to be known in. **The floor is what makes
long-term dominance sustainable instead of terminal.**

**3. Being known is sufficient. It was always the actual goal.** "You still know who I am, and
that's enough" is the whole design in one line. What the ambitious player wants is not other
people's assets — it is to be the person everyone accounts for when they make plans. That is
achieved by presence and reputation, and it is achieved *better* when the town is full,
prosperous, and still watching.

So NODE does not remove the power fantasy; it removes the one expression of it that would
destroy the conditions for its own continuation. What is left — everyone knowing who is
actually running town, without anyone being driven out to prove it — is both the more
sustainable version and, by the user's own account, the more satisfying one.

This is why the design can be genuinely welcoming to the most adversarial player it can
imagine, rather than defending against them. **It is not asking them to want less. It is
removing the move that would cost them everything they actually want.**

---

## The deeper calculus — stability is the board, not the prize

Final statement of the design intent (user, 2026-08-11): *"If people need me to do something,
I'll figure it out to my reputational benefit by being a sneaky fucker and getting caught
less than I succeed. I have to work within the mathematics to make predictions. I can't
guarantee outcomes however — and that's where the deeper calculus comes into play. So players
like me can exist and enjoy the game whilst also being constrained by mechanically enforcing
figuring out everything with everything to near certainty. The balance must be stable to game
within it, for a different prize entirely."*

This reframes the entire body of work in this repo, so it is worth being explicit about.

### The economy is the board; reputation is the prize

Everything this project has stabilised — the market convergence, the population equilibrium,
the supply-chain coherence, the shard registry — is **not the game**. It is the *board the
game is played on*. Its job is to be **reliable enough to reason about**: a player must be
able to work out what flour will cost, when a slot is likely to open, what a district's
decline implies. If the economy wobbled unpredictably there would be no calculus to do, and
without a calculus there is no strategy, only noise.

So the long calibration effort was never chasing stability for its own sake. **A stable
economy is the precondition for a social game to be playable on top of it.** The prize being
competed for is not wealth — wealth buys nothing — it is standing, coordination, and being
the person everyone accounts for.

This also settles a tension left open earlier under "stability is the floor, not the goal":
the *economy* should be stable and predictable; the *social outcomes* must not be. Those are
different layers, and conflating them is what would produce either Farmville (both stable) or
noise (both random).

### Calculable, but not solvable

The precise target: a player should be able to **compute the odds and still not know the
answer.**

- **The mathematics must be legible.** Cournot best-response, Bertrand undercutting, the
  flour price curve, vacancy hazards, consolidation thresholds — all deterministic functions
  a player can learn and predict from. This is deliberate and should stay that way. A game
  that hides its economics from analysis just punishes the players who care most.
- **The outcomes must not be.** Prediction runs into other people: allies who cannot be
  briefed (the grammar carries no plans), intel that expires (the diary's TTL), witnesses who
  may or may not be present, opportunities that close. No amount of analysis collapses these,
  because they are not generated by the system.

**"Figuring out everything with everything to near certainty" must be mechanically
impossible** — not because information is hidden arbitrarily, but because the last mile of
any plan runs through people whose choices are genuinely theirs. Near-certainty is the
ceiling; certainty is unreachable. That is the constraint that lets a calculating player
enjoy the game rather than solve it and leave.

### The design target for counter-play: caught less than you succeed

*"Getting caught less than I succeed"* is a usable specification, and the first concrete
target the Detective and Journalist roles have had. Detection must sit in a band:

- **Too high** and scheming never pays, so the ambitious player has nothing to do — the
  failure mode already flagged as arguably worse than domination.
- **Too low** and it is a free win with no calculated risk, failing requirement 5.
- **Correct** is a rate at which a patient player succeeds *more often than they are caught*,
  while never being able to predict which attempt is the one that gets seen.

Note this is a ratio over a career, not a per-attempt probability — which is exactly why
the unshipped pattern-based sabotage proposal is the right shape: many individually
innocuous acts, only the accumulated pattern incriminating. Getting caught is then a cost
paid against a reputation that survives it, not an ejection from the game.

### What follows for anyone tuning this

1. **Keep the economics computable.** Do not add hidden modifiers or unlearnable rules to
   "increase mystery". The mystery lives in people, not in obscured arithmetic.
2. **Keep the social layer irreducible.** Never add a mechanic that lets a player *guarantee*
   another player's cooperation, or that substitutes for trusting somebody.
3. **Stability of the board is a means.** Judge a change by whether it makes the game more
   worth playing *within*, not by whether it makes the numbers calmer — see "stability is the
   floor, not the goal".
4. **The prize is a different currency entirely.** If a change makes wealth or position the
   win condition, it has replaced the game rather than balanced it.

---

## Summary

| Requirement | Status |
|---|---|
| Quiet places can't be steamrolled | **Holds** — wealth is inert, sabotage is undirected, roles rotate |
| Exploits are priced, not blocked | **Partial** — no free wins remain, but nothing yet makes an attempt a *calculated* bet, because Detective/Journalist have no mechanics |
| Ambition requires coordination | **Holds structurally** — one role each, no purchasable allies, no grammar for briefing them |
| No anonymous power | **Holds** — every lever is attached to a located, visible role; the shadows contain nothing to pull |
| Contained, not excluded | **Holds** — no bans, no exclusion; the floor is untouchable |
| Reach is reputational, not destructive | **Half-met** — destructive reach is genuinely absent; reputational reach does not exist yet |
| Remembered | **Unbuilt** — civic memory is specified (constraint 4) but no monuments/legacy system exists |
| Self-limiting rather than capped | **Specified, unbuilt** — visibility as both payoff and exposure means containment is intrinsic to the power, needing no punishment mechanic |
| Dominance without destruction | **Holds** — the floor keeps the town populated, so being known has somewhere to matter; zeroing people was never the win condition |

The containment is real. Some of it is deliberate and some of it is a happy consequence of
what remains unbuilt — which means it is fragile in a specific way: it degrades the moment
someone makes wealth useful or sabotage aimable, and neither change would look dangerous in
isolation.
