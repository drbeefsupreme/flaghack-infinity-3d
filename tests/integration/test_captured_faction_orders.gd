extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const OrderProcessor = preload("res://scripts/sim/order_processor.gd")

func test_captured_faction_cannot_issue_normal_camp_orders() -> void:
	var state = MatchState.new_default("capture-seed")
	state.capture_camp("camp_rival_surveyor", "player", 1)

	var result: Dictionary = OrderProcessor.new().apply_order(state, {
		"id": "dead_order",
		"tick": 2,
		"actor_id": "rival_surveyor_vex",
		"faction_id": "rival_surveyor",
		"type": "assign_survey_work",
		"payload": {"target_cell": Vector2i(30, 4), "attention": 1}
	})

	assert_false(result.ok)
	assert_eq(result.error, "inactive_faction")
