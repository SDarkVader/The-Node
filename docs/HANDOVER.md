# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players, no combat — tension comes
from asymmetric information and structural economic pressure. Full spec:
`docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything; it's the one part of
the brief that isn't up for revision.

## Current state (as of 2026-08-06)

**Phase 1 (economic core) is built and tested. The §8 MVP mechanic — two Bakers plus a
working rumour mill — is also built and tested, headless.** No server, no client, no
persistence, no rendering. Everything runs as a CLI scenario or a test suite.

```
npm install
npm test         # 21 tests, all passing (10 Phase 1 + 5 grammar + 6 rumour mill)
npm run sim      # Phase 1 stability-curve sweep to stdout
npm run mvp      # the two-Baker + rumour-mill scenario, prints day-by-day output
npm run typecheck
```

Working branch: `claude/new-project-setup-h5m6f8`. No PR open (not requested). No CI
configured yet.

What's real and provable right now: the economic engine matches the brief's validated
stability findings (§1.4), and the grammar-constrained Wall/Envelope + rumour mill
pipeline runs end-to-end against that engine — a price shock triggers a Wall post,
which propagates through connected players, decaying and sometimes distorting.
See `docs/BLUEPRINT.md` for the architecture in detail.

## What's next — the real fork

**The MVP mechanic is proven; it isn't playable by anyone but this CLI.** The next
decision is genuinely consequential and hasn't been made: what's the actual playable
surface? Concretely, this needs the user's input on:

- Browser client vs. something else — the brief's Phase 4 camera model (§4.1, isometric,
  smooth zoom) reads as browser/desktop-app-shaped, but that's an inference, not a
  decision that's been confirmed.
- Hosting/deployment target, and whether there's a real-time server yet (WebSocket vs.
  polling vs. something else) or whether the next step is still local/single-process.
- Persistence — right now everything is in-memory and ephemeral by construction (no
  Phase 2 vacancy/churn system exists yet either, which would need some persistence).

Don't guess on this one — it's expensive to reverse, unlike the noise-magnitude and
rumour-mill-parameter gaps, which were filled in and documented rather than asked about
because they're cheap to retune later.

Once that's answered, remaining work toward a real playable slice:

- Phase 4: enough rendering to make Wall posts/rumours legible to an actual player
  (doesn't need the full camera/fog-of-recognition system — that matters once there's a
  real population where anonymity is meaningful; with 2-5 named players it isn't yet).
- Phase 2 (vacancy/churn/backstop) — not needed for the MVP per §8, but is what makes
  "a player quit" become visible economic/social pressure; likely wanted once there's a
  real client and more than a handful of players.
- Phase 5 (voice/safety) — explicitly scaffolding-only until a lawyer reviews retention/
  consent/GDPR posture; don't build enforcement policy specifics without that.

## Things to know before you touch this

- **Noise magnitude in the Phase 1 market equations is a filled-in gap, not a brief
  spec.** Gaussian, sigma=0.01 by default (`DEFAULT_NOISE_SIGMA` in `src/sim/harness.ts`).
  The MVP scenario (`src/mvp/run.ts`) uses a louder sigma=0.02 for demo liveliness —
  that's a demo-script choice, not a change to the tuned engine default.
- **`stepMillers`/`stepBakers` throw below n=2** — intentional, not a bug to guard away.
- **The Wall-post trigger rule in `src/mvp/run.ts` is scaffolding**, not a designed
  mechanic. It exists to exercise the grammar+rumour pipeline end-to-end. Don't extend it
  as if it were real game design without checking with the user first.
- **The brief's §7 list of explicitly-unresolved questions is still fully open** — Ruin
  Floor, density numbers, identity resolution mode, colour palette, ripple decay-weight,
  Wall/ambient integration, all of §5.2's legal specifics. Flag, don't invent, per the
  brief's own §9 instruction — but per the user's direction this session, flag concretely
  and keep moving once they answer; don't stall waiting to ask about things that aren't
  blocking yet.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current.
