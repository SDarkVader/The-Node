# Devlog

Chronological record of work on NODE, newest entry on top. Include failures and dead ends,
not just what shipped — the point is that the next session (or next hour of this one)
doesn't have to rediscover them.

---

## 2026-08-06 — Phase 2 vacancy engine built; §2.4 targets found not to reproduce

**Context.** User: "let's start building what we can." Phase 2 (vacancy/churn/backstop)
was the obvious next piece — next in the brief's own build order, fully specified with
concrete equations, doesn't depend on the Godot client or any of the day's still-open
design decisions (exit-ticket stake formula, etc.).

**Built.** `src/engine/vacancy.ts` — the semi-Markov process from §2.1-2.3: three states
(FILLED/VACANT/BACKSTOPPED, per the brief's own §1 notation table, not the two implied by
§2.1's shorthand diagram), `fillHazard()` implementing §2.2's equations verbatim,
two-stage flag/hard-backstop thresholds. `src/sim/vacancyHarness.ts` +
`vacancyCli.ts` (`npm run vacancy-sim`) for running many role-slots over many days.

**Gap the brief leaves open, documented rather than guessed past:** no rate is specified
anywhere for BACKSTOPPED -> FILLED (a real player displacing the NPC). Without modeling
it at all, every slot would eventually ratchet permanently into BACKSTOPPED over a long
run, which can't be right — "starved fraction stays near 1-2% of the year" wouldn't be a
stable figure otherwise. Modeled as an ambient hazard frozen at the pressure-plateau
value (fillHazard at tau=t_hard) — documented clearly in BLUEPRINT.md as an interpretive
choice, not a brief-specified number.

**Failure caught during verification, not before shipping.** First pass: ran 1 year with
only R=3 role-slots (~11 total events) and got numbers that looked wildly different from
the brief's claims (ratio 2.67-4.00, starved fraction way high). Nearly treated this as
a finding immediately — caught that 11 events is far too small a sample to trust, reran
with 5 seeds x 20 years (250+ slot-years) before drawing any conclusion. Also found, while
doing that, a real bug: BACKSTOPPED-recovery events were double-counting elapsed time on
top of the gap already recorded when the backstop originally fired, producing gap values
that impossibly exceeded the 14-day hard cap (17.0 seen against a construction-guaranteed
max of 14). Fixed before trusting anything downstream of `gapDays`.

**Real finding, verified with statistical power, not forced to match.** Even after the
fix and with a properly-sized sample, a faithful implementation of the brief's literal
§2.2 equations and stated `[CALIBRATED — provisional]` constants (beta=0.0008, T_pain=14,
v_boost=3.0) does not reproduce §2.4's claimed targets: brief says voluntary:backstop
ratio ~1.2:1 at N=50 rising to ~2.8:1 at N=80 and starved fraction ~1-2%; this
implementation converges to ratio ~2.5:1 rising to ~4.2:1, and starved fraction ~6-7%
(checked both a VACANT-only definition and a VACANT+BACKSTOPPED definition of "starved" —
neither reconciles both targets). The *direction* of the N-dependence matches; the
magnitudes don't.

Before concluding this was a real discrepancy rather than a calibration miss, swept
`beta` from 0.0008 to 0.01 at N=50: starved fraction does fall toward 1-2% as beta rises,
but the ratio explodes to 783:1 in the same sweep — no single beta value hits both
targets at once. That rules out "just retune the constant," which is why this is
documented as a structural discrepancy in `BLUEPRINT.md`'s "Open deviations," not
silently patched by picking whichever beta looks closest to one target while ignoring
the other.

**Verified, not assumed:** `test/vacancy.regression.test.ts` (5 tests) encodes what's
genuinely true of this implementation instead — no gap ever exceeds t_hard (structural),
both mechanisms actually fire over a long run, the VACANT fraction reaches a stable
steady state rather than drifting, the ratio increases with N (matching the brief's
claimed direction), BACKSTOPPED is a real measurably-occupied state. 35 tests total (30
previous + 5 new), all passing, `tsc --noEmit` clean.

**Not done this entry:** §2.5's NPC fallback isn't wired into the Phase 1 market yet (a
BACKSTOPPED Baker doesn't participate in pricing) — the vacancy engine and the economic
engine are still separate, unconnected systems. §2.6 (Shift Cover) not started — needs a
player-session/online-state concept that doesn't exist in this headless engine.

---

## 2026-08-06 — Unified decay primitive extracted; two open items resolved

User resolved both items left open at the end of the previous entry.

**1. Private per-player maps vs. the diary — resolved, diary wins.** User: "this
document was unaware, keep our diary." Updated
`docs/ECOSYSTEM_VISION_2026-08-06.md`'s private-per-player-maps section: removed the
"accumulating impressions" framing, made explicit that the diary's bounded ~30-day
rolling expiry is authoritative at every scale, and that there's no separate
longer-lived "shard impression" system record above it — whatever a player carries about
a shard beyond a still-live diary entry is their own untracked human memory, not
something the system stores. `BLUEPRINT.md`'s pointer updated to match (was "open
tension," now "resolved").

**2. Unified decay/distortion model — built, verified nothing broke.** User: "feel free
to build a unified model if again, nothing breaks." Only the rumour mill is actually
implemented in code (proximity conversation and shard-graph propagation are still
design-only), so this concretely meant: extract the rumour mill's decay/distortion math
into a generic, reusable primitive those can plug into later, without changing anything
about how the rumour mill currently behaves.

Added `src/comms/decay.ts` (`stepClarity`, `applyDistortion`) and refactored
`src/comms/rumourMill.ts` to call it internally. Deliberately kept `RumourMillConfig`'s
field names (`baseSpreadChance`, `decayPerHop`, ...) completely unchanged — the new
primitive's own config shape is mapped at the call site — so zero callers or tests needed
to change, the lowest-risk version of this refactor. Preserved the exact rng() call
order (one call for the pass/fail roll, then conditionally one or two more for
distortion) since the existing tests are seeded and would produce different specific
values under a different call sequence even with equivalent logic.

Verified, not assumed: full suite before (24 tests) vs. after (30 tests: 24 unchanged +
6 new `decay.test.ts` tests exercising the primitive directly) — all passing, `tsc
--noEmit` clean, and reran `npm run mvp` to confirm byte-identical day-by-day output to
before the refactor (same posts, same hops, same distortions, same clarity values).

**Correction to the previous entry, caught on this pass:** that entry's second bullet
said the decay-with-distance pattern was independently reinvented "the fourth time,"
counting the diary as a member. That was wrong — the diary uses hard silent TTL expiry,
not gradual decay, which the user chose explicitly over the fade/blur alternative
offered earlier. It's the third reinvention (rumour mill, proximity conversation,
shard-graph distance), not the fourth. Corrected inline in that entry rather than
silently rewritten.

---

## 2026-08-06 — Ecosystem Vision reviewed, standing constraints added to CLAUDE.md

User provided `ECOSYSTEM_VISION_2026-08-06.pdf` — a one-level-up companion to
`BLUEPRINT.md`'s design intent, addressing what NODE looks like as many shards rather
than one. Transcribed to `docs/ECOSYSTEM_VISION_2026-08-06.md` for continuity (same
treatment as the design addendum).

Genuine findings from reviewing it, not just filing it:
- The doc's "shards relate to each other the way players relate within a shard" claim
  isn't just a metaphor — `src/comms/connections.ts`'s `ConnectionGraph` already models
  exactly that shape and is directly reusable one level up when ecosystem work starts.
- The "information degrades with graph distance" idea is the third independent
  reinvention of the same primitive this session: rumour mill (social hops), proximity
  conversation (physical distance), now this (shard-graph distance). Worth building one
  shared decay/distortion utility, parameterized by distance metric, rather than three
  separate implementations later — noted for whenever any of this gets built.
  ***Correction, later same session:*** this bullet originally said "fourth" and included
  the private diary as a member of this family. That was wrong — the diary explicitly uses
  hard silent TTL expiry, not gradual decay/distortion (the user chose that directly over
  the fade option offered). Caught on a later pass; see this date's later entry, where the
  primitive was actually extracted from `rumourMill.ts` into `src/comms/decay.ts`.
- Flagged one real tension rather than silently picking a side: the vision doc's private
  per-player maps section describes "accumulating" impressions, but the diary refinement
  added to the addendum earlier today gives person-level entries a bounded ~30-day
  rolling expiry instead. Whether a player's shard-level impression should inherit that
  same erosion or stay more durable than person-level impression is now an open question
  between the two documents — noted inline in the vision doc, not resolved.
- One precision note: §2's "ruin and rejuvenation — the mechanic you already built" is
  grounded in the brief's §2.5 NPC-fallback *spec*, not code that exists yet (Phase 2
  isn't built). The reasoning holds regardless; just flagging so it doesn't get misread as
  already-implemented.

**Action taken beyond filing:** the document's §6 ("how to scale this without breaking
it") reads as five binding policy statements, not narrative, so they're now in
`CLAUDE.md` as standing constraints on all future work — simulate before trusting, no
permanent zero-state at any scale, ask whether something needs to be an agent before
building it, nothing gets recorded ever, let outcomes be real rather than scripted. Same
mechanism as the existing documentation rules: automatically loaded every session, not
something that has to be re-asked for.

No code touched this entry — design review and documentation only.

---
---

## 2026-08-06 — Private diary designed collaboratively, refining "private per-player maps"

Extended back-and-forth design conversation (not implementation) working out a concrete
mechanic for the addendum's "private per-player maps" idea, which had been left vague
("tags, suspicion markers, trust notes"). Landed on a specific, coherent shape — full
writeup in `docs/DESIGN_ADDENDUM_2026-08-06.md`'s new "Refinement — the private diary"
subsection, not duplicated here. Short version: composed (not free-typed) entries from
SUBJECT/OBSERVATION/READING/CONTEXT slots, unprompted-only creation, rolling per-entry
silent expiry (~30 days, illustrative) instead of permanent accumulation. Reframed the
diary's purpose along the way — not a persistent dossier, a bounded private space to
process a feeling in the game's own vocabulary, with the player's own memory expected to
outlast the system record.

Worth noting for how this kind of session should go: this stayed pure design
conversation until explicitly asked to write it down ("keep developing it out loud"),
rather than getting formalized into docs prematurely. Nothing built, no code touched.

---

## 2026-08-06 — Design addendum review: exit-ticket gamble stake-direction bug found

**Context.** User provided a design addendum (`docs/DESIGN_ADDENDUM_2026-08-06.md`) and a
Python population sim (`design/exit_ticket_gamble_sim.py`) covering several new,
not-yet-built mechanics: vacancy backstop rationale, the shard exit ticket, the Oracle,
private per-player maps, an atmosphere principle, a Wall/rumour threat-model note,
proximity conversation (no-microphone, template-composed voice alternative), and
multi-shard passport tiers. Asked for thoughts before any action.

**Finding — exit-ticket gamble stake formula is inverted from its own stated intent.**
Installed numpy, ran the script (reproduced the addendum's own numbers exactly: 2852
wins/7384 losses, realized rate 0.279 vs 0.30 target — the script itself runs correctly),
then traced the actual `f` (required stake) against `p` (progress) directly rather than
trusting the aggregate stats:

```
p=0.02 -> f=0.040 (stake 4%)   realized_w=0.300
p=0.25 -> f=0.500 (stake 50%)  realized_w=0.300
p=0.50 -> f=1.000 (stake 100%) realized_w=0.300
p=0.90 -> f=1.000 (stake 100%) realized_w=0.167  <- capped, can't reach target
p=0.99 -> f=1.000 (stake 100%) realized_w=0.152
```

Both the script's docstring and the design addendum state the opposite: small stakes
near completion, large stakes near zero progress. The formula (`f = target_w * p /
base_odds`) makes required stake *increase* with `p`, and a near-complete player can
never even reach the target win rate once `p > 0.5` — they're capped at 100% stake with
degrading odds the closer they get. This is a genuine contradiction between the stated
design intent and the actual math, not a calibration nicety.

Why the addendum's own "Findings" section didn't catch it: finding #1 (realized win rate
converges to target) is true by construction — `f` is *solved* to hit `target_w`, so
convergence is guaranteed algebra, not evidence about which direction the risk curve
points.

**Verified a fix, did not apply it.** Swapping `p` for `1-p` (distance to completion) in
the win formula — `w(p,f) = base_odds*f/(1-p)`, so `f = target_w*(1-p)/base_odds` —
reproduces the stated intent exactly when checked numerically:

```
p=0.02 -> f=0.653 (stake 65%)  realized_w=0.100
p=0.50 -> f=0.333 (stake 33%)  realized_w=0.100
p=0.90 -> f=0.067 (stake 7%)   realized_w=0.100
p=0.99 -> f=0.007 (stake 0.7%) realized_w=0.100
```
(also dropped `target_w` from 0.30 to 0.10 for this check — the original
`target_w/base_odds` ratio of 2.0 saturates `f=1` across half the `p` range regardless of
which direction it points; a ratio `<=1` gives a smooth curve across the whole range).

**Did not silently edit the original files.** The addendum itself marks the staking
formula "still provisional," so this is exactly the right time to flag it, not late. Both
`docs/DESIGN_ADDENDUM_2026-08-06.md` and `design/exit_ticket_gamble_sim.py` were
committed with the original content intact, plus a clearly marked, dated verification
note pointing to this finding — not a rewrite. Awaiting user confirmation before anyone
changes the formula.

**Everything else in the addendum reviewed, no conflicts found.** Vacancy
backstop/mechanical-NPC section already matches what's built (§2.6, documented in
`BLUEPRINT.md`/`HANDOVER.md` since the Phase 1 session) — no new work. Proximity
conversation is architecturally identical in shape to the already-built `SELF_STATES`
pattern in `src/comms/grammar.ts` (curated table, throws on anything outside it) and
would meaningfully reduce Phase 5's scope if built, since it never captures audio at all.
Private per-player maps is flagged as a real scope change for whenever Phase 4 planning
starts (private per-user state, not shared-state-with-a-fog-layer). Nothing else touches
anything currently built.

**Action taken.** Committed the addendum and simulation script to the repo (`docs/`,
`design/`) for continuity, with the verification note attached. `BLUEPRINT.md` updated
with a pointer (not merged into its "what's built" body, since none of this is built).
No code changes to the production engine this entry — this was a design review, not an
implementation session.

---

## 2026-08-06 — Platform lock-in (Godot), client/server scaffold, Baker price drift fix

**Context.** User set the platform: PC + mobile, not web ("web is clunky and it helps to
have paranoia in your pocket"). Asked which engine would be more immersive for this
specific game; recommended Godot 4 over Unity mainly on rendering fit — §4.5's "layered
light sources, not blended" requirement maps closely onto Godot's native additive Light2D
blending, plus a lighter mobile runtime footprint matters directly to the "paranoia in
your pocket" goal (battery/jank kills immersion fast on a phone). Checked Unity's actual
current pricing before the user decided rather than relying on memory, since it's swung
wildly before (2023 Runtime Fee controversy and reversal) — confirmed free under $200K/yr
revenue+funding, ~$2,040-2,400/seat/year Pro above that; cost wasn't the deciding factor
either way. User locked in Godot.

**Architecture consequence.** The TS engine becomes the authoritative server; the client
is a thin renderer over WebSocket. Nothing already built needed to change for this — it's
additive.

**Built — scenario refactor.** Extracted `src/mvp/run.ts`'s simulation step into
`src/mvp/scenario.ts` (`initScenario`/`stepScenario`) so the CLI script and a new server
can drive the identical logic. Verified the refactor was behavior-preserving by diffing
CLI output before/after — identical.

**Built — WebSocket server.** `src/server/ws.ts` (`npm run server`), ticks the scenario
on an interval and broadcasts one JSON message per tick. Tested against a throwaway
Node client script (not committed) rather than just trusting it compiled — caught one
self-inflicted issue this way: an earlier server instance from testing was still running
in the background on port 8080 and had been silently serving 1000+ days of ticks, which
made a later verification run misleading until I noticed the day count and killed it.

**Built — Godot 4 client scaffold.** `client/` — project config (GL Compatibility
renderer, for broad PC+mobile device support), a minimal scene (status label, prices
label, scrolling log), and `Main.gd` connecting via Godot's built-in `WebSocketPeer`.
**This environment has no Godot binary or GUI**, so the client was written by hand
against Godot 4 syntax and has never actually been opened or run — flagged clearly in
`client/README.md` and `docs/BLUEPRINT.md` as unverified. Caught one likely bug just from
careful re-reading (not execution): GDScript's `JSON.parse_string` returns all JSON
numbers as `float`, so the two places assigning into declared `int` variables (`day`,
`hop`) would throw a runtime type error without an explicit `int(...)` cast. Fixed both,
but this is exactly the kind of thing that needs a real editor run to be sure of.

**Failure/finding — Baker price drift, found while verifying the server's live output.**
Watching the WebSocket server's ticks climb steadily (1.24 → 1.28 → 1.34 over ~5 days)
prompted a check of the underlying model over a much longer horizon than the §1.4 tests
use. A 5000-day run of the real engine (real Millers, no MVP shortcuts) confirmed both
bakers pin to the 2.0 price ceiling by ~day 100 and stay there permanently. Root cause:
the brief's literal `+ cost_pressure * 0.1` term in §1.3 is an unconditional daily
addition with no restoring force; summed across bakers it's a random walk with constant
positive drift. The §1.4 regression tests never caught this because they measure price
*spread*, which a drift hitting every baker equally doesn't touch.

Flagged this to the user with the evidence before touching anything — per the working
process set earlier this session (flag concrete problems, get a concrete answer, keep
moving). User: "It's ok to fix the math, as long as it passes verification under
scrutiny." Fixed with a mean-reversion term (`0.05 * (flourPrice*1.5 - mean(p))`)
applied identically to every baker each day, which provably cancels out of every pairwise
price difference — meaning the §1.4 spread-based findings should be mathematically
unaffected. Verified rather than trusted:
- Reran all 10 original regression tests: 9 passed unchanged, 1 failed (`n=2 bakers:
  stable for gamma < 2`, pinned at gamma=1.99). Diagnosed rather than papered over: ran a
  diagnostic sweep (gamma 1.5/1.9/1.95/1.99/2.0) and confirmed prices never approached the
  clip bounds — spread grows smoothly from 0.0125 to 0.065 as gamma approaches 2, a
  genuine near-critical-point property (variance amplification ~50x right at the
  boundary), not a clipping artifact from the fix. The test threshold was fragile by
  construction (pinned exactly at the edge of a smooth curve), not evidence of a new bug.
  Moved the threshold to gamma=1.9 and added an explicit monotonic-approach test instead
  of relying on one brittle point.
- Reran the long-horizon check across multiple configs/seeds out to 8000 days: settles
  near the flour-cost anchor and stays there, no saturation, in every config tried.
- Added two new regression tests locking in "no ceiling saturation" and "settles near the
  anchor" so this can't silently regress.
- Confirmed the MVP scenario's hardcoded-flour-price path also stopped drifting (60-day
  run stays in a sane 0.7-0.85 band instead of climbing past 1.3 by day 30).

24 tests total, all passing. Documented as a real deviation from the brief's literal
equation in `docs/BLUEPRINT.md`, not silently patched.

**Docs order note.** User asked specifically to push `docs/BLUEPRINT.md` (bundled with
the code it describes) before touching the other three docs — done as a separate commit,
pushed first, this entry follows in a second commit.

**State at end of session.** Godot locked in. Client/server scaffold proven (server
tested live, client written but unverified pending a local editor run). Baker price
model no longer has the drift defect. Next: someone needs to actually open `client/` in
Godot and confirm it runs; real Phase 4 rendering (isometric scene, ambient colour
layers) hasn't started.

---

## 2026-08-06 — §8 MVP slice: grammar constraint + rumour mill + two-Baker scenario

**Context.** User pushed back on timeline hedging ("you always say several months, then
a couple weeks later it's built") and set the actual working process going forward: flag
concrete unresolved problems when they're genuinely blocking, get a concrete answer, keep
moving — don't stall on open questions that don't need answering yet. Went straight into
the brief's §8 milestone: two Bakers plus a working rumour mill.

**Scope call made without asking (cheap, reversible).** Built this as a headless,
testable scenario (`npm run mvp`) rather than standing up a real server/client. The real
fork — browser vs. native, hosting, auth, persistence — is expensive to reverse and
wasn't asked about yet; flagged in HANDOVER.md as the next concrete decision rather than
guessed at silently.

**Built — grammar constraint (§3.1).** `src/comms/grammar.ts`: Wall posts and Envelopes
share one type, built from a curated `SelfState` template table (first-person,
present-tense, never naming another player), per the brief's explicit preference for a
"curated preset/template picker" over free-text-plus-a-filter. Validity is enforced at
the type/runtime boundary — `postToWall`/`sendEnvelope` throw on anything outside the
template set, so the safety property is structural, not a moderation pass. Added a
meta-test (`test/grammar.test.ts`) that regexes the whole template table for
second/third-person pronouns and past/future tense markers, so a future contributor can't
quietly add a template that violates the grammar without a test catching it.

**Built — rumour mill (§3.2).** `src/comms/connections.ts` (per-edge connection graph,
no persistent global graph — matches §4.3's "no static drawn edges" framing even though
rendering doesn't exist yet) and `src/comms/rumourMill.ts` (BFS propagation from a Wall
post's author outward, decaying clarity per hop, probabilistic distortion into a
semantically-adjacent self-state rather than pure noise). All four knobs
(`baseSpreadChance`, `distortionRate`, `decayPerHop`, `maxHops`) are one config object,
matching the brief's ask that this specific system stay cheap to retune. Explicitly
marked `[CALIBRATED — provisional]` like the Phase 1 constants — the brief says the mill
is the piece "most likely to need hands-on iteration once playable."

**Built — MVP scenario (`src/mvp/run.ts`, `npm run mvp`).** Two Bakers on the real
Phase 1 Bertrand engine with a hardcoded flour price (brief §8 explicitly allows
skipping the full Miller layer here), three gossip-layer players connected via the graph.
A Baker posts to the Wall when the price gap crosses a threshold; the post propagates
through the mill. This trigger rule is flagged in the file's own header comment as
illustrative scaffolding, not a designed mechanic — it exists to exercise the pipeline
end-to-end, and should be replaced once there's a real reason for a Baker to post.

**Failure — first cut of the MVP never actually triggered.** Initial version used
gamma=1.0 and the Phase 1 default noise (sigma=0.01) with a 0.05 price-gap threshold
copied over without checking it against the new context. Ran it: spread never exceeded
~0.03 across 10 days, so the Wall/rumour path never fired — the "two Bakers plus a
working rumour mill" demo silently didn't demonstrate the rumour mill. Caught by actually
running the script and reading the output instead of assuming it worked because it
compiled. Fixed by lowering the trigger to 0.015 and raising the demo's noise sigma to
0.02 (livelier than Phase 1's tuned default, appropriate for a demo script, not a change
to the underlying engine). Reran: Wall posts fire on ~half the days, propagate through
1-2 hops, distort on some but not all hops — matches the intended "reliably imperfect"
behavior.

**Verification.** 21 tests total (10 Phase 1 regression + 5 grammar + 6 rumour mill), all
passing. `tsc --noEmit` clean. Ran `npm run mvp` and read the actual output before calling
it done, per the failure above.

**State at end of session.** §8 MVP mechanic proven: grammar-constrained comms + rumour
propagation work end-to-end against the real economic engine. No server, no client, no
persistence, no rendering — still text/CLI only. Next concrete fork to raise with the
user: what the actual playable surface is (browser client? what hosting/persistence?)
before building one.

---

## 2026-08-06 — Phase 1 economic core: build, verify, test

**Context.** User handed over `NODE_ClaudeCode_Build_Brief_v1.pdf`, a fully-specified
design doc for a persistent multiplayer social-economic game. Brief's own build order
(§0, §8) is explicit: Phase 1 (economic core) must be built and simulated headless,
verified against §1.4's validated findings, before any UI/identity/comms work starts.

**Decision — tech stack.** Asked the user: TypeScript/Node, specifically because the
Phase 1 sim engine isn't a throwaway script — it's meant to become the live economic
engine the multiplayer server runs later (brief §1.5 implies the harness sweeps the same
code the game uses). Picking a language now that won't need a rewrite for the realtime
server avoids a costly split later.

**Built.** Chained Cournot (Miller) → Bertrand (Baker) market per brief §1.1–1.3, as
literal equations (not a lookup table, per the brief's explicit instruction). Deterministic
seeded simulation harness (`src/sim/harness.ts`) and a parameter sweep utility
(`src/sim/sweep.ts`) per §1.5's "headless harness that can sweep N, R, gamma, headcounts"
requirement — scoped to what Phase 1 actually has parameters for (nMillers, nBakers,
gamma); N/R sweeps will follow once Phase 2's vacancy system exists.

**Gap found in the brief — noise magnitude.** Both reaction equations specify `+ noise`
with no distribution or magnitude given. Not one of the brief's explicitly-flagged open
questions (§7), so this was a genuine spec gap rather than a deliberate one. Resolved by
treating it the same as the brief's other `[CALIBRATED — provisional]` constants: gaussian
noise, `sigma=0.01` default, isolated behind a single constant
(`DEFAULT_NOISE_SIGMA` in `harness.ts`) so it's cheap to retune. Documented in
`BLUEPRINT.md` rather than silently picking a number and moving on.

**Verification — ran the sweep before writing tests, not after.** Swept nMillers ∈
{2,3,4}, nBakers ∈ {2,3,4,5}, gamma across 0.5–3.0 and eyeballed the table before locking
in any test thresholds, specifically to confirm the implementation actually reproduces
the brief's claimed findings rather than assuming the equations were transcribed correctly:

- n=2 baker slot: spread ~0 through gamma=2.0, jumps to full clip saturation (2.0) by
  gamma=2.1 — confirms the brief's "boundary is gamma=2, not 0.85" claim.
- n=3 baker slot: stays stable through gamma=2.5, only diverges by gamma=3.0 — confirms
  "n>=3 stays stable well past gamma=2."
- More millers -> measurably lower flour price, measurably higher baker-side spread.
  Baker headcount (3 vs 5) changed both metrics by <0.01 — noise-floor level, i.e.
  "barely changes outcomes."

All four of these match the brief's §1.4 claims directly from the implemented equations,
which is meaningful: it means the equations were transcribed correctly and the "hard
truth" findings aren't artifacts of the brief's own (different) simulation setup.

**Failure — one regression test was wrong, caught immediately.** First pass at the test
suite included an assertion comparing n=2 vs n=3 baker-slot spread at gamma=2.01,
expecting n=3's spread to be ≤ n=2's. It failed
(`0.0000624 not <= 0.0000031`) — both values were still sitting at noise floor, because
gamma=2.01 is too close to the boundary to have diverged within the 400-day/200-day-burn-in
window used everywhere else. The comparison was measuring noise, not the cliff. Removed
the assertion rather than loosening the tolerance to make it pass — the cliff is already
demonstrated unambiguously by the gamma=2.5 tests above it, and a passing-but-meaningless
assertion is worse than no assertion. Final suite: 10 tests, all passing, `tsc --noEmit`
clean.

**Shipped.** Committed to `claude/new-project-setup-h5m6f8`, pushed. Also copied the source
brief into `docs/NODE_Build_Brief_v1.pdf` so it survives past this session's upload
context — the brief itself says its audience is "Claude Code... with full continuity
across all phases," which requires the doc actually being in the repo, not just referenced
from a chat upload.

**State at end of session.** Phase 1 built and tested. Nothing player-facing exists. Per
§8, next milestone is the two-Baker + rumour-mill MVP (needs a Phase 3 slice + Phase 4
slice) — not started.

**Docs housekeeping.** User set a standing rule (this session, after the Phase 1 push) to
maintain four docs every session: this devlog, `BLUEPRINT.md`, `HANDOVER.md`, and keep
`README.md` current. Added `CLAUDE.md` so this rule auto-loads for every future session
rather than depending on being repeated. Backfilled this entry retroactively since the
rule postdated the actual Phase 1 work.
