## Headless perception worker (2026-10-23). Connects to the Node's perception bridge
## (src/observatory/perceptionBridge.ts), derives each request with Perception.gd and sends the
## observation back. It holds no world state and cannot step the world; it only answers the
## requests it receives, in order.
##
##   godot --headless --path client res://scenes/PerceptionWorker.tscn -- --perception-url=ws://127.0.0.1:PORT/observatory/v1/perception
##
## The bearer token comes from NODE_PERCEPTION_TOKEN, never the command line, which other local
## users can read from the process list. The worker exits when the bridge closes the connection.
extends Node3D

const Perception := preload("res://scripts/Perception.gd")
const BUFFER_BYTES := 4 * 1024 * 1024
## Physics frames to wait after a scene rebuild before raycasting against the new colliders.
const SETTLE_FRAMES := 2

var _ws := WebSocketPeer.new()
var _perception: Node3D
var _inbox: Array[String] = []
var _current = null
var _settle := 0
var _greeted := false


func _ready() -> void:
	Engine.physics_ticks_per_second = 120
	_perception = Perception.new()
	add_child(_perception)
	var url := _user_arg("--perception-url=", OS.get_environment("NODE_PERCEPTION_URL"))
	var token := OS.get_environment("NODE_PERCEPTION_TOKEN")
	if url == "" or token == "":
		printerr("[perception] needs --perception-url and NODE_PERCEPTION_TOKEN")
		get_tree().quit(2)
		return
	_ws.inbound_buffer_size = BUFFER_BYTES
	_ws.outbound_buffer_size = BUFFER_BYTES
	_ws.handshake_headers = PackedStringArray(["Authorization: Bearer %s" % token])
	if _ws.connect_to_url(url) != OK:
		printerr("[perception] could not open the connection")
		get_tree().quit(3)


func _user_arg(prefix: String, fallback: String) -> String:
	for a in OS.get_cmdline_user_args():
		if a.begins_with(prefix):
			return a.substr(prefix.length())
	return fallback


## All work happens inside physics processing, where the physics space may be queried.
func _physics_process(_delta: float) -> void:
	_ws.poll()
	var state := _ws.get_ready_state()
	if state == WebSocketPeer.STATE_CLOSED:
		get_tree().quit(0 if _greeted else 4)
		return
	if state != WebSocketPeer.STATE_OPEN:
		return
	if not _greeted:
		var v := Engine.get_version_info()
		_ws.send_text(JSON.stringify({"type": "perceptionWorker", "profile": Perception.PROFILE,
			"engine": {"name": "godot", "version": "%s %s" % [v["string"], v["hash"]]}}))
		_greeted = true
	while _ws.get_available_packet_count() > 0:
		_inbox.append(_ws.get_packet().get_string_from_utf8())
	if _settle > 0:
		_settle -= 1
		return
	if _current == null and not _inbox.is_empty():
		var parsed = JSON.parse_string(_inbox.pop_front())
		if typeof(parsed) != TYPE_DICTIONARY or parsed.get("type") != "perceptionRequest":
			var id = parsed.get("requestId") if typeof(parsed) == TYPE_DICTIONARY else null
			_ws.send_text(JSON.stringify({"type": "perception", "requestId": id, "error": "perception_request_unreadable"}))
			return
		_current = parsed
	if _current == null:
		return
	if _perception.needs_rebuild(_current):
		_perception.rebuild(_current)
		_settle = SETTLE_FRAMES
		return
	_ws.send_text(JSON.stringify(_perception.derive(_current)))
	_current = null
