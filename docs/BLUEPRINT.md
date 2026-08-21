# NODE — System Blueprint

**A map of the architecture as it exists now.** Constants, state, data flow, invariants. No
history, no narrative, no dates except where a value's provenance matters.

The reasoning behind these choices — what was tried, measured, and rejected — is in
`docs/BLUEPRINT_HISTORY.md`. Session-by-session work is in `docs/DEVLOG.md`. Current state and
next steps are in `docs/HANDOVER.md`. **This file answers "what is it?" and nothing else.**

Verified against the code, not memory. If a number here disagrees with the source, the source
is right and this file is stale — fix it.

---

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
| **Role slots** | `millers`, `bakers` (`RoleEconomicSlot[]`), `couriers`, `journalists`, `detectives`, `importExporters` (`SupportRoleSlot[]`) |
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
DEFAULT_WORLD_CONFIG   M9 B9 C7 J7 D8 IE6  (S=46 role slots)
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
```

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
| `identityResolved` | when an observer resolves a subject | handle, playerId, procedural face. **Built and tested; nothing sends it yet** |

**Inbound** (2026-08-19): `{ type: 'action', action: string, payload: unknown }`. Parsed
defensively (`parseClientMessage`, total — malformed frames return `null`, never throw), shared
by both server paths so a legacy-scenario connection and a live-world connection are handled
identically. **`action`/`payload` are carried, never interpreted** — the vocabulary is
undesigned by intent. `startWorldServer`'s `onActions(actions, tick)` reports what arrived each
tick for recording; `stepWorld` reads none of it. Queue caps at `MAX_PENDING_ACTIONS = 256`.

**Public**: geometry, role-per-building, slot state, per-building heat, per-district tension, and
that a body is at a position.

**Withheld, always**: `wealth`, `personalResourceStock`, `experience`, `completionStats`,
`wealthGini`, anything diary-shaped, and in-flight `sabotageCampaigns`.

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
   detection.
7. **No private state on the wire** — asserted by searching the serialized payload for real
   values, and mutation-tested to confirm the assertion can fail.
8. **Import guards** — engine/world/server never import drivers or infra.

---

## 8. Commands

```
npm test                     703 tests
npm run typecheck
npm run server                real World over WebSocket (NODE_LEGACY_MVP=1 for the old scenario)
npm run playtest              terminal renderer, synthetic drivers
npm run sabotage-campaign-sim / oracle-sim / experience-floor-sim / ... measurement harnesses
```
Godot: `godot --path client` (GL Compatibility). `NODE_SHOT=/path.png` captures a frame;
`NODE_FORCE_TENSION=0.02` renders a forced weather value for palette review.

---

## 9. Known gaps

- **No action vocabulary.** The inbound pipe is real (§5); nothing reads `action`/`payload` yet.
  Deliberately undesigned — a later, separate design session, not an engineering default.
- **No player entity.** `player.ts` is a session-scoped id; "a player" is still a `buildingId`.
- **Nothing moves role-holders in the shipped world** — only the sim-side driver applier does.
  Whatever changes that owes a witness-count re-measurement.
- **`identityResolved` has no sender** — needs per-connection observer state.
- **Four of six roles have no player verb** — Courier, Journalist, Detective and Import/Export all
  reduce to `districtFriction >= bar`. Only Miller (quantity) and Baker (price) make a decision.
- **Crafting items** (Key, Firestarter, Theft-tool) designed, not built.
- **Arson** built and calibrated, not wired into `stepWorld`.
- **The literal "commissioner-funded" courier transfer** — a real cross-role wealth debit — was
  never built; courier pay is derived, not transferred.
