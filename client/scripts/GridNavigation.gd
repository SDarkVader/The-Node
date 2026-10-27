## The world's cardinal plot graph. The broker still validates every returned step.
## Building cells keep the existing game's legal entry; no optical wall grants or
## removes movement rights, and bodies do not block one another's cells.
extends RefCounted
const PROFILE := "node-navigation-godot-v1"

static func derive(request: Dictionary) -> Dictionary:
	var graph := AStar2D.new()
	var ids := {}
	var points: Array = request["district"]["plots"]
	for i in points.size():
		var p: Dictionary = points[i]
		var coordinate := Vector2i(int(p["x"]), int(p["y"]))
		ids[coordinate] = i
		graph.add_point(i, Vector2(coordinate))
	for coordinate in ids:
		for offset in [Vector2i.LEFT, Vector2i.UP, Vector2i.DOWN, Vector2i.RIGHT]:
			if ids.has(coordinate + offset):
				graph.connect_points(ids[coordinate], ids[coordinate + offset])
	var origin: Dictionary = request["from"]
	var destination: Dictionary = request["to"]
	var start := Vector2i(int(origin["x"]), int(origin["y"]))
	var finish := Vector2i(int(destination["x"]), int(destination["y"]))
	var path := []
	if ids.has(start) and ids.has(finish):
		var route := graph.get_point_path(ids[start], ids[finish])
		for i in range(1, route.size()):
			path.append({"x": int(route[i].x), "y": int(route[i].y)})
	var engine := Engine.get_version_info()
	return {"type": "navigation", "schema": "node-navigation-response-v1", "profile": PROFILE,
		"requestId": request["requestId"], "worldHash": request["worldHash"], "actorRef": request["actorRef"],
		"engine": {"name": "godot", "version": "%s %s" % [engine["string"], engine["hash"]]}, "path": path}
