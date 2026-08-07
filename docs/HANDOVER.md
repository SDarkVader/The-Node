# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players, no combat — tension comes
from asymmetric information and structural economic pressure. Platform: **PC + mobile,
client in Godot 4**, server authoritative in TypeScript/Node (decided 2026-08-06). Full
spec: `docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything; it's the one
part of the brief that isn't up for revision. Also read `CLAUDE.md`'s "Standing design
constraints" — five binding rules (simulate before trusting, no permanent zero-state at
any scale, minimize what's modelable, nothing gets recorded ever, let outcomes be real)
that apply to everything built from here on.

## Current state (as of 2026-08-07)

**Phase 1 (economic core) and Phase 2 (vacancy engine core) are built and tested. The
§8 MVP mechanic (two Bakers + rumour mill) is built and tested. A client/server scaffold
exists and proves the wire-up, but the Godot client itself is unverified** — no Godot
binary in this environment, so it's never actually been opened.

```
npm install
npm test          # 38 tests, all passing
npm run sim        # Phase 1 stability-curve sweep to stdout
npm run vacancy-sim # Phase 2 vacancy sweep to stdout (N=50/60/80)
npm run mvp        # two-Baker + rumour-mill scenario, CLI, prints day-by-day output
npm run server     # WebSocket server broadcasting the MVP scenario live
npm run typecheck
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ locally and run the main scene. **This has not been verified by anyone yet
— do that and report back**, especially if the editor throws a parse error on first load.

Working branch: `claude/new-project-setup-h5m6f8`, kept in sync with `main`. No CI
configured. See `docs/BLUEPRINT.md` for full architecture detail.

## What's next

**Two things still need your input, carried over from earlier — neither blocks other work:**

1. **Verify the Godot client actually runs.**
2. **Confirm the exit-ticket gamble stake-formula fix** (`docs/DESIGN_ADDENDUM_2026-08-06.md`'s
   top note) — verified numerically, not applied to `design/exit_ticket_gamble_sim.py` yet.

**Phase 2's §2.4 ratio mismatch is now understood, not just flagged.** It was mostly a
metric-definition bug (backstop-recovery fills were being counted as if they were
alternatives to backstop, when they're consequences of it) — fixing that alone moved the
N=50 ratio from 2.48 to 1.48 against a brief target of 1.2. The remaining gap is a real
design question, not a bug: closing it fully requires the BACKSTOPPED recovery hazard to
be very low (~2000-day mean recovery), which reproduces the brief's two headline numbers
but means role-slots spend 79-86% of all time NPC-run rather than player-run — in real
tension with the brief's premise of a player-driven economy. **This needs your call**:
either accept a slower/rarer recovery rate (and the NPC-dominance that implies), or
decide the brief's exact §2.4 numbers aren't the target to hit and keep the current
faster-recovery default. See `docs/BLUEPRINT.md`'s "Open deviations" (2026-08-07
follow-up) and this date's `DEVLOG.md` entry for the full numeric trail — `npm run
vacancy-sim` reproduces it directly, both settings side by side.

Roughly in order from here:

- **Wire Phase 2 into the Phase 1 market.** Right now `src/engine/vacancy.ts` and the
  Baker/Miller engine are separate, unconnected systems — a BACKSTOPPED slot doesn't
  actually participate in pricing yet. Needs a real player/NPC-agent concept in the
  market layer that doesn't exist yet.
- **§2.6 Shift Cover** (offline players' pre-set prices) — needs a player-session/
  online-state concept this headless engine doesn't have. Natural to build alongside
  whatever session/auth layer comes with a real client.
- **Real Phase 4 rendering.** The current client is plain Labels/RichTextLabel — proves
  the network works, isn't the isometric camera/ambient colour/fog-of-recognition system
  the brief describes.
- **Phase 5 (voice/safety) scaffolding** — architecture only, no enforcement policy
  specifics, until a lawyer reviews retention/consent/GDPR posture. Hard gate, not
  caution. Consider building proximity conversation (`docs/DESIGN_ADDENDUM_2026-08-06.md`)
  alongside this — it may substantially shrink what Phase 5 even needs to cover, since it
  never captures audio at all.

Also worth reading before any of the above: `docs/ECOSYSTEM_VISION_2026-08-06.md` (what
NODE looks like as many shards, not one — shape-only, no mechanics to build yet) and the
private diary refinement in the design addendum (composed slots, unprompted, ~30-day
rolling silent expiry — locked design, not yet built in code).

## Things to know before you touch this

- **The Baker price equation is NOT the brief's literal §1.3 equation.** Fixed a real
  drift bug (`src/engine/bakers.ts`, explained there and in `BLUEPRINT.md`'s "Open
  deviations") — mean-reversion toward a flour-cost anchor instead of the brief's
  unconditional additive term. Verified not to change the §1.4 spread findings.
- **Phase 2's calibrated constants (`beta=0.0008` etc.) don't reproduce the brief's §2.4
  targets** — see "What's next" above. The equations are implemented verbatim; the
  discrepancy is in the aggregate outcome, not a transcription error (checked).
  `src/engine/vacancy.ts` also has a genuine interpretive gap-fill (BACKSTOPPED->FILLED
  recovery rate) the brief never specifies — documented inline and in BLUEPRINT.md.
- **Noise magnitude in the Phase 1 market equations is a filled-in gap, not a brief
  spec.** Gaussian, sigma=0.01 by default (`DEFAULT_NOISE_SIGMA` in `src/sim/harness.ts`).
- **`stepMillers`/`stepBakers` throw below n=2** — intentional, not a bug to guard away.
- **The Wall-post trigger rule in `src/mvp/scenario.ts` is scaffolding**, not a designed
  mechanic. Don't extend it as if it were real game design without checking first.
- **The Godot client is unverified.** One likely bug already fixed from careful reading
  (GDScript's `JSON.parse_string` returns floats for all JSON numbers, so `int`-typed
  fields needed explicit casts) — there could be others only a real editor run would
  surface.
- **The private diary is NOT part of the "signal decays with distance" family**
  (`src/comms/decay.ts`, shared by the rumour mill, and design-only so far for proximity
  conversation and shard-graph distance). The diary uses hard silent TTL expiry — no
  gradual fade. Don't retrofit it onto `decay.ts` without checking first; that was
  explicitly rejected in favor of a hard cutoff.
- **The brief's §7 list of explicitly-unresolved questions is still fully open** — Ruin
  Floor, density numbers, identity resolution mode, colour palette, ripple decay-weight,
  Wall/ambient integration, all of §5.2's legal specifics. Flag concretely when one
  actually blocks something, get a concrete answer, keep moving — don't stall asking
  about things that aren't blocking yet.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current. Push doc
updates one at a time, not batched. `CLAUDE.md` also carries five standing design
constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md`) binding on all future work —
check new work against them the same way, every session.
