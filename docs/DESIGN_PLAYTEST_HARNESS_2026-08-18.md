# DESIGN — Terminal playtest harness, and what it unblocked

**Status: design only, no code.** Scoped 2026-08-18 in response to the user's own framing:
*"I really need to get to the position where I can play test the game and design the precise
gameplay from experience and what's fun, rather than assuming simulations will do so."*

That sentence is the reason this document exists. Every mechanic in this repo so far has been
validated by simulation against a deterministic baseline — which is the right discipline for
*economics*, and the wrong instrument entirely for *feel*. Nothing built here has ever been
looked at. This scopes the smallest real thing that changes that.

Two answers were locked in the same conversation and are recorded here because the harness
exists partly to test them (full detail in §5):

1. **Forced self-ID at the Wall resolves via a new confession grammar** — a separate, narrow
   grammar entry, the only place a player can ever name themselves, unlocked only once marked.
   The existing "no identification signature" Wall invariant stays intact for everyone else.
2. **The Detective's flashlight is a real targeted action**, not a visual skin on the existing
   ambient bonus — a pending-queue mechanic in the same shape as `pendingDiaryEntries` /
   `pendingProximityUtterances`, where the Detective selects a specific suspect and *that* is
   what sets `detectiveActive` for that campaign.

Answer 2 turns out to be blocked by a real architectural fact. See §4 — it is the single most
important finding in this document.

---

## 1. The measurement that de-risks this: the shard is tiny

Probed directly against a real `createWorld(1, DEFAULT_WORLD_CONFIG)` rather than estimated:

```
district core-0 (core) radius=7
  plots:     90    x:[0..13]  y:[-6..8]
  buildings: 62    x:[0..13]  y:[-6..8]
  plaza: (7,1)     hub: (0,0)
population: 100    grifters: 54
commsProximityRange: 10    witnessRadius: 6
```

**The entire shard is a 14 × 15 grid.** At the shipped single-district config there is nothing
else — one district *is* the settlement (`BLUEPRINT.md`'s "District-topology question
RESOLVED"). 62 of 90 plots carry a building, so it renders as a dense little town, not a
sparse scatter.

This kills the only risk that could have sunk the approach. A 14 × 15 grid at 2 terminal
columns per x-unit is **28 × 15 characters** — roughly square once the ~2:1 cell aspect ratio
is accounted for, and small enough to sit inside an 80 × 24 terminal *with a status panel
beside it*.

**A correction to earlier verbal advice, recorded rather than quietly dropped**: half-block
(`▀`) sub-cell rendering was suggested before this was measured, to double vertical
resolution. On real numbers it is the wrong technique here — the world is a coarse grid of 90
discrete plots, not a continuous field, so one plot should map to one chunky cell. Half-blocks
would buy sub-plot detail that carries no game state. Skip them for the map. (They stay
relevant if a smooth ambient gradient *between* plots is ever wanted.)

## 2. Why the terminal is a genuinely good instrument for this game

Not a consolation prize. Three things already in the repo make it a real fit:

- **`engine/economicHeat.ts`** already returns `buildingId → heat [0,1]`, and its header is
  explicit that it is a pure read-only projection, "deliberately NOT stored on `World` or
  computed inside `stepWorld`... it cannot affect determinism, tick order, or any existing
  test in this repo." A renderer consuming it is additive by construction. This is exactly
  the relationship the harness wants and it was built two weeks before anything needed it.
- **`engine/districtWeather.ts`**'s `tension` uses **the same 0..1 scale on purpose** —
  `economicHeat.ts` says so directly: "the same scale District Weather's `tension` uses,
  deliberately, since both feed the same visual contract." Two mood fields, one colour ramp.
- **The design's own visual language is already ambient**, not representational: *"a player
  should be able to read scarcity from the plaza rather than computing it from numbers."*
  And `ecosystem.ts` already specifies slot rendering — *"player-held vs. backstopped slot →
  solid saturated outline vs. dashed/desaturated outline, quieter never broken."*

A terminal is bad at pictures and good at **fields of mood over a coarse grid**. That is
precisely what NODE asks for. Reference points for the honest quality ceiling: *Cogmind* and
*Caves of Qud* — both entirely turn-based, both unmistakably atmospheric.

**Second correction to earlier advice**: 20–30fps ambient animation was mentioned. Not needed
and slightly wrong-headed — `stepWorld` is a **daily tick**, so the harness is turn-based by
nature. Repaint on state change, not on a frame clock. Any ambient shimmer is decoration
layered on top, not the interaction model.

### What is genuinely out of reach

No art, no texture, no camera, nothing tactile. Horizontal resolution is one cell per plot.
The harness can carry **mood, tension, and legibility** — enough to answer *"does getting
marked feel bad, does the walk of shame land, is the Detective's job interesting"* — but it
will never answer *"is this beautiful."* That question waits for the Godot client.

## 3. Scope, in three phases

Deliberately phased so each stops at something real, and so nothing here blocks on the
sabotage restructure in §4.

### Phase A — the viewer (no new game mechanics at all)

`src/sim/playtestCli.ts` (+ a `playtest` npm script). A repainted frame over the alternate
screen buffer, driven by the **existing, already-shipped** world:

- Map pane: 28 × 15, one plot per 2 × 1 character cell. Building glyph by role, plaza and hub
  marked. Cell background = district `tension`; building foreground = `computeEconomicHeat`.
  Slot state renders per `ecosystem.ts`'s existing stated contract — FILLED solid/saturated,
  BACKSTOPPED dim, VACANT dimmest. Never absent, never "broken."
- Status pane: day, population, `flourPrice`, `economicHealth`,
  `economicHealthWithExperience`, grifter count, and a short event feed fed by the `last*`
  fields `World` already exposes (`lastSabotage`, `lastRumourEvents`, `lastDiaryWrites`,
  `lastProximityConversations`, `lastOracleStats`).
- Input: `space` steps one day, `q` quits. That is the whole interaction.

Raw-mode stdin (`process.stdin.setRawMode(true)`), 24-bit truecolor, alternate screen buffer,
cursor addressing. No dependencies — all of it is ANSI escapes and `process.stdout.write`.

**This is the phase that answers "can the terminal carry the vibe."** It is worth building
before betting anything else on the answer, and it is useful even if the answer is "no."

### Phase B — inspection

Cursor movement (`hjkl`/arrows) and selection. Selecting a building shows its real state:
role, slot state, `experience`, `daysInRole`, `wealth`, `personalResourceStock`,
`completionStats`. Still strictly read-only against `World` — no new mechanics, no writes.

This is where the game becomes *legible* rather than merely visible, and it is the natural
substrate for every later action (an action is "select a target, press a key").

### Phase C — the first real action

Where it stops being a viewer. The flashlight is the intended first action — and it is
**blocked**. See §4.

## 4. The blocking finding: sabotage campaigns are not persistent state

`engine/ecosystem.ts`'s `patternSabotageAttempt()` resolves an **entire campaign inside a
single function call**:

```ts
for (let k = 1; k <= stepsRequired; k++) {
  const p = patternStepDetectionProbability(k, stepsRequired, witnesses, detectiveActive, ...);
  if (rand() < p) return { succeeded: false, caughtAtStep: k };
}
return { succeeded: true, caughtAtStep: null };
```

`detectiveActive` is a **parameter fixed for the whole campaign at the moment of the call**.

The consequence is structural, not cosmetic: **a Detective cannot intervene mid-campaign,
because a campaign has no "mid."** It begins and ends within one call. The locked answer —
"Detective selects a specific suspect, and that is what sets `detectiveActive` for that
campaign" — cannot be built on this function as written. There is nothing in flight to point
a flashlight at.

This also revises a claim made earlier in the session. Promoting pattern-based sabotage to
shipped-default status was described as unblocking arson and being roughly a swap of one
resolver for another. **That was wrong.** It is a restructure:

- `World` gains persistent `sabotageCampaigns` — each with `targetBuildingId`,
  `stepsCompleted`, `stepsRequired`, the day its next step falls due, and (once the flashlight
  exists) which Detective is investigating it.
- `stepWorld` gains a stage that advances due campaigns by one step per cadence interval,
  rolling `patternStepDetectionProbability` per step against *live* witness counts, instead of
  resolving everything at once against a single frozen snapshot.
- `patternSabotageAttempt()` itself is kept — it is exactly the right thing for
  `sabotagePatternHarness.ts` to keep calling — but stops being what the live world uses.

Two consequences worth stating plainly. First, the measured calibration (71.1% / 55 days
without a Detective, 40.2% / 85 days with one) was produced by the one-shot resolver against a
*fixed* witness count; a live stepper rolls against witness counts that move as slots fill and
vacate, so **those numbers do not automatically carry over and must be re-measured** — the
"simulate before trusting" constraint applies to the restructure itself, not just to its
inputs. Second, the caught-saboteur consequence gap (flagged as a KNOWN GAP in `ecosystem.ts`
for both resolvers, resolved in neither) is no longer deferrable: the walk-of-shame design
*is* that consequence, so it gets decided here rather than carried forward a third time.

**Sequencing conclusion.** Phases A and B depend on none of this and can proceed immediately
against the world as it already exists. Phase C waits on the campaign restructure. Building
the viewer first is therefore not just safe ordering — it means the sabotage rework lands in
something you can already watch, which is the entire point of the exercise.

## 5. Consequence design as it currently stands (for reference, not yet built)

Recorded so the harness has a target to render toward. Not fully settled.

- **Two independent consequence tracks**, per the user's clarification that the Oracle visit
  *"is just to allow the player to unblock their abode... doesn't have to be self
  identification"*:
  - *Functional, private, immediate* — abode locked, cleared early by visiting the Oracle,
    cleared eventually by a timer regardless. No starvation. The timer is what keeps this
    inside constraint 2 (no permanent zero-state) and it was the user's own instinct, not a
    constraint imposed after the fact.
  - *Social, public* — the walk of shame: forced identification at the Wall via the new
    confession grammar, then a fine. This is the track that makes community standing worth
    anything: *"if it's just a fine and fuck off, then it's not felt."*
- **Constraint 6 compliance** (reputation may only ever grant, never remove): neither track
  subtracts from `reputationProgress` or any level. Exposure is a separate channel — closer in
  shape to the Silhouette Shield's existing forced-resolution logic than to reputation. This
  needs to *stay* built that way; "reputation −1" is out of scope by rule.
- **Constraint 4 fit**: a forced public identification at the Wall is a collectively-witnessed
  civic event, which is exactly the category permitted to persist.

### Still open

- Whether the two tracks are tiers of one escalation (mild = lockout only; severe = lockout +
  Wall) or fire independently.
- Whether the fine scales up or down with reputation level.
- Whether the Journalist's lead extends the already-built `pressureDetection.ts` signal or is
  a new ability.
- The caught-saboteur consequence in the engine sense (§4), which these tracks now have to
  answer.

## 6. Verification

Phase A is verified by **looking at it** — that is the entire point, and no test asserts
"feels right." What *is* testable, and should be:

- The renderer is a pure projection: rendering a `World` never mutates it, and a seeded run
  stepped N days with the renderer attached produces byte-identical state to one without.
  This mirrors the guarantee `economicHeat.ts` already documents about itself.
- Layout math holds at the shipped config (every one of the 90 plots maps to a distinct cell;
  nothing renders off-grid).
- Graceful degradation on a terminal narrower than the map, and with truecolor unavailable.
