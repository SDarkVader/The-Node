# Handover

Read this first. It's rewritten at the end of every session to reflect current reality —
if it feels stale, check `DEVLOG.md`'s top entry for what's changed since.

## What NODE is

A persistent multiplayer social-economic game, ~50-80 players per shard, no combat —
tension comes from asymmetric information and structural economic pressure. Platform:
**PC + mobile, client in Godot 4**, server authoritative in TypeScript/Node (decided
2026-08-06). Full spec: `docs/NODE_Build_Brief_v1.pdf`. Read its §0 before doing anything;
it's the one part of the brief that isn't up for revision. Also read `CLAUDE.md`'s
"Standing design constraints" — six binding rules (simulate before trusting; no permanent
zero-state at any scale; minimize what's modelable — ask "does this need to be an agent";
personal memory is mortal, civic memory is immortal; let outcomes be real, don't script
them; reputation may only ever grant, never remove) that apply to everything built from
here on.

## Current state (as of 2026-08-13, mid-session — see below before assuming this is a stopping point)

**2026-08-13 so far**: a new design addendum (`docs/DESIGN_ADDENDUM_2026-08-13.md`) proposed a
three-wedge/plaza/wall-gate district geometry and cited a "validated default" role split that
turned out to be stale (traced to a pre-port Python toy model). Verified its underlying
economic claim against the real engine (didn't hold), then — per the user's explicit
decision — extended `jointGridSearch.ts` to re-derive a role/district config at
`targetPopulation=100` properly, and adopted the result: `DEFAULT_WORLD_CONFIG` is now
`M9 B9 C7 J7 D8 IE6` (S=46), `targetPopulation=100` (was M5/B5/C5/J5/D5/IE3=28, pop=65). Full
trail in `docs/BLUEPRINT.md`'s "2026-08-13 addendum received" and "Adopted (2026-08-13)"
entries; a real side-finding (the core-vs-periphery identity-resolution gap disappeared at the
new building-count scaling) is flagged there too. Concept art was then folded into
`docs/VISUAL_FRAMEWORK_2026-08-12.md` as real source material (user's explicit instruction —
the art is modelled from the architecture, not decoration) as §8, which surfaced a genuine
conflict: the addendum's three-wedge geometry implies a district-count question (3 vs 6 vs 11).

Two rejected `AskUserQuestion` framings on that district-count question led the user to
reframe the actual problem: not "how many districts" but "how does a grifter exist in this
world at all" — where they live, how they're seen, how they get a role. That's now written up
as `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`: universal housing (one abode type for
everyone, capacity via floors not plot count), ground-level role access (reusing
`shiftCover.ts` unchanged, not a new mechanic), and reputation levels (two tiers derived from
`roleCompletion.ts`'s measured 54-58% vs 97-100% completion split, additive-only per
constraint 6, backstop always overrides per constraint 2). **Design only — no engine code for
this part.** It flagged a real prerequisite bug: `District.population` (`space.ts`) was never
incremented by the real `stepWorld` tick loop.

**Then the user said "let's resolve the issue before proceeding"** — the district-count
question. Fixing `District.population` (the flagged prerequisite) surfaced a SECOND real bug
immediately: `assignRoleBuildings` starved whichever districts landed last in iteration order
once role count fell short of building count — 2 of the shipped config's 4 periphery districts
held zero role-holders, ever, deterministically. Both fixed (world.ts) — the first fix attempt
at Bug 2 introduced a worse resonance bug (caught by an existing courier-pay test before it
shipped), the real fix processes roles one at a time with a district cursor that keeps
advancing across roles. With both bugs fixed, real per-district numbers were decisive: **1
district per shard beats 3, 6, and 11 on every metric measured** (population, per-district
headcount, health, AND equality — not a tradeoff). `DEFAULT_SHARD_CONFIG` is now
`coreDistrictCount: 1, peripheryDistrictCount: 0`. This resolves the geometry conflict with the
addendum's three-wedge art for free (one district now IS one settlement) and closes
`VISUAL_FRAMEWORK_2026-08-12.md` §8. Full numbers and the real, undeleted cost (the
core/periphery Silhouette-Shield resolution-speed distinction no longer applies to the shipped
default) are in `docs/BLUEPRINT.md`'s 2026-08-13 "District-topology question RESOLVED" entry.
442 tests passing (437 + 5 new), typecheck clean.

Also captured this session but **not yet designed or built**: a tongue-in-cheek
disallowed-rules/fines mechanic (no stealing/arson/trespass/detected misinformation,
Journalist+Detective as mechanical enforcers, violations requiring multiple players trading a
capped per-role resource to craft — nobody can go solo), an explicit ask to simulate that
economy once designed, and a separate ask to put real values/odds/prize numbers into the
Oracle. Full detail in `docs/DEVLOG.md`'s two matching 2026-08-13 entries — recorded verbatim
so none of it is lost a second time (the user flagged they'd raised the fines idea before and
weren't sure it survived).

**Then, same session**: the diary (design-locked since 2026-08-06, never wired to real
content) got composed with housing and the fines economy into one mechanic — a player's diary
now lives in their abode; trespassing (requires a key — the fines economy's first concrete
use) while the owner is offline-or-elsewhere reveals a connections-only view (who they have
diary entries about, not what those entries say), freshly distorted every read via the
existing `comms/decay.ts` primitive so it's never the same stable "truth" twice. Full design in
`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7 — explicitly reconciles with, rather than
contradicts, the diary's existing hard-TTL/no-fade storage decision (only the read-time
projection distorts, not the stored entries). **Design only, nothing built** — depends on
housing/residency, the diary's content schema, and the key-crafting economy, none of which
exist in code yet.

**Also captured, same thread**: arson gets the same absence-gate as trespass ("can't do it
when they're active in their role, but can when they're not at home") — target (workplace vs.
abode) not stated, flagged open rather than guessed, `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md`
§7.6.

**Then: "continue working on the build and test as you go."** First real code from the
housing design, not just another design doc — `space.ts` gained `Building.floors`,
`districtHousingCapacity()`, `chooseHousingDistrict()`; `world.ts` gained
`GrifterSlot.districtId`, assigned via a single lazy-fill pass at the end of `stepWorld` (same
pattern the `District.population` fix used) rather than touching every grifter-construction
call site. `District.population` now means real total residents (role-holders + housed
grifters), not just role-holders. Verified against a real run: shipped config, 300 ticks,
housing capacity 372 vs. real population 67, all 22 grifters housed. 9 new tests, 451 total,
typecheck clean. Deliberately scoped down from the full design — no per-building/per-floor
assignment yet (district-level only), no consolidation-displacement grace period for housing.
Full detail in `docs/BLUEPRINT.md`'s "Housing capacity + grifter residency" entry.

Then folded the real shipped numbers into `docs/VISUAL_FRAMEWORK_2026-08-12.md` §9 (floors,
capacity, the "every building is mixed-use, same footprint regardless of role" rule) per the
user's explicit ask — *"ensure it's represented in the visual design so that I can model the
game directly from code and documents"* — so a 3D modeler has real code constants to work
from, not concept-only language.

**Then: "let's continue"** — reputation levels (§3), following the housing build order's own
next step. Before coding, checked whether the design's "persists across a grifter becoming a
role-holder and back" assumption holds against the real engine — **it doesn't**: `player.ts`
already flags player identity as session-scoped/deferred, and `world.ts` has no thread
connecting a grifter to whoever they become after filling a role. Separately, the design's
own voluntary-uptake gate needs to pick a SPECIFIC grifter for a fill, but the real fill
mechanism (`genuineFill`) is a hazard-driven count increment, not a per-grifter selection.
Both real, load-bearing gaps — scoped down to what's honestly buildable: `src/engine/
reputation.ts` (level derivation, additive role-eligibility sets) plus `GrifterSlot.
reputationProgress`, wired into Shift Cover's existing payout (a successful cover earns one
progress-tick, reusing the existing anti-grind cap). **The gate itself is not wired up** —
labeled honestly as level/progress tracking only, not the full mechanic.

Also caught and fixed a real calibration problem before it shipped: the illustrative
thresholds `[3, 8]` were guessed with no data; measured against real 1000-day runs and found
level 2 (8) was NEVER reached once across 9 (seed, churn-rate) combinations — max ever
observed topped out at 7. Lowered to 6, verified reachable, locked in with a regression test.

466 tests total (451 + 15 new), typecheck clean. Full trail in `docs/BLUEPRINT.md`'s
"Reputation levels" entry.

**Then: "the open design threads."** Wrote up both remaining ones in full, design-only:

- `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` — the fines ruleset made coherent. The "capped
  per-role resource" requirement is `resources.ts`'s six already-shipped named resources,
  reused not invented (real gap closed on paper: they're shard-aggregate today, need a
  per-slot personal stock, checked to NOT hit the same identity-persistence wall reputation
  levels hit). Three illustrative item recipes, communal pooling not bilateral trade.
  Detection reuses `ecosystem.ts`'s pattern-based sabotage machinery wholesale — zero new
  detection math. Misinformation explicitly NOT forced into the item shape — already has a
  home in the rumour mill. Fines refund into nodule supply; "nodules keep pace with growth"
  turns out to already be true structurally, no new mechanism needed there.
- `docs/DESIGN_ORACLE_2026-08-13.md` — closes the Oracle's one open item (which metric odds
  float on). Checked both candidates against real measured behavior:
  `economicHealthWithExperience` (0.77 under real attack) recommended over `economicHealth`
  (reads "basically fine," 0.96, under the same attack — an existing finding). Proposed a
  linear, clamped, floored health-to-odds mapping matching the exit-ticket gamble's own
  already-validated flat-odds simulation at healthy conditions. Event prizes scoped to real
  economic quantities only, never standing/reputation (constraint 6).

Both cross-reference, not duplicate, the housing/reputation/diary work already written up.
No code in either — full detail in `docs/BLUEPRINT.md`'s matching entry.

**Then: "let's restructure the reputation gate before coding, then begin."** Done, and live.
`sim/multiRoleConscription.ts`'s `RoleGroupState` gained an optional
`minReputationLevelForFill`, and `stepMultiRoleConscriptionDay` an optional per-level pool
breakdown — both default to the exact pre-existing ungated behavior when omitted (proven with
a byte-equality test), so this was additive, not a breaking rewrite. `world.ts` computes real
per-level grifter counts every tick and wires it up — Miller/Baker require level 2, the four
cooperative roles require level 1, for VOLUNTARY fills only; backstop/conscription still
bypass it entirely.

**Two real bugs found and fixed verifying it against real `stepWorld` runs, not just unit
tests** — both caught by the pre-existing population-conservation test, not hypothesized:
(1) `conscriptionFromGrifters` decremented the aggregate pool but not the new per-level
breakdown, letting a later role's gate pass against a stale snapshot; (2) once fixed, a
subtler mismatch remained — the internal bookkeeping assumed `conscriptionFromGrifters`
always consumes the lowest reputation level first, but the REAL selection in `world.ts` was
still pure longest-wait, level-blind, so the two views of the pool could still disagree.
Fixed by making the real selection also prefer lowest-level-first, matching the internal
assumption exactly. Both traced to an actual reproduction (day 237, seed 3), not guessed.

**A real, measured consequence, reported honestly**: at the shipped config, no grifter
reached level 2 within 800 days across 3 seeds tested — Miller/Baker's voluntary fill path is
effectively closed under current dynamics, filling almost entirely through conscription/
backstop instead. Economic health stayed fine (0.909–0.922, the backstop absorbs it as
always) but this is flagged as a stronger effect than intended, worth a closer look later.

470 tests total (466 + 4 new), typecheck clean. Full trail in `docs/BLUEPRINT.md`'s
"reputation gate" entries.

**Then: "let's explore these options and offer solutions."** Built a real probe (every
grifter's level tracked across 800 days x 3 seeds, not a snapshot) and confirmed the "trap"
with numbers: 105-128 grifters reach level 1 per seed, only 10-21 reach level 2; 83-90% of
those removed while at level>=1 were removed AT level 1 (mean 6.9-16.3 days after reaching
it) — because level 1 opens FOUR roles at once, so most grifters get swept up long before
accumulating level 2's extra progress. Found and fixed a real latent bug while measuring
(`world.ts`'s `genuineFill` didn't prefer the lowest eligible level first, same class of
internal/real mismatch as the gate-restructuring bugs) — didn't move the numbers much on its
own, confirming the four-roles-competing dynamic is the dominant effect. Measured real
threshold sensitivity: 6 (shipped) → 44 total level-2 achievers/3 seeds/800 days; 5 → 77;
4 → 162 — a clean lever, presented with real numbers via `AskUserQuestion`. User chose
"something else" without yet specifying the mechanism; asked directly rather than guessing.
**Unresolved, waiting on the user's answer** — pick this up first next session if it's still
open.

**Then, a separate thread, same session**: *"we need sabotage to succeed more often... it
can't take over 100 days"* → *"sabotage must be relatively easy, but connecting information
must take time"* → *"arson is a far more difficult crime, but still possible. 30% opportunity
is enough to take a chance."* A real three-tier difficulty principle for the whole crime
pipeline. **Sabotage recalibrated and shipped**: `ecosystem.ts`'s
`PATTERN_STEP_CADENCE_DAYS_DEFAULT` 15→7 (detection depends only on steps completed, not
calendar time — halves campaign length for free, zero effect on success rate, confirmed by
measurement) and `PATTERN_P_PER_WITNESS_DEFAULT` 0.01→0.006 (raises success rate). Measured
(8 seeds, 20,000 days): no Detective 71.1% succeed / mean 55 days (was 55.2%/146); with
Detective 40.2% succeed / mean 85 days (was 32.0%/220) — both under the 100-day ceiling,
Detective still meaningfully harder, constraint 2 re-verified. **Arson** (still unbuilt) got a
real calibration target for later: ~30% success rate, a floor not a ceiling, clearly below
sabotage's new numbers — recorded in `docs/DESIGN_FINES_ECONOMY_2026-08-13.md` §4.1. **Diary
pace explicitly confirmed unchanged** — "connecting information must take time," "all you
receive is a diary snippet" reaffirms the existing design, nothing recalibrated there.

473 tests total (470 + 3 new), typecheck clean, no test/doc debt left hanging.

**Then, a research-prompt request, then a sharp correction that reopened the diary itself**:
after generating a self-contained research prompt on proximity-conversation moderation logging
(sent as a file, not committed to the repo), the user caught something bigger: *"the diary
changes daily through subtle distortion. no 30 days, only yesterday's mechanical memory of
interaction reset as server. why is all this being ignored..."* This was right, and it exposed
that the §7.4 diary-in-abode reconciliation earlier this same session had defended the *wrong*
version of the diary's retention model — built on the 2026-08-06 static/no-fade/~30-day
assumption without noticing `DESIGN_ADDENDUM_2026-08-12.md` §10 had already proposed daily-ish
distortion two days earlier. Fixed properly, not just patched: `DESIGN_ADDENDUM_2026-08-06.md`'s
Retention section now specifies ~2 days (was ~30), with OBSERVATION/READING distorting once per
server day-tick via `applyDistortion` (`comms/decay.ts` — its header no longer says "NOT used
by the diary," because now it is); SUBJECT and CONTEXT never distort, since identity resolution
must stay reliable (constraint 4). `privateStore.ts`'s `getAlive` gained optional
`distort`/`rng` params (applied once per elapsed day, catching up if several were missed,
entirely opt-in) — 4 new tests. `DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.4/§7.5 rewritten:
the separate read-time-only distortion layer it built for the trespass view is now redundant
(the diary's own storage already drifts daily) and removed; trespass just reads the live,
short-windowed SUBJECT graph. Per the user's explicit follow-up ask, swept every design doc for
other stale references to the old model and fixed them in place rather than just the two files
already in view: `DESIGN_ADDENDUM_2026-08-12.md` §10's own reset-interval numbers (7/14/30/90
days) flagged stale (mechanic still correct, numbers superseded), `ECOSYSTEM_VISION_2026-08-06.md`
and five spots in `BLUEPRINT.md`. Full trail in `docs/DEVLOG.md`'s matching 2026-08-13 entry,
including the honest "why this happened" note.

477 tests total (473 + 4 new), typecheck clean.

**Then: the research prompt came back, with an explicit ask to verify it and build to it.**
User supplied an 11-page report answering the moderation-logging research prompt from earlier
this session, plus: *"everyone has to keep logs, I just need to obey the law... I think we can
verify the results and then ensure the architecture meets these compliance standards."* Four of
the report's claims were spot-checked against primary sources rather than adopted on faith —
COPPA's internal-operations exception (confirmed, with a real gap found: current FTC rule text
also requires naming the specific operations in the privacy policy), DSA Article 17/20
(confirmed), the GDPR biometric-classification argument for TTS output (directionally confirmed
against AEPD guidance, flagged as credible-not-certain since it's general guidance applied to
this case, not a ruling on a system like NODE's — the user separately confirmed reaching the
same conclusion independently), and the Epic Games retention precedent (confirmed, and turns
out more aggressive than what's proposed here). Written up as
`docs/DESIGN_MODERATION_LOGGING_2026-08-13.md`: never store rendered TTS audio (deterministic
synthesis makes it redundant), log five structured fields only to a backend service completely
siloed from the game's own simulation kernel, bifurcated 30-day-unflagged /
Dispute-Archive-if-flagged retention. **Caught and corrected the report's own now-stale
recommendation** rather than adopting it: it suggested matching this log's retention to the
diary's window "for consistency," but the diary shrank to ~2 days earlier the same session —
the doc records explicitly that these are two independently-justified systems (one legal, one
game-design) never required to track each other. No code — design only, same status as fines
economy/Oracle, waiting on proximity conversation's own engine work to exist first.

**Then: "would you agree there are many things we can build already... parked away that could
just be built instead of documented?"** Yes — named three candidates (proximity conversation,
the diary's content schema, arson), user said "let's get busy." **In progress, this same
session, tracked as tasks #66-69:**

- **#66 done**: `src/engine/diary.ts` — SUBJECT/OBSERVATION/READING/CONTEXT built exactly to
  the already-locked addendum spec, `distortDiaryEntry` wired into `privateStore.ts`'s distort
  hook (its first real consumer). 13 new tests, 490 total, typecheck clean. Full detail in
  `docs/BLUEPRINT.md`'s matching entry.
- **#67 done**: `src/comms/proximityConversation.ts` — INTENT/TONE/REFERENT/CONTEXT, presence
  gating, distance-driven degradation reusing `space.ts`'s `proximityCloseness()` +
  `decay.ts`'s `applyDistortion`. 14 new tests, 504 total, typecheck clean.
- **#68 done**: `src/infra/moderationLog.ts` (new top-level dir, deliberately siloed) —
  `captureProximityConversationEvent`, bifurcated retention (`isExpired`, 30-day unflagged /
  6-month-from-flagged Tier 2), `createInMemorySink` reference implementation. Silo boundary
  enforced by `test/moderationLog.importGuard.test.ts`, mirroring the existing driver-guard
  pattern. 9 new tests, 513 total, typecheck clean.
- **#69 done**: `src/engine/arson.ts` — `canAttemptArson` (housing doc §7.6 absence-gate),
  `resolveArsonTarget` (picked default: role-holder's workplace, grifter's abode — the
  workplace-vs-abode question was flagged open in the docs, this is a stated choice, not a
  silent resolution), `attemptArson` (thin wrapper around `ecosystem.ts`'s
  `patternSabotageAttempt`, zero new detection math). Calibrated for real against
  `sim/sabotagePatternHarness.ts`: `pPerWitness=0.02` at 6 steps lands no-Detective 32.0%
  success (mean 110 days), with Detective 18.3% (mean 171 days) — matches "30% opportunity...
  otherwise it's not worth obtaining" as a floor, clearly below sabotage's 71.1%/40.2%. New
  `sim/arsonCli.ts` (`npm run arson-sim`) is the permanent report. 13 new tests, 526 total
  (513 + 13), typecheck clean.

**All three "let's get busy" build candidates are done (#66-69).** Not built, by design, in any
of the three: the Firestarter crafting item and trespass's SUBJECT-graph read both need
`personalResourceStock`/residency-and-keys, real prerequisites flagged in their own docs, not
avoided by accident; TTS rendering and `world.ts` tick-loop wiring for both proximity
conversation and arson are client/infra concerns or need real per-tick spatial/absence data this
pass didn't have. All of this is the SAME "design+sim-verified, not yet wired to a live world"
stage sabotage itself went through before its own harness existed — a real, named stage, not a
gap.

**#66-69 all done, this session.** 526 tests total, typecheck clean. New files this build push:
`src/engine/diary.ts`, `src/comms/proximityConversation.ts`, `src/infra/moderationLog.ts`,
`src/engine/arson.ts`, `src/sim/arsonCli.ts` (`npm run arson-sim`), plus matching test files.

**Next, in rough priority order:**
1. The level-2 reputation-gate mechanism question — user hasn't specified one yet ("something
   else, tell me what to try"), still genuinely open.
2. Whether "let's explore it on each level" meant gating proximity conversation's vocabulary by
   reputation level — proposed, never confirmed, now buildable since the grammar module exists.
3. Wire what got built into `world.ts`'s real tick loop (proximity conversation, arson,
   moderation-log capture) — all four new modules are currently standalone/measurable but not
   yet driven by real per-tick world state, the same stage sabotage itself was at for a while.
4. `personalResourceStock` (blocks the Firestarter item and trespass's SUBJECT-graph read) and
   the population-scale re-simulation Oracle's own §5 needs — both real prerequisites, not
   avoided by accident.

The rest of this file below was last fully rewritten 2026-08-12 and is accurate except where
the above supersedes it (role/population numbers in "Shipped configuration" below need the
single-district update — see `docs/BLUEPRINT.md`'s 2026-08-13 entries for the real numbers;
narrative elsewhere referring to "65" as the target, or to 6 scattered districts, is now
historical).

## Current state (as of 2026-08-12, end of session)

**437 tests, all passing; `npm run typecheck` clean. Working on `main` directly.**

**The entire 2026-08-11 Design Addendum's build order (items 0/3, 1, 2, 4, 5, 6, 7, 8) is now
built and tested.** What's left from it is only its own "report back explicitly on" section —
see below, several of those questions are now directly answerable from work already done.

Built and tested before this session: Phase 1 (economic core), Phase 2 (vacancy +
conscription), the §8 MVP mechanic, the client/server scaffold with real targeted delivery,
the ecosystem-scale layer (economic floor, migration, sabotage, experience, districting),
Observatory Phases A-C (spatial primitive, unified `world.ts` kernel, synthetic drivers),
the 6-role roster + grifter pool / district consolidation / multi-shard registry / named
resources / Import-Export-and-nodules work, and 2026-08-11 addendum items 0/3, 1, 2, 4
(District Weather, Silhouette Shield, Economic Heat, uniform role completion). Observatory
Phases D-F are not started.

**This session (2026-08-12), in order:**
1. **Strengthened the grammar invariants** (`test/grammar.invariant.test.ts`) — closed a
   real coverage gap (the old test's role-word blacklist missed 4 of 6 roles and all 84
   shard-local titles), then added two rules the user specified directly in conversation, not
   derived from the brief: **no identification signature** and **no anaphora** ("I feel that
   too" is a vote on someone else's self-state, which is how agreement becomes a whip count
   without ever naming anyone). Rewrote imperative/interrogative/tense checks from word
   blacklists to one structural rule: every sentence must open "I ...".
2. **District Weather's pressure signal fixed** — its computation point in `world.ts` moved
   to after Stage 5 (comms), so `pressureSignal` reflects same-day Wall posts, not
   yesterday's.
3. **Built `engine/pressureDetection.ts`** (2026-08-12 addendum item 1) — Detective/
   Journalist pressure-cluster detection over Wall posts, mechanical not behavioural
   (constraint 3), feeding only District Weather's `tension`, never identifying a
   broadcaster. Closes a real failure mode from the newly-uploaded
   `docs/DESIGN_ADDENDUM_2026-08-12.md`: naming a pressure-broadcaster made ambient fear
   WORSE (+60%) in the historical-case model. See `docs/ADVERSARIAL_CONTAINMENT.md`'s
   "Partially closed 2026-08-12" section.
4. **Visual framework** (`docs/VISUAL_FRAMEWORK_2026-08-12.md`) — user firmly redirected a
   review of two AI-generated concept-art decks from commentary into real, actionable design
   work ("were making a game not a thought experiment"), and separately ruled out generic
   aesthetics ("I don't want one shot minecraft"). Resolved The Wall's location
   (`Shard.hubPlot`), The Market's placement (derived from Economic Heat), and the Wall's
   Emissive Soul aggregation function (spec only, reuses `pressureDetection.ts`'s window
   shape — **not yet built as code**). Caught and corrected a real privacy error in one deck
   (Envelope-sourced Soul would violate constraint 4).
5. **Built district barriers** (`engine/districtAccess.ts`) — user-specified mid-session
   ("some barriers restricting flow of movement between districts... those who can move are
   able to and others have to use the main plaza"), then explicitly instructed to build, not
   just spec. A FILLED role-holder gets a direct side-street shortcut to a real neighbor
   district (`space.ts`'s new K-nearest-neighbor mesh); everyone else, always, falls back to
   the hub route (constraint 2 — never a hard gate). Both open design questions (consolidation
   independence, no cross-player gating) closed structurally and proved by test, not just
   argued.
6. **A 9-item Design Addendum from 2026-08-11 is now fully built**
   (`docs/DESIGN_ADDENDUM_2026-08-11.md`), build order 0/3 → 1-2 → 4-8, scope discipline
   (role roster closed at six) held throughout. **Items 0/3, 1, 2, 4, 5, 6, 7, and now 8 are
   all done.**
7. **Item 5 — no money: nodules as sole root input, closed loop.** `importExport.ts`
   refactored so `nodulesReceivedToday()` is the primary function and `grainDeliveredToday()`
   is derived from it (real code structure, not parallel prose). `resources.ts` tracks
   `nodulesReceived` as a bare `ResourceFlows` field (not a 7th `ResourceName`, to preserve
   the existing 1:1 role<->resource bijection test). New hard-filter coherence test extends
   the flour/bread check down to grain/nodules; new structural test proves `resources.ts`
   defines no exchange/convert/swap/wallet/currency function. No constants changed.
8. **Item 6 — Courier pay: distance-indexed** (`engine/courierPay.ts`). Pay is now a real
   function of the Courier's own district's Manhattan distance to the shard hub (reusing
   `space.ts`'s existing geometry), not the flat `SUPPORT_ROLE_DAILY_WAGE` the other two
   support roles still use. Measured real placement before calibrating: mean route distance
   ~20 units at the shipped default, `COURIER_FEE_PER_DISTANCE_UNIT=0.075` chosen so the
   average stays near what the flat wage paid. **A real design fork, decided and documented,
   not silently narrowed**: the addendum's "commissioner-funded, real transfer" language was
   taken to require the honest-and-buildable core (pay is earned from real geometry, not an
   arbitrary flat number) rather than a literal cross-role wealth debit from Miller/Baker —
   measured that a literal debit would remove roughly a third of their COMBINED daily income,
   which is a new kind of mechanic outside this item's scope, not a fee line. See below and
   `docs/BLUEPRINT.md`'s "Item 6" entry for the full reasoning and what's left open.
9. **Item 7 — Shift Cover**, closing the brief's long-open §2.6 (`engine/shiftCover.ts`).
   Reshaped around this engine's real `BACKSTOPPED` state rather than the brief's original
   player-session concept: any grifter can be probabilistically "noticed" covering a
   BACKSTOPPED slot for one day, earning `SHIFT_COVER_FRACTION=0.4` of what that exact slot
   would have earned genuinely FILLED that day — structurally, not just measured, always a
   worse deal than holding the role, because the fraction is unconditionally under 1. The
   coordinated-abuse case the addendum asks to prove net-negative "in simulation" has no
   constructible player action to simulate (churn is a stochastic hazard, not a player
   choice, anywhere in this engine) — proved the underlying economics exactly instead
   (0.4x wage forfeits 60% of it, every single day, for any alternation pattern). See
   `docs/BLUEPRINT.md`'s "Item 7" entry for the full reasoning.
10. **Item 8 — economic throttle windows**, the addendum's last item. Verified against the
    EXISTING `DAILY_ACTIVITY_MULTIPLIER` downtime mechanic (built 2026-08-11 for a different
    stated reason) point by point rather than assumed to need new code — every requirement
    already held except window COUNT (one vs two). Resolved by splitting the same total
    dampened hours into `THROTTLE_WINDOWS_PER_DAY=2 x THROTTLE_WINDOW_HOURS=4` as real code
    structure — mathematically inert at this kernel's one-scalar-per-day granularity,
    confirmed (not just reasoned) by the fact that no existing golden value or snapshot
    needed to change. Deliberately did NOT build a second throttle mechanism on top of the
    first, which would have silently doubled dampened hours and invalidated every wealth/
    Gini/flourRatio calibration this session's history depends on. See `docs/BLUEPRINT.md`'s
    "Item 8" entry for the full reasoning.
11. **Identity resolution core-vs-periphery sweep** (`sim/identityResolutionHarness.ts`,
    `npm run identity-resolution-report`) — the addendum's last open "report back" question,
    answered with real numbers: averaged across 5 seeds, periphery role-holders take ~35%
    longer to resolve than core ones, real but noisy per-seed, and confirmed to be a pacing
    difference (periphery still reaches >85% resolved given enough time), not a structural
    exclusion. Built a synthetic Wall-posting driver to make the measurement possible at all
    (`pendingWallPosts` has no driver anywhere in the shipped kernel) — flagged as
    measurement-only, same discipline `src/sim/drivers/` already uses for its own synthetic
    policies. See `docs/BLUEPRINT.md`'s "Identity resolution core-vs-periphery sweep" entry.
12. **Item 8's report-back verification, strengthened** (`test/throttleWindowImpact.test.ts`,
    `npm run throttle-window-report`) — proved EXACTLY, not just checked against the shipped
    constant's value, that the throttle windows can never distort market-clearing dynamics:
    grain supply and demand are both linear in the activity multiplier, so `grainFactor` and
    `flourPrice` are provably invariant to it, verified numerically at multipliers 0.1 through
    2.0. Caught a real methodology bug while measuring real per-role numbers (a naive
    population-mean-at-two-points approach conflated income with role-holder turnover — fixed
    with same-slot single-day deltas), and flagged a real nuance rather than hiding it
    (Miller/Baker/Courier/Journalist's completion bonus, item 4, is NOT activity-scaled, so
    their combined income isn't a clean sample — grifters' is, and it landed at exactly the
    proven 30% cut in all 3 seeds). See `docs/BLUEPRINT.md`'s "Item 8 report-back
    verification" entry.

### 2026-08-11 addendum work, briefly (full reasoning in BLUEPRINT.md)

- **Item 0/3 — District Weather** (`engine/districtWeather.ts`): wired a field
  (`District.weatherHistory`) that had existed since Phase A but was permanently empty —
  `world.ts` never wrote to it. `tension` derives from vacancy pressure + consolidation
  state + same-day sabotage, decaying by distance, taking the strongest signal reaching a
  district rather than summing.
- **Item 1 — the Silhouette Shield** (`engine/identity.ts`): a real trigger for
  `isKnown()`, fed from real rumour-hearing events (no per-player trade ledger exists to
  trigger off instead — flagged, not invented). Deterministic procedural faces.
- **Item 2 — Economic Heat** (`engine/economicHeat.ts`): pure rendering layer over
  existing Miller/Baker/friction state — deliberately NOT stored on `World`, zero
  determinism risk.
- **Item 4 — uniform role completion** (`engine/roleCompletion.ts`): one attempt per
  FILLED day, one career ratio, for all six roles. **Caught two real bugs by measuring
  before trusting**: a flat reward-per-completion would have paid support roles ~1.9x
  Miller/Baker's expected daily bonus (their tasks have very different natural completion
  rates — 54-58% vs 97-100% — so reward had to be calibrated per role, not left flat); and
  the reward was initially applied to Miller/Baker wealth AFTER `wealthCap`, silently
  defeating a supposedly hard bound. Both fixed; see BLUEPRINT.md for the numbers.

**A user idea logged but not built**: reputation-earned plaza statues, updating on real
completion events — composes cleanly with constraint 4 (civic memory/monuments) and
constraint 6 (additive-only reputation), and naturally keys off item 4's completion signal
once that existed. Recorded in `docs/DESIGN_ADDENDUM_2026-08-11.md`'s "addendum to the
addendum" section — not scoped or built, a real forward candidate for whenever roster/scope
discipline allows revisiting rendering-layer work.

### The roles, and what each actually does economically

**Miller** (Cournot quantity) and **Baker** (Bertrand price) keep their original validated
market mechanics. **Courier, Journalist, Detective** still share a flat
`SUPPORT_ROLE_DAILY_WAGE` as their base wage — but as of item 4 that is no longer the
*whole* story: all six roles now also earn a per-role-calibrated completion reward on top,
so holding a role well is finally distinguishable from merely occupying it (see item 4
above). **Import/Export** receives nodules daily and automatically (no player action —
"automated to the miller if offline"), converting them to grain, which Millers now genuinely
require in order to mill.

**Grifters** are roleless community players — the newbie, the camper, the socially isolated.
Individually tracked (`GrifterSlot: { id, wealth, daysAsGrifter, consolidationDeadline? }`),
earning a real positive income floor, and the pool every open role is filled from. Nobody is
stuck there by design and nobody in it goes without.

### Shipped configuration, and where it came from

```
rMiller 9  rBaker 9  rCourier 7  rJournalist 7  rDetective 8  rImportExport 6   (S=46)
1 district per shard (coreDistrictCount=1, peripheryDistrictCount=0, buildingsPerCoreDistrict=62)
targetPopulation 100 (brief band was 50-80; raised 2026-08-13, user's own call — see below)
```

District count was 6 (2 core + 4 periphery) earlier the same day, then revised to 1 district
LATER the same day once real per-district population data (a bug fix away — see below) showed
1 district wins on every metric. Population beyond one settlement's natural size is handled by
opening a new *shard*, not more districts within this one — see `docs/BLUEPRINT.md`'s
"District-topology question RESOLVED" entry for the full numbers and reasoning.

**Raised from the original pop=65/S=28 default on 2026-08-13**, user's explicit decision,
after the day's design addendum turned out to cite stale numbers (traced to a pre-port Python
toy model and a pre-Import/Export sweep, both already superseded here) and its underlying
"scale districts not slots" economic claim didn't reproduce against the real engine
(`sim/populationCapacitySweep.ts`). Rather than trust either the stale addendum numbers or
the old pop=65 default used outside its calibrated range, `jointGridSearch.ts` was extended
to take a population argument (`npm run joint-grid-search screen 100` / `confirm 100`) and
re-run properly: 555 allocations screened, 6 discarded as incoherent, 8 finalists confirmed
at full fidelity across all three district layouts — every one passing the flourRatio<=1.0
hard filter. `M9 B9 C7 J7 D8 IE6` won on the same judgement the original pop=65 choice used:
balance over extremes (near-top health, tied-lowest gini among strong performers, a
comfortable flourRatio margin, shard count staying steady rather than inflating).
`DEFAULT_SHARD_CONFIG`'s building counts were raised to match exactly what that winning
layout validated. See `docs/BLUEPRINT.md`'s "Adopted (2026-08-13)" entry for the full trail,
including a real side-finding caught while adopting it: raising building count without also
re-deriving `coreSpacing`/`peripherySpacing` closed the core-vs-periphery identity-resolution
gap that used to exist at the old default — flagged, not silently absorbed.

The ORIGINAL pop=65/S=28 derivation (`npm run joint-grid-search` with no population argument,
still the default invocation): 560 allocations screened at reduced fidelity, **151 discarded
outright as incoherent**, finalists then re-run jointly against 3/6/11 districts at full
fidelity, re-run again after the consolidation defect was fixed with the incumbent explicitly
re-entered as a baseline. That process and its own numbers (population ~56/65, economicHealth
~0.87, Gini ~0.55, grifter wait ~22 days mean, 3 shards, flourRatio 0.83) are historical now —
kept here for provenance, not the live shipped behaviour.

**Live per-shard behaviour at the current defaults** (from the pop=100 confirm-phase run,
6-district layout): population ~87.4, economicHealth ~0.937, Gini ~0.629, grifter wait ~26.9
days mean, ~2.5 shards, flourRatio ~0.616. Grifter wait and Gini are both a real, modest step
up from the pop=65 numbers — not a floor breach (verified directly, not assumed), just the
honest cost of a bigger population target.

### Multi-shard: registry, consolidation, and the population fix

- **`engine/shardRegistry.ts`** — 2 initial shards, ids only ever grow, new shards open only
  when population + stability + cooldown all pass, migration destinations always bounded to
  shards that exist (preferring DORMANT, so a real arrival wakes one).
- **`engine/districtConsolidation.ts`** — per-district health as an irreversible ratchet
  (ACTIVE → CONSOLIDATING → MERGED) on **UNDER**population, with a 14-day grace period,
  trade-route friction that degrades visibly first, and a 2-week gain-a-role-or-be-drafted
  deadline for displaced holders.
- **`engine/ecosystem.ts`'s `opportunityAdjustedMigrationStep`** — the population fix.
  Emigration is damped by *open role-slots per roleless player*, so a thinning shard becomes
  worth staying in and recovers, while a full shard is unaffected (so it cannot cause runaway
  growth). Took the isolated single-shard baseline from 8.1 to 38.5/65.

### Named resources

`engine/resources.ts` tracks six named flows, one owning role each — **grain**
(Import/Export), **flour** (Miller), **bread** (Baker), **parcels** (Courier), **stories**
(Journalist), **leads** (Detective) — as per-day and cumulative totals on `World.resources`.
`npm run resource-report` prints the time series.

```
npm install
npm test                              # 473 tests
npm run typecheck

npm run joint-grid-search             # allocation x district grid (screen | confirm) — THE SHIPPED CONFIG CAME FROM THIS
npm run district-layout-comparison    # 6 vs 11 districts head-to-head, incl. the consolidation mechanism
npm run multi-shard-validation        # single-shard collapse vs multi-shard registry
npm run multi-shard-equilibrium-sweep # what sets equilibrium population, and the bifurcation
npm run resource-report               # named per-role resources over time
npm run wealth-inequality-report      # Gini/top-10% baseline + tax/cap remediation sweep
npm run identity-resolution-report    # core-vs-periphery identity resolution speed, real numbers
npm run throttle-window-report        # item 8: real measured per-role income vs. its unthrottled equivalent

npm run world-sim                     # unified kernel, one running world
npm run sim                           # Phase 1 stability-curve sweep
npm run vacancy-sim                   # Phase 2 vacancy sweep
npm run ecosystem-sim                 # economic-health / sabotage-detection comparison
npm run sabotage-pattern-sim          # pattern-based sabotage PROPOSAL — not the shipped default
npm run spatial-witness-report        # real spatial witness counts vs. the assumed flat 23
npm run mvp                           # two-Baker + rumour-mill scenario, day-by-day output
npm run server                        # WebSocket server for the Godot client

# superseded, kept for provenance:
npm run role-ratio-sweep              # old 2-role sweep
npm run district-role-sweep           # old single-shard 5-role sweep
npm run multi-shard-role-district-sweep  # hand-picked candidates; superseded by joint-grid-search
```

To see the client/server loop live: run `npm run server`, then open `client/project.godot`
in Godot 4.3+ and run the main scene (set `player_id` on Main.gd to `wren`/`sable`/`idris`).
**Still worth opening in a real editor** — the headless run confirms wire protocol and
script logic, not the GUI experience.

## What's next

**Scope directive (2026-08-11, from the user): the role roster is CLOSED at six. Not looking
to keep expanding roles — build "enough for stability and fun."** Treat that as binding: the
work below is about making what exists hold up, not adding to it. Resist the pull to add
another role or system to solve a balance problem; the last several balance problems were
solved by fixing a constant or a mechanism, not by adding anything.

**0. THE ADDENDUM'S BUILD ORDER IS COMPLETE (items 0/3, 1, 2, 4, 5, 6, 7, 8 all done,
2026-08-12).** `docs/DESIGN_ADDENDUM_2026-08-11.md` has the full brief for each;
`docs/BLUEPRINT.md` has a dedicated entry for every one under its own "Item N" heading. Two
things flagged as genuinely open rather than silently closed while building this, worth
reading before touching either area again:
- **Item 6 (Courier pay)**: the addendum's "paid by whoever commissioned the delivery" was
  read as its honest-buildable core (pay earned from real geometry) rather than a literal
  Miller/Baker wealth debit — a literal debit would remove ~1/3 of their combined income and
  is a new cross-role mechanic outside one item's scope. If a literal transfer is ever
  wanted, it needs its own calibration pass, not a quick patch.
- **Item 8 (throttle windows)**: verified against the pre-existing `DAILY_ACTIVITY_MULTIPLIER`
  downtime mechanic rather than building a second one — deliberately, since a genuinely
  second throttle would have doubled dampened hours and silently invalidated every wealth/
  Gini/flourRatio number calibrated against the single-window value. If item 8 is ever read
  as needing REAL wall-clock scheduling (specific windows at specific UTC hours, distinct
  from the daily-average blend this kernel can represent), that's `src/server/ws.ts` work
  once a real-time server exists, not something this deterministic kernel can do at all.

**What's left from the addendum is only its own "report back explicitly on" section** — and
several of those questions are now directly answerable from work already done this session,
not still open:
- Does the closed nodule loop balance long-run or accumulate/starve? Answered structurally by
  item 5's hard-filter test (`grainConsumed/grainDelivered < 1.05` across seeds/1500 days) —
  it balances, by construction and by measurement both.
- Is coordinated slot-farming genuinely net-negative? Answered exactly, not just simulated, by
  item 7: `SHIFT_COVER_FRACTION < 1` makes it net-negative on every single day, for any
  alternation pattern — a stronger guarantee than a simulated scenario could give.
- Do cross-role completion rewards land at real parity? Already answered by item 4's hard
  filter (+-30% band around the cross-role mean).
- ~~Does identity resolution produce a meaningful core-vs-periphery difference?~~ **Answered
  2026-08-12** — see `docs/BLUEPRINT.md`'s "Identity resolution core-vs-periphery sweep"
  entry. `sim/identityResolutionHarness.ts` + `npm run identity-resolution-report`: averaged
  across 5 seeds at the shipped default, periphery role-holders take **~35% longer** to
  resolve than core ones (measured ~30.1 vs ~40.4 days) — real and worth feeling, not
  negligible, though noisy per-seed (one seed of five reversed the direction). The effect is
  on SPEED only: given enough time (250 days), periphery resolution reaches >85% too, so this
  is a pacing difference, not a structural exclusion (constraint 2/6 both still hold). The
  addendum's own build order and its entire "report back" section are now fully closed.
- **Item 8's own verification was also strengthened** (it has no line in the addendum's
  "report back" section, but was checked to the same standard anyway): proved EXACTLY that
  the windows never distort market-clearing dynamics (grain supply/demand both scale linearly
  with the activity multiplier, so `flourPrice` is provably invariant to it), and confirmed
  with real measured numbers that grifter income — the one role with no completion-bonus
  contamination — lands at exactly the proven 30% reduction, in every seed tested. See
  `docs/BLUEPRINT.md`'s "Item 8 report-back verification" entry.

**1. Answer the research questions that simulation cannot.** See
`docs/RESEARCH_QUESTIONS.md`. Three of them are load-bearing and structurally invisible to
us, because **the simulation models compliance as certain** — conscripted players always
accept, grifters always wait, displaced players always take the new role. Nothing in the
model can output "the player just quit". Question 1 (how long will someone tolerate having
no role — we currently make them wait ~22 days mean, 100+ worst case) is the single largest
untested assumption in the design, and the addendum explicitly does not address it.

**2. Wire real exit-ticket accrual into Import/Export's route detection.** Crossing success
draws from an aggregate stand-in (`COMPLETE_TICKET_FRACTION`, 57%) rather than real
per-player postcard holdings. The last placeholder in an otherwise complete mechanic.

**3. Courier/Journalist/Detective's differentiated resources still feed nothing.** Item 4
gave all six roles a real completion signal and reward, so "nothing distinguishes holding
the role well" is **resolved** — but parcels/stories/leads are still produced and tracked
with no consumer. Item 5's closed loop is the natural place to decide whether they should
have one. Easiest place in the project to accidentally over-build; keep it to whatever makes
them distinct and fun to hold, not a full economy each.

**4. Shard diversity is at Tier 1 (cosmetic) and deliberately stops there.** Shards differ
in name and local role framing (`engine/shardIdentity.ts`, `npm run shard-identity-report`) —
Miller and Baker keep recognisable titles as the economic spine, the other four are reframed
locally so a migrant's knowledge is partially wrong. Mechanics are identical everywhere, and
that is enforced structurally: `world.ts` cannot import the module, and a test proves it.
**Tier 2 (per-shard mechanical differences) is blocked** on research question 10 —
`chooseMigrationDestination` assumes shards are interchangeable, so the moment they differ in
quality the simulation would report a stability it is no longer testing.

**5. Physical building relocation on MERGE.** A merged district's buildings stay in place,
permanently friction-penalised, rather than relocating capacity into a surviving district.

**6. Observatory Phases D-F** (snapshot/replay contract, the web app, civic-memory
monuments) — not started.

**Still open from before, unchanged:** `TRAVEL_DAYS_TARGET=168` vs the postcard/tier 4-8 week
target; the sabotage model decision (act-based vs the simulated pattern-based proposal — note
this one now blocks a *second* thing, since item 4's Detective task had to use a friction bar
rather than the addendum's own "catch a saboteur" example precisely because the pattern-based
model isn't shipped); real Phase 4 rendering; Phase 5 voice/safety (hard-gated on legal
review). Phase 2's §2.6 Shift Cover is **done** — see addendum item 7 above.

## Things to know before you touch this

**The flour chain is the most fragile coupling in the system — check it after any config
change.** Three separate times, a change elsewhere (adding a role, fixing consolidation,
changing district counts) silently pushed the grain→flour→bread chain incoherent, meaning
Bakers baking flour nobody milled. It is invisible to every population/health/equality
metric. `joint-grid-search` treats `flourRatio <= 1.0` as a **hard filter, not a score**,
which is the only reason it keeps getting caught — 151 of 560 allocations fail it.
`FLOUR_PER_BREAD` is the free parameter that absorbs adjustment; the role allocation is
chosen on design grounds and should not be bent to fix the chain.

**Covert mechanics must not run on learnable clocks; overt ones may.** Sabotage used to fire
on `day % sabotageCadenceDays === 0` — a covert mechanic on a public 20-day timetable, which
any player tracking dates learns in two cycles. Now a per-day hazard of `1/cadence`: identical
expected frequency (verified 1 per 20.3 days), no learnable period. The vacancy flag, backstop,
conscription delay and consolidation grace period are deliberately left deterministic — those
are civic timers and public pressure only works if the clock is public.

**Direct channels cannot carry a plan, and that is load-bearing.** An `Envelope` payload is a
single `SelfState` — ten first-person feelings, no free text, no subject, no third-party
reference. Tapping every private channel yields a distribution of moods, never intentions.
Adding free text or a subject slot for "expressiveness" would convert direct channels into an
information-brokering vector; treat that request as a containment change, not a UX one.

**The grammar's safety is STRUCTURAL, not scarcity — which is why the vocabulary can grow.**
The user has said vocabulary WILL expand (envelopes, voice, the Wall). That is fine, and
`test/grammar.invariant.test.ts` is what makes it safe: it enforces sentence *shapes* against
the whole template table, derived from source, rather than blacklisting today's ten entries.
Three rules there are load-bearing and must survive any expansion:
- **No external identification signature.** A message may never carry a referent that
  *resolves* to a specific person — no pronoun aimed at another player, no definite singular
  description ("the one I met"), no proper noun, no handle. This holds regardless of what the
  sender knows. It is the mechanical form of constraint 4 (remove the referent and no private
  dossier can be built, because nothing is captured), and what makes constraint 6 enforceable
  (the way you bury someone is by naming them to third parties).
- **No anaphora — no message may reference another message.** "I feel that too" is not a
  self-state, it's a *vote* on someone else's, and a chain of votes is a whip count built
  without ever naming anyone. Enforced lexically AND structurally: `WallPost`/`Envelope` are
  proven to carry no reply/thread/parent field, plus a source-level grep guard, because the
  other way to build a whip count is a `replyTo` field the client renders as "N people agreed."
- **Every sentence opens "I ..."** — which structurally excludes imperatives (can't instruct
  an ally) and interrogatives (can't ask a direct question), and stays true however many verbs
  the vocabulary gains. This replaced word blacklists, which go stale by construction.

**Known open hole in the above, flagged not solved: role-reference cardinality.** The design
intends role-level reference to become sayable eventually, gated on relationship-earned
reputation ("the courier is being difficult"). That is only safe when the role has enough
occupants to not resolve to a person — and Miller scarcity is a *design pillar*, so at k=1
"the Miller" IS a name, by elimination, and no linguistic dressing fixes it. Any future role
vocabulary needs a mechanical **k-anonymity guard** (only emittable when the referenced role
has ≥k live occupants in the recipient's visible scope), not just a reputation gate. No role
vocabulary exists yet; the base grammar bans all role words outright and a test proves it.

**The untouchable floor protects the powerful player as much as everyone else** — read
`docs/ADVERSARIAL_CONTAINMENT.md`'s closing section before ever weakening constraint 2 or 6
"for stakes". Destructive power is self-consuming: zeroing someone destroys years of their
investment *and* removes them as audience, rival and witness, leaving a dominator running an
empty town. The floor is what keeps people in the room, which is what makes being known worth
anything. The design does not ask ambitious players to want less; it removes the one move
that would cost them what they actually want.

**Containment of adversarial players rests on properties that are easy to remove by
accident.** See `docs/ADVERSARIAL_CONTAINMENT.md`. In short: wealth is currently a scoreboard
that buys nothing, sabotage is uniform-random and cannot be aimed at a person, roles are
single-occupancy and rotate by churn/conscription regardless of merit. Those three are what
stop a determined player taking a quiet shard apart — and two of them are **incidental**,
not designed. Making wealth spendable or sabotage targetable would each break it, and neither
would look dangerous in isolation. Re-verify containment whenever either is touched, the same
way supply-chain coherence is re-verified after a config change.

**The economy is the board, not the game — keep it computable.** All the stabilisation work
in this repo exists so players can *reason* about the world: work out what flour will cost,
when a slot opens, what a district's decline implies. Do not add hidden modifiers or
unlearnable rules to "add mystery" — the mystery is supposed to live in other people (allies
who cannot be briefed, intel that expires, witnesses who may not be there), not in obscured
arithmetic. The target is **calculable but not solvable**: a player should be able to compute
the odds and still not know the answer. See `ADVERSARIAL_CONTAINMENT.md`'s "deeper calculus"
section — it also gives the first concrete design target the Detective/Journalist roles have
had ("caught less than you succeed", as a career ratio, not a per-attempt probability).

**Stability is the floor, not the goal.** Most of this session optimised for stability, and
that work is necessary — but a perfectly stable shard is a placid idle game. Time and
migration are the antagonists; the pressure is supposed to bite. Do not treat "more stable"
as automatically better: a change that calms the equilibrium by removing pressure (longer
tenure, softer consolidation, cheaper migration) may improve every metric here while making
the game worse. Nothing in this repo measures whether anything is still at stake.

**Shard premises explain shared behaviour socially; they never imply different mechanics.**
All shards run identical constants. A premise gives a local *reason* for the same turnover
and decline (debt, shift rotation, transience, affordability), not a different rate. Test for
any new one: could this be true of a place whose numbers are identical to everywhere else?

**Miller scarcity is a design pillar, not a tunable.** Several candidates score better on
coherence margin purely by adding Millers. Those were rejected repeatedly and deliberately —
including one that was otherwise identical to the incumbent on every outcome metric.

**Two corrected errors worth not repeating:**
- *"Smaller districts trip the consolidation ratchet more often"* — **wrong**, and it sat in
  the docs as fact for a while. 11 districts merge LESS than 6 (12.1% vs 22.2%): fewer slots
  per district means the threshold needs nearly all of them empty at once.
- *Sizing a supply constant against measured demand* — the first nodule rate was set against
  grain demand measured **before** the supply gate existed, which was circular
  (`grainConsumed` derives from flour actually milled, so once milling was grain-limited the
  reported demand was itself suppressed). Measure UNCONSTRAINED demand.

**`MERGED` was an absorbing state, and the first fix was also wrong.** An irreversible ratchet
on an instantaneous threshold doomed every district within ~500 days. Requiring N consecutive
days on the *raw* fraction didn't fix it either — it produced a cliff, with healthy and
collapsing shards giving identical results. The working fix smooths the signal first (~30-day
EMA), then applies the unchanged tipping point. **Irreversibility is untouched** — only the
definition of "passed a tipping point" changed, from one bad day to sustained decline.

**A completion reward must never be applied outside the taxed/capped income flow.** Found and
fixed while building item 4: the reward was first added to Miller/Baker wealth *after*
`applyWealthCap`, so a wealth-capped world could exceed its own cap by one reward per tick —
a silent hole through a supposedly hard bound. It is now folded into the income flow itself,
before tax and cap, like every other unit of Miller/Baker income. Any future bonus, grant, or
payout on those two roles must go in at the same place. (The four support roles are outside
tax/cap scope entirely, so theirs applies directly to wealth — that asymmetry is deliberate
and commented at both sites.)

**Structural parity is not the same as realized parity — measure it.** Item 4's first design
gave every role one attempt per FILLED day and one flat reward, which *looks* like equal
opportunity by construction. Measured, it wasn't: Miller/Baker's task is zero-sum against
rivals (~54-58% completion) while the support roles' friction-bar task completes ~97-100% on
a healthy shard, so a flat reward paid support roles ~1.9x. `COMPLETION_REWARD` is calibrated
per role type as a result, and `test/roleCompletion.test.ts`'s hard filter (+-30% band around
the cross-role mean) is what keeps it honest — the same role `flourRatio <= 1.0` plays for
the supply chain. Re-measure it if any task's completion condition or the role counts change.

**Nodules are tracked outside `RESOURCE_NAMES`, deliberately.** `resources.ts`'s
`RESOURCE_OWNER` is a strict 1:1 role<->resource bijection with its own test guarding it.
Import/Export already owns `'grain'`, so nodules live as a bare `nodulesReceived` field on
`ResourceFlows` instead of a 7th named resource — don't "fix" this by promoting nodules to
`RESOURCE_NAMES`, it would break the bijection test for no real gain since nodules and grain
share one owner and one origin.

**District barriers are a shortcut on top of the hub floor, never a gate — read
`districtAccess.ts`'s header before changing who gets `hasShortcutAccess`.** The two
containment questions (does district health affect access; can one player gate another's) are
closed structurally (no import of `districtConsolidation.ts`; no per-player identity input
beyond the traveler's own status) and proved by test, not just documented. Any change that
makes access depend on anything other than the traveler's own FILLED/VACANT/BACKSTOPPED/
grifter status needs the same structural proof, not just a new comment.

**The Wall's Emissive Soul is specced but not built.** `docs/VISUAL_FRAMEWORK_2026-08-12.md`
§3 resolves its aggregation function (reuse `pressureDetection.ts`'s rolling-window shape,
shard-wide across all 10 `SELF_STATES`) but no `soulTemperature` code exists yet, and
`WALL_SOUL_WINDOW_POSTS` has no measured value. Don't assume it's live.

**Other standing notes:**
- `multiRoleConscription.ts` is a NEW function; the old 2-role `stepConscriptionDay` is
  untouched and still covered by its own tests. Don't merge them without checking both.
- `engine/economicHeat.ts` is deliberately NOT on `World` and NOT called by `stepWorld` — it
  is a pure projection over a `World` snapshot, so it cannot affect determinism or tick
  order. Keep it that way; if it ever needs to be stored, that is a real design decision.
- `engine/shardIdentity.ts` and now `engine/economicHeat.ts` are both consumed *outward*
  only. The `drivers.importGuard.test.ts` pattern (structurally proving a module isn't
  imported where it shouldn't be) exists for exactly this class of guarantee.
- `vacancyParamsFor`'s `N` uses live `world.population`, not the static target (fixed this
  session). This makes single-shard collapse look worse in isolation — expected, not a
  regression; the multi-shard registry is the actual fix.
- `wealthTaxRate`/`wealthCap` remediation stays scoped to Miller+Baker only, even though
  `wealthGini` spans all roles + grifters. An explicit, flagged scoping gap.
- Import/Export interception carries **no state between attempts** — "no learnable pattern"
  is structural, not cosmetic.
- The Oracle: deterministic outputs, no AI involvement. Presented ATM-like, lit and glowing so
  it reads positive *regardless* of payout — mechanically load-bearing, since it stops players
  reading shard health off it.
- The Baker price equation is NOT the brief's literal §1.3 equation (mean-reversion fix).
- Phase 2's beta/t_hard are recalibrated (`beta=0.03, tHard=3`) — the brief's literal values
  provably can't hit its own §2.4 targets.
- `stepMillers`/`stepBakers` throw below n=2; `stepCompetitiveLayer` freezes values instead.
- The private diary is NOT part of the decay family — hard silent TTL expiry, don't retrofit.
- Sabotage targets all roles and pushes the evicted player into the grifter pool.
- The Godot client is verified headless (2026-08-07), not yet in a real GUI editor.
- Every `[ILLUSTRATIVE]` constant carries a doc comment explaining what it was derived from.
  Read those before changing one — most are swept, not guessed.

## Documentation rules (see CLAUDE.md for the full standing instruction)

Every session: read this file first, log work in `DEVLOG.md` (successes and failures,
chronologically), keep `BLUEPRINT.md` matching actual implemented architecture, rewrite this
file at the end, keep the root `README.md`'s Status section current. Push doc updates one at
a time, not batched. `CLAUDE.md` also carries six standing design constraints binding on all
future work — check new work against them every session.
