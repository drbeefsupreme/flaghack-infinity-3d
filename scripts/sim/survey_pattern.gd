class_name SurveyPattern
extends RefCounted

const PatternVertexScript = preload("res://scripts/sim/pattern_vertex.gd")

var id: String
var faction_id: String
var origin_cell: Vector2i
var vertices: Array = []

func _init(pattern_id: String = "", owner_id: String = "", origin: Vector2i = Vector2i.ZERO) -> void:
	id = pattern_id
	faction_id = owner_id
	origin_cell = origin


static func from_cells(owner_id: String, cells: Array) -> SurveyPattern:
	var pattern := SurveyPattern.new("pattern_%s" % owner_id, owner_id, cells[0] if cells.size() > 0 else Vector2i.ZERO)
	for index in range(cells.size()):
		pattern.vertices.append(PatternVertexScript.new("%s_vertex_%d" % [owner_id, index], owner_id, cells[index]))
	return pattern


static func generated(owner_id: String, origin: Vector2i, map_seed: String) -> SurveyPattern:
	var hash_value: int = ("%s:%s" % [owner_id, map_seed]).hash()
	var radius: int = 3 + absi(hash_value % 3)
	var skew_x: int = absi(hash_value / 7) % 3 - 1
	var skew_y: int = absi(hash_value / 13) % 3 - 1
	var cells: Array = [
		origin + Vector2i(-radius + skew_x, -radius),
		origin + Vector2i(radius, -radius + skew_y),
		origin + Vector2i(radius - skew_x, radius),
		origin + Vector2i(-radius, radius - skew_y),
	]
	return SurveyPattern.from_cells(owner_id, cells)


func target_cells() -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for vertex: PatternVertex in vertices:
		cells.append(vertex.cell)
	return cells


func fulfilled_cells() -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for vertex: PatternVertex in vertices:
		if vertex.is_fulfilled():
			cells.append(vertex.cell)
	return cells


func is_closed() -> bool:
	return fulfilled_cells().size() >= 4


func bounds() -> Dictionary:
	var cells := fulfilled_cells()
	if cells.size() == 0:
		return {}
	var min_x := cells[0].x
	var max_x := cells[0].x
	var min_y := cells[0].y
	var max_y := cells[0].y
	for cell in cells:
		min_x = mini(min_x, cell.x)
		max_x = maxi(max_x, cell.x)
		min_y = mini(min_y, cell.y)
		max_y = maxi(max_y, cell.y)
	return {
		"min": Vector2i(min_x, min_y),
		"max": Vector2i(max_x, max_y),
	}


func to_dict() -> Dictionary:
	var vertex_dicts: Array[Dictionary] = []
	for vertex: PatternVertex in vertices:
		vertex_dicts.append(vertex.to_dict())
	return {
		"id": id,
		"faction_id": faction_id,
		"origin_cell": {"x": origin_cell.x, "y": origin_cell.y},
		"vertices": vertex_dicts,
	}
