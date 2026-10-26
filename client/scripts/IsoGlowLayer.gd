extends Node2D

## Browser-compatible additive radiance. Compatibility/WebGL does not supply HDR bloom;
## project the existing heat/role/soul signals into soft, overlapping screen-space halos.
## No decorative people, motion, work, trade or additional world state is generated.
var view: Node3D
var _falloff: ImageTexture

func _ready() -> void:
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = mat
	var image := Image.create(96, 96, false, Image.FORMAT_RGBA8)
	for y in 96:
		for x in 96:
			var p := (Vector2(x, y) - Vector2(47.5, 47.5)) / 47.5
			var a := pow(maxf(0.0, 1.0 - p.length_squared()), 2.4)
			image.set_pixel(x, y, Color(1.0, 1.0, 1.0, a))
	_falloff = ImageTexture.create_from_image(image)

func _process(_delta: float) -> void:
	queue_redraw()

func _halo(camera: Camera3D, world: Vector3, diameter: float, colour: Color) -> void:
	if camera.is_position_behind(world):
		return
	var centre := camera.unproject_position(world)
	draw_texture_rect(_falloff, Rect2(centre - Vector2.ONE * diameter * 0.5, Vector2.ONE * diameter), false, colour)

func _draw() -> void:
	if view == null or not view.have_geometry or _falloff == null:
		return
	var camera: Camera3D = view.get_node("Camera3D")
	var hub: Vector2 = view.hub
	var origin := Vector3(hub.x, 0.0, hub.y)
	var cell := maxf(camera.unproject_position(origin + Vector3.RIGHT).distance_to(camera.unproject_position(origin)),
		camera.unproject_position(origin + Vector3.BACK).distance_to(camera.unproject_position(origin)))
	for b in view.buildings:
		var station = view.stations.get(b["id"])
		if station == null:
			continue
		var heat := clampf(float(station["heat"]) / float(view.HEAT_OBSERVED_MAX), 0.0, 1.0)
		if heat <= 0.001:
			continue
		var strength := float(view.STATE_BRIGHTNESS.get(station["state"], 1.0))
		if not view._occupied.has(b["id"]):
			strength *= 0.16
		var cool: Color = view.HEAT_COOL
		var hot: Color = view.HEAT_HOT
		var colour := cool.lerp(hot, heat)
		colour.a = 0.32 * pow(heat, 0.95) * strength
		var position := Vector3(float(b["x"]), 0.20, float(b["y"]))
		_halo(camera, position, lerpf(1.6, 5.2, heat) * cell, colour)
		if heat > 0.35:
			var core := hot.lerp(Color(1.0, 0.95, 0.85), (heat - 0.35) * 0.8)
			core.a = (heat - 0.35) * 0.48 * strength
			_halo(camera, position, cell * 1.15, core)
	var soul: Color = view._soul_colour(view.economic_health)
	soul.a = 0.14
	_halo(camera, origin + Vector3.UP * 0.3, cell * 4.3, soul)
	for person in view.people:
		var key := "%d,%d" % [int(round(float(person["x"]))), int(round(float(person["y"])))]
		if person.get("role") != null and view._building_at.has(key):
			continue
		var colour: Color = view.ROLE_COLOUR.get(person.get("role"), view.COLOUR_GRIFTER)
		colour.a = 0.14
		_halo(camera, Vector3(float(person["x"]), 0.25, float(person["y"])), cell * 0.85, colour)
