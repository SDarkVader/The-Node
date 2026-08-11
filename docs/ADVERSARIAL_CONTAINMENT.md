# Adversarial containment — what actually stops one player taking everything

**The design position this documents** (user-stated, 2026-08-11): *"If you live in a quiet
little area and a fucker like me decides to impose their will upon you, then I have to make
it damn near impossible. But still remember players like me need boundaries — because let
loose, I'll find a way to take everything you have, no matter how long it takes. So the game
has to contain me but still accept I'm always there. My reach is reputational, not
destructive. I'd be remembered for a different reason."*

Four requirements, in tension with each other:
1. A quiet place cannot be steamrolled by a determined outsider.
2. The determined player is **contained**, not excluded — they belong here.
3. Their reach is **reputational**, not destructive.
4. They are **remembered** — the point is legacy, not erasure.

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
| Contained, not excluded | **Holds** — no bans, no exclusion; the floor is untouchable |
| Reach is reputational, not destructive | **Half-met** — destructive reach is genuinely absent; reputational reach does not exist yet |
| Remembered | **Unbuilt** — civic memory is specified (constraint 4) but no monuments/legacy system exists |

The containment is real. Some of it is deliberate and some of it is a happy consequence of
what remains unbuilt — which means it is fragile in a specific way: it degrades the moment
someone makes wealth useful or sabotage aimable, and neither change would look dangerous in
isolation.
