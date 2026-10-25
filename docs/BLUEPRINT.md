# Current experiment integration map — 2026-10-23

[Current experiment](research/CURRENT_EXPERIMENT.md) · [Results](research/CONTINUATION_PILOT_RESULTS_2026-10-23.md).
The live pilot is stopped after 36 decisions / 18 ticks. Further development is not a limitation
on what the experiment may become. Older detailed map entries below describe particular paths;
the following map distinguishes the current live path from legacy server and fixture paths.

| Layer | Current implementation |
| --- | --- |
| Identity and authorized context | participantWorld/observer stable people, actor-scoped references, rulesAwareContext/rulesContext and exact action schema |
| Shared-world experiment | continuationHost uses existing observer, validator and deterministic kernel |
| Own transcript | continuationConversation preserves original user/assistant prefixes and opaque provider blocks; lossless observation patches |
| Accounted dispatch | continuationRunner + ExperimentBudget + Anthropic worker; reserve before dispatch, usage before validation/action |
| Durable evidence | continuationLedger embeds verified parent events, world genesis revision, complete histories and exact journal binding |
| Replay and analysis | independent request/world/history verification, original ReplayTape replay, Inspect import without further calls |
| Separate paths | offline Inspect fixtures; paused frozen Study 1; original production broker gate remains unchanged |
| Diary and recognition | A01 authored menu entries, two-day retention/drift, v2 direct address/repeated dealings, v2 Grifter permission |
| Further work | Interface expansion and later live perception integration (see current observatory handover), transcript bounds/degradation, separately specified continuation metrics, broader live conditions, complete trespass and abodes |

The original account-origin journal and experimental grants are distinct provenance. Later zero
holds in a new grant do not erase original liabilities or establish invoice reconciliation.
The extension's 95,000-byte profile, 99,096 admitted-input bound, 2,048 output cap and USD 1 grant
are selected run settings. Original 32 KiB request paths and their contracts remain unchanged.

# NODE — System Blueprint

**A map of the architecture as it exists now.** Constants, state, data flow, invariants. No
history, no narrative, no dates except where a value's provenance matters.

The reasoning behind these choices — what was tried, measured, and rejected — is in
`docs/BLUEPRINT_HISTORY.md`. Session-by-session work is in `docs/DEVLOG.md`. Current state and
next steps are in `docs/recovery/CURRENT_SESSION.md`; `docs/HANDOVER.md` is historical background. **This file answers "what is it?" and nothing else.**

Verified against the code, not memory. If a number here disagrees with the source, the source
is right and this file is stale — fix it.

---

**Historical integration note (2026-10-20):** `src/agent/` now contains the
participant identity/host, owner-only observer boundary, durable checkpoints, replay,
accounting and bounded Responses transport. `src/eval/` and `evals/` provide the offline
Inspect harness merged through PR #21. Those original production entrypoints retain their gate. The separate accounted experiment
runners now support live inference and verified continuation; private original evidence is not
recreated by the implementation. See the current experiment map above.
See `docs/recovery/CURRENT_SESSION.md`, `docs/recovery/PR21_REVIEW_2026-10-20.md` and
`docs/DESIGN_ACCOUNTED_AGENT_EVALUATION_2026-10-20.md`.

## 1. Shape of the system

```
  ┌──────────────────────────────────────────────────────────────┐
  │  src/engine/    pure mechanics. No I/O, no state, no rng      │
  │                 ownership. Each module is one mechanic.       │
  └──────────────────────────────────────────────────────────────┘
                              ▲ composed by
  ┌──────────────────────────────────────────────────────────────┐
  │  src/world/world.ts       THE KERNEL. Owns all state and the  │
  │                           rng. One function: stepWorld(w)->w  │
  └──────────────────────────────────────────────────────────────┘
             ▲ read by                        ▲ read by
  ┌────────────────────────┐      ┌───────────────────────────────┐
  │ src/sim/   harnesses,  │      │ src/server/  worldProtocol.ts │
  │ CLIs, playtest render  │      │              ws.ts            │
  │ NEVER imported by      │      └───────────────────────────────┘
  │ engine or world        │                    ▲ WebSocket
  └────────────────────────┘      ┌───────────────────────────────┐
                                  │ client/  Godot 4.3 (GDScript) │
                                  └───────────────────────────────┘
```

**Dependency rule, enforced by tests**: `src/engine/`, `src/world/` and `src/server/` must never
import from `src/sim/drivers/` (`test/drivers.importGuard.test.ts`) or `src/infra/`
(`test/moderationLog.importGuard.test.ts`). Simulation drivers are test instrumentation, not
game content; moderation logging is deliberately siloed from the simulation.

**Determinism**: `stepWorld` is a pure function of `(World) -> World`. All randomness comes from
`World.rng` (mulberry32, seeded). Same seed + same config = byte-identical trajectory, asserted
by `test/world.regression.test.ts`. Inserting any new rng-consuming stage shifts every
downstream tick — that is a real, reviewed change, not an accident to absorb.

---

## 2. State: the `World` object

The single source of truth. Every field, grouped by what it is for.

| Group | Fields |
|---|---|
| **Identity / clock** | `seed`, `tick`, `rng`, `config` |
| **Geography** | `shard` (districts → plots, buildings, plaza; plus `hubPlot`) |
| **Role slots** | `millers`, `bakers` (`RoleEconomicSlot[]`), `couriers`, `investigators`, `importExporters` (`SupportRoleSlot[]`) |
| **Roleless pool** | `grifters` (`GrifterSlot[]`), `nextGrifterId` |
| **Market** | `flourPrice`, `resources` (`ResourceLedger`: cumulative + today) |
| **Aggregates** | `population`, `economicHealth`, `economicHealthWithExperience`, `wealthGini` |
| **District state** | `districtHealth` (ACTIVE / CONSOLIDATING / MERGED ratchet) |
| **Migration** | `lastEmigrants`, `lastNewArrivals` |
| **Comms** | `pendingWallPosts`, `lastRumourEvents`, `pendingProximityUtterances`, `lastProximityConversations`, `lastProximityRejections` |
| **Private memory** | `diary`, `pendingDiaryEntries`, `lastDiaryWrites`, `lastDiaryRejections` |
| **Social** | `identityLedger`, `completionStats`, `pressureLedger` |
| **Sabotage** | `sabotageCampaigns`, `nextCampaignId`, `lastSabotageCampaignEvents`, `lastSabotage` (legacy) |
| **Oracle** | `lastOracleStats` |
| **Settlement** | `settlement` (`districtPool`, `oraclePool`, `dock`), `lastSettlement` (per-line issuance, `emigrantHoldings`, `forfeitedToDock`, `residual`), `lastStandingBerthsFired` — `engine/settlement.ts`; withheld from the wire |
| **Day cycle** | `lastImportExportWindows` (`ImportExportWindowEvent[]`, `engine/dayCycle.ts`) |
| **Presence** | `currentlyOnline` (live snapshot, caller-set, NOT drained), `presence` (`Record<PlayerId, PresenceRecord>`, `engine/presence.ts`) |

### Slot shapes

```ts
RoleEconomicSlot {           // Miller, Baker — the two roles with a real player decision
  slot: RoleSlot             // FILLED | VACANT | BACKSTOPPED (+ vacantSince)
  buildingId: string         // also serves as the occupant's player id
  value: number              // Miller: Cournot quantity. Baker: Bertrand price.
  experience: number         // 0..EXPERIENCE_CAP
  wealth, personalResourceStock, daysSinceRestock, daysInRole
  x, y                       // position, INDEPENDENT of buildingId
}

SupportRoleSlot { slot, buildingId, wealth, personalResourceStock,
                  daysSinceRestock, daysInRole, x, y }

GrifterSlot { id, wealth, daysAsGrifter, consolidationDeadline?, districtId?,
              reputationProgress, shiftsCoveredByRole, x, y }
```

**Reset convention** (uniform across all slot types): `wealth`, `personalResourceStock`,
`daysInRole`, `experience` and position all reset the moment a slot transitions **into** FILLED —
a new occupant inherits nothing. All are frozen while VACANT/BACKSTOPPED: an empty slot has
nobody to earn, age, or stand anywhere.

**`x`/`y` are decoupled from `buildingId`.** Position is a separate fact from which slot someone
holds. Today every role-holder is initialised to their own building and the shipped `stepWorld`
never moves them, so the two coincide — but they are no longer the same field, which is what
makes movement representable at all. Only the sim-side driver applier moves anyone.

**`World.diary` is a documented exception to immutability**: the same mutable `Map` across ticks,
not cloned, because `privateStore.ts` is one server-authoritative canonical store.

---

## 3. `stepWorld` — pinned stage order

Order is load-bearing. Changing it changes every downstream number, and
`test/world.regression.test.ts` pins a golden trajectory specifically to catch that.

| Stage | Does |
|---|---|
| **1** space/occupancy | Build occupant positions, proximity graph inputs |
| **1b** district health | Underpopulation ratchet: ACTIVE → CONSOLIDATING → MERGED (irreversible) |
| **2** vacancy + conscription | Semi-Markov churn, backstop, reputation-gated voluntary fill, conscription from grifters/other roles, Shift Cover, Oracle |
| **3** market | Miller (Cournot) → grain gate → flour price → Baker (Bertrand) → wages |
| **3a-2** role completion | Miller/Baker half |
| **3c** role completion | Support-role half (friction bar) |
| **4** ecosystem | Sabotage campaigns → arrivals → migration → health/experience |
| **5** comms | Wall-post rumour propagation, proximity conversation |
| **end** | District population count, grifter housing + placement |

---

## 4. Constants, current values

Anything marked `[CALIBRATED]` was derived from measurement; `[ILLUSTRATIVE]` is a considered
guess awaiting data.

### Shipped configuration
```
DEFAULT_SHARD_CONFIG   1 district, radius 7, spacing 1, 62 buildings, targetPopulation 100
DEFAULT_WORLD_CONFIG   M9 B9 C7 I15 IE6  (S=46 role slots; I=Investigator, merged from
                       Journalist+Detective 2026-08-22, sum-preserving default not re-derived)
                       pMonthly 0.2, conscriptionDelay 14, gamma 1, noiseSigma 0.01
                       sabotageCadenceDays 20, saboteurCount 3, witnessRadius 6
                       arrivalPDaily 0.1, acquireDays 5, damagePerSuccess 4
```
Real geometry at this config: **62 buildings, ~91 plots, bounds −7..6 on both axes, hub (0,0)**.
Plots generate as a **diamond** (Manhattan ball), so the settlement's grain runs at 45°. The
plaza coincides with the hub cell.

### Economy
```
SUPPORT_ROLE_DAILY_WAGE        1.5        DAILY_ACTIVITY_MULTIPLIER   0.7
GRIFTER_DAILY_INCOME           0.5        BAKER_MAX_DAILY_CUSTOMERS   12
PURCHASE_CYCLE_DAYS            7          THROTTLE_WINDOWS_PER_DAY    2
COURIER_FEE_PER_DISTANCE_UNIT  0.344      [CALIBRATED — courier-station mean distance 4.357]
COURIER_MIN_ROUTE_DISTANCE     1          [constraint 2 — a station on the hub must still earn]
PERSONAL_RESOURCE_CAP          5          RESTOCK_INTERVAL_DAYS       3
STANDING_BERTHS_DEFAULT        1          [Import/Export slots never VACANT; WorldConfig.standingBerths, 0 disables]
```

### Settlement (`engine/settlement.ts`)
```
WorldConfig.settlement       'funded' (default) | 'legacy' (pre-settlement economy, byte-identical)
WEALTH_PER_NODULE            2.0      [CALIBRATED — legacy issuance / nodules = 2.02]
UPKEEP_RATE                  0.0073   [CALIBRATED — funded steady holdings match legacy's]
DISTRICT_POOL_RESERVE_DAYS   7        [ILLUSTRATIVE]
Funded loop: holdings --upkeep--> dock --pays for nodules--> districtPool --wages--> holdings
Wage order from districtPool: grifter floor (set aside first; shortfall issued as floorShortfall),
then role incomes pro-rata, then Shift Cover, then support completion rewards.
```
`npm run settlement-report` (8 seeds × 3000 days, burn-in 500), legacy → funded:
```
New money per tick       45.79 → 6.27     (funded: nodule value the dock couldn't cover —
                                            in one shard, what emigrants carry away)
Income paid per tick     45.79 → 45.56
Lost at role changes     37.86 → 0
Upkeep / dock→nodules    0 → 32.42 / 39.73
Total holdings           4512 → 4402      (flat early→late: 4368 → 4492)
wealthGini               0.677 → 0.325
economicHealth           0.905 → 0.914    population 62.36 → 63.06
Wages pro-rated          5.12% of ticks, mean scale 0.995, min 0.381; floor shortfall 0 ticks
Standing berth           0 / 20000 populated ticks; dormant first 10 days 75.6 vs 70.6 nodules
Multi-shard population   every seed reaches 3 shards (~252–262 people)
```

### Shard registry (`engine/shardRegistry.ts`, `sim/multiShardHarness.ts`)
```
INITIAL_SHARD_COUNT              2
SHARD_COUNT_CAP                  3      [ILLUSTRATIVE — 2 initial + 1 alternative]
SHARD_OPEN_STABILITY_THRESHOLD   0.8    (mean economicHealth of populated shards)
SHARD_OPEN_COOLDOWN_DAYS         30
canOpenNewShard: below cap AND someone exists to migrate AND stable AND cooldown passed.
                 Population size plays no part. Pure; consumes no rng.
New shards open DORMANT; migration prefers a DORMANT shard; first arrival wakes it ACTIVE.
```

### Day cycle (`engine/dayCycle.ts`, 2026-08-24) — [ILLUSTRATIVE hour placement]
```
HOURS_PER_DAY                   24
OFFLINE_WINDOWS_UTC              [0,4), [12,16)   (= wealth.ts's THROTTLE_WINDOWS/HOURS)
IMPORT_EXPORT_WINDOWS_PER_DAY    2
IMPORT_EXPORT_WINDOW_HOURS       2
IMPORT_EXPORT_WINDOWS_UTC        [6,8), [18,20)
```
Not gated against a live wall clock yet — see §9 "no real-time wall clock."

### Roles and progression
```
BACKSTOP_PRODUCTIVITY   0.4     EXPERIENCE_CAP        0.5    EXPERIENCE_GAIN_PER_DAY  0.01
SUPPORT_TASK_FRICTION_BAR  0.9
COMPLETION_REWARD       miller/baker 0.5, support roles 0.28
TYPICAL_COMPLETION_RATIO miller/baker 0.55, support roles 0.97
MAX_REPUTATION_LEVEL    2       ESTABLISHED_TENURE_DAYS 30    PERFORMANCE_BAR 0.8
HOUSING_FLOORS_PER_BUILDING 3   HOUSING_RESIDENTS_PER_FLOOR 2  (capacity 372)
LANDMARKS_PER_DISTRICT  3
```

### Sabotage / detection
```
PATTERN_STEPS_DEFAULT           6      PATTERN_STEP_CADENCE_DAYS_DEFAULT  7
PATTERN_P_PER_WITNESS_DEFAULT   0.006  PATTERN_DETECTIVE_BONUS_DEFAULT    0.15
DETECTION_P_PER_WITNESS         0.05   (legacy one-shot resolver)
IDENTITY_RESOLUTION_THRESHOLD   5      encounters
```

### Recognition v2 and individual dealings (opt-in, `WorldConfig.recognition = 'v2'`, 2026-10-21)
Absent flag ⇒ v1 above, byte-identical (G1 29/29 against archived hashes). `engine/recognition.ts`:
```
RECOGNITION_THRESHOLD 120  LOSE_BELOW 90  CAP 150  DECAY 1/day   ⇒ lapse ≈ 60 days after contact
CREDIT_ADDRESS 14 (addressee learns speaker, by intent; refusal included; silence earns nothing)
CREDIT_DEALING min(45, 7 × days since the pair last dealt); first dealing in 30 days = passive
CREDIT_OVERHEARD 1   CREDIT_WALL 2   PASSIVE_CEILING 60 (passive never resolves alone)
```
`engine/dealings.ts`: individual purchases (one per person per purchase cycle on a stable weekday,
regular Baker kept or redrawn by inverse-price share, switch chance 0.25, cap 12), flour supply
(Baker ← regular Miller by realised supply share), grain supply (Miller ← regular Import/Export,
FILLED 1 / BACKSTOPPED 0.4), deliveries (regular Courier per Baker, the Courier's own parcels
split over its deliveries), evidence (covering Investigator questions the campaign target's
occupant, its own leads split over inquiries). Mechanical slots provide with `provider: null`.
State: `world.recognitionV2` (ledger, last-dealt, regulars, Wall reach), `world.lastDealings`
(evaluator ground truth), `world.lastRecognitionChanges`. Grifters join the comms proximity graph
(not the witness graph) and hear their district's Wall. Pressure amplification uses Wall exposure
`1 − Π(1 − daily reach)` over 30 days, never the recognition ledger.

**Who can hear (owner decision D6, 2026-10-21).** In v2 the observation's `hearing` list and the
context's `hearingRefs` hold the present people within speaking range of the observer, computed by
the kernel's own rule (Manhattan distance through `proximityCloseness`, as `buildProximityGraph`
uses). The protected validator requires `hearingRefs` exactly when `rules: 'v2'` is set, and
accepts a proximity address only to someone on it. The schema's addressee enum is that list. Moves
apply after the day's speech, and only to the same body still in the same place and role episode;
the `move` effect is reported only when applied. An admitted address is therefore heard unless the
speaker or addressee changes place that day: in 40 days, 3,323 of 3,378 addresses were heard and
all 55 misses were such changes. Out-of-range addresses get the evaluator reason
`proximity_referent_out_of_range`.

**Decision schema (both versions, 2026-10-22).** Fixed values are one-value typed enums
(`{type:'number', enum:[3]}`), never `const`. Neither OpenAI's nor Google's documented
structured-output subset includes `const`. The constraint is unchanged: the schema-vs-validator
equivalence test passes.

### Oracle
```
ORACLE_BASE_ODDS_HEALTHY 0.3   ORACLE_HEALTH_REFERENCE 0.96   ORACLE_HEALTH_FLOOR 0.4
ORACLE_ODDS_FLOOR 0.05         ORACLE_ENTRY_COST 0.3          ORACLE_PARTICIPATION_PROBABILITY 0.4
```

### Measured distributions — anchor visual scales on these, not on 0..1
```
economicHealth   min 0.804  p05 0.857  median 0.909  p95 0.948  max 0.987
districtTension  min 0.00   p05 0.03   median 0.06   p95 0.10   max 0.71
economicHeat     0 .. ~0.5, and exactly 0 for all four support roles while the district is healthy
flourRatio       0.468 .. 0.503 (hard filter: must stay <= 1.0)
sabotage         42.9% success among contested resolutions, mean 29.0 days, ceiling 100
courier pay      parity ratio 1.028 vs flat-wage peers, spread 0.46 .. 1.97
```

---

## 5. Wire protocol (`src/server/worldProtocol.ts`)

Pure `World -> message` transforms, deliberately separate from socket lifecycle, because this is
a **privacy boundary** and not a serialization detail.

| Message | When | Carries |
|---|---|---|
| `hello` | once per connection | seed, hub, bounds, districts, buildings (id, x, y, role, isLandmark), plots |
| `tick` | per simulated day | day, economicHealth, districtTension[], stations[] (buildingId, state, heat), people[] (handle, x, y, role) |
| `identityResolved` | when an observer resolves a subject | handle, procedural face (no raw player id since 2026-10-21). **Built and tested; nothing sends it yet** |
| `identityLapsed` | when a resolution lapses (recognition v2) | the same handle; the client drops the face back to a silhouette |

**Inbound** (2026-08-19): `{ type: 'action', action: string, payload: unknown }`. Parsed
defensively (`parseClientMessage`, total — malformed frames return `null`, never throw), shared
by both server paths so a legacy-scenario connection and a live-world connection are handled
identically. `startWorldServer`'s `onActions(actions, tick)` reports what arrived each tick for
recording. Queue caps at `MAX_PENDING_ACTIONS = 256`.

**Inbound: the action vocabulary** (`src/server/actionVocabulary.ts`, 2026-08-24) —
`startWorldServer` only, the legacy scenario path still only echoes. Three recognized
`action` names, chosen because they're the only mechanics with real, tested,
`stepWorld`-consumed queues already: `wallPost` (`{ state: SelfState }`), `diaryEntry`
(`{ subject, observation, reading, context? }`), `proximityUtterance`
(`{ intent, tone, referent, context? }`). Every other `action` string is a silent no-op —
not an error. `authorId` is never taken from `payload`; it comes from the connection's bound
identity (`?player=<buildingId>`, a separate map from the outbound pseudonymity secret — same
"stand-in for real auth" caveat the legacy path's own binding already carries), gated by
`isFilledRoleHolder` (must currently occupy that buildingId's role slot). `parseGameAction`
validates wire shape + enum membership only (total, never throws); semantic validation
(self-reference, unresolved subject, absent referent) is NOT duplicated here —
`writeDiaryEntry`/`composeUtterance` and `stepWorld`'s own `lastDiaryRejections`/
`lastProximityRejections` already own that. Applied to `world.pendingX` BEFORE `stepWorld`
runs each tick. On this ordinary server action path those social verbs are dispatched.
The participant/evaluation path additionally admits a Baker price before demand; other
discretionary economic role inputs remain further development — see §9.

**Presence/session primitive** (`src/engine/presence.ts`) — consumed by eligibility helpers
and distinct from participant-host online snapshots. `World.currentlyOnline: ReadonlySet<PlayerId>` is a LIVE SNAPSHOT
the caller keeps current (`startWorldServer` sets it fresh each tick from the same
`identities` map the action vocabulary uses) — unlike `pendingX` fields, `stepWorld` does NOT
drain/clear it. `World.presence: Record<PlayerId, PresenceRecord>` (`online`,
`consecutiveOnlineDays`, `consecutiveOfflineDays`) is rebuilt fresh every tick from the FINAL
post-tick FILLED role-slot set, keyed by buildingId — role-holders only, grifters out of
scope. Daily-tick granularity: "online" means "connected at all on the tick observed," not
session start/end times — this kernel has no finer resolution (see `dayCycle.ts`'s own scope
note for the same current time-resolution choice elsewhere). Not exposed on the wire — see "Withheld" below. Real
consumers as of 2026-08-25: trespass and arson eligibility (both below). Still not consumed:
the login-buffer postcard system, Shift Cover, and Import/Export automation-if-offline.

**Trespass eligibility** (`src/engine/trespass.ts` + `World.isTrespassEligible`, 2026-08-25) —
`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.1's absence-gate: eligible whenever the
target is offline, or online but away from their abode. `canAttemptTrespass({ targetOnline,
targetAtAbode })` is pure (`!targetOnline || !targetAtAbode`); `isTrespassEligible(world,
targetId, targetAtAbode)` resolves `targetOnline` from real `world.presence`, returns `false`
for any target with no presence record. `targetAtAbode` stays a REQUIRED, externally-supplied
parameter — **no per-player abode-location tracking exists anywhere in this engine.**
`space.ts`'s housing constants (`HOUSING_FLOORS_PER_BUILDING`/`HOUSING_RESIDENTS_PER_FLOOR`)
are district-level capacity aggregates only, not an individual "this building is your abode"
assignment — the design doc's own §7.1 claim that this was "already representable" was wrong
against the actual codebase, corrected here rather than silently built around. This is the
SAME gap `arson.ts`'s `targetPresentAtAbode` already had; fixing abode-location tracking once
unblocks both. Only the eligibility gate is built — the trespass ACT (key item, SUBJECT-graph
reveal, witness detection) is not, see §9.

**Arson eligibility** (`World.isArsonEligible`, 2026-08-25) — wires the already-existing
`arson.ts`'s `canAttemptArson`/`ArsonPresence` onto real `World` state. **A real bug was
found and fixed before shipping, not after**: a first draft mirrored `isTrespassEligible`'s
"no presence record -> return false" literally, which made the function PROVABLY ALWAYS
FALSE — `presence.ts` only tracks currently-FILLED role holders, and a currently-FILLED role
holder always fails `targetActivelyWorkingRole` by definition (occupancy IS that signal), so
gating on "has a presence record" excluded exactly the only population that could ever pass.
Fixed: `targetActivelyWorkingRole` resolves independent of presence (`isFilledRoleHolder`
alone, always correct); online status defaults to `true` ("assume present," same conservative
direction `isTrespassEligible` already uses) only when no record exists, not the whole
function's output. Net effect: a real role holder is always ineligible (occupancy alone
decides it); a roleless target (grifter, or any vacated slot — `resolveArsonTarget` already
supports grifter targets via `abodeBuildingId`) has real eligibility driven entirely by the
caller's own `targetAtAbode` claim, since presence has no data for them at all. Same
abode-location gap as trespass, not a second one. Only the eligibility gate is wired —
`stepWorld` still doesn't call it, see §9.

**Public**: geometry, role-per-building, slot state, per-building heat, per-district tension, and
that a body is at a position.

**Withheld, always**: `wealth`, `personalResourceStock`, `experience`, `completionStats`,
`wealthGini`, anything diary-shaped, in-flight `sabotageCampaigns`, and (2026-08-24) `presence`
— knowing precisely when another player is offline is exactly the signal trespass/arson
eligibility are built to gate on; broadcasting it would hand every player a live surveillance
readout of when to strike.

**Pseudonymous**: people carry a per-connection `handle` derived from a **server-generated**
secret, so two clients see disjoint handles for the same person and cannot correlate. Real ids
never go on the wire.

---

## 6. Client (`client/`, Godot 4.3, GL Compatibility)

| Scene | Script | Purpose |
|---|---|---|
| `IsoView.tscn` *(main)* | `IsoView.gd`, `GlowLayer.gd` | Isometric 3D. Real height, lighting, emissive stations, fog, courier routes |
| `WorldView.tscn` | `WorldView.gd` | 2D top-down. Same protocol, same palette |
| `Main.tscn` | `Main.gd` | Legacy MVP-scenario scaffold (`NODE_LEGACY_MVP=1`) |
| `PerceptionWorker.tscn` | `PerceptionWorker.gd`, `Perception.gd` | Headless agent perception (2026-10-23): first person through camera frustums, raycasts and fog; isometric district overview. Answers the Node's requests; holds no world state |

`NodeGeometry.gd` holds the building, person and Wall geometry that IsoView and perception share,
so an agent is hidden by exactly what the client draws. Both clients take their endpoint from
`--world-url` / `NODE_WORLD_URL` and read the observatory's frame metadata when present.

**Signal → visual mapping** (identical rules across the terminal renderer, 2D and 3D clients):

| Signal | Carrier |
|---|---|
| Economic heat | Emissive glow at street level only — the ground floor is the role function |
| Emotional weather | The **streets**. Diverging cold-blue ← Ember → red, anchored on measured percentiles |
| Local weather | Each station bleeds its state into nearby stones: worked = warm, empty = cold, BACKSTOPPED = pale and colourless |
| Shard sentiment | The **radiance** around the Wall. Its gold substrate never changes — substrate is hope, radiance is sentiment |
| Role | A procedural glyph: on the station as a corner sign, above a person as a carried mark |
| Slot state | Brightness: FILLED 1.0, BACKSTOPPED 0.5, VACANT 0.28. Quieter, never broken |
| Courier route | A ribbon from a staffed post to the Wall — the exact distance `courierPay.ts` pays for |
| Occupancy | A role-holder at their station is *inside* it; their presence is what makes it glow |

**Doctrine**: structural beauty stays constant; colour is the only honest variable. Nothing dims,
cracks or distresses to signal decline.

---

## 7. Invariants

Checked by tests, and load-bearing:

1. **Determinism** — same seed + config ⇒ byte-identical trajectory.
2. **Population conservation** — grifters + FILLED slots account for every person, every tick.
3. **No permanent zero-state** — `economicHealth` never falls below `BACKSTOP_PRODUCTIVITY`, even
   under `saboteurCount: 8` / `cadence: 5`. No slot, player, or shard reaches an unrecoverable
   state.
4. **`flourRatio <= 1.0`** — the supply chain stays coherent.
5. **Reputation is grant-only** — no mechanic subtracts from a player's baseline access.
6. **Grifters are outside the witness graph** — adding them must not silently change sabotage
   detection. (Recognition v2 adds them to the comms proximity graph only.)
7. **No private state on the wire** — asserted by searching the serialized payload for real
   values, and mutation-tested to confirm the assertion can fail.
8. **Import guards** — engine/world/server never import drivers or infra.
9. **Settlement flow balance** — per shard per tick, (holdings + accounts) changes by exactly
   Σ issuance − Σ emigrant holdings; nothing is destroyed. Across shards, the total changes by
   Σ issuance only (vouchers arrive or go to the source dock). `test/settlement.test.ts`.
   Under 'funded' settlement, nothing is forfeited at any role change (a person's balance
   always moves with them), upkeep never takes anyone below zero, and the grifter floor is
   always paid in full.
10. **Import/Export is never fully VACANT** — at least `standingBerths` slots are FILLED or
    BACKSTOPPED at the end of every tick, so nodule issuance is never 0.
11. **An alternative shard is available regardless of population** — while anyone exists and
    shards are stable, the registry opens up to `SHARD_COUNT_CAP`, so every shard always has
    another to migrate to, and the count never exceeds the cap. `test/multiShardHarness.test.ts`.
12. **Recognition v2 reuses flows** — bread, flour and grain dealings sum exactly to
    `resources.today`; each Courier's deliveries split exactly its own parcels; passive
    channels never resolve; pressure tension is unchanged by any recognition ledger.
    `test/world.recognitionV2.test.ts`.
13. **Perception never widens what an agent knows** (2026-10-23). A perception request carries
    no real id, secret or private economic state, and only bodies within the perspective's
    reach. Every returned item must exist in the request with the same public facts and lie
    within the perspective's limits. No body is seen through walls, and an isometric answer
    holds no references. Each record is bound to its agent, tick, request and world hash.
    Policy-boundary validation, scoped schema privacy, real kernel movement and independent-worker
    agreement are covered by `test/perceptionContext.test.ts` and `test/perceptionAudit.test.ts`.
    `test/perception.test.ts`.
14. **The observatory is read-only** (2026-10-23) — displaying, scrubbing, reconnecting or
    refreshing causes no provider call and no kernel step; frames are re-derived from verified
    ledgers with every hash re-checked. `test/observatory.test.ts`.

---

## 8. Commands

```
npm test                     703 tests
npm run typecheck
npm run server                real World over WebSocket (NODE_LEGACY_MVP=1 for the old scenario)
npm run playtest              terminal renderer, synthetic drivers
npm run sabotage-campaign-sim / oracle-sim / experience-floor-sim / ... measurement harnesses
npm run settlement-report     legacy vs funded settlement: money, holdings, Gini, health, multi-shard
npm run eval:bridge           evaluation bridge (JSON lines) the Inspect harness drives
evals/: python -m inspect_node.verify --out <dir>   Inspect suite twice offline + all checks
        (see docs/EVAL_INFRASTRUCTURE.md; venv from evals/requirements.txt)
```
Godot: `godot --path client` (GL Compatibility). `NODE_SHOT=/path.png` captures a frame;
`NODE_FORCE_TENSION=0.02` renders a forced weather value for palette review.
Observatory: `npm run observatory -- verify|serve|evaluate|export-frames <registration.json>`;
`npm run observatory:demo -- <new dir>` (synthetic). Perception with the real client:
`NODE_GODOT_BIN=<godot> npx vitest run test/perception.test.ts`. See `docs/observatory/README.md`.
Audited mechanics-aware readiness: `npm run perception:verify -- --out <NEW private directory>`.
Existing framework sample imports: `python -m inspect_node.observatory_export` with `PYTHONPATH=evals`;
see `docs/observatory/SAMPLE_EVALUATION_IMPORT.md`. The sample API is independent of world ticks.

---

## 9. Known gaps

- **No action vocabulary.** The inbound pipe is real (§5); nothing reads `action`/`payload` yet.
  Deliberately undesigned — a later, separate design session, not an engineering default.
- **No player entity.** `player.ts` is a session-scoped id; "a player" is still a `buildingId`.
- **Nothing moves role-holders in the shipped world** — only the sim-side driver applier does.
  Whatever changes that owes a witness-count re-measurement.
- **`identityResolved` has no sender** — needs per-connection observer state.
- **No role has a real player-input slot in the engine yet, corrected 2026-08-24.** Courier,
  Investigator and Import/Export all reduce to `districtFriction >= bar` — no decision point.
  Miller (quantity) and Baker (price) were previously described here as "making a decision,"
  which turned out not to be checked: `stepMillers`/`stepBakers` are 100% algorithmic
  best-response dynamics with a noise term — no parameter exists anywhere for a player-supplied
  override. Shift Cover and Oracle entry are the same shape (grepped, no opt-in/pending hook
  exists) despite §2's own table implying otherwise. See §5's "Inbound: the action vocabulary"
  for what DOES now take real player input (three comms actions, none of these five roles).
  (Investigator does have one real mechanic — a FILLED Investigator sets `investigatedBy` for
  sabotage in its own district — but that's occupancy-driven, not a player decision.)
- **Crafting items** (Key, Firestarter, Theft-tool) designed, not built.
- **Arson** built and calibrated, not wired into `stepWorld`. Its eligibility gate IS wired
  to real `World` state now (`World.isArsonEligible`, 2026-08-25, §5) — but the act itself
  (Firestarter item, real per-tick witness pass) is not.
- **No per-player abode-location tracking anywhere.** `space.ts`'s housing constants are
  district-level capacity aggregates, not an individual "this building is your abode"
  assignment — confirmed 2026-08-25 while wiring trespass eligibility, contradicting the
  housing design doc's own §7.1 claim that this was already representable. This is now the
  concrete shared blocker for both trespass's `targetAtAbode` and arson's
  `targetPresentAtAbode` becoming fully real rather than caller-supplied.
- **The Inspect evaluation harness (`src/eval/`, `evals/`) runs scripted fixtures only.** Live
  model calls through Inspect are refused because they would bypass the accounted broker and
  budget ledger; routing them through that accounting is unbuilt. The 29-sample suite
  controls one Baker per episode. The authority-attribution construct (2026-10-20) uses
  `MultiActorEpisode`: seven controlled inhabitants in one world, all admitted actions in a
  single `stepParticipantState` per tick, classified by a hash-bound contract. See
  `docs/EVAL_INFRASTRUCTURE.md` and `docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md`.
  Live study calls run only through the TypeScript accounted runner (`src/eval/accountedRunner.ts`).
  It routes by model id: `claude-*` goes to the Anthropic Messages translation, anything else to
  OpenAI Responses. It reserves the bytes actually sent. The allowance books at the carried
  allowance's own rates, or, for a different model, only at a reviewed entry in
  `src/agent/modelPricing.ts` backed by a hashed evidence excerpt (2026-10-22, D11: study 1 on
  `claude-haiku-5-5`). Every PowerShell worker needs PowerShell 7, which is checked before any
  reservation.
- **The literal "commissioner-funded" courier transfer** — a real cross-role wealth debit — was
  never built; courier pay is derived, not transferred.
- **The shard count is a fixed cap (`SHARD_COUNT_CAP` = 3), not a growth signal.** Alternative
  shards no longer depend on population, but the registry never grows past the cap. Every
  materialised shard runs its own arrival process, so an uncapped opening rule grows simulated
  population with shard count (measured: 31 shards and ~1,080 people in 1,000 days). Growing
  the world past 3 shards is a design decision about how many places exist; it is not built.
- **`wealthGini` roughly halves under funded settlement** (0.68 → 0.32): savings carried
  through role changes plus proportional upkeep compress inequality. A real consequence of
  the design, measured, not tuned away — whether it's the intended feel is a design call.
- **The currency question** (`DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md` §5, options A/B/C)
  is still open. Funded settlement moves wealth only through system postings — no
  player-to-player transfer verb exists.
- **The live server has no real-time wall clock.** `ws.ts`'s `tickIntervalMs` defaults to
  2500ms and every tick advances the whole deterministic economy by one full game-day — no
  anchoring to real UTC hours anywhere on the live path. `NODE_BUILD_SPEC_2026-08-07.md`
  already "confirmed" 1 tick = 24 real hours, aligned to server reset; never built. §4's
  `dayCycle.ts` windows (offline, Import/Export) are real UTC-anchored hour ranges at the
  deterministic-kernel level, but nothing gates a live connection or action by them yet —
  that needs this server-cadence change plus the item below. (2026-08-24, explicit
  user-scoped follow-up, not started.)
- **Presence/session primitive exists (2026-08-24) with two real consumers now** (trespass
  and arson eligibility, both 2026-08-25). `World.currentlyOnline`/`World.presence` (§5) are
  real, tested, wired from the live server's real connections. Still not consuming it: the
  login-buffer postcard system, Shift Cover's live triggering, and Import/Export
  automation-if-offline. Also still true: presence only tracks currently-FILLED role
  holders — it has NO data for grifters or vacated slots, which is why arson's eligibility
  gate could only ever be half-wired (see above and §5's "Arson eligibility"). `player.ts` is
  still 22 lines, unchanged; presence lives entirely in `World`, not there.

The [current Claude interface handover](observatory/CLAUDE_INTERFACE_HANDOVER_2026-10-24.md)
maps implemented ledger, framework, mechanics-aware policy and Godot interfaces. The original
[design handover](research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md) remains provenance. The
current standalone world server creates its own world; it must not be labelled the experiment.

## Secure society opt-in (25 October 2026)

The society contract adds no default WorldConfig switch: stepWorld's optional third trusted
SocietyEconomyPlan argument supplies committed quotes, quantities, per-person customer choices
and support work. Old callers follow the unchanged path. Participant state accepts that plan
as an optional fourth argument. World.societyEconomy records actual receipts and physical
flows only for this path. src/society/runtime.ts owns phase/commitment state, current-view
projection, deterministic policies, explicit Oracle opportunities and exact private tapes.
The full society hash binds world, registry, opportunities, phase, commitments and Wall state.

See research/SECURE_AGENT_SOCIETY_2026-10-25.md for public role/action semantics and the
bounded approval/accounting/egress contract. No provider or credential reaches the kernel.
