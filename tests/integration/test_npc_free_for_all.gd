extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const BurnMapGenerator = preload("res://scripts/map/burn_map_generator.gd")
const OrderProcessor = preload("res://scripts/sim/order_processor.gd")
const HippieBrain = preload("res://scripts/sim/hippie_brain.gd")
const NPCPlanner = preload("res://scripts/ai/npc_vexillomancer_planner.gd")
const NPCStrategyProfile = preload("res://scripts/ai/npc_strategy_profile.gd")

func test_npcs_expand_without_player_input() -> void:
	var state = MatchState.new_default("ffa-seed")
	var map = BurnMapGenerator.new().generate("ffa-seed")
	var processor = OrderProcessor.new()
	var brain = HippieBrain.new()
	var rivals := ["rival_surveyor", "rival_brewer", "rival_warden"]

	for tick in range(1, 4):
		for faction_id in rivals:
			var planner = NPCPlanner.new(NPCStrategyProfile.default_for(faction_id))
			for order in planner.plan_tick(state, map, faction_id, tick):
				processor.apply_order(state, order)
			brain.tick_faction(state, faction_id, tick)

	var rival_flags := 0
	for flag in state.flags.values():
		if rivals.has(flag.controlling_faction_id) and flag.cell != flag.NOWHERE:
			rival_flags += 1

	assert_gte(rival_flags, 3)
	assert_gt(state.jobs.size(), 0)
