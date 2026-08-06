extends Control

## Scaffolding client for the NODE ws server (src/server/ws.ts). Proves the
## client/server wire-up and gives a minimally legible view of the §8 MVP scenario —
## Baker prices, Wall posts, rumours as they're heard. Not the real Phase 4 renderer;
## that needs an isometric scene, ambient colour layers, and the fog-of-recognition
## system, none of which exist yet. See docs/BLUEPRINT.md.

const SERVER_URL := "ws://127.0.0.1:8080"

var socket := WebSocketPeer.new()
var was_connected := false

@onready var status_label: Label = $VBox/StatusLabel
@onready var prices_label: Label = $VBox/PricesLabel
@onready var log_label: RichTextLabel = $VBox/Log


func _ready() -> void:
	var err := socket.connect_to_url(SERVER_URL)
	if err != OK:
		status_label.text = "Failed to start connection (error %d)" % err
		return
	status_label.text = "Connecting to %s..." % SERVER_URL


func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not was_connected:
			was_connected = true
			status_label.text = "Connected to %s" % SERVER_URL
		while socket.get_available_packet_count() > 0:
			var packet := socket.get_packet().get_string_from_utf8()
			_handle_message(packet)
	elif state == WebSocketPeer.STATE_CLOSED:
		if was_connected:
			was_connected = false
		status_label.text = "Disconnected (code %d) — is `npm run server` running?" % socket.get_close_code()


func _handle_message(raw: String) -> void:
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	if parsed.get("type") != "tick":
		return

	# JSON numbers always parse as float in GDScript, so int-typed fields need an
	# explicit cast — assigning a float straight into a declared `int` var throws
	# a runtime type error.
	var day: int = int(parsed.get("day", 0))
	var bakers: Array = parsed.get("bakers", [])
	var price_parts: PackedStringArray = []
	for b in bakers:
		price_parts.append("%s: %.3f" % [b["id"], b["price"]])
	var spread: float = parsed.get("spread", 0.0)
	prices_label.text = "Day %d — %s (spread %.3f)" % [day, ", ".join(price_parts), spread]

	var wall_post = parsed.get("wallPost")
	if wall_post != null:
		log_label.append_text(
			"[color=gold]Day %d — [Wall] %s: \"%s\"[/color]\n" % [day, wall_post["authorId"], wall_post["state"]]
		)

	var rumours: Array = parsed.get("rumours", [])
	for r in rumours:
		var tag := "distorted -> \"%s\"" % r["state"] if r["distorted"] else "faithful"
		log_label.append_text(
			"    %s hears it via %s (hop %d, %s)\n" % [r["heardBy"], r["heardFrom"], int(r["hop"]), tag]
		)
