# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players, no combat — tension comes
from asymmetric information and structural economic pressure. Platform: **PC + mobile,
client in Godot 4**, server authoritative in TypeScript/Node (decided 2026-08-06). Full
spec: `docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything; it's the one
part of the brief that isn't up for revision.

## Current state (as of 2026-08-06)

**Phase 1 (economic core, now with a fixed price-drift bug) and the §8 MVP mechanic
(two Bakers + rumour mill) are built and tested. A client/server scaffold exists and
proves the wire-up, but the Godot client itself is unverified — no Godot binary in this
environment, so it's never actually been opened.**

```
npm install
npm test         # 24 tests, all passing
npm run sim      # Phase 1 stability-curve sweep to stdout
npm run mvp      # two-Baker + rumour-mill scenario, CLI, prints day-by-day output
npm run server   # WebSocket server broadcasting the MVP scenario live (npm run server)
npm run typecheck
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ locally and run the main scene. **This has not been verified by anyone yet
— do that and report back**, especially if the editor throws a parse error on first load.

Working branch: `claude/new-project-setup-h5m6f8`. No PR open yet (about to be created).
No CI configured.

See `docs/BLUEPRINT.md` for the architecture in detail, including the wire protocol
between server and client.

## What's next

**Immediate: verify the Godot client actually runs.** Everything past this point assumes
it does, or gets fixed once someone reports what broke.

Then, roughly in order:

- **Real Phase 4 rendering.** The current client is plain Labels/RichTextLabel — proves
  the network works, isn't the isometric camera/ambient colour/fog-of-recognition system
  the brief describes. Doesn't need to be built all at once; start with something that
  makes Wall posts/rumours spatially legible, not just textually.
- **Phase 2 (vacancy/churn/backstop)** — turns "a player quit" into visible pressure.
  Wanted once there's a real client and more than a handful of players, not before.
- **Phase 5 (voice/safety) scaffolding** — architecture only, no enforcement policy
  specifics, until a lawyer reviews retention/consent/GDPR posture. Hard gate, not caution.

No more open forks on par with "browser vs. native" or "which engine" right now — those
got resolved this session. Ruin Floor and the rest of brief §7 will surface concretely
once Phase 2 exists; don't invent answers before then.

## Things to know before you touch this

- **The Baker price equation is NOT the brief's literal §1.3 equation anymore.** Found
  and fixed a real bug this session: the brief's `+ cost_pressure * 0.1` term has no
  restoring force, so it's an unconditional daily drift that saturates both bakers at the
  2.0 price ceiling by ~day 100 of a long run. Replaced with a mean-reversion term toward
  a flour-cost anchor (`src/engine/bakers.ts`, fully explained there and in
  `docs/BLUEPRINT.md`'s "Open deviations"). Verified this doesn't change the §1.4 spread
  findings — it's mathematically designed not to, and that was checked, not assumed.
- **Noise magnitude in the Phase 1 market equations is a filled-in gap, not a brief
  spec.** Gaussian, sigma=0.01 by default (`DEFAULT_NOISE_SIGMA` in `src/sim/harness.ts`).
  The MVP scenario uses a louder sigma=0.02 for demo liveliness — a demo-script choice,
  not a change to the tuned engine default.
- **`stepMillers`/`stepBakers` throw below n=2** — intentional, not a bug to guard away.
- **The Wall-post trigger rule in `src/mvp/scenario.ts` is scaffolding**, not a designed
  mechanic. Don't extend it as if it were real game design without checking first.
- **The Godot client is unverified.** One likely bug already fixed from careful reading
  (GDScript's `JSON.parse_string` returns floats for all JSON numbers, so `int`-typed
  fields needed explicit casts) — there could be others that only a real editor run
  would surface. Treat anything client-side as "probably right, not confirmed."
- **The brief's §7 list of explicitly-unresolved questions is still fully open** — Ruin
  Floor, density numbers, identity resolution mode, colour palette, ripple decay-weight,
  Wall/ambient integration, all of §5.2's legal specifics. Flag concretely when one
  actually blocks something, get a concrete answer, keep moving — don't stall asking
  about things that aren't blocking yet (this is the working process the user set this
  session, not just the brief's own §9 instruction).

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current. When pushing
multiple doc updates, push them one at a time, not batched — this is the user's stated
preference as of this session.
