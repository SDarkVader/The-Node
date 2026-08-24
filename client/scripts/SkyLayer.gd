extends Node2D

## Sibling-shard sky (2026-08-24). Renders `src/server/worldProtocol.ts`'s `sky` message — every
## OTHER shard in the real `engine/shardRegistry.ts` ledger, never the home shard being played
## (that one IS the town already on screen, not a dot in its own sky).
##
## POSITIONS ARE FIXED AND HASHED FROM SHARD ID, NOT ORBITAL. This is a direct requirement from
## how the feature was scoped: "a sibling-shard sky visualization reading real shardRegistry
## state, not an invented orbital-physics system." A shard's `id` is real, stable, and monotonic
## (`shardRegistry.ts`'s own header: "shard IDs only ever increase, nothing is ever deleted").
## Hashing it into a screen position gives every sibling a fixed, distinct place with no motion,
## no orbit, and nothing invented — the only thing that ever changes tick to tick is the REAL
## data a dot encodes, never where it sits.
##
## SCREEN SPACE, NOT WORLD SPACE. Lives on its own CanvasLayer (see WorldView.tscn) specifically
## so it does not pan or zoom with the town underneath it — a sky is a fixed backdrop, not part
## of the settlement's own geometry.
##
## ENCODING follows the same "colour is the only honest variable" doctrine WorldView.gd already
## uses for the Wall and the ground wash:
##   - radius: population / target population per shard (from `hello`) — a bigger shard is a
##     bigger point of light, the same "read the world" logic heat already uses.
##   - colour, ACTIVE: reuses WorldView's own `_soul_colour(health)` — the SAME sentiment mapping
##     the home shard's own Wall uses, so a thriving sibling reads the way a thriving Wall would.
##   - colour, DORMANT: reuses TENSION_COLD — "not yet awake" borrows the same cold-blue
##     vocabulary the tension wash already spends on "nothing happening here," rather than
##     inventing a second meaning for the same hue family.

const DOT_MIN_RADIUS := 3.0
const DOT_MAX_RADIUS := 11.0
const DORMANT_RADIUS := 2.5
const DORMANT_ALPHA := 0.35
const ACTIVE_ALPHA := 0.85
const HALO_ALPHA := 0.30
## The band the sky occupies, as a fraction of viewport height — a strip near the top, clear of
## the HUD readout's own top-left corner.
const BAND_TOP := 0.06
const BAND_BOTTOM := 0.28
const MARGIN_X := 0.05


## Plain integer hash (Knuth multiplicative, folded once) — deterministic, stable across ticks
## and reconnects, with no dependency on draw order or timing. Two different seeds derived from
## the same id (below) decorrelate x from y so dots do not line up on a diagonal.
func _hash01(n: int) -> float:
	var h := (n * 2654435761) & 0x7fffffff
	h = ((h ^ (h >> 13)) * 60493) & 0x7fffffff
	return float(h % 100000) / 100000.0


func _draw() -> void:
	# Two CanvasLayer levels up to the world-state owner (Sky/SkyDraw -> Sky -> the host scene
	# root). DELIBERATELY UNTYPED, unlike GlowLayer.gd's `parent: Node2D` — this script is
	# shared by BOTH real scenes (see this file's header), and one host root is `Node2D`
	# (WorldView) while the other is `Node3D` (IsoView). A `Node2D`-typed variable made this
	# error at runtime the moment it ran under IsoView — found by actually running Godot and
	# looking at the log, not by reading the code (2026-08-24). Untyped access still works for
	# both, the same as every dynamic property/method read below (`.siblings`,
	# `.have_geometry`, `._soul_colour()`) already relies on duck-typing rather than a shared
	# base class.
	var parent = get_parent().get_parent()
	if parent == null or not parent.have_geometry:
		return

	var target_pop: float = maxf(1.0, float(parent.target_population_per_shard))
	var viewport_size: Vector2 = get_viewport_rect().size

	for s in parent.siblings:
		var id: int = int(s.get("id", 0))
		var state: String = str(s.get("state", "DORMANT"))
		var fx: float = _hash01(id * 2 + 1)
		var fy: float = _hash01(id * 2 + 5)
		var pos := Vector2(
			viewport_size.x * (MARGIN_X + fx * (1.0 - 2.0 * MARGIN_X)),
			viewport_size.y * lerpf(BAND_TOP, BAND_BOTTOM, fy)
		)

		if state != "ACTIVE":
			# DORMANT: no population, no running World, nothing pretending otherwise — a small,
			# cold, quiet point. Never invisible (constraint 6's floor has a visual form here
			# too: a shard that exists is drawn, even one nobody has reached yet).
			draw_circle(pos, DORMANT_RADIUS, Color(parent.TENSION_COLD, DORMANT_ALPHA))
			continue

		var population: float = float(s.get("population", 0))
		var health_raw = s.get("health")
		var col: Color = parent._soul_colour(float(health_raw)) if health_raw != null else parent.SOUL_MEDIAN
		var frac: float = clampf(population / target_pop, 0.0, 1.0)
		var radius: float = lerpf(DOT_MIN_RADIUS, DOT_MAX_RADIUS, frac)

		draw_circle(pos, radius * 1.8, Color(col, HALO_ALPHA))
		draw_circle(pos, radius, Color(col, ACTIVE_ALPHA))
