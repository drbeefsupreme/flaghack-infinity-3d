class_name FlagState
extends RefCounted

const NOWHERE := Vector2i(-9999, -9999)

var id: String
var original_faction_id: String
var controlling_faction_id: String
var cell: Vector2i = NOWHERE
var carried_by: String = ""
var movement_history: Array[Dictionary] = []

func _init(flag_id: String = "", owner_id: String = "") -> void:
	id = flag_id
	original_faction_id = owner_id
	controlling_faction_id = owner_id


func mark_carried(actor_id: String, tick: int) -> void:
	carried_by = actor_id
	cell = NOWHERE
	_record("carried", tick, {"actor_id": actor_id})


func mark_placed(target_cell: Vector2i, tick: int) -> void:
	cell = target_cell
	carried_by = ""
	_record("placed", tick, {"cell": target_cell})


func mark_dropped(target_cell: Vector2i, tick: int) -> void:
	cell = target_cell
	carried_by = ""
	_record("dropped", tick, {"cell": target_cell})


func mark_controlled_by(faction_id: String, tick: int) -> void:
	controlling_faction_id = faction_id
	_record("controlled", tick, {"faction_id": faction_id})


func to_dict() -> Dictionary:
	var history: Array[Dictionary] = []
	for entry in movement_history:
		history.append(_normalize_dict(entry))
	return {
		"id": id,
		"original_faction_id": original_faction_id,
		"controlling_faction_id": controlling_faction_id,
		"cell": {"x": cell.x, "y": cell.y},
		"carried_by": carried_by,
		"movement_history": history,
	}


func _record(action: String, tick: int, fields: Dictionary) -> void:
	var entry := {
		"action": action,
		"tick": tick,
	}
	for key in fields.keys():
		entry[key] = fields[key]
	movement_history.append(entry)


func _normalize_dict(source: Dictionary) -> Dictionary:
	var normalized := {}
	for key in source.keys():
		var value: Variant = source[key]
		if value is Vector2i:
			normalized[key] = {"x": value.x, "y": value.y}
		else:
			normalized[key] = value
	return normalized
