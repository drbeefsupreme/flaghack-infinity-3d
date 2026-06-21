class_name PatternVertex
extends RefCounted

var id: String
var faction_id: String
var cell: Vector2i
var fulfilled_by_flag_id: String = ""

func _init(vertex_id: String = "", owner_id: String = "", target_cell: Vector2i = Vector2i.ZERO) -> void:
	id = vertex_id
	faction_id = owner_id
	cell = target_cell


func is_fulfilled() -> bool:
	return fulfilled_by_flag_id != ""


func to_dict() -> Dictionary:
	return {
		"id": id,
		"faction_id": faction_id,
		"cell": {"x": cell.x, "y": cell.y},
		"fulfilled_by_flag_id": fulfilled_by_flag_id,
	}
