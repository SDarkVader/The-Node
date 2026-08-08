# NODE — Visual Design Brief
## For handoff to Claude Design, an image generator, or a video generator

**Purpose of this document:** everything below is written so it can be handed to a
different tool than the one producing this document — Claude Design's animated
isometric renderer, a still-image generator, or a video/motion generator — and used
directly, without the recipient needing the full simulation trail behind it. Where a
number or a rule is stated, it comes from an actual simulation already run (see
`NODE_FOUNDATION.md` / `NODE_ARCHITECTURE.md`), not an aesthetic guess.

---

## 1. The one-line brief

**A node city, not any city.** An organic isometric settlement built from many small,
glowing, color-coded tiles, clustered the way real settlements cluster — dense at the
center, thinning irregularly outward, connected by streets that go *between*
neighborhoods, not just from a hub to a rim. It should read immediately as alive,
data-driven, and slightly uncanny — a place governed by rules a viewer can half-sense
without being told them outright.

---

## 2. What didn't work in the first pass, stated plainly

An earlier isometric prototype (Claude Design, screenshots provided) was too small in
scale, too linear/grid-like, had no landmarks, and no side streets — it read as a
diagram wearing city clothes rather than an actual place. Specific corrections:

- **Scale:** the settlement should feel large enough to get lost in — dozens to
  hundreds of visible structures, not a tidy cluster that fits in one glance.
- **Organic, not linear:** no perfect rings, no evenly-spaced grid, no radial
  symmetry. Real settlements grow unevenly — dense old cores, sprawl in some
  directions more than others, gaps and dead ends.
- **Landmarks:** the city needs 3-5 structures that are visibly *not* ordinary role
  stations — larger, differently shaped, differently lit, functioning as the things a
  player would use to orient themselves ("meet me near the Watchtower").
- **Side streets:** connective paths between neighborhoods that don't pass through the
  center — genuine alternate routes, not just spokes.

---

## 3. The data-to-visual mapping — this must be systematic, not decorative

Everything visual should trace back to a real mechanic. This table is the actual
translation layer any generator or artist should work from:

| Mechanic (from the simulation trail) | Visual encoding |
|---|---|
| Role type (Farmer, Miller, Baker, Smith, Miner, Healer, Courier, Watchman) | Distinct hue per role — 8 clearly separable colors, warm-to-cool spread so no two are confusable at a glance |
| Local activity/economic health (§8, `NODE_FOUNDATION.md`) | Glow radius and brightness around each structure — a real heatmap, brighter = more active, not just prettier |
| Player-held vs. NPC-backstopped slot (Layer 1, the indestructible floor) | Solid, saturated outline = player-held. Dashed or desaturated outline = NPC-run baseline. The NPC-run state should look quieter, never broken — a shard running on the 40% floor is dim, not ruined |
| Core vs. periphery district (§10.2) | Density gradient — tightly packed near landmarks, progressively sparser and more spread out toward the edges, with real gaps, not a clean ring boundary |
| First-mover density (§2) | The oldest/most-established cluster should visually read as denser and hotter than newer clusters, without being labeled as such |
| Migration pressure / roleless population (§4) | Loose, unattached figures or dim unlit markers moving between clusters, not attached to any structure — visually distinct from role-holders |
| Detection risk / population scaling (§3) | More witnesses = more ambient light and activity noise in dense areas; sparse areas should feel visibly more exposed/quiet, reinforcing that isolation is real |

---

## 4. Emotional weather — the concept, for a generator to actually use

The earlier prototype had a "tension colour: cool / warm" toggle. That instinct is
right and should be pushed further: **weather is not decorative atmosphere, it's a
second reading of the same heat data.**

- **Cool palette (blues, low saturation, still air):** low tension, low activity,
  low disruption risk. A calm shard, or a calm night.
- **Warm palette (ambers, reds, visible particulate/haze, subtle motion in the air):**
  rising tension — could mean a busy, thriving market, or could mean something about
  to go wrong. **The visual should not disambiguate this** — a warm, hazy, humming city
  should be legitimately ambiguous between "prosperous" and "dangerous," matching the
  design principle that visible action never resolves into legible intent (established
  earlier in the design trail — acts are witnessed, meaning is inferred, never stated
  by the system).
- Weather should be able to move across the city independently of any single
  structure — a warm front rolling through one district while another stays cool —
  since shards are meant to have real internal geography, not one uniform mood.

---

## 5. Landmarks — concrete, not generic

Three to five structures, each visually distinct from ordinary role stations and from
each other:

- **The Wall** — the communal message/social structure. Should sit at true center,
  equidistant from all districts, never belonging to one. Physically approachable —
  a player should be able to imagine walking up and reading it, not opening a menu.
  Suggested visual: a broad, low, illuminated surface, warm amber light, densely
  covered in small marks/glyphs at close range, readable as texture from a distance.
- **The Watchtower** — tall, vertical, visible from most of the city, functions as a
  literal and figurative high point. Suggested: a slender spire structure, distinct
  cooler light (matches Watchman role color), visible sightlines implied by its height.
- **The Market/central plaza** — an open gathering space rather than a building,
  where trade and Importer/Exporter activity is visually implied (open ground,
  radiating paths, more foot traffic markers than surrounding tiles).
- Optional additional landmarks for a richer city: a **border checkpoint** structure
  at the city's edge (ties to the not-yet-designed legality/border-risk mechanic
  raised this session — worth including visually even if the mechanic isn't finalized,
  since it signals "leaving here is a real, gated act").

---

## 6. Camera angles needed — request all three from any generator

1. **Top-down / cartographer's view** — full city legible at once, for orientation and
   for showing district structure, landmark placement, and street topology.
2. **Isometric city-scale** — the "many glowing tiles" view already prototyped;
   this is the primary establishing shot, should read as a living data-heatmap city.
3. **Ground-level / first- or third-person, street scale** — walking up to the Wall,
   standing in a district, weather visible overhead and in the air, landmarks looming
   rather than being read as icons. This is the view that needs to feel like *being
   there*, not looking at a system.

---

## 7. Motion/animation notes, if the target tool supports it

The earlier prototype had a working "Motion editor" and a narrative timeline with
beats labeled Establishing → Approach → [something] → Conversation → Relationship →
Living. That structure is worth keeping as a storyboard scaffold for a video
generator specifically:

- **Establishing:** top-down or wide isometric, city at rest, ambient glow pulsing
  gently (matches the "ambient ripples" toggle already built).
- **Approach:** camera moves from wide isometric down toward street level, heading
  toward a landmark (the Wall is the natural target).
- **Arrival/Something:** ground-level, landmark now fills the frame, weather visible.
- **Conversation:** close-in ground-level, implying two figures near the Wall, without
  showing faces or resolving identity — matches the illegible-intent principle.
- **Relationship:** pull back slightly, show the two figures now moving together
  through a district, tension-color shifting subtly warmer or cooler based on what
  just happened (left ambiguous, per §4 above).
- **Living:** return to isometric or top-down, city continuing, unaffected by the one
  interaction just shown — reinforcing that individual relationships are Layer 4,
  and the city (Layers 1-3) carries on regardless.

---

## 8. Ready-to-use prompt language, for a still-image or video generator

Adapt as needed per tool, but this is a usable starting point:

> *An organic isometric city built from hundreds of small glowing diamond-shaped
> structures in eight distinct jewel-tone hues, clustered densely around a warmly-lit
> central plaza and thinning irregularly outward into sparser satellite
> neighborhoods connected by winding side streets. A tall slender watchtower rises
> above the skyline. Ambient heat-glow varies structure to structure like a living
> data visualization. Dark background, soft volumetric haze, warm amber light at the
> core fading to cool blue at the edges. Video-game concept art, isometric
> architecture, atmospheric, painterly digital illustration, high detail, no text,
> no UI elements.*

For the ground-level/street view:

> *Ground-level view inside a glowing isometric fantasy settlement, standing before a
> massive illuminated wall covered in small intricate glyphs, warm amber light,
> hazy atmospheric weather rolling through in the middle distance, a tall watchtower
> visible above the rooftops, painterly digital concept art, atmospheric perspective,
> no text, no UI, no visible characters' faces.*

---

## 9. What this brief deliberately leaves open

Exact structure shapes (what a "Baker" building looks like vs. a "Smith" building),
specific street-pattern generation logic, and precise weather-particle behavior are
not specified here — those are execution details for whichever tool/artist takes this
on, not decisions this document should make. What must be preserved regardless of
execution is the mapping in §3: **every visual variable traces back to a real number
from the simulation, or it isn't part of this city.**
