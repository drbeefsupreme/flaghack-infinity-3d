class_name CampState
extends RefCounted

var id: String
var faction_id: String
var original_faction_id: String
var hearth_id: String
var cell: Vector2i
var active: bool = true
var disabled: bool = false
var captured_tick: int = -1
var building_ids: Array[String] = []
var hippie_ids: Array[String] = []

func _init(camp_id: String = "", owner_id: String = "", hearth: String = "", camp_cell: Vector2i = Vector2i.ZERO) -> void:
	id = camp_id
	faction_id = owner_id
	original_faction_id = owner_id
	hearth_id = hearth
	cell = camp_cell


func to_dict() -> Dictionary:
	return {
		"id": id,
		"faction_id": faction_id,
		"original_faction_id": original_faction_id,
		"hearth_id": hearth_id,
		"cell": {"x": cell.x, "y": cell.y},
		"active": active,
		"disabled": disabled,
		"captured_tick": captured_tick,
		"building_ids": building_ids.duplicate(),
		"hippie_ids": hippie_ids.duplicate(),
	}
