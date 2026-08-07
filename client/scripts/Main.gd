extends Control

## Scaffolding client for the NODE ws server (src/server/ws.ts). Proves the
## client/server wire-up and gives a minimally legible view of the §8 MVP scenario —
## Baker prices, Wall posts, rumours as they're heard. Not the real Phase 4 renderer;
## that needs an isometric scene, ambient colour layers, and the fog-of-recognition
## system, none of which exist yet. See docs/BLUEPRINT.md.
##
## Two message types now, not one (2026-08-07, see docs/BLUEPRINT.md "Architecture
## scoped ahead of schedule"): "tick" is shared broadcast state (Baker prices, spread,
## Wall posts) identical for every connection; "rumour" is targeted, sent only to the
## connection identified by `player_id` below — the server no longer broadcasts every
## player's heardBy/heardFrom to everyone. Set player_id in the editor to see this
## client "be" a specific gossip-layer identity (wren/sable/idris) or a Baker.

const SERVER_HOST := "ws://127.0.0.1:8080"

## Which in-scenario identity this client connects as. Rumours are only ever delivered
## to the connection that identified itself as their intended recipient — see
## src/mvp/scenario.ts's GOSSIP_PLAYERS for the available gossip-layer identities.
@export var player_id: String = "wren"

var socket := WebSocketPeer.new()
var was_connected := false

@onready var status_label: Label = $VBox/StatusLabel
@onready var prices_label: Label = $VBox/PricesLabel
@onready var log_label: RichTextLabel = $VBox/Log


func _ready() -> void:
	# Godot's WebSocketPeer.connect_to_url() rejects a bare "host:port?query" URL as
	# invalid — it requires an explicit path before the query string, unlike most
	# WebSocket clients (including the `ws` package the Node server/tests use, and the
	# throwaway client this was tested against before a real Godot run caught it).
	var server_url := "%s/?player=%s" % [SERVER_HOST, player_id]
	var err := socket.connect_to_url(server_url)
	if err != OK:
		status_label.text = "Failed to start connection (error %d)" % err
		return
	status_label.text = "Connecting to %s as %s..." % [SERVER_HOST, player_id]


func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not was_connected:
			was_connected = true
			status_label.text = "Connected to %s as %s" % [SERVER_HOST, player_id]
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

	match parsed.get("type"):
		"tick":
			_handle_tick(parsed)
		"rumour":
			_handle_rumour(parsed)


func _handle_tick(parsed: Dictionary) -> void:
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


## Only ever arrives addressed to this client's own player_id — the server never sends
## another player's rumour here, so there's no heardBy field to check on this side.
func _handle_rumour(parsed: Dictionary) -> void:
	var day: int = int(parsed.get("day", 0))
	var tag := "distorted -> \"%s\"" % parsed["state"] if parsed["distorted"] else "faithful"
	log_label.append_text(
		"    Day %d — you hear via %s (hop %d, %s)\n" % [day, parsed["heardFrom"], int(parsed["hop"]), tag]
	)
