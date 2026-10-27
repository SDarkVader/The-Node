extends RefCounted

## Layout is presentation only: each projected person remains represented once, including
## visitors and multiple people sharing a building. Positions do not imply employment or work.
static func layout(people: Array, buildings: Array) -> Array:
	var building_at := {}
	for building in buildings:
		building_at["%d,%d" % [int(round(float(building["x"]))), int(round(float(building["y"])))]] = building
	var groups := {}
	for person in people:
		var key := "%d,%d" % [int(round(float(person["x"]))), int(round(float(person["y"])))]
		if not groups.has(key):
			groups[key] = []
		groups[key].append(person)
	var result: Array = []
	for key in groups:
		var group: Array = groups[key]
		for i in group.size():
			var offset := Vector2.ZERO
			if group.size() > 1:
				var angle := TAU * float(i) / float(group.size())
				offset = Vector2(cos(angle), sin(angle)) * 0.22
			result.append({"person": group[i], "building": building_at.get(key), "offset": offset})
	return result
