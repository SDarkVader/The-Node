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

## The 2D values are tuned as a dark BACKGROUND wash. Here the same scale is painted onto real
## lit surfaces — the streets — so it needs the brightness and saturation a surface needs. Same
## anchors, same three stops, same meaning; a lit version of the same idea.
const TENSION_COLD := Color8(46, 96, 158)
const TENSION_EMBER := Color8(96, 74, 52)
const TENSION_HOT := Color8(168, 52, 34)
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
	"investigator": Color8(196, 96, 96),
	"importExport": Color8(148, 168, 108),
}

## One world cell is one 3D unit. Buildings are 3 floors in the data, so FLOOR_HEIGHT * 3 is
## their real height rather than an invented one.
## SCALE IS SET FOR LEGIBILITY OF PEOPLE, NOT ARCHITECTURAL REALISM — a deliberate choice,
## stated rather than smuggled. At true relative scale a person is a speck beside a
## three-storey building, and across 62 of them the population simply disappears. People are
## what this game is about, so they are drawn nearer to chess-piece scale: buildings still read
## as three real floors (the floor count is honest, and the height still layers economic
## street level against domestic storeys above), but the town is lower and people are larger
## than a photograph would have them.
const FLOOR_HEIGHT := 0.30
const BUILDING_FOOTPRINT := 0.56
## Small on purpose. Visibility comes from the rim light and the floating glyph, not from
## bulk — an earlier pass made people large enough to read and they promptly buried the town.
const PERSON_HEIGHT := 0.42
const PERSON_RADIUS := 0.115
## Floating role glyph, billboarded above each person.
const ICON_WORLD_SIZE := 0.62
const ICON_TEX_PX := 40
## How many of the hottest stations get a real OmniLight3D. Every station is emissive, but real
## lights are the expensive part, so only the ones actually carrying signal get one.
const MAX_STATION_LIGHTS := 22

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
var _cam_yaw := PI * 0.25
var _cam_span := 18.0
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
var _plot_is_plaza: Array[bool] = []
var _plot_shade: Array[float] = []
var _plot_pos: Array[Vector2] = []
var _plot_local: Array[Color] = []
var _plot_local_w: Array[float] = []
var _occupied: Dictionary = {}
var _building_at: Dictionary = {}
var _building_by_id: Dictionary = {}
var _route_mm: MultiMeshInstance3D
var _logged_routes := false
var _building_mm: MultiMeshInstance3D
var _people_mm: MultiMeshInstance3D
var _people_ghost: MultiMeshInstance3D
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
	_build_vignette()
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

	# FOG — what actually does the blending (2026-08-19, user direction: "variance and
	# blending"). The reference art blends warm and cool through haze rather than butting two
	# flat colours against each other: a lit bakery bleeds amber into a street that is
	# otherwise cold and blue-grey, and the two mix in the air between them.
	#
	# Depth fog gives that for free and honestly — it is a property of the air, not of any
	# object, so it cannot be mistaken for a signal about a building. It also does real work
	# for the doctrine: distant and unlit parts of the town settle into cool blue rather than
	# into black, so "nothing is happening here" reads as somewhere cold and quiet instead of
	# as an absence of rendering.
	_env.fog_enabled = true
	_env.fog_light_color = Color8(58, 84, 122)
	_env.fog_light_energy = 0.42
	# Deliberately low. At 0.055 the fog stopped being air and became a blanket: the whole town
	# flattened to one blue-grey, the Wall lost its gold entirely, and depth disappeared. Fog
	# should bleed between warm and cool, never coat them.
	_env.fog_density = 0.011
	_env.fog_aerial_perspective = 0.12
	_env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = _env
	add_child(we)

	# THE TOWN SITS ON SOMETHING. Without this the settlement reads as a slab floating in a
	# void — the plots simply stop and there is nothing beyond them. A large, very dark ground
	# plane extending well past the built area gives the place an outside: land the town was
	# built on, unlit and empty, which is also what is actually out there.
	var outside := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(140.0, 140.0)
	outside.mesh = pm
	outside.position = Vector3(hub.x, -0.14, hub.y)
	var omat := StandardMaterial3D.new()
	omat.albedo_color = Color8(22, 19, 17)
	omat.roughness = 1.0
	outside.material_override = omat
	add_child(outside)

	# Low, raking key light. Deliberately dim: this is a town at dusk lit mostly by its own
	# windows, so the sun's job is to keep silhouettes readable, not to light the scene.
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42.0, -128.0, 0.0)
	sun.light_energy = 0.62
	sun.light_color = Color8(150, 150, 180)
	add_child(sun)


## Vignette. Darkens the frame toward its edges so the eye settles on the settlement and the
## surrounding land falls away into night, rather than the whole image reading as one flat
## field with a town dropped in the middle of it.
func _build_vignette() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 0
	var rect := ColorRect.new()
	rect.anchor_right = 1.0
	rect.anchor_bottom = 1.0
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """
shader_type canvas_item;
void fragment() {
	vec2 uv = SCREEN_UV - vec2(0.5);
	float d = length(uv * vec2(1.0, 0.86));
	float v = smoothstep(0.30, 0.80, d);
	COLOR = vec4(0.016, 0.013, 0.011, v * 0.94);
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	rect.material = mat
	layer.add_child(rect)
	add_child(layer)


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

	# Review override. Real tension only spans p05 0.03 to p95 0.10, so a single live sample
	# tells you almost nothing about whether the palette works across its range — the first
	# time the blue end was checked, the shard happened to sit above the median and the whole
	# scale looked warm. `NODE_FORCE_TENSION=0.02` renders a genuinely calm node on demand.
	# Never read by anything but a human reviewing colour.
	var forced := OS.get_environment("NODE_FORCE_TENSION")
	if forced != "":
		mean_tension = float(forced)
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
	if bounds.has("minX"):
		_cam_span = maxf(float(bounds["maxX"]) - float(bounds["minX"]),
			float(bounds["maxY"]) - float(bounds["minY"])) + 5.0
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	_place_camera()


## Orbiting matters for more than comfort: a fixed viewpoint means a fixed set of people hidden
## behind a fixed set of roofs. Being able to turn the town is the direct answer to "whoever is
## standing there cannot be seen from here".
func _place_camera() -> void:
	camera.size = _cam_span
	var d := _cam_span
	var eye := Vector3(cos(_cam_yaw) * d, d * 0.82, sin(_cam_yaw) * d)
	camera.position = Vector3(hub.x, 0.0, hub.y) + eye
	camera.look_at(Vector3(hub.x, 0.0, hub.y), Vector3.UP)


func _build_static_geometry() -> void:
	_build_ground()
	_build_buildings()
	_build_wall()
	_build_routes()
	_build_people_pool()


## Ground tiles, one per real plot. Kept as a MultiMesh so the whole settlement floor is a
## single draw call — it is also the surface the Wall's light and every station's light
## actually falls on, which is most of what sells the space as a place.
func _build_ground() -> void:
	_plot_is_plaza.clear()
	_plot_shade.clear()
	_plot_pos.clear()
	_plot_local.clear()
	_plot_local_w.clear()
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
		_plot_is_plaza.append(is_plaza)
		_plot_shade.append(_hash01("%d,%d" % [int(p["x"]), int(p["y"])], 7))
		_plot_pos.append(Vector2(float(p["x"]), float(p["y"])))
		_plot_local.append(Color.BLACK)
		_plot_local_w.append(0.0)
		mm.set_instance_color(i, COLOUR_STREET)
	_ground_mm = MultiMeshInstance3D.new()
	_ground_mm.multimesh = mm
	# THE STREETS ARE WHERE THE WEATHER FLOWS (2026-08-19, user direction).
	#
	# Heat and weather now have separate physical carriers, which is a better separation than
	# the first version had. Buildings RADIATE — that is economic heat, amber, local, coming
	# off a station. The ground CARRIES — that is emotional weather, blue when the node is at
	# peace and red when it is not, spread across every street in the settlement.
	#
	# The two meet on the stones: amber light pools on blue ground around a busy station, and
	# the mix reads as intensity rather than as one colour winning. Previously weather rode on
	# ambient light alone and was simply swamped — the whole town was heat and nothing else,
	# and the blue end of the scale never appeared at all.
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back, diffuse_burley;
void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.92;
	// A low self-lit floor so the weather is legible on unlit stones too — without it the
	// streets away from any station fall to black and the mood disappears exactly where
	// there is nothing else to look at.
	EMISSION = COLOR.rgb * 0.30;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_ground_mm.material_override = mat
	add_child(_ground_mm)


## Buildings at their real height — 3 floors, from `space.ts`. Instance colour carries heat,
## and the material treats that colour as emission as well as albedo, so a hot station is a
## light source rather than a brightly-painted box.
func _build_buildings() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	# Unit cube: per-instance SCALE is what gives each building its own dimensions, so one mesh
	# still serves the whole settlement in a single draw call.
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE
	mm.mesh = bm
	mm.instance_count = buildings.size()
	for i in buildings.size():
		var b = buildings[i]
		# Position lookups, built here because this is the one place every building is walked.
		_building_at["%d,%d" % [int(round(float(b["x"]))), int(round(float(b["y"])))]] = b["id"]
		_building_by_id[b["id"]] = b
		mm.set_instance_transform(i, _building_transform(b))
		mm.set_instance_color(i, Color(COLOUR_PLAIN, 0.0))
	_building_mm = MultiMeshInstance3D.new()
	_building_mm.multimesh = mm
	# A CUSTOM SHADER, not StandardMaterial3D, and for a specific reason found by looking at the
	# first render: `StandardMaterial3D.emission` is a single flat colour and does NOT read the
	# per-instance vertex colour. Every building therefore emitted full white and the whole town
	# blew out. Emission has to follow the instance colour for heat to mean anything, which
	# needs a shader.
	# HEIGHT IS AN ATMOSPHERIC LAYER, NOT JUST A DIMENSION (2026-08-19, user direction).
	#
	# This is not a stylistic choice — it is the building's real data model rendered. `space.ts`
	# states it outright: **ground floor = role function, floors above = housing.** So the
	# vertical axis already carries meaning and the flat view simply could not show it.
	#
	#   STREET LEVEL  economic. The station, the oven, the trade. Amber, hot, and the only part
	#                 of a building that glows — heat is an economic signal, so it belongs where
	#                 the economy happens and nowhere else.
	#   ABOVE         domestic. Housing, private life, nobody's business. Cool and quiet.
	#                 Deliberately mostly DARK: housing capacity is 372 against a population of
	#                 ~65, so most upper floors genuinely are empty, and the visual brief
	#                 already says to model them that way rather than lighting every window.
	#
	# The two are separated by the air between them — warm below, cool above — which is what
	# gives the town a horizon at roof height instead of reading as uniform blocks.
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back, diffuse_burley;
uniform float emit_gain = 3.6;
uniform vec3 ground_tint = vec3(1.05, 0.72, 0.42);
uniform vec3 upper_tint = vec3(0.44, 0.56, 0.80);
uniform float floor_height = 0.30;
varying float world_h;

void vertex() {
	world_h = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y;
}

void fragment() {
	// Height in "floors". Passed in rather than hardcoded so it cannot drift from
	// FLOOR_HEIGHT on the GDScript side.
	float floors = world_h / floor_height;

	// THE BLEND IS THE MOST VISIBLE LAYER. The transition is deliberately wide — it spans
	// most of a facade rather than being a seam between a warm half and a cool half. The two
	// ends are the anchors; the mixing between them is what the eye should land on, and it is
	// also the honest picture: a building is not economic downstairs and domestic upstairs
	// with a line ruled between, the one bleeds into the other.
	float up = smoothstep(0.65, 2.9, floors);
	ALBEDO = COLOR.rgb * mix(ground_tint, upper_tint, up);
	ROUGHNESS = 0.85;

	// Heat is emitted at street level and fades upward — economic activity lights its own
	// doorway and the cobbles in front of it, never the bedrooms above.
	float heat_falloff = 1.0 - smoothstep(0.35, 2.3, floors);
	vec3 emit = COLOR.rgb * COLOR.a * emit_gain * heat_falloff;

	// The mixing band gets its own lift: a soft peak where warm and cool actually meet, tinted
	// to the mix rather than to either end. This is what makes the blend read as a layer of
	// its own instead of as the gap between two other layers.
	float band = 1.0 - abs(up - 0.5) * 2.0;
	band = max(band, 0.0);
	vec3 band_col = mix(ground_tint, upper_tint, 0.5);
	emit += band_col * band * band * (0.16 + 0.55 * COLOR.a);

	EMISSION = emit;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	mat.set_shader_parameter("floor_height", FLOOR_HEIGHT)
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


func _roof_height(b: Dictionary) -> float:
	return _building_transform(b).origin.y * 2.0 + 0.34


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
	# Turned to sit square with the isometric view rather than to the world grid — from the
	# camera's angle the slab now presents its face instead of an edge.
	_wall_slab.rotation_degrees = Vector3(0, 90.0, 0)
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


## COURIER ROUTES — real economic geometry, not decoration.
##
## `courierPay.ts` pays a Courier for the Manhattan distance from their own station to the
## shard hub, so this line IS the thing being paid for: the corridor they walk every day and
## earn from. Drawn as a flat ribbon on the stones rather than a floating line, because it is
## a route through the town, not a link on a diagram.
##
## Gated on OCCUPANCY: a route exists because somebody runs it. An unstaffed Courier post has
## no line, which is the same rule the station glow follows — activity requires someone doing
## it.
func _build_routes() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bm := BoxMesh.new()
	bm.size = Vector3(1.0, 0.02, 0.30)
	mm.mesh = bm
	mm.instance_count = 0
	_route_mm = MultiMeshInstance3D.new()
	_route_mm.multimesh = mm
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;
void fragment() {
	ALBEDO = COLOR.rgb;
	ALPHA = COLOR.a;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_route_mm.material_override = mat
	add_child(_route_mm)


func _update_routes() -> void:
	var routes: Array = []
	for b in buildings:
		if b.get("role") != "courier":
			continue
		if not _occupied.has(b["id"]):
			continue
		routes.append(b)

	var mm := _route_mm.multimesh
	mm.instance_count = routes.size()
	if not _logged_routes:
		_logged_routes = true
		var courier_posts := 0
		for b in buildings:
			if b.get("role") == "courier":
				courier_posts += 1
		print("[NODE] courier routes: %d of %d posts staffed" % [routes.size(), courier_posts])
	var hub3 := Vector3(hub.x, 0.09, hub.y)
	var col: Color = ROLE_COLOUR["courier"]
	for i in routes.size():
		var b = routes[i]
		var from := Vector3(float(b["x"]), 0.09, float(b["y"]))
		var to := hub3
		var mid := (from + to) * 0.5
		var d := to - from
		var len := d.length()
		if len < 0.001:
			mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3(0.01, 1, 1)), mid))
			continue
		var yaw := atan2(d.z, d.x)
		var basis := Basis(Vector3.UP, -yaw).scaled(Vector3(len, 1.0, 1.0))
		mm.set_instance_transform(i, Transform3D(basis, mid))
		mm.set_instance_color(i, Color(col.lightened(0.25), 1.0))


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
	# PEOPLE ARE DARK SILHOUETTES WITH A ROLE-COLOURED EDGE (2026-08-19, user direction).
	#
	# Glowing capsules read as lamps, not persons, and at 60 of them they buried the
	# architecture entirely. The reference art has it right: a figure is a dark shape, and what
	# identifies it is the light around it. So the body is near-black and the RIM carries the
	# role's colour — a silhouette that tells you what someone does without telling you who
	# they are, which is exactly the Silhouette Shield expressed as a material.
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back;
void fragment() {
	ALBEDO = vec3(0.035, 0.032, 0.030);
	ROUGHNESS = 0.55;
	float rim = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 1.8);
	EMISSION = COLOR.rgb * (0.25 + rim * 2.6);
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_people_mm.material_override = mat
	add_child(_people_mm)

	# NOBODY IS EVER INVISIBLE (2026-08-19, user: "if you're in the middle you're basically
	# invisible").
	#
	# A fixed isometric camera hides anything standing behind a building, so in a settlement
	# this dense a person in the middle of town simply vanished. That is not merely awkward —
	# it is constraint 6's failure mode arriving through a depth test instead of a rule. Being
	# in the centre of the place you live must not erase you.
	#
	# A second pass draws every person again with the depth test off, dimmed, so an occluded
	# person reads as a faint presence through the roofs rather than as nothing at all. An
	# unoccluded person is unaffected: the solid pass is drawn over the top of their own ghost.
	var ghost := MultiMeshInstance3D.new()
	ghost.multimesh = mm
	var gsh := Shader.new()
	gsh.code = """
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, blend_add, cull_back;
void fragment() {
	ALBEDO = COLOR.rgb;
	ALPHA = 0.16;
}
"""
	var gmat := ShaderMaterial.new()
	gmat.shader = gsh
	ghost.material_override = gmat
	add_child(ghost)
	_people_ghost = ghost


func _update_dynamic() -> void:
	if not have_geometry:
		return
	_frames += 1
	if _shot_path != "" and _frames == 3:
		call_deferred("_capture")

	# ---- OCCUPANCY, FIRST ------------------------------------------------------------------
	# A role-holder standing at their own station is INSIDE it, working — not hovering on the
	# step outside. So they are not drawn as a figure in the street: their presence is what
	# makes the building glow, and their glyph hangs above the roof like the sign over a door.
	# Only people actually out in the open get a body.
	#
	# Computed FIRST, before anything reads it. It was originally worked out further down,
	# after the station glow and the courier routes had already used it — so routes saw an
	# empty map and drew nothing at all, and the glow ran a tick behind. Occupancy is the first
	# thing established each tick, because nearly everything else is a consequence of it.
	_occupied.clear()
	var street_people: Array = []
	for pp in people:
		var key := "%d,%d" % [int(round(float(pp["x"]))), int(round(float(pp["y"])))]
		if pp.get("role") != null and _building_at.has(key):
			_occupied[_building_at[key]] = pp
		else:
			street_people.append(pp)

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
		# Activity requires somebody doing it. An occupied station carries a floor of warmth
		# even on a quiet day — someone is in there with the lights on — while an unoccupied
		# one cannot glow no matter what its heat value says.
		if _occupied.has(b["id"]):
			heat = maxf(heat, 0.46)
		else:
			heat *= 0.16
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
			l.light_energy = 1.6 + 4.2 * ranked[k]["heat"]
		else:
			l.light_energy = 0.0

	_update_routes()

	# The Wall: substrate constant, radiance carries sentiment.
	var soul := _soul_colour(economic_health)
	_wall_light.light_color = soul
	_wall_light.light_energy = 3.2

	# People out in the open.
	var pmm := _people_mm.multimesh
	pmm.instance_count = street_people.size()
	for i in street_people.size():
		var p = street_people[i]
		var role = p.get("role")
		var off := Vector3.ZERO
		pmm.set_instance_transform(i, Transform3D(Basis(),
			Vector3(float(p["x"]), PERSON_HEIGHT * 0.5 + 0.06, float(p["y"])) + off))
		# Role-specific colour, the same six hues the 2D view and the station signs use. A
		# roleless player gets Ember's own ink tone — a colour of their own, not an absence of
		# one, and at the same brightness as everyone else. Constraint 6's floor has a visual
		# form and it is as easy to breach with a draw call as with a rule.
		var pc: Color = ROLE_COLOUR[role] if (role != null and ROLE_COLOUR.has(role)) else COLOUR_GRIFTER
		pmm.set_instance_color(i, pc)
		_place_icon(i, Vector3(float(p["x"]), 0.0, float(p["y"])) + off, role, pc)

	# A working occupant's glyph rides above their ROOF — the sign over the door, telling you
	# who is in there without drawing a body you could not see anyway.
	var n := street_people.size()
	for bid in _occupied:
		var occ = _occupied[bid]
		var b = _building_by_id.get(bid)
		if b == null:
			continue
		var rc: Color = ROLE_COLOUR.get(occ.get("role"), COLOUR_GRIFTER)
		_place_icon(n, Vector3(float(b["x"]), _roof_height(b), float(b["y"])), occ.get("role"), rc)
		n += 1
	_hide_icons_from(n)


## Gathers each station's contribution onto the plots near it. Falls off with distance, so a
## busy Bakery warms its own street and not the whole quarter.
const LOCAL_REACH := 2.3
const BACKSTOP_TONE := Color8(150, 152, 156)

func _accumulate_local_weather() -> void:
	for i in _plot_local.size():
		_plot_local[i] = Color.BLACK
		_plot_local_w[i] = 0.0

	for b in buildings:
		var st = stations.get(b["id"])
		if st == null:
			continue
		var state := str(st["state"])
		var tone: Color
		var strength: float
		if state == "BACKSTOPPED":
			tone = BACKSTOP_TONE
			strength = 0.42
		elif state == "VACANT" or not _occupied.has(b["id"]):
			tone = TENSION_COLD
			strength = 0.38
		else:
			var heat: float = clampf(float(st["heat"]) / HEAT_OBSERVED_MAX, 0.0, 1.0)
			tone = HEAT_HOT
			strength = 0.34 + 0.5 * heat

		var bp := Vector2(float(b["x"]), float(b["y"]))
		for i in _plot_pos.size():
			var d: float = bp.distance_to(_plot_pos[i])
			if d > LOCAL_REACH:
				continue
			var f: float = (1.0 - d / LOCAL_REACH)
			f = f * f * strength
			var prev_w: float = _plot_local_w[i]
			var nw: float = prev_w + f
			if nw <= 0.0:
				continue
			_plot_local[i] = _plot_local[i].lerp(tone, f / nw)
			_plot_local_w[i] = nw


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_cam_span = maxf(4.0, _cam_span / 1.1)
			_place_camera()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_cam_span = minf(60.0, _cam_span * 1.1)
			_place_camera()
	elif event is InputEventMouseMotion and (event.button_mask & MOUSE_BUTTON_MASK_LEFT):
		_cam_yaw += event.relative.x * 0.006
		_place_camera()
	elif event is InputEventKey and event.pressed:
		if event.keycode == KEY_Q:
			_cam_yaw -= PI * 0.25
			_place_camera()
		elif event.keycode == KEY_E:
			_cam_yaw += PI * 0.25
			_place_camera()


## Offscreen capture, opt-in via `NODE_SHOT=/path/to.png`. Permanent rather than a throwaway
## patch because it is the whole review loop in an environment with no monitor: render, save,
## look, adjust. Waits for `frame_post_draw` or the texture is read before the frame it is
## meant to contain has been drawn.
func _capture() -> void:
	await RenderingServer.frame_post_draw
	var err := get_viewport().get_texture().get_image().save_png(_shot_path)
	print("[NODE] capture %s -> %s" % ["ok" if err == OK else "FAILED", _shot_path])
	get_tree().quit()


# ---------------------------------------------------------------------------------------
# ROLE ICONS — the same six glyphs the 2D view and the station signs use, rasterised once
# into small textures and billboarded above each person.
#
# Drawn in code rather than shipped as art, for the same reason the 2D ones were: the client
# stays self-contained with no import step and nothing to lose. A letter is a label; a shape
# is an identity, and the shape a person carries should match the sign over the door they
# work behind.
# ---------------------------------------------------------------------------------------

var _icon_tex: Dictionary = {}
var _icon_pool: Array[Sprite3D] = []


func _px(img: Image, x: int, y: int, c: Color) -> void:
	if x >= 0 and y >= 0 and x < ICON_TEX_PX and y < ICON_TEX_PX:
		img.set_pixel(x, y, c)


func _px_line(img: Image, a: Vector2, b: Vector2, c: Color, w: float = 1.6) -> void:
	var steps := int(maxf(absf(b.x - a.x), absf(b.y - a.y)) * 2.0) + 2
	for i in steps + 1:
		var p := a.lerp(b, float(i) / float(steps))
		var r := int(ceil(w * 0.5))
		for dx in range(-r, r + 1):
			for dy in range(-r, r + 1):
				if Vector2(dx, dy).length() <= w * 0.5:
					_px(img, int(p.x) + dx, int(p.y) + dy, c)


func _px_ring(img: Image, centre: Vector2, radius: float, c: Color, w: float = 1.6) -> void:
	var steps := int(radius * 12.0) + 8
	for i in steps:
		var a := TAU * float(i) / float(steps)
		_px_line(img, centre + Vector2(cos(a), sin(a)) * radius,
			centre + Vector2(cos(a), sin(a)) * radius, c, w)


func _icon_texture(role) -> ImageTexture:
	var key := str(role)
	if _icon_tex.has(key):
		return _icon_tex[key]
	var img := Image.create(ICON_TEX_PX, ICON_TEX_PX, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c := Color(1, 1, 1, 1)
	var m := float(ICON_TEX_PX) * 0.5
	var r := float(ICON_TEX_PX) * 0.34
	match role:
		"miller":  # windmill sails
			for i in 4:
				var a: float = TAU * float(i) / 4.0 + PI * 0.25
				_px_line(img, Vector2(m, m), Vector2(m, m) + Vector2(cos(a), sin(a)) * r, c, 2.4)
			_px_ring(img, Vector2(m, m), r * 0.2, c, 2.2)
		"baker":  # a domed loaf
			for i in 22:
				var a: float = PI + PI * float(i) / 21.0
				_px_line(img, Vector2(m, m + r * 0.34) + Vector2(cos(a), sin(a)) * r * 0.82,
					Vector2(m, m + r * 0.34) + Vector2(cos(a), sin(a)) * r * 0.82, c, 2.4)
			_px_line(img, Vector2(m - r * 0.82, m + r * 0.34), Vector2(m + r * 0.82, m + r * 0.34), c, 2.4)
		"courier":  # a parcel with a strap
			_px_line(img, Vector2(m - r * .7, m - r * .7), Vector2(m + r * .7, m - r * .7), c, 2.2)
			_px_line(img, Vector2(m + r * .7, m - r * .7), Vector2(m + r * .7, m + r * .7), c, 2.2)
			_px_line(img, Vector2(m + r * .7, m + r * .7), Vector2(m - r * .7, m + r * .7), c, 2.2)
			_px_line(img, Vector2(m - r * .7, m + r * .7), Vector2(m - r * .7, m - r * .7), c, 2.2)
			_px_line(img, Vector2(m, m - r * .7), Vector2(m, m + r * .7), c, 2.2)
		"investigator":  # a magnifier (2026-08-22: merged from Journalist+Detective — kept
			# Detective's glyph since its mechanic, not Journalist's, survived the merge)
			_px_ring(img, Vector2(m - r * .18, m - r * .18), r * 0.55, c, 2.4)
			_px_line(img, Vector2(m + r * .2, m + r * .2), Vector2(m + r * .78, m + r * .78), c, 2.6)
		"importExport":  # two arrows passing
			_px_line(img, Vector2(m - r * .75, m - r * .3), Vector2(m + r * .75, m - r * .3), c, 2.2)
			_px_line(img, Vector2(m + r * .3, m - r * .68), Vector2(m + r * .75, m - r * .3), c, 2.2)
			_px_line(img, Vector2(m + r * .75, m + r * .3), Vector2(m - r * .75, m + r * .3), c, 2.2)
			_px_line(img, Vector2(m - r * .3, m + r * .68), Vector2(m - r * .75, m + r * .3), c, 2.2)
		_:  # roleless: a plain mark, present and unlabelled
			_px_ring(img, Vector2(m, m), r * 0.3, c, 2.6)
	var tex := ImageTexture.create_from_image(img)
	_icon_tex[key] = tex
	return tex


## Pooled so no node is created or freed per tick.
func _place_icon(index: int, ground: Vector3, role, tint: Color) -> void:
	while _icon_pool.size() <= index:
		var sp := Sprite3D.new()
		sp.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		sp.shaded = false
		sp.no_depth_test = true
		sp.render_priority = 4
		sp.pixel_size = ICON_WORLD_SIZE / float(ICON_TEX_PX)
		add_child(sp)
		_icon_pool.append(sp)
	var s3 := _icon_pool[index]
	s3.visible = true
	s3.texture = _icon_texture(role)
	s3.modulate = tint
	s3.position = ground + Vector3(0.0, PERSON_HEIGHT + 0.42, 0.0)


func _hide_icons_from(n: int) -> void:
	for i in range(n, _icon_pool.size()):
		_icon_pool[i].visible = false
