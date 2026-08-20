extends Node3D

## Isometric 3D view of the settlement (2026-08-19) — the direction the reference image sets.
##
## Consumes the SAME `worldProtocol.ts` messages as the 2D `WorldView.gd`, which stays available
## and unchanged. Nothing new is asked of the server: every signal drawn here was already
## computed and already on the wire. The gap between the flat view and this one was never data,
## only rendering.
##
## WHAT 3D BUYS THAT THE 2D VIEW APPROXIMATED. Heat was a drawn glow sprite; here a hot station
## is an actual emissive surface with a real light casting real falloff onto the ground and the
## buildings around it. Height was invisible; here it is real — every building is 3 floors in
## the data (`space.ts`), which the flat map simply could not show. The Wall was a disc and a
## bar; here it is a monolith standing on a plaza with its light spilling across the stones.
##
## WHAT DOES NOT CHANGE, because it is doctrine rather than presentation:
##   - structure is constant, colour is the only honest variable
##   - the Wall's SUBSTRATE is constant gold (hope); its RADIANCE carries sentiment
##   - a BACKSTOPPED station is quieter, never broken
##   - a roleless player is drawn as plainly visible as anyone else
##   - every scale is anchored on measured percentiles, never on a theoretical 0..1 range

const SERVER_HOST := "ws://127.0.0.1:8080"

# --- Ember palette, same values as playtestRenderer.ts / WorldView.gd -----------------------
const HEAT_COOL := Color8(74, 107, 122)
const HEAT_HOT := Color8(255, 171, 62)
const COLOUR_WALL := Color8(239, 220, 174)
const COLOUR_PLAZA := Color8(176, 144, 86)
const COLOUR_STREET := Color8(47, 40, 34)
const COLOUR_PLAIN := Color8(112, 99, 88)
const COLOUR_GRIFTER := Color8(217, 201, 176)
const COLOUR_AWAY := Color8(232, 168, 92)

const TENSION_COLD := Color8(20, 38, 66)
const TENSION_EMBER := Color8(40, 30, 20)
const TENSION_HOT := Color8(104, 28, 18)
const TENSION_COLD_AT := 0.03
const TENSION_MEDIAN := 0.06
const TENSION_HOT_AT := 0.10

const HEALTH_WELL := 0.948
const HEALTH_MEDIAN := 0.909
const HEALTH_ILL := 0.857
const SOUL_WELL := Color8(255, 214, 138)
const SOUL_MEDIAN := Color8(232, 150, 74)
const SOUL_ILL := Color8(206, 58, 40)

const HEAT_OBSERVED_MAX := 0.5
const STATE_BRIGHTNESS := {"FILLED": 1.0, "BACKSTOPPED": 0.5, "VACANT": 0.28}

const ROLE_COLOUR := {
	"miller": Color8(226, 178, 92),
	"baker": Color8(214, 122, 74),
	"courier": Color8(122, 158, 148),
	"journalist": Color8(168, 154, 196),
	"detective": Color8(196, 96, 96),
	"importExport": Color8(148, 168, 108),
}

## One world cell is one 3D unit. Buildings are 3 floors in the data, so FLOOR_HEIGHT * 3 is
## their real height rather than an invented one.
const FLOOR_HEIGHT := 0.42
const BUILDING_FOOTPRINT := 0.72
const PERSON_HEIGHT := 0.5
const PERSON_RADIUS := 0.15
## How many of the hottest stations get a real OmniLight3D. Every station is emissive, but real
## lights are the expensive part, so only the ones actually carrying signal get one.
const MAX_STATION_LIGHTS := 14

## BUILDING VARIETY — and the line between signal and texture (2026-08-19).
##
## Uniform boxes read as "generic city everywhere" rather than as a place that grew. But the
## visual brief is explicit that height must not be invented: `floors` is uniformly 3 in the
## engine, so encoding role or wealth in height would be a lie the simulation does not support.
##
## Two honest sources of variation are used instead:
##
##   SIGNAL — `isLandmark`, real generated geometry (`space.ts`, 3 per district, chosen by
##   texture-field magnitude). It had never been read by anything since it was added. A landmark
##   is genuinely taller and broader, because a landmark is a real fact about the built
##   environment that anyone standing in the street can see.
##
##   TEXTURE — a small deterministic jitter seeded from each building's own id. It encodes
##   NOTHING and must never be read as meaning anything; it exists because real towns are
##   uneven and a perfect grid reads as a diagram. Stable per building forever, so the town has
##   a consistent skyline rather than shimmering. Kept deliberately narrow: wide enough to break
##   uniformity, too narrow to be mistaken for a signal.
const LANDMARK_HEIGHT_MUL := 1.85
const LANDMARK_FOOTPRINT_MUL := 1.28
const JITTER_HEIGHT := 0.34
const JITTER_FOOTPRINT := 0.16

var socket := WebSocketPeer.new()
var logged := false
var _frames := 0
var _shot_path := ""

var have_geometry := false
var plots: Array = []
var buildings: Array = []
var hub := Vector2.ZERO
var bounds := {}

var stations := {}
var people: Array = []
var day := 0
var economic_health := 1.0
var mean_tension := 0.0

var _ground_mm: MultiMeshInstance3D
var _building_mm: MultiMeshInstance3D
var _people_mm: MultiMeshInstance3D
var _station_lights: Array[OmniLight3D] = []
var _wall_root: Node3D
var _wall_slab: MeshInstance3D
var _wall_disc: MeshInstance3D
var _wall_light: OmniLight3D
var _env: Environment

@onready var camera: Camera3D = $Camera3D
@onready var hud: Label = $HUD/Readout


func _ready() -> void:
	_shot_path = OS.get_environment("NODE_SHOT")
	_build_environment()
	var err := socket.connect_to_url("%s/" % SERVER_HOST)
	if err != OK:
		hud.text = "Failed to start connection (error %d)" % err
		return
	hud.text = "Connecting to %s..." % SERVER_HOST


## Ambient light, sun, and the glow that makes emissive surfaces read as light sources rather
## than as brightly-painted boxes. Glow is doing real work here, not decoration: it is what
## turns "this station has a high heat value" into "that corner of the town is blazing".
func _build_environment() -> void:
	_env = Environment.new()
	_env.background_mode = Environment.BG_COLOR
	_env.background_color = Color8(6, 5, 4)
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	_env.ambient_light_color = Color8(38, 34, 40)
	_env.ambient_light_energy = 0.85
	_env.glow_enabled = true
	_env.glow_intensity = 0.7
	_env.glow_bloom = 0.15
	_env.glow_strength = 0.9
	_env.glow_hdr_threshold = 1.05
	var we := WorldEnvironment.new()
	we.environment = _env
	add_child(we)

	# Low, raking key light. Deliberately dim: this is a town at dusk lit mostly by its own
	# windows, so the sun's job is to keep silhouettes readable, not to light the scene.
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42.0, -128.0, 0.0)
	sun.light_energy = 0.62
	sun.light_color = Color8(150, 150, 180)
	add_child(sun)


func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		while socket.get_available_packet_count() > 0:
			_handle_message(socket.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		hud.text = "Disconnected (code %d) — is `npm run server` running?" % socket.get_close_code()


func _handle_message(raw: String) -> void:
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	match parsed.get("type"):
		"hello":
			_handle_hello(parsed)
		"tick":
			_handle_tick(parsed)


func _handle_hello(msg: Dictionary) -> void:
	plots = msg.get("plots", [])
	buildings = msg.get("buildings", [])
	var h: Dictionary = msg.get("hub", {"x": 0, "y": 0})
	hub = Vector2(float(h["x"]), float(h["y"]))
	bounds = msg.get("bounds", {})
	have_geometry = true
	_build_static_geometry()
	_frame_camera()
	print("[NODE] geometry: %d buildings, %d plots, hub (%d,%d)" % [
		buildings.size(), plots.size(), int(hub.x), int(hub.y)
	])


func _handle_tick(msg: Dictionary) -> void:
	day = int(msg.get("day", 0))
	economic_health = float(msg.get("economicHealth", 1.0))
	people = msg.get("people", [])
	stations.clear()
	for s in msg.get("stations", []):
		stations[s["buildingId"]] = {"state": s["state"], "heat": float(s["heat"])}

	var tensions: Array = msg.get("districtTension", [])
	mean_tension = 0.0
	if tensions.size() > 0:
		for t in tensions:
			mean_tension += float(t["tension"])
		mean_tension /= tensions.size()

	_update_dynamic()
	hud.text = "Day %d    health %.3f    tension %.3f    %d people" % [
		day, economic_health, mean_tension, people.size()
	]
	if not logged:
		logged = true
		print("[NODE] first tick: day %d, %d people, %d stations, health %.3f" % [
			day, people.size(), stations.size(), economic_health
		])


## Diverging blue <- Ember -> red, anchored on measured tension percentiles. Same function and
## same anchors as playtestRenderer.ts and WorldView.gd — three renderers, one scale.
func _tension_colour(t: float) -> Color:
	if t <= TENSION_MEDIAN:
		var a := clampf((t - TENSION_COLD_AT) / (TENSION_MEDIAN - TENSION_COLD_AT), 0.0, 1.0)
		return TENSION_COLD.lerp(TENSION_EMBER, a)
	var b := clampf((t - TENSION_MEDIAN) / (TENSION_HOT_AT - TENSION_MEDIAN), 0.0, 1.0)
	return TENSION_EMBER.lerp(TENSION_HOT, b)


## Diverging gold <- amber -> red across the health band the shard really occupies.
func _soul_colour(health: float) -> Color:
	if health >= HEALTH_MEDIAN:
		var a := clampf((health - HEALTH_MEDIAN) / (HEALTH_WELL - HEALTH_MEDIAN), 0.0, 1.0)
		return SOUL_MEDIAN.lerp(SOUL_WELL, a)
	var b := clampf((HEALTH_MEDIAN - health) / (HEALTH_MEDIAN - HEALTH_ILL), 0.0, 1.0)
	return SOUL_MEDIAN.lerp(SOUL_ILL, b)


## Isometric framing. Orthographic so the town reads as a diagram of itself rather than a
## perspective scene — distances stay comparable across the map, which matters when the thing
## being read is where activity is clustered.
func _frame_camera() -> void:
	var span := 16.0
	if bounds.has("minX"):
		span = maxf(float(bounds["maxX"]) - float(bounds["minX"]),
			float(bounds["maxY"]) - float(bounds["minY"])) + 5.0
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = span
	var d := span
	camera.position = Vector3(hub.x + d, d * 0.82, hub.y + d)
	camera.look_at(Vector3(hub.x, 0.0, hub.y), Vector3.UP)


func _build_static_geometry() -> void:
	_build_ground()
	_build_buildings()
	_build_wall()
	_build_people_pool()


## Ground tiles, one per real plot. Kept as a MultiMesh so the whole settlement floor is a
## single draw call — it is also the surface the Wall's light and every station's light
## actually falls on, which is most of what sells the space as a place.
func _build_ground() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bm := BoxMesh.new()
	bm.size = Vector3(0.96, 0.12, 0.96)
	mm.mesh = bm
	mm.instance_count = plots.size()
	for i in plots.size():
		var p = plots[i]
		var is_plaza: bool = str(p.get("kind", "")) == "plaza"
		mm.set_instance_transform(i, Transform3D(Basis(), Vector3(float(p["x"]), -0.06, float(p["y"]))))
		mm.set_instance_color(i, COLOUR_PLAZA if is_plaza else COLOUR_STREET)
	_ground_mm = MultiMeshInstance3D.new()
	_ground_mm.multimesh = mm
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.95
	_ground_mm.material_override = mat
	add_child(_ground_mm)


## Buildings at their real height — 3 floors, from `space.ts`. Instance colour carries heat,
## and the material treats that colour as emission as well as albedo, so a hot station is a
## light source rather than a brightly-painted box.
func _build_buildings() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bm := BoxMesh.new()
	bm.size = Vector3(BUILDING_FOOTPRINT, FLOOR_HEIGHT * 3.0, BUILDING_FOOTPRINT)
	mm.mesh = bm
	mm.instance_count = buildings.size()
	for i in buildings.size():
		var b = buildings[i]
		mm.set_instance_transform(i, Transform3D(Basis(),
			Vector3(float(b["x"]), FLOOR_HEIGHT * 1.5, float(b["y"]))))
		mm.set_instance_color(i, Color(COLOUR_PLAIN, 0.0))
	_building_mm = MultiMeshInstance3D.new()
	_building_mm.multimesh = mm
	# A CUSTOM SHADER, not StandardMaterial3D, and for a specific reason found by looking at the
	# first render: `StandardMaterial3D.emission` is a single flat colour and does NOT read the
	# per-instance vertex colour. Every building therefore emitted full white and the whole town
	# blew out. Emission has to follow the instance colour for heat to mean anything, which
	# needs a shader.
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back, diffuse_burley;
uniform float emit_gain = 2.6;
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.85;
	// Emission is the instance colour scaled by its own luminance, so a DARK (cold) station
	// emits nothing while a bright (hot) one emits hard. This is what makes the bottom of the
	// range read as genuinely cold rather than merely less bright.
	// Heat rides in the instance ALPHA channel, kept separate from albedo on purpose. Deriving
	// emission from albedo luminance (the previous version) forced a cold station to be BLACK
	// in order to be dark, which quietly broke the doctrine: structure is supposed to stay
	// constant and legible at every heat level, with only colour carrying the signal. Now a
	// cold station keeps its full architecture in plain stone and simply does not glow.
	EMISSION = COLOR.rgb * COLOR.a * emit_gain;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_building_mm.material_override = mat
	add_child(_building_mm)

	for i in MAX_STATION_LIGHTS:
		var l := OmniLight3D.new()
		l.omni_range = 4.2
		l.light_energy = 0.0
		l.shadow_enabled = false
		add_child(l)
		_station_lights.append(l)


## THE WALL. Circular substrate + a vertical slab standing on it, both CONSTANT gold — the
## substrate is hope and does not move with the weather. Its LIGHT carries sentiment.
## Stable pseudo-random in [0,1) from a building's own id — no rng, so the skyline is identical
## every run and across clients.
func _hash01(id: String, salt: int) -> float:
	var h := 2166136261
	for i in id.length():
		h = (h ^ id.unicode_at(i)) * 16777619
		h = h & 0xFFFFFFFF
	h = (h ^ (salt * 2654435761)) & 0xFFFFFFFF
	return float(h % 100000) / 100000.0


func _building_transform(b: Dictionary) -> Transform3D:
	var id := str(b["id"])
	var is_landmark: bool = b.get("isLandmark", false)
	var foot := BUILDING_FOOTPRINT * (1.0 + (_hash01(id, 1) - 0.5) * 2.0 * JITTER_FOOTPRINT)
	var floors := 3.0 * (1.0 + (_hash01(id, 2) - 0.5) * 2.0 * JITTER_HEIGHT)
	if is_landmark:
		foot *= LANDMARK_FOOTPRINT_MUL
		floors *= LANDMARK_HEIGHT_MUL
	var height := FLOOR_HEIGHT * floors
	var basis := Basis().scaled(Vector3(foot, height, foot))
	return Transform3D(basis, Vector3(float(b["x"]), height * 0.5, float(b["y"])))


func _build_wall() -> void:
	_wall_root = Node3D.new()
	_wall_root.position = Vector3(hub.x, 0.0, hub.y)
	add_child(_wall_root)

	var disc := CylinderMesh.new()
	disc.top_radius = 1.5
	disc.bottom_radius = 1.5
	disc.height = 0.08
	_wall_disc = MeshInstance3D.new()
	_wall_disc.mesh = disc
	_wall_disc.position = Vector3(0, 0.02, 0)
	var dmat := StandardMaterial3D.new()
	dmat.albedo_color = COLOUR_PLAZA
	dmat.roughness = 0.7
	_wall_disc.material_override = dmat
	_wall_root.add_child(_wall_disc)

	var slab := BoxMesh.new()
	slab.size = Vector3(0.85, 1.9, 0.16)
	_wall_slab = MeshInstance3D.new()
	_wall_slab.mesh = slab
	_wall_slab.position = Vector3(0, 0.95, 0)
	_wall_slab.rotation_degrees = Vector3(0, 45.0, 0)
	var smat := StandardMaterial3D.new()
	smat.albedo_color = COLOUR_WALL
	smat.emission_enabled = true
	smat.emission = COLOUR_WALL
	smat.emission_energy_multiplier = 1.15
	_wall_slab.material_override = smat
	_wall_root.add_child(_wall_slab)

	_wall_light = OmniLight3D.new()
	_wall_light.position = Vector3(0, 1.1, 0)
	_wall_light.omni_range = 7.5
	_wall_light.light_energy = 3.2
	_wall_root.add_child(_wall_light)


func _build_people_pool() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var cm := CapsuleMesh.new()
	cm.radius = PERSON_RADIUS
	cm.height = PERSON_HEIGHT
	mm.mesh = cm
	mm.instance_count = 0
	_people_mm = MultiMeshInstance3D.new()
	_people_mm.multimesh = mm
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back;
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.6;
	EMISSION = COLOR.rgb * 0.9;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_people_mm.material_override = mat
	add_child(_people_mm)


func _update_dynamic() -> void:
	if not have_geometry:
		return
	_frames += 1
	if _shot_path != "" and _frames == 3:
		call_deferred("_capture")

	# Emotional weather sets the ambient light the whole town sits in — the 3D equivalent of
	# the 2D ground wash, and a better one: it tints everything, including the undersides and
	# shadowed faces, rather than being a layer behind the scene.
	# Emotional weather rides on AMBIENT LIGHT only — it tints every surface in the town,
	# including shadowed faces, which is the 3D equivalent of the 2D ground wash and a truer
	# one. It deliberately does NOT tint the background: the first version did, and since glow
	# blooms the background too, a tense day turned the entire screen into a red field with the
	# town lost inside it. The void around the settlement stays the same near-black always.
	var tc := _tension_colour(mean_tension)
	_env.ambient_light_color = tc
	_env.ambient_light_energy = 0.85

	# Stations: instance colour carries heat, brightest ones also get a real light.
	var mm := _building_mm.multimesh
	var ranked: Array = []
	for i in buildings.size():
		var b = buildings[i]
		var st = stations.get(b["id"])
		if st == null:
			# A building with no role slot: real structure, never a light source.
			mm.set_instance_color(i, Color(COLOUR_PLAIN, 0.0))
			continue
		var heat: float = clampf(float(st["heat"]) / HEAT_OBSERVED_MAX, 0.0, 1.0)
		var brightness: float = float(STATE_BRIGHTNESS.get(st["state"], 1.0))
		# Albedo stays a real, lit surface at every heat level — the building is always there.
		# Alpha carries heat, and drives emission alone.
		var col: Color = COLOUR_PLAIN.lerp(HEAT_HOT, heat * 0.75)
		col.a = heat * brightness
		mm.set_instance_color(i, col)
		ranked.append({"i": i, "heat": heat * brightness, "pos": Vector3(float(b["x"]), 0.7, float(b["y"]))})

	ranked.sort_custom(func(a, b): return a["heat"] > b["heat"])
	for k in _station_lights.size():
		var l := _station_lights[k]
		if k < ranked.size() and ranked[k]["heat"] > 0.08:
			l.position = ranked[k]["pos"]
			l.light_color = HEAT_COOL.lerp(HEAT_HOT, ranked[k]["heat"])
			l.light_energy = 1.2 + 3.4 * ranked[k]["heat"]
		else:
			l.light_energy = 0.0

	# The Wall: substrate constant, radiance carries sentiment.
	var soul := _soul_colour(economic_health)
	_wall_light.light_color = soul
	_wall_light.light_energy = 3.2

	# People.
	var pmm := _people_mm.multimesh
	pmm.instance_count = people.size()
	for i in people.size():
		var p = people[i]
		var role = p.get("role")
		# Offset toward the camera so a role-holder stands at their door rather than inside the
		# building mesh. In the flat view people simply drew on top; in 3D, standing at your
		# station means being occluded by it, and 60 of 63 people vanished. A person at their
		# post belongs on the step outside it, which is also just truer to a town.
		var off := Vector3(0.46, 0.0, 0.46) if (role != null and ROLE_COLOUR.has(role)) else Vector3.ZERO
		pmm.set_instance_transform(i, Transform3D(Basis(),
			Vector3(float(p["x"]), PERSON_HEIGHT * 0.5 + 0.06, float(p["y"])) + off))
		# A roleless player is drawn exactly as visible as anyone else — constraint 6's floor
		# has a visual form, and it is as easy to breach with a draw call as with a rule.
		pmm.set_instance_color(i, COLOUR_GRIFTER if (role == null or not ROLE_COLOUR.has(role)) else COLOUR_AWAY)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.size = maxf(4.0, camera.size / 1.1)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.size = minf(60.0, camera.size * 1.1)


## Offscreen capture, opt-in via `NODE_SHOT=/path/to.png`. Permanent rather than a throwaway
## patch because it is the whole review loop in an environment with no monitor: render, save,
## look, adjust. Waits for `frame_post_draw` or the texture is read before the frame it is
## meant to contain has been drawn.
func _capture() -> void:
	await RenderingServer.frame_post_draw
	var err := get_viewport().get_texture().get_image().save_png(_shot_path)
	print("[NODE] capture %s -> %s" % ["ok" if err == OK else "FAILED", _shot_path])
	get_tree().quit()
