class_name FactionState
extends RefCounted

var id: String
var display_name: String
var is_player: bool
var color: Color
var active: bool = true
var flag_inventory: int = 6
var attention_capacity: int = 10
var attention_available: int = 10
var ritual: int = 0
var camp_ids: Array[String] = []
var hippie_ids: Array[String] = []
var building_ids: Array[String] = []
var carried_flag_ids: Array[String] = []

func _init(
	faction_id: String = "",
	faction_name: String = "",
	player_controlled: bool = false,
	faction_color: Color = Color.WHITE
) -> void:
	id = faction_id
	display_name = faction_name
	is_player = player_controlled
	color = faction_color


func to_dict() -> Dictionary:
	return {
		"id": id,
		"display_name": display_name,
		"is_player": is_player,
		"color": color.to_html(false),
		"active": active,
		"flag_inventory": flag_inventory,
		"attention_capacity": attention_capacity,
		"attention_available": attention_available,
		"ritual": ritual,
		"camp_ids": camp_ids.duplicate(),
		"hippie_ids": hippie_ids.duplicate(),
		"building_ids": building_ids.duplicate(),
		"carried_flag_ids": carried_flag_ids.duplicate(),
	}
