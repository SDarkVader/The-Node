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

**Phase 1 (economic core) and Phase 2 (vacancy engine, now hitting the brief's own §2.4
targets, plus Miller conscription) are built and tested. The §8 MVP mechanic (two Bakers
+ rumour mill) is built and tested. The client/server scaffold now has real per-player
targeted delivery, not pure broadcast, and the Godot client is now genuinely verified**
(2026-08-07, headless against a real Godot 4.3 engine and a real running server — see
"Things to know" below) — the one narrower gap left is the GUI editor experience
specifically, since a headless run can't confirm that.

```
npm install
npm test              # 58 tests, all passing
npm run sim            # Phase 1 stability-curve sweep to stdout
npm run vacancy-sim     # Phase 2 vacancy sweep to stdout (N=50/60/80)
npm run conscription-sim # Miller conscription sweep (delay x N)
npm run mvp            # two-Baker + rumour-mill scenario, CLI, prints day-by-day output
npm run server         # WebSocket server broadcasting the MVP scenario live
npm run typecheck
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ locally and run the main scene (set the `player_id` export on Main.gd to
`wren`/`sable`/`idris` to see targeted rumours arrive for that identity specifically).
**Still worth someone opening it in a real editor** — the headless run confirms the wire
protocol, connection string, and script logic are all correct, but says nothing about
the actual GUI experience (does the scene open cleanly, any editor-only warnings, what it
looks like).

Working branch: `claude/new-project-setup-h5m6f8`, kept in sync with `main` via PR (most
recently PR #5, merged 2026-08-07). No CI configured. See `docs/BLUEPRINT.md` for full
architecture detail.

## What's next

**Both longstanding "needs your input" carried-over items are now closed.** The Godot
client is verified (2026-08-07, headless — see "Things to know" below; a real editor
open/report is still worthwhile but no longer a blocking unknown). The exit-ticket
gamble's stake-formula fix is moot — that mechanic is superseded, see below.

**Identity & targeted networking are now built** (2026-08-07, see
`docs/BLUEPRINT.md`'s "Architecture scoped ahead of schedule" — scoped first in writing,
then built once confirmed). `src/engine/player.ts` (PlayerId, binary `isKnown()`) and
`src/engine/privateStore.ts` (generic private state with silent rolling TTL expiry) are
the two new primitives; `src/server/ws.ts` now sends rumours only to the connection
identified as their `heardBy`, fixing a real leak — the old broadcast protocol sent every
player's rumour data to every connected client regardless of who they were. This unblocks
(doesn't yet build) the private diary, proximity conversation's REFERENT slot, and the
Oracle's per-player draw state — all of those still need their own design/build passes,
this only removed the architectural blocker underneath them. `test/ws.integration.test.ts`
verifies the fix against an independently-computed ground truth, not just a type-check.

**Phase 2's §2.4 targets are fully resolved — both the ratio and the starved
fraction.** Two separate fixes stacked to get here:

1. **Miller conscription** (2026-08-07) — NPC coverage of a BACKSTOPPED Miller slot is
   temporary only; past a fixed delay, a real player is mandatorily conscripted, from the
   gossip layer or from an existing holder of a different role (cascading a real vacancy
   there). Fixed the earlier NPC-dominance tradeoff (recovery-hazard-only would have
   needed Miller NPC-run 79-86% of the time to hit the ratio target).
2. **Joint (beta, t_hard) recalibration** (2026-08-07) — proved the brief's own two §2.4
   numbers (ratio ~1.2:1 at N=50, starved fraction 1-2%) are mathematically incompatible
   at the brief's literal `t_hard=14`, for any beta — a hazard-function-independent bound,
   not a guess. A joint grid search found `beta=0.03, t_hard=3` hits both simultaneously
   across N=50/60/80, with BACKSTOPPED time landing *lower* than before (0.2-0.4%), not a
   repeat of the NPC-dominance tradeoff. Now the default in `src/sim/vacancyHarness.ts`
   (`DEFAULTS`, shared by `conscriptionHarness.ts`).

Both mechanisms compose: conscription still governs Miller's post-backstop phase; the
recalibration fixed the pre-backstop VACANT phase conscription never touched. See
`docs/BLUEPRINT.md`'s "Open deviations" for the full numeric trail on both, `npm run
vacancy-sim` / `npm run conscription-sim` to reproduce.

**Still open from this:** exact conscription delay (every value tried keeps the ratio on
target, so it's a pacing/feel decision, not a number the simulation resolves for you),
and whether any role besides Miller needs conscription.

**The exit-ticket gamble is superseded (2026-08-07) — postcard/tier system.**
`docs/DESIGN_ADDENDUM_2026-08-06.md`'s single-variable stake formula (and its unresolved
stake-direction bug) no longer needs fixing — it's replaced entirely by
`docs/DESIGN_ADDENDUM_2026-08-07.md`'s tiered postcard-fusion mechanic (5 tiers,
War-and-Order-style fusion with a Rise-of-Kingdoms-style passive accrual floor).
Independently verified, not just simulated once and trusted: the deterministic safe-path
baseline checks out by closed-form math (39.06 days at the illustrative 2.0/hr rate,
matching the addendum's stated "40"), and the gambling-strategy population table was
re-run with a fresh Monte Carlo (`design/postcard_tier_verify.py`) that reproduces every
reported number within normal sampling noise across multiple seeds. Still `[DESIGN — not
yet built]` — this is a design addendum, not code, same as the diary/Oracle/proximity
conversation. `design/exit_ticket_gamble_sim.py` (the old, buggy model) is kept for the
record, not deleted.

Roughly in order from here:

- **Wire Phase 2 (vacancy + conscription) into the Phase 1 market.** Right now
  `src/engine/vacancy.ts`/`conscriptionHarness.ts` and the Baker/Miller engine are
  separate, unconnected systems — a BACKSTOPPED or conscripted Miller doesn't actually
  participate in pricing yet. `src/engine/player.ts`'s `PlayerId` exists now as a
  building block, but the market layer doesn't reference it yet — still needs real wiring.
- **§2.6 Shift Cover** (offline players' pre-set prices) — needs online/offline session
  state, which `player.ts` doesn't track yet (it's just an id, not a session). Natural to
  build alongside whatever real auth layer comes with a real client.
- **Real Phase 4 rendering.** The current client is plain Labels/RichTextLabel — proves
  the network works, isn't the isometric camera/ambient colour/fog-of-recognition system
  the brief describes.
- **Phase 5 (voice/safety) scaffolding** — architecture only, no enforcement policy
  specifics, until a lawyer reviews retention/consent/GDPR posture. Hard gate, not
  caution. Consider building proximity conversation (`docs/DESIGN_ADDENDUM_2026-08-06.md`)
  alongside this — it may substantially shrink what Phase 5 even needs to cover, since it
  never captures audio at all.

Also worth reading before any of the above: `docs/ECOSYSTEM_VISION_2026-08-06.md` (what
NODE looks like as many shards, not one — shape-only, no mechanics to build yet), the
private diary refinement in `DESIGN_ADDENDUM_2026-08-06.md` (composed slots, unprompted,
~30-day rolling silent expiry — locked design, not yet built in code), and
`DESIGN_ADDENDUM_2026-08-07.md`'s organic shard-opening (§7) — notes it reuses the
existing vacancy-backstop pattern at the shard level rather than needing a new primitive,
worth reading before the market-wiring or multi-shard work above.

## Things to know before you touch this

- **The Baker price equation is NOT the brief's literal §1.3 equation.** Fixed a real
  drift bug (`src/engine/bakers.ts`, explained there and in `BLUEPRINT.md`'s "Open
  deviations") — mean-reversion toward a flour-cost anchor instead of the brief's
  unconditional additive term. Verified not to change the §1.4 spread findings.
- **Phase 2's beta/t_hard are recalibrated, not the brief's literal values.**
  `beta=0.03, tHard=3` (`DEFAULTS` in `src/sim/vacancyHarness.ts`, shared by
  `conscriptionHarness.ts`) replace the brief's provisional `beta=0.0008, tHard=14` — a
  proven bound shows those two literal values can't hit the brief's own §2.4 targets
  simultaneously at any beta. Full derivation and grid-search trail in `BLUEPRINT.md`'s
  "Open deviations." The original ratio mismatch was *also* partly a metric bug (fixed
  separately): `voluntaryFills` originally summed genuine pre-backstop fills together
  with backstop-recovery fills, inflating the ratio by roughly +1 — now split into
  `genuineVoluntaryFills`/`backstopRecoveries`; use the genuine count when comparing
  against the brief's ratio. `src/engine/vacancy.ts` still has an interpretive gap-fill
  for non-Miller roles' BACKSTOPPED->FILLED recovery (the brief never specifies it) —
  documented inline and in BLUEPRINT.md, unaffected by conscription since conscription
  only applies to Miller.
- **Noise magnitude in the Phase 1 market equations is a filled-in gap, not a brief
  spec.** Gaussian, sigma=0.01 by default (`DEFAULT_NOISE_SIGMA` in `src/sim/harness.ts`).
- **`stepMillers`/`stepBakers` throw below n=2** — intentional, not a bug to guard away.
- **The Wall-post trigger rule in `src/mvp/scenario.ts` is scaffolding**, not a designed
  mechanic. Don't extend it as if it were real game design without checking first.
- **The Godot client is verified headless (2026-08-07), not yet in a real GUI editor.**
  Downloaded Godot 4.3 directly and ran the actual client project in `--headless` mode
  against a real `npm run server` instance — confirmed it connects, receives broadcast
  ticks, and receives targeted rumours with correct fields, no errors or warnings. Found
  and fixed one real bug this way: `WebSocketPeer.connect_to_url()` rejects a bare
  `host:port?query` URL (needs an explicit `/` before the query string) — the server side
  and every `ws`-based test were correct throughout, only the client's own connection
  string was wrong. The `JSON.parse_string`-returns-floats gotcha (explicit `int(...)`
  casts on `day`/`hop`) was also re-exercised live this run, not just reasoned about.
  What's still unconfirmed: the actual GUI editor experience specifically (scene-open
  warnings, visual layout) — narrower than before, not closed.
- **The private diary is NOT part of the "signal decays with distance" family**
  (`src/comms/decay.ts`, shared by the rumour mill, and design-only so far for proximity
  conversation and shard-graph distance). The diary uses hard silent TTL expiry — no
  gradual fade. Don't retrofit it onto `decay.ts` without checking first; that was
  explicitly rejected in favor of a hard cutoff.
- **Most of the brief's §7 list of explicitly-unresolved questions is still open** — Ruin
  Floor, density numbers, colour palette, ripple decay-weight, Wall/ambient integration,
  all of §5.2's legal specifics. Flag concretely when one actually blocks something, get
  a concrete answer, keep moving — don't stall asking about things that aren't blocking
  yet. **Identity resolution mode is the one exception** — scoped to binary for v1
  (`src/engine/player.ts`'s `isKnown()`), forced by the private diary's SUBJECT slot. See
  BLUEPRINT.md's "Architecture scoped ahead of schedule" for why binary was chosen over
  gradual.
- **`src/server/ws.ts`'s wire protocol changed shape (2026-08-07).** Rumours no longer
  ride inside the broadcast `TickMessage` — they're a separate targeted `RumourMessage`
  sent only to the connection that identified itself via `?player=<id>` as that rumour's
  `heardBy`. If you're touching the server or the Godot client, read both message shapes
  in `src/server/ws.ts` before assuming the old single-message protocol still holds.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite
this file at the end, keep the root `README.md`'s Status section current. Push doc
updates one at a time, not batched. `CLAUDE.md` also carries five standing design
constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md`) binding on all future work —
check new work against them the same way, every session.
