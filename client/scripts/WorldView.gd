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
## and TENSION_OBSERVED_MAX are the same observed maxima the terminal renderer ranges against.

const SERVER_HOST := "ws://127.0.0.1:8080"

# --- Ember palette, copied from src/sim/playtestRenderer.ts -------------------------------
const GROUND := Color8(13, 10, 8)
const TENSION_CALM := Color8(20, 16, 12)
const TENSION_TENSE := Color8(67, 23, 15)
const HEAT_COOL := Color8(74, 107, 122)
const HEAT_HOT := Color8(255, 171, 62)
const COLOUR_WALL := Color8(239, 220, 174)
const COLOUR_PLAZA := Color8(176, 144, 86)
const COLOUR_STREET := Color8(47, 40, 34)
const COLOUR_PLAIN := Color8(74, 64, 56)
const COLOUR_GRIFTER := Color8(217, 201, 176)
const COLOUR_AWAY := Color8(232, 168, 92)

const HEAT_OBSERVED_MAX := 0.5
const TENSION_OBSERVED_MAX := 0.25

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
	"journalist": Color8(168, 154, 196),
	"detective": Color8(196, 96, 96),
	"importExport": Color8(148, 168, 108),
}

const CELL := 44.0        ## pixels per world unit at zoom 1
const BUILDING_SIZE := 30.0
const PERSON_RADIUS := 6.0

var socket := WebSocketPeer.new()
var was_connected := false
var logged_first_tick := false

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


func _ready() -> void:
	# Godot's WebSocketPeer requires an explicit path before any query string — a bare
	# "host:port" is rejected as invalid. Kept from the original scaffold, where a real Godot
	# run (not a throwaway JS client) was what caught it.
	var err := socket.connect_to_url("%s/" % SERVER_HOST)
	if err != OK:
		hud.text = "Failed to start connection (error %d)" % err
		return
	hud.text = "Connecting to %s..." % SERVER_HOST


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


func _world_to_px(x: float, y: float) -> Vector2:
	return Vector2(x, y) * CELL


func _draw() -> void:
	if not have_geometry:
		return

	# Ground wash carries district tension — the ambient mood layer, drawn under everything.
	# Auto-ranged against the observed maximum, not the theoretical one.
	var t: float = clampf(mean_tension / TENSION_OBSERVED_MAX, 0.0, 1.0)
	var wash: Color = TENSION_CALM.lerp(TENSION_TENSE, t)
	if bounds.has("minX"):
		var top_left := _world_to_px(float(bounds["minX"]) - 1.0, float(bounds["minY"]) - 1.0)
		var size := _world_to_px(float(bounds["maxX"]) - float(bounds["minX"]) + 3.0,
			float(bounds["maxY"]) - float(bounds["minY"]) + 3.0)
		draw_rect(Rect2(top_left, size), wash, true)

	for p in plots:
		var pos := _world_to_px(float(p["x"]), float(p["y"]))
		var kind: String = str(p.get("kind", ""))
		var col: Color = COLOUR_PLAZA if kind == "plaza" else COLOUR_STREET
		draw_rect(Rect2(pos - Vector2(CELL, CELL) * 0.5, Vector2(CELL, CELL)), col, true)

	for b in buildings:
		_draw_building(b)

	# The Wall. Always bright, always intact, regardless of how the shard is doing — this is
	# the doctrine's clearest single case.
	var hub_px := _world_to_px(hub.x, hub.y)
	var wall := Vector2(BUILDING_SIZE, BUILDING_SIZE) * 1.5
	draw_rect(Rect2(hub_px - wall * 0.5, wall), COLOUR_WALL, true)
	# A soft halo so the Wall reads as the settlement's landmark rather than a pale building.
	# Brightness is constant — it does NOT track shard health, per the doctrine.
	draw_arc(hub_px, BUILDING_SIZE * 1.25, 0.0, TAU, 32, Color(COLOUR_WALL, 0.35), 3.0)

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

	var heat: float = clampf(float(station["heat"]) / HEAT_OBSERVED_MAX, 0.0, 1.0)
	var brightness: float = float(STATE_BRIGHTNESS.get(station["state"], 1.0))
	var col: Color = HEAT_COOL.lerp(HEAT_HOT, heat)
	col = Color(col.r * brightness, col.g * brightness, col.b * brightness)
	draw_rect(rect, col, true)

	# Role tint as a thin border rather than the fill: heat owns the fill, because heat is the
	# signal that actually changes. Role is a constant fact and gets the quieter channel.
	var role = b.get("role")
	if role != null and ROLE_COLOUR.has(role):
		draw_rect(rect, ROLE_COLOUR[role], false, 2.0)


func _draw_person(p: Dictionary) -> void:
	var pos := _world_to_px(float(p["x"]), float(p["y"]))
	var role = p.get("role")
	# A roleless player (grifter) gets Ember's ink tone; a role-holder gets the away-from-post
	# warm tone, with their role's own hue as a ring. Nobody on this map is anonymous-looking
	# in the sense of being invisible — everyone present is drawn (constraint 6's floor is
	# about access, and this is its visual counterpart: presence is never taken away).
	var body: Color = COLOUR_GRIFTER if role == null else COLOUR_AWAY
	draw_circle(pos, PERSON_RADIUS, body)
	if role != null and ROLE_COLOUR.has(role):
		draw_arc(pos, PERSON_RADIUS + 2.0, 0.0, TAU, 12, ROLE_COLOUR[role], 1.5)
