# Working on NODE — session rules

NODE is a persistent multiplayer social-economic game. The design source of truth is
`docs/NODE_Build_Brief_v1.pdf` — its §0 (design intent) and build order are load-bearing;
everything else in it is an explicitly revisable hypothesis. Read it before starting work
if you haven't already.

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
   aspirational. If you build something that deviates from the brief, or resolve one of the
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

## Commands

```
npm install
npm test         # regression tests
npm run sim      # prints a stability-curve sweep to stdout
npm run typecheck
```
