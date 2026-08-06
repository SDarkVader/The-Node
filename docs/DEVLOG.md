# Devlog

Chronological record of work on NODE, newest entry on top. Include failures and dead ends,
not just what shipped — the point is that the next session (or next hour of this one)
doesn't have to rediscover them.

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
