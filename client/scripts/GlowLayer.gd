extends Node2D

## Emissive heat field (2026-08-19, user direction: "tone distributed box by box doesn't produce
## a granular display of activity. it should behave as emissive particles that blend with other
## regions naturally").
##
## WHY THIS IS A SEPARATE NODE. Godot's 2D blend mode lives on the CanvasItem, not on the
## individual draw call, so additive blending needs its own layer — the settlement's structure
## (plots, buildings, the Wall) must stay normally blended or it would wash out. This node sits
## above the structure with `BLEND_MODE_ADD`, so overlapping glows SUM: two hot stations two
## cells apart stop being two boxes and become one bright region with a natural falloff between
## them, which is exactly the "blend with other regions" behaviour asked for.
##
## IT ADDS NO DATA. Every glow is a real `heat` value from the wire, drawn at the real station's
## real position. This changes how the same honest signal is presented, not what is claimed —
## the doctrine's "colour is the only honest variable" still holds, and nothing here invents
## activity where the simulation reports none.
##
## STRUCTURE IS NOT TOUCHED. Per the visual doctrine, buildings keep their shape and footprint
## at every heat level; the glow sits on top of them and spills onto the ground between. A cold
## shard loses its glow, never its architecture.

## HEAT IS A SIGNAL, NOT A MOOD (2026-08-19, user direction: "make the glow contrast visibly
## noticeable. it has to be a signal not just vibe").
##
## The first version was legible only as atmosphere — you could see the town was warm, but not
## WHICH station was hot without reading numbers, which defeats the entire "read the world,
## don't compute it" doctrine. Heat is now encoded twice over, in radius AND intensity, so the
## difference between a busy station and a quiet one is obvious at a glance and from across the
## map:
##
##   radius  1.6 cells (barely warm) -> 6.5 cells (blazing)   — reach says how far it carries
##   core    a tight, near-white centre on top of the wide halo — punch, without hard edges
##
## Blending is untouched: overlapping halos still sum, so clusters still read as one region.
## What changed is that a region now has visible internal structure instead of a flat wash.
const GLOW_CELLS_MIN := 1.6
const GLOW_CELLS_MAX := 4.4
## Halo ceiling. High, because additive blending against a near-black ground needs real alpha
## before anything reads; the falloff curve keeps it from becoming a flat disc.
const GLOW_ALPHA_MAX := 0.58
## The bright core: small, hot, and only present at genuinely high heat, so it reads as "this
## specific station is the hot one" rather than as decoration on everything.
const CORE_CELLS := 1.15
const CORE_ALPHA_MAX := 0.72

var _tex: ImageTexture


func _ready() -> void:
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = mat
	# The falloff texture is built once by WorldView and shared, so both layers use one curve
	# and cannot drift apart. Read lazily in _draw — _ready order between siblings is not
	# something to depend on.


## Smooth quadratic falloff to zero at the rim. A hard-edged sprite would reintroduce exactly
## the boxiness this layer exists to remove, one circle at a time.
func _draw() -> void:
	# Typed explicitly rather than inferred: `get_parent()` returns an untyped Node, so every
	# value read off it is Variant and `:=` cannot infer from it (a real parse error, caught by
	# actually running Godot rather than by reading).
	var parent: Node2D = get_parent()
	if parent == null or not parent.have_geometry:
		return

	if _tex == null:
		_tex = parent._falloff
		if _tex == null:
			return
	var cell: float = float(parent.CELL)
	for b in parent.buildings:
		var station = parent.stations.get(b["id"])
		if station == null:
			continue
		var heat: float = clampf(float(station["heat"]) / float(parent.HEAT_OBSERVED_MAX), 0.0, 1.0)
		if heat <= 0.001:
			continue
		# A quiet station still occupies its slot, but it should not glow as if it were busy —
		# BACKSTOPPED/VACANT dim here on the same brightness curve the structure uses.
		var brightness: float = float(parent.STATE_BRIGHTNESS.get(station["state"], 1.0))
		var cool: Color = parent.HEAT_COOL
		var hot: Color = parent.HEAT_HOT
		var pos: Vector2 = parent._world_to_px(float(b["x"]), float(b["y"]))

		# Wide halo — this is the part that overlaps its neighbours and forms regions.
		var reach: float = lerpf(GLOW_CELLS_MIN, GLOW_CELLS_MAX, heat) * cell
		var halo: Color = cool.lerp(hot, heat)
		# Kept near-linear on purpose. An aggressive low-end lift was tried and looked worse:
		# every station glowed, the whole town blew out, and the structure, the Wall and the
		# blue/red weather all disappeared under amber. Contrast comes from a COLD STATION
		# BEING DARK, not from a hot one maxing out — the dynamic range has to be spent
		# somewhere, and spending it at the bottom is what makes the top mean anything.
		halo.a = GLOW_ALPHA_MAX * pow(heat, 0.95) * brightness
		draw_texture_rect(_tex, Rect2(pos - Vector2(reach, reach) * 0.5, Vector2(reach, reach)), false, halo)

		# Tight core — pushed toward white at the top of the range so the hottest station in a
		# cluster is identifiable, not just the cluster itself.
		if heat > 0.35:
			var core_t: float = (heat - 0.35) / 0.65
			var core: Color = hot.lerp(Color(1.0, 0.95, 0.85), core_t * 0.6)
			core.a = CORE_ALPHA_MAX * core_t * brightness
			var cr: float = CORE_CELLS * cell
			draw_texture_rect(_tex, Rect2(pos - Vector2(cr, cr) * 0.5, Vector2(cr, cr)), false, core)
