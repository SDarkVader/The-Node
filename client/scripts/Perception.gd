## Agent-specific perception (2026-10-23, owner request). Derives what ONE agent can perceive of
## the Node world from its current perspective. The input is a perception request the Node built
## for that agent at one committed tick (src/observatory/perception.ts). The output goes back to
## the Node, which checks every item against its own request before the agent receives it. The
## Node stays authoritative: nothing here holds, steps or stores world state.
##
## The geometry is the client's own. Buildings are the boxes IsoView draws
## (NodeGeometry.building_transform), the Wall is its slab at the hub and people are its capsules,
## so an agent is hidden by exactly what the client renders.
##
## FIRST PERSON. Four perspective cameras at the agent's eye face the four grid directions. Bodies
## have no facing in the Node world, so the agent looks around rather than one way. A body or a
## location is perceived only when it is within the visibility range, inside a camera frustum
## (Camera3D.is_position_in_frustum) and on an unobstructed line of sight (a physics ray against
## the building colliders). The range is the condition's maximum, shortened where the condition
## declares fog: Godot's exponential fog transmits exp(-density * d), so sight ends where the
## transmittance falls to the declared threshold.
##   - A role-holder standing at a building is inside it (IsoView's occupancy rule). The walls hide
##     the body; the building's occupied sign stays visible.
##   - The building around the eye does not block the agent's own view out: a ray that starts
##     inside a shape ignores that shape (PhysicsRayQueryParameters3D.hit_from_inside = false).
##   - Someone sharing the agent's cell is perceived by contact.
##   - Only buildings occlude. Bodies do not hide one another.
##
## ISOMETRIC. One orthographic camera over the agent's own district plaza. It reports broad,
## aggregate conditions: the weather band of each district whose plaza is in view, the locations
## in view, and how many bodies stand in the open per district. The Node sends no person
## references for this perspective, so none can come back. As in IsoView's ghost pass ("nobody is
## ever invisible"), a body in the open within the view is counted even when a roof hides it from
## the camera. Fog limits first-person sight only; the overview reports it as a condition.
extends Node3D

const Geo := preload("res://scripts/NodeGeometry.gd")

## The derivation rules this script implements. The Node refuses a response under any other.
const PROFILE := "node-perception-godot-v1"
const BUILDING_LAYER := 1
## Square viewports, so every frustum is the same whatever the window or headless display size.
const VIEWPORT_PX := 512
const EYE_HEIGHT := Geo.PERSON_LIFT + Geo.PERSON_HEIGHT * 0.88
const BODY_CENTRE := Geo.PERSON_LIFT + Geo.PERSON_HEIGHT * 0.5
const HEAD := Geo.PERSON_LIFT + Geo.PERSON_HEIGHT * 0.9
const CONTACT_DISTANCE := 0.5
const ISO_DISTANCE := 60.0
## Key of the Wall's collider among the building colliders; never a building id.
const WALL := "@wall"

var _bodies := {}
var _scene_key := ""
var _ring: Array[Camera3D] = []
var _iso: Camera3D
var _env: Environment
var _engine := {}


func _ready() -> void:
	var v := Engine.get_version_info()
	_engine = {"name": "godot", "version": "%s %s" % [v["string"], v["hash"]]}
	_env = Environment.new()
	_env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	var world_env := WorldEnvironment.new()
	world_env.environment = _env
	add_child(world_env)
	var ring_viewport := _viewport()
	for i in 4:
		var cam := Camera3D.new()
		cam.keep_aspect = Camera3D.KEEP_WIDTH
		cam.near = 0.05
		ring_viewport.add_child(cam)
		_ring.append(cam)
	_iso = Camera3D.new()
	_iso.projection = Camera3D.PROJECTION_ORTHOGONAL
	_iso.keep_aspect = Camera3D.KEEP_WIDTH
	_iso.near = 0.05
	_iso.far = ISO_DISTANCE * 3.0
	_viewport().add_child(_iso)


func _viewport() -> SubViewport:
	var vp := SubViewport.new()
	vp.size = Vector2i(VIEWPORT_PX, VIEWPORT_PX)
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	return vp


## True when the request's buildings differ from the colliders in place. The caller then lets the
## physics server settle (two physics frames) before calling derive().
func needs_rebuild(request: Dictionary) -> bool:
	return _key(request) != _scene_key


func rebuild(request: Dictionary) -> void:
	for id in _bodies:
		var old: Node = _bodies[id]
		remove_child(old)
		old.queue_free()
	_bodies.clear()
	for b in request["scene"]["buildings"]:
		var t := Geo.building_transform(b)
		var body := StaticBody3D.new()
		body.collision_layer = BUILDING_LAYER
		body.collision_mask = 0
		var box := BoxShape3D.new()
		box.size = t.basis.get_scale()
		var shape := CollisionShape3D.new()
		shape.shape = box
		body.add_child(shape)
		body.position = t.origin
		add_child(body)
		_bodies[str(b["id"])] = body
	var hub: Dictionary = request["scene"]["hub"]
	var wall := StaticBody3D.new()
	wall.collision_layer = BUILDING_LAYER
	wall.collision_mask = 0
	var slab := BoxShape3D.new()
	slab.size = Geo.WALL_SIZE
	var wall_shape := CollisionShape3D.new()
	wall_shape.shape = slab
	wall.add_child(wall_shape)
	wall.transform = Geo.wall_transform(float(hub["x"]), float(hub["y"]))
	add_child(wall)
	_bodies[WALL] = wall
	_scene_key = _key(request)


## Geometry only: station state and heat change every tick, the buildings do not.
func _key(request: Dictionary) -> String:
	var geometry := [request["scene"]["hub"]]
	for b in request["scene"]["buildings"]:
		geometry.append([b["id"], b["x"], b["y"], b.get("isLandmark", false)])
	return JSON.stringify(geometry).sha256_text()


func derive(request: Dictionary) -> Dictionary:
	var out := {
		"type": "perception", "schema": "node-perception-observation-v1", "profile": PROFILE,
		"requestId": request["requestId"], "agentId": request["agentId"], "tick": int(request["tick"]),
		"worldHash": request["worldHash"], "perspective": request["perspective"], "engine": _engine,
	}
	match request["perspective"]:
		"first_person":
			out["observation"] = _first_person(request)
		"isometric":
			out["observation"] = _isometric(request)
		_:
			return {"type": "perception", "requestId": request["requestId"], "error": "perception_perspective_unknown"}
	return out


func _first_person(request: Dictionary) -> Dictionary:
	var condition: Dictionary = request["condition"]
	var scene: Dictionary = request["scene"]
	var observer: Dictionary = scene["observer"]
	var fp: Dictionary = condition["firstPerson"]
	var weather: Dictionary = condition["weather"]
	var ox := int(observer["x"])
	var oy := int(observer["y"])
	var eye := Vector3(ox, EYE_HEIGHT, oy)
	var sight := float(fp["maxRange"])
	_env.fog_enabled = weather["kind"] == "fog"
	if _env.fog_enabled:
		var density := float(weather["density"])
		_env.fog_density = density
		sight = minf(sight, -log(float(weather["transmittanceThreshold"])) / density)
	for i in _ring.size():
		var cam := _ring[i]
		cam.fov = float(fp["fovDegrees"])
		cam.far = sight + 2.0
		cam.global_transform = Transform3D(Basis(Vector3.UP, i * PI / 2.0), eye)
	var space := get_world_3d().direct_space_state
	var bodies := []
	for e in scene["entities"]:
		var ex := int(e["x"])
		var ey := int(e["y"])
		var d := _planar(ex - ox, ey - oy)
		if d > sight:
			continue
		if d < CONTACT_DISTANCE or _body_seen(space, eye, Vector3(ex, 0.0, ey)):
			bodies.append({"ref": e["ref"], "role": e["role"], "dx": ex - ox, "dy": ey - oy, "distance": d})
	var occupied := _occupied(scene)
	var locations := []
	for b in scene["buildings"]:
		var bx := int(b["x"])
		var by := int(b["y"])
		var d := _planar(bx - ox, by - oy)
		if d > sight:
			continue
		if d < CONTACT_DISTANCE or _building_seen(space, eye, str(b["id"])):
			locations.append({"buildingId": b["id"], "role": b["role"], "state": b["state"], "heatBand": b["heatBand"],
				"occupied": occupied.has(str(b["id"])), "dx": bx - ox, "dy": by - oy, "distance": d})
	var local = null
	for district in scene["districts"]:
		if district["id"] == observer["districtId"]:
			local = district["tensionBand"]
	return {"effectiveRange": sight, "bodies": bodies, "locations": locations,
		"environment": {"localTensionBand": local, "weather": weather["kind"]}}


## Grid distance in double precision: Vector2 is single precision, and the Node checks the
## reported distance to 1e-6.
func _planar(dx: int, dy: int) -> float:
	return sqrt(float(dx * dx + dy * dy))


## Seen when any sample point (centre, both flanks across the line of sight, head) is inside a
## camera frustum with no building between it and the eye.
func _body_seen(space: PhysicsDirectSpaceState3D, eye: Vector3, ground: Vector3) -> bool:
	var flat := Vector3(ground.x - eye.x, 0.0, ground.z - eye.z).normalized()
	var side := flat.cross(Vector3.UP) * Geo.PERSON_RADIUS * 0.9
	var centre := ground + Vector3(0.0, BODY_CENTRE, 0.0)
	for p in [centre, centre + side, centre - side, ground + Vector3(0.0, HEAD, 0.0)]:
		if _in_ring(p) and _sight_line(space, eye, p).is_empty():
			return true
	return false


## Seen when, for any sample point (its centre and eight corners drawn 10% inward), the first
## building on the line of sight is this building itself.
func _building_seen(space: PhysicsDirectSpaceState3D, eye: Vector3, id: String) -> bool:
	var body: StaticBody3D = _bodies[id]
	var half: Vector3 = ((body.get_child(0) as CollisionShape3D).shape as BoxShape3D).size * 0.45
	var samples := [body.position]
	for sx in [-1.0, 1.0]:
		for sy in [-1.0, 1.0]:
			for sz in [-1.0, 1.0]:
				samples.append(body.position + Vector3(half.x * sx, half.y * sy, half.z * sz))
	for p in samples:
		if not _in_ring(p):
			continue
		var hit := _sight_line(space, eye, p)
		if not hit.is_empty() and hit["collider"] == body:
			return true
	return false


func _sight_line(space: PhysicsDirectSpaceState3D, from: Vector3, to: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, to, BUILDING_LAYER)
	q.hit_from_inside = false
	q.collide_with_areas = false
	return space.intersect_ray(q)


func _in_ring(p: Vector3) -> bool:
	for cam in _ring:
		if cam.is_position_in_frustum(p):
			return true
	return false


## Buildings with a role-holder inside: IsoView's lit station with its sign above the roof.
func _occupied(scene: Dictionary) -> Dictionary:
	var out := {}
	var observer: Dictionary = scene["observer"]
	if observer["inside"]:
		out[str(observer["atBuilding"])] = true
	for e in scene["entities"]:
		if e["inside"]:
			out[str(e["atBuilding"])] = true
	return out


func _isometric(request: Dictionary) -> Dictionary:
	var condition: Dictionary = request["condition"]
	var iso: Dictionary = condition["isometric"]
	var scene: Dictionary = request["scene"]
	var observer: Dictionary = scene["observer"]
	var centre := Vector3(int(observer["x"]), 0.0, int(observer["y"]))
	for district in scene["districts"]:
		if district["id"] == observer["districtId"]:
			centre = Vector3(int(district["plazaX"]), 0.0, int(district["plazaY"]))
	var yaw := deg_to_rad(float(iso["yawDegrees"]))
	var pitch := deg_to_rad(float(iso["pitchDegrees"]))
	_iso.size = float(iso["span"])
	var offset := Vector3(cos(pitch) * cos(yaw), sin(pitch), cos(pitch) * sin(yaw)) * ISO_DISTANCE
	_iso.look_at_from_position(centre + offset, centre, Vector3.UP)
	_env.fog_enabled = false
	var districts := []
	for district in scene["districts"]:
		if _iso.is_position_in_frustum(Vector3(int(district["plazaX"]), 0.0, int(district["plazaY"]))):
			districts.append({"districtId": district["id"], "tensionBand": district["tensionBand"]})
	var occupied := _occupied(scene)
	var locations := []
	for b in scene["buildings"]:
		var body: StaticBody3D = _bodies[str(b["id"])]
		if _iso.is_position_in_frustum(body.position):
			locations.append({"buildingId": b["id"], "role": b["role"], "state": b["state"], "heatBand": b["heatBand"],
				"occupied": occupied.has(str(b["id"]))})
	var counts := {}
	for e in scene["entities"]:
		if e["inside"] or not _iso.is_position_in_frustum(Vector3(int(e["x"]), BODY_CENTRE, int(e["y"]))):
			continue
		var key := "" if e["districtId"] == null else str(e["districtId"])
		counts[key] = int(counts.get(key, 0)) + 1
	var keys := counts.keys()
	keys.sort()
	var activity := []
	for key in keys:
		activity.append({"districtId": null if key == "" else key, "bodiesInOpen": counts[key]})
	return {"view": {"centerDistrictId": observer["districtId"], "span": iso["span"]}, "districts": districts,
		"locations": locations, "activity": activity,
		"environment": {"economicHealthBand": scene["environment"]["economicHealthBand"], "weather": condition["weather"]["kind"]}}
