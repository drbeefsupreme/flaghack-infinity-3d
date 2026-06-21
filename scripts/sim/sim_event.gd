class_name SimEvent
extends RefCounted

var type: String
var tick: int
var data: Dictionary

func _init(event_type: String = "", event_tick: int = 0, event_data: Dictionary = {}) -> void:
	type = event_type
	tick = event_tick
	data = event_data.duplicate(true)


func to_dict() -> Dictionary:
	return {
		"type": type,
		"tick": tick,
		"data": data.duplicate(true),
	}
