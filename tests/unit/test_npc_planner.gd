extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const BurnMapGenerator = preload("res://scripts/map/burn_map_generator.gd")
const OrderProcessor = preload("res://scripts/sim/order_processor.gd")
const NPCPlanner = preload("res://scripts/ai/npc_vexillomancer_planner.gd")
const NPCStrategyProfile = preload("res://scripts/ai/npc_strategy_profile.gd")

func test_planner_selects_valid_survey_order_from_current_state() -> void:
	var state = MatchState.new_default("planner-seed")
	var map = BurnMapGenerator.new().generate("planner-seed")
	var planner = NPCPlanner.new(NPCStrategyProfile.default_for("rival_surveyor"))

	var orders: Array[Dictionary] = planner.plan_tick(state, map, "rival_surveyor", 1)
	var validation: Dictionary = OrderProcessor.new().validate_order(state, orders[0])

	assert_eq(orders[0].type, "assign_survey_work")
	assert_true(validation.ok)
	assert_lte(orders[0].payload.attention, state.factions["rival_surveyor"].attention_available)


func test_strategy_profiles_bias_order_choice() -> void:
	var state = MatchState.new_default("planner-seed")
	var map = BurnMapGenerator.new().generate("planner-seed")
	var player_building: String = state.spawn_building("player", "flag_workshop", Vector2i(5, 5))
	var raider = NPCPlanner.new(NPCStrategyProfile.raid_heavy())
	var expander = NPCPlanner.new(NPCStrategyProfile.expand_heavy())

	var raid_order: Dictionary = raider.plan_tick(state, map, "rival_warden", 1)[0]
	var expand_order: Dictionary = expander.plan_tick(state, map, "rival_warden", 1)[0]

	assert_eq(raid_order.type, "raid_building")
	assert_eq(raid_order.payload.target_building_id, player_building)
	assert_eq(expand_order.type, "assign_survey_work")


func test_planner_uses_visible_order_path_to_disrupt_building() -> void:
	var state = MatchState.new_default("planner-seed")
	var map = BurnMapGenerator.new().generate("planner-seed")
	var building_id: String = state.spawn_building("player", "flag_workshop", Vector2i(5, 5))
	var planner = NPCPlanner.new(NPCStrategyProfile.raid_heavy())
	var order: Dictionary = planner.plan_tick(state, map, "rival_warden", 1)[0]

	var result: Dictionary = OrderProcessor.new().apply_order(state, order)

	assert_true(result.ok)
	assert_lt(state.buildings[building_id].hp, state.buildings[building_id].max_hp)
