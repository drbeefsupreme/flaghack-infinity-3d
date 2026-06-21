extends GutTest

const CommandModel = preload("res://scripts/ui/command_model.gd")

func test_command_model_creates_serialized_survey_order() -> void:
	var model = CommandModel.new()
	var order: Dictionary = model.survey_order("order_1", 4, "player", "vex_player", Vector2i(8, 9), 3)

	assert_eq(order.type, "assign_survey_work")
	assert_eq(order.tick, 4)
	assert_eq(order.faction_id, "player")
	assert_eq(order.payload.target_cell, Vector2i(8, 9))
	assert_eq(order.payload.attention, 3)
