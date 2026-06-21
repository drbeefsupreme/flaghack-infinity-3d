class_name BurnMapGenerator
extends RefCounted

const MapCellScript = preload("res://scripts/map/map_cell.gd")
const StartingCampPlacerScript = preload("res://scripts/map/starting_camp_placer.gd")
const SurveyPatternScript = preload("res://scripts/sim/survey_pattern.gd")

var width: int = GameConstants.MAP_WIDTH
var height: int = GameConstants.MAP_HEIGHT
var seed: String = ""
var cells: Dictionary = {}
var starting_camps: Dictionary = {}
var central_landmark_cell: Vector2i

func generate(map_seed: String) -> BurnMapGenerator:
	seed = map_seed
	cells.clear()
	starting_camps = StartingCampPlacerScript.new().place(width, height)
	central_landmark_cell = Vector2i(width / 2, height / 2)
	_build_cells()
	_carve_safe_regions()
	return self


func is_in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < width and cell.y < height


func cell_at(cell: Vector2i) -> MapCell:
	return cells[_key(cell)]


func neighbors(cell: Vector2i) -> Array[Vector2i]:
	var result: Array[Vector2i] = []
	var deltas: Array[Vector2i] = [Vector2i.LEFT, Vector2i.RIGHT, Vector2i.UP, Vector2i.DOWN]
	for delta: Vector2i in deltas:
		var next_cell: Vector2i = cell + delta
		if is_in_bounds(next_cell) and not cell_at(next_cell).blocked:
			result.append(next_cell)
	return result


func is_reachable(start_cell: Vector2i, target_cell: Vector2i) -> bool:
	if not is_in_bounds(start_cell) or not is_in_bounds(target_cell):
		return false
	if cell_at(start_cell).blocked or cell_at(target_cell).blocked:
		return false
	var frontier: Array[Vector2i] = [start_cell]
	var visited := {_key(start_cell): true}
	while not frontier.is_empty():
		var current: Vector2i = frontier.pop_front()
		if current == target_cell:
			return true
		for next_cell in neighbors(current):
			var key := _key(next_cell)
			if not visited.has(key):
				visited[key] = true
				frontier.append(next_cell)
	return false


func count_buildable_near(center: Vector2i, radius: int) -> int:
	var count := 0
	for x in range(center.x - radius, center.x + radius + 1):
		for y in range(center.y - radius, center.y + radius + 1):
			var cell := Vector2i(x, y)
			if is_in_bounds(cell) and cell_at(cell).buildable:
				count += 1
	return count


func pattern_for_faction(faction_id: String) -> SurveyPattern:
	var origin: Vector2i = starting_camps[faction_id]
	var pattern: SurveyPattern = SurveyPatternScript.generated(faction_id, origin, seed)
	for vertex: PatternVertex in pattern.vertices:
		vertex.cell = nearest_buildable_reachable(origin, vertex.cell)
	return pattern


func nearest_buildable_reachable(start_cell: Vector2i, preferred_cell: Vector2i) -> Vector2i:
	if is_in_bounds(preferred_cell) and cell_at(preferred_cell).buildable and is_reachable(start_cell, preferred_cell):
		return preferred_cell
	for radius in range(1, 8):
		for x in range(preferred_cell.x - radius, preferred_cell.x + radius + 1):
			for y in range(preferred_cell.y - radius, preferred_cell.y + radius + 1):
				var candidate := Vector2i(x, y)
				if is_in_bounds(candidate) and cell_at(candidate).buildable and is_reachable(start_cell, candidate):
					return candidate
	return start_cell


func apply_to_match_state(state: MatchState) -> void:
	for faction_id in starting_camps.keys():
		var camp_id := "camp_%s" % faction_id
		if state.camps.has(camp_id):
			state.camps[camp_id].cell = starting_camps[faction_id]
			for hippie_id in state.camps[camp_id].hippie_ids:
				if state.hippies.has(hippie_id):
					state.hippies[hippie_id].cell = starting_camps[faction_id] + Vector2i(1, 0)


func summary_hash() -> String:
	var summary := {
		"seed": seed,
		"central": {"x": central_landmark_cell.x, "y": central_landmark_cell.y},
		"starts": {},
		"blocked": [],
		"fields": [],
	}
	for faction_id in starting_camps.keys():
		var start: Vector2i = starting_camps[faction_id]
		summary.starts[faction_id] = {"x": start.x, "y": start.y}
	var keys := cells.keys()
	keys.sort()
	for key in keys:
		var map_cell: MapCell = cells[key]
		if map_cell.blocked:
			summary.blocked.append(key)
		if map_cell.field_condition != "clear":
			summary.fields.append("%s:%s" % [key, map_cell.field_condition])
	return JSON.stringify(summary).sha256_text()


func _build_cells() -> void:
	for x in range(width):
		for y in range(height):
			var cell := Vector2i(x, y)
			var map_cell: MapCell = MapCellScript.new(cell)
			map_cell.terrain = "playa"
			var hash_value: int = _cell_hash(cell)
			if hash_value % 37 == 0:
				map_cell.blocked = true
				map_cell.buildable = false
				map_cell.terrain = "art_car_wreck"
			elif hash_value % 19 == 0:
				map_cell.apply_field_condition("mud")
			elif hash_value % 23 == 0:
				map_cell.apply_field_condition("dust")
			elif hash_value % 29 == 0:
				map_cell.apply_field_condition("loud")
			cells[_key(cell)] = map_cell

	var center := MapCellScript.new(central_landmark_cell)
	center.terrain = "central_burn"
	center.apply_field_condition("loud")
	cells[_key(central_landmark_cell)] = center


func _carve_safe_regions() -> void:
	for start_cell in starting_camps.values():
		_clear_square(start_cell, 3)
		_carve_corridor(start_cell, central_landmark_cell)
	_clear_square(central_landmark_cell, 2)


func _clear_square(center: Vector2i, radius: int) -> void:
	for x in range(center.x - radius, center.x + radius + 1):
		for y in range(center.y - radius, center.y + radius + 1):
			var cell := Vector2i(x, y)
			if is_in_bounds(cell):
				var map_cell := cell_at(cell)
				map_cell.blocked = false
				map_cell.buildable = true


func _carve_corridor(start_cell: Vector2i, end_cell: Vector2i) -> void:
	var cursor := start_cell
	while cursor.x != end_cell.x:
		cursor.x += signi(end_cell.x - cursor.x)
		_clear_square(cursor, 1)
	while cursor.y != end_cell.y:
		cursor.y += signi(end_cell.y - cursor.y)
		_clear_square(cursor, 1)


func _cell_hash(cell: Vector2i) -> int:
	return absi(("%s:%d:%d" % [seed, cell.x, cell.y]).hash())


func _key(cell: Vector2i) -> String:
	return "%d,%d" % [cell.x, cell.y]
