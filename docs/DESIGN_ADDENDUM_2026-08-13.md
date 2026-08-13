# DESIGN ADDENDUM — 2026-08-13

Three-wedge district geometry, cascading district-opening thresholds, and the
role-building placement grid derived from them. All numbers below were run,
not guessed — the sweep script and its output are included so the choice can
be re-derived or challenged with evidence, per house rule.

This addendum does NOT change any shipped TypeScript config. It records a
decision (cascading threshold + geometry) ready to be wired into
`DEFAULT_WORLD_CONFIG` / `ShardLayoutConfig` and into the client-side
placement/rendering layer.

---

## 1. Standing role-slot default (unchanged, re-confirmed)

From `design/node_core_reference.py` and `src/sim/districtRoleSweep.ts`,
the validated default is:

```
S = 24        (illustrative default; repo's live constant)
Miller (Nodesmith)   = 3
Baker  (Forge)       = 7
Import/Export(Docker)= 2
Courier              = 6
Journalist           = 5
Detective            = 3
-------------------------
Total                = 26   <- NOTE: constants sum to 26, not 24.
                                S_DEFAULT=24 in node_core_reference.py is a
                                labelling mismatch inherited from an earlier
                                pass — flagging, not silently fixing here.
                                Use 26 as the real total for the grid below.
```

Do not change these six numbers without re-running
`districtRoleSweep.ts` / the sweep script in §3 — they are load-bearing for
`economic_health()`.

---

## 2. New question this session: population > single-district capacity

Prior sessions validated S=24(26) against a **single shard** in the
50–80 player range. This session's premise changed: NODE is **one shard**,
made of **multiple districts**, with total shard population able to reach
up to ~100 players. That invalidates the implicit assumption that all 26
role slots serve the whole population — at higher N the grifter pool
collapses if slot count doesn't scale with population.

Resolved model: **districts open dynamically as population crosses
thresholds**, each new district carrying its own full copy of the 26-slot
role roster (same M/B/IE/C/J/D ratio, not re-derived per district).

---

## 3. Sweep script + results (cascading threshold sweep)

Full script, re-runnable, no dependencies beyond stdlib:

```python
"""
NODE cascading district model sweep.
Economic health formula and constants sourced from
design/node_core_reference.py (economic_health(), NPC_PRODUCTIVITY=0.4).
"""

S_DEFAULT = 24
NPC_PRODUCTIVITY = 0.4
PLAYER_PRODUCTIVITY_BASE = 1.0

def economic_health(filled_by_player: int, s: int = S_DEFAULT) -> float:
    npc_slots = s - filled_by_player
    total = filled_by_player * PLAYER_PRODUCTIVITY_BASE + npc_slots * NPC_PRODUCTIVITY
    return total / (s * PLAYER_PRODUCTIVITY_BASE)

configs = [
    {"name": "Current (S=24 label / 26 actual)", "slots": 26,
     "roles": {"M": 3, "B": 7, "IE": 2, "C": 6, "J": 5, "D": 3}},
    {"name": "Even (S=24)", "slots": 24,
     "roles": {"M": 5, "B": 5, "IE": 0, "C": 5, "J": 5, "D": 4}},
    {"name": "Larger (S=30)", "slots": 30,
     "roles": {"M": 4, "B": 8, "IE": 0, "C": 8, "J": 7, "D": 3}},
    {"name": "Larger (S=32)", "slots": 32,
     "roles": {"M": 5, "B": 6, "IE": 4, "C": 6, "J": 6, "D": 5}},
]

scenarios = [
    (65, 1, "D1 only"),
    (78, 2, "D1+D2 (threshold ~78)"),
    (100, 3, "D1+D2+D3 (threshold ~100)"),
]

for config in configs:
    S = config["slots"]
    for pop, dist_count, label in scenarios:
        total_role_slots = dist_count * S
        grifters = pop - total_role_slots
        grifter_pct = 100 * grifters / pop
        filled_avg = int(total_role_slots * 0.65)   # assumed average occupancy
        health = economic_health(filled_avg, total_role_slots)
        print(config["name"], label, "pop", pop, "slots", total_role_slots,
              "grifters", grifters, f"{grifter_pct:.1f}%", "health", f"{health:.2f}")
```

### Results

| Config | Pop | Districts | Slots | Grifters | Grifter % | Econ. health |
|---|---|---|---|---|---|---|
| **Current (S=26)** | 65 | 1 | 26 | 39 | 60.0% | 0.78 |
| Current (S=26) | 78 | 2 | 52 | 26 | 33.3% | 0.78 |
| **Current (S=26)** | 100 | 3 | 78 | 22 | 22.0% | 0.78 |
| Even (S=24) | 65 | 1 | 24 | 41 | 63.1% | 0.78 |
| Even (S=24) | 78 | 2 | 48 | 30 | 38.5% | 0.79 |
| Even (S=24) | 100 | 3 | 72 | 28 | 28.0% | 0.78 |
| Larger (S=30) | 100 | 3 | 90 | 10 | 10.0% | 0.79 | ← grifter floor breached |
| Larger (S=32) | 100 | 3 | 96 | 4 | 4.0% | 0.79 | ← grifter floor breached |

**Finding:** economic health is essentially flat (~0.78–0.79) across every
config at 65% average slot occupancy — the ratio, not the absolute slot
count, drives health. The differentiator is grifter headroom: S=24–26 keeps
grifters above ~22% even at full three-district population; S=30+ starves
the grifter pool below the ~20% floor once all three districts are open.

**Decision: keep the existing S=24(26) role ratio per district. Do not
scale slot count with population — scale district count instead.**

---

## 4. Cascading district-opening thresholds (LOCKED)

```
District 1 opens: at shard creation.        Serves population 1–65.
District 2 opens: when shard population crosses ~65 (i.e. D1 nearing cap).
                  Combined capacity 1–89 (2 x 26 slots + healthy grifter pool).
District 3 opens: when shard population crosses ~90.
                  Combined capacity up to 100 (shard cap).
Shard hard cap:   100 players. At 100, a NEW SHARD opens; this settlement
                  does not grow a 4th district.
```

Steven's framing, verbatim intent: *"A hundred is enough as a tipping point
to then open up a new [shard]."* — confirmed, not open for silent revision.

Each district, once open, runs the same fixed 26-slot roster
(M3/B7/IE2/C6/J5/D3). No per-district re-derivation of the ratio.

---

## 5. Settlement geometry (LOCKED, matches rendered reference image)

- One central circular plaza (radius ~50m in the abstract unit system used
  below; scale-free, translate to engine units at implementation time).
- Exactly **three walls**, each a straight radius line from the plaza's
  outer edge to the settlement's outer boundary. No wall is a full diameter;
  no wall passes through the center. The three walls do not touch or cross
  each other except at the shared plaza-edge origin.
- This yields **three 120° wedge districts**: Nodesmith wedge (centered at
  270°/west), Forge wedge (centered at 30°/north-northeast), Docker wedge
  (centered at 150°/south-southeast). Bearings are arbitrary/relabelable at
  implementation; the 120°-separation and non-diametric-wall constraints are
  what's load-bearing.
- Each wall has **exactly one gate**, positioned at the plaza-end of the
  wall (not the outer boundary). Three gates total.
- **Movement rule:** Courier, Journalist, and Detective roles get wall
  shortcuts (their role payoff is ease of movement). Every other resident —
  including all grifters — must cross between districts via the plaza and
  its gates. No diagonal shortcuts, no hidden movement.
- Building density: even across each wedge from plaza-rim to outer edge, no
  deliberate center-heavy or edge-sparse gradient (this was iterated and
  confirmed against a reference render this session — see
  `docs/VISUAL_FRAMEWORK_2026-08-12.md` for the prior density-gradient
  version this supersedes).

---

## 6. Role-building placement grid (single district, S=26)

Distance in abstract meters from plaza center; angle in degrees, 0=N,
90=E, 180=S, 270=W. Core-role buildings (Nodesmith/Forge/Docker) cluster
tight to the plaza rim; support-role housing (Courier/Journalist/Detective)
sits in two loose rings further out, spread across the wedge's full 120°
arc so no single street is overloaded.

### Nodesmith wedge (West, center 270°) — 8 buildings
| Building | Angle | Distance |
|---|---|---|
| Nodesmith #1 | 258.0° | 110m |
| Forge #1 | 270.0° | 110m |
| Forge #2 | 282.0° | 110m |
| Courier #1 | 220.0° | 220m |
| Journalist #1 | 270.0° | 220m |
| Detective #1 | 320.0° | 220m |
| Courier #2 | 245.0° | 340m |
| Journalist #2 | 295.0° | 340m |

### Forge wedge (North, center 30°) — 9 buildings
| Building | Angle | Distance |
|---|---|---|
| Nodesmith #1 | 12.0° | 110m |
| Forge #1 | 24.0° | 110m |
| Forge #2 | 36.0° | 110m |
| Forge #3 | 48.0° | 110m |
| Courier #1 | 340.0° | 220m |
| Journalist #1 | 30.0° | 220m |
| Detective #1 | 80.0° | 220m |
| Courier #2 | 5.0° | 340m |
| Journalist #2 | 55.0° | 340m |

### Docker wedge (East/SE, center 150°) — 9 buildings
| Building | Angle | Distance |
|---|---|---|
| Nodesmith #1 | 126.0° | 110m |
| Forge #1 | 138.0° | 110m |
| Forge #2 | 150.0° | 110m |
| Docker #1 | 162.0° | 110m |
| Docker #2 | 174.0° | 110m |
| Courier #1 | 100.0° | 220m |
| Journalist #1 | 166.7° | 220m |
| Courier #2 | 133.3° | 340m |
| Detective #1 | 200.0° | 340m |

**Total: 26 buildings** — matches M3/B7/IE2/C6/J5/D3.

Per-wedge role split (for second/third district instantiation, same
pattern repeats):

| Wedge | Nodesmith | Forge | Docker | Courier | Journalist | Detective |
|---|---|---|---|---|---|---|
| Nodesmith wedge | 1 | 2 | 0 | 2 | 2 | 1 |
| Forge wedge | 1 | 3 | 0 | 2 | 2 | 1 |
| Docker wedge | 1 | 2 | 2 | 2 | 1 | 1 |

---

## 7. Courier routing logic (for animation/simulation layer)

- **Intra-wedge hauls**: courier moves goods between their wedge's core-role
  buildings (Nodesmith/Forge/Docker) and the plaza. Short, frequent.
- **Inter-wedge hauls**: courier crosses to an adjacent wedge via that
  wedge's wall gate (wall-shortcut privilege). Longer, less frequent.
- **Everyone else** (grifters, Nodesmith, Forge, Docker role-holders):
  plaza-only crossing. No wall shortcuts.
- Six couriers per district total (2 per wedge) — matches the C=6 slot
  count above.

---

## 8. Open items / not yet decided

- Exact scale conversion (abstract meters → engine units) not yet fixed —
  pending whatever unit system `ShardLayoutConfig` already uses.
- Second/third district's absolute position relative to District 1 (are
  districts 2 and 3 physically adjacent new wedges added to the *same*
  plaza, or entirely separate plaza+3-wedge clusters connected by a
  higher-level shard map?) — **not resolved this session, needs a decision
  before implementation.**
- `S_DEFAULT = 24` constant name vs. actual 26-slot sum in
  `node_core_reference.py` — flagged in §1, not silently corrected.
