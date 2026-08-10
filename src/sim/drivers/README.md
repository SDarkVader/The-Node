# Synthetic drivers — harness-only, never game content

This directory exists because running a world requires occupants making decisions, which
is in direct tension with `CLAUDE.md`'s standing constraint 3 ("ask does this need to be
an agent") and with NODE's foundational rule that no AI actor exists in the shipped game.

**The resolution:** everything in this directory is test instrumentation, exercising the
engine the way a load generator exercises a server — never a character, never shipped.
Each driver (`honest`, `opportunist`, `saboteur`, `idle`) is a pure, deterministic
function from *visible* state to one bounded action. No learning. No belief modelling
(nothing here reasons about what another player thinks or intends). No personality —
`DriverVisibleState` only carries mechanically observable facts (an ambient occupant
count, the current flour price, the shard's own `economicHealth`), never anything that
would require modeling another mind. A driver "noticing few people are nearby" is reading
a number, not inferring that it isn't being watched.

**Enforced structurally, not just by convention:** `test/drivers.importGuard.test.ts`
fails the build if anything under `src/engine/`, `src/world/`, or `src/server/` imports
from `src/sim/drivers/`. That is the actual guardrail against this test scaffolding
quietly becoming a shipped NPC — not a comment asking people not to do that.

**Action space** is bounded to exactly what a real player can do: occupy or vacate a role
slot, set a price, move between plots, speak (Wall post or Envelope), or attempt a
sabotage step (`DriverAction` in `types.ts`). A driver's return type cannot express
anything outside that union.

**What's wired into a live `stepWorld` tick and what isn't, as of Phase C:** nothing yet.
Phase C's own deliverable, per the Observatory build spec, is the drivers and the
import-guard test — not a driver-run world. Wiring these into `stepWorld` (deciding, for
instance, whether a driver's `occupySlot`/`vacateSlot` action *forces* a vacancy.ts state
transition or instead influences its existing probabilistic churn/fill model — a real
design question, not a detail) is deferred to Phase D, where `npm run world-record`
needs real driver-generated activity to produce a non-trivial recorded run. Flagged here
so it isn't mistaken for an oversight.
