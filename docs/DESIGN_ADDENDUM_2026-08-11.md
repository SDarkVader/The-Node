# Design Addendum — 2026-08-11 — Social Layer, Closed Economy, and Role Completion

Read `docs/HANDOVER.md`, `CLAUDE.md` (all six standing constraints), and
`docs/ADVERSARIAL_CONTAINMENT.md` before starting. Standard session rules apply: work on
`main`, log in `DEVLOG.md`, keep `BLUEPRINT.md` matching reality, rewrite `HANDOVER.md` at
the end, push doc updates one at a time.

**Scope discipline, restated and still binding: the role roster is CLOSED at six.** Nothing
below adds a role or a parallel system. Every item is either a rule on existing primitives, a
uniform layer across all existing roles, or a rendering of state that already exists. If any
item below seems to require a new role, a new currency, or a new subsystem, that is a signal
the item has been misread — stop and flag it.

**Build order matters.** Items 0-3 are foundational corrections and should land before items
4-8, because 4-8 all add flows to an economy that items 2-3 make observable.

---

## 0. Verified gap found this session (fix first)

`src/engine/space.ts` defines `District.weatherHistory: WeatherSample[]` and
`WeatherSample { tick, tension }` — the persistent per-district state that District Weather
and the Wall's Emissive Soul were blocked on. `src/world/world.ts` never writes to it. The
string `tension` does not appear in `world.ts` at all. The field exists and is permanently
empty.

This means any mechanic or view that reads "district weather" today reads dead air. It is not
a design gap any more — the slot is built. It is an unwired field. Fix it as part of item 3.

## 1. The Silhouette Shield — identity resolution as an earned state

`src/engine/player.ts` has a binary `isKnown()` primitive with no trigger condition. This
gives it one.

- A player unknown to you renders as a silhouette plus role icon only. No name, no face.
- Resolution to full identity is a state change triggered by real ledger events — verified
  trade history between the two players (a threshold number of completed transactions), or
  an established relationship already recorded in existing state. Never a timer, never a
  purchase, never a manual toggle.
- Resolution is per-pair and asymmetric-capable: A resolving B does not imply B has resolved
  A. Do not collapse this to a global "known" flag.
- Faces are deterministic procedural generation seeded from the player id. The same player
  always renders identically to everyone who has resolved them. No art pipeline, no uploaded
  images, no user-configurable appearance — configurability creates a combinatorial
  identity-management problem the design does not want, and seeded generation is consistent
  with how every other deterministic system in this repo works.

Design consequences worth preserving deliberately:

- Identity resolves faster in the core than the periphery, because trade density is higher
  there. This reproduces the "safety of the crowd" effect using the density gradient
  `space.ts` already generates, rather than adding a second mechanic to do it.
- It taxes the adversarial playbook symmetrically: a player working the periphery is harder
  to identify, but has also accumulated less relationship data with which to identify anyone
  else.

Do **not** build any reputation score here. This is identity resolution only. Constraint 6
governs reputation and item 4 is where it is touched.

## 2. Economic Heat — rendering market state, not a new mechanic

Pure presentation over data that already exists in `millers.ts`/`bakers.ts`/`resources.ts`.
No new game logic, no new hidden modifiers.

- Miller and Baker activity renders in the plaza as legible visual intensity — foot traffic
  density, radiating paths from active stations, station-level output visibility.
- Purpose: a player should be able to *read* scarcity from the plaza rather than computing it
  from numbers. Consistent with the standing rule that the economy is computable — this makes
  existing computable state easier to perceive; it must not obscure or approximate it in a
  way that misleads.
- Binding constraint on presentation: `docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` and
  `docs/DESIGN_ADDENDUM_2026-08-08.md` still govern. Colourless near-white daylight; saturated
  colour reserved for genuine heat sources.

## 3. District Weather — wire the existing field

Give `weatherHistory` a real value each tick, computed in `world.ts`'s ecosystem stage.

- `tension` (0 cool/calm .. 1 warm/tense) derives from local conflict and disruption events
  already in the model — sabotage activity, consolidation pressure, vacancy churn in that
  district. Do not invent a hidden mood variable; derive it from events the simulation
  already produces.
- Tension decays with distance from its source, thinning across districts, using the same
  distance primitive `space.ts` provides and the same decay philosophy as `comms/decay.ts`.
  Do not build a second decay system.
- Append one `WeatherSample` per district per tick. Keep history bounded.
- A player should be able to distinguish local disturbance from shard-wide condition by
  reading it.

Same visual contract as item 2 applies to how it renders.

**Status: DONE (2026-08-11).** See `src/engine/districtWeather.ts` and BLUEPRINT.md's entry.

## 4. Role completion — uniform across all six roles

The handover flags that Courier, Journalist and Detective share one flat
`SUPPORT_ROLE_DAILY_WAGE` with nothing distinguishing holding the role well from merely
occupying it. This closes that, and closes it identically for all six roles — the point is
that no role is structurally more important than another.

Structure, uniform in kind across roles, different only in content:

- Each role has standardised tasks — the same task types for every holder of that role across
  every district, so the role means the same thing everywhere.
- Tasks generate a measurable completion rate from real world state. Prefer tasks derived
  from things actually happening in the simulation (a Detective investigating a sabotage
  pattern that is genuinely running) over synthetic missions layered on top. Synthetic-
  feeling tasks break the "calculable but not solvable" contract.
- Completion rate is assessed as a career ratio, not per-attempt — the already-stated
  Detective target ("caught less than you succeed") is the model for all six.
- Reward is the same resource everyone else earns, not a second currency, calibrated so that
  equal effort and time yields equal reward across roles. Wealth stays a scoreboard; what the
  extra resource buys is optionality — the standing to attempt something (taking on a vacant
  bakery in another district), still subject to every existing constraint (courier fees,
  grain supply, distance).
- Reputational standing granted by completion is strictly additive, per constraint 6. It
  raises a floor; it never lowers anyone's.

**Required test discipline, not a design promise**: cross-role reward parity must be enforced
as a hard filter test, in the same spirit as `flourRatio <= 1.0` — three silent supply-chain
breaks are the precedent for why parity cannot be left to intention.

**Per-role sanity check before building any task**: does this task only make sense because
you hold *this specific role*? If it would work equally well as any other role's task, it is
a checklist in a costume — discard it.

## 5. No money. Nodules as the foundational input, and a closed loop

**Design decision: there is no money in NODE. There are only resources.**

- Nodules are the single external input the entire economy is downstream of. Import/Export
  already receives them deterministically; this promotes them from "one role's input" to the
  root of the chain. Nothing else enters the world from outside.
- Circularity is deliberate and load-bearing: nodules arrive → Import/Export converts →
  Courier physically moves → Miller mills → Baker bakes. No single role is the origin of
  value. This is why Miller is not the foundational principle.
- Conservation law: resources are neither minted nor destroyed. Every fee is a real transfer
  between parties, not a payment from nowhere. Anything deducted from the system returns as
  nodules — deductions repair and re-supply the economy rather than vanishing. The economy is
  a closed circulating loop, not a chain with an open end.

**Hard rule, state it explicitly so it is not "simplified" away**: resources stay
non-fungible and role-locked. The moment any resource becomes freely exchangeable for any
other at a floating rate, money has been reinvented with extra steps. Do not build a generic
currency, a universal exchange, or a common denominator "value" field.

**Risk to watch**: promoting nodules to the root makes the supply chain *longer*, and the
handover already records three silent grain→flour→bread desyncs. Extend the existing
hard-filter coherence check to cover the full nodule→grain→flour→bread chain, and treat a
break as a build failure, not a warning.

## 6. Courier pay — distance-indexed, commissioner-funded

- Courier compensation is a function of distance and time only, never of cargo value. A
  Courier cannot increase their take by choosing which cargo to carry, which removes the
  collusion incentive structurally rather than by policing intent.
- The fee is paid by whoever commissioned the delivery — a real transfer. The commissioner's
  margin is what survives after paying for distance.
- Distance cost is what makes cross-district expansion genuinely hard rather than arbitrarily
  capped. Do not add a separate artificial cap on top; the geography is the cap.

## 7. Shift Cover — offline slots as opportunity, not just backstop

Fulfils the long-open §2.6 Shift Cover item, reshaped.

- When a role-holder is offline, another player may opt in to covering that slot for a day
  and take the upside themselves — a Courier running an uncovered route, a player working a
  vacant bakery in another district.
- This is player-initiated and requires noticing. Nothing assigns it, nothing notifies.
  Watching the world is the skill being rewarded. Do not build a scheduler, a queue, or a
  notification system for this.
- Covering must always be a worse deal than holding the role properly. If covering ever
  out-earns genuine occupancy, it becomes the dominant strategy and nobody wants their own
  job. Distance cost, courier fees and newcomer pricing already do most of this work — verify
  that they actually do before adding any explicit cap.
- Coordinated-abuse case to verify against, not assume away: two players deliberately
  alternating self-created gaps to farm each other's slots. The distance/fee structure should
  make this net-negative. Prove it in simulation.

No timezone seeding, no nationality-based district assignment. This was considered and
rejected: it would make quiet-hours coverage a formally exploitable pattern for whoever
studies the seeding hardest, and real coverage in practice is a player-to-player arrangement,
not a system-assigned shift. The constrained slot-based grammar already makes translation
near-free, so no player is excluded by language. Leave coverage to the people who are
actually awake.

## 8. Economic throttle windows

- Two windows per day during which economic output drops to ~10%.
- Economy only. Conversation, plaza presence, civic memory, Shift Cover negotiation, and
  every social layer continue at full function. This is not downtime and the world is never
  unavailable — it is a period in which grinding yields almost nothing.
- Windows are public, predictable and deterministic — same category as the vacancy flag,
  backstop, conscription delay and consolidation grace period, which the handover already
  classifies as civic timers that should be learnable. Do not randomise them. (Note the
  contrast: covert mechanics like sabotage must not run on learnable clocks; this is an overt
  one, and the rule differs deliberately.)
- Intent: cap what continuous presence can extract, without asking any player to want less.
  It removes the payoff, not the option.
- Implementation should be a scheduled multiplier feeding existing market equations, not a
  new subsystem.

---

## Standing risks this addendum does not resolve

Flagged so they are not mistaken for handled:

1. **The simulation models compliance as certain.** Conscripted players always accept,
   grifters always wait, displaced players always take the new role, nobody ever quits. Every
   stability number in the 266 tests is validated against a world with no rage-quits. This
   remains the single largest untested assumption in the design and nothing in this addendum
   addresses it — see `docs/RESEARCH_QUESTIONS.md`.
2. **Supply-chain coherence gets more fragile, not less**, per item 5.
3. **Stability is the floor, not the goal.** Several items here (throttle windows, Shift
   Cover, completion rewards) calm the equilibrium. Nothing in the repo measures whether
   anything is still at stake. Do not treat improved stability metrics as proof these changes
   are good.

## Deliverables

1. `weatherHistory` actually written each tick, with distance-decaying tension derived from
   real events (item 0/3).
2. Trigger condition for `isKnown()` from verified trade history, plus seeded procedural face
   generation, per-pair and asymmetric-capable (item 1).
3. Economic Heat rendering path from existing market/resource state (item 2).
4. Uniform role-completion task/rate/reward layer across all six roles, with a cross-role
   parity hard filter test (item 4).
5. Money removed; nodules as sole root input; closed conservation loop; non-fungibility
   enforced; full-chain coherence filter extended (item 5).
6. Distance-indexed, commissioner-funded courier pay (item 6).
7. Shift Cover as player-initiated opt-in, with the coordinated-abuse case simulated and
   shown net-negative (item 7).
8. Two daily economic throttle windows at ~10% output, economy only, public and deterministic
   (item 8).
9. All existing tests still passing; `npm run typecheck` clean; docs updated per standing
   rules.

## Report back explicitly on

- What the closed nodule loop does to supply-chain coherence over a long run — does the
  return-as-nodules path actually balance, or does it accumulate or starve?
- Whether Shift Cover's distance/fee structure genuinely makes coordinated slot-farming
  net-negative, with numbers.
- Whether cross-role completion rewards land at real parity, or whether some roles generate
  far more completable task volume than others.
- Whether identity resolution via trade history actually produces a meaningful
  core-vs-periphery difference in how fast players become known, or whether the effect is too
  small to feel.

---

## Addendum to the addendum (same-conversation, not in the PDF)

The user separately proposed **reputation-earned plaza statues** — tangible, visible markers
for players who reach a certain reputation or play a role well, changing on real completion
events, as "something tangible" to show for it. Not one of the 9 numbered items above and not
built as part of this pass — logged here per the addendum's own instruction to flag rather
than quietly build anything outside its scope. It composes cleanly with what's already
binding, so it's recorded as a real forward candidate rather than shelved:

- Constraint 4 explicitly permits this category: "public, collectively-witnessed events...
  monuments... are civic memory, and the city is allowed to remember what it did." A statue
  is exactly that — a witnessed record of something the city did, not a private judgement
  about a person.
- Constraint 6 (reputation may only grant, never remove) maps directly: a statue that only
  ever gets raised or upgraded on completion, never removed or downgraded on failure, is the
  additive-only shape constraint 6 already requires. Never a "toppled statue" mechanic.
- Sits naturally on top of item 4's completion-reward layer once that lands — the same
  career-ratio completion signal that grants standing is the natural trigger for "this
  player's statue changes," not a second measurement.
- Already anticipated structurally: `docs/HANDOVER.md`'s Observatory Phase D-F list names
  "civic-memory monuments" as a not-yet-started item.

Not scoped or built this session. Revisit once item 4 has a real completion signal to key it
off, and treat "never removable, never downgradable" as non-negotiable going in, not a detail
to settle later.
