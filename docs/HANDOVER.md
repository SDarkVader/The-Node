# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players, no combat — tension comes
from asymmetric information and structural economic pressure. Full spec:
`docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything; it's the one part of
the brief that isn't up for revision.

## Current state (as of 2026-08-06)

**Built and tested: Phase 1, the economic core only.** A chained Cournot (Miller) →
Bertrand (Baker) market, headless, no player-facing anything yet — no server, no client,
no persistence layer. See `docs/BLUEPRINT.md` for the architecture in detail.

```
npm install
npm test         # 10 regression tests, all passing — encodes brief §1.4's findings
npm run sim      # stability-curve sweep table to stdout
npm run typecheck
```

Working branch: `claude/new-project-setup-h5m6f8`. No PR open (not requested). No CI
configured yet.

## What's next

Per the brief's §8, the next milestone is the **minimum viable prototype: two Bakers plus
a working rumour mill.** That needs, at minimum:

- A slice of **Phase 3** (§3): the Wall + Envelope grammar constraint, and a first pass at
  the rumour mill (explicitly under-specified in the brief — build it iteratively, not
  from a rigid spec, per §3.2).
- Enough of **Phase 4** (§4) to make interactions visually legible — the brief allows
  skipping full camera/identity/ambient systems for the MVP, but *some* rendering is
  needed for "two bakers plus a rumour mill" to be a playable slice at all.
- The MVP explicitly does **not** need Phase 2's vacancy math, Phase 5's voice system, or
  Phase 6's full harness — those follow once the core loop is proven fun and legible.
- Can use a **hardcoded/placeholder flour price** instead of the full Miller layer if
  that's faster to stand up (brief's own suggestion, §8) — the real Miller layer already
  exists in `src/engine/millers.ts` if not needed yet.

No tech-stack decisions are open for this next slice — TypeScript/Node was chosen in the
Phase 1 session specifically so the engine, a future realtime server, and a future web
client (likely Pixi.js/Three.js for the isometric renderer per §4.1) share one language.
Client/rendering framework choice for Phase 4 is NOT yet decided and should be asked about
before committing to one.

## Things to know before you touch this

- **Noise magnitude in the market equations is a filled-in gap, not a brief spec.** The
  brief says `+ noise` with no magnitude. Currently gaussian, sigma=0.01, in
  `DEFAULT_NOISE_SIGMA` (`src/sim/harness.ts`). Fine to retune; see `BLUEPRINT.md`.
- **`stepMillers`/`stepBakers` throw below n=2** — this is intentional (the brief's own
  math divides by n-1), not a bug to "fix" with a guard clause.
- **The brief's §7 list of explicitly-unresolved questions is still fully open** — Ruin
  Floor, density numbers, identity resolution mode, colour palette, ripple decay-weight,
  Wall/ambient integration, all of §5.2's legal specifics. Don't invent answers to these;
  flag back to the user per the brief's own instruction (§9).

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current.
