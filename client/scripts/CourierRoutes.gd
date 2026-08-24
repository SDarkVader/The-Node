extends RefCounted

## Real courier routing, shared by BOTH scenes (2026-08-24, user: "courier can't obviously go
## through the plaza... pull up the routing logic... map out courier paths"). NOT a client-side
## invention: walks the REAL plot data the server already generates and sends in `hello`
## (`src/engine/space.ts`'s `plots`, each carrying a real `kind`) rather than drawing a guessed
## shape that could cross a building footprint or cut across the plaza at an arbitrary angle.
##
## WHY NOT JUST THE SERVER'S OWN L-SHAPED CORRIDOR. `space.ts`'s `corridorPlots` already draws
## one L-shaped spine from each DISTRICT'S PLAZA to the hub — real geometry, but two real gaps
## stand between that and a per-courier route: (1) it is anchored on the plaza, not on any
## individual courier's own station, and `courierPay.ts` pays for STATION-level distance, not
## plaza-level (2026-08-19 addendum — every courier used to share one plaza, which paid nobody
## anything real); (2) `generateShardLayout`'s "first claim wins" pass order means the corridor
## generator SKIPS any cell a building already claimed rather than routing around it, so the
## straight spine can have real single-cell gaps exactly where a building happens to sit on the
## line.
##
## WHY WEIGHTED, NOT A HARD "NEVER TOUCH A BUILDING" WALL — found by actually running this
## against a real shard, not assumed (2026-08-24): the shipped default is packed dense enough
## (measured: 62 of 87 plots in one real district are `building`, only 24 `street` + 1 `plaza`)
## that several courier stations sit COMPLETELY surrounded by other buildings on all 4 cardinal
## sides. A strict street/plaza-only search left most couriers with NO route at all — not a
## visual nicety, a real dead end, because this settlement was never generated with "every
## building has an orthogonal street exit" as a constraint. Real Manhattan-grid downtowns are
## not actually hard-walled like this either — a courier can cut between buildings, it is just
## not their usual path. So this is Dijkstra with two step costs: a real street/plaza cell costs
## `STREET_STEP_COST`, anywhere else costs `OTHER_STEP_COST` — heavily discouraged, never
## forbidden. A route still overwhelmingly prefers real streets (the cost gap is large), and
## only cuts through built-up ground when a station is genuinely landlocked by them, which is an
## honest picture of a dense block rather than a silent failure.
##
## NOT a `class_name` (same lesson `WorldView.gd`'s own header already records): this project is
## driven headless, and registering a global class is something the Godot EDITOR writes into
## `project.godot` — a `class_name` reference fails to resolve without ever having opened the
## editor. Callers `preload()` this script and call its `static func`s directly off that
## reference instead.

const WALKABLE_KINDS := {"street": true, "plaza": true}
const STREET_STEP_COST := 1.0
## [FIRST PASS, tunable] Real but discouraged — about 6x a street step, so a route only takes
## this over a real street when the real-street detour would be materially longer.
const OTHER_STEP_COST := 6.0

## Builds "x,y" -> true for every plot whose kind is real street or plaza — the PREFERRED set a
## route tries to stay on. A courier's own station (a `building` plot) is never in this set, and
## is not meant to be: it is only ever a route's START, handled as a special case in
## `find_route`.
static func build_walkable_grid(plots: Array) -> Dictionary:
	var walkable := {}
	for p in plots:
		var kind := str(p.get("kind", ""))
		if WALKABLE_KINDS.has(kind):
			walkable["%d,%d" % [int(p["x"]), int(p["y"])]] = true
	return walkable


## True if `p` is within the settlement's own real footprint (`bounds`, from `hello`) plus a
## small margin — NOT a walkability check, a search-space bound. Without this, off-street cells
## are only discouraged, not forbidden, and Dijkstra would otherwise be free to wander off into
## unbounded empty space looking for a cheaper detour that will never come.
static func _in_bounds(p: Vector2i, bounds: Dictionary) -> bool:
	if not bounds.has("minX"):
		return true
	var margin := 1
	return p.x >= int(bounds["minX"]) - margin and p.x <= int(bounds["maxX"]) + margin \
		and p.y >= int(bounds["minY"]) - margin and p.y <= int(bounds["maxY"]) + margin


## Cheapest real path from `from` to `to`, weighted (see this file's header for why weighted
## rather than a hard block). `bounds` is `WorldHelloMessage.bounds`, passed through so the
## search space stays the settlement's own real extent. Returns an EMPTY array only if `to` is
## genuinely unreachable even allowing off-street steps — should not happen in practice (the
## real bounded area is always internally connected) but handled rather than assumed.
static func find_route(walkable: Dictionary, from: Vector2i, to: Vector2i, bounds: Dictionary) -> Array:
	if from == to:
		return [from]
	var dirs := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
	var dist := {from: 0.0}
	var came_from := {from: from}
	var visited := {}
	# Plain array + linear min-scan instead of a real priority queue — GDScript has none built
	# in, and the search space here (one settlement's worth of plots, a few hundred cells at
	# most) is small enough that this is instant regardless.
	var unvisited: Array[Vector2i] = [from]
	while unvisited.size() > 0:
		var best_i := 0
		for i in unvisited.size():
			if dist[unvisited[i]] < dist[unvisited[best_i]]:
				best_i = i
		var cur: Vector2i = unvisited[best_i]
		unvisited.remove_at(best_i)
		if visited.has(cur):
			continue
		visited[cur] = true
		if cur == to:
			break
		for d in dirs:
			var nxt: Vector2i = cur + d
			if visited.has(nxt) or not _in_bounds(nxt, bounds):
				continue
			var on_street: bool = nxt == to or walkable.has("%d,%d" % [nxt.x, nxt.y])
			var step_cost: float = STREET_STEP_COST if on_street else OTHER_STEP_COST
			var nd: float = dist[cur] + step_cost
			if not dist.has(nxt) or nd < dist[nxt]:
				dist[nxt] = nd
				came_from[nxt] = cur
				unvisited.append(nxt)
	if not dist.has(to):
		return []
	var path: Array = []
	var step: Vector2i = to
	while step != from:
		path.push_front(step)
		step = came_from[step]
	path.push_front(from)
	return path
