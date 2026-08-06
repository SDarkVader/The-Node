# Devlog

Chronological record of work on NODE, newest entry on top. Include failures and dead ends,
not just what shipped — the point is that the next session (or next hour of this one)
doesn't have to rediscover them.

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
