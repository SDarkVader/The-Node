extends SceneTree

func _init() -> void:
	assert(load("res://scripts/IsoView.gd") != null)
	assert(load("res://scripts/IsoGlowLayer.gd") != null)
	var layout = load("res://scripts/WorldPeople.gd")
	var building = {"id": "bakery", "x": 3, "y": 4, "role": "baker"}
	var people = [
		{"handle": "a", "x": 3, "y": 4, "role": "miller"},
		{"handle": "b", "x": 3, "y": 4, "role": "baker"},
		{"handle": "c", "x": 3, "y": 4, "role": null},
		{"handle": "d", "x": 5, "y": 4, "role": "courier"},
	]
	var result: Array = layout.layout(people, [building])
	assert(result.size() == people.size())
	var seen := {}
	var offsets := {}
	for entry in result:
		var handle: String = entry.person.handle
		assert(not seen.has(handle))
		seen[handle] = true
		if handle != "d":
			assert(entry.building.id == "bakery")
			assert(not offsets.has(entry.offset))
			offsets[entry.offset] = true
		else:
			assert(entry.building == null)
	# Exercise the actual 3D renderer without connecting to a server. Three people at a
	# building, including a visitor and roleless person, must all receive visible markers.
	var view = load("res://scenes/IsoView.tscn").instantiate()
	view.hud = view.get_node("HUD/Readout")
	view._env = Environment.new()
	view.plots = [{"x": 3, "y": 4, "kind": "street"}, {"x": 5, "y": 4, "kind": "street"}]
	view.buildings = [building]
	view.have_geometry = true
	view._build_static_geometry()
	view._handle_tick({"day": 0, "people": people, "stations": [{"buildingId": "bakery", "state": "FILLED", "heat": 0.2}]})
	assert(view._people_mm.multimesh.instance_count == 1)
	assert(view._icon_pool.size() == people.size())
	for icon in view._icon_pool:
		assert(icon.visible)
	assert(view._route_mm.multimesh.instance_count == 0)
	view.free()
	print("world_people_test: all people represented, including visitors and shared cells")
	quit(0)
