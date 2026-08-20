# Working on NODE — session rules

**Assumption is the mother of all fuck ups.** (2026-08-13, user directive.) Bring up real
issues when you find them — directly, with evidence, no hedging and no attitude about it —
but don't assert something you haven't actually checked, and don't hold up real work on a
question you could resolve yourself by reading the code or running it.

NODE is a persistent multiplayer social-economic game. The design source of truth is
`docs/NODE_Build_Brief_v1.pdf` — its §0 (design intent) and build order are load-bearing;
everything else in it is an explicitly revisable hypothesis. Read it before starting work
if you haven't already.

## Branch policy (2026-08-08, user directive — do not silently revert this)

**Work directly on `main`. Do not stage work on a side/feature branch waiting for a
separate merge approval.** Earlier sessions used a branch-then-PR-then-wait-for-approval
workflow; the user ended it explicitly: staging everything on a branch until someone
remembers to ask for a merge left `main` — the thing anyone actually looks at — silently
stale, over and over, and put the burden of noticing that on the user instead of on the
work itself. Commit and push to `main` as you go, the same discipline as pushing docs
"one at a time, not batched." If a specific task's own instructions say otherwise for
that run, that's a per-task override, not a reason to quietly resume the old default
next time.

## Documentation rules (mandatory every session, not optional polish)

This project carries four living documents. Update them as you go, not as an afterthought
at the very end — if the session is interrupted, the docs should still be current.

1. **Start by reading `docs/HANDOVER.md`.** It's the fast-orientation doc — current state,
   how to run things, what's next. Don't re-derive context that's already written down there.
2. **Log everything in `docs/DEVLOG.md` as you go, chronologically, newest entry on top.**
   Include failures and dead ends, not just what worked — a wrong assumption caught and
   reverted is exactly the kind of thing the next session needs to know about so it isn't
   repeated. One entry per session at minimum; more if the session covers distinct pieces
   of work worth separating.
3. **Keep `docs/BLUEPRINT.md` in sync with what's actually implemented**, not what's
   aspirational. **`BLUEPRINT.md` is a MAP, not a narrative** — constants, state shape, data
   flow, invariants, current values. It answers "what is it?" and nothing else. The reasoning
   and the reversals belong in `docs/BLUEPRINT_HISTORY.md` (the decision record) or the devlog;
   if you find yourself writing a date or the word "then" in the blueprint, it is going in the
   wrong file. If you build something that deviates from the brief, or resolve one of the
   brief's open questions (§7), record the decision and the reasoning there. If a mechanic
   doesn't hold up once built, say so in the blueprint and the devlog both — per the brief's
   own instructions, don't silently work around a rule that breaks.
4. **Rewrite `docs/HANDOVER.md` at the end of the session** so it accurately reflects the
   new current state — assume the next session has zero memory of this one.
5. **`README.md` must always reflect current system state** — it's the first thing anyone
   (human or agent) sees. Keep its Status section in sync with what's actually built and
   tested, not what's planned.

## Build order

Follow the brief's phase order (§0, §8): Phase 1 (economic core) before anything
player-facing, then the two-Baker-plus-rumour-mill MVP slice (§8) before full Phase 2–6
builds. Don't jump ahead to later phases' polish while an earlier phase's regression tests
(§1.4, §2.4) are unverified.

## Standing design constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md` §6)

Binding on everything built beyond the single-shard core, not just narrative — check new
work against these before shipping it, the same way the documentation rules above are
checked every session:

1. **Simulate before trusting, every time a mechanic gets new reach.** Population-check
   against a deterministic baseline before accepting a mechanic works, the same way the
   exit ticket gamble and the Phase 1 §1.4 findings were verified, not just derived.
2. **No permanent zero-state, at any scale.** Before shipping any new system, ask: does
   failure here ever produce a state nothing can recover from? If yes, it doesn't belong
   in this design — whether that's a player, a role-slot, or eventually a whole shard.
3. **Ask "does this need to be an agent" before building anything new.** Anything with
   behavior, motivation, or belief to infer is a deception surface. Minimize what's
   modelable, at every scale, by default — this is why the vacancy backstop and the Oracle
   are both mechanical, not behavioral.
4. **Personal memory is mortal; civic memory is immortal — and nothing in between gets
   invented.** (Rewritten 2026-08-08 to resolve a real contradiction — see
   `docs/BLUEPRINT.md`'s "Open deviations" for the full reasoning; do not silently
   re-read this as "nothing whatsoever persists," that reading is now wrong.) The test
   to apply: does this record capture an event the node collectively witnessed, or does
   it capture an individual's private expression or judgement? The first may persist —
   public, collectively-witnessed events (what happened in a node, monuments, the
   Wall's Emissive Soul, Ghost Shard missives) are civic memory, and the city is
   allowed to remember what it did. The second must not — anything one player privately
   holds about another (diary entries, what they heard, private impressions, proximity
   conversation) decays or expires; no private dossier ever persists, and no
   cross-session or cross-shard per-player trust score is ever built, full stop. Any
   future system touching player expression should be built so there's nothing captured
   in the first place where the *private* side of this line applies — this is why voice
   is a constrained grammar, not real audio, and why the diary uses a hard TTL rather
   than accumulating forever.
5. **Let outcomes be real, don't script them.** Shard death, rejuvenation, migration
   patterns, which shards thrive and which stay thin — none of it gets authored. The
   system's job is to make every outcome genuinely possible and consequence-bearing, then
   get out of the way.
6. **Reputation may only ever grant, never remove.** Every player holds an untouchable
   baseline of visibility and access earned simply by being present and doing their
   role day to day. Reputation sits *on top of* that baseline: it can unlock deeper
   visibility, standing, and access, but no accumulation of negative signal may ever
   push a player below the floor. The worst any group can do to a player is decline to
   elevate them — never bury them, never make them invisible, never lock them out. Any
   mechanic that subtracts from the baseline is out of scope by default, at any scale.
   (Added 2026-08-08 — no reputation system exists in code yet; this constrains it
   before anything gets built, not after. Composes directly with constraint 2 above [no
   permanent zero-state] — this is that principle applied specifically to social
   standing — and with constraint 3: exclusion is the failure mode this design is most
   exposed to, and a subtractive reputation system is structurally an exclusion engine.)

## Commands

```
npm install
npm test         # regression tests
npm run sim      # prints a stability-curve sweep to stdout
npm run typecheck
```
