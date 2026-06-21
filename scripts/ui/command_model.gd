class_name CommandModel
extends RefCounted

func survey_order(order_id: String, tick: int, faction_id: String, actor_id: String, target_cell: Vector2i, attention: int) -> Dictionary:
	return {
		"id": order_id,
		"tick": tick,
		"actor_id": actor_id,
		"faction_id": faction_id,
		"type": "assign_survey_work",
		"payload": {
			"target_cell": target_cell,
			"attention": attention,
		},
	}


func direct_place_order(order_id: String, tick: int, faction_id: String, actor_id: String, flag_id: String, target_cell: Vector2i) -> Dictionary:
	return {
		"id": order_id,
		"tick": tick,
		"actor_id": actor_id,
		"faction_id": faction_id,
		"type": "place_flag",
		"payload": {
			"flag_id": flag_id,
			"cell": target_cell,
		},
	}
