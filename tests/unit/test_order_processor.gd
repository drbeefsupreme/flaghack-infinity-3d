extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const OrderProcessor = preload("res://scripts/sim/order_processor.gd")

func test_place_carried_flag_is_validated_and_emits_event() -> void:
	var state = MatchState.new_default("seed-alpha")
	var processor = OrderProcessor.new()
	var flag_id: String = state.claim_inventory_flag("player", "vex_player")

	var result: Dictionary = processor.apply_order(state, {
		"id": "order_place",
		"tick": 1,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "place_flag",
		"payload": {"flag_id": flag_id, "cell": Vector2i(6, 6)}
	})

	assert_true(result.ok)
	assert_eq(state.flags[flag_id].cell, Vector2i(6, 6))
	assert_eq(state.flags[flag_id].carried_by, "")
	assert_eq(state.factions["player"].flag_inventory, 5)
	assert_eq(state.events.back().type, "flag_placed")


func test_invalid_orders_leave_state_unchanged() -> void:
	var state = MatchState.new_default("seed-alpha")
	var processor = OrderProcessor.new()
	var before_hash: String = state.state_hash()

	var result: Dictionary = processor.apply_order(state, {
		"id": "bad_order",
		"tick": 1,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "place_flag",
		"payload": {"flag_id": "missing", "cell": Vector2i(6, 6)}
	})

	assert_false(result.ok)
	assert_eq(result.error, "unknown_flag")
	assert_eq(state.state_hash(), before_hash)


func test_attention_and_flag_spending_are_conserved() -> void:
	var state = MatchState.new_default("seed-alpha")
	var processor = OrderProcessor.new()

	var result: Dictionary = processor.apply_order(state, {
		"id": "survey_order",
		"tick": 1,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "assign_survey_work",
		"payload": {"target_cell": Vector2i(8, 8), "attention": 3}
	})

	assert_true(result.ok)
	assert_eq(state.factions["player"].attention_available, 7)
	assert_eq(state.jobs.size(), 1)

	var overspend: Dictionary = processor.apply_order(state, {
		"id": "too_much",
		"tick": 2,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "assign_survey_work",
		"payload": {"target_cell": Vector2i(9, 9), "attention": 99}
	})
	assert_false(overspend.ok)
	assert_eq(state.jobs.size(), 1)
	assert_eq(state.factions["player"].attention_available, 7)


func test_same_tick_orders_are_arbitrated_deterministically() -> void:
	var state_a = MatchState.new_default("seed-alpha")
	var state_b = MatchState.new_default("seed-alpha")
	var processor = OrderProcessor.new()
	var flag_a: String = state_a.claim_inventory_flag("player", "vex_player")
	var flag_b: String = state_b.claim_inventory_flag("player", "vex_player")

	var orders_a: Array[Dictionary] = [
		{"id": "b", "tick": 1, "actor_id": "vex_player", "faction_id": "player", "type": "place_flag", "payload": {"flag_id": flag_a, "cell": Vector2i(3, 3)}},
		{"id": "a", "tick": 1, "actor_id": "vex_player", "faction_id": "player", "type": "drop_flag", "payload": {"flag_id": flag_a, "cell": Vector2i(4, 4)}}
	]
	var orders_b: Array[Dictionary] = [
		orders_a[1],
		orders_a[0],
	]

	processor.apply_orders_for_tick(state_a, orders_a, 1)
	processor.apply_orders_for_tick(state_b, orders_b, 1)
	assert_eq(state_a.state_hash(), state_b.state_hash())


func test_rival_flag_pickup_and_reposition_uses_validated_orders() -> void:
	var state = MatchState.new_default("seed-alpha")
	var processor = OrderProcessor.new()
	var rival_flag_id: String = state.claim_inventory_flag("rival_surveyor", "rival_vex")
	state.place_carried_flag(rival_flag_id, Vector2i(10, 10), 0)

	var pickup: Dictionary = processor.apply_order(state, {
		"id": "steal",
		"tick": 1,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "pickup_flag",
		"payload": {"flag_id": rival_flag_id}
	})
	assert_true(pickup.ok)
	assert_eq(state.flags[rival_flag_id].carried_by, "vex_player")

	var place: Dictionary = processor.apply_order(state, {
		"id": "move",
		"tick": 2,
		"actor_id": "vex_player",
		"faction_id": "player",
		"type": "place_flag",
		"payload": {"flag_id": rival_flag_id, "cell": Vector2i(11, 10)}
	})
	assert_true(place.ok)
	assert_eq(state.flags[rival_flag_id].cell, Vector2i(11, 10))
	assert_eq(state.flags[rival_flag_id].movement_history.size(), 4)
