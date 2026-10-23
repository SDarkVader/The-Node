## Shared settlement geometry (2026-10-23). The isometric renderer (IsoView.gd) and agent
## perception (Perception.gd) both build buildings, people and the Wall from these values, so what
## an agent can be hidden behind is exactly what the client draws.
##
## One world cell is one 3D unit. The footprint/height rules, their honest variation (landmarks)
## and their meaningless texture jitter are documented in IsoView.gd, where they originated; they
## moved here unchanged.
extends RefCounted

const FLOOR_HEIGHT := 0.30
const BUILDING_FOOTPRINT := 0.56
## A person: IsoView's capsule, standing PERSON_LIFT above the ground plane.
const PERSON_HEIGHT := 0.42
const PERSON_RADIUS := 0.115
const PERSON_LIFT := 0.06
## The Wall at the hub: a slab turned to face the isometric camera (IsoView._build_wall).
const WALL_SIZE := Vector3(0.85, 1.9, 0.16)
const WALL_YAW_DEGREES := 90.0
const LANDMARK_HEIGHT_MUL := 1.85
const LANDMARK_FOOTPRINT_MUL := 1.28
const JITTER_HEIGHT := 0.34
const JITTER_FOOTPRINT := 0.16


## Stable pseudo-random in [0,1) from a building's own id — no rng, so the skyline is identical
## every run and across clients.
static func hash01(id: String, salt: int) -> float:
	var h := 2166136261
	for i in id.length():
		h = (h ^ id.unicode_at(i)) * 16777619
		h = h & 0xFFFFFFFF
	h = (h ^ (salt * 2654435761)) & 0xFFFFFFFF
	return float(h % 100000) / 100000.0


## Basis scaled to the footprint and height; origin at the building's centre (half its height).
static func building_transform(b: Dictionary) -> Transform3D:
	var id := str(b["id"])
	var is_landmark: bool = b.get("isLandmark", false)
	var foot := BUILDING_FOOTPRINT * (1.0 + (hash01(id, 1) - 0.5) * 2.0 * JITTER_FOOTPRINT)
	var floors := 3.0 * (1.0 + (hash01(id, 2) - 0.5) * 2.0 * JITTER_HEIGHT)
	if is_landmark:
		foot *= LANDMARK_FOOTPRINT_MUL
		floors *= LANDMARK_HEIGHT_MUL
	var height := FLOOR_HEIGHT * floors
	var basis := Basis().scaled(Vector3(foot, height, foot))
	return Transform3D(basis, Vector3(float(b["x"]), height * 0.5, float(b["y"])))


## The Wall slab standing on the hub plot.
static func wall_transform(hub_x: float, hub_y: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, deg_to_rad(WALL_YAW_DEGREES)), Vector3(hub_x, WALL_SIZE.y * 0.5, hub_y))
