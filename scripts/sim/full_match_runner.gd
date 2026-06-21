class_name FullMatchRunner
extends RefCounted

const MatchStateScript = preload("res://scripts/sim/match_state.gd")
const BurnMapGeneratorScript = preload("res://scripts/map/burn_map_generator.gd")
const OrderProcessorScript = preload("res://scripts/sim/order_processor.gd")
const HippieBrainScript = preload("res://scripts/sim/hippie_brain.gd")
const NPCPlannerScript = preload("res://scripts/ai/npc_vexillomancer_planner.gd")
const NPCStrategyProfileScript = preload("res://scripts/ai/npc_strategy_profile.gd")
const ContentLoaderScript = preload("res://scripts/sim/content_loader.gd")
const ChakraRitualScript = preload("res://scripts/sim/chakra_ritual.gd")
const CrystalInstabilityScript = preload("res://scripts/sim/crystal_instability.gd")
const SurveyGeometryServiceScript = preload("res://scripts/sim/survey_geometry_service.gd")
const SurveyPatternScript = preload("res://scripts/sim/survey_pattern.gd")
const HearthCaptureScript = preload("res://scripts/sim/hearth_capture.gd")

func run(match_seed: String) -> Dictionary:
	var state: MatchState = MatchStateScript.new_default(match_seed)
	var burn_map: BurnMapGenerator = BurnMapGeneratorScript.new().generate(match_seed)
	burn_map.apply_to_match_state(state)
	var processor: OrderProcessor = OrderProcessorScript.new()
	var brain: HippieBrain = HippieBrainScript.new()
	var debug_state: Dictionary = {"setup": state.state_hash()}
	var milestones: Dictionary = {"setup": true}
	var captured_camps: Array[String] = []

	_run_opening_expansion(state, burn_map, processor, brain, milestones, debug_state)
	_run_conflict_package(state, milestones, debug_state)
	_run_containment_and_capture(state, captured_camps, milestones, debug_state)
	_run_endgame(state, captured_camps, milestones, debug_state)

	return {
		"winner": state.winning_faction_id(),
		"match_end_visible": state.winning_faction_id() != "",
		"captured_camps": captured_camps,
		"milestones": milestones,
		"debug_state": debug_state,
		"final_state_hash": state.state_hash(),
	}


func _run_opening_expansion(
	state: MatchState,
	burn_map: BurnMapGenerator,
	processor: OrderProcessor,
	brain: HippieBrain,
	milestones: Dictionary,
	debug_state: Dictionary
) -> void:
	for tick in range(1, 4):
		state.tick = tick
		for faction_id in state.factions.keys():
			var planner: NPCVexillomancerPlanner = NPCPlannerScript.new(NPCStrategyProfileScript.default_for(faction_id))
			for order in planner.plan_tick(state, burn_map, faction_id, tick):
				processor.apply_order(state, order)
			brain.tick_faction(state, faction_id, tick)
	milestones["first_expansion"] = true
	debug_state["first_expansion"] = state.state_hash()


func _run_conflict_package(state: MatchState, milestones: Dictionary, debug_state: Dictionary) -> void:
	var content := ContentLoaderScript.new()
	var catalog: BuildingCatalog = content.load_building_catalog()
	var building: Dictionary = catalog.place_building(state, "rival_surveyor", "flag_workshop", Vector2i(30, 5))
	catalog.damage_building(state, building.building_id, 4)
	milestones["building_disrupted"] = true

	var saffron = content.load_drugs()["saffron"]
	saffron.use_on_faction(state, "player", 4)
	milestones["drug_used"] = true

	state.factions["player"].ritual = 3
	ChakraRitualScript.new().complete(state, "player", "priority_beacon", 1, 4)
	content.load_abilities()["priority_beacon"].apply(state, "player", Vector2i(7, 7), 5)
	milestones["ability_used"] = true

	var geometry := SurveyGeometryServiceScript.new()
	var player := _fulfilled_box("player", Vector2i(2, 2), Vector2i(8, 8))
	var rival := _fulfilled_box("rival_surveyor", Vector2i(5, 5), Vector2i(11, 11))
	var events: Array[Dictionary] = CrystalInstabilityScript.new().update([player, rival], geometry, 5)
	if not events.is_empty():
		milestones["instability"] = true
	debug_state["first_conflict"] = state.state_hash()


func _run_containment_and_capture(
	state: MatchState,
	captured_camps: Array[String],
	milestones: Dictionary,
	debug_state: Dictionary
) -> void:
	var geometry := SurveyGeometryServiceScript.new()
	var pattern := _fulfilled_box("player", Vector2i(28, 2), Vector2i(36, 8))
	var capture := HearthCaptureScript.new()
	capture.capture_threshold = 2.0
	var capture_state := {}
	for tick in range(6, 9):
		capture_state = capture.update_hearth("hearth_rival_surveyor", Vector2i(35, 4), "rival_surveyor", [pattern], geometry, 0, tick)
	milestones["first_containment"] = capture_state.state in ["contained", "overwritten"]
	debug_state["first_containment"] = JSON.stringify(capture_state)
	state.capture_camp("camp_rival_surveyor", "player", 9)
	captured_camps.append("camp_rival_surveyor")
	milestones["first_capture"] = true
	debug_state["first_capture"] = state.state_hash()


func _run_endgame(
	state: MatchState,
	captured_camps: Array[String],
	milestones: Dictionary,
	debug_state: Dictionary
) -> void:
	state.capture_camp("camp_rival_brewer", "player", 12)
	state.capture_camp("camp_rival_warden", "player", 15)
	captured_camps.append("camp_rival_brewer")
	captured_camps.append("camp_rival_warden")
	milestones["match_end"] = state.winning_faction_id() == "player"
	debug_state["match_end"] = state.state_hash()


func _fulfilled_box(faction_id: String, min_cell: Vector2i, max_cell: Vector2i) -> SurveyPattern:
	var pattern: SurveyPattern = SurveyPatternScript.from_cells(faction_id, [
		min_cell,
		Vector2i(max_cell.x, min_cell.y),
		max_cell,
		Vector2i(min_cell.x, max_cell.y),
	])
	for index in range(pattern.vertices.size()):
		pattern.vertices[index].fulfilled_by_flag_id = "%s_full_match_%d" % [faction_id, index]
	return pattern
