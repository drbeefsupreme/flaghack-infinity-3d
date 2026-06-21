class_name FactionDefinition
extends Resource

@export var id: String = ""
@export var lore_name: String = ""
@export var color: Color = Color.WHITE
@export var strategy_profile_id: String = "balanced"

func to_runtime_definition() -> Dictionary:
	return {
		"id": id,
		"lore_name": lore_name,
		"color": color.to_html(false),
		"strategy_profile_id": strategy_profile_id,
	}
