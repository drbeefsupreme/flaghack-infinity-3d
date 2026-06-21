class_name BuildingDefinition
extends Resource

@export var id: String = ""
@export var lore_name: String = ""
@export var kind: String = ""
@export var cost_flags: int = 0
@export var cost_attention: int = 0
@export var max_hp: int = 10
@export var effect_key: String = ""
@export var effect_amount: int = 0

func to_runtime_definition() -> Dictionary:
	return {
		"id": id,
		"lore_name": lore_name,
		"kind": kind,
		"cost_flags": cost_flags,
		"cost_attention": cost_attention,
		"max_hp": max_hp,
		"effect_key": effect_key,
		"effect_amount": effect_amount,
	}
