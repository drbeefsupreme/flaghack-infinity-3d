class_name BuildingState
extends RefCounted

var id: String
var faction_id: String
var kind: String
var cell: Vector2i
var hp: int = 10
var max_hp: int = 10
var constructed: bool = true
var disabled: bool = false
var capability_key: String = ""
var capability_amount: int = 0

func _init(building_id: String = "", owner_id: String = "", building_kind: String = "", building_cell: Vector2i = Vector2i.ZERO) -> void:
	id = building_id
	faction_id = owner_id
	kind = building_kind
	cell = building_cell


func damage(amount: int) -> void:
	hp = maxi(0, hp - amount)
	disabled = hp == 0


func repair(amount: int) -> void:
	hp = mini(max_hp, hp + amount)
	disabled = hp == 0


func to_dict() -> Dictionary:
	return {
		"id": id,
		"faction_id": faction_id,
		"kind": kind,
		"cell": {"x": cell.x, "y": cell.y},
		"hp": hp,
		"max_hp": max_hp,
		"constructed": constructed,
		"disabled": disabled,
		"capability_key": capability_key,
		"capability_amount": capability_amount,
	}
