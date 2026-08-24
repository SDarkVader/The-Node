extends Node2D

## The first client that renders the actual NODE settlement (2026-08-19).
##
## Consumes `src/server/worldProtocol.ts` — `hello` once for geometry, then a `tick` per
## simulated day. The old Main.gd scaffold spoke the §8 MVP protocol (two Bakers and a price
## spread); that server path still exists behind NODE_LEGACY_MVP=1, but this is the real one.
##
## PALETTE IS NOT INVENTED HERE. Every colour below is copied from the shipped Ember palette in
## `src/sim/playtestRenderer.ts`, which is the first real execution of the visual doctrine in
## `docs/DESIGN_NODE_VISUAL_FOUNDATION_2026-08-19.md`. Two renderers of the same world should
## not disagree about what "hot" looks like. If a value here and there ever diverge, the
## TypeScript one is the source of truth.
##
## THE ONE RULE THIS RENDERER OBEYS, from that brief: structural beauty stays constant, colour
## is the only honest variable. Buildings keep their shape and footprint no matter how sick the
## shard is; a BACKSTOPPED station renders QUIETER, never broken or damaged. Nothing here
## distresses geometry to signal distress.
##
## AUTO-RANGING, and why. Measured tension sits around 0.06-0.08 and heat tops out near 0.5, so
## a literal 0..1 mapping renders the whole town flat and permanently calm. HEAT_OBSERVED_MAX
## HEAT_OBSERVED_MAX is the same observed maximum the terminal renderer ranges against, and
## tension uses a diverging scale anchored on its measured percentiles (see below).

const SERVER_HOST := "ws://127.0.0.1:8080"

# --- Ember palette, copied from src/sim/playtestRenderer.ts -------------------------------
const GROUND := Color8(13, 10, 8)
## Emotional weather is a DIVERGING scale, not a ramp (2026-08-19). Cold blue below the median,
## Ember's own warmth at it, real red above. Anchors are the measured p05/median/p95 of real
## district tension (0.03 / 0.06 / 0.10, from 5600 district-day samples) — the old mapping ran
## near-black to dark red against a 0.25 ceiling, so the town sat permanently in the bottom
## third and "calm" was just darkness rather than a colour. Mirrors playtestRenderer.ts.
const TENSION_COLD := Color8(20, 38, 66)
const TENSION_EMBER := Color8(40, 30, 20)
const TENSION_HOT := Color8(104, 28, 18)
const TENSION_COLD_AT := 0.03
const TENSION_MEDIAN := 0.06
const TENSION_HOT_AT := 0.10
const HEAT_COOL := Color8(74, 107, 122)
const HEAT_HOT := Color8(255, 171, 62)
const COLOUR_WALL := Color8(239, 220, 174)
const COLOUR_PLAZA := Color8(176, 144, 86)
const COLOUR_STREET := Color8(47, 40, 34)
const COLOUR_PLAIN := Color8(74, 64, 56)
const COLOUR_GRIFTER := Color8(217, 201, 176)
const COLOUR_AWAY := Color8(232, 168, 92)

const HEAT_OBSERVED_MAX := 0.5

## Matches playtestRenderer's STATE_BRIGHTNESS exactly. A held station is full strength; a
## mechanically-backstopped one is dimmer but intact (constraint 2 — never renders as broken);
## a vacant one is dimmer still.
const STATE_BRIGHTNESS := {"FILLED": 1.0, "BACKSTOPPED": 0.5, "VACANT": 0.28}

## Per-role hue. [CHOSEN HERE, 2026-08-19 — flagged rather than presented as derived.] The
## visual brief's mapping table calls for "6 clearly separable colours", but no per-role hue
## exists anywhere in the engine yet: the terminal renderer distinguishes roles by GLYPH and
## spends its colour budget on heat instead. These are picked to sit inside Ember's warm range
## while staying separable, and should be treated as a first proposal, not a decision.
const ROLE_COLOUR := {
	"miller": Color8(226, 178, 92),
	"baker": Color8(214, 122, 74),
	"courier": Color8(122, 158, 148),
	"investigator": Color8(196, 96, 96),
	"importExport": Color8(148, 168, 108),
}

const CELL := 44.0        ## pixels per world unit at zoom 1
const BUILDING_SIZE := 30.0
const PERSON_RADIUS := 6.0
## The Wall is a short segment at 45 degrees, centred on the hub. The angle is the
## settlement's own: plots are generated as a DIAMOND (a radius-7 Manhattan ball), so its edges
## run at 45 degrees and the Wall sits parallel to them rather than cutting across the grain.
## Deliberately short — it is a monument in the plaza, not a partition across the map.
## The Wall occupies ONE CELL — its own. The bar spans 3/4 of that cell, centred, so it keeps
## clear space either side rather than touching the neighbouring ground.
const WALL_SPAN_CELLS := 0.75
## Rotated 90 degrees off the diamond's grain (was PI*0.25). It now runs across the diagonal
## the settlement's plots follow, so the monument reads as set INTO the town rather than
## aligned with it.
const WALL_ANGLE := PI * 0.75
## The circular substrate the bar stands on, as a fraction of a cell.
const WALL_BASE_RADIUS_CELLS := 0.40

## SENTIMENT ANCHORS — measured, not guessed (6392 samples, 8 seeds x 800 days after burn-in).
## Real `economicHealth` runs min 0.804 / p05 0.857 / median 0.909 / p95 0.948 / max 0.987.
## The first mapping ramped to full red below 0.70, a range the shard never actually enters, so
## the Wall sat permanently gold and its sentiment channel said nothing — the same mistake the
## tension ramp made against its own 0.25 ceiling. Anchored on the real band, the Wall now
## genuinely swings across its range in ordinary play.
const HEALTH_WELL := 0.948
const HEALTH_MEDIAN := 0.909
const HEALTH_ILL := 0.857
const SOUL_WELL := Color8(255, 214, 138)
const SOUL_MEDIAN := Color8(232, 150, 74)
const SOUL_ILL := Color8(206, 58, 40)
const WALL_THICKNESS := 7.0
const WALL_GLOW_CELLS := 4.6
const WALL_GLOW_ALPHA := 0.78
## Floating role glyph carried by a PERSON — the one that has to be readable across the plaza.
const ICON_SIZE := 21.0
## The same glyph as a station's shopfront sign: smaller and quieter, because a building's role
## never changes and should not compete with the people moving in front of it.
const STATION_ICON_SIZE := 13.0
const STATION_ICON_ALPHA := 0.55

var socket := WebSocketPeer.new()
var was_connected := false
var logged_first_tick := false
var _falloff: ImageTexture

var have_geometry := false
var plots: Array = []
var buildings: Array = []
var hub := Vector2.ZERO
var bounds := {}

var stations := {}        ## buildingId -> {state, heat}
var people: Array = []
var day := 0
var economic_health := 1.0
var mean_tension := 0.0

@onready var hud: Label = $HUD/Readout
@onready var camera: Camera2D = $Camera2D
@onready var glow: Node2D = $Glow


func _ready() -> void:
	# Godot's WebSocketPeer requires an explicit path before any query string — a bare
	# "host:port" is rejected as invalid. Kept from the original scaffold, where a real Godot
	# run (not a throwaway JS client) was what caught it.
	var err := socket.connect_to_url("%s/" % SERVER_HOST)
	if err != OK:
		hud.text = "Failed to start connection (error %d)" % err
		return
	hud.text = "Connecting to %s..." % SERVER_HOST
	_falloff = _build_falloff(128)


func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not was_connected:
			was_connected = true
		while socket.get_available_packet_count() > 0:
			_handle_message(socket.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		was_connected = false
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
	queue_redraw()
	if glow != null:
		glow.queue_redraw()


func _handle_hello(msg: Dictionary) -> void:
	plots = msg.get("plots", [])
	buildings = msg.get("buildings", [])
	var h: Dictionary = msg.get("hub", {"x": 0, "y": 0})
	hub = Vector2(float(h["x"]), float(h["y"]))
	bounds = msg.get("bounds", {})
	have_geometry = true
	_centre_camera()
	# Printed rather than only drawn, so `--headless` is a real smoke test: it proves the
	# socket connected, the JSON parsed, and geometry landed, none of which a silent window
	# would tell you. See client/README.md's "Verify without opening a window".
	print("[NODE] geometry: %d buildings, %d plots, hub (%d,%d)" % [
		buildings.size(), plots.size(), int(hub.x), int(hub.y)
	])


## The Wall is the settlement's real centre as of 2026-08-19 (it used to sit on the western
## rim — see docs/HANDOVER.md's CLOSED section), so centring on the hub genuinely centres the
## town rather than framing one edge of it.
func _centre_camera() -> void:
	camera.position = hub * CELL


func _handle_tick(msg: Dictionary) -> void:
	# JSON numbers always parse as float in GDScript; int-typed fields need an explicit cast
	# or assigning into a declared `int` throws at runtime.
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

	hud.text = "Day %d    health %.3f    tension %.3f    %d people" % [
		day, economic_health, mean_tension, people.size()
	]
	if not logged_first_tick:
		logged_first_tick = true
		print("[NODE] first tick: day %d, %d people, %d stations, health %.3f" % [
			day, people.size(), stations.size(), economic_health
		])


func _unhandled_input(event: InputEvent) -> void:
	# Pan by dragging, zoom on the wheel. The whole point of this client is being able to move
	# around inside the place rather than looking at a fixed frame.
	if event is InputEventMouseMotion and (event.button_mask & MOUSE_BUTTON_MASK_LEFT):
		camera.position -= event.relative / camera.zoom.x
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.zoom *= 1.1
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.zoom /= 1.1
		camera.zoom = camera.zoom.clamp(Vector2(0.25, 0.25), Vector2(4.0, 4.0))


## Diverging blue <- Ember -> red, anchored on the measured distribution. Mirrors
## playtestRenderer.ts's tensionColour(); if the two ever disagree, the TypeScript one wins.
func _tension_colour(tension: float) -> Color:
	if tension <= TENSION_MEDIAN:
		var t := clampf((tension - TENSION_COLD_AT) / (TENSION_MEDIAN - TENSION_COLD_AT), 0.0, 1.0)
		return TENSION_COLD.lerp(TENSION_EMBER, t)
	var t2 := clampf((tension - TENSION_MEDIAN) / (TENSION_HOT_AT - TENSION_MEDIAN), 0.0, 1.0)
	return TENSION_EMBER.lerp(TENSION_HOT, t2)


## Radial falloff, generated rather than shipped as an asset — keeps the client
## self-contained (no import step, nothing to lose) and puts the curve in one place. Shared
## with the additive glow layer via `_falloff`, so both use the same shape.
##
## Deliberately NOT a `class_name` static: registering a global class is something the Godot
## EDITOR writes into project.godot, and this project has been driven headless, so a
## class_name reference fails to resolve at load. Found by running it.
func _build_falloff(tex_size: int) -> ImageTexture:
	var img := Image.create(tex_size, tex_size, false, Image.FORMAT_RGBA8)
	var c := (tex_size - 1) * 0.5
	for y in tex_size:
		for x in tex_size:
			var d := Vector2(x - c, y - c).length() / c
			var a := 0.0
			if d < 1.0:
				var f := 1.0 - d
				a = f * f
			img.set_pixel(x, y, Color(1, 1, 1, a))
	return ImageTexture.create_from_image(img)


func _world_to_px(x: float, y: float) -> Vector2:
	return Vector2(x, y) * CELL


func _draw() -> void:
	if not have_geometry:
		return

	# Ground wash carries district tension — the ambient mood layer, drawn under everything.
	# Auto-ranged against the observed maximum, not the theoretical one.
	# Drawn as a soft radial field rather than a filled rectangle. A rect gave the settlement a
	# hard rectangular border that read as a UI panel sitting behind the town — the mood is
	# atmosphere, so it has to fade out rather than stop at an edge.
	var wash: Color = _tension_colour(mean_tension)
	if bounds.has("minX"):
		var span := maxf(
			float(bounds["maxX"]) - float(bounds["minX"]),
			float(bounds["maxY"]) - float(bounds["minY"])
		) + 6.0
		var r: float = span * CELL
		var centre := _world_to_px(
			(float(bounds["minX"]) + float(bounds["maxX"])) * 0.5,
			(float(bounds["minY"]) + float(bounds["maxY"])) * 0.5
		)
		draw_texture_rect(_falloff, Rect2(centre - Vector2(r, r) * 0.5, Vector2(r, r)), false, wash)

	for p in plots:
		var pos := _world_to_px(float(p["x"]), float(p["y"]))
		var kind: String = str(p.get("kind", ""))
		var col: Color = COLOUR_PLAZA if kind == "plaza" else COLOUR_STREET
		draw_rect(Rect2(pos - Vector2(CELL, CELL) * 0.5, Vector2(CELL, CELL)), col, true)

	for b in buildings:
		_draw_building(b)

	# The Wall. Always bright, always intact, regardless of how the shard is doing — this is
	# the doctrine's clearest single case.
	_draw_wall()

	for person in people:
		_draw_person(person)


func _draw_building(b: Dictionary) -> void:
	var pos := _world_to_px(float(b["x"]), float(b["y"]))
	var rect := Rect2(pos - Vector2(BUILDING_SIZE, BUILDING_SIZE) * 0.5,
		Vector2(BUILDING_SIZE, BUILDING_SIZE))

	var station = stations.get(b["id"])
	if station == null:
		# A real building carrying no role slot — 16 of the shipped config's 62. Housing only.
		draw_rect(rect, COLOUR_PLAIN, true)
		return

	# Structure only. Heat used to be painted as a flat box fill here, which made the map read
	# as a spreadsheet of tinted cells; it now lives in the additive glow layer above, where
	# neighbouring stations blend into regions. Filling BOTH would double-count the one signal
	# that has to stay honest, so this keeps a low, cool base that says "a station is here and
	# it is held/quiet/empty" and says nothing about how busy it is.
	var brightness: float = float(STATE_BRIGHTNESS.get(station["state"], 1.0))
	var base := Color(HEAT_COOL.r * 0.45, HEAT_COOL.g * 0.45, HEAT_COOL.b * 0.45)
	draw_rect(rect, Color(base.r * brightness, base.g * brightness, base.b * brightness), true)

	# Role reads as an ICON on the station, not a letter and not only a border tint — the same
	# glyph the people who hold that role carry, so a Bakery and a Baker are visibly the same
	# thing. The border stays as a quiet second channel for the same fact.
	var role = b.get("role")
	if role != null and ROLE_COLOUR.has(role):
		var rc: Color = ROLE_COLOUR[role]
		draw_rect(rect, rc, false, 2.0)
		# Hung in the upper-left of the facade like a shop sign, quiet and small: it states a
		# permanent fact. People move and change; the sign does not, so it yields to them.
		_draw_role_icon(pos - Vector2(BUILDING_SIZE, BUILDING_SIZE) * 0.28,
			role, Color(rc, STATION_ICON_ALPHA), STATION_ICON_SIZE)


func _draw_person(p: Dictionary) -> void:
	var pos := _world_to_px(float(p["x"]), float(p["y"]))
	var role = p.get("role")
	# A roleless player (grifter) gets Ember's ink tone; a role-holder gets the away-from-post
	# warm tone, with their role's own hue as a ring. Nobody on this map is anonymous-looking
	# in the sense of being invisible — everyone present is drawn (constraint 6's floor is
	# about access, and this is its visual counterpart: presence is never taken away).
	# A ROLELESS PLAYER IS A PERSON, NOT A GAP. They get a clean pale mark and nothing else —
	# no glyph, because they hold no role, and deliberately no dark backing plate either. An
	# earlier version gave everyone the plate and roughly a third of the population (the
	# grifters) rendered as black blobs with a speck in them: the least powerful people on the
	# map became the ugliest thing on it. Constraint 6's floor has a visual form, and this is
	# it — never buried, never made harder to see than anyone else.
	if role == null or not ROLE_COLOUR.has(role):
		draw_circle(pos, PERSON_RADIUS, COLOUR_GRIFTER)
		return

	draw_circle(pos, PERSON_RADIUS * 0.75, COLOUR_AWAY)
	# The floating role glyph rides above the body — in the world, like a sign carried, not HUD
	# chrome. A soft plate behind it keeps it readable over a blazing station without becoming
	# an object in its own right.
	var at := pos + Vector2(0, -ICON_SIZE * 0.8)
	draw_circle(at, ICON_SIZE * 0.55, Color(0.05, 0.04, 0.03, 0.5))
	_draw_role_icon(at, role, ROLE_COLOUR[role], ICON_SIZE)


## THE WALL — a golden line through the middle of the town, not a block (2026-08-19).
##
## SUBSTRATE IS HOPE; RADIANCE IS SENTIMENT. The two are deliberately separated (2026-08-19,
## user direction). A circular gold base and its bar occupy the hub's own single cell and never
## change colour — that is what the node is FOR, and it is structural. The heat map radiating
## off it carries how the node is doing RIGHT NOW: gold when well, red when not. A shard in
## crisis therefore shows a red glow around an unchanged gold monument, rather than a monument
## that has itself gone red. Hope does not degrade with the weather.
##
## [STAND-IN, flagged]: the sentiment spec (VISUAL_FRAMEWORK_2026-08-12.md) names
## `soulTemperature`, which nothing in the engine computes; this uses `economicHealth`, which is
## real and already on the wire. One line to repoint if soulTemperature is ever built.
##
## ONE CELL OF VOLUME. The physical monument stays inside the cell it occupies, at 3/4 of a
## cell wide so it keeps clear space either side. Only its LIGHT crosses into the plaza —
## radiance is not volume.
##
## NEVER DIMS. The Wall does not darken, thin, crack or break as the shard declines. That is
## the doctrine's clearest single case, and the substrate/radiance split makes it structural
## rather than a rule to remember.
## Diverging gold <- amber -> red across the health band the shard really occupies. Same shape
## and the same reasoning as `_tension_colour`: spend the visual range where the data lives.
func _soul_colour(health: float) -> Color:
	if health >= HEALTH_MEDIAN:
		var t := clampf((health - HEALTH_MEDIAN) / (HEALTH_WELL - HEALTH_MEDIAN), 0.0, 1.0)
		return SOUL_MEDIAN.lerp(SOUL_WELL, t)
	var t2 := clampf((HEALTH_MEDIAN - health) / (HEALTH_MEDIAN - HEALTH_ILL), 0.0, 1.0)
	return SOUL_MEDIAN.lerp(SOUL_ILL, t2)


func _draw_wall() -> void:
	var centre := _world_to_px(hub.x, hub.y)
	var soul_col: Color = _soul_colour(economic_health)

	# ---- Radiance: the sentiment ------------------------------------------------------
	# The heat map around the Wall is what carries the node's mood — gold when it is well,
	# red when it is not. Drawn FIRST and beneath, so the substrate sits inside its own light
	# rather than being tinted by it. Radiance is light, not volume: it is the one part of the
	# Wall allowed past its own cell, spilling into the plaza around it.
	draw_set_transform(centre, WALL_ANGLE, Vector2.ONE)
	var half_w: float = WALL_SPAN_CELLS * 0.5 * CELL
	for i in 3:
		var spread: float = WALL_GLOW_CELLS * CELL * (0.4 + 0.6 * float(i))
		var w: float = half_w * 2.0 + spread * 0.9
		draw_texture_rect(_falloff, Rect2(Vector2(-w * 0.5, -spread * 0.5), Vector2(w, spread)),
			false, Color(soul_col, WALL_GLOW_ALPHA / float(i + 1)))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

	# ---- Substrate: the hope -----------------------------------------------------------
	# CONSTANT GOLD, never tinted by health. This is the split that matters: the base is what
	# the node is FOR and does not change with how it is doing, while the light coming off it
	# is how it is doing right now. A shard in crisis has a red glow around an unchanged gold
	# monument — the hope is structural, the sentiment is weather.
	var base_r: float = WALL_BASE_RADIUS_CELLS * CELL
	draw_circle(centre, base_r, Color(COLOUR_WALL, 0.22))
	draw_circle(centre, base_r * 0.72, COLOUR_WALL)

	# The bar itself, standing on the substrate, also constant gold.
	draw_set_transform(centre, WALL_ANGLE, Vector2.ONE)
	draw_rect(Rect2(Vector2(-half_w, -WALL_THICKNESS * 0.5), Vector2(half_w * 2.0, WALL_THICKNESS)),
		COLOUR_WALL, true)
	var core_col: Color = COLOUR_WALL.lerp(Color(1.0, 0.98, 0.92), 0.6)
	draw_rect(Rect2(Vector2(-half_w, -WALL_THICKNESS * 0.18), Vector2(half_w * 2.0, WALL_THICKNESS * 0.36)),
		core_col, true)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


## Role icons, drawn procedurally rather than shipped as art (2026-08-19, user: "give it
## character"). Six shapes, each readable at ~14px, each meaning the job rather than spelling
## its initial: a letter is a label, a shape is an identity.
##
## This is the "floating diegetic role-glyph" from the visual foundation brief's §4, built —
## the icon rides above the person rather than being HUD chrome, so what someone is doing is
## legible from across the plaza without a nameplate.
func _draw_role_icon(at: Vector2, role, col: Color, size: float = ICON_SIZE) -> void:
	var r: float = size * 0.5
	match role:
		"miller":
			# Windmill: four sails around a hub.
			for i in 4:
				var a: float = TAU * float(i) / 4.0 + PI * 0.25
				draw_line(at, at + Vector2(cos(a), sin(a)) * r, col, 2.0)
			draw_circle(at, r * 0.22, col)
		"baker":
			# Loaf: a domed top on a flat base.
			draw_arc(at + Vector2(0, r * 0.35), r * 0.85, PI, TAU, 14, col, 2.0)
			draw_line(at + Vector2(-r * 0.85, r * 0.35), at + Vector2(r * 0.85, r * 0.35), col, 2.0)
		"courier":
			# Parcel: a box with a strap.
			draw_rect(Rect2(at - Vector2(r, r) * 0.75, Vector2(r, r) * 1.5), col, false, 2.0)
			draw_line(at + Vector2(0, -r * 0.75), at + Vector2(0, r * 0.75), col, 2.0)
		"investigator":
			# Magnifier: lens and handle. (2026-08-22: merged from Journalist+Detective —
			# kept Detective's glyph since its mechanic, not Journalist's, survived the merge.)
			draw_arc(at + Vector2(-r * 0.2, -r * 0.2), r * 0.6, 0.0, TAU, 16, col, 2.0)
			draw_line(at + Vector2(r * 0.2, r * 0.2), at + Vector2(r * 0.8, r * 0.8), col, 2.0)
		"importExport":
			# Two arrows passing in opposite directions — goods in, goods out.
			draw_line(at + Vector2(-r * 0.8, -r * 0.35), at + Vector2(r * 0.8, -r * 0.35), col, 2.0)
			draw_line(at + Vector2(r * 0.35, -r * 0.7), at + Vector2(r * 0.8, -r * 0.35), col, 2.0)
			draw_line(at + Vector2(r * 0.8, r * 0.35), at + Vector2(-r * 0.8, r * 0.35), col, 2.0)
			draw_line(at + Vector2(-r * 0.35, r * 0.7), at + Vector2(-r * 0.8, r * 0.35), col, 2.0)
		_:
			# Roleless: a plain mark. Present, visible, unlabelled — never invisible, which is
			# constraint 6's floor expressed visually.
			draw_circle(at, r * 0.3, col)
