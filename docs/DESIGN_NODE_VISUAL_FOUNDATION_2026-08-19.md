# NODE — Visual Foundation Brief

**Purpose of this document**: one place to stand before doing visual work elsewhere. Everything
tagged **[SHIPPED]** is real — a field, a function, a constant that exists in the engine right
now, safe to model directly. Everything tagged **[PROPOSED]** was designed in conversation this
session and has no code yet. Everything tagged **[OPEN]** is a real, unresolved question — don't
silently pick an answer while designing around it. This discipline matters more than usual here:
this brief is meant to leave the repo and go into a visual tool, where the code can no longer
correct a wrong assumption for you.

---

## 1. What NODE is

A persistent multiplayer social-economic game, no combat. The tension is structural, not
violent: you can never be sure who knows what about you, whether a price is fair or a message,
whether a vacancy is coincidence or a slow squeeze. A node holds 50–100 people — small enough
that everyone is eventually someone's business, big enough you'll never know all of them.

The world is built to sit permanently a little uphill. Never comfortable for long, never
actually collapsing. If a place starts to feel safe, that's the system telling on itself.

**The one visual rule everything else answers to** [SHIPPED doctrine, restated because it is
the whole point]: *structural beauty stays constant; colour is the only honest variable.* The
Wall and every plaza stay open, bright, architecturally beautiful regardless of how sick the
shard is. Brightness and structural integrity are never the signal — only **hue** carries the
truth. A shard in genuine crisis should look like a beautiful place having a bad day, never a
broken asset. This is the rule most likely to get quietly violated by "distressed textures under
deadline" — treat it as a hard constraint, not a vibe.

---

## 2. The settlement, as it is actually generated [SHIPPED]

One district per shard — not a design simplification, a measured result. Three geometries (1,
3, 6, 11 districts) were run against real population/health/equality data; one district won on
every metric. Population beyond what one district holds is handled by opening a new *shard*, not
more districts — see §7.

**Real, current numbers** (`DEFAULT_SHARD_CONFIG`, probed directly, not estimated):
```
1 district, radius 7, 62 buildings, 90 buildable plots
Grid: 14 x 15 (x: 0..13, y: -6..8, roughly — varies slightly per seed)
Hub: fixed at (0,0). Plaza: near the district's own centre.
Every building: 3 floors, ground floor = role function (or none), floors above = housing.
Housing capacity: 372 (62 x 6) against a real population of ~65-70 — comfortable headroom.
Model most buildings as under capacity, not lit floor-to-roof — most of the time, most
buildings have dark upper windows.
```

**Every building reads as the same footprint, 3 floors, regardless of role.** No visual size
hierarchy by role — a Mill and a Courier post are the same shape from outside. If role-specific
height ever becomes real, it needs a real code change first (`floors` is uniformly 3 today);
don't invent height variety the simulation doesn't have.

**[OPEN BUG — do not model the Wall as centred yet.]** Measured across 8 seeds: the hub
(the Wall's location) sits 6.5–10.5 units off the district's actual geometric centre, and
**zero of the ~62 buildings lie west of it** — every building is east. The plaza, not the hub,
sits near the true centre. This is a real, uncorrected bug in district-center placement math
(written for several districts ringing a hub, never updated for the single-district case). If
you build a visual layout assuming the Wall is central, it will need revisiting once this is
fixed engine-side — flagging now so the visual foundation isn't built on a coordinate that's
about to move.

---

## 3. The full data-to-visual mapping [SHIPPED — the founding law]

Every signal below is real, computed from the live simulation, not decorative. This table
originates in `docs/NODE_VISUAL_DESIGN_BRIEF_2026-08-07.md` and is extended, not replaced, by
later work — treat it as the base layer everything else sits on.

| Signal | Real source | Visual encoding |
|---|---|---|
| Role type | 6 roles: Miller, Baker, Courier, Journalist, Detective, Import/Export | Distinct hue per role, 6 clearly separable colours |
| District Weather (local mood) | per-district `tension` | Cool → warm amber/red, moving independently per district |
| Wall's Emissive Soul (global mood) | shard-wide `soulTemperature` — **spec only, not yet built** | Gold → red glow on the Wall structure |
| Economic Heat (station-level) | per-building `heat` | Glow intensity at that station — a Miller/Baker reads their own value; support roles read district friction |
| Economic Heat (district/"Market") | per-district heat mean | Foot-traffic density in the plaza |
| Identity resolution | real encounter count, per-observer | Silhouette + role icon (unknown) → deterministic procedural face once resolved |
| FILLED vs. BACKSTOPPED | role-slot state | Solid saturated outline (held) vs. dashed/desaturated (mechanical stand-in) — quieter, never broken |
| Detection / witness density | real nearby-occupant count | Ambient light/activity noise scales with REAL witness count, never a decorative crowd |
| Consolidation decline | district health ratchet (ACTIVE/CONSOLIDATING/MERGED) | Feeds District Weather; a declining district may also desaturate/thin its own structures |
| District access (barriers) | real neighbour-district mesh | Side streets as real passable routes; a gate/checkpoint for anyone routed the long way via the hub |

**The realized palette** [SHIPPED, the first real execution of this doctrine — `sim/playtestRenderer.ts`]:
called **Ember**, chosen from four explored directions. Warm, low, lamplit — the settlement
reads as a town at dusk, scarcity glows rather than alarms.
```
ground #0d0a08   panel #100c09
tension: calm #14100c -> tense #43170f   (background wash)
heat: cool #4a6b7a -> hot #ffab3e         (foreground glow)
the Wall #efdcae   plaza #b09056   street #2f2822
```
**A real, honest limitation of the current data, worth carrying into visual work**: both signals
have far less dynamic range than their 0–1 scale suggests — real measured tension sits around
0.06–0.08 most of the time, heat tops out near 0.5 and reads **exactly zero** for all four
support roles whenever the district is healthy (their heat derives from trade friction, which
mostly isn't present). A literal 0–1 mapping renders the whole town flat. The shipped renderer
auto-ranges against observed maxima rather than theoretical ones — worth the same discipline in
any other visual build, or the ambient mood will read as permanently calm no matter what's
happening.

**Refinement worth carrying forward** [PROPOSED, sharpening the existing doctrine rather than
adding a new one — reference mockups reviewed 2026-08-19]: copper is not just "the warm end of
the ramp," it should specifically be the visual signature of the *legal, witnessed, in-the-open*
state — a building doing normal trade, a route taken in daylight. Its **total absence** — not
dimming, an actual switch to desaturated blue-black — is what should mark the illicit or covert
state: a sabotage step in progress, an off-route Courier transit, a conversation happening where
no one else can see it. This is a sharper, single-axis-crossing rule than a generic cool→hot
ramp: it gives "something here is being hidden from the record" its own distinct visual grammar,
separate from "this place is merely under economic strain" (which stays on the existing
tension/heat ramp). Two different kinds of wrongness, two different visual channels — don't
collapse them into one gradient.

**Atmosphere as a literal render of the same variables, not lighting-as-mood-only**
[PROPOSED]: smoke density, haze thickness, and directional drift over a building or district can
carry the same real signals §3's table already assigns to glow and colour — e.g. smoke volume
tracking `economicHealth()`/supply-chain friction directly, the way glow intensity already does.
Treat any atmospheric particle effect as another honest channel bound to a real variable, not
scene-dressing added after the fact — the same rule §1 already states for structure, applied to
weather instead of geometry.

---

## 4. The six roles — what's actually differentiated today, and what isn't

**Real finding, checked directly against the code before writing this**: only two of six roles
currently have a real player *verb*. Miller sets a production quantity; Baker sets a price —
both real strategic choices the market visibly responds to. Every other role's "success" is
`districtFriction >= bar`, a number nobody chose today. Visually and mechanically, Courier,
Journalist, Detective, and Import/Export currently differ from each other only in a wage number
and a flavour label. This is the real, current gap — worth designing INTO the visuals rather
than papering over with cosmetic-only differentiation.

| Role | Verb today | Candidate verb [PROPOSED] |
|---|---|---|
| **Miller** | Set production quantity [SHIPPED] | — already differentiated |
| **Baker** | Set price [SHIPPED] | — already differentiated |
| **Courier** | none | Choose legal (slow, full pay, safe) vs. illegal (cheap, fast, real interception risk) transit per trip |
| **Journalist** | none | Actively work a lead toward a specific suspect — feeds the Detective's targeting (see §5) |
| **Detective** | none — their current "bonus" is presence-only, measured as active 96.5% of the time at the shipped config, i.e. effectively free | The flashlight: choose a specific building to investigate, which is what should actually grant the bonus |
| **Import/Export** | none, deliberately minimal by design ("automated if offline") | Least resolved — a routing choice (volume vs. exposure), or a role-density anonymity mechanic (below) |

**Role-density anonymity** [PROPOSED, unbuilt]: if fewer than *k* players of the same role are
visible together, the engine hides which specific one you're seeing. A crowd protection,
distinct from the encounter-based Silhouette Shield — dense role coverage earns anonymity for
free, a thinned-out role exposes its holder. Natural fit for Import/Export or Miller (the role
already kept deliberately scarce and watched).

**Floating role-glyph as the readout for "what is this person doing right now"** [PROPOSED,
reference mockups reviewed 2026-08-19]: a small diegetic icon over a character — a package for a
Courier mid-transit, a book for a Journalist working a lead — rather than a nameplate or HUD
label. This is a concrete visual mechanism for the verb gap above: the glyph should represent the
*current real action* (whichever verb column above is actually active for that player right now),
not a static per-role badge worn permanently. A Courier standing idle in the plaza shouldn't wear
the package icon; a Courier mid-route should. Treat it the same as every other signal in this
document — bound to a real state transition, never decorative.

---

## 5. The new synthesis — heat, memory, and consequence [PROPOSED, unbuilt, this session]

This is the freshest design work and the part most worth getting right visually, since it's
where "read the world, don't compute it" earns its keep.

- **Interaction itself generates ambient heat.** Trading and conversation are real, local events
  today, not just market friction — but nothing currently visualizes them as a heat *source* in
  their own right. This is genuinely new: a signal generated by what players actually do to each
  other, moment to moment.
- **Structure visibility scales with relationship, not distance.** `proximityConversation.ts`
  already splits a conversation into what survives distance-degradation longest (intent, tone —
  the *shape*) versus what drops first (referent, context — the actual content). The proposal:
  gate that same split by how well you know someone, not just how far away they are. The more
  you know a person, the more of the *shape* of their activity you can read — never the content.
- **The diary becomes a decaying connection map**, not just written entries. Who's near whom,
  who's talking to whom, among people you know — rendered as heat, redrawn daily
  (`applyDistortion`, already the diary's real ~2-day cadence), so it is a pattern to learn over
  time, never a fact to bank on. This is closely convergent with the already-designed trespass
  mechanic (`DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7): reading someone's diary reveals a
  connections-only view, freshly distorted every single read.
- **Civic pattern-memory via monuments** [logged 2026-08-11, never built]: a plaza record of who
  you were remembered as — "always gets busted," "gets away with it," "runs the economy well,"
  "highest-reputation Detective." Checked against constraint 4 (civic memory of collectively-
  witnessed events may persist) and constraint 6 (reputation only ever grants).
- **Consequence is economic only — a fine.** Getting caught costs wealth, nothing structural. The
  role, the slot, the next opportunity all stay open regardless of record. Civic memory makes the
  pattern *visible* to other players, who form their own social judgment — that's real
  consequence, but player-driven, never a system-imposed penalty. This is the version constraint
  6 actually permits; a mechanic where infamy increases system-side scrutiny would be a
  demotion by another name, and is explicitly the line not to cross.

---

## 6. Six standing constraints — bind any visual or UI design against these

Not stylistic preferences — checked, load-bearing rules from earlier work. Any visual or UI
concept should be checked against all six before it's treated as final:

1. **Simulate before trusting** — a mechanic gets real population-scale measurement before its
   visual is trusted, every time it gets new reach.
2. **No permanent zero-state, at any scale** — nothing may ever render, or mechanically produce,
   a state nothing can recover from. This is why BACKSTOPPED renders "quieter," never "broken."
3. **Minimize what's modelable** — nothing simulates belief, intent, or personality. Detection,
   pressure, and identity are all mechanical signals, never a modelled mind to read.
4. **Personal memory is mortal; civic memory is immortal.** A private diary entry decays. A
   monument, a collectively-witnessed public event, may persist. Nothing in between gets
   invented — never build a stable, permanent record of one player's private judgment of
   another.
5. **Let outcomes be real, don't script them** — no authored "which shard thrives" narrative;
   the system creates possibility and gets out of the way.
6. **Reputation may only ever grant, never remove.** No mechanic may push a player below the
   baseline visibility/access everyone holds just by being present. The worst any group can do is
   decline to elevate someone — never bury them.

---

## 7. Scale, for reference

Population beyond one district's comfortable capacity opens a new *shard*, not more districts.
Shard count is currently 2 initial, growing only once existing shards are genuinely full and
healthy — this is built and tested, just not yet visualized as its own thing (a shard-to-shard
view, migration between them, is unbuilt).
