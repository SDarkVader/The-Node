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

### The trap this exposes — flag before building reputation

If reputation is built on **witnessed action**, and only role-holders act visibly, then
grifters have no route onto the ladder at all: no role → no witnessed action → no reputation
→ no coordination → no route to a role except waiting to be drafted. That is a **structural
underclass**, and it would violate constraint 2 in spirit even while every individual
mechanic respects the letter (their income floor stays positive the whole time).

Today grifters have `daysAsGrifter` accumulating and nothing accruing from it. A reputation
system keyed purely to role activity would harden that into permanence.

**Requirement for any reputation design:** a roleless player must have *some* way to
accumulate witnessed action. Waiting must not be the only thing they can do, and time spent
roleless must not be dead time. What that mechanism is remains open — but a design that
cannot answer it should be rejected, because it converts a temporary position into a caste.

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
| **Reputation accruing only from role activity** | Locks grifters out of the only ladder — no role, no witnessed action, no coordination, no route to a role. Converts a temporary position into a caste and violates constraint 2 in spirit. |

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

---

## Summary

| Requirement | Status |
|---|---|
| Quiet places can't be steamrolled | **Holds** — wealth is inert, sabotage is undirected, roles rotate |
| Exploits are priced, not blocked | **Partial** — no free wins remain, but nothing yet makes an attempt a *calculated* bet, because Detective/Journalist have no mechanics |
| Ambition requires coordination | **Holds structurally** — one role each, no purchasable allies, no grammar for briefing them |
| Contained, not excluded | **Holds** — no bans, no exclusion; the floor is untouchable |
| Reach is reputational, not destructive | **Half-met** — destructive reach is genuinely absent; reputational reach does not exist yet |
| Remembered | **Unbuilt** — civic memory is specified (constraint 4) but no monuments/legacy system exists |
| Self-limiting rather than capped | **Specified, unbuilt** — visibility as both payoff and exposure means containment is intrinsic to the power, needing no punishment mechanic |

The containment is real. Some of it is deliberate and some of it is a happy consequence of
what remains unbuilt — which means it is fragile in a specific way: it degrades the moment
someone makes wealth useful or sabotage aimable, and neither change would look dangerous in
isolation.
